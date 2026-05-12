package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withHupijiaoInviteRewardSettings(t *testing.T) {
	t.Helper()
	originalQuotaPerUnit := common.QuotaPerUnit
	originalPrice := setting.HupijiaoPrice
	originalRatio := setting.HupijiaoInviteRewardRatio
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		setting.HupijiaoPrice = originalPrice
		setting.HupijiaoInviteRewardRatio = originalRatio
	})

	common.QuotaPerUnit = 1
	setting.HupijiaoPrice = 0.2
	setting.HupijiaoInviteRewardRatio = 0.2
}

func insertUserForHupijiaoInviteRewardTest(t *testing.T, id int, username string, quota int, inviterId int) {
	t.Helper()
	user := &User{
		Id:        id,
		Username:  username,
		Status:    common.UserStatusEnabled,
		Quota:     quota,
		InviterId: inviterId,
		AffCode:   username,
	}
	require.NoError(t, DB.Create(user).Error)
}

func getUserForHupijiaoInviteRewardTest(t *testing.T, userId int) User {
	t.Helper()
	var user User
	require.NoError(t, DB.Where("id = ?", userId).First(&user).Error)
	return user
}

func TestRechargeByHupijiaoRewardsInviterFromPaidAmount(t *testing.T) {
	truncateTables(t)
	withHupijiaoInviteRewardSettings(t)

	insertUserForHupijiaoInviteRewardTest(t, 2101, "inviter_hupi_topup", 10, 0)
	insertUserForHupijiaoInviteRewardTest(t, 2102, "invitee_hupi_topup", 0, 2101)

	topUp := &TopUp{
		UserId:          2102,
		Amount:          50000,
		Money:           100,
		TradeNo:         "hupijiao-invite-topup",
		PaymentMethod:   PaymentMethodAlipay,
		PaymentProvider: PaymentProviderHupijiao,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, topUp.Insert())

	require.NoError(t, RechargeByHupijiao("hupijiao-invite-topup", 100))

	inviter := getUserForHupijiaoInviteRewardTest(t, 2101)
	assert.Equal(t, 10, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 100, inviter.AffQuota)

	invitee := getUserForHupijiaoInviteRewardTest(t, 2102)
	assert.Equal(t, 500, invitee.Quota)

	require.NoError(t, inviter.TransferAffQuotaToQuota(100))

	inviter = getUserForHupijiaoInviteRewardTest(t, 2101)
	assert.Equal(t, 110, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 0, inviter.AffQuota)

	require.NoError(t, RechargeByHupijiao("hupijiao-invite-topup", 100))

	inviter = getUserForHupijiaoInviteRewardTest(t, 2101)
	assert.Equal(t, 110, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 0, inviter.AffQuota)
}

func TestCompleteHupijiaoSubscriptionOrderRewardsInviterFromPaidAmount(t *testing.T) {
	truncateTables(t)
	withHupijiaoInviteRewardSettings(t)

	insertUserForHupijiaoInviteRewardTest(t, 2201, "inviter_hupi_sub", 0, 0)
	insertUserForHupijiaoInviteRewardTest(t, 2202, "invitee_hupi_sub", 0, 2201)

	plan := &SubscriptionPlan{
		Id:            2201,
		Title:         "Hupijiao Invite Plan",
		PriceAmount:   20,
		PriceCNY:      100,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   1000,
	}
	require.NoError(t, DB.Create(plan).Error)

	order := &SubscriptionOrder{
		UserId:          2202,
		PlanId:          plan.Id,
		Money:           100,
		TradeNo:         "hupijiao-invite-subscription",
		PaymentMethod:   SubscriptionPaymentMethodAlipay,
		PaymentProvider: SubscriptionPaymentProviderHupijiao,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, order.Insert())

	require.NoError(t, CompleteHupijiaoSubscriptionOrder("hupijiao-invite-subscription", 100, "{}"))

	inviter := getUserForHupijiaoInviteRewardTest(t, 2201)
	assert.Equal(t, 0, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 100, inviter.AffQuota)
	assert.Equal(t, int64(1), countUserSubscriptionsForPaymentGuardTest(t, 2202))

	require.NoError(t, inviter.TransferAffQuotaToQuota(100))

	inviter = getUserForHupijiaoInviteRewardTest(t, 2201)
	assert.Equal(t, 100, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 0, inviter.AffQuota)

	require.NoError(t, CompleteHupijiaoSubscriptionOrder("hupijiao-invite-subscription", 100, "{}"))

	inviter = getUserForHupijiaoInviteRewardTest(t, 2201)
	assert.Equal(t, 100, inviter.Quota)
	assert.Equal(t, 100, inviter.AffHistoryQuota)
	assert.Equal(t, 0, inviter.AffQuota)
}
