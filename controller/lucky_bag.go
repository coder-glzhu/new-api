package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// LuckyBagStatus 返回今日三场活动、下一场状态、用户是否报名、权重预览
func LuckyBagStatus(c *gin.Context) {
	userId := c.GetInt("id")

	todayActivities, err := model.GetTodayActivities()
	if err != nil {
		common.ApiError(c, err)
		return
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

	common.ApiSuccess(c, gin.H{
		"today_activities":  todayActivities,
		"next_activity":     nextActivity,
		"entered":           entered,
		"weight":            weight,
		"participant_count": participantCount,
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

// LuckyBagHistory 获取历史开奖记录（分页）
func LuckyBagHistory(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "10"))
	if size > 50 {
		size = 50
	}

	activities, total, err := model.GetLuckyBagHistory(page, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"activities": activities,
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
	common.ApiSuccess(c, nil)
}
