import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { ImagePlaygroundPanel } from '@/features/image-playground'
import { useImagePlaygroundStore } from '@/features/image-playground/store'
import { WorkspaceProvider } from '../context/workspace-context'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const imagePanelVisible = useImagePlaygroundStore((s) => s.visible)

  return (
    <LayoutProvider>
      <SearchProvider>
        <WorkspaceProvider>
          <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
            <SkipToMain />
            <AppHeader />
            <div className='flex min-h-0 w-full flex-1'>
              <AppSidebar />
              <SidebarInset
                className={cn(
                  '@container/content',
                  'relative',
                  'h-[calc(100svh-var(--app-header-height,0px))]',
                  'peer-data-[variant=inset]:h-[calc(100svh-var(--app-header-height,0px)-(var(--spacing)*4))]'
                )}
              >
                {props.children ?? <AnimatedOutlet />}
                <div
                  className='absolute inset-0 z-10 bg-background'
                  style={imagePanelVisible ? undefined : { display: 'none', pointerEvents: 'none' }}
                >
                  <ImagePlaygroundPanel />
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </WorkspaceProvider>
      </SearchProvider>
    </LayoutProvider>
  )
}
