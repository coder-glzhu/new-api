package setting

var (
	HupijiaoEnabled    bool
	HupijiaoAppId      string // 虎皮椒APPID
	HupijiaoAppSecret  string // 虎皮椒密钥
	HupijiaoApiUrl     string // API地址，默认 https://api.xunhupay.com/payment/do.html
	HupijiaoNotifyUrl  string // 支付成功回调URL
	HupijiaoReturnUrl  string // 支付后跳转URL
	HupijiaoMinTopUp   int = 1  // 最低充值金额
)
