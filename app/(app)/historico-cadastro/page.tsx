import { notFound } from 'next/navigation'
import Link from 'next/link'
import { History } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ListaMomentos } from '@/components/historico/ListaMomentos'
import { consolidarHistorico, type LinhaHistorico, type MomentoHistorico } from '@/lib/historico/historico-puro'
import { ROTULOS_HISTORICO, type EntidadeHistorico } from '@/lib/historico/rotulos'

// Fase 9: quem mudou o quê nos cadastros da loja (produtos, fornecedores, clientes, grupos, famílias, locais), numa tela só.
// Só leitura do histórico da migration 220 (+450/460). Só desenvolvedor por enquanto.
const CADASTROS = ['produto', 'fornecedor', 'cliente', 'grupo', 'familia', 'local'] as const
type Cadastro = (typeof CADASTROS)[number]
const NOME: Record<Cadastro, string> = { produto: 'Produto', fornecedor: 'Fornecedor', cliente: 'Cliente/transportadora', grupo: 'Grupo', familia: 'Família', local: 'Local de estoque' }
const LIMITE = 3000
const DIAS: Record<string, number> = { '7': 7, '30': 30, '90': 90 }

function menosDias(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00-03:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

/** Nome e link de cada registro alterado (uma consulta por tipo de cadastro). */
async function nomes(lojaId: number, porTipo: Map<Cadastro, string[]>): Promise<Map<string, { nome: string; href: string | null }>> {
  const sb = createServiceClient()
  const out = new Map<string, { nome: string; href: string | null }>()
  const ids = (t: Cadastro) => (porTipo.get(t) ?? []).filter((x) => /^\d+$/.test(x)).slice(0, 500)
  await Promise.all([
    ids('produto').length ? sb.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId).in('codigo_produto', ids('produto'))
      .then(({ data }) => { for (const p of data ?? []) out.set(`produto:${p.codigo_produto}`, { nome: `${p.descricao ?? ''}${p.codigo ? ` (${p.codigo})` : ''}`, href: p.codigo ? `/produto/${encodeURIComponent(p.codigo as string)}` : null }) }) : null,
    ids('fornecedor').length ? sb.from('fornecedores').select('id, razao_social').eq('loja_id', lojaId).in('id', ids('fornecedor'))
      .then(({ data }) => { for (const f of data ?? []) out.set(`fornecedor:${f.id}`, { nome: f.razao_social as string, href: `/fornecedor/${f.id}` }) }) : null,
    ids('cliente').length ? sb.from('clientes').select('id, razao_social').eq('loja_id', lojaId).in('id', ids('cliente'))
      .then(({ data }) => { for (const c of data ?? []) out.set(`cliente:${c.id}`, { nome: c.razao_social as string, href: `/cliente/${c.id}` }) }) : null,
    ids('grupo').length ? sb.from('grupos_produto').select('id, nome').eq('loja_id', lojaId).in('id', ids('grupo'))
      .then(({ data }) => { for (const g of data ?? []) out.set(`grupo:${g.id}`, { nome: g.nome as string, href: '/grupo-produto' }) }) : null,
    ids('familia').length ? sb.from('familias').select('id, nome').eq('loja_id', lojaId).in('id', ids('familia'))
      .then(({ data }) => { for (const f of data ?? []) out.set(`familia:${f.id}`, { nome: f.nome as string, href: '/familia' }) }) : null,
    ids('local').length ? sb.from('local_estoques').select('id, descricao').eq('loja_id', lojaId).in('id', ids('local'))
      .then(({ data }) => { for (const l of data ?? []) out.set(`local:${l.id}`, { nome: l.descricao as string, href: '/local-estoque' }) }) : null,
  ])
  return out
}

export default async function HistoricoCadastroPage({ searchParams }: { searchParams: Promise<{ tipo?: string; dias?: string; sistema?: string }> }) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()
  const sp = await searchParams
  const tipo = (CADASTROS as readonly string[]).includes(sp.tipo ?? '') ? (sp.tipo as Cadastro) : null
  const dias = DIAS[sp.dias ?? ''] ?? 7
  const comSistema = sp.sistema === '1'

  let q = createServiceClient().from('historico_alteracoes')
    .select('id, entidade, entidade_id, tabela, linha, operacao, campo, valor_de, valor_para, autor_nome, origem, txid, created_at')
    .eq('loja_id', lojaId).in('entidade', tipo ? [tipo] : [...CADASTROS]).gte('created_at', menosDias(hojeBahiaISO(), dias))
    .order('id', { ascending: false }).limit(LIMITE)
  if (!comSistema) q = q.eq('origem', 'app')
  const { data, error } = await q
  const linhas = (data ?? []) as (LinhaHistorico & { entidade: Cadastro; entidade_id: string })[]

  // agrupa por registro e consolida cada um (mesma regra da ficha de cada cadastro)
  const porRegistro = new Map<string, typeof linhas>()
  const porTipo = new Map<Cadastro, string[]>()
  for (const l of linhas) {
    const k = `${l.entidade}:${l.entidade_id}`
    if (!porRegistro.has(k)) { porRegistro.set(k, []); porTipo.set(l.entidade, [...(porTipo.get(l.entidade) ?? []), l.entidade_id]) }
    porRegistro.get(k)!.push({ ...l, id: Number(l.id), txid: Number(l.txid) })
  }
  const nomeDe = await nomes(lojaId, porTipo)
  type Bloco = { chave: string; entidade: Cadastro; nome: string; href: string | null; momento: MomentoHistorico }
  const blocos: Bloco[] = []
  for (const [k, ls] of porRegistro) {
    const ent = ls[0].entidade
    // registro apagado: o nome que ficou guardado no próprio histórico (razão social, descrição ou nome)
    const guardado = ls.find((l) => ['razao_social', 'descricao', 'nome'].includes(l.campo ?? '') && (l.valor_de || l.valor_para))
    const info = nomeDe.get(k) ?? { nome: `${guardado?.valor_de || guardado?.valor_para || `${NOME[ent]} ${ls[0].entidade_id}`} (apagado)`, href: null }
    for (const m of consolidarHistorico(ls, ROTULOS_HISTORICO[ent as EntidadeHistorico], (linha) => `Item ${linha}`)) {
      blocos.push({ chave: `${k}:${m.quando}`, entidade: ent, nome: info.nome, href: info.href, momento: m })
    }
  }
  blocos.sort((a, b) => b.momento.quando.localeCompare(a.momento.quando))
  const autores = new Set(blocos.map((b) => b.momento.autor))

  return (
    <div className="space-y-4">
      <PageHeader title="Histórico de cadastros" icon={History} description="Quem mudou o quê nos cadastros da loja, campo a campo" />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentLinks basePath="/historico-cadastro" param="tipo" aria-label="Cadastro"
          opcoes={[{ value: '', label: 'Todos' }, ...CADASTROS.map((c) => ({ value: c, label: NOME[c] }))]} />
        <SegmentLinks basePath="/historico-cadastro" param="dias" aria-label="Período"
          opcoes={[{ value: '', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }]} />
        <SegmentLinks basePath="/historico-cadastro" param="sistema" aria-label="Origem"
          opcoes={[{ value: '', label: 'Só pessoas' }, { value: '1', label: 'Com o sistema' }]} />
      </div>
      <p className="text-[13px] text-text-muted">
        <span className="num">{blocos.length}</span> alteração(ões) · <span className="num">{porRegistro.size}</span> cadastro(s) · <span className="num">{autores.size}</span> pessoa(s)
        {linhas.length === LIMITE && ' · mostrando só as mais recentes'}
      </p>
      {error ? (
        <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-text">Não foi possível ler o histórico agora: {error.message}. Isto é diferente de &ldquo;nenhuma alteração&rdquo;.</p>
      ) : blocos.length === 0 ? (
        <EmptyState icon={History} title="Nenhuma alteração no período" hint="Mudanças feitas pela tela aparecem aqui com quem fez e o que mudou." />
      ) : (
        <ol className="space-y-3">
          {blocos.slice(0, 400).map((b) => (
            <li key={b.chave} className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
              <div className="mb-2 flex flex-wrap items-baseline gap-2 text-[14px]">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-text-muted">{NOME[b.entidade]}</span>
                {b.href ? <Link href={b.href} className="font-medium text-text hover:underline">{b.nome}</Link> : <span className="font-medium text-text">{b.nome}</span>}
              </div>
              <ListaMomentos momentos={[b.momento]} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
