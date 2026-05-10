package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

// DrawSlot 开奖时刻（小时 + 分钟）
type DrawSlot struct {
	Hour   int `json:"hour"`
	Minute int `json:"minute"`
}

// Key 唯一键，便于去重/比较
func (s DrawSlot) Key() int { return s.Hour*60 + s.Minute }

// defaultDrawSlots 默认开奖时刻（管理员可通过 OptionMap["LuckyBagDrawHours"] 覆盖）
var defaultDrawSlots = []DrawSlot{{9, 0}, {12, 0}, {17, 0}}

// parseSingleSlot 解析单个时刻，如 "9"、"09"、"17:52"、" 8:05 "
func parseSingleSlot(raw string) (DrawSlot, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DrawSlot{}, false
	}
	hPart, mPart := raw, "0"
	if i := strings.Index(raw, ":"); i >= 0 {
		hPart = strings.TrimSpace(raw[:i])
		mPart = strings.TrimSpace(raw[i+1:])
	}
	h, err := strconv.Atoi(hPart)
	if err != nil || h < 0 || h > 23 {
		return DrawSlot{}, false
	}
	m, err := strconv.Atoi(mPart)
	if err != nil || m < 0 || m > 59 {
		return DrawSlot{}, false
	}
	return DrawSlot{Hour: h, Minute: m}, true
}

// GetDrawSlots 返回当前配置的开奖时刻列表（升序去重，过滤非法值）
// 读取 OptionMap["LuckyBagDrawHours"]，格式为逗号分隔的 "H" 或 "H:MM"
// 例如 "9,12,17:52" 表示 09:00, 12:00, 17:52
func GetDrawSlots() []DrawSlot {
	raw := ""
	if common.OptionMap != nil {
		common.OptionMapRWMutex.RLock()
		raw = common.OptionMap["LuckyBagDrawHours"]
		common.OptionMapRWMutex.RUnlock()
	}
	if raw == "" {
		out := make([]DrawSlot, len(defaultDrawSlots))
		copy(out, defaultDrawSlots)
		return out
	}
	seen := make(map[int]struct{}, 8)
	result := make([]DrawSlot, 0, 8)
	for _, part := range strings.Split(raw, ",") {
		slot, ok := parseSingleSlot(part)
		if !ok {
			continue
		}
		if _, dup := seen[slot.Key()]; dup {
			continue
		}
		seen[slot.Key()] = struct{}{}
		result = append(result, slot)
	}
	if len(result) == 0 {
		out := make([]DrawSlot, len(defaultDrawSlots))
		copy(out, defaultDrawSlots)
		return out
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Key() < result[j].Key()
	})
	return result
}

// 活动状态
const (
	LuckyBagStatusPending = "pending" // 未开奖，可报名
	LuckyBagStatusLocked  = "locked"  // 预开奖完成：winner/redemption 已写入 DB，但对外仍表现为 pending；不可再报名
	LuckyBagStatusDrawn   = "drawn"   // 正式开奖，结果对外可见
)

// LuckyBagActivity 每天每场一条活动记录
type LuckyBagActivity struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	DrawDate         string `json:"draw_date" gorm:"type:varchar(10);uniqueIndex:idx_lucky_bag_date_slot_v2"`     // YYYY-MM-DD
	SlotHour         int    `json:"slot_hour" gorm:"not null;uniqueIndex:idx_lucky_bag_date_slot_v2"`             // 0~23
	SlotMinute       int    `json:"slot_minute" gorm:"not null;default:0;uniqueIndex:idx_lucky_bag_date_slot_v2"` // 0~59
	MinQuota         int    `json:"min_quota" gorm:"not null;default:500000"`                                     // 默认 $1
	MaxQuota         int    `json:"max_quota" gorm:"not null;default:5000000"`                                    // 默认 $10
	Status           string `json:"status" gorm:"type:varchar(20);default:'pending'"`                             // pending / locked / drawn
	WinnerUserId     int    `json:"winner_user_id" gorm:"default:0"`
	WinnerName       string `json:"winner_name" gorm:"type:varchar(100)"`
	WinnerQuota      int    `json:"winner_quota" gorm:"default:0"`
	WinnerCode       string `json:"winner_code" gorm:"type:varchar(64)"`
	DrawnAt          int64  `json:"drawn_at" gorm:"bigint;default:0"`
	ReminderNotified int    `json:"-" gorm:"not null;default:0"` // 1=开奖前提醒已发送，防止多实例重复提醒
	ResultNotified   int    `json:"-" gorm:"not null;default:0"` // 1=微信群通知已发送，防止重复/补发
	CreatedAt        int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// LuckyBagEntry 用户报名记录，每人每场只能报名一次
type LuckyBagEntry struct {
	Id           int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ActivityId   int   `json:"activity_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	UserId       int   `json:"user_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	Weight       int   `json:"weight" gorm:"not null;default:1"`
	WinnerViewed int   `json:"winner_viewed" gorm:"not null;default:0"` // 1=用户已查看中奖弹窗
	CreatedAt    int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// nextDrawSlot 返回"下一场"的 (date, slot)
// 定义：今日尚未到开奖时刻（nowKey < slotKey）的第一场；若全部已到点/过点，返回明天第一场。
//
// 注意：这里不能用 `nowKey >= slotKey - 1` 跳过预开奖场次，否则开奖前 1 分钟内
// 前端刷新会看到"下一场 = 明天 09:00"，参与人数变 0、按钮又能点击，彻底混乱。
// 预开奖状态应由 GetNextActivity 读取 DB status 后判断（locked 场次仍返回自己）。
func nextDrawSlot() (date string, slot DrawSlot) {
	now := time.Now()
	today := now.Format("2006-01-02")
	nowKey := now.Hour()*60 + now.Minute()
	slots := GetDrawSlots()
	for _, s := range slots {
		if nowKey < s.Key() {
			return today, s
		}
	}
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	return tomorrow, slots[0]
}

// GetDefaultPrizeRange 返回管理员配置的默认奖金区间（单位：quota，500000=$1）
// 优先读 OptionMap["LuckyBagMinUsd"] / ["LuckyBagMaxUsd"]（单位 USD，浮点数）；
// 配置缺失或非法时回落到 $1 ~ $10
func GetDefaultPrizeRange() (minQ, maxQ int) {
	minQ, maxQ = 500000, 5000000 // $1 ~ $10 兜底
	if common.OptionMap == nil {
		return
	}
	common.OptionMapRWMutex.RLock()
	minRaw := common.OptionMap["LuckyBagMinUsd"]
	maxRaw := common.OptionMap["LuckyBagMaxUsd"]
	common.OptionMapRWMutex.RUnlock()

	if v, err := strconv.ParseFloat(strings.TrimSpace(minRaw), 64); err == nil && v > 0 {
		minQ = int(v * 500000)
	}
	if v, err := strconv.ParseFloat(strings.TrimSpace(maxRaw), 64); err == nil && v > 0 {
		maxQ = int(v * 500000)
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	return
}

// GetOrCreateActivity 获取指定日期+时段的活动，不存在则创建
func GetOrCreateActivity(date string, slot DrawSlot) (*LuckyBagActivity, error) {
	var activity LuckyBagActivity
	err := DB.Where("draw_date = ? AND slot_hour = ? AND slot_minute = ?", date, slot.Hour, slot.Minute).First(&activity).Error
	if err == nil {
		return &activity, nil
	}
	minQ, maxQ := GetDefaultPrizeRange()
	activity = LuckyBagActivity{
		DrawDate:   date,
		SlotHour:   slot.Hour,
		SlotMinute: slot.Minute,
		MinQuota:   minQ,
		MaxQuota:   maxQ,
		Status:     "pending",
		CreatedAt:  time.Now().Unix(),
	}
	if err := DB.Create(&activity).Error; err != nil {
		if err2 := DB.Where("draw_date = ? AND slot_hour = ? AND slot_minute = ?", date, slot.Hour, slot.Minute).First(&activity).Error; err2 != nil {
			return nil, err
		}
	}
	return &activity, nil
}

// GetNextActivity 获取/创建下一场活动
func GetNextActivity() (*LuckyBagActivity, error) {
	date, slot := nextDrawSlot()
	return GetOrCreateActivity(date, slot)
}

// GetTodayActivities 获取今日全部场次（按时段顺序）
func GetTodayActivities() ([]*LuckyBagActivity, error) {
	today := time.Now().Format("2006-01-02")
	slots := GetDrawSlots()
	result := make([]*LuckyBagActivity, 0, len(slots))
	for _, s := range slots {
		a, err := GetOrCreateActivity(today, s)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, nil
}

// 抽奖权重参数（方案 A：票数地板 + 对数奖励；方案 C：保底加成）
const (
	luckyBagTicketFloor    = 10  // 每人基础票数，保证新人有真实机会
	luckyBagTicketMeritCap = 40  // 活跃度加成上限，巨鲸/新人 ≈ 5:1（50 vs 10）
	luckyBagMeritBonus     = 5.0 // log₂ 系数：每 usage 翻倍增加 5 张票
	luckyBagPityStep       = 0.2 // 保底加成：每连续 1 场未中奖，权重上浮 20%
	luckyBagPityCap        = 10  // 保底连击上限，避免无限累积
)

// calcUserScore 汇总用户在消费/请求/签到三维度的"活跃度得分"（已做 log 压缩）
func calcUserScore(userId int, usedQuota, requestCount int) float64 {
	// 签到维度（近 30 天）
	end := time.Now().Format("2006-01-02")
	start := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	var checkinCount int64
	DB.Model(&Checkin{}).
		Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?", userId, start, end).
		Count(&checkinCount)

	// log 压缩：usedQuota 翻 1000 倍只增加 ~10 的得分
	// 权重：消费占主导，请求其次，签到作为日活激励
	score := math.Log2(1+float64(usedQuota)/10000) +
		0.5*math.Log2(1+float64(requestCount)) +
		0.3*float64(checkinCount)
	return score
}

// calcUserPityLosses 查询用户最近连续多少场抽奖未中奖（只统计已开奖、用户报名的场次）
// 从最近一场倒推，遇到中奖即停止计数
func calcUserPityLosses(userId int) int {
	type row struct {
		WinnerUserId int
	}
	var rows []row
	// JOIN 查出用户所有报名过且已开奖的场次，按时间倒序；limit 稍放宽一点覆盖 cap
	DB.Raw(`
		SELECT a.winner_user_id AS winner_user_id
		FROM lucky_bag_entries e
		JOIN lucky_bag_activities a ON a.id = e.activity_id
		WHERE e.user_id = ? AND a.status = ?
		ORDER BY a.drawn_at DESC
		LIMIT ?
	`, userId, LuckyBagStatusDrawn, luckyBagPityCap+1).Scan(&rows)

	losses := 0
	for _, r := range rows {
		if r.WinnerUserId == userId {
			break
		}
		losses++
	}
	if losses > luckyBagPityCap {
		losses = luckyBagPityCap
	}
	return losses
}

// calcUserWeight 计算用户在本场抽奖的权重
//
// 设计哲学：让"活跃度"影响概率，但不让巨鲸包场；让连续陪跑的用户有"保底"体验。
//
// 组合公式（方案 A + 方案 C）：
//
//  1. 方案 A — 票数地板 + 对数奖励（源自航司里程、赌场 comp points）：
//     merit   = min(ticketMeritCap, bonus × log₂(1 + score))
//     tickets = ticketFloor + merit
//     关键性质：巨鲸/新人 比例硬上限 5:1（50:10），业界经验值
//
//  2. 方案 C — 保底加成（源自 Genshin Impact 的 soft pity）：
//     连续 n 场未中奖 → 下次权重 ×(1 + 0.2·n)，最多 ×3 倍
//     保证连续陪跑的用户体验不崩，极大提升留存
//
// 真实数据示例（caimter UsedQuota=3.8亿 vs 新用户）：
//
//	新用户       tickets=10, losses=0  → weight=10
//	新用户陪跑5场 tickets=10, losses=5  → weight=20（翻倍补偿）
//	巨鲸         tickets=50, losses=0  → weight=50
//	巨鲸陪跑5场   tickets=50, losses=5  → weight=100
//
// 最大差距 5:1，但保底机制让陪跑用户的相对概率随时间增长。
func calcUserWeight(userId int) int {
	ctx := context.Background()
	user, err := GetUserById(userId, true)
	if err != nil || user == nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] calcUserWeight userId=%d: user not found (%v), using weight=%d (floor only)",
			userId, err, luckyBagTicketFloor))
		return luckyBagTicketFloor
	}

	// 1. 活跃度得分（log 压缩的综合分）
	score := calcUserScore(userId, user.UsedQuota, user.RequestCount)

	// 2. 方案 A：票数地板 + 对数奖励
	merit := luckyBagMeritBonus * math.Log2(1+score)
	if merit < 0 {
		merit = 0
	}
	if merit > float64(luckyBagTicketMeritCap) {
		merit = float64(luckyBagTicketMeritCap)
	}
	baseTickets := float64(luckyBagTicketFloor) + merit

	// 3. 方案 C：保底加成
	losses := calcUserPityLosses(userId)
	pityMultiplier := 1.0 + luckyBagPityStep*float64(losses)

	finalWeight := int(math.Round(baseTickets * pityMultiplier))
	if finalWeight < 1 {
		finalWeight = 1
	}

	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] calcUserWeight userId=%d: score=%.2f (quota=%d req=%d) → baseTickets=%.1f ×pity(losses=%d,x%.2f) = %d",
		userId, score, user.UsedQuota, user.RequestCount, baseTickets, losses, pityMultiplier, finalWeight))
	return finalWeight
}

// EnterLuckyBag 用户报名下一场活动（幂等）
// 仅接受"今日"的场次报名；今日全部场次已结束则拒绝，不允许预约明天
func EnterLuckyBag(userId int) (*LuckyBagEntry, error) {
	ctx := context.Background()
	activity, err := GetNextActivity()
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d: GetNextActivity failed: %v", userId, err))
		return nil, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d date=%s slot=%02d:%02d status=%s",
		userId, activity.Id, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	today := time.Now().Format("2006-01-02")
	if activity.DrawDate != today {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: next slot is %s (not today %s), today's draws finished",
			userId, activity.DrawDate, today))
		return nil, errors.New("今日抽奖已结束，请明天再来")
	}

	if activity.Status == LuckyBagStatusLocked {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: activity %d is locked (pre-drawing)", userId, activity.Id))
		return nil, errors.New("即将开奖，本场报名已截止")
	}
	if activity.Status != LuckyBagStatusPending {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: activity %d status=%s (not pending)", userId, activity.Id, activity.Status))
		return nil, errors.New("该场次已开奖，请等待下一场")
	}

	var existing LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err == nil {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d already entered (entryId=%d weight=%d)", userId, activity.Id, existing.Id, existing.Weight))
		return &existing, nil
	}

	weight := calcUserWeight(userId)
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d computed weight=%d", userId, activity.Id, weight))
	entry := &LuckyBagEntry{
		ActivityId: activity.Id,
		UserId:     userId,
		Weight:     weight,
		CreatedAt:  time.Now().Unix(),
	}
	if err := DB.Create(entry).Error; err != nil {
		if err2 := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err2 == nil {
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d concurrent insert resolved (entryId=%d)", userId, activity.Id, existing.Id))
			return &existing, nil
		}
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d DB create failed: %v", userId, activity.Id, err))
		return nil, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d new entry created (entryId=%d weight=%d)", userId, activity.Id, entry.Id, weight))
	return entry, nil
}

// GetUserNextEntry 查询用户对下一场活动的报名状态
func GetUserNextEntry(userId int) (*LuckyBagEntry, *LuckyBagActivity, error) {
	activity, err := GetNextActivity()
	if err != nil {
		return nil, nil, err
	}
	var entry LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&entry).Error; err != nil {
		return nil, activity, nil
	}
	return &entry, activity, nil
}

func maskNameToken(name string) string {
	runes := []rune(name)
	switch len(runes) {
	case 0:
		return ""
	case 1:
		return "*"
	case 2:
		return string(runes[:1]) + "*"
	case 3:
		return string(runes[:1]) + "*" + string(runes[2:])
	case 4:
		return string(runes[:2]) + "*" + string(runes[3:])
	default:
		return string(runes[:2]) + "***" + string(runes[len(runes)-2:])
	}
}

func maskWinnerUsername(username string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		return ""
	}
	if at := strings.Index(username, "@"); at > 0 {
		return maskNameToken(username[:at]) + "@***"
	}
	return maskNameToken(username)
}

func formatLuckyBagWinnerName(userId int, username string) string {
	masked := maskWinnerUsername(username)
	if userId <= 0 {
		return masked
	}
	if masked == "" {
		return fmt.Sprintf("UID %d", userId)
	}
	return fmt.Sprintf("%s（UID %d）", masked, userId)
}

func FormatLuckyBagWinnerName(userId int, fallback string) string {
	if userId <= 0 {
		return fallback
	}
	if u, _ := GetUserById(userId, false); u != nil {
		return formatLuckyBagWinnerName(userId, u.Username)
	}
	if fallback != "" {
		return fallback
	}
	return fmt.Sprintf("UID %d", userId)
}

func applyLuckyBagWinnerDisplayName(a *LuckyBagActivity) {
	if a == nil || a.WinnerUserId <= 0 {
		return
	}
	a.WinnerName = FormatLuckyBagWinnerName(a.WinnerUserId, a.WinnerName)
}

// calcWinnerQuota 在管理员为该场次配置的 [MinQuota, MaxQuota] 区间内随机生成奖金
// 注意：中奖概率已通过 calcUserWeight（消费/请求/签到）体现；奖金本身应是纯随机，
// 不再与用户消费挂钩，避免"高消费用户必拿最高奖"导致发奖成本失控
func calcWinnerQuota(activity *LuckyBagActivity) int {
	minQ, maxQ := activity.MinQuota, activity.MaxQuota
	if minQ <= 0 {
		minQ = 500000 // $1
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	if maxQ == minQ {
		return minQ
	}
	return minQ + rand.Intn(maxQ-minQ+1)
}

// pickWinnerAndPersist 执行加权随机、生成兑换码、并把中奖信息写入 DB（状态置为 targetStatus）
// drawnAt 为写入 drawn_at 字段的时间戳（locked 阶段可用开奖时刻，drawn 阶段用 now）
// 若无人报名，只更新 status/drawn_at，不创建兑换码
func pickWinnerAndPersist(activity *LuckyBagActivity, entries []LuckyBagEntry, targetStatus string, drawnAt int64) error {
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d date=%s slot=%02d:%02d entries=%d targetStatus=%s",
		activity.Id, activity.DrawDate, activity.SlotHour, activity.SlotMinute, len(entries), targetStatus))

	if len(entries) == 0 {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: no participants, setting status=%s", activity.Id, targetStatus))
		return DB.Model(activity).Updates(map[string]any{
			"status":   targetStatus,
			"drawn_at": drawnAt,
		}).Error
	}

	totalWeight := 0
	for _, e := range entries {
		totalWeight += e.Weight
	}
	pick := rand.Intn(totalWeight)
	cum := 0
	winnerEntry := entries[0]
	for _, e := range entries {
		cum += e.Weight
		if pick < cum {
			winnerEntry = e
			break
		}
	}
	winnerUserId := winnerEntry.UserId
	quota := calcWinnerQuota(activity)
	winnerName := ""
	if u, _ := GetUserById(winnerUserId, false); u != nil {
		winnerName = formatLuckyBagWinnerName(winnerUserId, u.Username)
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: totalWeight=%d pick=%d winnerUserId=%d winnerName=%q quota=%d (range=[%d,%d])",
		activity.Id, totalWeight, pick, winnerUserId, winnerName, quota, activity.MinQuota, activity.MaxQuota))

	code := common.GetUUID()
	redemption := &Redemption{
		UserId:      0,
		Key:         code,
		Status:      common.RedemptionCodeStatusEnabled,
		Name:        fmt.Sprintf("lucky_bag_%s_%02d%02d", activity.DrawDate, activity.SlotHour, activity.SlotMinute),
		Quota:       quota,
		CreatedTime: time.Now().Unix(),
	}
	if err := DB.Create(redemption).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: create redemption failed: %v", activity.Id, err))
		return err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: redemption code created code=%s quota=%d", activity.Id, code, quota))

	if err := DB.Model(activity).Updates(map[string]any{
		"status":         targetStatus,
		"winner_user_id": winnerUserId,
		"winner_name":    winnerName,
		"winner_quota":   quota,
		"winner_code":    code,
		"drawn_at":       drawnAt,
	}).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: update activity failed: %v", activity.Id, err))
		return err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: activity updated to status=%s winner=%d", activity.Id, targetStatus, winnerUserId))
	return nil
}

// PrepareLuckyBagDraw 在开奖前 1 分钟预开奖：完整写 DB，但 status 置为 locked，对外仍表现为 pending
// drawnAtUnix 为开奖时刻的 Unix 时间戳（controller 据此判断是否允许对外展示 winner）
func PrepareLuckyBagDraw(activityId int, drawnAtUnix int64) error {
	ctx := context.Background()
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: not found", activityId))
		return errors.New("活动不存在")
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d date=%s slot=%02d:%02d currentStatus=%s",
		activityId, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	if activity.Status != LuckyBagStatusPending {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: skipping (status=%s, not pending)", activityId, activity.Status))
		return nil
	}

	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: load entries failed: %v", activityId, err))
		return err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: %d entries loaded, proceeding to lock", activityId, len(entries)))
	return pickWinnerAndPersist(&activity, entries, LuckyBagStatusLocked, drawnAtUnix)
}

// DrawLuckyBag 对指定活动执行开奖
//   - locked：winner/兑换码已提前写入，只需把 status 翻成 drawn
//   - pending：兜底，完整开奖流程
//   - drawn：已开奖，返回错误
func DrawLuckyBag(activityId int) error {
	ctx := context.Background()
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: not found", activityId))
		return errors.New("活动不存在")
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d date=%s slot=%02d:%02d currentStatus=%s",
		activityId, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	if activity.Status == LuckyBagStatusDrawn {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: already drawn", activityId))
		return errors.New("该场次已开奖")
	}

	now := time.Now().Unix()
	if activity.Status == LuckyBagStatusLocked {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: locked->drawn (winner=%d name=%q quota=%d)",
			activityId, activity.WinnerUserId, activity.WinnerName, activity.WinnerQuota))
		if err := DB.Model(&activity).Update("status", LuckyBagStatusDrawn).Error; err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: flip to drawn failed: %v", activityId, err))
			return err
		}
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: status flipped to drawn", activityId))
		return nil
	}

	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: fallback full draw (status was %s)", activityId, activity.Status))
	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: load entries failed: %v", activityId, err))
		return err
	}
	return pickWinnerAndPersist(&activity, entries, LuckyBagStatusDrawn, now)
}

// LuckyBagHistoryItem 历史开奖记录（含兑换码状态）
type LuckyBagHistoryItem struct {
	LuckyBagActivity
	// 仅对中奖用户自己可见：兑换码状态 1=未使用 3=已使用 0=无（非本人中奖）
	WinnerCodeStatus int `json:"winner_code_status"`
}

// GetLuckyBagHistory 分页获取历史开奖记录，附带兑换码使用状态
// userId: 当前请求用户，用于判断是否显示兑换码状态；传 0 则不查
func GetLuckyBagHistory(page, size, userId int) ([]LuckyBagHistoryItem, int64, error) {
	if size <= 0 {
		size = 10
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	var total int64
	var activities []LuckyBagActivity
	base := DB.Model(&LuckyBagActivity{}).Where("status = ?", "drawn")
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := base.Order("draw_date desc, slot_hour desc, slot_minute desc").Offset(offset).Limit(size).Find(&activities).Error; err != nil {
		return nil, 0, err
	}

	// 批量查当前用户中奖场次对应的兑换码状态
	codeStatusMap := map[string]int{}
	if userId > 0 {
		codes := make([]string, 0)
		for _, a := range activities {
			if a.WinnerUserId == userId && a.WinnerCode != "" {
				codes = append(codes, a.WinnerCode)
			}
		}
		if len(codes) > 0 {
			keyCol := "`key`"
			if common.UsingPostgreSQL {
				keyCol = `"key"`
			}
			var redemptions []Redemption
			DB.Select("key, status").Where(keyCol+" IN ?", codes).Find(&redemptions)
			for _, r := range redemptions {
				codeStatusMap[r.Key] = r.Status
			}
		}
	}

	items := make([]LuckyBagHistoryItem, len(activities))
	for i, a := range activities {
		applyLuckyBagWinnerDisplayName(&a)
		items[i] = LuckyBagHistoryItem{LuckyBagActivity: a}
		if userId > 0 && a.WinnerUserId == userId && a.WinnerCode != "" {
			if s, ok := codeStatusMap[a.WinnerCode]; ok {
				items[i].WinnerCodeStatus = s
			} else {
				items[i].WinnerCodeStatus = 1 // enabled（未使用）
			}
		}
	}
	return items, total, nil
}

// GetLuckyBagParticipantCount 获取指定活动报名人数
func GetLuckyBagParticipantCount(activityId int) (int64, error) {
	var count int64
	err := DB.Model(&LuckyBagEntry{}).Where("activity_id = ?", activityId).Count(&count).Error
	return count, err
}

// GetUserEnteredActivityIds 返回用户在给定活动 ID 列表中已报名的活动 ID 集合
func GetUserEnteredActivityIds(userId int, activityIds []int) (map[int]bool, error) {
	if len(activityIds) == 0 {
		return map[int]bool{}, nil
	}
	var entries []LuckyBagEntry
	if err := DB.Where("user_id = ? AND activity_id IN ?", userId, activityIds).Find(&entries).Error; err != nil {
		return nil, err
	}
	m := make(map[int]bool, len(entries))
	for _, e := range entries {
		m[e.ActivityId] = true
	}
	return m, nil
}

// UserEntryInfo 用户对某活动的报名信息快照
type UserEntryInfo struct {
	Entered      bool
	WinnerViewed bool
}

// GetUserEntryInfos 返回用户在给定活动 ID 列表中的报名信息（是否报名 + 是否已看弹窗）
func GetUserEntryInfos(userId int, activityIds []int) (map[int]UserEntryInfo, error) {
	if len(activityIds) == 0 {
		return map[int]UserEntryInfo{}, nil
	}
	var entries []LuckyBagEntry
	if err := DB.Where("user_id = ? AND activity_id IN ?", userId, activityIds).Find(&entries).Error; err != nil {
		return nil, err
	}
	m := make(map[int]UserEntryInfo, len(entries))
	for _, e := range entries {
		m[e.ActivityId] = UserEntryInfo{Entered: true, WinnerViewed: e.WinnerViewed == 1}
	}
	return m, nil
}

// MarkWinnerViewed 标记用户已查看某场次的中奖弹窗
func MarkWinnerViewed(userId, activityId int) error {
	return DB.Model(&LuckyBagEntry{}).
		Where("user_id = ? AND activity_id = ?", userId, activityId).
		Update("winner_viewed", 1).Error
}

// MarkActivityReminderNotified 原子地把 reminder_notified 从 0 置为 1。
// 返回 true 表示本次获得提醒发送权；false 表示其他实例已经发送过。
func MarkActivityReminderNotified(activityId int) (bool, error) {
	res := DB.Model(&LuckyBagActivity{}).
		Where("id = ? AND reminder_notified = 0", activityId).
		Update("reminder_notified", 1)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// MarkActivityResultNotified 原子地把 result_notified 从 0 置为 1。
// 返回 true 表示本次获得通知权（未发过）；false 表示已发过或活动不存在。
func MarkActivityResultNotified(activityId int) (bool, error) {
	res := DB.Model(&LuckyBagActivity{}).
		Where("id = ? AND result_notified = 0", activityId).
		Update("result_notified", 1)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// GetDrawnUnnotifiedActivities 返回已开奖但未通知且近 24 小时的活动（按时间顺序）
// 限制 24 小时是为了避免老历史数据在部署后集中刷屏
func GetDrawnUnnotifiedActivities() ([]LuckyBagActivity, error) {
	cutoff := time.Now().Add(-24 * time.Hour).Unix()
	var list []LuckyBagActivity
	if err := DB.Where("status = ? AND result_notified = 0 AND drawn_at >= ?",
		LuckyBagStatusDrawn, cutoff).
		Order("draw_date asc, slot_hour asc, slot_minute asc").
		Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// RecentDrawnResult 最近已开奖且用户参与的活动，附带报名信息
type RecentDrawnResult struct {
	Activity     LuckyBagActivity
	IsWinner     bool
	WinnerViewed bool
}

// GetRecentDrawnResultsForUser 返回最近2天内用户参与过且已开奖的活动（按时间倒序）
func GetRecentDrawnResultsForUser(userId int) ([]RecentDrawnResult, error) {
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	var activities []LuckyBagActivity
	if err := DB.Where("status = ? AND draw_date >= ?", "drawn", yesterday).
		Order("draw_date desc, slot_hour desc, slot_minute desc").Find(&activities).Error; err != nil {
		return nil, err
	}
	if len(activities) == 0 {
		return nil, nil
	}
	ids := make([]int, len(activities))
	for i, a := range activities {
		ids[i] = a.Id
	}
	infoMap, err := GetUserEntryInfos(userId, ids)
	if err != nil {
		return nil, err
	}
	var result []RecentDrawnResult
	for _, a := range activities {
		info, entered := infoMap[a.Id]
		if !entered {
			continue
		}
		applyLuckyBagWinnerDisplayName(&a)
		result = append(result, RecentDrawnResult{
			Activity:     a,
			IsWinner:     a.WinnerUserId == userId,
			WinnerViewed: info.WinnerViewed,
		})
	}
	return result, nil
}

// UpdateLuckyBagActivityConfig 管理员更新指定场次奖品区间
func UpdateLuckyBagActivityConfig(activityId, minQuota, maxQuota int) error {
	if minQuota <= 0 || maxQuota < minQuota {
		return errors.New("奖品额度配置不合法")
	}
	return DB.Model(&LuckyBagActivity{}).Where("id = ? AND status = ?", activityId, "pending").
		Updates(map[string]any{
			"min_quota": minQuota,
			"max_quota": maxQuota,
		}).Error
}
