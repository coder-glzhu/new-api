import { useEffect, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatCnyCurrencyAmount, formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import { StatusBadge } from '@/components/status-badge'
import {
  cancelTopupOrder,
  getHupijiaoTopupOrderStatus,
  isApiSuccess,
  repayHupijiaoTopupOrder,
} from '../api'
import { useBillingHistory } from '../hooks/use-billing-history'
import {
  formatTimestamp,
  getPaymentMethodName,
  getStatusConfig,
} from '../lib/billing'
import type { TopupRecord } from '../types'

interface BillingHistoryListProps {
  scrollAreaClassName?: string
}

const HUPIJIAO_PAYMENT_EXPIRE_SECONDS = 3 * 60

function formatActualPayment(record: TopupRecord): string {
  const currency = record.payment_currency?.toUpperCase()
  if (currency === 'CNY') {
    return `${formatCnyCurrencyAmount(record.money, {
      digitsLarge: 2,
      digitsSmall: 2,
      abbreviate: false,
    })} CNY`
  }
  if (currency === 'USD') {
    return `$${formatNumber(record.money)} USD`
  }
  return currency
    ? `${formatNumber(record.money)} ${currency}`
    : formatNumber(record.money)
}

function getDisplayOrderNo(record: TopupRecord): string {
  return record.open_order_id || record.trade_no
}

function getOrderContent(record: TopupRecord): string {
  if (record.order_type === 'subscription') {
    return record.order_title || '订阅套餐'
  }
  return formatCurrencyFromUSD(record.amount, {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
  })
}

function getOrderStatusLabel(status: TopupRecord['status']): string {
  switch (status) {
    case 'success':
      return '已支付'
    case 'pending':
      return '未支付'
    case 'expired':
      return '已过期'
    case 'canceled':
      return '已取消'
    case 'failed':
      return '支付失败'
    default:
      return String(status)
  }
}

function getEffectiveOrderStatus(record: TopupRecord): TopupRecord['status'] {
  if (
    record.status === 'pending' &&
    record.payment_provider === 'hupijiao' &&
    record.create_time + HUPIJIAO_PAYMENT_EXPIRE_SECONDS <=
      Math.floor(Date.now() / 1000)
  ) {
    return 'expired'
  }
  return record.status
}

export function BillingHistoryList({
  scrollAreaClassName = 'h-[500px] pr-4',
}: BillingHistoryListProps) {
  const { t } = useTranslation()
  const {
    records,
    total,
    page,
    pageSize,
    keyword,
    loading,
    handlePageChange,
    handlePageSizeChange,
    handleSearch,
    refresh,
  } = useBillingHistory()

  const { copyToClipboard, copiedText } = useCopyToClipboard({ notify: false })
  const [payingTradeNo, setPayingTradeNo] = useState<string | null>(null)
  const [cancelingTradeNo, setCancelingTradeNo] = useState<string | null>(null)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentData, setPaymentData] = useState<{
    order_id?: string
    qrcode_url?: string
    pay_url?: string
    trade_no?: string
    create_time?: number
  } | null>(null)
  const [paymentRecord, setPaymentRecord] = useState<TopupRecord | null>(null)

  const totalPages = Math.ceil(total / pageSize)

  useEffect(() => {
    if (!paymentDialogOpen || !paymentData?.trade_no) {
      return
    }

    let stopped = false
    let attempts = 0

    const pollOrder = async () => {
      if (stopped) return
      attempts += 1

      try {
        const response = await getHupijiaoTopupOrderStatus(
          paymentData.trade_no || '',
          paymentData.order_id
        )

        if (isApiSuccess(response) && response.data?.paid) {
          stopped = true
          setPaymentDialogOpen(false)
          setPaymentData(null)
          setPaymentRecord(null)
          await refresh()
          toast.success(t('Payment successful'))
        } else if (
          isApiSuccess(response) &&
          response.data?.status === 'expired'
        ) {
          stopped = true
          setPaymentDialogOpen(false)
          setPaymentData(null)
          setPaymentRecord(null)
          await refresh()
          toast.error('订单已过期，请重新下单')
        }
      } catch {
        // Webhook can still complete the order; keep polling quietly.
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
    paymentData?.order_id,
    paymentData?.trade_no,
    paymentDialogOpen,
    refresh,
    t,
  ])

  const handlePayOrder = async (record: TopupRecord) => {
    if (record.payment_provider !== 'hupijiao') {
      toast.error('该订单暂不支持重新支付')
      return
    }

    setPayingTradeNo(record.trade_no)
    try {
      const response = await repayHupijiaoTopupOrder(record.trade_no)
      if (!isApiSuccess(response)) {
        toast.error(response.message || t('Payment request failed'))
        return
      }
      if (response.data?.paid) {
        await refresh()
        toast.success(t('Payment successful'))
        return
      }
      if (!response.data) {
        toast.error(response.message || t('Payment request failed'))
        return
      }
      setPaymentData({
        ...response.data,
        create_time: record.create_time,
      })
      setPaymentRecord(record)
      setPaymentDialogOpen(true)
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPayingTradeNo(null)
    }
  }

  const handleCancelOrder = async (record: TopupRecord) => {
    if (record.status !== 'pending') {
      return
    }

    setCancelingTradeNo(record.trade_no)
    try {
      const response = await cancelTopupOrder(record.trade_no)
      if (!isApiSuccess(response)) {
        toast.error(response.message || '取消订单失败')
        return
      }
      await refresh()
      toast.success(response.message || '订单已取消')
    } catch {
      toast.error('取消订单失败')
    } finally {
      setCancelingTradeNo(null)
    }
  }

  return (
    <>
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <div className='relative flex-1'>
            <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
            <Input
              placeholder={t('Search by order number...')}
              value={keyword}
              onChange={(e) => handleSearch(e.target.value)}
              className='pl-10'
            />
          </div>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              if (value) handlePageSizeChange(parseInt(value, 10))
            }}
          >
            <SelectTrigger className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='10'>{t('10 / page')}</SelectItem>
              <SelectItem value='20'>{t('20 / page')}</SelectItem>
              <SelectItem value='50'>{t('50 / page')}</SelectItem>
              <SelectItem value='100'>{t('100 / page')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant='outline'
            size='icon'
            onClick={refresh}
            disabled={loading}
            title={t('Refresh')}
            aria-label={t('Refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <ScrollArea className={scrollAreaClassName}>
          {loading ? (
            <div className='space-y-3'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className='rounded-lg border p-4'>
                  <div className='flex items-start justify-between'>
                    <div className='flex-1 space-y-2'>
                      <Skeleton className='h-4 w-48' />
                      <Skeleton className='h-3 w-32' />
                    </div>
                    <Skeleton className='h-5 w-16' />
                  </div>
                  <div className='mt-3 grid grid-cols-3 gap-4'>
                    <Skeleton className='h-3 w-full' />
                    <Skeleton className='h-3 w-full' />
                    <Skeleton className='h-3 w-full' />
                  </div>
                </div>
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className='text-muted-foreground flex h-[400px] flex-col items-center justify-center text-center'>
              <p className='text-sm font-medium'>
                {t('No billing records found')}
              </p>
              <p className='mt-1 text-xs'>
                {keyword
                  ? t('Try adjusting your search')
                  : t('Your transaction history will appear here')}
              </p>
            </div>
          ) : (
            <div className='space-y-3'>
              {records.map((record) => {
                const effectiveStatus = getEffectiveOrderStatus(record)
                const statusConfig = getStatusConfig(effectiveStatus)
                const displayOrderNo = getDisplayOrderNo(record)
                const isPending = effectiveStatus === 'pending'
                const canRepay =
                  isPending && record.payment_provider === 'hupijiao'
                return (
                  <div
                    key={record.id}
                    className='hover:border-primary/30 hover:bg-muted/30 bg-card rounded-lg border p-4 transition-colors'
                  >
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
                          <span className='text-muted-foreground text-xs'>
                            订单号
                          </span>
                          <code className='text-foreground max-w-full truncate font-mono text-sm font-semibold'>
                            {displayOrderNo}
                          </code>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-5 w-5 shrink-0 p-0'
                            onClick={() => copyToClipboard(displayOrderNo)}
                          >
                            {copiedText === displayOrderNo ? (
                              <Check className='h-3 w-3' />
                            ) : (
                              <Copy className='h-3 w-3' />
                            )}
                          </Button>
                          <span className='text-muted-foreground hidden text-xs sm:inline'>
                            |
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            下单时间 {formatTimestamp(record.create_time)}
                          </span>
                        </div>
                      </div>
                      <div className='flex shrink-0 items-center justify-between gap-2 sm:justify-end'>
                        <StatusBadge
                          label={getOrderStatusLabel(effectiveStatus)}
                          variant={statusConfig.variant}
                          showDot
                          copyable={false}
                        />
                      </div>
                    </div>

                    <div className='bg-muted/25 mt-4 grid grid-cols-1 gap-3 rounded-md p-3 sm:grid-cols-2 lg:grid-cols-4'>
                      <div className='space-y-1'>
                        <Label className='text-muted-foreground text-xs'>
                          订单类型
                        </Label>
                        <div className='text-sm font-medium'>
                          {record.order_type === 'subscription'
                            ? t('Subscription')
                            : t('Top-up')}
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-muted-foreground text-xs'>
                          订单内容
                        </Label>
                        <div className='text-sm font-semibold'>
                          {getOrderContent(record)}
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-muted-foreground text-xs'>
                          {t('Payment Method')}
                        </Label>
                        <div className='text-sm font-medium'>
                          {t(
                            getPaymentMethodName(
                              record.payment_method,
                              record.payment_provider
                            )
                          )}
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <Label className='text-muted-foreground text-xs'>
                          实际支付
                        </Label>
                        <div className='text-sm font-semibold text-red-600'>
                          {formatActualPayment(record)}
                        </div>
                      </div>
                    </div>

                    {isPending && (
                      <div className='mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => handleCancelOrder(record)}
                          disabled={cancelingTradeNo === record.trade_no}
                          className='w-full sm:w-auto'
                        >
                          <X className='h-4 w-4' />
                          {cancelingTradeNo === record.trade_no
                            ? '取消中...'
                            : '取消订单'}
                        </Button>
                        {canRepay && (
                          <Button
                            size='sm'
                            onClick={() => handlePayOrder(record)}
                            disabled={payingTradeNo === record.trade_no}
                            className='w-full sm:w-auto'
                          >
                            {payingTradeNo === record.trade_no
                              ? '处理中...'
                              : '去支付'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {!loading && records.length > 0 && (
          <div className='flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
            <div className='text-muted-foreground text-xs sm:text-sm'>
              {t('Showing')} {(page - 1) * pageSize + 1}-
              {Math.min(page * pageSize, total)} {t('of')} {total}
            </div>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className='h-8 w-8 p-0'
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                <span className='font-medium'>{page}</span>
                <span>/</span>
                <span>{totalPages}</span>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className='h-8 w-8 p-0'
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </div>

      <HupijiaoPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        payment={paymentData}
        amount={paymentRecord?.money}
        amountLabel={
          paymentRecord ? formatActualPayment(paymentRecord) : undefined
        }
        onExpired={async () => {
          setPaymentDialogOpen(false)
          setPaymentData(null)
          setPaymentRecord(null)
          await refresh()
          toast.error('订单已过期，请重新下单')
        }}
      />
    </>
  )
}
