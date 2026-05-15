import { useCallback, useState } from 'react'
import i18next from 'i18next'
import { toast } from 'sonner'
import { isApiSuccess, requestHupijiaoPayment } from '../api'

export function useHupijiaoPayment() {
  const [processing, setProcessing] = useState(false)

  const processHupijiaoPayment = useCallback(async (topupAmount: number) => {
    try {
      setProcessing(true)
      const response = await requestHupijiaoPayment({ amount: topupAmount })

      if (!isApiSuccess(response) || !response.data) {
        toast.error(response.message || i18next.t('Payment request failed'))
        return null
      }

      return response.data
    } catch {
      toast.error(i18next.t('Payment request failed'))
      return null
    } finally {
      setProcessing(false)
    }
  }, [])

  return { processing, processHupijiaoPayment }
}
