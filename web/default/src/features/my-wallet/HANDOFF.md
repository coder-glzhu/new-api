# my-wallet 页面交接文档

## 背景

官方 `/wallet` 页面（`features/wallet/`）由于多次合并冲突导致代码污染严重，且页面布局问题突出：
充值和订阅入口隐藏在 Tab 二级层级，用户不易发现。

**解决方案**：
1. 在 `feat/my-wallet` 分支上，将 `features/wallet/` 完整回退到上游官方代码（无冲突基线）。
2. 新建 `features/my-wallet/` 目录，从零实现新版钱包页面。
3. 侧边栏"钱包"入口改为跳转 `/my-wallet`，原 `/wallet` 路由保留不动。

---

## 当前分支状态（feat/my-wallet）

| 状态 | 说明 |
|------|------|
| `features/wallet/` | 已完整还原为 upstream 官方代码，无本地改动 |
| `features/my-wallet/` | **待开发**，本文档是开发规范 |
| 侧边栏 `/wallet` 入口 | **待修改**，改为 `/my-wallet` |
| 路由 `/_authenticated/my-wallet/` | **待创建** |

---

## 新页面设计方案

### 整体结构

```
┌─────────────────────────────────────────────────┐
│  余额卡片（固定在顶部，不随 Tab 切换消失）              │
│  💰 $12.34 余额  |  已用 $xxx  |  本月消耗 x tokens │
└─────────────────────────────────────────────────┘

[ 充值 ]  [ 订阅 ]  [ 推广 ]   ← 三个顶级 Tab

─── Tab: 充值 ──────────────────────────────────────
  预设金额选择（$5 / $10 / $20 / 自定义输入）
  支付方式按钮列表（支付宝/微信/Stripe/Hupijiao等）
  ── 分割线 ──
  🎟 兑换码区块（输入框 + 核销按钮）

─── Tab: 订阅 ──────────────────────────────────────
  我的订阅（可拖拽排序扣费优先级）
  ┌──────────────────────────────────────────────┐
  │ ⠿  Pro 月付      剩余 $8.00    5 天后到期      │
  │ ⠿  Basic 月付    剩余 $2.00    12 天后到期     │
  └──────────────────────────────────────────────┘
  ── 分割线 ──
  可购买的订阅套餐（卡片式展示）

─── Tab: 推广 ──────────────────────────────────────
  数据行：待转账余额 / 累计收益 / 邀请人数
  推广链接 + 复制按钮
  转入余额按钮（达到最低转账额才显示）
```

### 路由路径

- 新页面：`/my-wallet`
- 文件路径：`web/default/src/routes/_authenticated/my-wallet/index.tsx`

---

## 文件规划

```
web/default/src/
├── routes/_authenticated/my-wallet/
│   └── index.tsx                    # 路由文件，直接 import MyWallet
│
└── features/my-wallet/
    ├── index.tsx                    # 主组件 <MyWallet>，管理 Tab 状态 + 全局数据
    ├── types.ts                     # 复用 features/wallet/types.ts，不要重复定义
    │
    ├── components/
    │   ├── balance-stats-card.tsx   # 顶部余额卡片（始终显示）
    │   ├── recharge-tab.tsx         # 充值 Tab 容器
    │   ├── subscription-tab.tsx     # 订阅 Tab 容器
    │   ├── affiliate-tab.tsx        # 推广 Tab 容器
    │   └── redemption-section.tsx  # 兑换码区块（在充值 Tab 下方）
    │
    └── hooks/
        └── use-my-wallet.ts         # 统一数据层：user + topupInfo + 各操作
```

---

## 复用已有代码的规则

**直接复用（import，不要复制）**：

| 来源 | 用途 |
|------|------|
| `features/wallet/hooks/use-topup-info` | 获取充值配置、预设金额 |
| `features/wallet/hooks/use-payment` | 计算金额、发起支付 |
| `features/wallet/hooks/use-affiliate` | 推广数据、转账 |
| `features/wallet/hooks/use-redemption` | 兑换码核销 |
| `features/wallet/hooks/use-creem-payment` | Creem 支付 |
| `features/wallet/hooks/use-waffo-payment` | Waffo 支付 |
| `features/wallet/hooks/use-waffo-pancake-payment` | Waffo Pancake 支付 |
| `features/wallet/lib/*` | 工具函数（payment、format、affiliate等） |
| `features/wallet/types.ts` | 所有类型定义 |
| `features/wallet/constants.ts` | DEFAULT_DISCOUNT_RATE 等常量 |
| `components/payment/hupijiao-payment-dialog` | 虎皮椒支付弹窗 |
| `features/wallet/components/dialogs/*` | 支付确认、转账、Creem确认 Dialog |

**关于 Hupijiao（虎皮椒/支付宝）支付**：
上游官方没有 `use-hupijiao-payment` hook 和相关 API，这是本项目自定义的。
开发时需要自行实现（或从 git 历史找回）：
- `features/my-wallet/hooks/use-hupijiao-payment.ts`
- API 函数：`calculateHupijiaoAmount`、`requestHupijiaoPayment`、`getHupijiaoTopupOrderStatus`

参考 `git show HEAD~5:web/default/src/features/wallet/hooks/use-hupijiao-payment.ts`
（或 `git log --all --oneline -- web/default/src/features/wallet/hooks/use-hupijiao-payment.ts` 找到对应 commit）

**关于订阅拖拽排序**：
`@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` 已安装（v6/v10/v3）。
`features/wallet/components/my-subscriptions-card.tsx` 在官方代码里**没有**，
但在 git 历史里存在（本分支 reset 前的代码）。

找回方式：
```bash
git show main:web/default/src/features/wallet/components/my-subscriptions-card.tsx
```
将其复制到 `features/my-wallet/components/subscription-tab.tsx` 后按新结构调整。

---

## 侧边栏修改

文件：`web/default/src/hooks/use-sidebar-data.ts`

找到这段代码（约第 114 行）：
```ts
{
  title: t('Wallet'),
  url: '/wallet',
  icon: Wallet,
},
```

改为：
```ts
{
  title: t('Wallet'),
  url: '/my-wallet',
  icon: Wallet,
},
```

---

## 路由注册

TanStack Router 在 `web/default/src` 使用**文件路由自动扫描**，创建文件后需要重新生成路由树：

```bash
cd web/default
bun run dev     # dev server 启动时会自动重新生成 routeTree.gen.ts
# 或手动触发：
bun run build   # build 也会触发
```

路由文件模板（参考 lucky-bag 路由）：
```tsx
import { createFileRoute } from '@tanstack/react-router'
import { MyWallet } from '@/features/my-wallet'

export const Route = createFileRoute('/_authenticated/my-wallet/')({
  component: MyWallet,
})
```

---

## 主组件结构参考

`features/my-wallet/index.tsx` 的主要逻辑和现有 `features/wallet/index.tsx` 基本相同，
差别只在于 JSX 布局——用三 Tab 替代原来的堆叠布局。

状态管理模式保持不变：
- `useState` 管理 UI 状态（activeTab、各种 dialog open 状态）
- `useCallback` / `useMemo` 处理事件和计算
- 数据全部来自 `features/wallet/hooks/` 的 hooks

---

## 开发步骤（按顺序）

1. 创建 `features/my-wallet/` 目录结构（空文件占位）
2. 写 `hooks/use-my-wallet.ts`：整合所有 wallet hooks，统一对外暴露
3. 写 `components/balance-stats-card.tsx`：余额卡片，复用 `WalletStatsCard` 的数据逻辑
4. 写 `components/recharge-tab.tsx`：充值表单 + 下方兑换码，复用 `RechargeFormCard`
5. 写 `components/subscription-tab.tsx`：拖拽订阅 + 套餐列表，从 git 历史找回 `my-subscriptions-card` 和 `subscription-plans-card` 的逻辑
6. 写 `components/affiliate-tab.tsx`：推广数据 + 转账，复用 `AffiliateRewardsCard` 逻辑
7. 写 `index.tsx`：组装三 Tab + 余额卡片 + 所有 Dialog
8. 创建路由文件 `routes/_authenticated/my-wallet/index.tsx`
9. 修改侧边栏 `use-sidebar-data.ts`，`/wallet` 改为 `/my-wallet`
10. `bun run dev` 验证路由、功能、响应式

---

## 注意事项

- **不要修改 `features/wallet/` 下的任何文件**，保持与 upstream 一致，方便后续同步上游更新
- 所有新代码写在 `features/my-wallet/`
- 原 `/wallet` 路由不动，只是侧边栏入口改成 `/my-wallet`
- i18n：用 `useTranslation()` + `t('English key')`，新增 key 后在 `web/default/src/i18n/locales/zh.json` 补充翻译
- 响应式：移动端 Tab 要能正常滚动，拖拽排序在移动端用触摸传感器（`TouchSensor`）
