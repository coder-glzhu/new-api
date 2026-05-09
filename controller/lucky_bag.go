package controller

import (
	"context"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// maskLockedActivity 把 locked 状态的活动对外伪装成 pending，隐藏已预计算但未到开奖时刻的 winner 字段
func maskLockedActivity(a *model.LuckyBagActivity) {
	if a == nil || a.Status != model.LuckyBagStatusLocked {
		return
	}
	a.Status = model.LuckyBagStatusPending
	a.WinnerUserId = 0
	a.WinnerName = ""
	a.WinnerQuota = 0
	a.WinnerCode = ""
	a.DrawnAt = 0
}

// LuckyBagStatus 返回今日三场活动、下一场状态、用户是否报名、权重预览、是否中奖
func LuckyBagStatus(c *gin.Context) {
	userId := c.GetInt("id")
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] LuckyBagStatus request userId=%d", userId))

	todayActivities, err := model.GetTodayActivities()
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] LuckyBagStatus userId=%d: GetTodayActivities failed: %v", userId, err))
		common.ApiError(c, err)
		return
	}
	for i := range todayActivities {
		maskLockedActivity(todayActivities[i])
		// 非本人中奖的场次不暴露兑换码
		if todayActivities[i].WinnerUserId != userId {
			todayActivities[i].WinnerCode = ""
		}
	}

	entry, nextActivity, err := model.GetUserNextEntry(userId)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] LuckyBagStatus userId=%d: GetUserNextEntry failed: %v", userId, err))
		common.ApiError(c, err)
		return
	}
	maskLockedActivity(nextActivity)

	entered := entry != nil
	var weight int
	if entered {
		weight = entry.Weight
	}

	var participantCount int64
	if nextActivity != nil {
		participantCount, _ = model.GetLuckyBagParticipantCount(nextActivity.Id)
	}

	// 构建最近2天内用户参与过且已开奖的结果卡片（覆盖跨天场景）
	type ResultCard struct {
		Activity     *model.LuckyBagActivity `json:"activity"`
		IsWinner     bool                    `json:"is_winner"`
		WinnerViewed bool                    `json:"winner_viewed"`
	}
	var resultCards []ResultCard
	recentResults, _ := model.GetRecentDrawnResultsForUser(userId)
	for i := range recentResults {
		r := &recentResults[i]
		// 非本人中奖不暴露兑换码
		if !r.IsWinner {
			r.Activity.WinnerCode = ""
		}
		resultCards = append(resultCards, ResultCard{
			Activity:     &r.Activity,
			IsWinner:     r.IsWinner,
			WinnerViewed: r.WinnerViewed,
		})
	}

	// 判断今日抽奖是否全部结束：所有 today_activities 都已 drawn
	todayFinished := len(todayActivities) > 0
	for _, a := range todayActivities {
		if a.Status != model.LuckyBagStatusDrawn {
			todayFinished = false
			break
		}
	}

	nextId := 0
	nextSlot := ""
	nextStatus := ""
	if nextActivity != nil {
		nextId = nextActivity.Id
		nextSlot = fmt.Sprintf("%02d:%02d", nextActivity.SlotHour, nextActivity.SlotMinute)
		nextStatus = nextActivity.Status
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] LuckyBagStatus userId=%d: entered=%v weight=%d participants=%d nextActivityId=%d slot=%s status=%s resultCards=%d todayFinished=%v",
		userId, entered, weight, participantCount, nextId, nextSlot, nextStatus, len(resultCards), todayFinished))

	common.ApiSuccess(c, gin.H{
		"today_activities":  todayActivities,
		"next_activity":     nextActivity,
		"entered":           entered,
		"weight":            weight,
		"participant_count": participantCount,
		"result_cards":      resultCards,
		"draw_slots":        model.GetDrawSlots(),
		"today_finished":    todayFinished,
	})
}

// EnterLuckyBag 用户报名下一场活动
func EnterLuckyBag(c *gin.Context) {
	userId := c.GetInt("id")
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag API called userId=%d", userId))
	entry, err := model.EnterLuckyBag(userId)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d failed: %v", userId, err))
		common.ApiErrorMsg(c, err.Error())
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d success entryId=%d activityId=%d weight=%d", userId, entry.Id, entry.ActivityId, entry.Weight))
	common.ApiSuccess(c, gin.H{"entry": entry})
}

// MarkLuckyBagViewed 标记用户已查看某场次的中奖弹窗
func MarkLuckyBagViewed(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		ActivityId int `json:"activity_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.ActivityId == 0 {
		common.ApiErrorMsg(c, "invalid activity_id")
		return
	}
	if err := model.MarkWinnerViewed(userId, req.ActivityId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// LuckyBagHistory 获取历史开奖记录（分页），当前用户的中奖记录附带兑换码状态
func LuckyBagHistory(c *gin.Context) {
	userId := c.GetInt("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "10"))
	if size > 50 {
		size = 50
	}

	items, total, err := model.GetLuckyBagHistory(page, size, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 隐藏 winner_code：非本人中奖的记录不暴露兑换码
	for i := range items {
		if items[i].WinnerUserId != userId {
			items[i].WinnerCode = ""
		}
	}
	common.ApiSuccess(c, gin.H{
		"activities": items,
		"total":      total,
		"page":       page,
		"size":       size,
	})
}

// AdminGetLuckyBagConfig 管理员查看今日活动配置
func AdminGetLuckyBagConfig(c *gin.Context) {
	todayActivities, err := model.GetTodayActivities()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"today_activities": todayActivities})
}

type AdminUpdateLuckyBagRequest struct {
	ActivityId int `json:"activity_id"`
	MinQuota   int `json:"min_quota"`
	MaxQuota   int `json:"max_quota"`
}

// AdminUpdateLuckyBagConfig 管理员更新指定场次奖品区间
func AdminUpdateLuckyBagConfig(c *gin.Context) {
	var req AdminUpdateLuckyBagRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ActivityId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.UpdateLuckyBagActivityConfig(req.ActivityId, req.MinQuota, req.MaxQuota); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminDrawRequest struct {
	ActivityId int `json:"activity_id"`
}

// AdminDrawLuckyBag 管理员手动触发指定场次开奖
func AdminDrawLuckyBag(c *gin.Context) {
	var req AdminDrawRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ActivityId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.DrawLuckyBag(req.ActivityId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	// 发送开奖结果通知（通过 dispatch 原子领通知权；失败会在后台任务的补发分支里继续重试）
	var activity model.LuckyBagActivity
	if err := model.DB.First(&activity, req.ActivityId).Error; err == nil &&
		activity.Status == model.LuckyBagStatusDrawn {
		go service.DispatchLuckyBagNotify(&activity)
	}
	common.ApiSuccess(c, nil)
}

type AdminSendWechatTestRequest struct {
	Message string `json:"message"`
}

// AdminSendWechatTest 管理员测试发送微信群消息
func AdminSendWechatTest(c *gin.Context) {
	var req AdminSendWechatTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg := req.Message
	if msg == "" {
		msg = "🧧 这是一条福袋抽奖提醒测试消息，请忽略。"
	}
	if err := service.SendWechatGroupMessage(msg); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}
