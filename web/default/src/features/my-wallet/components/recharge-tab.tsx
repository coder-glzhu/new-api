import { useEffect, useState } from 'react'
import { Gift, Loader2, Receipt, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { getDiscountLabel, getPaymentIcon } from '@/features/wallet/lib'
import type { PresetAmount } from '../types'

interface RechargeTabProps {
  hupijiaoEnabled: boolean
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  minTopup: number
  priceRatio: number
  paymentLoading: string | null
  onAlipayClick: () => void
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  redemptionEnabled: boolean
  loading?: boolean
  onOpenBilling: () => void
}

function formatUsd(value: number): string {
  return `$${formatNumber(value)}`
}

function formatCny(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const fractionDigits = Math.abs(value) >= 1 ? 2 : 4
  return `¥${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })}`
}

export function RechargeTab({
  hupijiaoEnabled,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  minTopup,
  priceRatio,
  paymentLoading,
  onAlipayClick,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  redemptionEnabled,
  loading,
  onOpenBilling,
}: RechargeTabProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = parseInt(value) || 0
    if (numValue >= 0) onTopupAmountChange(numValue)
  }

  const showPresets = hupijiaoEnabled && presetAmounts.length > 0
  const belowMin = hupijiaoEnabled && topupAmount > 0 && topupAmount < minTopup

  return (
    <div id='wallet-add-funds' className='scroll-mt-4'>
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start'>
        <TitledCard
          title={t('Add Funds')}
          description={t('Pay in CNY (¥), receive USD ($) credit')}
          icon={<WalletCards className='h-4 w-4' />}
          action={
            <Button
              variant='outline'
              size='sm'
              onClick={onOpenBilling}
              className='w-full gap-2 sm:w-auto'
            >
              <Receipt className='h-4 w-4' />
              {t('Order History')}
            </Button>
          }
          contentClassName='space-y-4 sm:space-y-5'
        >
          {loading ? (
            <RechargeSkeleton />
          ) : !hupijiaoEnabled ? (
            <Alert>
              <AlertDescription>
                {t(
                  'Online topup is not enabled. Please use redemption code or contact administrator.'
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {showPresets ? (
                <div className='space-y-2.5 sm:space-y-3'>
                  <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    {t('Amount')}
                  </Label>
                  <div className='grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3'>
                    {presetAmounts.map((preset) => {
                      const discount = preset.discount || 1
                      const hasDiscount = discount < 1
                      const actualPrice = preset.value * priceRatio * discount
                      const original = preset.value * priceRatio
                      const saved = original - actualPrice
                      const isSelected = selectedPreset === preset.value
                      return (
                        <Button
                          key={preset.value}
                          variant='outline'
                          className={cn(
                            'hover:border-foreground flex min-h-16 flex-col items-start rounded-lg px-3 py-2.5 text-left whitespace-normal sm:min-h-[72px] sm:p-4',
                            isSelected
                              ? 'border-foreground bg-foreground/5'
                              : 'border-muted'
                          )}
                          onClick={() => onSelectPreset(preset)}
                        >
                          <div className='flex w-full items-center justify-between'>
                            <div className='text-base font-semibold sm:text-lg'>
                              {formatUsd(preset.value)}
                            </div>
                            {hasDiscount ? (
                              <div className='text-xs font-medium text-green-600'>
                                {getDiscountLabel(discount)}
                              </div>
                            ) : null}
                          </div>
                          <div className='text-muted-foreground mt-1.5 w-full text-xs sm:mt-2'>
                            {t('Pay {{amount}}', {
                              amount: formatCny(actualPrice),
                            })}
                            {hasDiscount && saved > 0 ? (
                              <span className='text-green-600'>
                                {' '}
                                · {t('Save {{amount}}', {
                                  amount: formatCny(saved),
                                })}
                              </span>
                            ) : null}
                          </div>
                        </Button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className='space-y-2.5 sm:space-y-3'>
                <Label
                  htmlFor='topup-amount'
                  className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
                >
                  {t('Custom Amount (USD)')}
                </Label>
                <div className='grid grid-cols-[minmax(0,1fr)_minmax(140px,0.6fr)] gap-2 lg:items-center'>
                  <div className='relative'>
                    <span className='text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-medium sm:text-lg'>
                      $
                    </span>
                    <Input
                      id='topup-amount'
                      type='number'
                      value={localAmount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      min={minTopup}
                      placeholder={String(minTopup)}
                      className='h-9 pl-7 text-base sm:h-10 sm:text-lg'
                    />
                  </div>
                  <div className='bg-muted/30 flex min-h-9 items-center justify-between gap-2 rounded-md border px-3'>
                    <span className='text-muted-foreground truncate text-xs'>
                      {t('Amount to pay:')}
                    </span>
                    {calculating ? (
                      <Skeleton className='h-5 w-16' />
                    ) : (
                      <span className='text-sm font-semibold'>
                        {formatCny(paymentAmount)}
                      </span>
                    )}
                  </div>
                </div>
                {belowMin ? (
                  <p className='text-destructive text-xs'>
                    {t('Minimum topup amount: {{amount}}', {
                      amount: formatUsd(minTopup),
                    })}
                  </p>
                ) : null}
              </div>

              <div className='space-y-2.5 sm:space-y-3'>
                <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Payment Method')}
                </Label>
                <Button
                  variant='outline'
                  onClick={onAlipayClick}
                  disabled={belowMin || !!paymentLoading || topupAmount <= 0}
                  className='h-10 w-full justify-center gap-2 rounded-lg sm:w-auto sm:px-6'
                >
                  {paymentLoading === 'alipay' ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    getPaymentIcon('alipay', 'h-4 w-4')
                  )}
                  <span>{t('Alipay')}</span>
                </Button>
              </div>
            </>
          )}
        </TitledCard>

        {redemptionEnabled ? (
          <TitledCard
            title={t('Redemption Code')}
            description={t('Have a code? Redeem it for credit')}
            icon={<Gift className='h-4 w-4' />}
            contentClassName='space-y-3'
          >
            <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
              <Input
                id='redemption-code'
                value={redemptionCode}
                onChange={(e) => onRedemptionCodeChange(e.target.value)}
                placeholder={t('Enter your redemption code')}
                className='h-9 min-w-0'
              />
              <Button
                onClick={onRedeem}
                disabled={redeeming || !redemptionCode.trim()}
                variant='outline'
                className='h-9 px-4'
              >
                {redeeming ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : null}
                {t('Redeem')}
              </Button>
            </div>
          </TitledCard>
        ) : (
          <TitledCard
            title={t('Redemption Code')}
            icon={<Gift className='h-4 w-4' />}
          >
            <Alert>
              <AlertDescription>
                {t(
                  'Redemption codes are disabled until the administrator confirms compliance terms.'
                )}
              </AlertDescription>
            </Alert>
          </TitledCard>
        )}
      </div>
    </div>
  )
}

function RechargeSkeleton() {
  return (
    <div className='space-y-4 sm:space-y-6'>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-16' />
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-[72px] rounded-lg' />
          ))}
        </div>
      </div>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-28' />
        <Skeleton className='h-10 w-full' />
      </div>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-32' />
        <Skeleton className='h-10 w-40 rounded-lg' />
      </div>
    </div>
  )
}
