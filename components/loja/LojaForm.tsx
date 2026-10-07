'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import {
  Building2,
  Check,
  FlaskConical,
  Lock,
  MapPin,
  Package,
  Pencil,
  Plus,
  Receipt,
  Share2,
  Store,
  Warehouse,
  X,
  RefreshCw,
  Ban,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { criarLoja, editarLoja, type LojaInput } from '@/lib/actions/loja'
import type { ModoEstoque } from '@/lib/estoque/ledger'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { CertificadoUpload } from '@/components/loja/CertificadoUpload'
import { IntegracaoNtbVendas } from '@/components/loja/IntegracaoNtbVendas'
import { MapeamentoLocalEstoque } from '@/components/loja/MapeamentoLocalEstoque'
import { PuxarEmpresa } from '@/components/loja/PuxarEmpresa'
import type { LocalEstoqueSimples } from '@/components/loja/LojaCard'

// ---------------------------------------------------------------------------
// Estilos e máscaras
// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted max-sm:text-base focus:ring-2 focus:ring-brand/40 disabled:opacity-60'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

function aplicarMascaraCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function aplicarMascaraCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

function aplicarMascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type LojaExistente = {
  id: number
  cnpj: string | null
  nome: string | null
  nome_fantasia: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento?: string | null
  email?: string | null
  telefone1?: string | null
  omie_app_key: string | null
  omie_app_secret: string | null
  ativo: boolean | null
  modo_estoque?: string | null
  is_test?: boolean | null
  /** true quando a loja já tem movimento no estoque próprio (o modo trava). */
  tem_movimentos_estoque?: boolean
  /** boolean calculado no servidor: a chave em si nunca chega ao navegador. */
  integracao_ntb_vendas_configurada?: boolean
  local_estoque_cozinha_codigo?: number | null
  local_estoque_bar_codigo?: number | null
  certificado_nome?: string | null
  certificado_validade?: string | null
  razao_social?: string | null
  inscricao_estadual?: string | null
  inscricao_municipal?: string | null
  cnae?: string | null
  regime_tributario?: string | null
  sped_nome_contador?: string | null
  csc_producao?: string | null
  [key: string]: unknown
}

function vazio(): LojaInput {
  return {
    cnpj: '',
    nome: '',
    nome_fantasia: '',
    cep: '',
    uf: '',
    cidade: '',
    bairro: '',
    logradouro: '',
    numero: '',
    complemento: '',
    email: '',
    telefone1: '',
    omie_app_key: '',
    omie_app_secret: '',
    ativo: true,
    modo_estoque: 'omie',
    is_test: false,
  }
}

function fromLoja(l: LojaExistente): LojaInput {
  return {
    cnpj: l.cnpj ?? '',
    nome: l.nome ?? '',
    nome_fantasia: l.nome_fantasia ?? '',
    cep: l.cep ?? '',
    uf: l.uf ?? '',
    cidade: l.cidade ?? '',
    bairro: l.bairro ?? '',
    logradouro: l.logradouro ?? '',
    numero: l.numero ?? '',
    complemento: l.complemento ?? '',
    email: l.email ?? '',
    telefone1: l.telefone1 ?? '',
    omie_app_key: l.omie_app_key ?? '',
    omie_app_secret: l.omie_app_secret ?? '',
    ativo: l.ativo ?? true,
    modo_estoque: l.modo_estoque === 'proprio' || l.modo_estoque === 'nenhum' ? l.modo_estoque : 'omie',
  }
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

type SecaoId = 'identidade' | 'estoque' | 'locais' | 'fiscal' | 'integracao' | 'teste'

const SECOES: { id: SecaoId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'identidade', label: 'Identidade', hint: 'Nome, CNPJ e endereço', icon: Building2 },
  { id: 'estoque', label: 'Estoque', hint: 'Modo de controle', icon: Package },
  { id: 'locais', label: 'Locais', hint: 'Locais de baixa', icon: Warehouse },
  { id: 'fiscal', label: 'Fiscal', hint: 'Certificado e empresa', icon: Receipt },
  { id: 'integracao', label: 'Norte Vendas', hint: 'Ligação com o PDV', icon: Share2 },
  { id: 'teste', label: 'Teste', hint: 'Loja de teste', icon: FlaskConical },
]

const MODOS: { id: ModoEstoque; titulo: string; texto: string; icon: LucideIcon }[] = [
  {
    id: 'omie',
    titulo: 'Integrado ao Omie',
    texto: 'O estoque continua sincronizado com o Omie, como funciona hoje.',
    icon: RefreshCw,
  },
  {
    id: 'proprio',
    titulo: 'Estoque próprio',
    texto: 'O Norte Estoque é o dono do estoque: produtos, locais, entradas, saídas, receitas, inventário e notas de entrada.',
    icon: Warehouse,
  },
  {
    id: 'nenhum',
    titulo: 'Sem controle de estoque',
    texto: 'A loja só vende. Nenhuma baixa de estoque é feita.',
    icon: Ban,
  },
]

const REGIME: Record<string, string> = {
  '1': 'Simples Nacional',
  '2': 'Simples Nacional (excesso)',
  '3': 'Regime Normal',
}

function Chave({ onChange, checked, label, desc, disabled }: { onChange: (v: boolean) => void; checked: boolean; label: string; desc?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] bg-surface-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-text">{label}</div>
        {desc && <p className="mt-0.5 text-[13px] text-text-muted">{desc}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[26px] w-[44px] shrink-0 rounded-full u-motion disabled:opacity-60 ${checked ? 'bg-brand-fill' : 'bg-[var(--border)]'}`}
      >
        <span
          className="absolute top-[3px] size-5 rounded-full bg-white shadow-[var(--shadow-sm)] u-motion"
          style={{ left: checked ? 21 : 3 }}
        />
      </button>
    </div>
  )
}

function Titulo({ children, desc }: { children: React.ReactNode; desc?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[19px] font-semibold tracking-tight text-text">{children}</h3>
      {desc && <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-text-muted">{desc}</p>}
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="eyebrow mb-2">{titulo}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">{children}</div>
    </div>
  )
}

function Dado({ label, valor, mono }: { label: string; valor: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <div className={`truncate text-[13px] text-text${mono ? ' num' : ''}`} title={valor ?? undefined}>
        {valor || '—'}
      </div>
    </div>
  )
}

function SoDepoisDeCriar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] bg-surface-2 p-4 text-[13px] text-text-muted">
      <Lock className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export function LojaForm({
  loja,
  locais = [],
}: {
  loja?: LojaExistente
  locais?: LocalEstoqueSimples[]
}) {
  const editando = !!loja
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LojaInput>(loja ? fromLoja(loja) : vazio())
  const [criarNoVendas, setCriarNoVendas] = useState(false)
  const [secao, setSecao] = useState<SecaoId>('identidade')
  const [tentou, setTentou] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const modo: ModoEstoque = form.modo_estoque ?? 'omie'
  const travado = editando && !!loja?.tem_movimentos_estoque

  function set<K extends keyof LojaInput>(campo: K, valor: LojaInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  const secoesVisiveis = useMemo(() => SECOES.filter((s) => s.id !== 'locais' || modo === 'proprio'), [modo])
  const faltaIdentidade = !form.cnpj.trim() || !form.nome.trim()

  function abrir(v: boolean) {
    setOpen(v)
    if (v) {
      setSecao('identidade')
      setTentou(false)
    }
  }

  function salvar() {
    if (faltaIdentidade) {
      setTentou(true)
      setSecao('identidade')
      toast.error('Preencha CNPJ e nome')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarLoja(loja!.id, form) : await criarLoja(form, criarNoVendas)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Loja atualizada' : 'Loja criada')
      const aviso = res as { avisoVendas?: string; avisoSemente?: string } | undefined
      if (aviso?.avisoSemente) toast.error('Atenção', { description: aviso.avisoSemente })
      const avisoVendas = aviso?.avisoVendas
      if (!editando && avisoVendas) {
        toast.error('Loja criada, mas o Norte Vendas ficou pendente', { description: avisoVendas })
      } else if (!editando && criarNoVendas) {
        toast.success('Loja criada no Norte Vendas também')
      }
      setOpen(false)
      if (!editando) {
        setForm(vazio())
        setCriarNoVendas(false)
      }
      router.refresh()
    })
  }

  const secaoAtual = secoesVisiveis.some((s) => s.id === secao) ? secao : 'identidade'

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger
        render={
          editando ? (
            <button type="button" className={btnClass('outline')}>
              <Pencil className="size-4" /> Editar
            </button>
          ) : (
            <button type="button" className={btnClass('primary')}>
              <Plus className="size-4" /> Nova loja
            </button>
          )
        }
      />
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden bg-surface p-0 sm:h-[min(88vh,860px)] sm:w-[min(max(70vw,780px),1180px)] sm:max-w-[calc(100vw-2rem)] max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-full max-sm:rounded-none max-sm:overflow-hidden max-sm:pb-0"
      >
        {/* Cabeçalho */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4 sm:px-7">
          <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-md)] bg-brand-soft text-brand">
            <Store className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-text">
              {editando ? (form.nome_fantasia || form.nome || 'Editar loja') : 'Nova loja'}
            </div>
            <div className="truncate text-[13px] text-text-muted">
              {editando ? 'Editar loja' : 'Cadastro de loja'} ·{' '}
              {modo === 'proprio' ? 'Estoque próprio' : modo === 'nenhum' ? 'Sem controle de estoque' : 'Integrada ao Omie'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-text-muted u-motion hover:bg-[var(--border)] hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Navegação das seções */}
          <nav
            aria-label="Seções do cadastro"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-3 py-2 sm:w-[232px] sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-3 sm:py-4"
          >
            {secoesVisiveis.map((s) => {
              const ativo = s.id === secaoAtual
              const Icon = s.icon
              const pendente = s.id === 'identidade' && faltaIdentidade && tentou
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSecao(s.id)}
                  aria-current={ativo ? 'page' : undefined}
                  className={`group flex shrink-0 items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-left u-motion sm:w-full ${
                    ativo ? 'bg-brand-soft text-brand' : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  <Icon className="size-[18px] shrink-0" />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-[14px] font-semibold leading-tight">{s.label}</span>
                    <span className="hidden truncate text-[12px] font-normal opacity-80 sm:block">{s.hint}</span>
                  </span>
                  {pendente && <span className="ml-auto size-2 shrink-0 rounded-full bg-err" aria-label="Campo obrigatório pendente" />}
                </button>
              )
            })}
          </nav>

          {/* Conteúdo */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
            {secaoAtual === 'identidade' && (
              <div>
                <Titulo desc="Dados que identificam a loja neste sistema e nas integrações.">Identidade da loja</Titulo>
                <Chave
                  checked={form.ativo}
                  onChange={(v) => set('ativo', v)}
                  label={form.ativo ? 'Loja ativa' : 'Loja inativa'}
                  desc="Loja inativa deixa de aparecer para os usuários e sai das rotinas automáticas."
                />
                <div className="mt-6">
                  <Grupo titulo="Empresa">
                    <div className="sm:col-span-4">
                      <label className={labelClass}>Nome</label>
                      <input
                        className={`${inputClass} ${tentou && !form.nome.trim() ? 'ring-2 ring-err/60' : ''}`}
                        value={form.nome}
                        onChange={(e) => set('nome', e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>CNPJ</label>
                      <input
                        className={`${inputClass} num ${tentou && !form.cnpj.trim() ? 'ring-2 ring-err/60' : ''}`}
                        value={form.cnpj}
                        placeholder="XX.XXX.XXX/XXXX-XX"
                        onChange={(e) => set('cnpj', aplicarMascaraCnpj(e.target.value))}
                        maxLength={18}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="sm:col-span-6">
                      <label className={labelClass}>Nome fantasia</label>
                      <input
                        className={inputClass}
                        value={form.nome_fantasia}
                        onChange={(e) => set('nome_fantasia', e.target.value)}
                      />
                    </div>
                  </Grupo>
                  <Grupo titulo="Contato">
                    <div className="sm:col-span-4">
                      <label className={labelClass}>E-mail</label>
                      <input
                        className={inputClass}
                        type="email"
                        value={form.email ?? ''}
                        onChange={(e) => set('email', e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Telefone</label>
                      <input
                        className={`${inputClass} num`}
                        value={form.telefone1 ?? ''}
                        placeholder="(00) 00000-0000"
                        onChange={(e) => set('telefone1', aplicarMascaraTelefone(e.target.value))}
                        inputMode="tel"
                      />
                    </div>
                  </Grupo>
                  <Grupo titulo="Endereço">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>CEP</label>
                      <input
                        className={`${inputClass} num`}
                        value={form.cep}
                        placeholder="XXXXX-XXX"
                        maxLength={9}
                        onChange={(e) => set('cep', aplicarMascaraCep(e.target.value))}
                        inputMode="numeric"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className={labelClass}>UF</label>
                      <input
                        className={inputClass}
                        value={form.uf}
                        maxLength={2}
                        placeholder="BA"
                        onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelClass}>Cidade</label>
                      <input className={inputClass} value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelClass}>Bairro</label>
                      <input className={inputClass} value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelClass}>Logradouro</label>
                      <input
                        className={inputClass}
                        value={form.logradouro}
                        onChange={(e) => set('logradouro', e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Número</label>
                      <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
                    </div>
                    <div className="sm:col-span-4">
                      <label className={labelClass}>Complemento</label>
                      <input
                        className={inputClass}
                        value={form.complemento ?? ''}
                        onChange={(e) => set('complemento', e.target.value)}
                      />
                    </div>
                  </Grupo>
                </div>
              </div>
            )}

            {secaoAtual === 'estoque' && (
              <div>
                <Titulo desc="Define quem é o dono do estoque desta loja. A escolha vale para o Norte Estoque e para o Norte Vendas.">
                  Como a loja controla o estoque
                </Titulo>
                <div role="radiogroup" aria-label="Modo de estoque" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {MODOS.map((m) => {
                    const ativo = modo === m.id
                    const Icon = m.icon
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={ativo}
                        disabled={travado && !ativo}
                        onClick={() => !travado && set('modo_estoque', m.id)}
                        className={`relative flex flex-col items-start gap-2 rounded-[var(--r-lg)] p-4 text-left u-motion disabled:cursor-not-allowed disabled:opacity-50 ${
                          ativo
                            ? 'bg-brand-soft ring-2 ring-brand'
                            : 'bg-surface-2 hover:bg-[var(--border)]'
                        }`}
                      >
                        <span className={`grid size-9 place-items-center rounded-full ${ativo ? 'bg-brand-fill text-white' : 'bg-surface text-text-muted'}`}>
                          <Icon className="size-[18px]" />
                        </span>
                        <span className="text-[15px] font-semibold text-text">{m.titulo}</span>
                        <span className="text-[13px] leading-relaxed text-text-muted">{m.texto}</span>
                        {ativo && (
                          <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-brand-fill text-white">
                            <Check className="size-3" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {travado ? (
                  <div className="mt-3 flex items-start gap-2 text-[13px] text-text-muted">
                    <Lock className="mt-0.5 size-4 shrink-0" />
                    <p>Esta loja já tem movimentos de estoque próprio, então o modo não pode mais ser trocado.</p>
                  </div>
                ) : (
                  editando && (
                    <p className="mt-3 text-[13px] text-text-muted">
                      O modo só pode ser trocado antes do primeiro movimento de estoque próprio.
                    </p>
                  )
                )}

                {modo === 'omie' && (
                  <div className="mt-6">
                    <Grupo titulo="Chaves do Omie">
                      <div className="sm:col-span-3">
                        <label className={labelClass}>Omie App Key</label>
                        <input
                          className={inputClass}
                          value={form.omie_app_key}
                          onChange={(e) => set('omie_app_key', e.target.value)}
                          placeholder="Deixe vazio para loja fora do Omie"
                          autoComplete="off"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className={labelClass}>Omie App Secret</label>
                        <input
                          className={inputClass}
                          value={form.omie_app_secret}
                          onChange={(e) => set('omie_app_secret', e.target.value)}
                          placeholder="Deixe vazio para loja fora do Omie"
                          autoComplete="off"
                        />
                      </div>
                    </Grupo>
                  </div>
                )}

                {modo === 'proprio' && !editando && (
                  <div className="mt-6 rounded-[var(--r-lg)] bg-surface-2 p-4">
                    <div className="eyebrow mb-1.5">Já nasce pronta</div>
                    <p className="text-[13px] leading-relaxed text-text">
                      Locais <strong>Estoque Geral</strong> (padrão), <strong>Bar</strong> e <strong>Cozinha</strong>, mais as
                      famílias Bebidas, Cozinha, Insumos, Limpeza e Embalagens. Os códigos dos produtos seguem o tipo do item:
                      90 vendável, 80 matéria-prima, 70 intermediário, 60 uso e consumo, 50 embalagem e outros.
                    </p>
                  </div>
                )}
              </div>
            )}

            {secaoAtual === 'locais' && modo === 'proprio' && (
              <div>
                <Titulo desc="Escolha de qual local de estoque sai a baixa dos itens preparados no Bar e na Cozinha quando o Norte Vendas fecha uma venda.">
                  Locais de baixa
                </Titulo>
                {editando ? (
                  <>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {locais.length ? (
                        locais.map((l) => (
                          <span
                            key={l.codigo_local_estoque}
                            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-text"
                          >
                            <MapPin className="size-3 text-text-muted" />
                            {l.descricao}
                          </span>
                        ))
                      ) : (
                        <span className="text-[13px] text-text-muted">Nenhum local cadastrado ainda.</span>
                      )}
                    </div>
                    <MapeamentoLocalEstoque
                      lojaId={loja!.id}
                      locais={locais}
                      cozinhaAtual={loja?.local_estoque_cozinha_codigo ?? null}
                      barAtual={loja?.local_estoque_bar_codigo ?? null}
                      modo={modo}
                    />
                    <p className="mt-4 text-[13px] text-text-muted">
                      Para criar ou renomear locais, use{' '}
                      <a href="/local-estoque" className="font-medium text-brand hover:underline">Locais de Estoque</a>.
                    </p>
                  </>
                ) : (
                  <SoDepoisDeCriar>
                    Ao criar a loja, os locais Estoque Geral, Bar e Cozinha já são criados e o Bar e a Cozinha ficam como locais
                    de baixa. Você ajusta aqui depois.
                  </SoDepoisDeCriar>
                )}
              </div>
            )}

            {secaoAtual === 'fiscal' && (
              <div>
                <Titulo desc="Certificado digital A1 da loja e os dados cadastrais da empresa.">Fiscal</Titulo>
                {editando ? (
                  <div className="space-y-6">
                    <div>
                      <CertificadoUpload
                        lojaId={loja!.id}
                        nome={loja?.certificado_nome ?? null}
                        validade={loja?.certificado_validade ?? null}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        <span className="text-[14px] font-semibold text-text">Dados da empresa</span>
                        {modo === 'omie' && <PuxarEmpresa lojaId={loja!.id} />}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                        <Dado label="Razão Social" valor={loja?.razao_social ?? null} />
                        <Dado label="Inscrição Estadual" valor={loja?.inscricao_estadual ?? null} mono />
                        <Dado label="Inscrição Municipal" valor={loja?.inscricao_municipal ?? null} mono />
                        <Dado label="CNAE" valor={loja?.cnae ?? null} mono />
                        <Dado
                          label="Regime Tributário"
                          valor={loja?.regime_tributario ? (REGIME[loja.regime_tributario] ?? loja.regime_tributario) : null}
                        />
                        <Dado label="Contador" valor={loja?.sped_nome_contador ?? null} />
                        <Dado label="CSC Produção" valor={loja?.csc_producao ? 'definido' : null} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <SoDepoisDeCriar>
                    O certificado e os dados fiscais são enviados depois que a loja é criada: abra a loja em Editar e volte a esta
                    seção.
                  </SoDepoisDeCriar>
                )}
              </div>
            )}

            {secaoAtual === 'integracao' && (
              <div>
                <Titulo desc="Liga esta loja ao PDV do Norte Vendas: cada venda fechada lá baixa o estoque aqui.">
                  Integração com o Norte Vendas
                </Titulo>
                {editando ? (
                  <div className="space-y-6">
                    <IntegracaoNtbVendas lojaId={loja!.id} configurada={!!loja?.integracao_ntb_vendas_configurada} />
                    {modo !== 'proprio' && (
                      <div className="border-t border-border/60 pt-5">
                        <p className="mb-2 text-[14px] font-semibold text-text">Local de estoque por destino (Cozinha/Bar)</p>
                        <MapeamentoLocalEstoque
                          lojaId={loja!.id}
                          locais={locais}
                          cozinhaAtual={loja?.local_estoque_cozinha_codigo ?? null}
                          barAtual={loja?.local_estoque_bar_codigo ?? null}
                          modo={modo}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <Chave
                    checked={criarNoVendas}
                    onChange={setCriarNoVendas}
                    label="Criar no Norte Vendas também"
                    desc="Cria a loja no Norte Vendas já ligada a esta, com a chave de integração configurada nos dois lados."
                  />
                )}
              </div>
            )}

            {secaoAtual === 'teste' && (
              <div>
                <Titulo desc="Loja de teste serve para experimentar sem risco: fica fora das rotinas automáticas.">
                  Loja de teste
                </Titulo>
                {editando ? (
                  <div className="flex items-center gap-2 rounded-[var(--r-lg)] bg-surface-2 p-4 text-[14px] text-text">
                    <FlaskConical className="size-4 text-text-muted" />
                    {loja?.is_test ? 'Esta é uma loja de teste.' : 'Esta é uma loja de produção.'}
                  </div>
                ) : (
                  <Chave
                    checked={!!form.is_test}
                    onChange={(v) => set('is_test', v)}
                    label="Criar como loja de teste"
                    desc={
                      modo === 'omie'
                        ? 'As escritas no Omie ficam simuladas e a loja fica fora das rotinas automáticas.'
                        : 'A loja fica fora das rotinas automáticas.'
                    }
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé fixo */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-7">
          <p className="min-w-0 flex-1 truncate text-[13px] text-text-muted">
            {tentou && faltaIdentidade ? <span className="text-err">Preencha CNPJ e nome para continuar.</span> : 'As alterações só valem depois de salvar.'}
          </p>
          <button type="button" onClick={() => setOpen(false)} className={btnClass('outline')}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar loja'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
