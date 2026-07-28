import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
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

// PostgREST corta em 1000 linhas por padrao, sem erro. `produtos` (ate 2869
// linhas/loja) e `posicao_estoques` (ate 4545 linhas/loja na foto mais recente)
// passam disso em praticamente todas as lojas -- sem paginar, a margem "ao vivo"
// perdia CMC de boa parte do catalogo e sumia com a maioria dos produtos
// silenciosamente (achado real: loja com 819 produtos validos mostrava so 324).
// Mesma classe de bug ja achada e corrigida no Faturamento/Estoque Valorizado.
// `contar`: quando informado (count exato da mesma tabela/filtros, sem
// trazer linha nenhuma), busca todas as paginas em paralelo em vez de uma de
// cada vez -- app roda no Contabo (Franca), banco no Brasil, cada ida paga
// ~230-460ms de latencia de rede pura. Sem `contar`, mantem o comportamento
// sequencial original (rede de seguranca pros call sites que ainda nao
// passam essa contagem).
async function buscarTodasLinhas<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  contar?: () => PromiseLike<{ count: number | null }>,
): Promise<T[]> {
  const PAGE = 1000
  if (contar) {
    const { count } = await contar()
    const numPaginas = Math.ceil((count ?? 0) / PAGE)
    const blocos = await Promise.all(
      Array.from({ length: numPaginas }, (_, p) => montar(p * PAGE, p * PAGE + PAGE - 1))
    )
    return blocos.flatMap((r) => r.data ?? [])
  }
  const todas: T[] = []
  for (let p = 0; ; p++) {
    const { data } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (!data?.length) break
    todas.push(...data)
    if (data.length < PAGE) break
  }
  return todas
}

type Row = { codigo: string; descricao: string | null; familia: string | null; mes: string; pdv: number | null; cmc: number | null; margem: number | null }

// CMC podre faz a margem explodir (ex.: Casquinha de siri CMC R$100bi). Margem
// abaixo de -100% = custo > 2x preço = claramente inválido (revisar no Omie).
const margemValida = (m: number | null): m is number => m != null && m > -100
const corMargem = (m: number) => (m >= 60 ? 'text-ok' : m >= 40 ? 'text-text' : m >= 0 ? 'text-warn' : 'text-err')

export default async function RelatorioMargemPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; familia?: string; tipo?: string; local?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()

  const sp = await searchParams
  const busca = (sp.busca ?? '').trim().toLowerCase()
  const familiasArr = valoresMulti(sp.familia)
  const tiposArr = valoresMulti(sp.tipo)

  const supabase = createServiceClient()
  const [rowsAll, { data: metaRow }, produtosRaw, { data: locaisRaw }] = await Promise.all([
    buscarTodasLinhas<Row>(
      (from, to) =>
        supabase
          .from('margem_importada')
          .select('codigo, descricao, familia, mes, pdv, cmc, margem')
          .eq('loja_id', lojaId)
          .order('codigo', { ascending: true })
          .order('mes', { ascending: true })
          .range(from, to),
      () => supabase.from('margem_importada').select('codigo', { count: 'exact', head: true }).eq('loja_id', lojaId)
    ),
    supabase.from('margem_import_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    // margem_importada não tem "tipo" (só vem no export do Omie): cruza por código
    // com produtos pra poder filtrar por tipo de item (e por local, via posicao_estoques).
    buscarTodasLinhas<{ codigo: string | null; tipo_item: string | null; codigo_produto: number | null }>(
      (from, to) =>
        supabase
          .from('produtos')
          .select('codigo, tipo_item, codigo_produto')
          .eq('loja_id', lojaId)
          .order('id', { ascending: true })
          .range(from, to),
      () => supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId)
    ),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  let rows = rowsAll
  let calculadaAoVivo = false

  // Achado real (usuário 2026-07-22): loja 3 é a única que recebe upload manual
  // do FAT_DRV, e ficou travada em jun/2026 (mes mais recente da importação)
  // porque ninguém subiu o arquivo de julho -- a tela mostrava margem de mês
  // passado sem avisar que estava desatualizada. Antes só caía pro cálculo ao
  // vivo quando não havia NENHUM dado importado (`!rows.length`); agora também
  // cai quando o dado importado mais recente é de um mês anterior ao atual --
  // o cálculo ao vivo já é usado (e validado) pelas outras 4 lojas, então isso
  // elimina a dependência de alguém lembrar de reimportar todo mês.
  const mesAtualParaChecagem = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
  const mesImportadoMaisRecente = rows.reduce<string | null>((max, r) => (!max || r.mes > max ? r.mes : max), null)
  const importacaoDesatualizada = mesImportadoMaisRecente !== null && mesImportadoMaisRecente < mesAtualParaChecagem
  if (importacaoDesatualizada) rows = []

  // Sem import manual (todas as lojas exceto a que faz upload do FAT_DRV) OU
  // import desatualizado (ver acima): calcula a margem ao vivo com a MESMA
  // fórmula da RPC relatorio_estoque_valorizado (migration 063), validada
  // contra o Excel do Ramon (diff 0,00-0,37 p.p.).
  if (!rows.length) {
    const mesAtualISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
    // produtosCalc e fotoRow sao independentes entre si -- roda em paralelo em
    // vez de serie (este e o caminho padrao pra 5 das 6 lojas ativas, sem
    // import manual de margem).
    const [produtosCalc, { data: fotoRow }] = await Promise.all([
      buscarTodasLinhas<{
        codigo: string | null
        codigo_produto: number
        descricao: string | null
        descricao_familia: string | null
        valor_unitario: number | null
      }>(
        (from, to) =>
          supabase
            .from('produtos')
            .select('codigo, codigo_produto, descricao, descricao_familia, tipo_item, valor_unitario')
            .eq('loja_id', lojaId)
            .in('tipo_item', ['04', '00'])
            .order('id', { ascending: true })
            .range(from, to),
        () =>
          supabase
            .from('produtos')
            .select('codigo_produto', { count: 'exact', head: true })
            .eq('loja_id', lojaId)
            .in('tipo_item', ['04', '00'])
      ),
      supabase
        .from('posicao_estoques')
        .select('data_posicao')
        .eq('loja_id', lojaId)
        .order('data_posicao', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (fotoRow?.data_posicao && produtosCalc.length) {
      // Pondera por local (soma de custo x saldo, dividido pelo saldo total) em vez
      // de pegar o MAIOR n_cmc entre locais -- mesmo bug já achado e corrigido em
      // relatorio_estoque_valorizado (migration 082, 2026-07-19): quando o mesmo
      // produto tem CMC divergente entre locais, o maior valor sozinho superestima
      // o custo e derruba a margem calculada artificialmente.
      // n_saldo>0 tambem: achado real ao validar -- Omie grava linhas de
      // posicao_estoques com saldo NEGATIVO em locais "fantasma" (ex: ajuste em
      // transito) que, sem esse filtro, zeram o saldo total do produto (3 num
      // local real + -3 num local fantasma = 0) e derrubam o produto inteiro do
      // relatorio (loja 2: caiu de 715 pra 196 sem o filtro). So locais com
      // estoque realmente positivo devem entrar na ponderacao.
      const posRows = await buscarTodasLinhas<{ n_cod_prod: number; n_cmc: number; n_saldo: number }>(
        (from, to) =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod, n_cmc, n_saldo')
            .eq('loja_id', lojaId)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_cmc', 0)
            .gt('n_saldo', 0)
            .order('id', { ascending: true })
            .range(from, to),
        () =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod', { count: 'exact', head: true })
            .eq('loja_id', lojaId)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_cmc', 0)
            .gt('n_saldo', 0)
      )
      const acumPorCod = new Map<number, { valor: number; saldo: number }>()
      for (const p of posRows) {
        const cod = Number(p.n_cod_prod)
        const saldo = Number(p.n_saldo) || 0
        const ent = acumPorCod.get(cod) ?? { valor: 0, saldo: 0 }
        ent.valor += Number(p.n_cmc) * saldo
        ent.saldo += saldo
        acumPorCod.set(cod, ent)
      }
      const cmcPorCod = new Map<number, number>()
      for (const [cod, e] of acumPorCod) {
        if (e.saldo > 0) cmcPorCod.set(cod, e.valor / e.saldo)
      }
      // Achado real (usuário 2026-07-19): o .filter() anterior escondia da tela
      // QUALQUER produto sem CMC ou sem preço de venda cadastrado (muitos
      // produtos tem "venda R$ 0,00" no Omie) -- silenciosamente sumiam da
      // lista, sem contar nem como "CMC inválido". Removido: agora todo
      // produto do tipo certo aparece, e o que não tem cmc/pdv/margem válidos
      // cai na seção "CMC inválido" já existente (mesma lógica do import
      // manual), em vez de desaparecer sem aviso.
      rows = produtosCalc.map((p) => {
        const cmc = cmcPorCod.get(Number(p.codigo_produto)) ?? null
        const pdv = Number(p.valor_unitario) || null
        const margem = pdv && cmc && pdv > 0 && cmc > 0 ? Number((((pdv - cmc) / pdv) * 100).toFixed(1)) : null
        return { codigo: p.codigo ?? String(p.codigo_produto), descricao: p.descricao, familia: p.descricao_familia, mes: mesAtualISO, pdv, cmc, margem }
      })
      calculadaAoVivo = true
    }
  }
  const tipoPorCodigo = new Map<string, string | null>()
  for (const p of produtosRaw) {
    if (p.codigo) tipoPorCodigo.set(p.codigo, p.tipo_item)
  }

  // Local de estoque: margem_importada nao tem local (o export do Omie e por
  // produto/mes, loja inteira) — proxy: restringe aos produtos que tem posicao
  // de estoque no local escolhido (mesmo padrao de relatorio-movimentacao).
  const localSel = valoresMulti(sp.local).map(Number).filter((n) => !Number.isNaN(n))
  let codigosNoLocal: Set<string> | null = null
  if (localSel.length) {
    const pos = await buscarTodasLinhas<{ n_cod_prod: number }>((from, to) =>
      supabase
        .from('posicao_estoques')
        .select('n_cod_prod')
        .eq('loja_id', lojaId)
        .in('codigo_local_estoque', localSel)
        .order('id', { ascending: true })
        .range(from, to)
    )
    const codProds = new Set(pos.map((p) => Number(p.n_cod_prod)))
    codigosNoLocal = new Set(
      produtosRaw
        .filter((p) => p.codigo_produto != null && codProds.has(Number(p.codigo_produto)))
        .map((p) => p.codigo as string)
        .filter(Boolean)
    )
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  if (!rows.length) {
    return (
      <div className="space-y-4">
        <ListaHeader>
          <PageHeader title="Margem" icon={Percent} description="Margem por produto (preço de venda × custo) — BETA" actions={<ImportarMargem />} voltarHref="/relatorios" />
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
    if (codigosNoLocal !== null && !codigosNoLocal.has(p.codigo)) return false
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
    {
      tipo: 'multi-select',
      nome: 'local',
      label: 'Local de estoque (produtos com estoque no local)',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]

  // O botão "Baixar" prometia exportar "com filtros" mas o link era sempre
  // /relatorio-margem/export sem query string (e a rota nem lia searchParams) —
  // a exportação sempre trazia tudo, sem refletir o filtro ativo na tela.
  const exportParams = new URLSearchParams()
  if (sp.busca) exportParams.set('busca', sp.busca)
  if (sp.familia) exportParams.set('familia', sp.familia)
  if (sp.tipo) exportParams.set('tipo', sp.tipo)
  if (sp.local) exportParams.set('local', sp.local)
  const exportHref = exportParams.toString() ? `/relatorio-margem/export?${exportParams.toString()}` : '/relatorio-margem/export'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Margem"
          icon={Percent}
          description="Margem por produto (preço de venda × custo) — BETA"
          voltarHref="/relatorios"
          actions={
            <>
              <FiltrosGaveta
                basePath="/relatorio-margem"
                campos={campos}
                defaults={{ busca: sp.busca ?? '', familia: sp.familia ?? '', tipo: sp.tipo ?? '', local: sp.local ?? '' }}
                persistirEm="/relatorio-margem"
              />
              <a href={exportHref} target="_blank" rel="noopener noreferrer" className={btnClass('outline')} title="Excel: margem por produto (com filtros)">
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
        {!calculadaAoVivo && metaRow?.importado_em && (
          <span className="text-[13px] text-text-muted">Importado em {fmtQuando(metaRow.importado_em as string)}</span>
        )}
        {calculadaAoVivo && mesImportadoMaisRecente && (
          <span className="text-[13px] text-warn">
            Import manual desatualizado (último mês: {mesImportadoMaisRecente}) — mostrando cálculo ao vivo
          </span>
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
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={p.descricao ?? ''}>
                    <Link href={`/movimentacoes?produto=${encodeURIComponent(p.descricao ?? String(p.codigo))}`} className="hover:underline">
                      {p.descricao ?? p.codigo}
                    </Link>
                  </td>
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
        {calculadaAoVivo
          ? 'Margem calculada automaticamente (preço de venda × custo médio da última posição de estoque) para produtos acabados e de revenda — sem import manual.'
          : 'Margem mais recente por produto, importada da aba MARGEM do FAT_DRV (produto acabado / venda PDV). A % é a que o Omie calcula.'}
      </p>
    </div>
  )
}
