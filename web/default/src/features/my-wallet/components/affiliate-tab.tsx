import {
  ArrowRight,
  Coins,
  PiggyBank,
  Share2,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { CopyButton } from '@/components/copy-button'
import type { UserWalletData } from '../types'

interface AffiliateTabProps {
  user: UserWalletData | null
  affiliateLink: string
  onTransfer: () => void
  complianceConfirmed: boolean
  loading?: boolean
}

export function AffiliateTab({
  user,
  affiliateLink,
  onTransfer,
  complianceConfirmed,
  loading,
}: AffiliateTabProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
        <Skeleton className='h-48 rounded-xl' />
        <Skeleton className='h-48 rounded-xl' />
      </div>
    )
  }

  const pending = user?.aff_quota ?? 0
  const totalEarned = user?.aff_history_quota ?? 0
  const inviteCount = user?.aff_count ?? 0
  const hasRewards = pending > 0

  const stats: Array<{
    label: string
    value: string
    description: string
    icon: typeof Coins
    accent: string
  }> = [
    {
      label: t('Pending'),
      value: formatQuota(pending),
      description: t('Available to transfer'),
      icon: Coins,
      accent: 'text-warning bg-warning/10',
    },
    {
      label: t('Total Earned'),
      value: formatQuota(totalEarned),
      description: t('Lifetime referral rewards'),
      icon: PiggyBank,
      accent: 'text-success bg-success/10',
    },
    {
      label: t('Invites'),
      value: String(inviteCount),
      description: t('Total invited users'),
      icon: Users,
      accent: 'text-info bg-info/10',
    },
  ]

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start'>
      <TitledCard
        title={t('Referral Program')}
        description={t(
          'Earn rewards when your referrals add funds. Transfer accumulated rewards to your balance anytime.'
        )}
        icon={<Share2 className='h-4 w-4' />}
        contentClassName='space-y-3'
      >
        <div className='grid grid-cols-3 gap-2 sm:gap-3'>
          {stats.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.label}
                className='bg-muted/30 flex flex-col gap-2 rounded-lg border p-3'
              >
                <div
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md',
                    item.accent
                  )}
                >
                  <Icon className='size-3.5' />
                </div>
                <div className='space-y-0.5'>
                  <div className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
                    {item.label}
                  </div>
                  <div className='truncate text-base font-bold tabular-nums sm:text-lg'>
                    {item.value}
                  </div>
                  <div className='text-muted-foreground/70 hidden truncate text-[11px] sm:block'>
                    {item.description}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className='bg-muted/20 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3'>
          <div className='min-w-0 flex-1'>
            <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
              {t('Available to transfer')}
            </div>
            <div className='mt-0.5 truncate font-mono text-lg font-bold tabular-nums'>
              {formatQuota(pending)}
            </div>
          </div>
          <Button
            onClick={onTransfer}
            disabled={!complianceConfirmed || !hasRewards}
            className='gap-1.5 sm:w-auto'
            size='sm'
          >
            {t('Transfer to Balance')}
            <ArrowRight className='size-3.5' />
          </Button>
        </div>

        {!complianceConfirmed ? (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Referral reward transfer is disabled until the administrator confirms compliance terms.'
            )}
          </p>
        ) : null}
      </TitledCard>

      <TitledCard
        title={t('Your Referral Link')}
        description={t('Share this link to earn rewards')}
        icon={<Share2 className='h-4 w-4' />}
        contentClassName='space-y-3'
      >
        <div className='flex items-center gap-2'>
          <Input
            value={affiliateLink}
            readOnly
            className='border-muted bg-background h-9 min-w-0 flex-1 font-mono text-xs'
          />
          <CopyButton
            value={affiliateLink}
            variant='outline'
            className='bg-background size-9 shrink-0'
            iconClassName='size-4'
            tooltip={t('Copy referral link')}
            aria-label={t('Copy referral link')}
          />
        </div>

        <div className='bg-muted/20 space-y-2 rounded-lg border p-3 text-xs'>
          <div className='text-muted-foreground font-medium'>
            {t('How it works')}
          </div>
          <ol className='text-muted-foreground space-y-1.5 pl-4 [list-style:decimal]'>
            <li>{t('Share your referral link with friends')}</li>
            <li>
              {t(
                'Earn rewards when your referrals add funds. Transfer accumulated rewards to your balance anytime.'
              )}
            </li>
            <li>
              {t(
                'Use the Transfer to Balance button when your pending rewards reach the minimum threshold.'
              )}
            </li>
          </ol>
        </div>
      </TitledCard>
    </div>
  )
}
