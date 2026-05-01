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
      <DialogContent className='flex max-h-[calc(100dvh-2rem)] flex-col max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{t('Billing History')}</DialogTitle>
          <DialogDescription>
            {t('View your topup transaction records and payment history')}
          </DialogDescription>
        </DialogHeader>

        <BillingHistoryList />
      </DialogContent>
    </Dialog>
  )
}
