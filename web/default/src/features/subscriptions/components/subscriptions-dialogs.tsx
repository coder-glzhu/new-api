import { ToggleStatusDialog } from './dialogs/toggle-status-dialog'
import { SubscriptionCreateDrawer } from './subscription-create-drawer'
import { useSubscriptions } from './subscriptions-provider'

export function SubscriptionsDialogs() {
  const { open, setOpen, currentRow } = useSubscriptions()
  const isUpdate = open === 'update'

  return (
    <>
      <SubscriptionCreateDrawer
        open={open === 'create' || isUpdate}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={isUpdate ? currentRow || undefined : undefined}
      />
      <ToggleStatusDialog />
    </>
  )
}
