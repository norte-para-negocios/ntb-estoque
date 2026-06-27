import { isSuperAdmin } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Zap } from 'lucide-react'

export default async function BetaLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSuperAdmin())) redirect('/home')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
        <Zap className="size-4 text-brand shrink-0" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-text">VTBstock Beta</span>
          <span className="ml-2 text-[11px] text-text-muted">Acesso restrito a super administradores</span>
        </div>
        <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shrink-0">Beta</span>
      </div>
      {children}
    </div>
  )
}
