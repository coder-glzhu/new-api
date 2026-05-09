import { Gift, ExternalLink, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface RedemptionCodeCardProps {
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
}

export function RedemptionCodeCard({
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  topupLink,
}: RedemptionCodeCardProps) {
  const { t } = useTranslation()

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      <div className='flex items-center gap-3'>
        <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
          <Gift className='text-muted-foreground size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-semibold'>{t('Redemption Code')}</h3>
          {topupLink && (
            <a
              href={topupLink}
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline'
            >
              {t('Purchase here')}
              <ExternalLink className='h-3 w-3' />
            </a>
          )}
        </div>
      </div>

      <div className='flex gap-2'>
        <Input
          id='redemption-code'
          value={redemptionCode}
          onChange={(e) => onRedemptionCodeChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !redeeming && onRedeem()}
          placeholder={t('Enter your redemption code')}
          className='h-9 min-w-0 flex-1 text-sm'
        />
        <Button
          onClick={onRedeem}
          disabled={redeeming || !redemptionCode.trim()}
          variant='outline'
          className='h-9 shrink-0 px-4'
        >
          {redeeming && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}
          {t('Redeem')}
        </Button>
      </div>
    </div>
  )
}
