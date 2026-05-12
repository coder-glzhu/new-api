package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

// DrawSlot 开奖时刻（小时 + 分钟）
type DrawSlot struct {
	Hour   int `json:"hour"`
	Minute int `json:"minute"`
}

// Key 唯一键，便于去重/比较
func (s DrawSlot) Key() int { return s.Hour*60 + s.Minute }

// defaultDrawSlots 默认开奖时刻（管理员可通过 OptionMap["LuckyBagDrawHours"] 覆盖）
var defaultDrawSlots = []DrawSlot{{9, 0}, {12, 0}, {17, 0}}

// parseSingleSlot 解析单个时刻，如 "9"、"09"、"17:52"、" 8:05 "
func parseSingleSlot(raw string) (DrawSlot, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DrawSlot{}, false
	}
	hPart, mPart := raw, "0"
	if i := strings.Index(raw, ":"); i >= 0 {
		hPart = strings.TrimSpace(raw[:i])
		mPart = strings.TrimSpace(raw[i+1:])
	}
	h, err := strconv.Atoi(hPart)
	if err != nil || h < 0 || h > 23 {
		return DrawSlot{}, false
	}
	m, err := strconv.Atoi(mPart)
	if err != nil || m < 0 || m > 59 {
		return DrawSlot{}, false
	}
	return DrawSlot{Hour: h, Minute: m}, true
}

// GetDrawSlots 返回当前配置的开奖时刻列表（升序去重，过滤非法值）
// 读取 OptionMap["LuckyBagDrawHours"]，格式为逗号分隔的 "H" 或 "H:MM"
// 例如 "9,12,17:52" 表示 09:00, 12:00, 17:52
func GetDrawSlots() []DrawSlot {
	raw := ""
	if common.OptionMap != nil {
		common.OptionMapRWMutex.RLock()
		raw = common.OptionMap["LuckyBagDrawHours"]
		common.OptionMapRWMutex.RUnlock()
	}
	if raw == "" {
		out := make([]DrawSlot, len(defaultDrawSlots))
		copy(out, defaultDrawSlots)
		return out
	}
	seen := make(map[int]struct{}, 8)
	result := make([]DrawSlot, 0, 8)
	for _, part := range strings.Split(raw, ",") {
		slot, ok := parseSingleSlot(part)
		if !ok {
			continue
		}
		if _, dup := seen[slot.Key()]; dup {
			continue
		}
		seen[slot.Key()] = struct{}{}
		result = append(result, slot)
	}
	if len(result) == 0 {
		out := make([]DrawSlot, len(defaultDrawSlots))
		copy(out, defaultDrawSlots)
		return out
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Key() < result[j].Key()
	})
	return result
}

// 活动状态
const (
	LuckyBagStatusPending = "pending" // 未开奖，可报名
	LuckyBagStatusLocked  = "locked"  // 预开奖完成：winner/redemption 已写入 DB，但对外仍表现为 pending；不可再报名
	LuckyBagStatusDrawn   = "drawn"   // 正式开奖，结果对外可见
)

// LuckyBagActivity 每天每场一条活动记录（三名获奖者）
type LuckyBagActivity struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	DrawDate         string `json:"draw_date" gorm:"type:varchar(10);uniqueIndex:idx_lucky_bag_date_slot_v2"`     // YYYY-MM-DD
	SlotHour         int    `json:"slot_hour" gorm:"not null;uniqueIndex:idx_lucky_bag_date_slot_v2"`             // 0~23
	SlotMinute       int    `json:"slot_minute" gorm:"not null;default:0;uniqueIndex:idx_lucky_bag_date_slot_v2"` // 0~59
	MinQuota         int    `json:"min_quota" gorm:"not null;default:500000"`                                     // 默认 $1
	MaxQuota         int    `json:"max_quota" gorm:"not null;default:5000000"`                                    // 默认 $10
	Status           string `json:"status" gorm:"type:varchar(20);default:'pending'"`                             // pending / locked / drawn
	// 第1名（奖金最高）
	WinnerUserId  int    `json:"winner_user_id" gorm:"default:0"`
	WinnerName    string `json:"winner_name" gorm:"type:varchar(100)"`
	WinnerQuota   int    `json:"winner_quota" gorm:"default:0"`
	WinnerCode    string `json:"winner_code" gorm:"type:varchar(64)"`
	// 第2名
	Winner2UserId int    `json:"winner2_user_id" gorm:"default:0"`
	Winner2Name   string `json:"winner2_name" gorm:"type:varchar(100)"`
	Winner2Quota  int    `json:"winner2_quota" gorm:"default:0"`
	Winner2Code   string `json:"winner2_code" gorm:"type:varchar(64)"`
	// 第3名（奖金最低）
	Winner3UserId int    `json:"winner3_user_id" gorm:"default:0"`
	Winner3Name   string `json:"winner3_name" gorm:"type:varchar(100)"`
	Winner3Quota  int    `json:"winner3_quota" gorm:"default:0"`
	Winner3Code   string `json:"winner3_code" gorm:"type:varchar(64)"`

	DrawnAt          int64 `json:"drawn_at" gorm:"bigint;default:0"`
	ReminderNotified int   `json:"-" gorm:"not null;default:0"` // 1=开奖前提醒已发送
	ResultNotified   int   `json:"-" gorm:"not null;default:0"` // 1=微信群通知已发送
	CreatedAt        int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// LuckyBagEntry 用户报名记录，每人每场只能报名一次
type LuckyBagEntry struct {
	Id           int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ActivityId   int   `json:"activity_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	UserId       int   `json:"user_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	Weight       int   `json:"weight" gorm:"not null;default:1"`
	WinnerViewed int   `json:"winner_viewed" gorm:"not null;default:0"` // 1=用户已查看中奖弹窗
	CreatedAt    int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// nextDrawSlot 返回"下一场"的 (date, slot)
// 定义：今日尚未到开奖时刻（nowKey < slotKey）的第一场；若全部已到点/过点，返回明天第一场。
//
// 注意：这里不能用 `nowKey >= slotKey - 1` 跳过预开奖场次，否则开奖前 1 分钟内
// 前端刷新会看到"下一场 = 明天 09:00"，参与人数变 0、按钮又能点击，彻底混乱。
// 预开奖状态应由 GetNextActivity 读取 DB status 后判断（locked 场次仍返回自己）。
func nextDrawSlot() (date string, slot DrawSlot) {
	now := time.Now()
	today := now.Format("2006-01-02")
	nowKey := now.Hour()*60 + now.Minute()
	slots := GetDrawSlots()
	for _, s := range slots {
		if nowKey < s.Key() {
			return today, s
		}
	}
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	return tomorrow, slots[0]
}

// GetDefaultPrizeRange 返回管理员配置的默认奖金区间（单位：quota，500000=$1）
// 优先读 OptionMap["LuckyBagMinUsd"] / ["LuckyBagMaxUsd"]（单位 USD，浮点数）；
// 配置缺失或非法时回落到 $1 ~ $10
func GetDefaultPrizeRange() (minQ, maxQ int) {
	minQ, maxQ = 500000, 5000000 // $1 ~ $10 兜底
	if common.OptionMap == nil {
		return
	}
	common.OptionMapRWMutex.RLock()
	minRaw := common.OptionMap["LuckyBagMinUsd"]
	maxRaw := common.OptionMap["LuckyBagMaxUsd"]
	common.OptionMapRWMutex.RUnlock()

	if v, err := strconv.ParseFloat(strings.TrimSpace(minRaw), 64); err == nil && v > 0 {
		minQ = int(v * 500000)
	}
	if v, err := strconv.ParseFloat(strings.TrimSpace(maxRaw), 64); err == nil && v > 0 {
		maxQ = int(v * 500000)
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	return
}

// GetOrCreateActivity 获取指定日期+时段的活动，不存在则创建
func GetOrCreateActivity(date string, slot DrawSlot) (*LuckyBagActivity, error) {
	var activity LuckyBagActivity
	err := DB.Where("draw_date = ? AND slot_hour = ? AND slot_minute = ?", date, slot.Hour, slot.Minute).First(&activity).Error
	if err == nil {
		return &activity, nil
	}
	minQ, maxQ := GetDefaultPrizeRange()
	activity = LuckyBagActivity{
		DrawDate:   date,
		SlotHour:   slot.Hour,
		SlotMinute: slot.Minute,
		MinQuota:   minQ,
		MaxQuota:   maxQ,
		Status:     "pending",
		CreatedAt:  time.Now().Unix(),
	}
	if err := DB.Create(&activity).Error; err != nil {
		if err2 := DB.Where("draw_date = ? AND slot_hour = ? AND slot_minute = ?", date, slot.Hour, slot.Minute).First(&activity).Error; err2 != nil {
			return nil, err
		}
	}
	return &activity, nil
}

// GetNextActivity 获取/创建下一场活动
func GetNextActivity() (*LuckyBagActivity, error) {
	date, slot := nextDrawSlot()
	return GetOrCreateActivity(date, slot)
}

// GetTodayActivities 获取今日全部场次（按时段顺序）
func GetTodayActivities() ([]*LuckyBagActivity, error) {
	today := time.Now().Format("2006-01-02")
	slots := GetDrawSlots()
	result := make([]*LuckyBagActivity, 0, len(slots))
	for _, s := range slots {
		a, err := GetOrCreateActivity(today, s)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, nil
}

// 抽奖权重参数
const (
	luckyBagTicketFloor    = 10  // 每人基础票数
	luckyBagTicketMeritCap = 40  // 活跃度加成上限
	luckyBagMeritBonus     = 5.0 // log₂ 系数

	luckyBagVIPMultiplier     = 1.5 // VIP 用户权重倍率
	luckyBagRecentWinLookback = 5   // 连中惩罚回溯场次
	luckyBagWinPenaltyStep    = 0.5 // 每次近期中奖权重折半
)

// calcUserScore 汇总用户活跃度得分
// 优先级：累计消耗 > 充值总额 > 累计参与福袋 > 近7天消耗 > 邀请注册 > 累计签到
func calcUserScore(userId int) float64 {
	now := time.Now()
	weekAgoTs := now.AddDate(0, 0, -7).Unix()

	type sumRow struct{ Total int64 }

	// 1. 累计消耗 token（all-time，type=2 为 relay 消费）
	var totalQuotaRow sumRow
	DB.Model(&Log{}).
		Select("COALESCE(SUM(quota), 0) AS total").
		Where("user_id = ? AND type = 2", userId).
		Scan(&totalQuotaRow)

	// 2. 充值总额（top_ups success + subscription_orders success，单位 money 元）
	var topUpRow sumRow
	DB.Model(&TopUp{}).
		Select("COALESCE(SUM(amount), 0) AS total").
		Where("user_id = ? AND status = 'success'", userId).
		Scan(&topUpRow)
	var subOrderRow sumRow
	DB.Model(&SubscriptionOrder{}).
		Select("COALESCE(SUM(money * 10000), 0) AS total"). // money 转为与 amount 同单位（quota）
		Where("user_id = ? AND status = 'success'", userId).
		Scan(&subOrderRow)
	totalRecharge := topUpRow.Total + subOrderRow.Total

	// 3. 累计参与福袋次数
	var luckyBagEntries int64
	DB.Model(&LuckyBagEntry{}).
		Where("user_id = ?", userId).
		Count(&luckyBagEntries)

	// 4. 近7天消耗 token
	var weekQuotaRow sumRow
	DB.Model(&Log{}).
		Select("COALESCE(SUM(quota), 0) AS total").
		Where("user_id = ? AND created_at >= ? AND type = 2", userId, weekAgoTs).
		Scan(&weekQuotaRow)

	// 5. 邀请注册人数（累计）
	var inviteCount int64
	DB.Model(&User{}).
		Where("inviter_id = ?", userId).
		Count(&inviteCount)

	// 6. 累计签到次数
	var checkinCount int64
	DB.Model(&Checkin{}).
		Where("user_id = ?", userId).
		Count(&checkinCount)

	// 得分公式：log 压缩防止巨鲸碾压，系数体现优先级梯度
	score := 1.0*math.Log2(1+float64(totalQuotaRow.Total)/10000) + // 累计消耗（基准1.0）
		0.7*math.Log2(1+float64(totalRecharge)/10000) + // 充值总额
		0.5*math.Log2(1+float64(luckyBagEntries)) + // 累计参与福袋
		0.4*math.Log2(1+float64(weekQuotaRow.Total)/10000) + // 近7天消耗
		0.25*math.Log2(1+float64(inviteCount)*5) + // 邀请注册
		0.1*math.Log2(1+float64(checkinCount)) // 累计签到

	return score
}

// calcUserRecentWins 统计用户在最近 lookback 场已开奖活动中中了几次（任意名次）
func calcUserRecentWins(userId, lookback int) int {
	type row struct{ Won bool }
	var rows []row
	DB.Raw(`
		SELECT (a.winner_user_id = ? OR a.winner2_user_id = ? OR a.winner3_user_id = ?) AS won
		FROM lucky_bag_entries e
		JOIN lucky_bag_activities a ON a.id = e.activity_id
		WHERE e.user_id = ? AND a.status = ?
		ORDER BY a.drawn_at DESC
		LIMIT ?
	`, userId, userId, userId, userId, LuckyBagStatusDrawn, lookback).Scan(&rows)

	wins := 0
	for _, r := range rows {
		if r.Won {
			wins++
		}
	}
	return wins
}

// calcUserWeight 计算用户在本场抽奖的权重
//
// 规则：
//  1. 活跃度 → 基础票数 [10, 50]
//  2. VIP 倍率 ×1.5
//  3. 近期中奖惩罚：近5场中奖 k 次 → ×0.5^k
func calcUserWeight(userId int) int {
	ctx := context.Background()
	user, err := GetUserById(userId, true)
	if err != nil || user == nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] calcUserWeight userId=%d: user not found, floor only", userId))
		return luckyBagTicketFloor
	}

	score := calcUserScore(userId)
	merit := luckyBagMeritBonus * math.Log2(1+score)
	if merit < 0 {
		merit = 0
	}
	if merit > float64(luckyBagTicketMeritCap) {
		merit = float64(luckyBagTicketMeritCap)
	}
	baseTickets := float64(luckyBagTicketFloor) + merit

	vipMult := 1.0
	if user.Group == "vip" || user.Group == "svip" {
		vipMult = luckyBagVIPMultiplier
	}

	recentWins := calcUserRecentWins(userId, luckyBagRecentWinLookback)
	penaltyMult := math.Pow(luckyBagWinPenaltyStep, float64(recentWins))

	finalWeight := int(math.Round(baseTickets * vipMult * penaltyMult))
	if finalWeight < 1 {
		finalWeight = 1
	}

	logger.LogInfo(ctx, fmt.Sprintf(
		"[LuckyBag] calcUserWeight userId=%d group=%s: score=%.2f base=%.1f ×vip%.1f ×penalty(wins=%d,×%.2f) = %d",
		userId, user.Group, score, baseTickets, vipMult, recentWins, penaltyMult, finalWeight))
	return finalWeight
}

// EnterLuckyBag 用户报名下一场活动（幂等）
// 仅接受"今日"的场次报名；今日全部场次已结束则拒绝，不允许预约明天
func EnterLuckyBag(userId int) (*LuckyBagEntry, error) {
	ctx := context.Background()
	activity, err := GetNextActivity()
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d: GetNextActivity failed: %v", userId, err))
		return nil, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d date=%s slot=%02d:%02d status=%s",
		userId, activity.Id, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	today := time.Now().Format("2006-01-02")
	if activity.DrawDate != today {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: next slot is %s (not today %s), today's draws finished",
			userId, activity.DrawDate, today))
		return nil, errors.New("今日抽奖已结束，请明天再来")
	}

	if activity.Status == LuckyBagStatusLocked {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: activity %d is locked (pre-drawing)", userId, activity.Id))
		return nil, errors.New("即将开奖，本场报名已截止")
	}
	if activity.Status != LuckyBagStatusPending {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d rejected: activity %d status=%s (not pending)", userId, activity.Id, activity.Status))
		return nil, errors.New("该场次已开奖，请等待下一场")
	}

	var existing LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err == nil {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d already entered (entryId=%d weight=%d)", userId, activity.Id, existing.Id, existing.Weight))
		return &existing, nil
	}

	weight := calcUserWeight(userId)
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d computed weight=%d", userId, activity.Id, weight))
	entry := &LuckyBagEntry{
		ActivityId: activity.Id,
		UserId:     userId,
		Weight:     weight,
		CreatedAt:  time.Now().Unix(),
	}
	if err := DB.Create(entry).Error; err != nil {
		if err2 := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err2 == nil {
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d concurrent insert resolved (entryId=%d)", userId, activity.Id, existing.Id))
			return &existing, nil
		}
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d DB create failed: %v", userId, activity.Id, err))
		return nil, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] EnterLuckyBag userId=%d activityId=%d new entry created (entryId=%d weight=%d)", userId, activity.Id, entry.Id, weight))
	return entry, nil
}

// GetUserNextEntry 查询用户对下一场活动的报名状态
func GetUserNextEntry(userId int) (*LuckyBagEntry, *LuckyBagActivity, error) {
	activity, err := GetNextActivity()
	if err != nil {
		return nil, nil, err
	}
	var entry LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&entry).Error; err != nil {
		return nil, activity, nil
	}
	return &entry, activity, nil
}

func maskNameToken(name string) string {
	runes := []rune(name)
	switch len(runes) {
	case 0:
		return ""
	case 1:
		return "*"
	case 2:
		return string(runes[:1]) + "*"
	case 3:
		return string(runes[:1]) + "*" + string(runes[2:])
	case 4:
		return string(runes[:2]) + "*" + string(runes[3:])
	default:
		return string(runes[:2]) + "***" + string(runes[len(runes)-2:])
	}
}

func maskWinnerUsername(username string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		return ""
	}
	if at := strings.Index(username, "@"); at > 0 {
		return maskNameToken(username[:at]) + "@***"
	}
	return maskNameToken(username)
}

func formatLuckyBagWinnerName(userId int, username string) string {
	masked := maskWinnerUsername(username)
	if userId <= 0 {
		return masked
	}
	if masked == "" {
		return fmt.Sprintf("UID %d", userId)
	}
	return fmt.Sprintf("%s（UID %d）", masked, userId)
}

func FormatLuckyBagWinnerName(userId int, fallback string) string {
	if userId <= 0 {
		return fallback
	}
	if u, _ := GetUserById(userId, false); u != nil {
		return formatLuckyBagWinnerName(userId, u.Username)
	}
	if fallback != "" {
		return fallback
	}
	return fmt.Sprintf("UID %d", userId)
}

func applyLuckyBagWinnerDisplayName(a *LuckyBagActivity) {
	if a == nil {
		return
	}
	if a.WinnerUserId > 0 {
		a.WinnerName = FormatLuckyBagWinnerName(a.WinnerUserId, a.WinnerName)
	}
	if a.Winner2UserId > 0 {
		a.Winner2Name = FormatLuckyBagWinnerName(a.Winner2UserId, a.Winner2Name)
	}
	if a.Winner3UserId > 0 {
		a.Winner3Name = FormatLuckyBagWinnerName(a.Winner3UserId, a.Winner3Name)
	}
}

// calcWinnerQuota 在 [minQ, maxQ] 区间内随机生成奖金
func calcWinnerQuota(minQ, maxQ int) int {
	if minQ <= 0 {
		minQ = 500000
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	if maxQ == minQ {
		return minQ
	}
	return minQ + rand.Intn(maxQ-minQ+1)
}

// weightedPick 加权随机选一名获奖者，返回 entry 下标，并从 pool 中移除（修改 pool slice）
func weightedPick(pool []LuckyBagEntry) (LuckyBagEntry, []LuckyBagEntry) {
	total := 0
	for _, e := range pool {
		total += e.Weight
	}
	pick := rand.Intn(total)
	cum := 0
	idx := 0
	for i, e := range pool {
		cum += e.Weight
		if pick < cum {
			idx = i
			break
		}
	}
	winner := pool[idx]
	remaining := append(pool[:idx:idx], pool[idx+1:]...)
	return winner, remaining
}

// isVIPUser 判断用户是否 VIP（vip/svip 组）
func isVIPUser(userId int) bool {
	u, err := GetUserById(userId, false)
	if err != nil || u == nil {
		return false
	}
	return u.Group == "vip" || u.Group == "svip"
}

// isRecentWinner 判断用户在最近 48 小时内是否曾中过任意名次
func isRecentWinner(userId int) bool {
	cutoff := time.Now().Add(-48 * time.Hour).Unix()
	var count int64
	DB.Model(&LuckyBagActivity{}).
		Where(`(winner_user_id = ? OR winner2_user_id = ? OR winner3_user_id = ?) AND drawn_at >= ? AND status = ?`,
			userId, userId, userId, cutoff, LuckyBagStatusDrawn).
		Limit(1).Count(&count)
	return count > 0
}


// createRedemptionCode 创建一个兑换码并返回 key
func createRedemptionCode(activity *LuckyBagActivity, rank int, quota int) (string, error) {
	code := common.GetUUID()
	r := &Redemption{
		UserId:      0,
		Key:         code,
		Status:      common.RedemptionCodeStatusEnabled,
		Name:        fmt.Sprintf("lucky_bag_%s_%02d%02d_rank%d", activity.DrawDate, activity.SlotHour, activity.SlotMinute, rank),
		Quota:       quota,
		CreatedTime: time.Now().Unix(),
	}
	if err := DB.Create(r).Error; err != nil {
		return "", err
	}
	return code, nil
}

// pickWinnerAndPersist 执行加权随机选出最多3名获奖者，并把中奖信息写入 DB。
//
// 奖金分配：第1名最高，第2名次之，第3名最低。
// 规则：
//   - 48h内中过奖的用户直接排除出本场候选池
//   - 非VIP用户权重×0.5，降低但不归零（仍有机会）
//   - 第1名只能是VIP用户；若无VIP候选则空缺
//   - 非VIP中奖奖金上限压至区间中点，避免拿走最高奖
//
// 若参与人数不足3名，按实际人数开奖。
func pickWinnerAndPersist(activity *LuckyBagActivity, entries []LuckyBagEntry, targetStatus string, drawnAt int64) error {
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d date=%s slot=%02d:%02d entries=%d targetStatus=%s",
		activity.Id, activity.DrawDate, activity.SlotHour, activity.SlotMinute, len(entries), targetStatus))

	if len(entries) == 0 {
		return DB.Model(activity).Updates(map[string]any{
			"status":   targetStatus,
			"drawn_at": drawnAt,
		}).Error
	}

	// 计算3档奖金：1名最高，3名最低
	// 区间切三段：[75%~100%] / [40%~75%] / [0%~40%]
	minQ, maxQ := activity.MinQuota, activity.MaxQuota
	if minQ <= 0 {
		minQ = 500000
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	span := maxQ - minQ
	quota1 := calcWinnerQuota(minQ+span*75/100, maxQ)
	quota2 := calcWinnerQuota(minQ+span*40/100, minQ+span*75/100-1)
	quota3 := calcWinnerQuota(minQ, minQ+span*40/100-1)

	type winnerInfo struct {
		userId int
		name   string
		quota  int
		code   string
	}

	// 缓存 VIP / 近48h中奖状态，避免重复查库
	vipCache    := make(map[int]bool)
	recentCache := make(map[int]bool)
	isVIP := func(uid int) bool {
		if v, ok := vipCache[uid]; ok {
			return v
		}
		v := isVIPUser(uid)
		vipCache[uid] = v
		return v
	}
	isRecent := func(uid int) bool {
		if v, ok := recentCache[uid]; ok {
			return v
		}
		v := isRecentWinner(uid)
		recentCache[uid] = v
		return v
	}

	// 排除48h内已中奖者，对非VIP权重×0.5
	pool := make([]LuckyBagEntry, 0, len(entries))
	for _, e := range entries {
		if isRecent(e.UserId) {
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] exclude recent winner userId=%d", e.UserId))
			continue
		}
		entry := e
		if !isVIP(e.UserId) {
			entry.Weight = entry.Weight / 2
			if entry.Weight < 1 {
				entry.Weight = 1
			}
		}
		pool = append(pool, entry)
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] eligible pool size=%d (after recent-winner exclusion & non-VIP penalty)", len(pool)))

	pickOne := func(quotaVal int, rank int) (*winnerInfo, []LuckyBagEntry) {
		if len(pool) == 0 {
			return nil, pool
		}

		// 第1名只能是VIP，从VIP子池里加权随机
		if rank == 1 {
			var vipPool []LuckyBagEntry
			for _, e := range pool {
				if isVIP(e.UserId) {
					vipPool = append(vipPool, e)
				}
			}
			if len(vipPool) == 0 {
				logger.LogInfo(ctx, "[LuckyBag] rank1: no VIP candidates, slot empty")
				return nil, pool
			}
			candidate, _ := weightedPick(vipPool)
			remaining := make([]LuckyBagEntry, 0, len(pool)-1)
			for _, e := range pool {
				if e.UserId != candidate.UserId {
					remaining = append(remaining, e)
				}
			}
			name := ""
			if u, _ := GetUserById(candidate.UserId, false); u != nil {
				name = formatLuckyBagWinnerName(candidate.UserId, u.Username)
			}
			code, err := createRedemptionCode(activity, rank, quotaVal)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist: create code failed userId=%d: %v", candidate.UserId, err))
				return nil, remaining
			}
			return &winnerInfo{userId: candidate.UserId, name: name, quota: quotaVal, code: code}, remaining
		}

		// 第2/3名：全池加权随机；非VIP中奖额度上限压至区间中点
		candidate, remaining := weightedPick(pool)
		actualQuota := quotaVal
		if !isVIP(candidate.UserId) {
			midPoint := (minQ + maxQ) / 2
			if actualQuota > midPoint {
				actualQuota = calcWinnerQuota(minQ, midPoint)
			}
		}
		name := ""
		if u, _ := GetUserById(candidate.UserId, false); u != nil {
			name = formatLuckyBagWinnerName(candidate.UserId, u.Username)
		}
		code, err := createRedemptionCode(activity, rank, actualQuota)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist: create code failed userId=%d: %v", candidate.UserId, err))
			return nil, remaining
		}
		return &winnerInfo{userId: candidate.UserId, name: name, quota: actualQuota, code: code}, remaining
	}

	w1, r1 := pickOne(quota1, 1)
	pool = r1
	w2, r2 := pickOne(quota2, 2)
	pool = r2
	w3, _ := pickOne(quota3, 3)

	updates := map[string]any{
		"status":   targetStatus,
		"drawn_at": drawnAt,
	}
	if w1 != nil {
		updates["winner_user_id"] = w1.userId
		updates["winner_name"] = w1.name
		updates["winner_quota"] = w1.quota
		updates["winner_code"] = w1.code
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] 1st winner: userId=%d name=%q quota=%d", w1.userId, w1.name, w1.quota))
	}
	if w2 != nil {
		updates["winner2_user_id"] = w2.userId
		updates["winner2_name"] = w2.name
		updates["winner2_quota"] = w2.quota
		updates["winner2_code"] = w2.code
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] 2nd winner: userId=%d name=%q quota=%d", w2.userId, w2.name, w2.quota))
	}
	if w3 != nil {
		updates["winner3_user_id"] = w3.userId
		updates["winner3_name"] = w3.name
		updates["winner3_quota"] = w3.quota
		updates["winner3_code"] = w3.code
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] 3rd winner: userId=%d name=%q quota=%d", w3.userId, w3.name, w3.quota))
	}

	if err := DB.Model(activity).Updates(updates).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] pickWinnerAndPersist activityId=%d: update failed: %v", activity.Id, err))
		return err
	}
	return nil
}

// PrepareLuckyBagDraw 在开奖前 1 分钟预开奖：完整写 DB，但 status 置为 locked，对外仍表现为 pending
// drawnAtUnix 为开奖时刻的 Unix 时间戳（controller 据此判断是否允许对外展示 winner）
func PrepareLuckyBagDraw(activityId int, drawnAtUnix int64) error {
	ctx := context.Background()
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: not found", activityId))
		return errors.New("活动不存在")
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d date=%s slot=%02d:%02d currentStatus=%s",
		activityId, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	if activity.Status != LuckyBagStatusPending {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: skipping (status=%s, not pending)", activityId, activity.Status))
		return nil
	}

	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: load entries failed: %v", activityId, err))
		return err
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] PrepareLuckyBagDraw activityId=%d: %d entries loaded, proceeding to lock", activityId, len(entries)))
	return pickWinnerAndPersist(&activity, entries, LuckyBagStatusLocked, drawnAtUnix)
}

// DrawLuckyBag 对指定活动执行开奖
//   - locked：winner/兑换码已提前写入，只需把 status 翻成 drawn
//   - pending：兜底，完整开奖流程
//   - drawn：已开奖，返回错误
func DrawLuckyBag(activityId int) error {
	ctx := context.Background()
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: not found", activityId))
		return errors.New("活动不存在")
	}
	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d date=%s slot=%02d:%02d currentStatus=%s",
		activityId, activity.DrawDate, activity.SlotHour, activity.SlotMinute, activity.Status))

	if activity.Status == LuckyBagStatusDrawn {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: already drawn", activityId))
		return errors.New("该场次已开奖")
	}

	now := time.Now().Unix()
	if activity.Status == LuckyBagStatusLocked {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: locked->drawn (winner=%d name=%q quota=%d)",
			activityId, activity.WinnerUserId, activity.WinnerName, activity.WinnerQuota))
		if err := DB.Model(&activity).Update("status", LuckyBagStatusDrawn).Error; err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: flip to drawn failed: %v", activityId, err))
			return err
		}
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: status flipped to drawn", activityId))
		return nil
	}

	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: fallback full draw (status was %s)", activityId, activity.Status))
	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] DrawLuckyBag activityId=%d: load entries failed: %v", activityId, err))
		return err
	}
	return pickWinnerAndPersist(&activity, entries, LuckyBagStatusDrawn, now)
}

// LuckyBagHistoryItem 历史开奖记录（含三名中奖者兑换码状态）
type LuckyBagHistoryItem struct {
	LuckyBagActivity
	// 当前用户中奖的名次（0=未中奖，1/2/3）
	MyWinnerRank int `json:"my_winner_rank"`
	// 对应名次的兑换码状态：1=未使用 3=已使用（仅本人中奖时有值）
	WinnerCodeStatus  int `json:"winner_code_status"`
	Winner2CodeStatus int `json:"winner2_code_status"`
	Winner3CodeStatus int `json:"winner3_code_status"`
}

// GetLuckyBagHistory 分页获取历史开奖记录，附带兑换码使用状态
// userId: 当前请求用户，用于判断是否显示兑换码状态；传 0 则不查
func GetLuckyBagHistory(page, size, userId int) ([]LuckyBagHistoryItem, int64, error) {
	if size <= 0 {
		size = 10
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	var total int64
	var activities []LuckyBagActivity
	base := DB.Model(&LuckyBagActivity{}).Where("status = ?", "drawn")
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := base.Order("draw_date desc, slot_hour desc, slot_minute desc").Offset(offset).Limit(size).Find(&activities).Error; err != nil {
		return nil, 0, err
	}

	// 批量查当前用户相关兑换码状态
	codeStatusMap := map[string]int{}
	if userId > 0 {
		var codes []string
		for _, a := range activities {
			if a.WinnerUserId == userId && a.WinnerCode != "" {
				codes = append(codes, a.WinnerCode)
			}
			if a.Winner2UserId == userId && a.Winner2Code != "" {
				codes = append(codes, a.Winner2Code)
			}
			if a.Winner3UserId == userId && a.Winner3Code != "" {
				codes = append(codes, a.Winner3Code)
			}
		}
		if len(codes) > 0 {
			keyCol := "`key`"
			if common.UsingPostgreSQL {
				keyCol = `"key"`
			}
			var redemptions []Redemption
			DB.Select("key, status").Where(keyCol+" IN ?", codes).Find(&redemptions)
			for _, r := range redemptions {
				codeStatusMap[r.Key] = r.Status
			}
		}
	}

	codeStatus := func(code string) int {
		if code == "" {
			return 0
		}
		if s, ok := codeStatusMap[code]; ok {
			return s
		}
		return 1 // 未使用
	}

	items := make([]LuckyBagHistoryItem, len(activities))
	for i, a := range activities {
		applyLuckyBagWinnerDisplayName(&a)
		item := LuckyBagHistoryItem{LuckyBagActivity: a}
		if userId > 0 {
			switch userId {
			case a.WinnerUserId:
				item.MyWinnerRank = 1
				item.WinnerCodeStatus = codeStatus(a.WinnerCode)
			case a.Winner2UserId:
				item.MyWinnerRank = 2
				item.Winner2CodeStatus = codeStatus(a.Winner2Code)
			case a.Winner3UserId:
				item.MyWinnerRank = 3
				item.Winner3CodeStatus = codeStatus(a.Winner3Code)
			}
		}
		items[i] = item
	}
	return items, total, nil
}

// GetLuckyBagParticipantCount 获取指定活动报名人数
func GetLuckyBagParticipantCount(activityId int) (int64, error) {
	var count int64
	err := DB.Model(&LuckyBagEntry{}).Where("activity_id = ?", activityId).Count(&count).Error
	return count, err
}

// GetUserEnteredActivityIds 返回用户在给定活动 ID 列表中已报名的活动 ID 集合
func GetUserEnteredActivityIds(userId int, activityIds []int) (map[int]bool, error) {
	if len(activityIds) == 0 {
		return map[int]bool{}, nil
	}
	var entries []LuckyBagEntry
	if err := DB.Where("user_id = ? AND activity_id IN ?", userId, activityIds).Find(&entries).Error; err != nil {
		return nil, err
	}
	m := make(map[int]bool, len(entries))
	for _, e := range entries {
		m[e.ActivityId] = true
	}
	return m, nil
}

// UserEntryInfo 用户对某活动的报名信息快照
type UserEntryInfo struct {
	Entered      bool
	WinnerViewed bool
}

// GetUserEntryInfos 返回用户在给定活动 ID 列表中的报名信息（是否报名 + 是否已看弹窗）
func GetUserEntryInfos(userId int, activityIds []int) (map[int]UserEntryInfo, error) {
	if len(activityIds) == 0 {
		return map[int]UserEntryInfo{}, nil
	}
	var entries []LuckyBagEntry
	if err := DB.Where("user_id = ? AND activity_id IN ?", userId, activityIds).Find(&entries).Error; err != nil {
		return nil, err
	}
	m := make(map[int]UserEntryInfo, len(entries))
	for _, e := range entries {
		m[e.ActivityId] = UserEntryInfo{Entered: true, WinnerViewed: e.WinnerViewed == 1}
	}
	return m, nil
}

// MarkWinnerViewed 标记用户已查看某场次的中奖弹窗
func MarkWinnerViewed(userId, activityId int) error {
	return DB.Model(&LuckyBagEntry{}).
		Where("user_id = ? AND activity_id = ?", userId, activityId).
		Update("winner_viewed", 1).Error
}

// MarkActivityReminderNotified 原子地把 reminder_notified 从 0 置为 1。
// 返回 true 表示本次获得提醒发送权；false 表示其他实例已经发送过。
func MarkActivityReminderNotified(activityId int) (bool, error) {
	res := DB.Model(&LuckyBagActivity{}).
		Where("id = ? AND reminder_notified = 0", activityId).
		Update("reminder_notified", 1)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// MarkActivityResultNotified 原子地把 result_notified 从 0 置为 1。
// 返回 true 表示本次获得通知权（未发过）；false 表示已发过或活动不存在。
func MarkActivityResultNotified(activityId int) (bool, error) {
	res := DB.Model(&LuckyBagActivity{}).
		Where("id = ? AND result_notified = 0", activityId).
		Update("result_notified", 1)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// GetDrawnUnnotifiedActivities 返回已开奖但未通知且近 24 小时的活动（按时间顺序）
// 限制 24 小时是为了避免老历史数据在部署后集中刷屏
func GetDrawnUnnotifiedActivities() ([]LuckyBagActivity, error) {
	cutoff := time.Now().Add(-24 * time.Hour).Unix()
	var list []LuckyBagActivity
	if err := DB.Where("status = ? AND result_notified = 0 AND drawn_at >= ?",
		LuckyBagStatusDrawn, cutoff).
		Order("draw_date asc, slot_hour asc, slot_minute asc").
		Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// RecentDrawnResult 最近已开奖且用户参与的活动，附带报名信息
type RecentDrawnResult struct {
	Activity     LuckyBagActivity
	IsWinner     bool
	WinnerRank   int // 0=未中奖，1/2/3
	WinnerViewed bool
}

// GetRecentDrawnResultsForUser 返回最近2天内用户参与过且已开奖的活动（按时间倒序）
func GetRecentDrawnResultsForUser(userId int) ([]RecentDrawnResult, error) {
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	var activities []LuckyBagActivity
	if err := DB.Where("status = ? AND draw_date >= ?", "drawn", yesterday).
		Order("draw_date desc, slot_hour desc, slot_minute desc").Find(&activities).Error; err != nil {
		return nil, err
	}
	if len(activities) == 0 {
		return nil, nil
	}
	ids := make([]int, len(activities))
	for i, a := range activities {
		ids[i] = a.Id
	}
	infoMap, err := GetUserEntryInfos(userId, ids)
	if err != nil {
		return nil, err
	}
	var result []RecentDrawnResult
	for _, a := range activities {
		info, entered := infoMap[a.Id]
		if !entered {
			continue
		}
		applyLuckyBagWinnerDisplayName(&a)
		rank := 0
		switch userId {
		case a.WinnerUserId:
			rank = 1
		case a.Winner2UserId:
			rank = 2
		case a.Winner3UserId:
			rank = 3
		}
		result = append(result, RecentDrawnResult{
			Activity:     a,
			IsWinner:     rank > 0,
			WinnerRank:   rank,
			WinnerViewed: info.WinnerViewed,
		})
	}
	return result, nil
}

// UpdateLuckyBagActivityConfig 管理员更新指定场次奖品区间
func UpdateLuckyBagActivityConfig(activityId, minQuota, maxQuota int) error {
	if minQuota <= 0 || maxQuota < minQuota {
		return errors.New("奖品额度配置不合法")
	}
	return DB.Model(&LuckyBagActivity{}).Where("id = ? AND status = ?", activityId, "pending").
		Updates(map[string]any{
			"min_quota": minQuota,
			"max_quota": maxQuota,
		}).Error
}

