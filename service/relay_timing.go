package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

func LogRelayTiming(c *gin.Context, info *relaycommon.RelayInfo, stage string, stepStart time.Time, fields ...string) time.Time {
	if c == nil {
		return time.Now()
	}

	now := time.Now()
	totalStart := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
	if totalStart.IsZero() && info != nil && !info.StartTime.IsZero() {
		totalStart = info.StartTime
	}
	if totalStart.IsZero() {
		totalStart = stepStart
	}

	username := c.GetString("username")
	if username == "" {
		username = common.GetContextKeyString(c, constant.ContextKeyUserName)
	}
	tokenName := c.GetString("token_name")
	userID := c.GetInt("id")
	if userID == 0 && info != nil {
		userID = info.UserId
	}
	tokenID := c.GetInt("token_id")
	if tokenID == 0 && info != nil {
		tokenID = info.TokenId
	}
	channelID := common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	if channelID == 0 && info != nil {
		channelID = info.ChannelId
	}
	channelName := common.GetContextKeyString(c, constant.ContextKeyChannelName)
	modelName := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	if modelName == "" && info != nil {
		modelName = info.OriginModelName
	}
	requestID := c.GetString(common.RequestIdKey)
	if requestID == "" && info != nil {
		requestID = info.RequestId
	}

	parts := []string{
		fmt.Sprintf("stage=%s", stage),
		fmt.Sprintf("step_ms=%d", now.Sub(stepStart).Milliseconds()),
		fmt.Sprintf("total_ms=%d", now.Sub(totalStart).Milliseconds()),
		fmt.Sprintf("request_id=%q", requestID),
		fmt.Sprintf("user_id=%d", userID),
		fmt.Sprintf("username=%q", username),
		fmt.Sprintf("token_id=%d", tokenID),
		fmt.Sprintf("token_name=%q", tokenName),
		fmt.Sprintf("channel_id=%d", channelID),
		fmt.Sprintf("channel_name=%q", channelName),
		fmt.Sprintf("model=%q", modelName),
	}
	if info != nil {
		parts = append(parts,
			fmt.Sprintf("relay_format=%q", info.RelayFormat),
			fmt.Sprintf("relay_mode=%d", info.RelayMode),
			fmt.Sprintf("stream=%t", info.IsStream),
		)
	}
	if len(fields) > 0 {
		parts = append(parts, strings.Join(fields, " "))
	}

	logger.LogInfo(c, "relay_timing "+strings.Join(parts, " "))
	return now
}
