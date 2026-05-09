import { useState, useEffect } from 'react'
import { Receipt, WalletCards, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatCurrency,
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  calculatePresetPricing,
} from '../lib'
import type {
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  CreemProduct,
  WaffoPayMethod,
} from '../types'
import { CreemProductsSection } from './creem-products-section'

interface RechargeFormCardProps {
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  onPaymentMethodSelect: (method: PaymentMethod) => void
  paymentLoading: string | null
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
  onOpenBilling?: () => void
  creemProducts?: CreemProduct[]
  enableCreemTopup?: boolean
  onCreemProductSelect?: (product: CreemProduct) => void
  enableWaffoTopup?: boolean
  waffoPayMethods?: WaffoPayMethod[]
  waffoMinTopup?: number
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  enableWaffoPancakeTopup?: boolean
  /** 虎皮椒 + 额度按美元展示时：主金额带 $，应付行标明人民币 */
  alipayHupijiaoUsdQuotaCopy?: boolean
}

export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  onPaymentMethodSelect,
  paymentLoading,
  loading,
  priceRatio = 1,
  usdExchangeRate = 1,
  onOpenBilling,
  creemProducts,
  enableCreemTopup,
  onCreemProductSelect,
  enableWaffoTopup,
  waffoPayMethods,
  waffoMinTopup,
  onWaffoMethodSelect,
  enableWaffoPancakeTopup,
  alipayHupijiaoUsdQuotaCopy = false,
}: RechargeFormCardProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = parseInt(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasConfigurableTopup =
    topupInfo?.enable_online_topup ||
    topupInfo?.enable_stripe_topup ||
    topupInfo?.enable_hupijiao_topup ||
    enableWaffoTopup ||
    enableWaffoPancakeTopup
  const hasAnyTopup = hasConfigurableTopup || enableCreemTopup
  const hasStandardPaymentMethods =
    Array.isArray(topupInfo?.pay_methods) && topupInfo.pay_methods.length > 0
  const hasWaffoPaymentMethods =
    Array.isArray(waffoPayMethods) && waffoPayMethods.length > 0
  const minTopup = getMinTopupAmount(topupInfo)

  if (loading) {
    return (
      <div className='bg-card ring-foreground/10 rounded-xl p-5 ring-1'>
        <div className='mb-5 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Skeleton className='size-8 rounded-lg' />
            <Skeleton className='h-5 w-24' />
          </div>
          <Skeleton className='h-8 w-28' />
        </div>
        <div className='space-y-5'>
          <div className='space-y-2.5'>
            <Skeleton className='h-3 w-16' />
            <div className='grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-[4.75rem] rounded-lg' />
              ))}
            </div>
          </div>
          <div className='space-y-2.5'>
            <Skeleton className='h-3 w-28' />
            <Skeleton className='h-10 w-full' />
          </div>
          <div className='space-y-2.5'>
            <Skeleton className='h-3 w-32' />
            <div className='flex gap-2'>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className='h-9 w-24 rounded-lg' />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-5 rounded-xl p-5 ring-1'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
          <WalletCards className='text-muted-foreground size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-semibold'>{t('Purchase quota')}</h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t('Choose an amount and payment method')}
          </p>
        </div>
        {onOpenBilling && (
          <Button
            variant='outline'
            size='sm'
            onClick={onOpenBilling}
            className='h-8 shrink-0 gap-1.5 px-2.5 text-xs'
          >
            <Receipt className='h-3.5 w-3.5' />
            {t('Order History')}
          </Button>
        )}
      </div>

      {/* Online topup section */}
      {hasAnyTopup ? (
        <div className='space-y-5'>
          {hasConfigurableTopup && (
            <>
              {presetAmounts.length > 0 && (
                <div className='space-y-2.5'>
                  <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    {t('Amount')}
                  </Label>
                  <div className='grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'>
                    {presetAmounts.map((preset, index) => {
                      const discount =
                        preset.discount ||
                        topupInfo?.discount?.[preset.value] ||
                        1.0
                      const {
                        displayValue,
                        actualPrice,
                        savedAmount,
                        hasDiscount,
                      } = calculatePresetPricing(
                        preset.value,
                        priceRatio,
                        discount,
                        usdExchangeRate
                      )
                      return (
                        <Button
                          key={index}
                          variant='outline'
                          className={cn(
                            'hover:border-foreground flex min-h-[4.75rem] flex-col items-start justify-center rounded-lg px-3 py-3.5 text-left whitespace-normal',
                            selectedPreset === preset.value
                              ? 'border-foreground bg-foreground/5'
                              : 'border-muted'
                          )}
                          onClick={() => onSelectPreset(preset)}
                        >
                          <div className='flex w-full items-center justify-between'>
                            <div className='text-base font-semibold'>
                              {alipayHupijiaoUsdQuotaCopy
                                ? `$${formatNumber(displayValue)}`
                                : formatNumber(displayValue)}
                            </div>
                            {hasDiscount && (
                              <div className='text-xs font-medium text-green-600'>
                                {getDiscountLabel(discount)}
                              </div>
                            )}
                          </div>
                          <div className='text-muted-foreground mt-1.5 w-full text-xs leading-snug'>
                            {t('Pay:')} {formatCurrency(actualPrice)}
                            {hasDiscount && savedAmount > 0 && (
                              <span className='text-green-600'>
                                {' '}
                                · {t('Save')} {formatCurrency(savedAmount)}
                              </span>
                            )}
                          </div>
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className='space-y-2.5'>
                <Label
                  htmlFor='topup-amount'
                  className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
                >
                  {t('Custom Amount')}
                </Label>
                <div className='flex gap-2'>
                  <Input
                    id='topup-amount'
                    type='number'
                    value={localAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    min={minTopup}
                    placeholder={`Minimum ${minTopup}`}
                    className='h-9 flex-1 text-sm'
                  />
                  <div className='bg-muted/40 flex h-9 min-w-0 shrink-0 items-center justify-between gap-2 rounded-lg border px-3'>
                    <span className='text-muted-foreground text-xs'>
                      {t('Pay:')}
                    </span>
                    {calculating ? (
                      <Skeleton className='h-4 w-14' />
                    ) : (
                      <span className='text-sm font-semibold'>
                        {formatCurrency(paymentAmount)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className='space-y-2.5'>
                <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Payment Method')}
                </Label>
                {hasStandardPaymentMethods ? (
                  <div className='flex flex-wrap gap-2'>
                    {topupInfo?.pay_methods?.map((method) => {
                      const methodMinTopup = method.min_topup || 0
                      const disabled = methodMinTopup > topupAmount

                      const button = (
                        <Button
                          key={method.type}
                          variant='outline'
                          onClick={() => onPaymentMethodSelect(method)}
                          disabled={disabled || !!paymentLoading}
                          className='h-9 min-w-0 justify-start gap-2 px-3'
                        >
                          {paymentLoading === method.type ? (
                            <Loader2 className='h-4 w-4 animate-spin' />
                          ) : (
                            getPaymentIcon(
                              method.type,
                              'h-4 w-4',
                              method.icon,
                              method.name
                            )
                          )}
                          <span className='truncate text-sm'>{method.name}</span>
                        </Button>
                      )

                      return disabled ? (
                        <TooltipProvider key={method.type}>
                          <Tooltip>
                            <TooltipTrigger render={button} />
                            <TooltipContent>
                              {t('Minimum topup amount: {{amount}}', {
                                amount: methodMinTopup,
                              })}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        button
                      )
                    })}
                  </div>
                ) : hasWaffoPaymentMethods ? null : (
                  <Alert>
                    <AlertDescription>
                      {t(
                        'No payment methods available. Please contact administrator.'
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {enableWaffoTopup &&
                hasWaffoPaymentMethods &&
                onWaffoMethodSelect && (
                  <div className='space-y-2.5'>
                    <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                      {t('Waffo Payment')}
                    </Label>
                    <div className='flex flex-wrap gap-2'>
                      {waffoPayMethods?.map((method, index) => {
                        const loadingKey = `waffo-${index}`
                        const waffoMin = waffoMinTopup || 0
                        const belowMin = waffoMin > topupAmount

                        const button = (
                          <Button
                            key={`${method.name}-${index}`}
                            variant='outline'
                            onClick={() => onWaffoMethodSelect(method, index)}
                            disabled={belowMin || !!paymentLoading}
                            className='h-9 min-w-0 justify-start gap-2 px-3'
                          >
                            {paymentLoading === loadingKey ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : method.icon ? (
                              <img
                                src={method.icon}
                                alt={method.name}
                                className='h-4 w-4 object-contain'
                              />
                            ) : (
                              getPaymentIcon('waffo')
                            )}
                            <span className='truncate text-sm'>{method.name}</span>
                          </Button>
                        )

                        return belowMin ? (
                          <TooltipProvider key={`${method.name}-${index}`}>
                            <Tooltip>
                              <TooltipTrigger render={button} />
                              <TooltipContent>
                                {t('Minimum topup amount: {{amount}}', {
                                  amount: waffoMin,
                                })}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          button
                        )
                      })}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              'Online topup is not enabled. Please use redemption code or contact administrator.'
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Creem products */}
      {enableCreemTopup &&
        Array.isArray(creemProducts) &&
        creemProducts.length > 0 &&
        onCreemProductSelect && (
          <div className='space-y-2.5 border-t pt-4'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Creem Payment')}
            </Label>
            <CreemProductsSection
              products={creemProducts}
              onProductSelect={onCreemProductSelect}
            />
          </div>
        )}

    </div>
  )
}
