package setting

var StripeApiSecret = ""
var StripeWebhookSecret = ""
var StripePriceId = ""
var StripeUnitPrice = 8.0
var StripeMinTopUp = 1
var StripePromotionCodesEnabled = false

// TopupUpgradeGroup specifies the user group to upgrade to upon successful topup.
// Empty string disables the topup group upgrade feature.
var TopupUpgradeGroup = ""
