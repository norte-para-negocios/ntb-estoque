# Redesign Completo NTB Estoque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Transformar o NTB Estoque de um clone visual do Laravel antigo num produto operacional moderno estilo Linear/Vercel (tema claro), mantendo o teal #2EB5C3 da marca, com app-shell de sidebar fixa em desktop, navegação mobile dedicada, tabelas densas com números em mono, KPIs reais e micro-interações.

**Architecture:** Design system baseado em tokens CSS (cor/tipografia/espaço/raio/sombra) consumidos por componentes reutilizáveis (DataTable, StatCard, StatusPill, Toolbar, EmptyState, AppShell). App-shell responsivo: sidebar fixa colapsável em ≥1024px, top-bar + drawer + bottom-bar em <1024px. Tema claro primeiro; tokens preparados pra dark mode futuro sem reescrita.

**Tech Stack:** Next.js 16 (App Router), Tailwind v4 (@theme inline), Base UI, Supabase, lucide-react, fontes via next/font (Plus Jakarta Sans + JetBrains Mono). Sem libs novas de UI.

**Pesquisa de referência (resumo):** padrões de dashboards de inventário B2B 2025-2026 (Linear, Vercel, Retool, Cin7, Katana). Decisões-chave adotadas: KPIs no topo + grid de dados central; números/IDs em fonte mono com tabular-nums; status pills semânticas; sticky header + zebra sutil em tabelas; mobile-first pra contagem (alvos grandes + barra de ação inferior); contraste WCAG AA; cor por significado, nunca só cor pra status.

---

## Princípios de design (guia para todas as tarefas)

1. **Teal é a marca, não a tinta.** #2EB5C3 só em: ação primária, item de navegação ativo, foco, e 1 destaque por tela. Resto é neutro.
2. **Números são dados.** Todo valor numérico, código, quantidade, ID, data → fonte mono + `tabular-nums`, alinhado à direita em colunas.
3. **Densidade com respiro.** Tabelas compactas (linha ~44px) mas com hierarquia clara; páginas com no máx. 1 ação primária visível.
4. **Hierarquia neutra fria.** Escala de cinza levemente fria (slate), não cinza puro. Texto principal #1f2733, secundário #64748b.
5. **Movimento com física.** Transições `cubic-bezier(0.32,0.72,0,1)`, 150-250ms. Nada de `linear`. Hover/active com leve scale.
6. **Status por pill + cor + ícone**, nunca cor sozinha (acessibilidade).
7. **Sem travessão (—)** em texto visível. Acentuação correta. Valores de status do banco permanecem SEM acento (batem com o banco); só o rótulo exibido recebe acento.

---

## Estrutura de arquivos

**Tokens & base**
- Modify: `app/globals.css` — tokens completos (cor slate fria + teal scale + semânticas + sombras + raios), classes base.
- Modify: `app/layout.tsx` — fontes Plus Jakarta Sans (UI) + JetBrains Mono (números).

**App-shell (novo)**
- Create: `components/shell/AppShell.tsx` — orquestra sidebar/topbar/bottombar conforme breakpoint (client).
- Create: `components/shell/Sidebar.tsx` — sidebar fixa desktop, colapsável, com grupos e item ativo.
- Create: `components/shell/MobileNav.tsx` — top-bar + drawer + bottom-bar mobile.
- Create: `components/shell/NavItems.ts` — fonte única de verdade dos itens de menu (label, href, ícone, grupo, admin).
- Create: `components/shell/UserMenu.tsx` — avatar + nome + sair (popover).
- Modify: `app/(app)/layout.tsx` — passa dados (lojas, profile) ao AppShell.
- Delete (após migração): `components/AppHeader.tsx`, `components/MenuNTB.tsx`, `components/sidebar/AppSidebar.tsx`, `components/sidebar/SidebarNav.tsx`.

**Primitivos de UI (novos, reutilizáveis)**
- Create: `components/ui-kit/PageHeader.tsx` — título + breadcrumb + slot de ações.
- Create: `components/ui-kit/StatCard.tsx` — card de KPI (label, valor mono, delta opcional, ícone, href).
- Create: `components/ui-kit/DataTable.tsx` — wrapper de tabela (sticky header, zebra, scroll, densidade).
- Create: `components/ui-kit/StatusPill.tsx` — pill semântica (sucesso/aviso/erro/neutro/info) por mapa.
- Create: `components/ui-kit/Toolbar.tsx` — barra de filtros/busca acima de tabelas.
- Create: `components/ui-kit/EmptyState.tsx` — estado vazio com ícone + texto + ação.
- Create: `components/ui-kit/Money.tsx` e `components/ui-kit/Num.tsx` — formatação consistente pt-BR mono.

**Páginas (re-skin usando o kit, sem tocar em query/lógica)**
- Modify: `app/(app)/home/page.tsx` — dashboard real (KPIs + atalhos + últimas atividades).
- Modify: cada listagem em `app/(app)/{nota-fiscal,ordem-producao,transferencia,inventario,produto,local-estoque,log,loja,usuario}/page.tsx`.
- Modify: páginas de detalhe/contagem e o `login`.

**Convenção de tokens (definida na Task 1, usada em todas):**
`--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--brand`(#2eb5c3), `--brand-strong`(#1c8d99), `--ok`(#10b981), `--warn`(#f59e0b), `--err`(#ef4444), `--info`(#3b82f6), raios `--r-sm/md/lg`, sombras `--shadow-sm/md`.

---

### Task 1: Tokens e tipografia (fundação)

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Trocar fontes em `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "NTB - Estoque",
  description: "Sistema de gestão de estoque integrado ao Omie",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="min-h-full antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Reescrever `app/globals.css` com tokens slate-frio + teal**

Substituir o bloco `@theme inline` e `:root` por (mantendo os mapeamentos shadcn existentes que apontam para as vars):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --font-sans: var(--font-sans-src);
  --font-mono: var(--font-mono-src);
  --color-brand: var(--brand);
  --color-card: var(--surface);
  --color-card-foreground: var(--text);
  --color-popover: var(--surface);
  --color-popover-foreground: var(--text);
  --color-primary: var(--brand);
  --color-primary-foreground: #ffffff;
  --color-secondary: var(--surface-2);
  --color-secondary-foreground: var(--text);
  --color-muted: var(--surface-2);
  --color-muted-foreground: var(--text-muted);
  --color-accent: var(--surface-2);
  --color-accent-foreground: var(--text);
  --color-destructive: var(--err);
  --color-border: var(--border);
  --color-input: var(--border);
  --color-ring: var(--brand);
  --color-gray-50: var(--surface-2);
  --color-gray-100: var(--surface-2);
  --radius-sm: var(--r-sm);
  --radius-md: var(--r-md);
  --radius-lg: var(--r-lg);
  --radius-xl: var(--r-lg);
}

:root {
  /* Neutros slate frios */
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-2: #f1f4f8;
  --text: #1f2733;
  --text-muted: #64748b;
  --border: #e6e9ef;
  /* Marca */
  --brand: #2eb5c3;
  --brand-strong: #1c8d99;
  --brand-soft: #e6f7f9;
  /* Semânticas */
  --ok: #10b981;
  --warn: #f59e0b;
  --err: #ef4444;
  --info: #3b82f6;
  /* Raios */
  --r-sm: 0.375rem;
  --r-md: 0.625rem;
  --r-lg: 0.875rem;
  /* Sombras suaves difusas (sem preto duro) */
  --shadow-sm: 0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06);
  --shadow-md: 0 4px 12px -2px rgba(16,24,40,0.08), 0 2px 6px -2px rgba(16,24,40,0.05);
  --ease: cubic-bezier(0.32, 0.72, 0, 1);
}

@layer base {
  * { @apply border-border outline-ring/40; }
  body { @apply bg-background text-foreground; font-size: 0.9rem; -webkit-font-smoothing: antialiased; }
  html { @apply font-sans; }
  .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .eyebrow { @apply text-[11px] font-semibold uppercase tracking-wider text-muted-foreground; }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`. (Páginas antigas ficam feias temporariamente; ok, serão migradas.)

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat(design): tokens slate-frio + teal e tipografia Jakarta/JetBrains"
```

---

### Task 2: Fonte única de navegação + primitivos de número

**Files:**
- Create: `components/shell/NavItems.ts`
- Create: `components/ui-kit/Num.tsx`
- Create: `components/ui-kit/Money.tsx`

- [ ] **Step 1: `components/shell/NavItems.ts`**

```ts
import {
  LayoutDashboard, FileText, Factory, ArrowLeftRight, ClipboardList,
  Package, Warehouse, ScrollText, Store, Users, type LucideIcon,
} from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon; group: 'Operação' | 'Cadastros' | 'Administração'; admin?: boolean }

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Início', icon: LayoutDashboard, group: 'Operação' },
  { href: '/nota-fiscal', label: 'Notas Fiscais', icon: FileText, group: 'Operação' },
  { href: '/ordem-producao', label: 'Ordens de Produção', icon: Factory, group: 'Operação' },
  { href: '/transferencia', label: 'Transferências', icon: ArrowLeftRight, group: 'Operação' },
  { href: '/inventario', label: 'Inventários', icon: ClipboardList, group: 'Operação' },
  { href: '/produto', label: 'Produtos', icon: Package, group: 'Cadastros' },
  { href: '/local-estoque', label: 'Locais de Estoque', icon: Warehouse, group: 'Cadastros' },
  { href: '/log', label: 'Logs de Integração', icon: ScrollText, group: 'Cadastros', admin: true },
  { href: '/loja', label: 'Lojas', icon: Store, group: 'Administração', admin: true },
  { href: '/usuario', label: 'Usuários', icon: Users, group: 'Administração', admin: true },
]
```

- [ ] **Step 2: `components/ui-kit/Num.tsx` e `Money.tsx`**

```tsx
// Num.tsx
export function Num({ value, frac = 0, className = '' }: { value: number | null | undefined; frac?: number; className?: string }) {
  const v = value ?? 0
  return <span className={`num ${className}`}>{v.toLocaleString('pt-BR', { minimumFractionDigits: frac, maximumFractionDigits: frac })}</span>
}
```

```tsx
// Money.tsx
export function Money({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  const v = value ?? 0
  return <span className={`num ${className}`}>{v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
}
```

- [ ] **Step 3: Commit**

```bash
git add components/shell/NavItems.ts components/ui-kit/Num.tsx components/ui-kit/Money.tsx
git commit -m "feat(ui-kit): fonte única de navegação e primitivos numéricos mono"
```

---

### Task 3: App-shell responsivo (sidebar desktop + nav mobile)

**Files:**
- Create: `components/shell/Sidebar.tsx`, `components/shell/MobileNav.tsx`, `components/shell/UserMenu.tsx`, `components/shell/AppShell.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: `components/shell/Sidebar.tsx` (client)**

```tsx
'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type NavItem } from './NavItems'

const GRUPOS = ['Operação', 'Cadastros', 'Administração'] as const

export function Sidebar({ isAdmin, lojaSelector, userMenu }: { isAdmin: boolean; lojaSelector: React.ReactNode; userMenu: React.ReactNode }) {
  const pathname = usePathname()
  const itens = NAV_ITEMS.filter((i) => !i.admin || isAdmin)
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center px-5 border-b border-border">
        <Image src="/ntb-logo.png" alt="NTB" width={110} height={36} priority className="h-7 w-auto" />
      </div>
      <div className="px-3 py-3 border-b border-border">{lojaSelector}</div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {GRUPOS.map((g) => {
          const list = itens.filter((i) => i.group === g)
          if (!list.length) return null
          return (
            <div key={g}>
              <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted/60">{g}</p>
              <div className="space-y-0.5">
                {list.map((item) => <SideLink key={item.href} item={item} active={pathname === item.href || pathname.startsWith(item.href + '/')} />)}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-border p-3">{userMenu}</div>
    </aside>
  )
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link href={item.href}
      className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all duration-200 ${active ? 'bg-brand-soft text-text font-medium' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}
      style={{ transitionTimingFunction: 'var(--ease)' }}>
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-brand" />}
      <Icon className={`size-[17px] shrink-0 ${active ? 'text-brand' : 'text-text-muted/70 group-hover:text-text-muted'}`} strokeWidth={2} />
      {item.label}
    </Link>
  )
}
```

- [ ] **Step 2: `components/shell/MobileNav.tsx` (client)**

Top-bar com hamburger + drawer (reusa lista) + bottom-bar com 4 atalhos. Usa o mesmo NAV_ITEMS.

```tsx
'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, LayoutDashboard, FileText, ClipboardList, Package } from 'lucide-react'
import { NAV_ITEMS } from './NavItems'

const BOTTOM = [
  { href: '/home', label: 'Início', icon: LayoutDashboard },
  { href: '/nota-fiscal', label: 'NFs', icon: FileText },
  { href: '/inventario', label: 'Inventário', icon: ClipboardList },
  { href: '/produto', label: 'Produtos', icon: Package },
]

export function MobileNav({ isAdmin, lojaSelector, userMenu }: { isAdmin: boolean; lojaSelector: React.ReactNode; userMenu: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => { setOpen(false) }, [pathname])
  const itens = NAV_ITEMS.filter((i) => !i.admin || isAdmin)
  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 backdrop-blur px-3">
        <button onClick={() => setOpen(true)} aria-label="Menu" className="flex size-10 items-center justify-center rounded-md text-text hover:bg-surface-2"><Menu className="size-5" /></button>
        <Image src="/ntb-logo.png" alt="NTB" width={100} height={32} className="h-6 w-auto" />
      </header>
      {open && <div className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />}
      <aside className={`lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] bg-surface overflow-y-auto transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`} style={{ transitionTimingFunction: 'var(--ease)' }}>
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Image src="/ntb-logo.png" alt="NTB" width={100} height={32} className="h-6 w-auto" />
          <button onClick={() => setOpen(false)} aria-label="Fechar" className="flex size-9 items-center justify-center rounded-md hover:bg-surface-2"><X className="size-5" /></button>
        </div>
        <div className="px-3 py-3 border-b border-border">{lojaSelector}</div>
        <nav className="px-3 py-3 space-y-0.5">
          {itens.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm ${active ? 'bg-brand-soft text-text font-medium' : 'text-text-muted'}`}><Icon className={`size-[18px] ${active ? 'text-brand' : ''}`} />{item.label}</Link>
          })}
        </nav>
        <div className="border-t border-border p-3">{userMenu}</div>
      </aside>
      {/* Bottom bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur">
        {BOTTOM.map((b) => {
          const Icon = b.icon
          const active = pathname.startsWith(b.href)
          return <Link key={b.href} href={b.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active ? 'text-brand' : 'text-text-muted'}`}><Icon className="size-5" />{b.label}</Link>
        })}
      </nav>
    </>
  )
}
```

- [ ] **Step 3: `components/shell/UserMenu.tsx` (client)**

```tsx
'use client'
import { logout } from '@/lib/actions/auth'
import { LogOut } from 'lucide-react'

export function UserMenu({ nome, perfil }: { nome: string; perfil: string }) {
  const iniciais = nome.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  return (
    <div className="flex items-center gap-2.5">
      <div className="size-8 rounded-full bg-brand-soft text-brand flex items-center justify-center text-xs font-semibold shrink-0">{iniciais}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{nome}</div>
        <div className="text-[11px] text-text-muted">{perfil}</div>
      </div>
      <button onClick={() => logout()} aria-label="Sair" title="Sair" className="shrink-0 text-text-muted hover:text-err transition-colors"><LogOut className="size-4" /></button>
    </div>
  )
}
```

- [ ] **Step 4: `components/shell/AppShell.tsx` (client)**

```tsx
'use client'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'

export function AppShell({ isAdmin, lojaSelector, userMenu, children }: { isAdmin: boolean; lojaSelector: React.ReactNode; userMenu: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar isAdmin={isAdmin} lojaSelector={lojaSelector} userMenu={userMenu} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav isAdmin={isAdmin} lojaSelector={lojaSelector} userMenu={userMenu} />
        <main className="flex-1 min-w-0 pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Modificar `app/(app)/layout.tsx`**

```tsx
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { UserMenu } from '@/components/shell/UserMenu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  const supabase = await createClient()
  const { data: lojas } = await supabase.from('lojas').select('id, nome, nome_fantasia').eq('ativo', true).order('nome_fantasia')

  return (
    <AppShell
      isAdmin={isAdmin}
      lojaSelector={<LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />}
      userMenu={<UserMenu nome={profile.name} perfil={profile.perfil} />}
    >
      {children}
    </AppShell>
  )
}
```

- [ ] **Step 6: Ajustar `LojaSelector` para tema claro** (trigger `bg-surface border-border text-text`).

- [ ] **Step 7: Build + commit**

```bash
npm run build
git add components/shell app/(app)/layout.tsx components/loja/LojaSelector.tsx
git commit -m "feat(shell): app-shell responsivo sidebar desktop + nav mobile"
```

---

### Task 4: Primitivos de UI (PageHeader, StatCard, StatusPill, DataTable, Toolbar, EmptyState)

**Files:**
- Create: `components/ui-kit/PageHeader.tsx`, `StatCard.tsx`, `StatusPill.tsx`, `DataTable.tsx`, `Toolbar.tsx`, `EmptyState.tsx`

- [ ] **Step 1: `PageHeader.tsx`**

```tsx
import type { LucideIcon } from 'lucide-react'

export function PageHeader({ title, icon: Icon, description, actions }: { title: string; icon?: LucideIcon; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-center gap-2.5">
        {Icon && <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="size-[18px]" strokeWidth={2} /></span>}
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="text-[13px] text-text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 2: `StatCard.tsx`**

```tsx
import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Num } from './Num'

export function StatCard({ label, value, hint, icon: Icon, href, accent = '#2eb5c3' }: { label: string; value: number; hint?: string; icon: LucideIcon; href?: string; accent?: string }) {
  const inner = (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-surface p-4 transition-all duration-200 hover:shadow-[var(--shadow-md)]" style={{ transitionTimingFunction: 'var(--ease)' }}>
      <div className="flex items-center justify-between">
        <span className="flex size-8 items-center justify-center rounded-md" style={{ background: `${accent}1a` }}><Icon className="size-4" style={{ color: accent }} strokeWidth={2} /></span>
        {href && <ArrowUpRight className="size-4 text-text-muted/30 group-hover:text-text-muted transition-colors" />}
      </div>
      <div className="mt-3 text-[1.7rem] font-semibold leading-none num text-text"><Num value={value} /></div>
      <div className="mt-1.5 text-[13px] font-medium text-text">{label}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
```

- [ ] **Step 3: `StatusPill.tsx`** (mapa de status → cor + rótulo acentuado; valor de entrada é o do banco SEM acento)

```tsx
const MAP: Record<string, { label: string; color: string; bg: string }> = {
  Concluido: { label: 'Concluído', color: '#10b981', bg: '#10b9811a' },
  Finalizado: { label: 'Finalizado', color: '#10b981', bg: '#10b9811a' },
  Processando: { label: 'Processando', color: '#3b82f6', bg: '#3b82f61a' },
  'Em contagem': { label: 'Em contagem', color: '#f59e0b', bg: '#f59e0b1a' },
  Iniciado: { label: 'Iniciado', color: '#64748b', bg: '#64748b1a' },
  Erro: { label: 'Erro', color: '#ef4444', bg: '#ef44441a' },
}
export function StatusPill({ status }: { status: string | null }) {
  const s = (status && MAP[status]) || { label: status ?? 'N/A', color: '#64748b', bg: '#64748b1a' }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: s.color, background: s.bg }}>
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  )
}
```

- [ ] **Step 4: `DataTable.tsx`** (wrapper visual; recebe `<thead>/<tbody>` como children)

```tsx
export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-text-muted [&_thead]:border-b [&_thead]:border-border [&_thead]:bg-surface-2/50 [&_td]:px-4 [&_td]:py-2.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:transition-colors hover:[&_tbody_tr]:bg-surface-2/40">
          {children}
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `Toolbar.tsx` e `EmptyState.tsx`**

```tsx
// Toolbar.tsx
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-surface p-3">{children}</div>
}
```

```tsx
// EmptyState.tsx
import type { LucideIcon } from 'lucide-react'
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
      <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-text-muted"><Icon className="size-5" strokeWidth={1.75} /></span>
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="mt-0.5 text-[13px] text-text-muted">{hint}</p>}
    </div>
  )
}
```

- [ ] **Step 6: Build + commit**

```bash
npm run build
git add components/ui-kit
git commit -m "feat(ui-kit): PageHeader, StatCard, StatusPill, DataTable, Toolbar, EmptyState"
```

---

### Task 5: Dashboard (home) real

**Files:**
- Modify: `app/(app)/home/page.tsx`

- [ ] **Step 1: Reescrever a home** mantendo as queries de contagem existentes (produtos, NFs 30d, OPs, inventários abertos) e adicionando uma query de "últimas notas" (5). Layout: `PageHeader` + grid de 4 `StatCard` + bloco "Atalhos" (3 cards de ação) + `DataTable` "Últimas notas fiscais".

Regras: cada StatCard com `accent` distinto (#2eb5c3, #3b82f6, #a78bfa, #f59e0b) e `href`. Saudação "Olá, {primeiro nome}" + nome da loja + última sincronização. Sem inventar dado: se não houver loja, render EmptyState orientando a selecionar loja.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/home/page.tsx
git commit -m "feat(home): dashboard com KPIs, atalhos e últimas notas"
```

---

### Task 6: Listagens — grupo A (Notas Fiscais, Ordens de Produção, Produtos)

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`, `app/(app)/nota-fiscal/[id]/page.tsx`
- Modify: `app/(app)/ordem-producao/page.tsx`, `components/ordem-producao/OrdemProducaoRow.tsx`
- Modify: `app/(app)/produto/page.tsx`

- [ ] **Step 1: Converter cada página** para o padrão: `PageHeader` (com ícone + ações: Relatório/Sincronizar usando os botões do kit), `Toolbar` (filtros) quando houver, `DataTable` com colunas; números via `Num`/`Money`, status via `StatusPill`, vazio via `EmptyState`. NÃO alterar nenhuma query, permissão, nome de campo nem valor de status.

Colunas NF: Emissão · NFe · Fornecedor · Valor (dir, Money) · Status (pill) · ação "Ver". OP: OP · Produto · Qtd OP (dir) · Validade · Qtd etiqueta (input) · ações Imprimir/Concluir. Produto: tabela com busca na Toolbar.

- [ ] **Step 2: Botão de ação padrão.** Criar inline um par de classes no kit ou usar `buttonVariants`? Usar elementos `<a>/<button>` com classes Tailwind dos tokens: primário `bg-brand text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-strong)]`; secundário `border border-border bg-surface text-text ...`. (Definir uma vez em `components/ui-kit/Button.tsx` e reusar — criar nesta task.)

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add "app/(app)/nota-fiscal" "app/(app)/ordem-producao" "app/(app)/produto" components/ordem-producao components/ui-kit/Button.tsx
git commit -m "feat(listagens): NF, OP e Produtos no novo design system"
```

---

### Task 7: Listagens — grupo B (Transferências, Inventários + contagens)

**Files:**
- Modify: `app/(app)/transferencia/page.tsx`, `app/(app)/transferencia/[id]/contagem/page.tsx`, `components/transferencia/*`
- Modify: `app/(app)/inventario/page.tsx`, `app/(app)/inventario/[id]/contagem/page.tsx`, `components/inventario/*`

- [ ] **Step 1: Listagens** no padrão DataTable + StatusPill + ações (Duplicar/Reprocessar/Excluir/Contar). Manter lógica.

- [ ] **Step 2: Telas de contagem mobile-first** (usadas no estoque pelo celular): cabeçalho fixo com info da contagem; lista de itens com alvo de toque grande, stepper de quantidade (+/−) confortável no dedo, busca fixa no topo, e barra de ação inferior fixa (Salvar/Finalizar) acima da bottom-bar. Preservar toda a lógica de salvar/finalizar (que escreve ajuste real no Omie). NÃO acionar escrita em teste.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add "app/(app)/transferencia" "app/(app)/inventario" components/transferencia components/inventario
git commit -m "feat(listagens): Transferências e Inventários + contagem mobile-first"
```

---

### Task 8: Listagens — grupo C (Locais, Logs, Lojas, Usuários) + Login

**Files:**
- Modify: `app/(app)/local-estoque/page.tsx`, `app/(app)/log/page.tsx`, `components/log/LogDetalhe.tsx`, `components/BuscaSimples.tsx`
- Modify: `app/(app)/loja/page.tsx`, `components/loja/*`
- Modify: `app/(app)/usuario/page.tsx`, `components/usuario/*`
- Modify: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`

- [ ] **Step 1: Locais e Logs** no padrão DataTable (logs com StatusPill por resultado e detalhe expansível). **Lojas e Usuários**: cards/tabela com StatusPill, dialogs Base UI re-skin (header limpo, inputs do kit). Manter server actions intactas.

- [ ] **Step 2: Login** centralizado em card `bg-surface` com `--shadow-md`, logo, inputs do kit, botão primário teal, fundo `--bg` com leve gradiente radial teal no topo (sutil, sem exagero).

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add "app/(app)/local-estoque" "app/(app)/log" "app/(app)/loja" "app/(app)/usuario" "app/(auth)" components/log components/loja components/usuario components/BuscaSimples.tsx
git commit -m "feat(listagens): Locais, Logs, Lojas, Usuários e Login no design system"
```

---

### Task 9: Limpeza e verificação final

**Files:**
- Delete: `components/AppHeader.tsx`, `components/MenuNTB.tsx`, `components/sidebar/AppSidebar.tsx`, `components/sidebar/SidebarNav.tsx`, `components/PageHeader.tsx` (antigo, se substituído pelo do kit)

- [ ] **Step 1: Remover componentes órfãos** e qualquer import remanescente de `@/components/ui/{card,badge}` que tenha sobrado.

Run: `grep -rl "components/ui/card\|components/ui/badge\|MenuNTB\|AppHeader\|sidebar/AppSidebar" app components` → esperado: vazio.

- [ ] **Step 2: Build de produção limpo**

Run: `npm run build`
Expected: `✓ Compiled successfully`, sem erros de tipo, todas as rotas listadas.

- [ ] **Step 3: Verificação visual no deploy** (Chrome DevTools MCP): logar e revisar home, NF, inventário (desktop e viewport mobile 390px), confirmar: sidebar desktop, bottom-bar mobile, números em mono, status pills, contraste legível.

- [ ] **Step 4: Commit final + push**

```bash
git add -A
git commit -m "chore(redesign): remove shell antigo e finaliza design system"
git push origin main
```

---

## Self-Review

**Cobertura do spec:**
- Tokens/tipografia → Task 1 ✓
- App-shell desktop+mobile → Task 3 ✓ (decisão "operacional claro" da pergunta) 
- Números mono/tabular → Task 2 (Num/Money) + uso em 5-8 ✓
- KPIs no topo → Task 5 ✓
- Tabelas densas + status pills → Task 4 + 6-8 ✓
- Mobile-first contagem → Task 7 Step 2 ✓
- Login → Task 8 ✓
- Limpeza → Task 9 ✓

**Restrições preservadas:** queries/permissões/server actions intactas (reforçado em cada task); valores de status do banco SEM acento, só rótulo exibido acentuado (StatusPill mapeia); nunca acionar escrita Omie em teste (Task 7); sem travessão; acentuação correta.

**Consistência de tipos:** `NAV_ITEMS`/`NavItem` (Task 2) reusados em Sidebar/MobileNav (Task 3). `Num`/`Money`/`StatusPill`/`Button` definidos antes do uso (Task 2/4/6). Tokens (`--brand`, `--surface`, etc.) definidos na Task 1, usados em todas.

**Gap conhecido aceito:** dark mode fica como evolução futura (tokens já preparados); o relatório/filtro offcanvas do original não é replicado (substituído por Toolbar inline, melhor em desktop).
