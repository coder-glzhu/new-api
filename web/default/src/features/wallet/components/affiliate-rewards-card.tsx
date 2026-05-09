import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/copy-button'
import type { UserWalletData } from '../types'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  affiliateLink: string
  onTransfer: () => void
  loading?: boolean
}

export function AffiliateRewardsCard({
  user,
  affiliateLink,
  onTransfer,
  loading,
}: AffiliateRewardsCardProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className='bg-card ring-foreground/10 rounded-xl p-5 ring-1'>
        <Skeleton className='h-5 w-32' />
        <div className='mt-4 flex gap-6'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='space-y-1.5'>
              <Skeleton className='h-3 w-14' />
              <Skeleton className='h-5 w-10' />
            </div>
          ))}
        </div>
        <Skeleton className='mt-4 h-9 w-full' />
      </div>
    )
  }

  const hasRewards = (user?.aff_quota ?? 0) > 0

  const stats = [
    { label: t('Pending'), value: formatQuota(user?.aff_quota ?? 0) },
    { label: t('Total Earned'), value: formatQuota(user?.aff_history_quota ?? 0) },
    { label: t('Invites'), value: String(user?.aff_count ?? 0) },
  ]

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
          <Share2 className='text-muted-foreground size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-semibold'>{t('Referral Program')}</h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t(
              'Earn rewards when your referrals add funds. Transfer accumulated rewards to your balance anytime.'
            )}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className='grid grid-cols-3 divide-x rounded-lg border'>
        {stats.map(({ label, value }) => (
          <div key={label} className='flex flex-col items-center py-3'>
            <span className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
              {label}
            </span>
            <span className='mt-1 text-sm font-semibold tabular-nums'>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Referral link */}
      <div className='flex items-center gap-2'>
        <Input
          value={affiliateLink}
          readOnly
          className='h-9 min-w-0 flex-1 font-mono text-xs'
        />
        <CopyButton
          value={affiliateLink}
          variant='outline'
          className='size-9 shrink-0'
          iconClassName='size-4'
          tooltip={t('Copy referral link')}
          aria-label={t('Copy referral link')}
        />
        {hasRewards && (
          <Button onClick={onTransfer} className='h-9 shrink-0 px-3' size='sm'>
            {t('Transfer to Balance')}
          </Button>
        )}
      </div>
    </div>
  )
}
