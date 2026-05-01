import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  CalendarClock,
  Crown,
  Gauge,
  MoreHorizontal,
  RotateCcw,
  WalletCards,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { cn } from '@/lib/utils'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
  MobileCardList,
  TableEmpty,
  TableSkeleton,
} from '@/components/data-table'
import { SectionPageLayout, PageFooterPortal } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { getAdminPlans } from '@/features/subscriptions/api'
import { UserSubscriptionsDialog } from '@/features/subscriptions/components/dialogs/user-subscriptions-dialog'
import type { PlanRecord } from '@/features/subscriptions/types'
import { getSubscriptionUsersOverview } from './api'
import type {
  SubscriptionUserOverview,
  SubscriptionUsersOverviewSummary,
} from './types'

const route = getRouteApi('/_authenticated/subscription-users/')

const STATUS_FILTERS = ['all', 'active', 'expired', 'cancelled'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

function getStatusLabel(
  status: (typeof STATUS_FILTERS)[number] | SubscriptionUserOverview['status'],
  t: (key: string) => string
) {
  switch (status) {
    case 'active':
      return t('Active')
    case 'expired':
      return t('Expired')
    case 'cancelled':
      return t('Invalidated')
    default:
      return t('All statuses')
  }
}

function SubscriptionStatusBadge({
  status,
}: {
  status: SubscriptionUserOverview['status']
}) {
  const { t } = useTranslation()
  if (status === 'active') {
    return <StatusBadge label={t('Active')} variant='success' copyable={false} />
  }
  if (status === 'cancelled') {
    return (
      <StatusBadge
        label={t('Invalidated')}
        variant='neutral'
        copyable={false}
      />
    )
  }
  return <StatusBadge label={t('Expired')} variant='warning' copyable={false} />
}

function UsageBar({
  used,
  total,
  remaining,
}: {
  used: number
  total: number
  remaining: number
}) {
  const { t } = useTranslation()
  if (total <= 0) {
    return (
      <div className='text-muted-foreground text-xs'>
        {t('Unlimited quota')}
      </div>
    )
  }

  const percent = Math.min(100, Math.round((used / total) * 100))
  return (
    <div className='min-w-[170px] space-y-1.5'>
      <div className='flex items-center justify-between gap-2 text-xs'>
        <span className='font-medium'>{formatQuota(used)}</span>
        <span className='text-muted-foreground'>{percent}%</span>
      </div>
      <Progress value={percent} className='h-1.5' />
      <div className='text-muted-foreground text-xs'>
        {t('Remaining')}: {formatQuota(remaining)}
      </div>
    </div>
  )
}

function SummaryStrip({
  summary,
}: {
  summary?: SubscriptionUsersOverviewSummary
}) {
  const { t } = useTranslation()

  const stats = [
    {
      label: t('Active subscription users'),
      value: (summary?.active_users || 0).toLocaleString(),
      icon: Crown,
    },
    {
      label: t('Active subscription quota'),
      value: formatQuota(summary?.active_amount_total || 0),
      icon: Gauge,
    },
    {
      label: t('Used subscription quota'),
      value: formatQuota(summary?.active_amount_used || 0),
      icon: WalletCards,
    },
    {
      label: t('Expiring within 7 days'),
      value: (summary?.expiring_soon_users || 0).toLocaleString(),
      icon: CalendarClock,
    },
  ]

  return (
    <div className='grid gap-3 md:grid-cols-4'>
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <div key={stat.label} className='rounded-md border p-3'>
            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
              <Icon className='size-3.5' />
              {stat.label}
            </div>
            <div className='mt-2 text-lg font-semibold'>{stat.value}</div>
          </div>
        )
      })}
    </div>
  )
}

function useSubscriptionUserColumns(
  onManage: (row: SubscriptionUserOverview) => void
): ColumnDef<SubscriptionUserOverview>[] {
  const { t } = useTranslation()

  return useMemo(
    (): ColumnDef<SubscriptionUserOverview>[] => [
      {
        accessorKey: 'username',
        meta: { label: t('User'), mobileTitle: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('User')} />
        ),
        cell: ({ row }) => {
          const user = row.original
          return (
            <div className='min-w-0'>
              <div className='truncate font-medium'>
                {user.display_name || user.username}
              </div>
              <div className='text-muted-foreground truncate text-xs'>
                @{user.username} · ID {user.user_id}
              </div>
              {user.email ? (
                <div className='text-muted-foreground truncate text-xs'>
                  {user.email}
                </div>
              ) : null}
            </div>
          )
        },
        size: 220,
      },
      {
        accessorKey: 'status',
        meta: { label: t('Status'), mobileBadge: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Status')} />
        ),
        cell: ({ row }) => <SubscriptionStatusBadge status={row.original.status} />,
        size: 110,
      },
      {
        accessorKey: 'current_plan_title',
        meta: { label: t('Current plan') },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Current plan')} />
        ),
        cell: ({ row }) => (
          <div className='min-w-[140px]'>
            <div className='truncate font-medium'>
              {row.original.current_plan_title || '-'}
            </div>
            <div className='text-muted-foreground text-xs'>
              {t('Source')}: {row.original.current_source || '-'}
            </div>
          </div>
        ),
        size: 180,
      },
      {
        accessorKey: 'active_amount_used',
        meta: { label: t('Subscription usage') },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Subscription usage')}
          />
        ),
        cell: ({ row }) => (
          <UsageBar
            used={row.original.active_amount_used}
            total={row.original.active_amount_total}
            remaining={row.original.active_amount_remaining}
          />
        ),
        size: 220,
      },
      {
        accessorKey: 'wallet_quota',
        meta: { label: t('Wallet quota'), mobileHidden: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Wallet quota')} />
        ),
        cell: ({ row }) => (
          <div className='text-xs'>
            <div>{formatQuota(row.original.wallet_quota)}</div>
            <div className='text-muted-foreground'>
              {t('Used')}: {formatQuota(row.original.wallet_used)}
            </div>
          </div>
        ),
        size: 140,
      },
      {
        accessorKey: 'subscription_count',
        meta: { label: t('Subscription count'), mobileHidden: true },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('Subscription count')}
          />
        ),
        cell: ({ row }) => (
          <div className='text-xs'>
            <div>
              {t('Active')}: {row.original.active_count}
            </div>
            <div className='text-muted-foreground'>
              {t('Total')}: {row.original.subscription_count}
            </div>
          </div>
        ),
        size: 120,
      },
      {
        accessorKey: 'current_end_time',
        meta: { label: t('End time'), mobileHidden: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('End time')} />
        ),
        cell: ({ row }) => (
          <div className='min-w-[150px] text-xs'>
            <div>{formatTimestampToDate(row.original.current_end_time)}</div>
            {row.original.next_reset_time ? (
              <div className='text-muted-foreground'>
                {t('Next reset')}: {formatTimestampToDate(row.original.next_reset_time)}
              </div>
            ) : null}
          </div>
        ),
        size: 180,
      },
      {
        accessorKey: 'request_count',
        meta: { label: t('Requests'), mobileHidden: true },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Requests')} />
        ),
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {row.original.request_count.toLocaleString()}
          </span>
        ),
        size: 100,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            title={t('Manage subscriptions')}
            onClick={() => onManage(row.original)}
          >
            <MoreHorizontal className='size-4' />
          </Button>
        ),
        size: 70,
      },
    ],
    [onManage, t]
  )
}

export function SubscriptionUsers() {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [manageUser, setManageUser] = useState<SubscriptionUserOverview | null>(
    null
  )

  const status: StatusFilter = search.status || 'all'
  const planId = search.planId || 0

  const {
    globalFilter,
    onGlobalFilterChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search,
    navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
  })

  const plansQuery = useQuery({
    queryKey: ['subscription-users-plans'],
    queryFn: async () => {
      const result = await getAdminPlans()
      return result.data || []
    },
  })

  const overviewQuery = useQuery({
    queryKey: [
      'subscription-users-overview',
      pagination.pageIndex,
      pagination.pageSize,
      globalFilter,
      status,
      planId,
      t,
    ],
    queryFn: async () => {
      const result = await getSubscriptionUsersOverview({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter || undefined,
        status: status === 'all' ? undefined : status,
        plan_id: planId || undefined,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load subscription users'))
        return { items: [], total: 0 }
      }
      return {
        items: result.data?.items || [],
        total: result.data?.total || 0,
        summary: result.data?.summary,
      }
    },
    placeholderData: (prev) => prev,
  })

  const rows = overviewQuery.data?.items || []
  const columns = useSubscriptionUserColumns(setManageUser)

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnVisibility,
      pagination,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: Math.ceil((overviewQuery.data?.total || 0) / pagination.pageSize),
  })

  const pageCount = table.getPageCount()
  useEffect(() => {
    ensurePageInRange(pageCount)
  }, [ensurePageInRange, pageCount])

  const updateFilter = (next: { status?: StatusFilter; planId?: number }) => {
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        status: next.status ?? prev.status,
        planId: next.planId ?? prev.planId,
      }),
    })
  }

  const resetFilters = () => {
    table.setGlobalFilter('')
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        filter: '',
        status: 'all',
        planId: 0,
      }),
    })
  }

  const planOptions = plansQuery.data || []
  const hasAdditionalFilters = status !== 'all' || planId > 0

  const additionalFilters = (
    <div className='flex flex-wrap items-center gap-2'>
      <Select
        value={status}
        onValueChange={(value) =>
          updateFilter({ status: value as StatusFilter })
        }
      >
        <SelectTrigger className='h-8 w-[150px]'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((value) => (
            <SelectItem key={value} value={value}>
              {getStatusLabel(value, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(planId)}
        onValueChange={(value) => updateFilter({ planId: Number(value) })}
      >
        <SelectTrigger className='h-8 w-[190px]'>
          <SelectValue placeholder={t('All plans')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='0'>{t('All plans')}</SelectItem>
          {planOptions.map((record: PlanRecord) => (
            <SelectItem key={record.plan.id} value={String(record.plan.id)}>
              {record.plan.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Subscription Users')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Description>
          {t('Audit subscribed users, quota usage, renewals and plan coverage.')}
        </SectionPageLayout.Description>
        <SectionPageLayout.Actions>
          <Button variant='outline' size='sm' onClick={resetFilters}>
            <RotateCcw className='size-4' />
            {t('Reset')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='space-y-4'>
            <SummaryStrip summary={overviewQuery.data?.summary} />
            <DataTableToolbar
              table={table}
              searchPlaceholder={t('Search subscribed users...')}
              additionalSearch={additionalFilters}
              hasAdditionalFilters={hasAdditionalFilters}
              onReset={resetFilters}
            />
            {isMobile ? (
              <MobileCardList
                table={table}
                isLoading={overviewQuery.isLoading}
                emptyTitle={t('No subscription users found')}
                emptyDescription={t(
                  'No users match the current subscription filters.'
                )}
              />
            ) : (
              <div
                className={cn(
                  'overflow-hidden rounded-md border transition-opacity duration-150',
                  overviewQuery.isFetching &&
                    !overviewQuery.isLoading &&
                    'pointer-events-none opacity-50'
                )}
              >
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id} colSpan={header.colSpan}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {overviewQuery.isLoading ? (
                      <TableSkeleton
                        table={table}
                        keyPrefix='subscription-users-skeleton'
                      />
                    ) : table.getRowModel().rows.length === 0 ? (
                      <TableEmpty
                        colSpan={columns.length}
                        title={t('No subscription users found')}
                        description={t(
                          'No users match the current subscription filters.'
                        )}
                      />
                    ) : (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <UserSubscriptionsDialog
        open={Boolean(manageUser)}
        onOpenChange={(open) => !open && setManageUser(null)}
        user={
          manageUser
            ? { id: manageUser.user_id, username: manageUser.username }
            : null
        }
        onSuccess={() => overviewQuery.refetch()}
      />

      <PageFooterPortal>
        <DataTablePagination table={table} />
      </PageFooterPortal>
    </>
  )
}
