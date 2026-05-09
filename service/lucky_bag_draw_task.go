package service

import (
	"context"
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

// StartLuckyBagDrawTask 启动每天12:00自动开奖的定时检查任务（仅主节点）
func StartLuckyBagDrawTask() {
	luckyBagDrawOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), "lucky bag draw task started")
			ticker := time.NewTicker(1 * time.Minute)
			defer ticker.Stop()
			// 启动时立即检查一次（应对服务重启的情况）
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
	// 仅在12:00 ~ 12:01 之间触发，避免重复
	if now.Hour() != 12 || now.Minute() > 1 {
		return
	}

	activity, err := model.GetOrCreateTodayActivity()
	if err != nil || activity.Status == "drawn" {
		return
	}

	ctx := context.Background()
	logger.LogInfo(ctx, "lucky bag auto draw triggered for date: "+activity.DrawDate)
	if err := model.DrawLuckyBag(activity.Id); err != nil {
		logger.LogWarn(ctx, "lucky bag draw failed: "+err.Error())
	} else {
		logger.LogInfo(ctx, "lucky bag draw completed for date: "+activity.DrawDate)
	}
}
