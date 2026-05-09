package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// LuckyBagStatus 返回今日三场活动、下一场状态、用户是否报名、权重预览、是否中奖
func LuckyBagStatus(c *gin.Context) {
	userId := c.GetInt("id")

	todayActivities, err := model.GetTodayActivities()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 隐藏 winner_code：非本人中奖的场次不暴露兑换码
	for i := range todayActivities {
		if todayActivities[i].WinnerUserId != userId {
			todayActivities[i].WinnerCode = ""
		}
	}

	entry, nextActivity, err := model.GetUserNextEntry(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

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

	common.ApiSuccess(c, gin.H{
		"today_activities":  todayActivities,
		"next_activity":     nextActivity,
		"entered":           entered,
		"weight":            weight,
		"participant_count": participantCount,
		"result_cards":      resultCards,
	})
}

// EnterLuckyBag 用户报名下一场活动
func EnterLuckyBag(c *gin.Context) {
	userId := c.GetInt("id")
	entry, err := model.EnterLuckyBag(userId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
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
	// 发送开奖结果通知
	var activity model.LuckyBagActivity
	if err := model.DB.First(&activity, req.ActivityId).Error; err == nil &&
		activity.Status == "drawn" && activity.WinnerName != "" {
		go func() {
			_ = service.SendWechatDrawResult(
				activity.WinnerName, activity.WinnerQuota,
				activity.DrawDate, activity.SlotHour,
			)
		}()
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
