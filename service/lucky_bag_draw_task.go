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

// drawHours 每天三场开奖时刻，与 model.DrawSlots 保持一致
var drawHours = []int{9, 12, 17}

// notifyHours 提前1小时发送提醒，对应开奖时刻的前一小时
var notifyHours = []int{8, 11, 16}

// StartLuckyBagDrawTask 启动定时开奖任务（仅主节点）
func StartLuckyBagDrawTask() {
	luckyBagDrawOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), "lucky bag draw task started (slots: 09:00, 12:00, 17:00)")
			ticker := time.NewTicker(1 * time.Minute)
			defer ticker.Stop()
			runLuckyBagDrawOnce()
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
	h := now.Hour()
	m := now.Minute()

	today := now.Format("2006-01-02")
	ctx := context.Background()

	// 在提醒时刻（8/11/16点）的第 0~1 分钟发送提醒
	for i, nh := range notifyHours {
		if h == nh && m <= 1 {
			nextSlot := drawHours[i]
			gopool.Go(func() {
				if err := SendWechatGroupReminder(nextSlot); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("lucky bag: wechat reminder failed for slot %02d:00: %v", nextSlot, err))
				}
			})
			break
		}
	}

	// 在开奖前1分钟（第59分钟）预计算开奖结果并缓存
	for i, dh := range drawHours {
		prevHour := dh - 1
		if prevHour < 0 {
			prevHour = 23
		}
		if h == prevHour && m == 59 {
			prepareSlot := drawHours[i]
			prepareDate := today
			if prevHour == 23 { // 跨天
				prepareDate = now.AddDate(0, 0, 1).Format("2006-01-02")
			}
			gopool.Go(func() {
				activity, err := model.GetOrCreateActivity(prepareDate, prepareSlot)
				if err != nil || activity.Status == "drawn" {
					return
				}
				if err := model.PrepareLuckyBagDraw(activity.Id); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("lucky bag: prepare draw failed (%s %02d:00): %v", prepareDate, prepareSlot, err))
				} else {
					logger.LogInfo(ctx, fmt.Sprintf("lucky bag: draw pre-computed for %s %02d:00", prepareDate, prepareSlot))
				}
			})
			break
		}
	}

	// 只在三个时间点的第 0~1 分钟触发开奖
	isDrawHour := false
	for _, dh := range drawHours {
		if h == dh && m <= 1 {
			isDrawHour = true
			break
		}
	}
	if !isDrawHour {
		return
	}

	activity, err := model.GetOrCreateActivity(today, h)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag: failed to get activity %s/%02d: %v", today, h, err))
		return
	}
	if activity.Status == "drawn" {
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("lucky bag auto draw: %s %02d:00", today, h))
	if err := model.DrawLuckyBag(activity.Id); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag draw failed (%s %02d:00): %v", today, h, err))
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("lucky bag draw completed: %s %02d:00", today, h))

	// 开奖后发送结果通知
	drawn, err := model.GetOrCreateActivity(today, h)
	if err == nil && drawn.Status == "drawn" && drawn.WinnerName != "" {
		gopool.Go(func() {
			if err := SendWechatDrawResult(drawn.WinnerName, drawn.WinnerQuota, drawn.DrawDate, drawn.SlotHour); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("lucky bag: wechat result notify failed: %v", err))
			}
		})
	}
}
