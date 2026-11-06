import { acessoFinanceiro, PERM } from '@/lib/financeiro/dados'
import { carregarFluxo } from '@/lib/financeiro/fluxo-carregar'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'

export const dynamic = 'force-dynamic'

// Fluxo de caixa em Excel: os mesmos períodos da tela e, numa segunda aba, cada lançamento e conta prevista.
export async function GET(request: Request) {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { por, de, ate, erro, fluxo } = await carregarFluxo(lojaId, sp)
  if (erro || !fluxo) return new Response(erro ?? 'Não foi possível montar o fluxo de caixa.', { status: 500 })
  const periodos: AbaPlanilha = {
    nome: 'Fluxo', opts: { titulo: 'Fluxo de caixa', subtitulo: `${de} a ${ate} · por ${por} · saldo no início ${fluxo.saldoInicial.toFixed(2)}` },
    colunas: [
      { key: 'rotulo', label: 'Período', largura: 24 },
      { key: 'realizadoEntradas', label: 'Entrou', tipo: 'moeda', somar: true },
      { key: 'realizadoSaidas', label: 'Saiu', tipo: 'moeda', somar: true },
      { key: 'transferencias', label: 'Transferências', tipo: 'moeda' },
      { key: 'previstoEntradas', label: 'A entrar (previsto)', tipo: 'moeda', somar: true },
      { key: 'previstoSaidas', label: 'A sair (previsto)', tipo: 'moeda', somar: true },
      { key: 'saldoFinal', label: 'Saldo no fim', tipo: 'moeda' },
    ],
    rows: fluxo.periodos,
  }
  const origens: AbaPlanilha = {
    nome: 'Lançamentos', opts: { titulo: 'O que forma cada período', autoFiltro: true },
    colunas: [
      { key: 'data', label: 'Data', largura: 12 },
      { key: 'situacao', label: 'Situação', largura: 12 },
      { key: 'descricao', label: 'Descrição', largura: 44 },
      { key: 'conta', label: 'Conta', largura: 22 },
      { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
      { key: 'obs', label: 'Atenção', largura: 26 },
    ],
    rows: fluxo.origens.map((o) => ({
      data: `${o.data.slice(8, 10)}/${o.data.slice(5, 7)}/${o.data.slice(0, 4)}`, situacao: o.tipo === 'realizado' ? 'Realizado' : 'Previsto', descricao: o.descricao, conta: o.conta ?? 'Sem conta definida', valor: o.valor,
      obs: [o.atrasado ? `vencida em ${o.dataOriginal}` : '', o.estimado ? 'valor estimado' : '', o.transferencia ? 'transferência' : ''].filter(Boolean).join(' · '),
    })),
  }
  return planilhaResponse(`fluxo-caixa-${de}-${ate}.xlsx`, await gerarPlanilhaMulti([periodos, origens]))
}
