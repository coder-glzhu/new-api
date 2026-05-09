package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Option key: 虎皮椒配额充值订单的 Amount 已迁移为「美元分」（$1.00 = 100）。
const optionHupijiaoTopupAmountUsdCents = "HupijiaoTopupAmountUsdCents"

// migrateHupijiaoTopupAmountToUsdCentsIfNeeded 将历史虎皮椒配额充值订单的 Amount 从整美元转为美元分。
// 订阅占位订单 Amount=0 不受影响。
func migrateHupijiaoTopupAmountToUsdCentsIfNeeded(loadedKeys map[string]struct{}) {
	if _, ok := loadedKeys[optionHupijiaoTopupAmountUsdCents]; ok {
		if strings.TrimSpace(common.OptionMap[optionHupijiaoTopupAmountUsdCents]) == "1" {
			return
		}
	}

	res := DB.Model(&TopUp{}).
		Where("payment_provider = ?", PaymentProviderHupijiao).
		Where("amount > ?", 0).
		Update("amount", gorm.Expr("amount * ?", 100))
	if res.Error != nil {
		common.SysLog("migrate Hupijiao topup Amount to USD cents failed: " + res.Error.Error())
		return
	}

	if err := UpdateOption(optionHupijiaoTopupAmountUsdCents, "1"); err != nil {
		common.SysLog("persist HupijiaoTopupAmountUsdCents failed: " + err.Error())
		return
	}
	common.SysLog("migrated Hupijiao quota top-up Amount to USD cents (×100)")
}
