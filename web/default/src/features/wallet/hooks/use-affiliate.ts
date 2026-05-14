import { useState, useEffect, useCallback } from 'react'
import i18next from 'i18next'
import { toast } from 'sonner'
import { getSelf } from '@/lib/api'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getAffiliateCode, transferAffiliateQuota } from '../api'
import { generateAffiliateLink } from '../lib'
import { formatUsdAmount } from '../lib/usd-format'

// ============================================================================
// Affiliate Hook
// ============================================================================

export function useAffiliate() {
  const [affiliateCode, setAffiliateCode] = useState<string>('')
  const [affiliateLink, setAffiliateLink] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [transferring, setTransferring] = useState(false)
  const { copyToClipboard } = useCopyToClipboard()

  // Fetch affiliate code
  const fetchAffiliateCode = useCallback(async () => {
    try {
      setLoading(true)
      const response = await getAffiliateCode()

      if (response.success && response.data) {
        setAffiliateCode(response.data)
        const link = generateAffiliateLink(response.data)
        setAffiliateLink(link)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch affiliate code:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Copy affiliate link
  const copyAffiliateLink = useCallback(() => {
    copyToClipboard(affiliateLink)
  }, [affiliateLink, copyToClipboard])

  // Transfer affiliate quota to balance
  const transferQuota = useCallback(
    async (amount: number): Promise<boolean> => {
      try {
        setTransferring(true)
        const response = await transferAffiliateQuota({ amount })

        if (response.success) {
          const transferredAmount = response.data?.amount ?? amount
          toast.success(
            i18next.t('Transferred {{amount}} to balance', {
              amount: formatUsdAmount(transferredAmount),
            })
          )
          await getSelf()
          return true
        }

        toast.error(response.message || i18next.t('Transfer failed'))
        return false
      } catch (_error) {
        toast.error(i18next.t('Transfer failed'))
        return false
      } finally {
        setTransferring(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchAffiliateCode()
  }, [fetchAffiliateCode])

  return {
    affiliateCode,
    affiliateLink,
    loading,
    transferring,
    copyAffiliateLink,
    transferQuota,
    refetch: fetchAffiliateCode,
  }
}
