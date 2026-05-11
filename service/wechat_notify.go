package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/bytedance/gopkg/util/gopool"
)

const wechatGroupMessageAPI = "https://www.chydocx.cn/api/wechat/group-message/send"

// SendWechatGroupReminder 向配置的群发送福袋开奖提醒（多群随机延迟）
func SendWechatGroupReminder(slotHour, slotMinute int) error {
	if common.OptionMap == nil {
		return nil
	}

	common.OptionMapRWMutex.RLock()
	enabled := common.OptionMap["WechatBotEnabled"]
	userId := common.OptionMap["WechatBotUserId"]
	groupIdsRaw := common.OptionMap["WechatBotGroupIds"]
	reminderContent := common.OptionMap["WechatBotReminderContent"]
	common.OptionMapRWMutex.RUnlock()

	if enabled != "true" {
		return nil
	}
	if userId == "" || groupIdsRaw == "" {
		return nil
	}

	msg := reminderContent
	if msg == "" {
		msg = fmt.Sprintf("🧧 福袋抽奖提醒：今天 %02d:%02d 将开始抽福袋，快来报名参与！记得准时参与哦～", slotHour, slotMinute)
	}

	logger.LogInfo(context.Background(), fmt.Sprintf("wechat reminder: dispatching slot=%02d:%02d groups=%q msg_len=%d msg_hash=%s", slotHour, slotMinute, groupIdsRaw, len(msg), messageFingerprint(msg)))
	return sendToGroupsWithDelay(userId, groupIdsRaw, msg)
}

// WechatDrawWinner 单名获奖者信息（用于通知）
type WechatDrawWinner struct {
	Name  string
	Quota int
}

// SendWechatDrawResult 向配置的群发送开奖结果（支持最多3名获奖者）
// winners 按名次顺序传入（最多3个），空切片表示无人参与。
// 返回 notSkipped=true 表示真实调用了上游发送；false 表示 未配置/未开启 被静默跳过。
func SendWechatDrawResult(winners []WechatDrawWinner, drawDate string, slotHour, slotMinute int) (notSkipped bool, err error) {
	if common.OptionMap == nil {
		logger.LogWarn(context.Background(), "wechat draw result: OptionMap is nil; skipping")
		return false, nil
	}

	common.OptionMapRWMutex.RLock()
	enabled := common.OptionMap["WechatBotEnabled"]
	userId := common.OptionMap["WechatBotUserId"]
	groupIdsRaw := common.OptionMap["WechatBotGroupIds"]
	resultContent := common.OptionMap["WechatBotResultContent"]
	common.OptionMapRWMutex.RUnlock()

	ctx := context.Background()
	if enabled != "true" {
		logger.LogInfo(ctx, fmt.Sprintf("wechat draw result: WechatBotEnabled=%q; skipping (%s %02d:%02d)", enabled, drawDate, slotHour, slotMinute))
		return false, nil
	}
	if userId == "" || groupIdsRaw == "" {
		logger.LogWarn(ctx, fmt.Sprintf("wechat draw result: userId or groupIds empty; skipping (%s %02d:%02d)", drawDate, slotHour, slotMinute))
		return false, nil
	}

	timeDisplay := fmt.Sprintf("%02d:%02d", slotHour, slotMinute)
	var msg string

	// 过滤掉空名字的获奖者
	var validWinners []WechatDrawWinner
	for _, w := range winners {
		if w.Name != "" {
			validWinners = append(validWinners, w)
		}
	}

	if len(validWinners) == 0 {
		msg = fmt.Sprintf("🎁 福袋开奖结果：%s %s 场次本轮无人参与，下一场早点来抢哦～", drawDate, timeDisplay)
	} else if len(validWinners) == 1 {
		// 兼容单名获奖者的自定义模板
		quotaDisplay := fmt.Sprintf("%.2f", float64(validWinners[0].Quota)/500000.0)
		tmpl := resultContent
		if tmpl == "" {
			tmpl = "🎉 福袋开奖结果：{date} {time} 场次，恭喜 {winner} 获得价值 {quota} 元的额度！请及时登录平台核销兑换码。"
		}
		msg = strings.NewReplacer(
			"{winner}", validWinners[0].Name,
			"{quota}", quotaDisplay,
			"{date}", drawDate,
			"{hour}", fmt.Sprintf("%02d", slotHour),
			"{minute}", fmt.Sprintf("%02d", slotMinute),
			"{time}", timeDisplay,
		).Replace(tmpl)
	} else {
		// 多名获奖者：列表格式
		var lines []string
		medals := []string{"🥇", "🥈", "🥉"}
		for i, w := range validWinners {
			quotaDisplay := fmt.Sprintf("%.2f", float64(w.Quota)/500000.0)
			medal := ""
			if i < len(medals) {
				medal = medals[i]
			}
			lines = append(lines, fmt.Sprintf("%s %s 获得 %s 元额度", medal, w.Name, quotaDisplay))
		}
		msg = fmt.Sprintf("🎉 福袋开奖结果：%s %s 场次\n%s\n请及时登录平台核销兑换码。", drawDate, timeDisplay, strings.Join(lines, "\n"))
	}

	logger.LogInfo(ctx, fmt.Sprintf("wechat draw result: sending to groups %q (%s %02d:%02d) winners=%d", groupIdsRaw, drawDate, slotHour, slotMinute, len(validWinners)))
	if err := sendToGroupsWithDelay(userId, groupIdsRaw, msg); err != nil {
		return true, err
	}
	return true, nil
}

// SendWechatGroupMessage 立即发送指定消息到所有配置群（用于测试，也带随机延迟）
func SendWechatGroupMessage(msg string) error {
	if common.OptionMap == nil {
		return fmt.Errorf("option map not initialized")
	}

	common.OptionMapRWMutex.RLock()
	userId := common.OptionMap["WechatBotUserId"]
	groupIdsRaw := common.OptionMap["WechatBotGroupIds"]
	common.OptionMapRWMutex.RUnlock()

	if userId == "" || groupIdsRaw == "" {
		return fmt.Errorf("WechatBotUserId or WechatBotGroupIds not configured")
	}

	// 测试发送同步进行，不使用随机延迟
	groupIds := splitGroupIds(groupIdsRaw)
	logger.LogInfo(context.Background(), fmt.Sprintf("wechat test message: dispatching groups=%d msg_len=%d msg_hash=%s", len(groupIds), len(msg), messageFingerprint(msg)))
	var lastErr error
	for _, gid := range groupIds {
		if err := sendWechatGroupMessage(userId, gid, msg); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

// sendToGroupsWithDelay 多群发送，第二群起每群随机延迟 3~8 秒
func sendToGroupsWithDelay(userId, groupIdsRaw, msg string) error {
	groupIds := splitGroupIds(groupIdsRaw)
	if len(groupIds) == 0 {
		return nil
	}

	// 第一群立即发送，后续群在 goroutine 里延迟发送
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: dispatch start groups=%d first_group=%s msg_len=%d msg_hash=%s", len(groupIds), groupIds[0], len(msg), messageFingerprint(msg)))
	var firstErr error
	if err := sendWechatGroupMessage(userId, groupIds[0], msg); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("wechat notify: group %s: %v", groupIds[0], err))
		firstErr = err
	}

	for _, gid := range groupIds[1:] {
		gidCopy := gid
		delay := time.Duration(3+rand.Intn(6)) * time.Second
		logger.LogInfo(ctx, fmt.Sprintf("wechat notify: scheduling delayed group message group=%s delay=%s msg_hash=%s", gidCopy, delay, messageFingerprint(msg)))
		gopool.Go(func() {
			time.Sleep(delay)
			if err := sendWechatGroupMessage(userId, gidCopy, msg); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("wechat notify: group %s: %v", gidCopy, err))
			}
		})
	}

	return firstErr
}

func splitGroupIds(raw string) []string {
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			result = append(result, p)
		}
	}
	return result
}

func messageFingerprint(message string) string {
	sum := sha256.Sum256([]byte(message))
	return fmt.Sprintf("%x", sum[:6])
}

func sendWechatGroupMessage(userId, groupId, message string) error {
	payload, err := common.Marshal(map[string]any{
		"user_id":  userId,
		"group_id": groupId,
		"content":  message,
		"at_wxids": nil,
	})
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	ctx := context.Background()
	msgHash := messageFingerprint(message)
	start := time.Now()
	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: POST group-message user=%s group=%s msg_len=%d msg_hash=%s", userId, groupId, len(message), msgHash))
	resp, err := client.Post(wechatGroupMessageAPI, "application/json", bytes.NewReader(payload))
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("wechat notify: POST failed user=%s group=%s msg_hash=%s duration=%s err=%v", userId, groupId, msgHash, time.Since(start), err))
		return err
	}
	defer resp.Body.Close()

	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: POST completed user=%s group=%s status=%d msg_hash=%s duration=%s", userId, groupId, resp.StatusCode, msgHash, time.Since(start)))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("wechat API returned status %d", resp.StatusCode)
	}
	return nil
}
