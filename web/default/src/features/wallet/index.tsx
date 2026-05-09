import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getSelf } from '@/lib/api'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { SectionPageLayout } from '@/components/layout'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { getHupijiaoTopupOrderStatus, isApiSuccess } from './api'
import { AffiliateRewardsCard } from './components/affiliate-rewards-card'
import { MySubscriptionsCard } from './components/my-subscriptions-card'
import { BillingHistoryDialog } from './components/dialogs/billing-history-dialog'
import { CreemConfirmDialog } from './components/dialogs/creem-confirm-dialog'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { TransferDialog } from './components/dialogs/transfer-dialog'
import { RechargeFormCard } from './components/recharge-form-card'
import { RedemptionCodeCard } from './components/redemption-code-card'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { WalletStatsCard } from './components/wallet-stats-card'
import { DEFAULT_DISCOUNT_RATE } from './constants'
import {
  useTopupInfo,
  usePayment,
  useAffiliate,
  useRedemption,
  useCreemPayment,
  useHupijiaoPayment,
  useWaffoPayment,
  useWaffoPancakePayment,
} from './hooks'
import {
  getDefaultPaymentType,
  getMinTopupAmount,
  isHupijiaoPayment,
  isWaffoPancakePayment,
  shouldRouteAlipayThroughHupijiao,
} from './lib'
import type {
  UserWalletData,
  PaymentMethod,
  PresetAmount,
  CreemProduct,
  HupijiaoPaymentData,
} from './types'

interface WalletProps {
  initialShowHistory?: boolean
}

export function Wallet(props: WalletProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [showSubscriptionPanel, setShowSubscriptionPanel] = useState(true)
  const [activeTab, setActiveTab] = useState<'subscription' | 'recharge'>('subscription')
  const [redemptionCode, setRedemptionCode] = useState('')
  const [creemDialogOpen, setCreemDialogOpen] = useState(false)
  const [selectedCreemProduct, setSelectedCreemProduct] =
    useState<CreemProduct | null>(null)
  const [hupijiaoDialogOpen, setHupijiaoDialogOpen] = useState(false)
  const [hupijiaoPayment, setHupijiaoPayment] =
    useState<HupijiaoPaymentData | null>(null)

  const { status } = useStatus()
  const { currency } = useSystemConfig()
  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()

  const effectiveUsdExchangeRate = useMemo(() => {
    return currency?.quotaDisplayType === 'USD'
      ? 1
      : currency?.usdExchangeRate || 1
  }, [currency?.quotaDisplayType, currency?.usdExchangeRate])

  const {
    amount: paymentAmount,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
  } = usePayment()
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const { redeeming, redeemCode } = useRedemption()
  const { processing: creemProcessing, processCreemPayment } = useCreemPayment()
  const { processing: hupijiaoProcessing, processHupijiaoPayment } =
    useHupijiaoPayment()
  const { processWaffoPayment } = useWaffoPayment()
  const { processing: pancakeProcessing, processWaffoPancakePayment } =
    useWaffoPancakePayment()

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!hupijiaoDialogOpen || !hupijiaoPayment?.trade_no) {
      return
    }

    let stopped = false
    let attempts = 0

    const pollOrder = async () => {
      if (stopped) return
      attempts += 1

      try {
        const response = await getHupijiaoTopupOrderStatus(
          hupijiaoPayment.trade_no || '',
          hupijiaoPayment.order_id
        )

        if (isApiSuccess(response) && response.data?.paid) {
          stopped = true
          setHupijiaoDialogOpen(false)
          setHupijiaoPayment(null)
          await fetchUser()
          toast.success(t('Payment successful'))
        } else if (
          isApiSuccess(response) &&
          response.data?.status === 'expired'
        ) {
          stopped = true
          setHupijiaoDialogOpen(false)
          setHupijiaoPayment(null)
          toast.error('订单已过期，请重新下单')
        }
      } catch {
        // Ignore transient polling failures; webhook can still complete the order.
      }

      if (attempts >= 60) {
        stopped = true
      }
    }

    const startTimer = window.setTimeout(pollOrder, 2000)
    const interval = window.setInterval(pollOrder, 3000)

    return () => {
      stopped = true
      window.clearTimeout(startTimer)
      window.clearInterval(interval)
    }
  }, [
    fetchUser,
    hupijiaoDialogOpen,
    hupijiaoPayment?.order_id,
    hupijiaoPayment?.trade_no,
    t,
  ])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (props.initialShowHistory) {
      setBillingDialogOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [props.initialShowHistory])

  useEffect(() => {
    if (topupInfo && topupAmount === 0) {
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)

      const defaultPaymentType = getDefaultPaymentType(topupInfo)
      calculatePaymentAmount(minTopup, defaultPaymentType, {
        useHupijiao: shouldRouteAlipayThroughHupijiao(
          topupInfo,
          defaultPaymentType
        ),
      })
    }
  }, [topupInfo, topupAmount, calculatePaymentAmount])

  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  const calculateRoutedPaymentAmount = useCallback(
    (amount: number, paymentType: string) =>
      calculatePaymentAmount(amount, paymentType, {
        useHupijiao: shouldRouteAlipayThroughHupijiao(topupInfo, paymentType),
      }),
    [calculatePaymentAmount, topupInfo]
  )

  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    calculateRoutedPaymentAmount(preset.value, getCurrentPaymentType())
  }

  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    calculateRoutedPaymentAmount(amount, getCurrentPaymentType())
  }

  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    setPaymentLoading(method.type)

    try {
      const minTopup = getMinTopupAmount(topupInfo)
      if (topupAmount < minTopup) {
        return
      }

      await calculateRoutedPaymentAmount(topupAmount, method.type)
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    const isPancake = isWaffoPancakePayment(selectedPaymentMethod.type)
    const isHupijiao =
      isHupijiaoPayment(selectedPaymentMethod.type) ||
      shouldRouteAlipayThroughHupijiao(topupInfo, selectedPaymentMethod.type)

    if (isHupijiao) {
      const payment = await processHupijiaoPayment(topupAmount)
      if (payment) {
        setConfirmDialogOpen(false)
        const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        )
        if (mobile && payment.pay_url) {
          // Mobile: redirect directly — browser will try to open Alipay app, falls back to H5
          window.location.href = payment.pay_url
        } else {
          // PC: show QR code dialog for scanning
          setHupijiaoPayment({
            ...payment,
            create_time: Math.floor(Date.now() / 1000),
          })
          setHupijiaoDialogOpen(true)
        }
      }
      return
    }

    const success = isPancake
      ? await processWaffoPancakePayment(topupAmount)
      : await processPayment(topupAmount, selectedPaymentMethod.type)

    if (success) {
      setConfirmDialogOpen(false)
      await fetchUser()
    }
  }

  const handleRedeem = async () => {
    if (!redemptionCode) return

    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      await fetchUser()
    }
  }

  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) {
      await fetchUser()
    }
    return success
  }

  const handleCreemProductSelect = (product: CreemProduct) => {
    setSelectedCreemProduct(product)
    setCreemDialogOpen(true)
  }

  const handleCreemConfirm = async () => {
    if (!selectedCreemProduct) return

    const success = await processCreemPayment(selectedCreemProduct.productId)
    if (success) {
      setCreemDialogOpen(false)
      setSelectedCreemProduct(null)
      await fetchUser()
    }
  }

  const handleWaffoMethodSelect = async (_method: unknown, index: number) => {
    const loadingKey = `waffo-${index}`
    setPaymentLoading(loadingKey)

    try {
      await processWaffoPayment(topupAmount, index)
    } finally {
      setPaymentLoading(null)
    }
  }

  const getDiscountRate = useCallback(() => {
    return topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
  }, [topupInfo, topupAmount])

  const handleSubscriptionAvailabilityChange = useCallback(
    (available: boolean) => {
      setShowSubscriptionPanel(available)
    },
    []
  )

  // 订阅不可用时自动切到充值
  useEffect(() => {
    if (!showSubscriptionPanel && activeTab === 'subscription') {
      setActiveTab('recharge')
    }
  }, [showSubscriptionPanel, activeTab])

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Description>
          {t('Manage your balance and payment methods')}
        </SectionPageLayout.Description>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
            {/* Stats row */}
            <WalletStatsCard user={user} loading={userLoading} />

            {/* My Subscriptions + Affiliate + Redemption — always visible at top */}
            <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
              <MySubscriptionsCard
                onAvailabilityChange={handleSubscriptionAvailabilityChange}
              />
              <div className='flex flex-col gap-5'>
                <AffiliateRewardsCard
                  user={user}
                  affiliateLink={affiliateLink}
                  onTransfer={() => setTransferDialogOpen(true)}
                  loading={affiliateLoading}
                />
                <RedemptionCodeCard
                  redemptionCode={redemptionCode}
                  onRedemptionCodeChange={setRedemptionCode}
                  onRedeem={handleRedeem}
                  redeeming={redeeming}
                  topupLink={topupInfo?.topup_link}
                />
              </div>
            </div>

            {/* Tab: Subscription Plans / Recharge */}
            <Tabs
              value={activeTab}
              onValueChange={(v) =>
                setActiveTab((v as 'subscription' | 'recharge') || 'subscription')
              }
            >
              {showSubscriptionPanel && (
                <TabsList className='h-10 w-full max-w-xs'>
                  <TabsTrigger value='subscription'>
                    {t('Subscription')}
                  </TabsTrigger>
                  <TabsTrigger value='recharge'>{t('Recharge')}</TabsTrigger>
                </TabsList>
              )}

              <TabsContent value='subscription' className='mt-4' keepMounted>
                <SubscriptionPlansCard
                  topupInfo={topupInfo}
                  onAvailabilityChange={handleSubscriptionAvailabilityChange}
                />
              </TabsContent>

              <TabsContent value='recharge' className='mt-4'>
                <div id='wallet-add-funds' className='scroll-mt-4'>
                  <RechargeFormCard
                    topupInfo={topupInfo}
                    presetAmounts={presetAmounts}
                    selectedPreset={selectedPreset}
                    onSelectPreset={handleSelectPreset}
                    topupAmount={topupAmount}
                    onTopupAmountChange={handleTopupAmountChange}
                    paymentAmount={paymentAmount}
                    calculating={calculating}
                    onPaymentMethodSelect={handlePaymentMethodSelect}
                    paymentLoading={paymentLoading}
                    loading={topupLoading}
                    priceRatio={(status?.price as number) || 1}
                    usdExchangeRate={effectiveUsdExchangeRate}
                    onOpenBilling={() => setBillingDialogOpen(true)}
                    creemProducts={topupInfo?.creem_products}
                    enableCreemTopup={topupInfo?.enable_creem_topup}
                    onCreemProductSelect={handleCreemProductSelect}
                    enableWaffoTopup={topupInfo?.enable_waffo_topup}
                    waffoPayMethods={topupInfo?.waffo_pay_methods}
                    waffoMinTopup={topupInfo?.waffo_min_topup}
                    onWaffoMethodSelect={handleWaffoMethodSelect}
                    enableWaffoPancakeTopup={
                      topupInfo?.enable_waffo_pancake_topup
                    }
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={topupAmount}
        paymentAmount={paymentAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={processing || pancakeProcessing || hupijiaoProcessing}
        discountRate={getDiscountRate()}
        usdExchangeRate={effectiveUsdExchangeRate}
      />

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />

      <BillingHistoryDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
      />

      <CreemConfirmDialog
        open={creemDialogOpen}
        onOpenChange={setCreemDialogOpen}
        onConfirm={handleCreemConfirm}
        product={selectedCreemProduct}
        processing={creemProcessing}
      />

      <HupijiaoPaymentDialog
        open={hupijiaoDialogOpen}
        onOpenChange={setHupijiaoDialogOpen}
        payment={hupijiaoPayment}
        amount={paymentAmount}
        onExpired={() => {
          setHupijiaoDialogOpen(false)
          setHupijiaoPayment(null)
          toast.error('订单已过期，请重新下单')
        }}
      />
    </>
  )
}
