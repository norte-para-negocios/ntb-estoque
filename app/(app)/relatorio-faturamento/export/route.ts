import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha } from '@/lib/excel'
import { buscarFatAgregadoPorSituacao, buscarFatCupons, buscarFatCupomItens, buscarFatCupomPagamentosPeriodo } from '@/lib/faturamento-frio'

export const dynamic = 'force-dynamic'

type Linha = { rotulo: string; mes: string; valor: number }
const DIMS: { dim: string; label: string; nome: string }[] = [
  { dim: 'tipo', label: 'Tipo', nome: 'Por tipo' },
  { dim: 'familia', label: 'Família', nome: 'Por família' },
  { dim: 'forma_pgto', label: 'Forma de pgto', nome: 'Por forma de pgto' },
]

// Filtro de Situação (plano 2026-08-10-filtro-situacao-faturamento, Task 4):
// mesmos 3 valores que o <select> "Situação" da tela reconhece (page.tsx,
// OPCOES_SITUACAO/VALORES_SITUACAO_FORCAM_FATO) -- qualquer outro valor
// (vazio, ou 'TODOS', que só existe dentro de "Ver cupons" na tela) mantém
// o comportamento de hoje, sem tocar na RPC.
const VALORES_SITUACAO_FORCAM_FATO = new Set(['NORMAL', 'DEVOLVIDO', 'CANCELADO'])
const STATUS_LABEL: Record<string, string> = { NORMAL: 'Autorizada', DEVOLVIDO: 'Devolvida', CANCELADO: 'Cancelada' }

// 'YYYY-MM' -> 'YYYY-MM-DD' do último dia do mês. Mesmo helper de page.tsx.
function fimDoMes(mesISO: string): string {
  const [a, m] = mesISO.split('-').map(Number)
  return `${mesISO}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`
}

// Mesma paginação de `buscarMetaPorCodigo` (page.tsx) -- duplicada aqui em
// vez de importada de um arquivo de página, mesmo padrão já usado por outros
// exports desta auditoria (ex. relatorio-indicadores/export/route.ts) que
// espelham a lógica de page.tsx em vez de acoplar a um componente de página.
async function buscarMetaPorCodigo(
  supabase: ReturnType<typeof createServiceClient>,
  lojaId: number
): Promise<Map<number, { tipo: string | null; familia: string | null; nome?: string }>> {
  const metaPorCodigo = new Map<number, { tipo: string | null; familia: string | null; nome?: string }>()
  for (let pagina = 0; ; pagina++) {
    const from = pagina * 1000
    const { data } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia, codigo, descricao')
      .eq('loja_id', lojaId)
      .range(from, from + 999)
    if (!data?.length) break
    for (const p of data as { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; codigo: string | null; descricao: string | null }[]) {
      metaPorCodigo.set(Number(p.codigo_produto), {
        tipo: p.tipo_item,
        familia: p.descricao_familia,
        nome: p.descricao || p.codigo || String(p.codigo_produto),
      })
    }
    if (data.length < 1000) break
  }
  return metaPorCodigo
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  // Mesmos filtros da tela (período customizado + rótulos por dimensão), pra
  // "Baixar" bater com o que está sendo exibido (o título já prometia "com filtros").
  const { searchParams } = new URL(request.url)
  const dataIni = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')!.slice(0, 7) : null
  const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')!.slice(0, 7) : null
  const rotulosPorDim: Record<string, string[]> = {
    tipo: valoresMulti(searchParams.get('tipo') ?? undefined),
    familia: valoresMulti(searchParams.get('familia') ?? undefined),
    forma_pgto: valoresMulti(searchParams.get('forma_pgto') ?? undefined),
  }
  const statusParam = searchParams.get('status') ?? ''
  const statusForcaAgregacao = VALORES_SITUACAO_FORCAM_FATO.has(statusParam)

  const supabase = createServiceClient()
  const abas: AbaPlanilha[] = []

  if (statusForcaAgregacao) {
    // Mesma troca de fonte que a Task 3 fez em page.tsx: com Situação ativa,
    // o pré-agregado (RPC) não serve -- cancelado já não entra nele por
    // construção e devolvido vem misturado em normal, sem filtro possível em
    // query-time -- então usa `buscarFatAgregadoPorSituacao` (Task 2), que
    // agrega em JS sobre o fato linha-a-linha do Contabo.
    const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
    const dataInicioFato = dataIni ? `${dataIni}-01` : ''
    const dataFinalFato = fimDoMes(dataFim ?? mesAtual)

    // Fix round 1 (revisão Task 4, Critical #1/#2): DIFERENTE de page.tsx,
    // este endpoint só recebe `data_inicio`/`data_final` -- nunca o chip de
    // período (`periodo`, ex. "Ano passado") que a tela resolve internamente
    // pra `mesIni`/`mesFim` antes de decidir o clamp. Repetir o mesmo clamp
    // condicional de page.tsx aqui (tipo/família pro ano corrente quando
    // "sem período explícito") seria ERRADO: um usuário com o chip "Ano
    // passado" ativo (2025) nunca manda `data_inicio`/`data_final` na URL de
    // export (`exportParams` em page.tsx só carrega esses dois campos, não o
    // chip) -- essa rota enxergaria "sem período nenhum" e clamparia
    // Tipo/Família pro ano CORRENTE (2026), devolvendo um Excel vazio de
    // 2025 pra quem esperava ver exatamente 2025. Achado real medido ao
    // vivo pelo revisor (loja 3): Tipo/Família clampadas = R$4.525.708,53
    // (só 2026) contra R$7.959.457,39 (all-time, o que Forma de pgto já
    // buscava sem clamp) -- 76% de diferença, e as 3 abas do MESMO arquivo
    // ficavam em períodos diferentes sem nenhum aviso.
    //
    // Correção: SEM clamp nenhum aqui -- as 3 dimensões usam sempre o MESMO
    // período (o explícito, se houver; sem piso de data, se não), igual ao
    // que a aba Forma de pgto já fazia. Nunca fica menor que o que a RPC
    // (branch `else` abaixo) já devolvia pro mesmo clique sem Situação --
    // era sempre um superset (sem noção nenhuma de período fora do
    // explícito), nunca um subconjunto que pudesse faltar dado que a tela
    // mostrava. Custo aceito conscientemente (mesmo raciocínio do brief:
    // "Baixar" é uma ação explícita de download, sem timeout de serverless
    // nesta infra self-hosted) -- mais barato ainda depois do fix do
    // Important #4 abaixo (fetch único reusado pelas 3 abas, não 1 por aba).
    const metaPorCodigo = await buscarMetaPorCodigo(supabase, lojaId)

    // Fix round 1 (Important #4): tipo e família usam EXATAMENTE os mesmos
    // parâmetros de busca agora (mesmo período pras 3, sem clamp por
    // dimensão) -- sem isso, cada uma das 3 dimensões refaria o mesmo fetch
    // de `/fat_cupons` (as 3) e `/fat_cupom_itens` (tipo e família)
    // integralmente. Busca uma vez só aqui fora do loop e repassa via
    // `cuponsPreFetch`/`itensPreFetch`/`pagamentosPreFetch` (Task 4,
    // `buscarFatAgregadoPorSituacao`) -- 3 fetches no total em vez de 6.
    let cuponsTruncou = false
    let itensTruncou = false
    let pagamentosTruncou = false
    const [cuponsPreFetch, itensPreFetch, pagamentosPreFetch] = await Promise.all([
      buscarFatCupons({ lojaId, dataInicio: dataInicioFato, dataFinal: dataFinalFato, onTruncado: () => { cuponsTruncou = true } }),
      buscarFatCupomItens({ lojaId, dataInicio: dataInicioFato, dataFinal: dataFinalFato, onTruncado: () => { itensTruncou = true } }),
      buscarFatCupomPagamentosPeriodo({ lojaId, dataInicio: dataInicioFato, dataFinal: dataFinalFato, onTruncado: () => { pagamentosTruncou = true } }),
    ])

    const periodoLabel = dataInicioFato ? `${dataInicioFato} a ${dataFinalFato}` : `até ${dataFinalFato} (sem piso de data)`

    for (const d of DIMS) {
      const group: 'forma' | 'tipo' | 'familia' = d.dim === 'forma_pgto' ? 'forma' : d.dim === 'tipo' ? 'tipo' : 'familia'
      const rows = await buscarFatAgregadoPorSituacao({
        lojaId,
        dataInicio: dataInicioFato,
        dataFinal: dataFinalFato,
        group,
        group2: 'mes',
        status: statusParam,
        metaPorCodigo: d.dim === 'forma_pgto' ? undefined : metaPorCodigo,
        cuponsPreFetch,
        itensPreFetch,
        pagamentosPreFetch,
      })
      // Fix round 1 (Important #3): `rotulosPorDim` (filtro de tipo/família/
      // forma de pgto vindo da URL) só era aplicado no branch `else` (via
      // `p_rotulos` da RPC) -- ficava mudo aqui, então `?familia=DRINKS&
      // status=NORMAL` devolvia TODAS as famílias em vez de só DRINKS.
      // `buscarFatAgregadoPorSituacao` não tem filtro de rótulo em
      // query-time (agrega tudo em JS), então aplica aqui, depois da
      // agregação -- mesmo efeito final de `p_rotulos` na RPC.
      const rotulosFiltro = rotulosPorDim[d.dim] ?? []
      const rowsFiltradas = rotulosFiltro.length ? rows.filter((r) => rotulosFiltro.includes(r.rotulo)) : rows

      // Fix round 2 (revisão Task 4, Important): o fix do Important #3 acima
      // introduziu um risco novo -- o vocabulário do filtro de `forma_pgto`
      // (rótulos amigáveis de `faturamento_importado`, ex. "Pix") pode não
      // bater 100% com o rótulo que este caminho gera (`FORMA_PGTO_LABEL` em
      // `lib/faturamento-frio.ts` mapeia os códigos crus mais comuns, mas
      // alguns ficam sem mapa confirmado -- ver comentário lá). Se um filtro
      // não bater NENHUMA linha (`rows.length > 0` mas `rowsFiltradas.length
      // === 0`), a aba NÃO desaparece em silêncio (2ª vez nesta task que essa
      // classe de bug apareceria) -- fica com 0 linhas de dado, mas com um
      // aviso explícito no subtítulo explicando por quê. `rows.length === 0`
      // (sem dado NENHUM na dimensão/período, com ou sem filtro) continua
      // omitindo a aba -- comportamento de sempre, não é o caso que este fix
      // protege.
      const filtroZerouTudo = rotulosFiltro.length > 0 && rows.length > 0 && rowsFiltradas.length === 0
      if (!rows.length) continue

      const linhas: Linha[] = rowsFiltradas
        .filter((r) => r.mes)
        .map((r) => ({ rotulo: r.rotulo, mes: r.mes as string, valor: r.valor }))
      // Excel não tem como mostrar um banner clicável -- mesmo padrão de
      // relatorio-indicadores/export/route.ts (aviso embutido no subtítulo).
      // Período SEMPRE explícito agora (fix Critical #2: com as 3 abas
      // garantidamente no mesmo período pós-fix do clamp, isso é reforço de
      // transparência, não correção de uma divergência real que ainda
      // exista).
      const truncou = group === 'forma' ? (cuponsTruncou || pagamentosTruncou) : (cuponsTruncou || itensTruncou)
      const subtitulo = [
        `Período: ${periodoLabel}`,
        filtroZerouTudo
          ? `ATENÇÃO: o filtro de ${d.label} (${rotulosFiltro.join(', ')}) não bateu nenhuma linha nesta dimensão -- aba deixada vazia de propósito (rótulo do filtro pode não bater com o rótulo gerado aqui, ver lib/faturamento-frio.ts)`
          : null,
        truncou ? 'ATENÇÃO: falha ao consultar o histórico do Contabo -- este total pode estar incompleto' : null,
      ].filter(Boolean).join(' · ')
      abas.push(abaMatrizMensal({
        titulo: `Faturamento por ${d.label} (mês a mês) · Situação: ${STATUS_LABEL[statusParam] ?? statusParam}`,
        dimLabel: d.label,
        linhas,
        nome: d.nome,
        subtitulo,
      }))
    }
  } else {
    for (const d of DIMS) {
      const rotulos = rotulosPorDim[d.dim] ?? []
      const linhas = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', {
        p_loja_id: lojaId,
        p_dim: d.dim,
        p_mes_ini: dataIni,
        p_mes_fim: dataFim,
        p_rotulos: rotulos.length ? rotulos : null,
      })
      if (linhas.length) {
        abas.push(abaMatrizMensal({ titulo: `Faturamento por ${d.label} (mês a mês)`, dimLabel: d.label, linhas, nome: d.nome }))
      }
    }
  }

  if (!abas.length) return new Response('Sem faturamento no período/filtro selecionado', { status: 404 })

  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('faturamento', buffer)
}
