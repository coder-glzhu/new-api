/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSystemConfigStore } from '@/stores/system-config-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/copy-button'
import {
  formatUsdAmount,
  quotaToTransferableUsdAmount,
  quotaToUsdAmount,
  resolveQuotaPerUsd,
} from '../lib/usd-format'
import type { UserWalletData } from '../types'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  affiliateLink: string
  onTransfer: () => void
  complianceConfirmed?: boolean
  loading?: boolean
}

export function AffiliateRewardsCard({
  user,
  affiliateLink,
  onTransfer,
  complianceConfirmed = true,
  loading,
}: AffiliateRewardsCardProps) {
  const { t } = useTranslation()
  const configuredQuotaPerUnit = useSystemConfigStore(
    (state) => state.config.currency.quotaPerUnit
  )
  const quotaPerUnit = resolveQuotaPerUsd(configuredQuotaPerUnit)

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

  const transferableAmount = quotaToTransferableUsdAmount(
    user?.aff_quota ?? 0,
    quotaPerUnit
  )
  const hasRewards = transferableAmount >= 1

  const stats = [
    {
      label: t('Pending'),
      value: formatUsdAmount(transferableAmount),
    },
    {
      label: t('Total Earned'),
      value: formatUsdAmount(
        quotaToUsdAmount(user?.aff_history_quota ?? 0, quotaPerUnit)
      ),
    },
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
          <Button
            onClick={onTransfer}
            disabled={!complianceConfirmed}
            className='h-9 shrink-0 px-3'
            size='sm'
          >
            {t('Transfer to Balance')}
          </Button>
        )}
      </div>
      {!complianceConfirmed ? (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Referral reward transfer is disabled until the administrator confirms compliance terms.'
          )}
        </p>
      ) : null}
    </div>
  )
}
