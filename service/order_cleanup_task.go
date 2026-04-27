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

const (
	orderCleanupTickInterval = 10 * time.Minute // 每10分钟检查一次
	orderCleanupBatchSize    = 100              // 每次批量处理100条
	orderExpireTimeout       = 30 * time.Minute // 30分钟未支付自动取消
)

var (
	orderCleanupOnce    sync.Once
	orderCleanupRunning atomic.Bool
)

// StartOrderCleanupTask 启动订单清理定时任务
func StartOrderCleanupTask() {
	orderCleanupOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("order cleanup task started: tick=%s, timeout=%s", orderCleanupTickInterval, orderExpireTimeout))
			ticker := time.NewTicker(orderCleanupTickInterval)
			defer ticker.Stop()

			// 启动时立即执行一次
			runOrderCleanupOnce()
			for range ticker.C {
				runOrderCleanupOnce()
			}
		})
	})
}

func runOrderCleanupOnce() {
	if !orderCleanupRunning.CompareAndSwap(false, true) {
		return
	}
	defer orderCleanupRunning.Store(false)

	ctx := context.Background()
	expireTimestamp := time.Now().Add(-orderExpireTimeout).Unix()

	// 清理充值订单
	totalTopUps := 0
	for {
		n, err := model.ExpirePendingTopUps(expireTimestamp, orderCleanupBatchSize)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("topup order cleanup failed: %v", err))
			break
		}
		if n == 0 {
			break
		}
		totalTopUps += n
		if n < orderCleanupBatchSize {
			break
		}
	}

	// 清理订阅订单
	totalSubscriptions := 0
	for {
		n, err := model.ExpirePendingSubscriptionOrders(expireTimestamp, orderCleanupBatchSize)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("subscription order cleanup failed: %v", err))
			break
		}
		if n == 0 {
			break
		}
		totalSubscriptions += n
		if n < orderCleanupBatchSize {
			break
		}
	}

	if totalTopUps > 0 || totalSubscriptions > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("order cleanup completed: topup_expired=%d, subscription_expired=%d", totalTopUps, totalSubscriptions))
	}
}
