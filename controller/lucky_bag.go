package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// LuckyBagStatus 返回今日活动状态、用户是否报名、用户权重预览
func LuckyBagStatus(c *gin.Context) {
	userId := c.GetInt("id")

	activity, err := model.GetOrCreateTodayActivity()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	entry, err := model.GetUserTodayEntry(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	participantCount, _ := model.GetLuckyBagParticipantCount(activity.Id)

	entered := entry != nil
	var weight int
	if entered {
		weight = entry.Weight
	}

	common.ApiSuccess(c, gin.H{
		"activity":          activity,
		"entered":           entered,
		"weight":            weight,
		"participant_count": participantCount,
	})
}

// EnterLuckyBag 用户报名今日活动
func EnterLuckyBag(c *gin.Context) {
	userId := c.GetInt("id")
	entry, err := model.EnterLuckyBag(userId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{
		"entry": entry,
	})
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
	activity, err := model.GetOrCreateTodayActivity()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	participantCount, _ := model.GetLuckyBagParticipantCount(activity.Id)
	common.ApiSuccess(c, gin.H{
		"activity":          activity,
		"participant_count": participantCount,
	})
}

type AdminUpdateLuckyBagRequest struct {
	MinQuota int `json:"min_quota"`
	MaxQuota int `json:"max_quota"`
}

// AdminUpdateLuckyBagConfig 管理员更新今日奖品区间
func AdminUpdateLuckyBagConfig(c *gin.Context) {
	var req AdminUpdateLuckyBagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	activity, err := model.GetOrCreateTodayActivity()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateLuckyBagActivityConfig(activity.Id, req.MinQuota, req.MaxQuota); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDrawLuckyBag 管理员手动触发今日开奖
func AdminDrawLuckyBag(c *gin.Context) {
	activity, err := model.GetOrCreateTodayActivity()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DrawLuckyBag(activity.Id); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	// 重新读取更新后的 activity
	updated, _ := model.GetOrCreateTodayActivity()
	common.ApiSuccess(c, updated)
}
