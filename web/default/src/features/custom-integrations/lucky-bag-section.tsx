import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import type { CustomIntegrationSettings } from './types'

type Props = {
  defaultValues: CustomIntegrationSettings
}

const DEFAULT_SERIALIZED = '9,12,17'

// 把 "9,12,17:52" 解析为 ["09:00", "12:00", "17:52"]（Input[type=time] 要求 HH:MM）
function parseTimeList(raw: string): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const p of raw.split(',')) {
    const part = p.trim()
    if (!part) continue
    let hStr = part
    let mStr = '0'
    const idx = part.indexOf(':')
    if (idx >= 0) {
      hStr = part.slice(0, idx).trim()
      mStr = part.slice(idx + 1).trim()
    }
    const h = Number(hStr)
    const m = Number(mStr)
    if (!Number.isInteger(h) || h < 0 || h > 23) continue
    if (!Number.isInteger(m) || m < 0 || m > 59) continue
    const key = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  result.sort()
  return result
}

// 把 ["09:00", "17:52"] 序列化为 "9,17:52"（整点省略分钟，后端解析两种格式都支持）
function serializeTimeList(items: string[]): string {
  return items
    .filter((t) => /^\d{2}:\d{2}$/.test(t))
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`
    })
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort((a, b) => {
      const aKey = a.includes(':') ? Number(a.split(':')[0]) * 60 + Number(a.split(':')[1]) : Number(a) * 60
      const bKey = b.includes(':') ? Number(b.split(':')[0]) * 60 + Number(b.split(':')[1]) : Number(b) * 60
      return aKey - bKey
    })
    .join(',')
}

export function LuckyBagSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const [times, setTimes] = useState<string[]>(() =>
    parseTimeList(defaultValues.LuckyBagDrawHours || DEFAULT_SERIALIZED)
  )
  const [baseline, setBaseline] = useState<string>(() =>
    serializeTimeList(parseTimeList(defaultValues.LuckyBagDrawHours || DEFAULT_SERIALIZED))
  )

  const [minUsd, setMinUsd] = useState<string>(defaultValues.LuckyBagMinUsd || '1')
  const [maxUsd, setMaxUsd] = useState<string>(defaultValues.LuckyBagMaxUsd || '10')
  const [minBaseline, setMinBaseline] = useState<string>(defaultValues.LuckyBagMinUsd || '1')
  const [maxBaseline, setMaxBaseline] = useState<string>(defaultValues.LuckyBagMaxUsd || '10')

  useEffect(() => {
    const next = parseTimeList(defaultValues.LuckyBagDrawHours || DEFAULT_SERIALIZED)
    setTimes(next)
    setBaseline(serializeTimeList(next))
  }, [defaultValues.LuckyBagDrawHours])

  useEffect(() => {
    setMinUsd(defaultValues.LuckyBagMinUsd || '1')
    setMinBaseline(defaultValues.LuckyBagMinUsd || '1')
  }, [defaultValues.LuckyBagMinUsd])

  useEffect(() => {
    setMaxUsd(defaultValues.LuckyBagMaxUsd || '10')
    setMaxBaseline(defaultValues.LuckyBagMaxUsd || '10')
  }, [defaultValues.LuckyBagMaxUsd])

  const handleChange = (idx: number, value: string) => {
    setTimes((prev) => prev.map((v, i) => (i === idx ? value : v)))
  }

  const handleAdd = () => {
    setTimes((prev) => [...prev, '12:00'])
  }

  const handleRemove = (idx: number) => {
    setTimes((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    const cleaned = times.filter((t) => /^\d{2}:\d{2}$/.test(t))
    if (cleaned.length === 0) {
      toast.error(t('Please add at least one draw time'))
      return
    }
    const uniq = Array.from(new Set(cleaned))
    const serialized = serializeTimeList(uniq)

    const minN = Number(minUsd)
    const maxN = Number(maxUsd)
    if (!Number.isFinite(minN) || minN <= 0) {
      toast.error(t('Minimum prize must be a positive number'))
      return
    }
    if (!Number.isFinite(maxN) || maxN < minN) {
      toast.error(t('Maximum prize must be greater than or equal to minimum'))
      return
    }

    const timeChanged = serialized !== baseline
    const minChanged = minUsd !== minBaseline
    const maxChanged = maxUsd !== maxBaseline

    if (!timeChanged && !minChanged && !maxChanged) {
      toast.info(t('No changes to save'))
      return
    }

    if (timeChanged) {
      await updateOption.mutateAsync({ key: 'LuckyBagDrawHours', value: serialized })
      setBaseline(serialized)
    }
    if (minChanged) {
      await updateOption.mutateAsync({ key: 'LuckyBagMinUsd', value: String(minN) })
      setMinBaseline(String(minN))
    }
    if (maxChanged) {
      await updateOption.mutateAsync({ key: 'LuckyBagMaxUsd', value: String(maxN) })
      setMaxBaseline(String(maxN))
    }
    toast.success(t('Saved'))
  }

  return (
    <SettingsSection
      title={t('Lucky Bag Draw Times')}
      description={t('Configure when lucky bag draws run each day')}
    >
      <div className='space-y-4'>
        <Label>{t('Draw times')}</Label>
        <p className='text-muted-foreground -mt-2 text-xs'>
          {t('Click a time to edit it. Changes take effect from the next minute.')}
        </p>
        <div className='flex flex-wrap gap-2'>
          {times.map((tm, idx) => (
            <div
              key={idx}
              className='bg-muted/50 flex items-center gap-1 rounded-md border pl-2 pr-1 py-1'
            >
              <Input
                type='time'
                value={tm}
                onChange={(e) => handleChange(idx, e.target.value)}
                className='h-7 w-24 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0'
              />
              <button
                type='button'
                onClick={() => handleRemove(idx)}
                className='text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-sm transition-colors cursor-pointer'
                aria-label={t('Remove')}
              >
                <X className='size-3.5' />
              </button>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={handleAdd}
            className='h-9 gap-1'
          >
            <Plus className='size-3.5' />
            {t('Add draw time')}
          </Button>
        </div>

        <div className='border-t pt-4 space-y-3'>
          <Label>{t('Prize range (USD)')}</Label>
          <p className='text-muted-foreground -mt-2 text-xs'>
            {t('Winner receives a random amount within this range. Applies to newly created draw sessions.')}
          </p>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-sm'>$</span>
              <Input
                type='number'
                min='0'
                step='0.1'
                value={minUsd}
                onChange={(e) => setMinUsd(e.target.value)}
                className='h-9 w-24'
              />
            </div>
            <span className='text-muted-foreground text-sm'>~</span>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-sm'>$</span>
              <Input
                type='number'
                min='0'
                step='0.1'
                value={maxUsd}
                onChange={(e) => setMaxUsd(e.target.value)}
                className='h-9 w-24'
              />
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={updateOption.isPending}>
          {updateOption.isPending ? t('Saving...') : t('Save')}
        </Button>
      </div>
    </SettingsSection>
  )
}
