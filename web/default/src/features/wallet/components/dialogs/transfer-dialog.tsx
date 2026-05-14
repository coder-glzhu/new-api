import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSystemConfigStore } from '@/stores/system-config-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  floorUsdToCents,
  formatUsdAmount,
  MIN_TRANSFER_AMOUNT_USD,
  quotaToTransferableUsdAmount,
  resolveQuotaPerUsd,
} from '../../lib/usd-format'

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (amount: number) => Promise<boolean>
  availableQuota: number
  transferring: boolean
}

export function TransferDialog({
  open,
  onOpenChange,
  onConfirm,
  availableQuota,
  transferring,
}: TransferDialogProps) {
  const { t } = useTranslation()
  const configuredQuotaPerUnit = useSystemConfigStore(
    (state) => state.config.currency.quotaPerUnit
  )
  const quotaPerUnit = resolveQuotaPerUsd(configuredQuotaPerUnit)
  const [amountInput, setAmountInput] = useState('1.00')
  const amount = Number(amountInput)
  const normalizedAmount = floorUsdToCents(amount)
  const availableAmount = quotaToTransferableUsdAmount(
    availableQuota,
    quotaPerUnit
  )
  const canTransfer =
    !transferring &&
    Number.isFinite(normalizedAmount) &&
    normalizedAmount >= MIN_TRANSFER_AMOUNT_USD &&
    normalizedAmount <= availableAmount

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmountInput(MIN_TRANSFER_AMOUNT_USD.toFixed(2))
    }
  }, [open])

  const handleConfirm = async () => {
    if (!canTransfer) return
    setAmountInput(normalizedAmount.toFixed(2))
    const success = await onConfirm(normalizedAmount)
    if (success) {
      onOpenChange(false)
    }
  }

  const handleAmountBlur = () => {
    if (!Number.isFinite(normalizedAmount)) return
    setAmountInput(normalizedAmount.toFixed(2))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='text-xl font-semibold'>
            {t('Transfer Rewards')}
          </DialogTitle>
          <DialogDescription>
            {t('Move affiliate rewards to your main balance')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-3 sm:space-y-6 sm:py-4'>
          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Available Rewards')}
            </Label>
            <div className='text-2xl font-semibold'>
              {formatUsdAmount(availableAmount)}
            </div>
          </div>

          <div className='space-y-3'>
            <Label
              htmlFor='transfer-amount'
              className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
            >
              {t('Transfer Amount (USD)')}
            </Label>
            <Input
              id='transfer-amount'
              type='number'
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onBlur={handleAmountBlur}
              min={MIN_TRANSFER_AMOUNT_USD}
              max={availableAmount}
              step='0.01'
              inputMode='decimal'
              className='font-mono text-lg'
            />
            <p className='text-muted-foreground text-xs'>
              {t('Minimum:')} {formatUsdAmount(MIN_TRANSFER_AMOUNT_USD)}
            </p>
          </div>
        </div>

        <DialogFooter className='grid grid-cols-2 gap-2 sm:flex'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={transferring}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!canTransfer}>
            {transferring && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
