import { AppSidebar } from '@/components/sidebar/AppSidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
