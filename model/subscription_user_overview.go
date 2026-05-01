package model

import (
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

type SubscriptionUserOverviewFilter struct {
	Keyword string
	Status  string
	PlanId  int
}

type SubscriptionUserOverviewItem struct {
	UserId       int    `json:"user_id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
	Group        string `json:"group"`
	UserStatus   int    `json:"user_status"`
	Role         int    `json:"role"`
	WalletQuota  int    `json:"wallet_quota"`
	WalletUsed   int    `json:"wallet_used"`
	RequestCount int    `json:"request_count"`

	Status            string `json:"status"`
	SubscriptionCount int    `json:"subscription_count"`
	ActiveCount       int    `json:"active_count"`
	ExpiredCount      int    `json:"expired_count"`
	CancelledCount    int    `json:"cancelled_count"`

	ActiveAmountTotal     int64 `json:"active_amount_total"`
	ActiveAmountUsed      int64 `json:"active_amount_used"`
	ActiveAmountRemaining int64 `json:"active_amount_remaining"`
	AllAmountTotal        int64 `json:"all_amount_total"`
	AllAmountUsed         int64 `json:"all_amount_used"`

	CurrentSubscriptionId int    `json:"current_subscription_id"`
	CurrentPlanId         int    `json:"current_plan_id"`
	CurrentPlanTitle      string `json:"current_plan_title"`
	CurrentSource         string `json:"current_source"`
	CurrentEndTime        int64  `json:"current_end_time"`
	NextResetTime         int64  `json:"next_reset_time"`
	LastSubscriptionTime  int64  `json:"last_subscription_time"`
}

type SubscriptionUserOverviewSummary struct {
	TotalUsers            int   `json:"total_users"`
	ActiveUsers           int   `json:"active_users"`
	ExpiredUsers          int   `json:"expired_users"`
	CancelledUsers        int   `json:"cancelled_users"`
	ActiveAmountTotal     int64 `json:"active_amount_total"`
	ActiveAmountUsed      int64 `json:"active_amount_used"`
	ActiveAmountRemaining int64 `json:"active_amount_remaining"`
	ExpiringSoonUsers     int   `json:"expiring_soon_users"`
}

func subscriptionMatchesOverviewStatus(sub UserSubscription, status string, now int64) bool {
	switch strings.TrimSpace(status) {
	case "active":
		return sub.Status == "active" && sub.EndTime > now
	case "expired":
		return sub.Status == "expired" || (sub.Status == "active" && sub.EndTime > 0 && sub.EndTime <= now)
	case "cancelled":
		return sub.Status == "cancelled"
	default:
		return true
	}
}

func fillOverviewCurrentSubscription(item *SubscriptionUserOverviewItem, sub UserSubscription, planTitles map[int]string) {
	item.CurrentSubscriptionId = sub.Id
	item.CurrentPlanId = sub.PlanId
	item.CurrentPlanTitle = planTitles[sub.PlanId]
	if item.CurrentPlanTitle == "" {
		item.CurrentPlanTitle = "#" + strconv.Itoa(sub.PlanId)
	}
	item.CurrentSource = sub.Source
	item.CurrentEndTime = sub.EndTime
	item.NextResetTime = sub.NextResetTime
}

func ListSubscriptionUserOverview(filter SubscriptionUserOverviewFilter, startIdx int, limit int) ([]SubscriptionUserOverviewItem, int64, SubscriptionUserOverviewSummary, error) {
	summary := SubscriptionUserOverviewSummary{}
	now := common.GetTimestamp()
	query := DB.Model(&UserSubscription{})
	if filter.PlanId > 0 {
		query = query.Where("plan_id = ?", filter.PlanId)
	}

	var subscriptions []UserSubscription
	if err := query.Order("user_id asc, end_time desc, id desc").Find(&subscriptions).Error; err != nil {
		return nil, 0, summary, err
	}

	userIdsSet := make(map[int]struct{})
	planIdsSet := make(map[int]struct{})
	matchedSubscriptions := make([]UserSubscription, 0, len(subscriptions))
	for _, sub := range subscriptions {
		if !subscriptionMatchesOverviewStatus(sub, filter.Status, now) {
			continue
		}
		matchedSubscriptions = append(matchedSubscriptions, sub)
		userIdsSet[sub.UserId] = struct{}{}
		planIdsSet[sub.PlanId] = struct{}{}
	}

	if len(userIdsSet) == 0 {
		return []SubscriptionUserOverviewItem{}, 0, summary, nil
	}

	userIds := make([]int, 0, len(userIdsSet))
	for userId := range userIdsSet {
		userIds = append(userIds, userId)
	}
	sort.Ints(userIds)

	var users []User
	if err := DB.Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, summary, err
	}

	usersById := make(map[int]User, len(users))
	for _, user := range users {
		usersById[user.Id] = user
	}

	planIds := make([]int, 0, len(planIdsSet))
	for planId := range planIdsSet {
		planIds = append(planIds, planId)
	}
	var plans []SubscriptionPlan
	if len(planIds) > 0 {
		if err := DB.Where("id IN ?", planIds).Find(&plans).Error; err != nil {
			return nil, 0, summary, err
		}
	}
	planTitles := make(map[int]string, len(plans))
	for _, plan := range plans {
		planTitles[plan.Id] = plan.Title
	}

	itemsByUserId := make(map[int]*SubscriptionUserOverviewItem, len(userIds))
	for _, sub := range matchedSubscriptions {
		user, ok := usersById[sub.UserId]
		if !ok {
			continue
		}

		item := itemsByUserId[sub.UserId]
		if item == nil {
			item = &SubscriptionUserOverviewItem{
				UserId:       user.Id,
				Username:     user.Username,
				DisplayName:  user.DisplayName,
				Email:        user.Email,
				Group:        user.Group,
				UserStatus:   user.Status,
				Role:         user.Role,
				WalletQuota:  user.Quota,
				WalletUsed:   user.UsedQuota,
				RequestCount: user.RequestCount,
			}
			itemsByUserId[sub.UserId] = item
		}

		item.SubscriptionCount++
		item.AllAmountTotal += sub.AmountTotal
		item.AllAmountUsed += sub.AmountUsed
		if sub.EndTime > item.LastSubscriptionTime {
			item.LastSubscriptionTime = sub.EndTime
		}

		isCancelled := sub.Status == "cancelled"
		isExpired := sub.Status == "expired" || (!isCancelled && sub.EndTime > 0 && sub.EndTime <= now)
		isActive := sub.Status == "active" && !isExpired

		switch {
		case isActive:
			item.ActiveCount++
			item.ActiveAmountTotal += sub.AmountTotal
			item.ActiveAmountUsed += sub.AmountUsed
			if item.CurrentSubscriptionId == 0 || sub.EndTime > item.CurrentEndTime {
				fillOverviewCurrentSubscription(item, sub, planTitles)
			}
		case isCancelled:
			item.CancelledCount++
		default:
			item.ExpiredCount++
		}

		if item.CurrentSubscriptionId == 0 {
			fillOverviewCurrentSubscription(item, sub, planTitles)
		}
	}

	keyword := strings.ToLower(strings.TrimSpace(filter.Keyword))
	items := make([]SubscriptionUserOverviewItem, 0, len(itemsByUserId))
	for _, item := range itemsByUserId {
		if item.ActiveAmountTotal > 0 {
			item.ActiveAmountRemaining = item.ActiveAmountTotal - item.ActiveAmountUsed
			if item.ActiveAmountRemaining < 0 {
				item.ActiveAmountRemaining = 0
			}
		}
		switch {
		case item.ActiveCount > 0:
			item.Status = "active"
		case item.CancelledCount > 0 && item.CancelledCount >= item.ExpiredCount:
			item.Status = "cancelled"
		default:
			item.Status = "expired"
		}

		if keyword != "" {
			haystack := strings.ToLower(strings.Join([]string{
				item.Username,
				item.DisplayName,
				item.Email,
				item.Group,
				item.CurrentPlanTitle,
				strconv.Itoa(item.UserId),
			}, " "))
			if !strings.Contains(haystack, keyword) {
				continue
			}
		}

		items = append(items, *item)
	}

	summary.TotalUsers = len(items)
	for _, item := range items {
		switch item.Status {
		case "active":
			summary.ActiveUsers++
		case "cancelled":
			summary.CancelledUsers++
		default:
			summary.ExpiredUsers++
		}
		summary.ActiveAmountTotal += item.ActiveAmountTotal
		summary.ActiveAmountUsed += item.ActiveAmountUsed
		summary.ActiveAmountRemaining += item.ActiveAmountRemaining
		if item.Status == "active" && item.CurrentEndTime > 0 {
			secondsLeft := item.CurrentEndTime - now
			if secondsLeft >= 0 && secondsLeft <= 7*86400 {
				summary.ExpiringSoonUsers++
			}
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].ActiveCount != items[j].ActiveCount {
			return items[i].ActiveCount > items[j].ActiveCount
		}
		if items[i].LastSubscriptionTime != items[j].LastSubscriptionTime {
			return items[i].LastSubscriptionTime > items[j].LastSubscriptionTime
		}
		return items[i].UserId < items[j].UserId
	})

	total := int64(len(items))
	if startIdx >= len(items) {
		return []SubscriptionUserOverviewItem{}, total, summary, nil
	}
	endIdx := startIdx + limit
	if endIdx > len(items) {
		endIdx = len(items)
	}

	return items[startIdx:endIdx], total, summary, nil
}
