package setting

var (
	HupijiaoEnabled   bool
	HupijiaoAppId     string                                           // 虎皮椒APPID
	HupijiaoAppSecret string                                           // 虎皮椒密钥
	HupijiaoApiUrl    = "https://api.xunhupay.com/payment/do.html"     // API地址
	HupijiaoNotifyUrl string                                           // 支付成功回调URL
	HupijiaoReturnUrl string                                           // 支付后跳转URL
	HupijiaoMinTopUp  int                                          = 1 // 最低充值金额
)
