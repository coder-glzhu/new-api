package controller

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

// HupijiaoPayRequest 虎皮椒支付请求
type HupijiaoPayRequest struct {
	Amount float64 `json:"amount" binding:"required,min=0.01"`
}

// HupijiaoPayResponse 虎皮椒支付响应
type HupijiaoPayResponse struct {
	OrderId   string `json:"order_id"`
	QrcodeUrl string `json:"qrcode_url"` // PC端二维码
	PayUrl    string `json:"pay_url"`    // 手机端跳转链接
	TradeNo   string `json:"trade_no"`
}

const hupijiaoPaymentExpireSeconds int64 = 3 * 60

func resolveHupijiaoApiURL() string {
	if strings.TrimSpace(setting.HupijiaoApiUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoApiUrl)
	}
	return "https://api.xunhupay.com/payment/do.html"
}

func resolveHupijiaoNotifyURL() string {
	if strings.TrimSpace(setting.HupijiaoNotifyUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoNotifyUrl)
	}
	return strings.TrimRight(system_setting.ServerAddress, "/") + "/api/hupijiao/webhook"
}

func resolveHupijiaoReturnURL() string {
	if strings.TrimSpace(setting.HupijiaoReturnUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoReturnUrl)
	}
	return strings.TrimRight(system_setting.ServerAddress, "/") + "/console/topup?show_history=true"
}

// generateHupijiaoSignature 生成虎皮椒签名
// 参数字典序排序 + MD5(stringA + APPSECRET)
func generateHupijiaoSignature(params map[string]string, appSecret string) string {
	// 提取所有key并排序（字典序）
	keys := make([]string, 0, len(params))
	for k := range params {
		// 跳过hash参数和空值
		if k == "hash" || params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// 按 key=value 格式拼接
	var parts []string
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, params[k]))
	}
	stringA := strings.Join(parts, "&")

	// 拼接密钥并MD5
	stringSignTemp := stringA + appSecret
	return common.Md5([]byte(stringSignTemp))
}

// RequestHupijiaoPay 创建虎皮椒支付订单
func RequestHupijiaoPay(c *gin.Context) {
	if !setting.HupijiaoEnabled {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "虎皮椒支付未启用",
		})
		return
	}

	var req HupijiaoPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "参数错误: " + err.Error(),
		})
		return
	}

	// 获取用户信息
	userId := c.GetInt("id")
	username := c.GetString("username")
	userGroup := c.GetString("group")

	// 前端传的amount是用户想充值的美元数
	amount := int64(req.Amount)

	// 后端重新计算实际应支付金额（防止前端篡改）
	payMoney := getPayMoney(amount, userGroup)

	// 验证最低充值金额（以实际支付金额为准）
	if payMoney < float64(setting.HupijiaoMinTopUp) {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": fmt.Sprintf("实付金额 %.2f 元低于最低充值金额 %d 元，请增加充值数量后重试", payMoney, setting.HupijiaoMinTopUp),
		})
		return
	}

	// 生成唯一订单号
	tradeNo := fmt.Sprintf("HUPI%d%d", userId, time.Now().UnixNano()/1e6)

	// 创建待支付订单
	topUp := &model.TopUp{
		UserId:          userId,
		Amount:          amount,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodAlipay,
		PaymentProvider: model.PaymentProviderHupijiao,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}

	err := topUp.Insert()
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订单创建失败 user_id=%d err=%v", userId, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建订单失败",
		})
		return
	}

	// 调用虎皮椒API创建支付订单
	payLink, qrcodeUrl, openId, err := createHupijiaoPayment(tradeNo, payMoney, username)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒API调用失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建支付失败: " + err.Error(),
		})
		return
	}

	// 保存虎皮椒平台订单号到数据库
	if openId != "" {
		topUp.OpenOrderId = openId
		_ = topUp.Update()
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒订单创建成功 user_id=%d trade_no=%s openid=%s amount=%.2f", userId, tradeNo, openId, payMoney))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": HupijiaoPayResponse{
			OrderId:   openId,
			QrcodeUrl: qrcodeUrl,
			PayUrl:    payLink,
			TradeNo:   tradeNo,
		},
	})
}

// createHupijiaoPayment 调用虎皮椒API创建支付订单
func createHupijiaoPayment(tradeNo string, amount float64, username string) (payUrl, qrcodeUrl, openId string, err error) {
	// 构建请求参数
	nonceStr := fmt.Sprintf("%d", time.Now().UnixNano())
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)

	params := map[string]string{
		"version":        "1.1",
		"appid":          setting.HupijiaoAppId,
		"trade_order_id": tradeNo,
		"total_fee":      fmt.Sprintf("%.2f", amount),
		"title":          fmt.Sprintf("充值 - %s", username),
		"time":           timestamp,
		"notify_url":     resolveHupijiaoNotifyURL(),
		"return_url":     resolveHupijiaoReturnURL(),
		"nonce_str":      nonceStr,
	}

	// 生成签名
	signature := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	params["hash"] = signature

	// 序列化为JSON
	jsonData, err := common.Marshal(params)
	if err != nil {
		return "", "", "", fmt.Errorf("序列化参数失败: %w", err)
	}

	// 发送POST请求
	client := service.GetHttpClient()
	req, err := http.NewRequest("POST", resolveHupijiaoApiURL(), bytes.NewReader(jsonData))
	if err != nil {
		return "", "", "", fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", "", fmt.Errorf("读取响应失败: %w", err)
	}

	// 解析响应
	var result map[string]interface{}
	err = common.Unmarshal(body, &result)
	if err != nil {
		return "", "", "", fmt.Errorf("解析响应失败: %w, body=%s", err, string(body))
	}

	// 检查错误码
	errcode := 0
	if ec, ok := result["errcode"].(float64); ok {
		errcode = int(ec)
	}

	if errcode != 0 {
		errmsg := "未知错误"
		if em, ok := result["errmsg"].(string); ok {
			errmsg = em
		}
		return "", "", "", fmt.Errorf("虎皮椒API错误[%d]: %s", errcode, errmsg)
	}

	// 提取支付信息
	if url, ok := result["url"].(string); ok {
		payUrl = url
	}
	if qrcode, ok := result["url_qrcode"].(string); ok {
		qrcodeUrl = qrcode
	}
	// openid 可能是数字或字符串
	if oid, ok := result["openid"].(string); ok {
		openId = oid
	} else if oid, ok := result["openid"].(float64); ok {
		openId = fmt.Sprintf("%.0f", oid)
	}

	if payUrl == "" && qrcodeUrl == "" {
		return "", "", "", fmt.Errorf("虎皮椒API返回数据不完整")
	}

	return payUrl, qrcodeUrl, openId, nil
}

// hupijiaoOrderLocks 订单锁，防止并发处理同一订单
var hupijiaoOrderLocks sync.Map

// HupijiaoWebhook 虎皮椒支付回调处理
func HupijiaoWebhook(c *gin.Context) {
	// 解析回调参数（Form表单）
	err := c.Request.ParseForm()
	if err != nil {
		logger.LogError(c.Request.Context(), "虎皮椒回调解析表单失败: "+err.Error())
		c.String(http.StatusBadRequest, "fail")
		return
	}

	params := make(map[string]string)
	for k, v := range c.Request.PostForm {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}

	// 提取关键参数
	tradeNo := params["trade_order_id"]
	totalFeeStr := params["total_fee"]
	status := params["status"]
	hash := params["hash"]

	if tradeNo == "" || totalFeeStr == "" {
		logger.LogError(c.Request.Context(), "虎皮椒回调参数缺失")
		c.String(http.StatusBadRequest, "fail")
		return
	}

	// 验证签名
	expectedHash := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	if hash != expectedHash {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒回调签名验证失败 trade_no=%s expected=%s got=%s", tradeNo, expectedHash, hash))
		c.String(http.StatusForbidden, "fail")
		return
	}

	// 验证支付状态
	if status != "OD" { // OD = 已支付
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒回调状态异常 trade_no=%s status=%s", tradeNo, status))
		c.String(http.StatusOK, "success") // 仍返回success防止重试
		return
	}

	// 解析金额
	totalFee, err := strconv.ParseFloat(totalFeeStr, 64)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒回调金额格式错误 trade_no=%s amount=%s", tradeNo, totalFeeStr))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	// 订单锁防止并发
	lockKey := "hupijiao:" + tradeNo
	if _, loaded := hupijiaoOrderLocks.LoadOrStore(lockKey, true); loaded {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒订单处理中 trade_no=%s", tradeNo))
		c.String(http.StatusOK, "success")
		return
	}
	defer hupijiaoOrderLocks.Delete(lockKey)

	payloadBytes, _ := common.Marshal(params)
	err = completeHupijiaoPaidOrder(tradeNo, totalFee, string(payloadBytes))
	if err != nil {
		if errors.Is(err, model.ErrTopUpStatusInvalid) {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒支付回调订单已过期 trade_no=%s", tradeNo))
			c.String(http.StatusOK, "success")
			return
		}
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒充值处理失败 trade_no=%s err=%v", tradeNo, err))
		c.String(http.StatusInternalServerError, "fail")
		return
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒充值成功 trade_no=%s amount=%.2f", tradeNo, totalFee))
	c.String(http.StatusOK, "success")
}

func completeHupijiaoPaidOrder(tradeNo string, amount float64, providerPayload string) error {
	if topUp := model.GetTopUpByTradeNo(tradeNo); expireTopUpOrderIfTimedOut(topUp) {
		return model.ErrTopUpStatusInvalid
	}
	if order := model.GetSubscriptionOrderByTradeNo(tradeNo); order != nil {
		return model.CompleteHupijiaoSubscriptionOrder(tradeNo, amount, providerPayload)
	}
	return model.RechargeByHupijiao(tradeNo, amount)
}

func expireTopUpOrderIfTimedOut(topUp *model.TopUp) bool {
	if topUp == nil || topUp.Status != common.TopUpStatusPending {
		return false
	}
	if topUp.CreateTime+hupijiaoPaymentExpireSeconds > common.GetTimestamp() {
		return false
	}
	if err := model.UpdatePendingTopUpStatus(topUp.TradeNo, topUp.PaymentProvider, common.TopUpStatusExpired); err != nil {
		common.SysError(fmt.Sprintf("expire pending topup order failed trade_no=%s err=%v", topUp.TradeNo, err))
		return false
	}
	if model.GetSubscriptionOrderByTradeNo(topUp.TradeNo) != nil {
		if err := model.ExpireSubscriptionOrder(topUp.TradeNo, topUp.PaymentProvider); err != nil {
			common.SysError(fmt.Sprintf("expire pending subscription order failed trade_no=%s err=%v", topUp.TradeNo, err))
		}
	}
	topUp.Status = common.TopUpStatusExpired
	topUp.CompleteTime = common.GetTimestamp()
	return true
}

// RequestHupijiaoAmount 获取虎皮椒支付金额（应用折扣）
func RequestHupijiaoAmount(c *gin.Context) {
	var req struct {
		Amount int64 `json:"amount" binding:"required,min=1"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	userGroup := c.GetString("group")
	payMoney := getPayMoney(req.Amount, userGroup)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"amount": payMoney,
			"money":  req.Amount,
		},
	})
}

// CancelTopUpOrder 取消待支付订单
func CancelTopUpOrder(c *gin.Context) {
	userId := c.GetInt("id")
	tradeNo := c.Param("trade_no")

	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	// 查询订单
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 验证订单所属
	if topUp.UserId != userId {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权操作此订单",
		})
		return
	}

	// 只能取消待支付订单
	if topUp.Status != common.TopUpStatusPending {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "只能取消待支付订单",
		})
		return
	}

	err := model.UpdatePendingTopUpStatus(tradeNo, topUp.PaymentProvider, common.TopUpStatusCanceled)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("取消订单失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "取消订单失败",
		})
		return
	}
	if model.GetSubscriptionOrderByTradeNo(tradeNo) != nil {
		if err := model.CancelSubscriptionOrder(tradeNo, topUp.PaymentProvider); err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("取消订阅订单失败 trade_no=%s err=%v", tradeNo, err))
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": "取消订单失败",
			})
			return
		}
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("用户取消订单 user_id=%d trade_no=%s", userId, tradeNo))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "订单已取消",
	})
}

type hupijiaoOrderStatusResult struct {
	Paid        bool
	Amount      float64
	TradeNo     string
	OpenOrderId string
}

// queryHupijiaoOrderStatus 调用虎皮椒API查询订单状态
// 注意：必须使用 openid (虎皮椒返回的订单ID) 而不是 trade_order_id
func queryHupijiaoOrderStatus(openid string) (*hupijiaoOrderStatusResult, error) {
	// 构建查询参数
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceStr := fmt.Sprintf("%d", time.Now().UnixNano())

	params := map[string]string{
		"appid":         setting.HupijiaoAppId,
		"open_order_id": openid,
		"time":          timestamp,
		"nonce_str":     nonceStr,
	}

	// 生成签名
	signature := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	params["hash"] = signature

	// 序列化为JSON
	jsonData, err := common.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("序列化参数失败: %w", err)
	}

	// 发送POST请求到查询接口
	queryUrl := "https://api.xunhupay.com/payment/query.html"
	client := service.GetHttpClient()
	req, err := http.NewRequest("POST", queryUrl, bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 解析响应
	var result map[string]interface{}
	err = common.Unmarshal(body, &result)
	if err != nil {
		return nil, fmt.Errorf("解析响应失败: %w, body=%s", err, string(body))
	}

	common.SysLog(fmt.Sprintf("虎皮椒查询API响应 openid=%s body=%s", openid, string(body)))

	// 检查错误码
	errcode := 0
	if ec, ok := result["errcode"].(float64); ok {
		errcode = int(ec)
	}

	if errcode != 0 {
		errmsg := "未知错误"
		if em, ok := result["errmsg"].(string); ok {
			errmsg = em
		}
		return nil, fmt.Errorf("虎皮椒查询API错误[%d]: %s", errcode, errmsg)
	}

	// 响应数据在 data 字段中
	dataObj, _ := result["data"].(map[string]interface{})
	if dataObj == nil {
		return nil, fmt.Errorf("虎皮椒查询API返回数据为空")
	}

	// 提取订单状态和金额
	status := ""
	if s, ok := dataObj["status"].(string); ok {
		status = s
	}
	tradeNo := ""
	if v, ok := dataObj["trade_order_id"].(string); ok {
		tradeNo = v
	}
	openOrderId := ""
	if v, ok := dataObj["open_order_id"].(string); ok {
		openOrderId = v
	}

	totalFee := 0.0
	if tf, ok := dataObj["total_amount"].(string); ok {
		totalFee, _ = strconv.ParseFloat(tf, 64)
	} else if tf, ok := dataObj["total_amount"].(float64); ok {
		totalFee = tf
	} else if tf, ok := dataObj["total_fee"].(string); ok {
		totalFee, _ = strconv.ParseFloat(tf, 64)
	} else if tf, ok := dataObj["total_fee"].(float64); ok {
		totalFee = tf
	}

	// OD = 已支付
	isPaid := (status == "OD")
	return &hupijiaoOrderStatusResult{
		Paid:        isPaid,
		Amount:      totalFee,
		TradeNo:     tradeNo,
		OpenOrderId: openOrderId,
	}, nil
}

// GetTopUpOrderStatus 查询订单状态（主动查询虎皮椒平台）
func GetTopUpOrderStatus(c *gin.Context) {
	userId := c.GetInt("id")
	tradeNo := c.Param("trade_no")

	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	// 查询本地订单
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 验证订单所属
	if topUp.UserId != userId {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权查看此订单",
		})
		return
	}

	if expireTopUpOrderIfTimedOut(topUp) {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单已过期",
			"data": gin.H{
				"status": common.TopUpStatusExpired,
				"paid":   false,
			},
		})
		return
	}

	if queryOpenId := c.Query("openid"); queryOpenId != "" && queryOpenId != topUp.OpenOrderId {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不匹配",
		})
		return
	}
	if topUp.OpenOrderId == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单尚未支付，请完成支付后再试",
			"data": gin.H{
				"status": topUp.Status,
				"paid":   false,
			},
		})
		return
	}
	openid := topUp.OpenOrderId

	// 如果订单已经完成，直接返回
	if topUp.Status == common.TopUpStatusSuccess {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单已支付",
			"data": gin.H{
				"status": "success",
				"paid":   true,
			},
		})
		return
	}

	// 如果订单不是待支付状态，返回当前状态
	if topUp.Status != common.TopUpStatusPending {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单未支付",
			"data": gin.H{
				"status": topUp.Status,
				"paid":   false,
			},
		})
		return
	}

	// 只对虎皮椒订单查询支付平台
	if topUp.PaymentProvider != model.PaymentProviderHupijiao {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "该订单不支持查询",
		})
		return
	}

	// 调用虎皮椒API查询订单状态（使用openid）
	orderStatus, err := queryHupijiaoOrderStatus(openid)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("查询虎皮椒订单失败 trade_no=%s openid=%s err=%v", tradeNo, openid, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "查询订单失败: " + err.Error(),
		})
		return
	}
	if orderStatus.TradeNo != "" && orderStatus.TradeNo != tradeNo {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒查询订单号不匹配 trade_no=%s response_trade_no=%s openid=%s", tradeNo, orderStatus.TradeNo, openid))
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不匹配",
		})
		return
	}
	if orderStatus.OpenOrderId != "" && orderStatus.OpenOrderId != openid {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒查询平台订单号不匹配 trade_no=%s openid=%s response_openid=%s", tradeNo, openid, orderStatus.OpenOrderId))
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不匹配",
		})
		return
	}

	if !orderStatus.Paid {
		// 未支付
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单尚未支付，请完成支付后再试",
			"data": gin.H{
				"paid": false,
			},
		})
		return
	}

	// 验证金额（允许0.01元误差）
	if orderStatus.Amount < topUp.Money-0.01 {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("支付金额不匹配 trade_no=%s expected=%.2f actual=%.2f", tradeNo, topUp.Money, orderStatus.Amount))
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("支付金额不正确，应付%.2f元，实付%.2f元", topUp.Money, orderStatus.Amount),
			"data": gin.H{
				"paid": true,
			},
		})
		return
	}

	payloadBytes, _ := common.Marshal(map[string]string{
		"source":        "poll",
		"open_order_id": openid,
	})
	err = completeHupijiaoPaidOrder(tradeNo, orderStatus.Amount, string(payloadBytes))
	if err != nil {
		// 可能是订单已处理或其他错误
		if err == model.ErrTopUpStatusInvalid {
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"message": "订单已处理",
				"data": gin.H{
					"status": "success",
					"paid":   true,
				},
			})
			return
		}

		logger.LogError(c.Request.Context(), fmt.Sprintf("处理充值失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "处理充值失败",
		})
		return
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("主动查询支付成功 user_id=%d trade_no=%s amount=%.2f", userId, tradeNo, orderStatus.Amount))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "支付成功！配额已到账",
		"data": gin.H{
			"status": "success",
			"paid":   true,
		},
	})
}

// RepayTopUpOrder 重新支付订单（创建新的支付链接）
func RepayTopUpOrder(c *gin.Context) {
	userId := c.GetInt("id")
	username := c.GetString("username")
	tradeNo := c.Param("trade_no")

	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	// 查询订单
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 验证订单所属
	if topUp.UserId != userId {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权操作此订单",
		})
		return
	}

	if expireTopUpOrderIfTimedOut(topUp) {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单已过期，请重新下单",
		})
		return
	}

	// 只能重新支付待支付订单
	if topUp.Status != common.TopUpStatusPending {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "只能重新支付待支付订单",
		})
		return
	}

	// 检查订单是否是虎皮椒支付
	if topUp.PaymentProvider != model.PaymentProviderHupijiao {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "该订单不支持重新支付",
		})
		return
	}

	// 如果已有 openid，先查询虎皮椒平台确认是否已支付
	if topUp.OpenOrderId != "" {
		orderStatus, queryErr := queryHupijiaoOrderStatus(topUp.OpenOrderId)
		if queryErr == nil &&
			orderStatus.Paid &&
			(orderStatus.TradeNo == "" || orderStatus.TradeNo == tradeNo) &&
			(orderStatus.OpenOrderId == "" || orderStatus.OpenOrderId == topUp.OpenOrderId) {
			payloadBytes, _ := common.Marshal(map[string]string{
				"source":        "repay",
				"open_order_id": topUp.OpenOrderId,
			})
			rechargeErr := completeHupijiaoPaidOrder(tradeNo, orderStatus.Amount, string(payloadBytes))
			if rechargeErr != nil && rechargeErr != model.ErrTopUpStatusInvalid {
				logger.LogError(c.Request.Context(), fmt.Sprintf("重新支付时处理充值失败 trade_no=%s err=%v", tradeNo, rechargeErr))
			}
			logger.LogInfo(c.Request.Context(), fmt.Sprintf("重新支付时发现已支付 user_id=%d trade_no=%s amount=%.2f", userId, tradeNo, orderStatus.Amount))
			c.JSON(http.StatusOK, gin.H{
				"success": true,
				"message": "订单已支付成功！配额已到账",
				"data": gin.H{
					"paid": true,
				},
			})
			return
		}
	}

	// 调用虎皮椒API创建新的支付链接
	payLink, qrcodeUrl, openId, err := createHupijiaoPayment(tradeNo, topUp.Money, username)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("重新支付失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建支付失败: " + err.Error(),
		})
		return
	}

	// 更新虎皮椒平台订单号
	if openId != "" {
		topUp.OpenOrderId = openId
		_ = topUp.Update()
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("重新支付订单 user_id=%d trade_no=%s openid=%s", userId, tradeNo, openId))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": HupijiaoPayResponse{
			OrderId:   openId,
			QrcodeUrl: qrcodeUrl,
			PayUrl:    payLink,
			TradeNo:   tradeNo,
		},
	})
}
