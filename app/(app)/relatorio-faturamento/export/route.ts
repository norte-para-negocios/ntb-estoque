import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha } from '@/lib/excel'
import { buscarFatAgregadoPorSituacao } from '@/lib/faturamento-frio'

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
const STATUS_LABEL: Record<string, string> = { NORMAL: 'Normal', DEVOLVIDO: 'Devolvido', CANCELADO: 'Cancelado' }

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
    const anoAtualStr = mesAtual.slice(0, 4)
    const dataInicioFato = dataIni ? `${dataIni}-01` : ''
    const dataFinalFato = fimDoMes(dataFim ?? mesAtual)
    const temPeriodoExplicito = !!(dataIni || dataFim)

    // Mesmo clamp condicional de page.tsx (dataInicioSituacao): sem período
    // explícito, tipo/família clampam pro ano corrente (mesmo raciocínio de
    // custo -- buscar todo o histórico sem filtro de data leva 10-15s+ por
    // dimensão, medido ao vivo na Task 3); forma_pgto nunca clampa, porque
    // "Todos" sempre significou all-time nessa aba (mesmo incidente real já
    // documentado em page.tsx -- clampar ali seria uma regressão, não uma
    // melhoria).
    const metaPorCodigo = await buscarMetaPorCodigo(supabase, lojaId)

    for (const d of DIMS) {
      const dataInicioSituacao =
        d.dim !== 'forma_pgto' && !temPeriodoExplicito ? `${anoAtualStr}-01-01` : dataInicioFato
      const group: 'forma' | 'tipo' | 'familia' = d.dim === 'forma_pgto' ? 'forma' : d.dim === 'tipo' ? 'tipo' : 'familia'
      let dimErrou = false
      const rows = await buscarFatAgregadoPorSituacao({
        lojaId,
        dataInicio: dataInicioSituacao,
        dataFinal: dataFinalFato,
        group,
        group2: 'mes',
        status: statusParam,
        metaPorCodigo: d.dim === 'forma_pgto' ? undefined : metaPorCodigo,
        onTruncado: () => { dimErrou = true },
      })
      const linhas: Linha[] = rows
        .filter((r) => r.mes)
        .map((r) => ({ rotulo: r.rotulo, mes: r.mes as string, valor: r.valor }))
      if (linhas.length) {
        // Excel não tem como mostrar um banner clicável -- mesmo padrão de
        // relatorio-indicadores/export/route.ts (aviso embutido no subtítulo).
        const subtitulo = dimErrou
          ? 'ATENÇÃO: falha ao consultar o histórico do Contabo -- este total pode estar incompleto'
          : undefined
        abas.push(abaMatrizMensal({
          titulo: `Faturamento por ${d.label} (mês a mês) · Situação: ${STATUS_LABEL[statusParam] ?? statusParam}`,
          dimLabel: d.label,
          linhas,
          nome: d.nome,
          subtitulo,
        }))
      }
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
