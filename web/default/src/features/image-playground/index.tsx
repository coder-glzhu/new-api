import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ImageIcon, KeyRound, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getApiKeys, fetchTokenKey } from '@/features/keys/api'
import type { ApiKey } from '@/features/keys/types'
import { useImagePlaygroundStore } from './store'

const STORAGE_KEY = 'image_playground_selected_key_id'
const IMAGE_PLAYGROUND_BASE = 'https://aiproxy.chydocx.cn/image/'
const API_URL = 'https://aiproxy.chydocx.cn/v1'
const MODEL = 'gpt-image-2'

function isKeyUsable(key: ApiKey) {
  return key.status === 1 && (key.unlimited_quota || key.remain_quota > 0)
}

/**
 * Mounted inside AuthenticatedLayout, always in the DOM.
 * Hidden via CSS when not on the image-playground route.
 */
export function ImagePlaygroundPanel() {
  const { t } = useTranslation()
  const { visible, iframeUrl, selectedId, loadingKey, setIframeUrl, setSelectedId, setLoadingKey } =
    useImagePlaygroundStore()
  const resolvedIdRef = useRef<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['image-playground-keys'],
    queryFn: () => getApiKeys({ size: 100 }),
    enabled: visible || selectedId !== null,
  })

  const usableKeys = (data?.data?.items ?? []).filter(isKeyUsable)

  // Validate cached selection once keys load
  useEffect(() => {
    if (!data?.data) return
    const stillValid = selectedId && usableKeys.some((k) => k.id === selectedId)
    if (!stillValid) setSelectedId(usableKeys[0]?.id ?? null)
  }, [data])

  // Resolve real key whenever selectedId changes
  useEffect(() => {
    if (!selectedId || selectedId === resolvedIdRef.current) return
    resolvedIdRef.current = selectedId
    setIframeUrl(null)
    setLoadingKey(true)
    fetchTokenKey(selectedId)
      .then((res) => {
        if (res.success && res.data?.key) {
          localStorage.setItem(STORAGE_KEY, String(selectedId))
          const url = new URL(IMAGE_PLAYGROUND_BASE)
          url.searchParams.set('apiUrl', API_URL)
          url.searchParams.set('apiKey', `sk-${res.data.key}`)
          url.searchParams.set('model', MODEL)
          setIframeUrl(url.toString())
        }
      })
      .finally(() => setLoadingKey(false))
  }, [selectedId])

  const handleSelect = (val: string) => {
    resolvedIdRef.current = null
    setSelectedId(Number(val))
  }

  const showNoKey = !isLoading && usableKeys.length === 0

  return (
    <div className='flex h-full flex-col'>
      {/* Toolbar */}
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        <ImageIcon className='text-muted-foreground h-4 w-4 shrink-0' />
        <span className='text-muted-foreground text-sm'>{t('API Key')}:</span>
        <Select
          value={selectedId ? String(selectedId) : undefined}
          onValueChange={handleSelect}
        >
          <SelectTrigger className='h-7 w-52 text-xs'>
            <SelectValue placeholder={t('Select API Key')} />
          </SelectTrigger>
          <SelectContent>
            {usableKeys.map((k) => (
              <SelectItem key={k.id} value={String(k.id)}>
                {k.name || `#${k.id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loadingKey && (
          <RefreshCw className='text-muted-foreground h-3 w-3 animate-spin' />
        )}
      </div>

      {/* Content */}
      {showNoKey ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-4'>
          <KeyRound className='text-muted-foreground h-10 w-10' />
          <p className='text-muted-foreground text-sm'>
            {t('You need an API Key to use Image Playground')}
          </p>
          <Button asChild>
            <Link to='/keys'>{t('Create API Key')}</Link>
          </Button>
        </div>
      ) : iframeUrl ? (
        <iframe
          key={iframeUrl}
          src={iframeUrl}
          className='min-h-0 flex-1 border-0'
          allow='clipboard-read; clipboard-write'
          title='Image Playground'
        />
      ) : (
        <div className='flex flex-1 items-center justify-center'>
          <RefreshCw className='text-muted-foreground h-5 w-5 animate-spin' />
        </div>
      )}
    </div>
  )
}

/**
 * Route page: just initializes state and marks the panel visible.
 * The actual iframe lives in ImagePlaygroundPanel above.
 */
export function ImagePlayground() {
  const { setVisible, setSelectedId } = useImagePlaygroundStore()

  useEffect(() => {
    // Restore cached key on mount
    const cached = Number(localStorage.getItem(STORAGE_KEY))
    if (cached) setSelectedId(cached)
    setVisible(true)
    return () => setVisible(false)
  }, [])

  // Render nothing — the panel in layout takes full space when visible
  return null
}
