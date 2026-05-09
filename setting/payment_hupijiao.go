package setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

var (
	HupijiaoEnabled   bool
	HupijiaoAppId     string                                       // 虎皮椒APPID
	HupijiaoAppSecret string                                       // 虎皮椒密钥
	HupijiaoApiUrl    = "https://api.xunhupay.com/payment/do.html" // API地址
	HupijiaoNotifyUrl string                                       // 支付成功回调URL
	HupijiaoReturnUrl string                                       // 支付后跳转URL
	HupijiaoMinTopUp  int = 1                                      // 最低充值金额（人民币实付）

	// 虎皮椒专用充值定价（与支付网关通用配置独立；存 options 表 JSON 字符串）
	// HupijiaoPrice：每 1 美元额度对应的人民币（元）；实付 = 美元额度 × k × 档位折扣（不参与通用分组充值倍率）。例 k=0.2 ⇒ 10 元最低档对应 50 刀。
	HupijiaoPrice            float64 = 7.3
	HupijiaoAmountOptions    string  // JSON 数组，如 [10,20,50]
	HupijiaoAmountDiscount   string  // JSON 对象，键为充值档位，值为折扣系数
)

// GetHupijiaoPaymentAmountOptions 解析虎皮椒预设充值档位（展示单位，与全局 payment_setting 语义一致）。
func GetHupijiaoPaymentAmountOptions() []int {
	s := strings.TrimSpace(HupijiaoAmountOptions)
	if s == "" {
		return nil
	}
	var out []int
	if err := common.UnmarshalJsonStr(s, &out); err != nil {
		return nil
	}
	filtered := make([]int, 0, len(out))
	for _, v := range out {
		if v > 0 {
			filtered = append(filtered, v)
		}
	}
	return filtered
}

// GetHupijiaoPaymentDiscount 解析虎皮椒按档折扣（键为前端传入的 amount 档位）。
func GetHupijiaoPaymentDiscount() map[int]float64 {
	s := strings.TrimSpace(HupijiaoAmountDiscount)
	if s == "" {
		return map[int]float64{}
	}
	var asMap map[string]float64
	if err := common.UnmarshalJsonStr(s, &asMap); err != nil {
		return map[int]float64{}
	}
	out := make(map[int]float64, len(asMap))
	for k, v := range asMap {
		if kk, err := strconv.Atoi(k); err == nil && v > 0 {
			out[kk] = v
		}
	}
	return out
}
