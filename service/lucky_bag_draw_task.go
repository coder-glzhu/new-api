package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

var (
	luckyBagDrawOnce    sync.Once
	luckyBagDrawRunning atomic.Bool
)

// 开奖时刻由 model.GetDrawSlots() 动态返回（管理员可配置 OptionMap["LuckyBagDrawHours"]）

// StartLuckyBagDrawTask 启动定时开奖任务（仅主节点）
func StartLuckyBagDrawTask() {
	luckyBagDrawOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), "lucky bag draw task started")
			runLuckyBagDrawOnce()
			// 对齐到下一个整分钟，然后每分钟跑一次，避免 nowKey 匹配在秒级漂移
			now := time.Now()
			next := now.Truncate(time.Minute).Add(time.Minute)
			time.Sleep(time.Until(next))
			runLuckyBagDrawOnce()
			ticker := time.NewTicker(1 * time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				runLuckyBagDrawOnce()
			}
		})
	})
}

func runLuckyBagDrawOnce() {
	if !luckyBagDrawRunning.CompareAndSwap(false, true) {
		return
	}
	defer luckyBagDrawRunning.Store(false)

	now := time.Now()
	nowKey := now.Hour()*60 + now.Minute()
	today := now.Format("2006-01-02")
	ctx := context.Background()

	slots := model.GetDrawSlots()
	slotKeys := make([]string, len(slots))
	for i, s := range slots {
		slotKeys[i] = fmt.Sprintf("%02d:%02d", s.Hour, s.Minute)
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick %s nowKey=%d(%02d:%02d) slots=%v",
		today, nowKey, now.Hour(), now.Minute(), slotKeys))

	// 兜底：扫描所有"已开奖但未通知"的活动，补发群消息
	// 这覆盖了任务重启、ticker 漂移错过容差窗口等场景
	if missed, err := model.GetDrawnUnnotifiedActivities(); err == nil {
		if len(missed) > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: found %d unnotified drawn activities, dispatching", len(missed)))
		}
		for _, a := range missed {
			activity := a
			gopool.Go(func() {
				dispatchDrawResultNotify(ctx, &activity)
			})
		}
	} else {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag: query unnotified activities failed: %v", err))
	}

	for _, slot := range slots {
		slotDate := today
		slotMoment := time.Date(now.Year(), now.Month(), now.Day(), slot.Hour, slot.Minute, 0, 0, now.Location())

		slotKey := slot.Key()
		remindKey := slotKey - 60 // 开奖前 1 小时
		lockKey := slotKey - 1    // 开奖前 1 分钟

		// 1) 提醒（允许前后 1 分钟的容差）
		if nowKey == remindKey || nowKey == remindKey+1 {
			activity, err := model.GetOrCreateActivity(slotDate, slot)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] tick: GetOrCreateActivity failed for reminder %02d:%02d: %v", slot.Hour, slot.Minute, err))
				continue
			}
			won, err := model.MarkActivityReminderNotified(activity.Id)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] tick: mark reminder failed for slot %02d:%02d activityId=%d: %v", slot.Hour, slot.Minute, activity.Id, err))
				continue
			}
			if !won {
				logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: reminder already sent for slot %02d:%02d activityId=%d (nowKey=%d remindKey=%d)", slot.Hour, slot.Minute, activity.Id, nowKey, remindKey))
				continue
			}
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: sending reminder for slot %02d:%02d activityId=%d (nowKey=%d remindKey=%d)", slot.Hour, slot.Minute, activity.Id, nowKey, remindKey))
			s := slot
			gopool.Go(func() {
				if err := SendWechatGroupReminder(s.Hour, s.Minute); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("lucky bag: wechat reminder failed for slot %02d:%02d: %v", s.Hour, s.Minute, err))
				}
			})
		}

		// 2) 预开奖：开奖前 1 分钟
		if nowKey == lockKey {
			// 若 slot 是 00:00，则 lockKey 是前一天 23:59，此分支不会触发——GetDrawSlots 的默认值永不含 00:00
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: pre-compute (lock) for slot %02d:%02d (nowKey=%d lockKey=%d)", slot.Hour, slot.Minute, nowKey, lockKey))
			drawnAt := slotMoment.Unix()
			gopool.Go(func() {
				activity, err := model.GetOrCreateActivity(slotDate, slot)
				if err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] tick: GetOrCreateActivity failed for pre-compute %02d:%02d: %v", slot.Hour, slot.Minute, err))
					return
				}
				if activity.Status != model.LuckyBagStatusPending {
					logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: pre-compute skip %02d:%02d activityId=%d status=%s", slot.Hour, slot.Minute, activity.Id, activity.Status))
					return
				}
				if err := model.PrepareLuckyBagDraw(activity.Id, drawnAt); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("lucky bag: prepare draw failed (%s %02d:%02d): %v", slotDate, slot.Hour, slot.Minute, err))
				} else {
					logger.LogInfo(ctx, fmt.Sprintf("lucky bag: draw pre-computed (locked) for %s %02d:%02d", slotDate, slot.Hour, slot.Minute))
				}
			})
		}

		// 3) 正式开奖：slot 时间已到（包括补开奖）
		// 用 >= 而不是一个小窗口，确保"管理员中途加了一个已过时刻"或"服务重启错过窗口"时能在下一 tick 立即开奖
		if nowKey >= slotKey {
			activity, err := model.GetOrCreateActivity(slotDate, slot)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("lucky bag: failed to get activity %s %02d:%02d: %v", slotDate, slot.Hour, slot.Minute, err))
				continue
			}

			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] tick: slot %02d:%02d past (nowKey=%d slotKey=%d) activityId=%d status=%s",
				slot.Hour, slot.Minute, nowKey, slotKey, activity.Id, activity.Status))

			if activity.Status != model.LuckyBagStatusDrawn {
				logger.LogInfo(ctx, fmt.Sprintf("lucky bag auto draw: %s %02d:%02d (from %s)", slotDate, slot.Hour, slot.Minute, activity.Status))
				if err := model.DrawLuckyBag(activity.Id); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("lucky bag draw failed (%s %02d:%02d): %v", slotDate, slot.Hour, slot.Minute, err))
					continue
				}
				logger.LogInfo(ctx, fmt.Sprintf("lucky bag draw completed: %s %02d:%02d", slotDate, slot.Hour, slot.Minute))
			}

			// 读取最新的 activity 状态后派发通知（包含未中奖/无人参与的场次也会发）
			drawn, err := model.GetOrCreateActivity(slotDate, slot)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("lucky bag: reload drawn activity failed: %v", err))
				continue
			}
			activityCopy := *drawn
			gopool.Go(func() {
				dispatchDrawResultNotify(ctx, &activityCopy)
			})
		}
	}
}

// DispatchLuckyBagNotify 对外导出的幂等派发入口（管理员手动开奖时用）
func DispatchLuckyBagNotify(a *model.LuckyBagActivity) {
	dispatchDrawResultNotify(context.Background(), a)
}

// dispatchDrawResultNotify 幂等地派发开奖结果通知。
// 先原子标记 result_notified=1，得到通知权后调用微信 API；
// 若发送真实失败（API 返回错误，非"未配置"跳过），回滚标记以便下一 tick 重试。
func dispatchDrawResultNotify(ctx context.Context, a *model.LuckyBagActivity) {
	if a == nil || a.Status != model.LuckyBagStatusDrawn {
		return
	}
	won, err := model.MarkActivityResultNotified(a.Id)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag: mark notified failed (id=%d): %v", a.Id, err))
		return
	}
	if !won {
		return // 已有另一路派发，跳过
	}
	// 构建三名获奖者通知列表
	var winners []WechatDrawWinner
	for _, pair := range []struct {
		uid  int
		name string
		q    int
	}{
		{a.WinnerUserId, a.WinnerName, a.WinnerQuota},
		{a.Winner2UserId, a.Winner2Name, a.Winner2Quota},
		{a.Winner3UserId, a.Winner3Name, a.Winner3Quota},
	} {
		if pair.uid > 0 {
			name := model.FormatLuckyBagWinnerName(pair.uid, pair.name)
			winners = append(winners, WechatDrawWinner{Name: name, Quota: pair.q})
		}
	}
	notSkipped, sendErr := SendWechatDrawResult(winners, a.DrawDate, a.SlotHour, a.SlotMinute)
	if sendErr != nil {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag: wechat notify failed (%s %02d:%02d): %v; rolling back flag for retry", a.DrawDate, a.SlotHour, a.SlotMinute, sendErr))
		// 回滚以便后续 tick 重试
		if rollbackErr := model.DB.Model(&model.LuckyBagActivity{}).
			Where("id = ?", a.Id).
			Update("result_notified", 0).Error; rollbackErr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("lucky bag: rollback notified flag failed: %v", rollbackErr))
		}
		return
	}
	if !notSkipped {
		// 未配置开启，不算失败，但保留 flag=1 避免每分钟都再来一次日志；
		// 管理员开启后会通过手动触发或新一场通知被发出
		logger.LogInfo(ctx, fmt.Sprintf("lucky bag: notify skipped (wechat bot not enabled) for %s %02d:%02d", a.DrawDate, a.SlotHour, a.SlotMinute))
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("lucky bag: wechat result notified for %s %02d:%02d winners=%d", a.DrawDate, a.SlotHour, a.SlotMinute, len(winners)))
}
