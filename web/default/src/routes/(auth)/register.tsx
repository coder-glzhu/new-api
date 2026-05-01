import { createFileRoute, redirect } from '@tanstack/react-router'

// 兼容历史推广链接 /register?aff=xxx：永久重定向到 /sign-up，保留所有查询参数
// （aff 等）。前端实际注册路由在 (auth)/sign-up.tsx。
export const Route = createFileRoute('/(auth)/register')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sign-up', search })
  },
})
