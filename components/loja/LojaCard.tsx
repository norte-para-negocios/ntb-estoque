'use client'

import { useState } from 'react'
import {
  ChevronDown,
  RefreshCw,
  Key,
  MapPin,
  Building2,
  ShieldCheck,
  KeyRound,
  Share2,
  Users,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pencil,
  Trash2,
} from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { ForceSyncLoja } from '@/components/loja/ForceSyncLoja'
import { PuxarEmpresa } from '@/components/loja/PuxarEmpresa'
import { CertificadoUpload } from '@/components/loja/CertificadoUpload'
import { CodigoOnboarding } from '@/components/loja/CodigoOnboarding'
import { IntegracaoNtbVendas } from '@/components/loja/IntegracaoNtbVendas'
import { MapeamentoLocalEstoque } from '@/components/loja/MapeamentoLocalEstoque'
import { LojaForm } from '@/components/loja/LojaForm'
import { ExcluirLoja } from '@/components/loja/ExcluirLoja'
import { ConvidarUsuario } from '@/components/usuario/ConvidarUsuario'
import type { CorToken } from '@/lib/status-cor'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type LojaRow = {
  id: number
  cnpj: string | null
  nome: string | null
  nome_fantasia: string | null
  ativo: boolean | null
  // sync
  local_estoque_ultima_atualizacao: string | null
  local_estoque_status: string | null
  produto_ultima_atualizacao: string | null
  produto_status: string | null
  ordem_producao_ultima_atualizacao: string | null
  ordem_producao_status: string | null
  nota_fiscal_ultima_atualizacao: string | null
  nota_fiscal_status: string | null
  // empresa
  empresa_status: string | null
  empresa_ultima_atualizacao: string | null
  // omie
  omie_app_key: string | null
  omie_app_secret: string | null
  // endereco
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  complemento: string | null
  // empresa omie
  razao_social: string | null
  inscricao_estadual: string | null
  inscricao_municipal: string | null
  cnae: string | null
  regime_tributario: string | null
  sped_nome_contador: string | null
  email: string | null
  telefone1: string | null
  csc_producao: string | null
  // certificado
  certificado_nome: string | null
  certificado_validade: string | null
  // onboarding
  codigo_onboarding: string | null
  // integracao ntb-vendas -- boolean computado no server component, a chave
  // em si (integracao_api_key) nunca chega no client (write-only)
  integracao_ntb_vendas_configurada: boolean
  // mapeamento "qual local de estoque e' a Cozinha / o Bar" (migration 120)
  local_estoque_cozinha_codigo: number | null
  local_estoque_bar_codigo: number | null
}

export type LocalEstoqueSimples = { codigo_local_estoque: number; descricao: string }

export type PermissaoSimples = { id: number; nome: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REGIME: Record<string, string> = {
  '1': 'Simples Nacional',
  '2': 'Simples Nacional (excesso)',
  '3': 'Regime Normal',
}

function regimeLabel(v: string | null): string | null {
  if (!v) return null
  return REGIME[v] ? `${REGIME[v]} (${v})` : v
}

function fmt(d: string | null): string {
  if (!d) return '--'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })
}

function fmtData(d: string | null): string {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

function enderecoCompleto(loja: LojaRow): string | null {
  const log = loja.logradouro?.trim()
  const num = loja.numero?.trim()
  const bairro = loja.bairro?.trim()
  const cidade = loja.cidade?.trim()
  const uf = loja.uf?.trim().toUpperCase()
  const cep = loja.cep?.trim()
  const linha1 = [log, num].filter(Boolean).join(', ')
  const linha2 = [bairro, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(' - ')
  const partes = [linha1, linha2, cep ? `CEP ${maskCep(cep)}` : ''].filter(Boolean)
  return partes.length ? partes.join(' · ') : null
}

// Mascaras

function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14) return v
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function maskCep(v: string): string {
  const d = v.replace(/\D/g, '')
  if (d.length !== 8) return v
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

function maskTelefone(v: string): string {
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return v
}

// Mascara de segredo omie: mostra so os ultimos 4 chars com asteriscos antes
function maskSegredo(v: string | null): string {
  if (!v) return '-'
  if (v.length <= 4) return '****'
  return `${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`
}

// ---------------------------------------------------------------------------
// Health Badge (semaforo de sync)
// Logica: todos ok = ok, qualquer erro = err, senao warn, null = neutro
// ---------------------------------------------------------------------------

type HealthStatus = 'ok' | 'warn' | 'err' | 'vazio'

function calcHealth(loja: LojaRow): HealthStatus {
  const statuses = [
    loja.local_estoque_status,
    loja.produto_status,
    loja.ordem_producao_status,
    loja.nota_fiscal_status,
  ]
  const preenchidos = statuses.filter(Boolean)
  if (preenchidos.length === 0) return 'vazio'
  if (preenchidos.some((s) => s === 'Erro')) return 'err'
  if (preenchidos.every((s) => s === 'Concluido')) return 'ok'
  return 'warn'
}

const HEALTH_CONFIG: Record<
  HealthStatus,
  { label: string; token: CorToken; icon: React.ElementType }
> = {
  ok: { label: 'Sincronizado', token: 'ok', icon: CheckCircle2 },
  warn: { label: 'Atenção', token: 'warn', icon: AlertTriangle },
  err: { label: 'Erro', token: 'err', icon: XCircle },
  vazio: { label: 'Nunca sincronizado', token: 'neutro', icon: RefreshCw },
}

const HEALTH_CLASSES: Record<HealthStatus, string> = {
  ok: 'text-ok bg-ok/10',
  warn: 'text-warn bg-warn/10',
  err: 'text-err bg-err/10',
  vazio: 'text-text-muted bg-surface-2',
}

function HealthBadge({ loja }: { loja: LojaRow }) {
  const h = calcHealth(loja)
  const cfg = HEALTH_CONFIG[h]
  const Icon = cfg.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${HEALTH_CLASSES[h]}`}
    >
      <Icon className="size-3.5" />
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Secao colapsavel
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left u-motion hover:bg-surface-2/60"
        aria-expanded={open}
      >
        <Icon className="size-4 shrink-0 text-text-muted" />
        <span className="flex-1 text-[13px] font-medium text-text">{title}</span>
        {badge && <span className="shrink-0">{badge}</span>}
        <ChevronDown
          className="size-4 shrink-0 text-text-muted u-motion"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform var(--dur-slow) var(--ease-in-out)`,
          }}
        />
      </button>

      {/* Acordeao animado */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: open ? '999px' : '0',
          opacity: open ? 1 : 0,
          transition: `max-height var(--dur-slow) var(--ease-in-out), opacity var(--dur) var(--ease-out)`,
        }}
      >
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de dado (label + valor)
// ---------------------------------------------------------------------------

function DadoLinha({
  label,
  valor,
  mono,
}: {
  label: string
  valor: string | null | undefined
  mono?: boolean
}) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <div
        className={`truncate text-[13px] text-text${mono ? ' num' : ''}`}
        title={valor ?? undefined}
      >
        {valor || '-'}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card principal
// ---------------------------------------------------------------------------

export function LojaCard({
  loja,
  permissoes,
  locaisEstoque,
}: {
  loja: LojaRow
  permissoes: PermissaoSimples[]
  locaisEstoque: LocalEstoqueSimples[]
}) {
  const displayName = loja.nome_fantasia || loja.nome || '(sem nome)'
  const cidadeUf = [loja.cidade?.trim(), loja.uf?.trim().toUpperCase()]
    .filter(Boolean)
    .join('/')

  const syncs = [
    { label: 'Local de Estoque', data: loja.local_estoque_ultima_atualizacao, status: loja.local_estoque_status },
    { label: 'Produto', data: loja.produto_ultima_atualizacao, status: loja.produto_status },
    { label: 'Ordem de Produção', data: loja.ordem_producao_ultima_atualizacao, status: loja.ordem_producao_status },
    { label: 'Nota Fiscal', data: loja.nota_fiscal_ultima_atualizacao, status: loja.nota_fiscal_status },
  ]

  // Master-detail: a loja comeca fechada; clicar no cabecalho revela as secoes.
  const [aberta, setAberta] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-surface u-card overflow-hidden">
      {/* Cabecalho compacto — clicar NA loja abre/fecha as secoes (master-detail). */}
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-3 px-4 py-3 text-left u-motion hover:bg-surface-2/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text">{displayName}</span>
            {!loja.ativo && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                Inativa
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {cidadeUf && (
              <span className="flex items-center gap-1 text-[12px] text-text-muted">
                <MapPin className="size-3" />
                {cidadeUf}
              </span>
            )}
            {loja.cnpj && (
              <span className="num text-[12px] text-text-muted">{maskCnpj(loja.cnpj)}</span>
            )}
          </div>
        </div>
        <HealthBadge loja={loja} />
        <ChevronDown
          className="size-4 shrink-0 text-text-muted"
          style={{
            transform: aberta ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform var(--dur-slow) var(--ease-in-out)`,
          }}
        />
      </button>

      {aberta && (
        <div className="animate-in fade-in" style={{ animationDuration: 'var(--dur)' }}>

      {/* Seção: Sincronização */}
      <Section icon={RefreshCw} title="Sincronização" badge={<StatusPill status={loja.empresa_status} />}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ForceSyncLoja lojaId={loja.id} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {syncs.map((s) => (
            <div key={s.label} className="rounded-md border border-border bg-surface-2/40 p-3">
              <div className="eyebrow">{s.label}</div>
              <p className="num mt-1 text-[12px] font-medium text-text">{fmt(s.data)}</p>
              <div className="mt-1.5">
                <StatusPill status={s.status} />
              </div>
            </div>
          ))}
        </div>
        {loja.empresa_ultima_atualizacao && (
          <p className="mt-2 text-[12px] text-text-muted">
            Dados empresa atualizados em{' '}
            <span className="text-text">{fmt(loja.empresa_ultima_atualizacao)}</span>
          </p>
        )}
      </Section>

      {/* Seção: Chaves Omie */}
      <Section icon={Key} title="Chaves Omie">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DadoLinha label="App Key" valor={maskSegredo(loja.omie_app_key)} mono />
          <DadoLinha label="App Secret" valor={maskSegredo(loja.omie_app_secret)} mono />
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          Para editar as chaves, use o botão &quot;Editar loja&quot; abaixo.
        </p>
      </Section>

      {/* Seção: Endereço */}
      <Section icon={MapPin} title="Endereço">
        {enderecoCompleto(loja) ? (
          <p className="text-[13px] text-text">{enderecoCompleto(loja)}</p>
        ) : (
          <p className="text-[13px] text-text-muted">
            Sem endereço. Edite a loja para informar, ou use &quot;Dados da empresa&quot; para trazer do Omie.
          </p>
        )}
        {loja.complemento && (
          <p className="mt-1 text-[13px] text-text-muted">Complemento: {loja.complemento}</p>
        )}
      </Section>

      {/* Seção: Dados da empresa */}
      <Section icon={Building2} title="Dados da empresa (Omie)">
        <div className="mb-3 flex">
          <PuxarEmpresa lojaId={loja.id} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <DadoLinha label="Razão Social" valor={loja.razao_social} />
          <DadoLinha label="Inscrição Estadual" valor={loja.inscricao_estadual} mono />
          <DadoLinha label="Inscrição Municipal" valor={loja.inscricao_municipal} mono />
          <DadoLinha label="CNAE" valor={loja.cnae} mono />
          <DadoLinha label="Regime Tributário" valor={regimeLabel(loja.regime_tributario)} />
          <DadoLinha label="Contador" valor={loja.sped_nome_contador} />
          <DadoLinha label="E-mail" valor={loja.email} />
          <DadoLinha
            label="Telefone"
            valor={loja.telefone1 ? maskTelefone(loja.telefone1) : null}
            mono
          />
          <DadoLinha label="CSC Produção" valor={loja.csc_producao ? 'definido' : null} />
        </div>
      </Section>

      {/* Secao: Certificado */}
      <Section icon={ShieldCheck} title="Certificado digital A1">
        <CertificadoUpload
          lojaId={loja.id}
          nome={loja.certificado_nome}
          validade={loja.certificado_validade}
        />
      </Section>

      {/* Seção: Acesso de usuários */}
      <Section icon={Users} title="Acesso de usuários">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-text-muted" />
          <span className="text-[13px] font-medium text-text">Código de onboarding</span>
        </div>
        <p className="mb-3 text-[12px] text-text-muted">
          Quem tiver este código entra no cadastro já vinculado a esta loja (como usuário, sem
          permissões; ajuste depois). Regenerar invalida o código anterior.
        </p>
        <CodigoOnboarding lojaId={loja.id} codigo={loja.codigo_onboarding} />
        <div className="mt-4 border-t border-border pt-4">
          <ConvidarUsuario
            lojas={[{ id: loja.id, nome: loja.nome ?? '', nome_fantasia: loja.nome_fantasia }]}
            permissoes={permissoes}
            podeAdminLoja
            lojaFixaId={loja.id}
            triggerLabel="Convidar por código (com permissões)"
          />
        </div>
      </Section>

      {/* Seção: Integração com NTB Vendas */}
      <Section icon={Share2} title="Integração com NTB Vendas">
        <IntegracaoNtbVendas lojaId={loja.id} configurada={loja.integracao_ntb_vendas_configurada} />
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-[13px] font-medium text-text">Local de estoque por destino (Cozinha/Bar)</p>
          <MapeamentoLocalEstoque
            lojaId={loja.id}
            locais={locaisEstoque}
            cozinhaAtual={loja.local_estoque_cozinha_codigo}
            barAtual={loja.local_estoque_bar_codigo}
          />
        </div>
      </Section>

      {/* Rodapé: ações de edição/exclusão */}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <LojaForm loja={loja} />
        <ExcluirLoja lojaId={loja.id} nome={loja.nome_fantasia || loja.nome || '(sem nome)'} />
      </div>
        </div>
      )}
    </div>
  )
}
