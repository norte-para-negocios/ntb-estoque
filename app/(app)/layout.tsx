import { AppSidebar } from '@/components/sidebar/AppSidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <AppSidebar />
      <main className="flex-1 min-w-0 p-6 overflow-x-hidden">{children}</main>
    </div>
  )
}
