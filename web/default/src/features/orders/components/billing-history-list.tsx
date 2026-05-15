import { Search, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import { useBillingHistory } from '@/features/wallet/hooks/use-billing-history'
import {
  formatTimestamp,
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'

interface BillingHistoryListProps {
  scrollAreaClassName?: string
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
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder={t('Search by order number...')}
            value={keyword}
            onChange={(event) => handleSearch(event.target.value)}
            className='pl-10'
          />
        </div>
        <Select
          items={[
            { value: '10', label: t('10 / page') },
            { value: '20', label: t('20 / page') },
            { value: '50', label: t('50 / page') },
            { value: '100', label: t('100 / page') },
          ]}
          value={pageSize.toString()}
          onValueChange={(value) =>
            value !== null && handlePageSizeChange(parseInt(value, 10))
          }
        >
          <SelectTrigger className='w-32'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value='10'>{t('10 / page')}</SelectItem>
              <SelectItem value='20'>{t('20 / page')}</SelectItem>
              <SelectItem value='50'>{t('50 / page')}</SelectItem>
              <SelectItem value='100'>{t('100 / page')}</SelectItem>
            </SelectGroup>
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
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </div>

      <ScrollArea className={scrollAreaClassName}>
        {loading ? (
          <div className='space-y-3'>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className='rounded-lg border p-4'>
                <Skeleton className='h-4 w-48' />
                <Skeleton className='mt-3 h-3 w-full' />
                <Skeleton className='mt-2 h-3 w-3/4' />
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className='text-muted-foreground flex h-[360px] items-center justify-center text-sm'>
            {t('No billing records found')}
          </div>
        ) : (
          <div className='space-y-3'>
            {records.map((record) => {
              const status = getStatusConfig(record.status)
              return (
                <div
                  key={record.id}
                  className='hover:bg-muted/50 rounded-lg border p-4 transition-colors'
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <code className='block truncate font-mono text-sm'>
                        {record.trade_no}
                      </code>
                      <div className='text-muted-foreground mt-1 text-xs'>
                        {formatTimestamp(record.create_time)}
                      </div>
                    </div>
                    <StatusBadge
                      label={status.label}
                      variant={status.variant}
                      showDot
                      copyable={false}
                    />
                  </div>

                  <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3'>
                    <div className='space-y-1'>
                      <Label className='text-muted-foreground text-xs'>
                        {t('Payment Method')}
                      </Label>
                      <div className='text-sm font-medium'>
                        {getPaymentMethodName(record.payment_method, t)}
                      </div>
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-muted-foreground text-xs'>
                        {t('Amount')}
                      </Label>
                      <div className='text-sm font-semibold'>
                        {formatCurrencyFromUSD(record.amount, {
                          digitsLarge: 2,
                          digitsSmall: 2,
                          abbreviate: false,
                        })}
                      </div>
                    </div>
                    <div className='space-y-1'>
                      <Label className='text-muted-foreground text-xs'>
                        {t('Payment')}
                      </Label>
                      <div className='text-sm font-semibold'>
                        {formatNumber(record.money)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {totalPages > 1 ? (
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-sm'>
            {t('Page {{page}} of {{total}}', { page, total: totalPages })}
          </span>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              {t('Previous')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
