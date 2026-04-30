import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Copy, CheckCircle2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

export type HupijiaoPaymentData = {
  order_id?: string
  qrcode_url?: string
  pay_url?: string
  trade_no?: string
  create_time?: number
}

interface HupijiaoPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  payment: HupijiaoPaymentData | null
  amount?: number
  amountLabel?: string
  expiresInSeconds?: number
  onExpired?: () => void
}

const DEFAULT_PAYMENT_EXPIRES_IN_SECONDS = 3 * 60

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function HupijiaoPaymentDialog({
  open,
  onOpenChange,
  payment,
  amount,
  amountLabel,
  expiresInSeconds = DEFAULT_PAYMENT_EXPIRES_IN_SECONDS,
  onExpired,
}: HupijiaoPaymentDialogProps) {
  const { t } = useTranslation()
  const payUrl = payment?.pay_url || ''
  const qrcodeUrl = payment?.qrcode_url || ''
  const orderId = payment?.order_id || payment?.trade_no || ''
  const expiresAt = useMemo(() => {
    if (!payment?.create_time) return null
    return payment.create_time + expiresInSeconds
  }, [expiresInSeconds, payment?.create_time])
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const expired = remainingSeconds != null && remainingSeconds <= 0

  useEffect(() => {
    if (!open || !expiresAt) {
      setRemainingSeconds(null)
      return
    }

    let notified = false
    const updateRemaining = () => {
      const nextRemaining = Math.max(
        0,
        expiresAt - Math.floor(Date.now() / 1000)
      )
      setRemainingSeconds(nextRemaining)
      if (nextRemaining <= 0 && !notified) {
        notified = true
        onExpired?.()
      }
    }

    updateRemaining()
    const timer = window.setInterval(updateRemaining, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt, onExpired, open])

  const handleCopy = async (value: string) => {
    if (!value) return
    const copied = await copyToClipboard(value)
    if (copied) {
      toast.success(t('Copied'))
    } else {
      toast.error(t('Copy failed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <CheckCircle2 className='text-primary h-5 w-5' />
            {t('Alipay Payment')}
          </DialogTitle>
          <DialogDescription>
            {t('Scan the QR code or open the payment link to complete payment')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='bg-muted/30 flex justify-center rounded-lg border p-4'>
            {qrcodeUrl ? (
              <img
                src={qrcodeUrl}
                alt={t('Alipay QR code')}
                className='h-56 w-56 rounded-md bg-white object-contain p-2'
              />
            ) : payUrl ? (
              <div className='rounded-md bg-white p-3'>
                <QRCodeSVG value={payUrl} size={208} />
              </div>
            ) : (
              <div className='text-muted-foreground flex h-56 w-56 items-center justify-center text-sm'>
                {t('No QR code available')}
              </div>
            )}
          </div>

          <div className='rounded-lg border'>
            {amount != null && amount > 0 && (
              <>
                <div className='flex items-center justify-between px-3 py-2 text-sm'>
                  <span className='text-muted-foreground'>
                    {t('Amount Due')}
                  </span>
                  <span className='font-medium'>
                    {amountLabel || `¥${amount.toFixed(2)}`}
                  </span>
                </div>
                <Separator />
              </>
            )}
            {remainingSeconds != null && (
              <>
                <div className='flex items-center justify-between px-3 py-2 text-sm'>
                  <span className='text-muted-foreground'>剩余支付时间</span>
                  <span
                    className={
                      expired
                        ? 'font-medium text-red-600'
                        : 'font-mono font-medium'
                    }
                  >
                    {expired ? '已过期' : formatCountdown(remainingSeconds)}
                  </span>
                </div>
                <Separator />
              </>
            )}
            {orderId && (
              <div className='flex items-center justify-between gap-3 px-3 py-2 text-sm'>
                <span className='text-muted-foreground shrink-0'>
                  {t('Order ID')}
                </span>
                <button
                  type='button'
                  className='truncate text-right font-mono text-xs underline-offset-4 hover:underline'
                  onClick={() => handleCopy(orderId)}
                >
                  {orderId}
                </button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className='gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => handleCopy(payUrl)}
            disabled={!payUrl || expired}
          >
            <Copy className='mr-2 h-4 w-4' />
            {t('Copy Link')}
          </Button>
          <Button
            type='button'
            onClick={() => window.open(payUrl, '_blank')}
            disabled={!payUrl || expired}
          >
            <ExternalLink className='mr-2 h-4 w-4' />
            {t('Open Payment Link')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
