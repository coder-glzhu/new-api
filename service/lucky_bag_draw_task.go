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

	// 只在三个时间点的第 0~1 分钟触发
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

	// 找到当前时段对应的活动
	today := now.Format("2006-01-02")
	activity, err := model.GetOrCreateActivity(today, h)
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("lucky bag: failed to get activity %s/%02d: %v", today, h, err))
		return
	}
	if activity.Status == "drawn" {
		return
	}

	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("lucky bag auto draw: %s %02d:00", today, h))
	if err := model.DrawLuckyBag(activity.Id); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("lucky bag draw failed (%s %02d:00): %v", today, h, err))
	} else {
		logger.LogInfo(ctx, fmt.Sprintf("lucky bag draw completed: %s %02d:00", today, h))
	}
}
