package service

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	openAIStatusFeedURL     = "https://status.openai.com/feed.rss"
	openAIStatusTickInt     = 5 * time.Minute
	openAIStatusHTTPTimeout = 15 * time.Second
	// Redis key: stores fingerprints of entries we've already notified about.
	// Set with 7-day TTL — OpenAI incidents rarely last longer; keeps memory bounded.
	openAIStatusSeenKeyPrefix = "openai_status:seen:"
	openAIStatusSeenTTL       = 7 * 24 * time.Hour
	// Fallback in-memory dedup when Redis is not available.
	openAIStatusInMemoryMax = 200
)

var (
	openAIStatusOnce    sync.Once
	openAIStatusRunning atomic.Bool

	openAIStatusInMemoryMu   sync.Mutex
	openAIStatusInMemorySeen = make(map[string]time.Time)
)

// rssFeed mirrors the minimal subset of OpenAI's status RSS we care about.
type rssFeed struct {
	XMLName xml.Name `xml:"rss"`
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

type rssItem struct {
	Title       string `xml:"title"`
	Description string `xml:"description"`
	Link        string `xml:"link"`
	PubDate     string `xml:"pubDate"`
	GUID        string `xml:"guid"`
}

// StartOpenAIStatusMonitor spins up the background poller. Master node only.
func StartOpenAIStatusMonitor() {
	openAIStatusOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("openai status monitor started: tick=%s feed=%s", openAIStatusTickInt, openAIStatusFeedURL))
			ticker := time.NewTicker(openAIStatusTickInt)
			defer ticker.Stop()

			// Prime the dedup set on startup so we don't spam on first run.
			primeOpenAIStatusSeen()

			for range ticker.C {
				runOpenAIStatusCheckOnce()
			}
		})
	})
}

// primeOpenAIStatusSeen marks every currently-published incident as "seen" on
// startup, so the very first tick after a restart doesn't re-notify old history.
func primeOpenAIStatusSeen() {
	if !isOpenAIStatusMonitorEnabled() {
		return
	}
	items, err := fetchOpenAIStatusFeed()
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("openai status prime fetch failed: %v", err))
		return
	}
	for _, it := range items {
		markOpenAIStatusSeen(openAIStatusFingerprint(it))
	}
	logger.LogInfo(context.Background(), fmt.Sprintf("openai status monitor primed: seen=%d", len(items)))
}

func runOpenAIStatusCheckOnce() {
	if !openAIStatusRunning.CompareAndSwap(false, true) {
		return
	}
	defer openAIStatusRunning.Store(false)

	if !isOpenAIStatusMonitorEnabled() {
		return
	}

	items, err := fetchOpenAIStatusFeed()
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("openai status fetch failed: %v", err))
		return
	}

	for _, it := range items {
		fp := openAIStatusFingerprint(it)
		if isOpenAIStatusSeen(fp) {
			continue
		}
		if !shouldNotifyOpenAIStatus(it) {
			markOpenAIStatusSeen(fp)
			continue
		}
		msg := buildOpenAIStatusMessage(it)
		if err := SendWechatGroupMessage(msg); err != nil {
			logger.LogError(context.Background(), fmt.Sprintf("openai status notify wechat failed: %v", err))
			// Don't mark as seen on failure — retry next tick.
			continue
		}
		markOpenAIStatusSeen(fp)
		logger.LogInfo(context.Background(), fmt.Sprintf("openai status notified: title=%q link=%s", it.Title, it.Link))
	}
}

func isOpenAIStatusMonitorEnabled() bool {
	if common.OptionMap == nil {
		return false
	}
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap["OpenAIStatusMonitorEnabled"] == "true"
}

func fetchOpenAIStatusFeed() ([]rssItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), openAIStatusHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, openAIStatusFeedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("User-Agent", "new-api-openai-status-monitor/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	var feed rssFeed
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("parse xml: %w", err)
	}
	return feed.Channel.Items, nil
}

// shouldNotifyOpenAIStatus filters out noise — maintenance, generic product
// announcements, anything not API/ChatGPT/Playground related, and pure
// status-update pings that don't indicate a meaningful state change.
func shouldNotifyOpenAIStatus(it rssItem) bool {
	lower := strings.ToLower(it.Title + " " + it.Description)

	// Skip pure maintenance windows.
	if strings.Contains(lower, "scheduled maintenance") {
		return false
	}

	// Must relate to services we actually proxy.
	relevantKeywords := []string{"api", "chatgpt", "playground", "responses", "completions"}
	matched := false
	for _, kw := range relevantKeywords {
		if strings.Contains(lower, kw) {
			matched = true
			break
		}
	}
	if !matched {
		return false
	}

	// Notify on: new incidents, identification, major milestones, or resolution.
	// Investigation/monitoring-only updates are noisier — skip them to reduce spam.
	triggers := []string{"investigating", "identified", "resolved", "outage", "degraded", "elevated error"}
	for _, t := range triggers {
		if strings.Contains(lower, t) {
			return true
		}
	}
	return false
}

// openAIStatusFingerprint produces a stable key per distinct update.
// RSS GUIDs include the update timestamp, so each phase (investigating,
// identified, resolved) gets its own fingerprint.
func openAIStatusFingerprint(it rssItem) string {
	if it.GUID != "" {
		return it.GUID
	}
	return it.Link + "|" + it.PubDate
}

func isOpenAIStatusSeen(fp string) bool {
	if common.RedisEnabled {
		val, err := common.RedisGet(openAIStatusSeenKeyPrefix + fp)
		return err == nil && val != ""
	}
	openAIStatusInMemoryMu.Lock()
	defer openAIStatusInMemoryMu.Unlock()
	_, ok := openAIStatusInMemorySeen[fp]
	return ok
}

func markOpenAIStatusSeen(fp string) {
	if common.RedisEnabled {
		_ = common.RedisSet(openAIStatusSeenKeyPrefix+fp, "1", openAIStatusSeenTTL)
		return
	}
	openAIStatusInMemoryMu.Lock()
	defer openAIStatusInMemoryMu.Unlock()
	// Cheap cap to avoid unbounded growth when Redis is disabled.
	if len(openAIStatusInMemorySeen) >= openAIStatusInMemoryMax {
		for k := range openAIStatusInMemorySeen {
			delete(openAIStatusInMemorySeen, k)
			break
		}
	}
	openAIStatusInMemorySeen[fp] = time.Now()
}

// buildOpenAIStatusMessage renders a 3-line summary for WeChat.
//
// Format:
//
//	⚠️ OpenAI 故障            (or ✅ OpenAI 恢复)
//	<title>
//	🕐 HH:MM · <link>
func buildOpenAIStatusMessage(it rssItem) string {
	title := strings.TrimSpace(it.Title)
	link := strings.TrimSpace(it.Link)
	header := "⚠️ OpenAI 故障"
	if isOpenAIStatusResolved(it) {
		header = "✅ OpenAI 恢复"
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	if title != "" {
		b.WriteString(title)
		b.WriteString("\n")
	}
	b.WriteString("🕐 ")
	b.WriteString(formatOpenAIStatusTime(it.PubDate))
	if link != "" {
		b.WriteString(" · ")
		b.WriteString(link)
	}
	return b.String()
}

// isOpenAIStatusResolved detects resolution-phase entries by keyword.
func isOpenAIStatusResolved(it rssItem) bool {
	lower := strings.ToLower(it.Title + " " + it.Description)
	return strings.Contains(lower, "resolved")
}

// formatOpenAIStatusTime parses the RSS PubDate and renders HH:MM in local time.
// Falls back to the raw string if parsing fails.
func formatOpenAIStatusTime(pubDate string) string {
	pubDate = strings.TrimSpace(pubDate)
	if pubDate == "" {
		return ""
	}
	t, err := time.Parse(time.RFC1123Z, pubDate)
	if err != nil {
		t, err = time.Parse(time.RFC1123, pubDate)
	}
	if err != nil {
		return pubDate
	}
	return t.Local().Format("15:04")
}
