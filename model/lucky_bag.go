package model

import (
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// DrawSlots 每天三场开奖时刻（小时）
var DrawSlots = []int{9, 12, 17}

// LuckyBagActivity 每天每场一条活动记录
type LuckyBagActivity struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	DrawDate     string `json:"draw_date" gorm:"type:varchar(10);uniqueIndex:idx_lucky_bag_date_slot"` // YYYY-MM-DD
	SlotHour     int    `json:"slot_hour" gorm:"not null;uniqueIndex:idx_lucky_bag_date_slot"`          // 9 / 12 / 17
	MinQuota     int    `json:"min_quota" gorm:"not null;default:10000"`
	MaxQuota     int    `json:"max_quota" gorm:"not null;default:100000"`
	Status       string `json:"status" gorm:"type:varchar(20);default:'pending'"` // pending / drawn
	WinnerUserId int    `json:"winner_user_id" gorm:"default:0"`
	WinnerName   string `json:"winner_name" gorm:"type:varchar(100)"`
	WinnerQuota  int    `json:"winner_quota" gorm:"default:0"`
	WinnerCode   string `json:"winner_code" gorm:"type:varchar(64)"`
	DrawnAt      int64  `json:"drawn_at" gorm:"bigint;default:0"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// LuckyBagEntry 用户报名记录，每人每场只能报名一次
type LuckyBagEntry struct {
	Id            int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ActivityId    int   `json:"activity_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	UserId        int   `json:"user_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	Weight        int   `json:"weight" gorm:"not null;default:1"`
	WinnerViewed  int   `json:"winner_viewed" gorm:"not null;default:0"` // 1=用户已查看中奖弹窗
	CreatedAt     int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// nextDrawSlot 返回下一场开奖的 (hour, isToday)
// 若当天所有场次已过，返回明天第一场
func nextDrawSlot() (date string, hour int) {
	now := time.Now()
	today := now.Format("2006-01-02")
	for _, h := range DrawSlots {
		if now.Hour() < h {
			return today, h
		}
	}
	// 所有场次已过，取明天第一场
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	return tomorrow, DrawSlots[0]
}

// GetOrCreateActivity 获取指定日期+时段的活动，不存在则创建
func GetOrCreateActivity(date string, slotHour int) (*LuckyBagActivity, error) {
	var activity LuckyBagActivity
	err := DB.Where("draw_date = ? AND slot_hour = ?", date, slotHour).First(&activity).Error
	if err == nil {
		return &activity, nil
	}
	activity = LuckyBagActivity{
		DrawDate:  date,
		SlotHour:  slotHour,
		MinQuota:  10000,
		MaxQuota:  100000,
		Status:    "pending",
		CreatedAt: time.Now().Unix(),
	}
	if err := DB.Create(&activity).Error; err != nil {
		if err2 := DB.Where("draw_date = ? AND slot_hour = ?", date, slotHour).First(&activity).Error; err2 != nil {
			return nil, err
		}
	}
	return &activity, nil
}

// GetNextActivity 获取/创建下一场活动
func GetNextActivity() (*LuckyBagActivity, error) {
	date, hour := nextDrawSlot()
	return GetOrCreateActivity(date, hour)
}

// GetTodayActivities 获取今日全部三场活动（按时段顺序）
func GetTodayActivities() ([]*LuckyBagActivity, error) {
	today := time.Now().Format("2006-01-02")
	result := make([]*LuckyBagActivity, 0, len(DrawSlots))
	for _, h := range DrawSlots {
		a, err := GetOrCreateActivity(today, h)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, nil
}

// calcUserWeight 根据用户信息计算权重
func calcUserWeight(userId int) int {
	user, err := GetUserById(userId, true)
	if err != nil || user == nil {
		return 1
	}
	w := 1
	w += user.UsedQuota / 500000
	w += user.RequestCount / 100

	end := time.Now().Format("2006-01-02")
	start := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	var checkinCount int64
	DB.Model(&Checkin{}).
		Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?", userId, start, end).
		Count(&checkinCount)
	if checkinCount > 30 {
		checkinCount = 30
	}
	w += int(checkinCount)
	if w < 1 {
		w = 1
	}
	return w
}

// EnterLuckyBag 用户报名下一场活动（幂等）
func EnterLuckyBag(userId int) (*LuckyBagEntry, error) {
	activity, err := GetNextActivity()
	if err != nil {
		return nil, err
	}
	if activity.Status == "drawn" {
		return nil, errors.New("该场次已开奖，请等待下一场")
	}

	var existing LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err == nil {
		return &existing, nil
	}

	weight := calcUserWeight(userId)
	entry := &LuckyBagEntry{
		ActivityId: activity.Id,
		UserId:     userId,
		Weight:     weight,
		CreatedAt:  time.Now().Unix(),
	}
	if err := DB.Create(entry).Error; err != nil {
		if err2 := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err2 == nil {
			return &existing, nil
		}
		return nil, err
	}
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

// maskedName 保留首字符，其余用 *
func maskedName(name string) string {
	runes := []rune(name)
	if len(runes) <= 1 {
		return string(runes)
	}
	var b []byte
	b = append(b, []byte(string(runes[0]))...)
	for i := 1; i < len(runes); i++ {
		b = append(b, '*')
	}
	return string(b)
}

// luckyBagDrawCache 预计算缓存：activityId -> drawResult
type drawResult struct {
	WinnerUserId int
	WinnerName   string
	WinnerQuota  int
}

var luckyBagDrawCache = struct {
	sync.Mutex
	m map[int]*drawResult
}{m: make(map[int]*drawResult)}

// calcWinnerQuota 根据中奖用户的累计消费计算奖励额度
// 每消费 50000 quota (~$0.1) 获得 10000 quota 奖励，上限 5000000 (=$10)
func calcWinnerQuota(userId int) int {
	user, err := GetUserById(userId, false)
	if err != nil || user == nil {
		return 10000 // 最低 $0.02 保底
	}
	quota := user.UsedQuota / 50
	if quota < 500000 {
		quota = 500000
	}
	if quota > 5000000 {
		quota = 5000000
	}
	return quota
}

// PrepareLuckyBagDraw 提前1分钟预计算开奖结果并缓存，不写库
func PrepareLuckyBagDraw(activityId int) error {
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		return errors.New("活动不存在")
	}
	if activity.Status == "drawn" {
		return nil
	}

	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		return err
	}

	result := &drawResult{}

	if len(entries) > 0 {
		totalWeight := 0
		for _, e := range entries {
			totalWeight += e.Weight
		}
		pick := rand.Intn(totalWeight)
		cum := 0
		winner := entries[0]
		for _, e := range entries {
			cum += e.Weight
			if pick < cum {
				winner = e
				break
			}
		}
		result.WinnerUserId = winner.UserId
		result.WinnerQuota = calcWinnerQuota(winner.UserId)

		if u, _ := GetUserById(winner.UserId, false); u != nil {
			result.WinnerName = maskedName(u.Username)
		}
	}

	luckyBagDrawCache.Lock()
	luckyBagDrawCache.m[activityId] = result
	luckyBagDrawCache.Unlock()
	return nil
}

// DrawLuckyBag 对指定活动执行开奖，优先使用预计算缓存
func DrawLuckyBag(activityId int) error {
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		return errors.New("活动不存在")
	}
	if activity.Status == "drawn" {
		return errors.New("该场次已开奖")
	}

	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		return err
	}
	if len(entries) == 0 {
		return DB.Model(&activity).Updates(map[string]any{
			"status":   "drawn",
			"drawn_at": time.Now().Unix(),
		}).Error
	}

	// 取缓存，若无则临时计算
	luckyBagDrawCache.Lock()
	cached := luckyBagDrawCache.m[activityId]
	delete(luckyBagDrawCache.m, activityId)
	luckyBagDrawCache.Unlock()

	var winnerUserId int
	var winnerName string
	var quota int

	if cached != nil && cached.WinnerUserId > 0 {
		winnerUserId = cached.WinnerUserId
		winnerName = cached.WinnerName
		quota = cached.WinnerQuota
	} else {
		totalWeight := 0
		for _, e := range entries {
			totalWeight += e.Weight
		}
		pick := rand.Intn(totalWeight)
		cum := 0
		winnerEntry := entries[0]
		for _, e := range entries {
			cum += e.Weight
			if pick < cum {
				winnerEntry = e
				break
			}
		}
		winnerUserId = winnerEntry.UserId
		quota = calcWinnerQuota(winnerUserId)
		if u, _ := GetUserById(winnerUserId, false); u != nil {
			winnerName = maskedName(u.Username)
		}
	}

	code := common.GetUUID()
	redemption := &Redemption{
		UserId:      0,
		Key:         code,
		Status:      common.RedemptionCodeStatusEnabled,
		Name:        fmt.Sprintf("lucky_bag_%s_%02d", activity.DrawDate, activity.SlotHour),
		Quota:       quota,
		CreatedTime: time.Now().Unix(),
	}
	if err := DB.Create(redemption).Error; err != nil {
		return err
	}

	return DB.Model(&activity).Updates(map[string]any{
		"status":         "drawn",
		"winner_user_id": winnerUserId,
		"winner_name":    winnerName,
		"winner_quota":   quota,
		"winner_code":    code,
		"drawn_at":       time.Now().Unix(),
	}).Error
}

// LuckyBagHistoryItem 历史开奖记录（含兑换码状态）
type LuckyBagHistoryItem struct {
	LuckyBagActivity
	// 仅对中奖用户自己可见：兑换码状态 1=未使用 3=已使用 0=无（非本人中奖）
	WinnerCodeStatus int `json:"winner_code_status"`
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
	if err := base.Order("draw_date desc, slot_hour desc").Offset(offset).Limit(size).Find(&activities).Error; err != nil {
		return nil, 0, err
	}

	// 批量查当前用户中奖场次对应的兑换码状态
	codeStatusMap := map[string]int{}
	if userId > 0 {
		codes := make([]string, 0)
		for _, a := range activities {
			if a.WinnerUserId == userId && a.WinnerCode != "" {
				codes = append(codes, a.WinnerCode)
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

	items := make([]LuckyBagHistoryItem, len(activities))
	for i, a := range activities {
		items[i] = LuckyBagHistoryItem{LuckyBagActivity: a}
		if userId > 0 && a.WinnerUserId == userId && a.WinnerCode != "" {
			if s, ok := codeStatusMap[a.WinnerCode]; ok {
				items[i].WinnerCodeStatus = s
			} else {
				items[i].WinnerCodeStatus = 1 // enabled（未使用）
			}
		}
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

// RecentDrawnResult 最近已开奖且用户参与的活动，附带报名信息
type RecentDrawnResult struct {
	Activity     LuckyBagActivity
	IsWinner     bool
	WinnerViewed bool
}

// GetRecentDrawnResultsForUser 返回最近2天内用户参与过且已开奖的活动（按时间倒序）
func GetRecentDrawnResultsForUser(userId int) ([]RecentDrawnResult, error) {
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	var activities []LuckyBagActivity
	if err := DB.Where("status = ? AND draw_date >= ?", "drawn", yesterday).
		Order("draw_date desc, slot_hour desc").Find(&activities).Error; err != nil {
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
		result = append(result, RecentDrawnResult{
			Activity:     a,
			IsWinner:     a.WinnerUserId == userId,
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
