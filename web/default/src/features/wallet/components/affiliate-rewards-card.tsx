import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
      <Card className='bg-muted/20 py-0'>
        <CardContent className='flex flex-col gap-3 p-3 sm:p-4'>
          <Skeleton className='h-8 w-full' />
          <Skeleton className='h-8 w-full' />
        </CardContent>
      </Card>
    )
  }

  const hasRewards = (user?.aff_quota ?? 0) > 0

  return (
    <Card className='bg-muted/20 py-0'>
      <CardContent className='flex flex-col gap-3 p-3 sm:p-4'>
        {/* 标题行 + 统计数字 */}
        <div className='flex items-center gap-2.5'>
          <div className='bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border'>
            <Share2 className='text-muted-foreground size-4' />
          </div>
          <div className='min-w-0 flex-1'>
            <h3 className='text-sm font-semibold'>{t('Referral Program')}</h3>
            <p className='text-muted-foreground line-clamp-1 text-xs'>
              {t(
                'Earn rewards when your referrals add funds. Transfer accumulated rewards to your balance anytime.'
              )}
            </p>
          </div>
          <div className='flex shrink-0 gap-3 text-center'>
            {[
              [t('Pending'), formatQuota(user?.aff_quota ?? 0)],
              [t('Total Earned'), formatQuota(user?.aff_history_quota ?? 0)],
              [t('Invites'), String(user?.aff_count ?? 0)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
                  {label}
                </div>
                <div className='mt-0.5 text-sm font-semibold tabular-nums'>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 推荐链接 */}
        <div className='flex items-center gap-2'>
          <Input
            value={affiliateLink}
            readOnly
            className='border-muted bg-background/70 h-9 min-w-0 flex-1 font-mono text-xs'
          />
          <CopyButton
            value={affiliateLink}
            variant='outline'
            className='bg-background size-9 shrink-0'
            iconClassName='size-4'
            tooltip={t('Copy referral link')}
            aria-label={t('Copy referral link')}
          />
          {hasRewards && (
            <Button
              onClick={onTransfer}
              className='h-9 shrink-0 px-3'
              size='sm'
            >
              {t('Transfer to Balance')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
