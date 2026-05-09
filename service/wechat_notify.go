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

	return sendToGroupsWithDelay(userId, groupIdsRaw, msg)
}

// SendWechatDrawResult 向配置的群发送开奖结果（多群随机延迟）
// 模板占位符：{winner}=脱敏用户名, {quota}=金额(元), {date}=日期, {hour}=小时, {minute}=分钟, {time}=HH:MM
// 若本场无人参与（winnerName 为空），发送"无人参与"的固定文案，不使用自定义模板
// 返回 notSkipped=true 表示真实调用了上游发送；false 表示 未配置/未开启 被静默跳过（调用方应视为"未发"）
func SendWechatDrawResult(winnerName string, quota int, drawDate string, slotHour, slotMinute int) (notSkipped bool, err error) {
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
	if winnerName == "" {
		// 无人参与的场次
		msg = fmt.Sprintf("🎁 福袋开奖结果：%s %s 场次本轮无人参与，下一场早点来抢哦～", drawDate, timeDisplay)
	} else {
		quotaDisplay := fmt.Sprintf("%.2f", float64(quota)/500000.0)
		msg = resultContent
		if msg == "" {
			msg = "🎉 福袋开奖结果：{date} {time} 场次，恭喜 {winner} 获得价值 {quota} 元的额度！请及时登录平台核销兑换码。"
		}
		msg = strings.NewReplacer(
			"{winner}", winnerName,
			"{quota}", quotaDisplay,
			"{date}", drawDate,
			"{hour}", fmt.Sprintf("%02d", slotHour),
			"{minute}", fmt.Sprintf("%02d", slotMinute),
			"{time}", timeDisplay,
		).Replace(msg)
	}

	logger.LogInfo(ctx, fmt.Sprintf("wechat draw result: sending to groups %q (%s %02d:%02d)", groupIdsRaw, drawDate, slotHour, slotMinute))
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
