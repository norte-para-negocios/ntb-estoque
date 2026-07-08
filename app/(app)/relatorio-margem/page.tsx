import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { type CampoFiltro, valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ImportarMargem } from '@/components/margem/ImportarMargem'
import { btnClass } from '@/components/ui-kit/Button'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { Percent, AlertTriangle, Download } from 'lucide-react'

const fmtMoeda = (n: number | null) => (n == null ? '-' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtPct = (n: number | null) => (n == null ? '-' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const fmtQuando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

type Row = { codigo: string; descricao: string | null; familia: string | null; mes: string; pdv: number | null; cmc: number | null; margem: number | null }

// CMC podre faz a margem explodir (ex.: Casquinha de siri CMC R$100bi). Margem
// abaixo de -100% = custo > 2x preço = claramente inválido (revisar no Omie).
const margemValida = (m: number | null): m is number => m != null && m > -100
const corMargem = (m: number) => (m >= 60 ? 'text-ok' : m >= 40 ? 'text-text' : m >= 0 ? 'text-warn' : 'text-err')

export default async function RelatorioMargemPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; familia?: string; tipo?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const busca = (sp.busca ?? '').trim().toLowerCase()
  const familiasArr = valoresMulti(sp.familia)
  const tiposArr = valoresMulti(sp.tipo)

  const supabase = createServiceClient()
  const [{ data: rowsRaw }, { data: metaRow }, { data: produtosRaw }] = await Promise.all([
    supabase.from('margem_importada').select('codigo, descricao, familia, mes, pdv, cmc, margem').eq('loja_id', lojaId),
    supabase.from('margem_import_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    // margem_importada não tem "tipo" (só vem no export do Omie): cruza por código
    // com produtos pra poder filtrar por tipo de item.
    supabase.from('produtos').select('codigo, tipo_item').eq('loja_id', lojaId),
  ])
  const rows = (rowsRaw ?? []) as Row[]
  const tipoPorCodigo = new Map<string, string | null>()
  for (const p of (produtosRaw ?? []) as { codigo: string | null; tipo_item: string | null }[]) {
    if (p.codigo) tipoPorCodigo.set(p.codigo, p.tipo_item)
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  if (!rows.length) {
    return (
      <div className="space-y-4">
        <ListaHeader>
          <PageHeader title="Margem" icon={Percent} description="Margem por produto (preço de venda × custo) — BETA" actions={<ImportarMargem />} />
        </ListaHeader>
        <EmptyState
          icon={Percent}
          title="Sem margem importada"
          hint='A margem por produto vem da aba "MARGEM" do export FAT_DRV do Omie. Remova a aba "BD" (dados brutos) e clique em "Importar do Omie".'
        />
      </div>
    )
  }

  // Margem mais recente por produto (cada produto tem dado em meses diferentes).
  const porCod = new Map<string, Row>()
  for (const r of rows) {
    const cur = porCod.get(r.codigo)
    if (!cur || r.mes > cur.mes) porCod.set(r.codigo, r)
  }
  const todosProdutos = [...porCod.values()]

  // Opções de família: as que realmente aparecem na margem importada (garante que
  // o filtro sempre bate com o que tem na tabela, mesmo se divergir do cadastro).
  const familiaOpcoes = [...new Set(todosProdutos.map((p) => p.familia).filter((f): f is string => !!f))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((f) => ({ value: f, label: f }))

  const produtos = todosProdutos.filter((p) => {
    if (busca && !(p.descricao ?? '').toLowerCase().includes(busca) && !p.codigo.toLowerCase().includes(busca)) return false
    if (familiasArr.length && !familiasArr.includes(p.familia ?? '')) return false
    if (tiposArr.length && !tiposArr.includes(tipoPorCodigo.get(p.codigo) ?? '')) return false
    return true
  })
  const validos = produtos.filter((p) => margemValida(p.margem)).sort((a, b) => Number(a.margem) - Number(b.margem))
  const invalidos = produtos.filter((p) => !margemValida(p.margem))
  const margemMedia = validos.length ? validos.reduce((s, p) => s + Number(p.margem), 0) / validos.length : 0
  const menor = validos[0]

  const campos: CampoFiltro[] = [
    { tipo: 'texto', nome: 'busca', label: 'Produto (nome ou código)' },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiaOpcoes },
    { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Margem"
          icon={Percent}
          description="Margem por produto (preço de venda × custo) — BETA"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-margem"
                campos={campos}
                defaults={{ busca: sp.busca ?? '', familia: sp.familia ?? '', tipo: sp.tipo ?? '' }}
                persistirEm="/relatorio-margem"
              />
              <a href="/relatorio-margem/export" target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: margem por produto (com filtros)">
                <Download className="size-4" /> Baixar
              </a>
              <ImportarMargem />
            </>
          }
        />
        <ChipsFiltrosAtivos basePath="/relatorio-margem" campos={campos} persistirEm="/relatorio-margem" />
      </ListaHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Produtos <span className="num font-semibold text-text">{validos.length}</span>
        </span>
        <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
          Margem média <span className="num font-semibold text-text">{fmtPct(margemMedia)}</span>
        </span>
        {menor && (
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            Menor margem <span className={`num font-semibold ${corMargem(Number(menor.margem))}`}>{fmtPct(Number(menor.margem))}</span>
            <span className="text-text-muted"> · {menor.descricao}</span>
          </span>
        )}
        {invalidos.length > 0 && (
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            CMC inválido <span className="num font-semibold text-err">{invalidos.length}</span>
          </span>
        )}
        {metaRow?.importado_em && (
          <span className="text-[13px] text-text-muted">Importado em {fmtQuando(metaRow.importado_em as string)}</span>
        )}
      </div>

      {produtos.length === 0 ? (
        <EmptyState
          icon={Percent}
          title="Nenhum produto encontrado"
          hint="Ajuste ou limpe os filtros."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2">
                <th className={`text-left ${th}`}>Família</th>
                <th className={`text-left ${th}`}>Produto</th>
                <th className={`text-right ${th}`}>PDV (venda)</th>
                <th className={`text-right ${th}`}>CMC (custo)</th>
                <th className={`text-right ${th}`}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {validos.map((p) => (
                <tr key={p.codigo} className="border-t border-border/60 hover:bg-surface-2/40">
                  <td className="max-w-[160px] truncate px-3 py-2 text-text-muted" title={p.familia ?? ''}>{p.familia ?? '-'}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={p.descricao ?? ''}>{p.descricao ?? p.codigo}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtMoeda(p.pdv)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtMoeda(p.cmc)}</td>
                  <td className={`num whitespace-nowrap px-3 py-2 text-right font-semibold ${corMargem(Number(p.margem))}`}>{fmtPct(Number(p.margem))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invalidos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text">
            <AlertTriangle className="size-4 text-err" /> {invalidos.length} produto(s) com CMC inválido no Omie
          </p>
          <p className="mt-0.5 text-[13px] text-text-muted">
            O custo médio (CMC) desses produtos está absurdo no Omie (ex.: bilhões), então a margem não fecha. Corrigir o CMC no Omie:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {invalidos.map((p) => (
              <span key={p.codigo} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text" title={`CMC ${fmtMoeda(p.cmc)}`}>
                {p.descricao ?? p.codigo}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="px-1 text-[11px] text-text-muted">
        Margem mais recente por produto, importada da aba MARGEM do FAT_DRV (produto acabado / venda PDV). A % é a que o Omie calcula.
      </p>
    </div>
  )
}
