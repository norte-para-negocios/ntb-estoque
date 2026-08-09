import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
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
// `buscarTodasLinhas` (Task 13, auditoria 2026-08-09): era uma copia local
// hand-rolled, igual as de export/route.ts e do cron -- nenhuma checava
// `error`, tratando falha de query no meio da paginacao exatamente igual a
// "acabaram as paginas" (mesma classe de bug da migration 097, ja corrigida
// em outros relatorios nesta auditoria). Trocado pelo helper compartilhado
// `lib/supabase/buscar-todas-linhas.ts`, que loga o erro real e aceita
// `onErro` pra sinalizar na tela (ver `errosConsulta`/banner abaixo).

// `semEstoque` (Fix round 1, Task 13): so preenchido no calculo ao vivo --
// distingue "produto sem estoque na foto de hoje" (n_saldo<=0 em todos os
// locais, motivo BENIGNO e hoje maioria disparada dos casos invalidos, ver
// comentario mais abaixo) de "CMC realmente ausente/podre no Omie" (motivo
// que precisa de acao). Sem essa distincao o rotulo "CMC invalido" mentia
// pra ~700 produtos/loja que so estao sem posicao de estoque hoje.
type Row = { codigo: string; descricao: string | null; familia: string | null; mes: string; pdv: number | null; cmc: number | null; margem: number | null; semEstoque?: boolean }

// CMC podre faz a margem explodir (ex.: Casquinha de siri CMC R$100bi). Margem
// abaixo de -100% = custo > 2x preço = claramente inválido (revisar no Omie).
const margemValida = (m: number | null): m is number => m != null && m > -100
const corMargem = (m: number) => (m >= 60 ? 'text-ok' : m >= 40 ? 'text-text' : m >= 0 ? 'text-warn' : 'text-err')

const MESES_ABREV_EVOLUCAO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabelEvolucao = (ym: string) => {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV_EVOLUCAO[Number(m) - 1] ?? m}/${a.slice(2)}`
}
// `data_snapshot` (coluna `date`, sem hora) vem do PostgREST como 'YYYY-MM-DD'.
// Passar por `new Date(iso)` e formatar com timeZone America/Bahia (UTC-3)
// quebraria o dia (meia-noite UTC de uma data vira o dia ANTERIOR lá) --
// formata direto da string, sem passar por Date.
const fmtDataSimples = (iso: string) => {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

type LinhaEvolucao = { codigo: string; descricao: string | null; meses: Record<string, number> }

// Matriz produto x mês (mesmo espírito de relatorio-faturamento/page.tsx:
// linhas + lista de meses distintos), restrita aos produtos que sobreviveram
// aos filtros ativos na tela (mesmos códigos de `produtos`, pra ficar
// consistente com o que já está na tabela principal) e só com margem válida
// (mesmo critério de `validos` -- CMC podre não deveria aparecer também aqui).
function construirEvolucaoMensal(rowsFonte: Row[], codigosValidos: Set<string>): { linhas: LinhaEvolucao[]; meses: string[] } {
  const validas = rowsFonte.filter((r) => codigosValidos.has(r.codigo) && margemValida(r.margem))
  const porCodigo = new Map<string, LinhaEvolucao>()
  for (const r of validas) {
    const ent = porCodigo.get(r.codigo) ?? { codigo: r.codigo, descricao: r.descricao, meses: {} }
    ent.meses[r.mes] = Number(r.margem)
    porCodigo.set(r.codigo, ent)
  }
  const meses = [...new Set(validas.map((r) => r.mes))].sort()
  const linhas = [...porCodigo.values()].sort((a, b) => (a.descricao ?? a.codigo).localeCompare(b.descricao ?? b.codigo, 'pt-BR'))
  return { linhas, meses }
}

// Markup reaproveitado de relatorio-faturamento/page.tsx (matriz mês a mês,
// sticky header/coluna) -- mesmo espírito visual, trocando o "Total" (soma,
// que faz sentido pra R$) por "Média" (a soma de % não significa nada).
// `diasPorMes` (Fix round 1, Task 13): só usado na evolução via snapshot
// diário -- mostra quantos dias entraram na média daquele mês, pra não
// esconder que um mês com poucos dias (buraco no cron, sem retry hoje --
// ver migration 106) é bem menos confiável que um mês completo.
function TabelaEvolucaoMensal({ linhas, meses, th, diasPorMes }: { linhas: LinhaEvolucao[]; meses: string[]; th: string; diasPorMes?: Record<string, number> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2">
            <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Produto</th>
            {meses.map((m) => (
              <th key={m} className={`text-right ${th}`} title={diasPorMes?.[m] != null ? `Média de ${diasPorMes[m]} dia(s) com snapshot` : undefined}>
                {mesLabelEvolucao(m)}
                {diasPorMes?.[m] != null && <span className="ml-1 font-normal normal-case text-text-muted">({diasPorMes[m]}d)</span>}
              </th>
            ))}
            <th className={`text-right ${th}`}>Média</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const valores = meses.map((m) => l.meses[m]).filter((v): v is number => v != null)
            const media = valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null
            return (
              <tr key={l.codigo} className="border-t border-border/60 hover:bg-surface-2/40">
                <td className="sticky left-0 z-10 max-w-[240px] truncate bg-surface px-3 py-2 text-text" title={l.descricao ?? l.codigo}>
                  {l.descricao ?? l.codigo}
                </td>
                {meses.map((m) => {
                  const v = l.meses[m] ?? null
                  return (
                    <td key={m} className={`num whitespace-nowrap px-3 py-2 text-right ${v != null ? corMargem(v) : 'text-text-muted'}`}>
                      {fmtPct(v)}
                    </td>
                  )
                })}
                <td className={`num whitespace-nowrap px-3 py-2 text-right font-semibold ${media != null ? corMargem(media) : 'text-text-muted'}`}>
                  {fmtPct(media)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

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

  // Task 13 (auditoria 2026-08-09): acumula falhas reais de query pra avisar
  // na tela em vez de deixar `buscarTodasLinhas` engolir o erro e devolver
  // resultado parcial como se fosse completo (mesmo padrão já aplicado em
  // relatorio-compras/page.tsx e relatorio-estoque-valorizado/page.tsx).
  const errosConsulta: string[] = []
  function logErro(rotulo: string) {
    return (error: { message: string }) => {
      errosConsulta.push(rotulo)
      console.error(`relatorio-margem: consulta "${rotulo}" falhou -- dado pode estar incompleto`, error.message)
    }
  }

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
      () => supabase.from('margem_importada').select('codigo', { count: 'exact', head: true }).eq('loja_id', lojaId),
      logErro('margem importada')
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
      () => supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId),
      logErro('produtos (tipo/local)')
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
    // vez de serie (este e o caminho padrao pras 6 lojas ativas hoje -- loja 3,
    // unica com import manual do FAT_DRV, tambem cai aqui porque o import
    // parou em jun/2026 e o bloco acima ja zerou `rows` por estar desatualizado).
    const [produtosCalc, { data: fotoRow, error: erroFotoRow }] = await Promise.all([
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
            .in('tipo_item', ['04', '00']),
        logErro('produtos (cálculo ao vivo)')
      ),
      supabase
        .from('posicao_estoques')
        .select('data_posicao')
        .eq('loja_id', lojaId)
        .order('data_posicao', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    // Sem isto, um erro aqui (timeout, conexão) fazia `fotoRow` ficar `undefined`
    // igualzinho a "loja sem nenhuma posição de estoque ainda" -- a tela cairia
    // no EmptyState "Sem margem importada" escondendo que na verdade a query
    // falhou (achado real desta auditoria: esta é a ÚNICA fonte de dado pras 6
    // lojas ativas hoje, ver comentário acima).
    if (erroFotoRow) logErro('posição de estoque (data mais recente)')(erroFotoRow)
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
      // Fix round 1 (revisão da Task 13, 2026-08-09): o filtro `n_cmc > 0` saiu
      // da query -- fica só `n_saldo > 0`, e o `n_cmc > 0` passa a ser checado
      // em JS ao acumular. Motivo: sem isso não dá pra distinguir DEPOIS "produto
      // sem estoque na foto de hoje" (não tem NENHUMA linha com saldo positivo --
      // motivo benigno, é a maioria disparada dos casos, ver `temEstoque` abaixo)
      // de "tem estoque mas o CMC não veio do Omie" (motivo real de alerta). Com
      // os dois filtros na query como antes, as duas causas ficavam
      // indistinguíveis (mesmo resultado: `cmcPorCod` sem entrada) e o rótulo
      // "CMC inválido" mentia em massa (achado real do revisor: ~85% das linhas
      // que tinham margem colapsaram pra "inválido" quando o fix do saldo
      // ponderado foi aplicado, loja 3: 774→116, loja 4: 819→104, loja 5:
      // 851→107, loja 6: 671→76 -- a maioria é só estoque zerado hoje, não CMC
      // podre).
      const posRows = await buscarTodasLinhas<{ n_cod_prod: number; n_cmc: number; n_saldo: number }>(
        (from, to) =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod, n_cmc, n_saldo')
            .eq('loja_id', lojaId)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_saldo', 0)
            .order('id', { ascending: true })
            .range(from, to),
        () =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod', { count: 'exact', head: true })
            .eq('loja_id', lojaId)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_saldo', 0),
        logErro('posição de estoque (CMC/saldo)')
      )
      const acumPorCod = new Map<number, { valor: number; saldo: number }>()
      const temEstoque = new Set<number>()
      for (const p of posRows) {
        const cod = Number(p.n_cod_prod)
        temEstoque.add(cod)
        const cmcLinha = Number(p.n_cmc)
        if (!(cmcLinha > 0)) continue
        const saldo = Number(p.n_saldo) || 0
        const ent = acumPorCod.get(cod) ?? { valor: 0, saldo: 0 }
        ent.valor += cmcLinha * saldo
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
      // cai na seção "CMC inválido"/"Sem estoque na foto" (ver `semEstoque`
      // abaixo), em vez de desaparecer sem aviso.
      rows = produtosCalc.map((p) => {
        const cod = Number(p.codigo_produto)
        const cmc = cmcPorCod.get(cod) ?? null
        const pdv = Number(p.valor_unitario) || null
        const margem = pdv && cmc && pdv > 0 && cmc > 0 ? Number((((pdv - cmc) / pdv) * 100).toFixed(1)) : null
        return {
          codigo: p.codigo ?? String(cod),
          descricao: p.descricao,
          familia: p.descricao_familia,
          mes: mesAtualISO,
          pdv,
          cmc,
          margem,
          semEstoque: cmc == null && !temEstoque.has(cod),
        }
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
    const pos = await buscarTodasLinhas<{ n_cod_prod: number }>(
      (from, to) =>
        supabase
          .from('posicao_estoques')
          .select('n_cod_prod')
          .eq('loja_id', lojaId)
          .in('codigo_local_estoque', localSel)
          .order('id', { ascending: true })
          .range(from, to),
      undefined,
      logErro('posição de estoque (filtro de local)')
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
        {errosConsulta.length > 0 && (
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
            Falha ao consultar dados de estoque/produto — a tela abaixo pode estar
            vazia por causa disso, não por falta real de margem importada. Recarregue a página; se persistir, avise o suporte.
          </p>
        )}
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
  // Fix round 1 (Task 13): separa os dois motivos de "sem margem válida" --
  // "sem estoque na foto de hoje" (n_saldo<=0 em todos os locais, benigno,
  // hoje é a maioria disparada) de "CMC de verdade ausente/podre no Omie"
  // (precisa de ação no Omie). So existe pra `calculadaAoVivo` -- import
  // manual (margem_importada) nao tem esse conceito, `semEstoque` fica
  // undefined e cai tudo em `cmcInvalidos`.
  const semEstoque = invalidos.filter((p) => p.semEstoque)
  const cmcInvalidos = invalidos.filter((p) => !p.semEstoque)
  const margemMedia = validos.length ? validos.reduce((s, p) => s + Number(p.margem), 0) / validos.length : 0
  const menor = validos[0]

  // Evolução mensal (Task 5): segunda seção informativa, sem interferir na
  // tabela principal acima (que continua "mais recente por produto"). Restrita
  // aos mesmos códigos que sobreviveram aos filtros ativos na tela (busca/
  // família/tipo/local), pra ficar consistente com o que já está na tela.
  const codigosFiltrados = new Set(produtos.map((p) => p.codigo))
  // Usa `rowsAll` (import cru), NAO `rows` -- achado real 2026-08-01: `rows` é
  // esvaziado logo acima quando o import está desatualizado (linha ~195), o que
  // é certo pra tabela principal (mostrar margem ATUAL de um import parado
  // engana) mas errado aqui: mês histórico não fica errado só porque ninguém
  // subiu o arquivo do mês corrente. Sem isso, a loja 3 -- única com import
  // manual, e com 6 meses reais (jan-jun/2026) na base -- nunca via a evolução,
  // caindo no aviso de "acumulando" apesar do dado existir.
  const evolucaoImportada = rowsAll.length ? construirEvolucaoMensal(rowsAll, codigosFiltrados) : null

  // Cálculo ao vivo: a série real mora em `margem_snapshot_diario` (migration
  // 101/Task 4), arquivada 1x/dia desde 2026-08-01 -- ainda não sustenta uma
  // matriz mensal de verdade pra ninguém no dia em que o snapshot começou.
  let evolucaoSnapshot: { linhas: LinhaEvolucao[]; meses: string[] } | null = null
  let primeiroSnapshotEm: string | null = null
  // `diasPorMes` (Fix round 1, Task 13/migration 106): quantos dias distintos
  // entraram na média de cada mês -- o cron passou a PULAR (não gravar) o dia
  // de uma loja quando uma consulta falha, sem retry, então um mês pode ter
  // menos dias que o esperado sem nenhum aviso na tela. `dias` vem igual pra
  // todo produto do mesmo mês (é uma propriedade da série, não do produto) --
  // guarda só 1 valor por mês.
  let diasPorMes: Record<string, number> = {}
  const temEvolucaoImportada = !!evolucaoImportada && evolucaoImportada.meses.length > 1
  if (!temEvolucaoImportada) {
    const [snapshotRows, { data: primeiroRow, error: erroPrimeiroRow }] = await Promise.all([
      rpcTodos<Row & { dias: number }>(supabase, 'relatorio_margem_snapshot_matriz', { p_loja_id: lojaId }, logErro('evolução mensal (snapshot)')),
      supabase
        .from('margem_snapshot_diario')
        .select('data_snapshot')
        .eq('loja_id', lojaId)
        .order('data_snapshot', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])
    if (erroPrimeiroRow) logErro('evolução mensal (primeiro snapshot)')(erroPrimeiroRow)
    evolucaoSnapshot = construirEvolucaoMensal(snapshotRows, codigosFiltrados)
    primeiroSnapshotEm = (primeiroRow?.data_snapshot as string | undefined) ?? null
    for (const r of snapshotRows) {
      if (diasPorMes[r.mes] == null) diasPorMes[r.mes] = r.dias
    }
  }

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
        {cmcInvalidos.length > 0 && (
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            CMC inválido <span className="num font-semibold text-err">{cmcInvalidos.length}</span>
          </span>
        )}
        {semEstoque.length > 0 && (
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            Sem estoque na foto <span className="num font-semibold text-text-muted">{semEstoque.length}</span>
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

      {errosConsulta.length > 0 && (
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-text-muted">
          Falha ao consultar dados de estoque/produto — os números acima podem estar
          incompletos. Recarregue a página; se persistir, avise o suporte.
        </p>
      )}

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

      {cmcInvalidos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text">
            <AlertTriangle className="size-4 text-err" /> {cmcInvalidos.length} produto(s) com CMC inválido no Omie
          </p>
          <p className="mt-0.5 text-[13px] text-text-muted">
            Esses produtos têm estoque na foto de hoje, mas o custo médio (CMC) não veio ou está absurdo no Omie (ex.: bilhões), então a margem não fecha. Corrigir o CMC no Omie:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cmcInvalidos.map((p) => (
              <span key={p.codigo} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text" title={`CMC ${fmtMoeda(p.cmc)}`}>
                {p.descricao ?? p.codigo}
              </span>
            ))}
          </div>
        </div>
      )}

      {semEstoque.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3.5">
          <p className="text-[13px] text-text-muted">
            <span className="font-medium text-text">{semEstoque.length} produto(s) sem estoque na foto de hoje</span> — não têm
            saldo positivo em nenhum local agora, então não dá pra calcular um CMC ponderado (motivo normal: estoque zerado, não é
            problema de cadastro no Omie).
          </p>
        </div>
      )}

      <p className="px-1 text-[11px] text-text-muted">
        {calculadaAoVivo
          ? 'Margem calculada automaticamente (preço de venda × custo médio da última posição de estoque) para produtos acabados e de revenda — sem import manual.'
          : 'Margem mais recente por produto, importada da aba MARGEM do FAT_DRV (produto acabado / venda PDV). A % é a que o Omie calcula.'}
      </p>

      {temEvolucaoImportada && evolucaoImportada && (
        <div className="space-y-2">
          <h2 className="px-1 text-[13px] font-semibold text-text">Evolução mensal da margem</h2>
          <TabelaEvolucaoMensal linhas={evolucaoImportada.linhas} meses={evolucaoImportada.meses} th={th} />
          {calculadaAoVivo && (
            <p className="px-1 text-[11px] text-text-muted">
              Histórico do último import manual do FAT_DRV (a tabela acima usa o cálculo ao vivo, mais recente).
            </p>
          )}
        </div>
      )}

      {!temEvolucaoImportada && (
        <div className="space-y-2">
          <h2 className="px-1 text-[13px] font-semibold text-text">Evolução mensal da margem</h2>
          {evolucaoSnapshot && evolucaoSnapshot.meses.length > 1 ? (
            <TabelaEvolucaoMensal linhas={evolucaoSnapshot.linhas} meses={evolucaoSnapshot.meses} th={th} diasPorMes={diasPorMes} />
          ) : (
            <div className="rounded-lg border border-border bg-surface p-3.5">
              <p className="text-[13px] text-text-muted">
                Evolução mensal real ainda não disponível pra esta loja — o sistema passou a arquivar o custo diário a
                partir de <strong className="text-text">{primeiroSnapshotEm ? fmtDataSimples(primeiroSnapshotEm) : 'hoje'}</strong>.
                Volte em algumas semanas pra ver a tendência.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
