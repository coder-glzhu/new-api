package service

import (
	"bytes"
	"context"
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
func SendWechatGroupReminder(slotHour int) error {
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
		msg = fmt.Sprintf("🧧 福袋抽奖提醒：今天 %02d:00 将开始抽福袋，快来报名参与！记得准时参与哦～", slotHour)
	}

	return sendToGroupsWithDelay(userId, groupIdsRaw, msg)
}

// SendWechatDrawResult 向配置的群发送开奖结果（多群随机延迟）
// 模板占位符：{winner}=脱敏用户名, {quota}=金额(元), {date}=日期, {hour}=场次
func SendWechatDrawResult(winnerName string, quota int, drawDate string, slotHour int) error {
	if common.OptionMap == nil {
		return nil
	}

	common.OptionMapRWMutex.RLock()
	enabled := common.OptionMap["WechatBotEnabled"]
	userId := common.OptionMap["WechatBotUserId"]
	groupIdsRaw := common.OptionMap["WechatBotGroupIds"]
	resultContent := common.OptionMap["WechatBotResultContent"]
	common.OptionMapRWMutex.RUnlock()

	if enabled != "true" {
		return nil
	}
	if userId == "" || groupIdsRaw == "" {
		return nil
	}

	quotaDisplay := fmt.Sprintf("%.2f", float64(quota)/500000.0)
	msg := resultContent
	if msg == "" {
		msg = "🎉 福袋开奖结果：{date} {hour}:00 场次，恭喜 {winner} 获得价值 {quota} 元的额度！"
	}
	msg = strings.NewReplacer(
		"{winner}", winnerName,
		"{quota}", quotaDisplay,
		"{date}", drawDate,
		"{hour}", fmt.Sprintf("%02d", slotHour),
	).Replace(msg)

	return sendToGroupsWithDelay(userId, groupIdsRaw, msg)
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
	var firstErr error
	if err := sendWechatGroupMessage(userId, groupIds[0], msg); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("wechat notify: group %s: %v", groupIds[0], err))
		firstErr = err
	}

	for _, gid := range groupIds[1:] {
		gidCopy := gid
		delay := time.Duration(3+rand.Intn(6)) * time.Second
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
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
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
	resp, err := client.Post(wechatGroupMessageAPI, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("wechat API returned status %d", resp.StatusCode)
	}
	return nil
}
