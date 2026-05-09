package model

import (
	"errors"
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// LuckyBagActivity 每天一条活动记录，包含奖品配置和开奖结果
type LuckyBagActivity struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	DrawDate     string `json:"draw_date" gorm:"type:varchar(10);uniqueIndex"` // YYYY-MM-DD
	MinQuota     int    `json:"min_quota" gorm:"not null;default:10000"`
	MaxQuota     int    `json:"max_quota" gorm:"not null;default:100000"`
	Status       string `json:"status" gorm:"type:varchar(20);default:'pending'"` // pending / drawn
	WinnerUserId int    `json:"winner_user_id" gorm:"default:0"`
	WinnerName   string `json:"winner_name" gorm:"type:varchar(100)"` // 脱敏后展示
	WinnerQuota  int    `json:"winner_quota" gorm:"default:0"`
	WinnerCode   string `json:"winner_code" gorm:"type:varchar(64)"`
	DrawnAt      int64  `json:"drawn_at" gorm:"bigint;default:0"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// LuckyBagEntry 用户报名记录，每人每天只能报名一次
type LuckyBagEntry struct {
	Id         int   `json:"id" gorm:"primaryKey;autoIncrement"`
	ActivityId int   `json:"activity_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	UserId     int   `json:"user_id" gorm:"not null;index;uniqueIndex:idx_lucky_bag_entry_user"`
	Weight     int   `json:"weight" gorm:"not null;default:1"` // 报名时快照
	CreatedAt  int64 `json:"created_at" gorm:"bigint;autoCreateTime"`
}

// GetOrCreateTodayActivity 获取今天的活动，不存在则以默认配置创建
func GetOrCreateTodayActivity() (*LuckyBagActivity, error) {
	today := time.Now().Format("2006-01-02")
	var activity LuckyBagActivity
	err := DB.Where("draw_date = ?", today).First(&activity).Error
	if err == nil {
		return &activity, nil
	}
	// 不存在则创建
	activity = LuckyBagActivity{
		DrawDate:  today,
		MinQuota:  10000,
		MaxQuota:  100000,
		Status:    "pending",
		CreatedAt: time.Now().Unix(),
	}
	if err := DB.Create(&activity).Error; err != nil {
		// 并发时可能已被其他请求创建，重新读取
		if err2 := DB.Where("draw_date = ?", today).First(&activity).Error; err2 != nil {
			return nil, err
		}
	}
	return &activity, nil
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

	// 近30天签到天数
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

// EnterLuckyBag 用户报名今日活动（幂等：重复调用返回已有记录）
func EnterLuckyBag(userId int) (*LuckyBagEntry, error) {
	activity, err := GetOrCreateTodayActivity()
	if err != nil {
		return nil, err
	}
	if activity.Status == "drawn" {
		return nil, errors.New("今日活动已开奖，报名已截止")
	}

	// 检查是否已报名
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
		// 并发重复报名，重新读取
		if err2 := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&existing).Error; err2 == nil {
			return &existing, nil
		}
		return nil, err
	}
	return entry, nil
}

// GetUserTodayEntry 查询用户今日是否报名
func GetUserTodayEntry(userId int) (*LuckyBagEntry, error) {
	activity, err := GetOrCreateTodayActivity()
	if err != nil {
		return nil, err
	}
	var entry LuckyBagEntry
	if err := DB.Where("activity_id = ? AND user_id = ?", activity.Id, userId).First(&entry).Error; err != nil {
		return nil, nil //nolint — 未报名不是错误
	}
	return &entry, nil
}

// maskedName 对用户名进行脱敏：保留首字符，其余用 *
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

// DrawLuckyBag 对指定活动执行加权随机开奖，生成兑换码并写入 Redemption 表
func DrawLuckyBag(activityId int) error {
	var activity LuckyBagActivity
	if err := DB.First(&activity, activityId).Error; err != nil {
		return errors.New("活动不存在")
	}
	if activity.Status == "drawn" {
		return errors.New("该活动已开奖")
	}

	var entries []LuckyBagEntry
	if err := DB.Where("activity_id = ?", activityId).Find(&entries).Error; err != nil {
		return err
	}
	if len(entries) == 0 {
		// 无人报名，标记完成
		return DB.Model(&activity).Updates(map[string]any{
			"status":   "drawn",
			"drawn_at": time.Now().Unix(),
		}).Error
	}

	// 加权随机
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

	// 随机奖品额度
	quota := activity.MinQuota
	if activity.MaxQuota > activity.MinQuota {
		quota = activity.MinQuota + rand.Intn(activity.MaxQuota-activity.MinQuota+1)
	}

	// 生成兑换码
	code := common.GetUUID()
	redemption := &Redemption{
		UserId:      0,
		Key:         code,
		Status:      common.RedemptionCodeStatusEnabled,
		Name:        "lucky_bag_" + activity.DrawDate,
		Quota:       quota,
		CreatedTime: time.Now().Unix(),
	}
	if err := DB.Create(redemption).Error; err != nil {
		return err
	}

	// 读取获奖者名称并脱敏
	winner, _ := GetUserById(winnerEntry.UserId, false)
	displayName := ""
	if winner != nil {
		displayName = maskedName(winner.Username)
	}

	return DB.Model(&activity).Updates(map[string]any{
		"status":         "drawn",
		"winner_user_id": winnerEntry.UserId,
		"winner_name":    displayName,
		"winner_quota":   quota,
		"winner_code":    code,
		"drawn_at":       time.Now().Unix(),
	}).Error
}

// GetLuckyBagHistory 分页获取历史开奖记录（只返回已开奖的）
func GetLuckyBagHistory(page, size int) ([]LuckyBagActivity, int64, error) {
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
	if err := base.Order("draw_date desc").Offset(offset).Limit(size).Find(&activities).Error; err != nil {
		return nil, 0, err
	}
	return activities, total, nil
}

// GetLuckyBagParticipantCount 获取今日报名人数
func GetLuckyBagParticipantCount(activityId int) (int64, error) {
	var count int64
	err := DB.Model(&LuckyBagEntry{}).Where("activity_id = ?", activityId).Count(&count).Error
	return count, err
}

// UpdateLuckyBagActivityConfig 管理员更新今日活动配置（奖品区间）
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
