import { Activity, BarChart3, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSystemConfigStore } from '@/stores/system-config-store'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatUsdAmount,
  quotaToUsdAmount,
  resolveQuotaPerUsd,
} from '../lib/usd-format'
import type { UserWalletData } from '../types'

interface WalletStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
}

export function WalletStatsCard(props: WalletStatsCardProps) {
  const { t } = useTranslation()
  const configuredQuotaPerUnit = useSystemConfigStore(
    (state) => state.config.currency.quotaPerUnit
  )
  const quotaPerUnit = resolveQuotaPerUsd(configuredQuotaPerUnit)

  if (props.loading) {
    return (
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className='bg-card ring-foreground/10 rounded-xl px-5 py-4 ring-1'
          >
            <Skeleton className='h-3.5 w-20' />
            <Skeleton className='mt-3 h-8 w-28' />
            <Skeleton className='mt-2 h-3 w-24' />
          </div>
        ))}
      </div>
    )
  }

  const stats = [
    {
      label: t('Current Balance'),
      value: formatUsdAmount(
        quotaToUsdAmount(props.user?.quota ?? 0, quotaPerUnit)
      ),
      description: t('Remaining quota'),
      icon: WalletCards,
      accent: true,
    },
    {
      label: t('Total Usage'),
      value: formatUsdAmount(
        quotaToUsdAmount(props.user?.used_quota ?? 0, quotaPerUnit)
      ),
      description: t('Total consumed quota'),
      icon: BarChart3,
      accent: false,
    },
    {
      label: t('API Requests'),
      value: (props.user?.request_count ?? 0).toLocaleString(),
      description: t('Total requests made'),
      icon: Activity,
      accent: false,
    },
  ]

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
      {stats.map((item) => (
        <div
          key={item.label}
          className='bg-card ring-foreground/10 flex flex-col gap-1 rounded-xl px-5 py-4 ring-1'
        >
          <div className='flex items-center gap-2'>
            <item.icon className='text-muted-foreground size-3.5 shrink-0' />
            <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {item.label}
            </span>
          </div>
          <div className='text-foreground mt-1 font-mono text-2xl font-bold tracking-tight tabular-nums sm:text-3xl'>
            {item.value}
          </div>
          <div className='text-muted-foreground text-xs'>
            {item.description}
          </div>
        </div>
      ))}
    </div>
  )
}
