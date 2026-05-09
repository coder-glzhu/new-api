package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// migrateHupijiaoPricingFromLegacyIfNeeded 在 options 从数据库加载完成后执行：
// 虎皮椒独立定价上线前，站点只有全局 Price / payment_setting；若库中尚无有效虎皮椒专用项，
// 则从旧配置复制并持久化，避免需管理员手动保存一次才能支付。
func migrateHupijiaoPricingFromLegacyIfNeeded(loadedKeys map[string]struct{}) {
	needPrice, needOpts, needDisc := hupijiaoPricingNeedsMigration(loadedKeys)
	if !needPrice && !needOpts && !needDisc {
		return
	}

	if needPrice {
		p := operation_setting.Price
		if p <= 0 {
			p = 7.3
		}
		if err := UpdateOption("HupijiaoPrice", strconv.FormatFloat(p, 'f', -1, 64)); err != nil {
			common.SysLog("migrate HupijiaoPrice failed: " + err.Error())
		} else {
			common.SysLog("migrated HupijiaoPrice from legacy Price (Hupijiao pricing split)")
		}
	}

	if needOpts {
		opts := operation_setting.GetPaymentSetting().AmountOptions
		b, err := common.Marshal(opts)
		if err != nil {
			common.SysLog("migrate HupijiaoAmountOptions marshal failed: " + err.Error())
		} else if err := UpdateOption("HupijiaoAmountOptions", string(b)); err != nil {
			common.SysLog("migrate HupijiaoAmountOptions failed: " + err.Error())
		} else {
			common.SysLog("migrated HupijiaoAmountOptions from payment_setting.amount_options")
		}
	}

	if needDisc {
		src := operation_setting.GetPaymentSetting().AmountDiscount
		out := make(map[string]float64, len(src))
		for k, v := range src {
			out[strconv.Itoa(k)] = v
		}
		b, err := common.Marshal(out)
		if err != nil {
			common.SysLog("migrate HupijiaoAmountDiscount marshal failed: " + err.Error())
		} else if err := UpdateOption("HupijiaoAmountDiscount", string(b)); err != nil {
			common.SysLog("migrate HupijiaoAmountDiscount failed: " + err.Error())
		} else {
			common.SysLog("migrated HupijiaoAmountDiscount from payment_setting.amount_discount")
		}
	}
}

func hupijiaoPricingNeedsMigration(loadedKeys map[string]struct{}) (needPrice, needOpts, needDisc bool) {
	_, hadPriceKey := loadedKeys["HupijiaoPrice"]
	if !hadPriceKey || setting.HupijiaoPrice <= 0 {
		needPrice = true
	}

	_, hadOptsKey := loadedKeys["HupijiaoAmountOptions"]
	if !hadOptsKey || strings.TrimSpace(setting.HupijiaoAmountOptions) == "" {
		needOpts = true
	}

	_, hadDiscKey := loadedKeys["HupijiaoAmountDiscount"]
	if !hadDiscKey || strings.TrimSpace(setting.HupijiaoAmountDiscount) == "" {
		needDisc = true
	}

	return needPrice, needOpts, needDisc
}
