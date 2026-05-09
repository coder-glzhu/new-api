import { api } from '@/lib/api'

export async function adminSendWechatTest(message?: string): Promise<void> {
  const res = await api.post('/api/admin/lucky-bag/notify-test', {
    message: message ?? '',
  })
  if (!res.data.success) {
    throw new Error(res.data.message ?? 'Unknown error')
  }
}
