import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BillingHistoryList } from '../billing-history-list'

interface BillingHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BillingHistoryDialog({
  open,
  onOpenChange,
}: BillingHistoryDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl'>
        <DialogHeader>
          <DialogTitle>我的订单</DialogTitle>
          <DialogDescription>
            {t('View your topup transaction records and payment history')}
          </DialogDescription>
        </DialogHeader>

        <BillingHistoryList />
      </DialogContent>
    </Dialog>
  )
}
