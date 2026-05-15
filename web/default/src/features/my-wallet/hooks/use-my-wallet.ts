import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getSelf } from '@/lib/api'
import { useAffiliate, useRedemption, useTopupInfo } from '@/features/wallet/hooks'
import { DEFAULT_DISCOUNT_RATE } from '@/features/wallet/constants'
import { mergePresetAmounts } from '@/features/wallet/lib'
import {
  calculateHupijiaoAmount,
  getHupijiaoTopupOrderStatus,
  isApiSuccess,
} from '../api'
import { useHupijiaoPayment } from './use-hupijiao-payment'
import type {
  HupijiaoPaymentData,
  MyWalletTopupInfo,
  PresetAmount,
  UserWalletData,
} from '../types'

type WalletTab = 'recharge' | 'subscription' | 'affiliate'

function parseNumberArray(value: unknown): number[] {
  const data = typeof value === 'string' ? safeJson(value) : value
  return Array.isArray(data)
    ? data.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : []
}

function parseDiscountMap(value: unknown): Record<number, number> {
  const data = typeof value === 'string' ? safeJson(value) : value
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, val]) => [Number(key), Number(val)] as const)
      .filter(([key, val]) => Number.isFinite(key) && Number.isFinite(val))
  )
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function getHupijiaoMinTopup(topupInfo: MyWalletTopupInfo | null): number {
  if (!topupInfo) return 1
  if ((topupInfo.hupijiao_min_recharge_amount ?? 0) > 0) {
    return topupInfo.hupijiao_min_recharge_amount!
  }
  if ((topupInfo.hupijiao_min_topup ?? 0) > 0) {
    return topupInfo.hupijiao_min_topup!
  }
  return 1
}

function getHupijiaoPresets(
  topupInfo: MyWalletTopupInfo | null
): PresetAmount[] {
  const amounts = parseNumberArray(topupInfo?.hupijiao_amount_options)
  if (amounts.length === 0) return []
  const discounts = parseDiscountMap(topupInfo?.hupijiao_discount)
  return mergePresetAmounts(amounts, discounts)
}

export function useMyWallet(initialShowHistory?: boolean) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<WalletTab>('recharge')
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [calculating, setCalculating] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [hupijiaoDialogOpen, setHupijiaoDialogOpen] = useState(false)
  const [hupijiaoPayment, setHupijiaoPayment] =
    useState<HupijiaoPaymentData | null>(null)

  const { topupInfo: rawTopupInfo, loading: topupLoading } = useTopupInfo()
  const topupInfo = rawTopupInfo as MyWalletTopupInfo | null
  const affiliate = useAffiliate()
  const redemption = useRedemption()
  const hupijiao = useHupijiaoPayment()

  const hupijiaoEnabled = !!topupInfo?.enable_hupijiao_topup
  const minTopup = getHupijiaoMinTopup(topupInfo)
  const presetAmounts = useMemo(
    () => getHupijiaoPresets(topupInfo),
    [topupInfo]
  )
  const priceRatio = Number(topupInfo?.hupijiao_price ?? 0)
  const discountMap = useMemo(
    () => parseDiscountMap(topupInfo?.hupijiao_discount),
    [topupInfo?.hupijiao_discount]
  )

  const calculatePaymentAmount = useCallback(
    async (amount: number) => {
      if (!hupijiaoEnabled || amount <= 0) {
        setPaymentAmount(0)
        return 0
      }
      try {
        setCalculating(true)
        const response = await calculateHupijiaoAmount({ amount })
        const value =
          isApiSuccess(response) && response.data
            ? parseFloat(response.data)
            : 0
        setPaymentAmount(value)
        return value
      } catch {
        setPaymentAmount(0)
        return 0
      } finally {
        setCalculating(false)
      }
    },
    [hupijiaoEnabled]
  )

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (initialShowHistory) {
      setBillingDialogOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [initialShowHistory])

  // Initialize default amount once topupInfo arrives
  useEffect(() => {
    if (!topupInfo || !hupijiaoEnabled || topupAmount !== 0) return
    const initial = presetAmounts[0]?.value ?? minTopup
    setTopupAmount(initial)
    setSelectedPreset(presetAmounts[0]?.value ?? null)
    void calculatePaymentAmount(initial)
  }, [
    topupInfo,
    hupijiaoEnabled,
    presetAmounts,
    minTopup,
    topupAmount,
    calculatePaymentAmount,
  ])

  // Poll Hupijiao order while payment dialog is open
  useEffect(() => {
    if (!hupijiaoDialogOpen || !hupijiaoPayment?.trade_no) return
    let stopped = false

    const poll = async () => {
      if (stopped || !hupijiaoPayment.trade_no) return
      try {
        const response = await getHupijiaoTopupOrderStatus(
          hupijiaoPayment.trade_no,
          hupijiaoPayment.order_id
        )
        if (isApiSuccess(response) && response.data?.paid) {
          stopped = true
          setHupijiaoDialogOpen(false)
          setHupijiaoPayment(null)
          await fetchUser()
          toast.success(t('Payment successful'))
        } else if (response.data?.status === 'expired') {
          stopped = true
          setHupijiaoDialogOpen(false)
          setHupijiaoPayment(null)
          toast.error(t('Order expired, please order again'))
        }
      } catch {
        // Webhook settlement can still complete the order.
      }
    }

    const start = window.setTimeout(poll, 2000)
    const interval = window.setInterval(poll, 3000)
    return () => {
      stopped = true
      window.clearTimeout(start)
      window.clearInterval(interval)
    }
  }, [fetchUser, hupijiaoDialogOpen, hupijiaoPayment, t])

  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    void calculatePaymentAmount(preset.value)
  }

  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    void calculatePaymentAmount(amount)
  }

  const handleAlipayClick = async () => {
    if (!hupijiaoEnabled) return
    if (topupAmount < minTopup) return
    setPaymentLoading('alipay')
    try {
      await calculatePaymentAmount(topupAmount)
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  const handlePaymentConfirm = async () => {
    const data = await hupijiao.processHupijiaoPayment(topupAmount)
    if (!data) return
    setConfirmDialogOpen(false)
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      )
    if (mobile && data.pay_url) {
      window.location.href = data.pay_url
      return
    }
    setHupijiaoPayment({
      ...data,
      create_time: Math.floor(Date.now() / 1000),
    })
    setHupijiaoDialogOpen(true)
  }

  const handleRedeem = async () => {
    if (!redemptionCode.trim()) return
    const success = await redemption.redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      await fetchUser()
    }
  }

  const handleTransfer = async (amount: number) => {
    const success = await affiliate.transferQuota(amount)
    if (success) await fetchUser()
    return success
  }

  return {
    activeTab,
    setActiveTab,
    user,
    userLoading,
    topupInfo,
    topupLoading,
    hupijiaoEnabled,
    minTopup,
    topupAmount,
    selectedPreset,
    presetAmounts,
    priceRatio,
    paymentAmount,
    calculating,
    paymentLoading,
    affiliateLink: affiliate.affiliateLink,
    affiliateLoading: affiliate.loading,
    transferring: affiliate.transferring,
    redemptionCode,
    redeeming: redemption.redeeming,
    confirmDialogOpen,
    setConfirmDialogOpen,
    transferDialogOpen,
    setTransferDialogOpen,
    billingDialogOpen,
    setBillingDialogOpen,
    hupijiaoDialogOpen,
    setHupijiaoDialogOpen,
    hupijiaoPayment,
    setHupijiaoPayment,
    paymentProcessing: hupijiao.processing,
    discountRate: discountMap[topupAmount] || DEFAULT_DISCOUNT_RATE,
    complianceConfirmed: topupInfo?.payment_compliance_confirmed !== false,
    redemptionEnabled: topupInfo?.enable_redemption !== false,
    handleSelectPreset,
    handleTopupAmountChange,
    handleAlipayClick,
    handlePaymentConfirm,
    setRedemptionCode,
    handleRedeem,
    handleTransfer,
    refreshUser: fetchUser,
  }
}
