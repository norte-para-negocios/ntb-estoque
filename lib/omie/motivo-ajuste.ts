// Motivo do IncluirAjusteEstoque (tag `motivo`), por tipo. Módulo puro (sem imports @/) para rodar em `node --test`.
// Lista da API (https://app.omie.com.br/api/v1/estoque/ajuste/, campo motivo, conferida em 15/10/2026):
//   Entrada (ENT): INV inventário, OPE ordem de produção, PDV, INI estoque inicial.
//   Saída (SAI):   INV inventário, PER perda/quebra, OPS ordem de produção, PDV.
// O tipo ("ENT"/"SAI") NUNCA é motivo: o Omie recusa ("O preenchimento inválido da tag [motivo]!"). Até 15/10 o
// ajuste manual gravava motivo = tipo e caía no tipo na hora de enviar (linha 1323129, loja 5, presa no retry).

export type TipoAjusteManual = 'ENT' | 'SAI'

const MOTIVOS_POR_TIPO: Record<TipoAjusteManual, ReadonlySet<string>> = {
  ENT: new Set(['INV', 'OPE', 'PDV', 'INI']),
  SAI: new Set(['INV', 'PER', 'OPS', 'PDV']),
}

/**
 * Motivo do ajuste manual (Zerar, saldo contado e diferença da Central e de /estoque, entrada pela tela, Nova
 * movimentação): INV, o mesmo da faxina (zerarPAPositivo/corrigirContagens1410) e do Refazer inventário, aceito
 * pelo Omie nos dois sentidos. Perda/quebra segue pela transferência TPQ, não por aqui.
 */
export const MOTIVO_AJUSTE_MANUAL = 'INV'

export function motivoAjusteValido(tipo: TipoAjusteManual, motivo: string | null | undefined): boolean {
  return !!motivo && MOTIVOS_POR_TIPO[tipo]?.has(motivo) === true
}

/** Motivo a mandar ao Omie: o gravado se vale para o tipo; senão INV. Nunca o tipo. */
export function motivoOmieDoAjuste(tipo: TipoAjusteManual, motivoGravado: string | null | undefined): string {
  return motivoAjusteValido(tipo, motivoGravado) ? motivoGravado! : MOTIVO_AJUSTE_MANUAL
}

export type DecisaoReenvioManual =
  | { acao: 'enviar' }
  | { acao: 'encerrar'; status: 'Erro'; tentativas: number; descricao_status: string }

/**
 * Retry do ajuste manual: linha com motivo inválido gravado (ENT/SAI, de antes de 15/10) NÃO é reenviada. Ela
 * nunca entrou no Omie (todo envio com esse motivo foi recusado) e a quantidade foi calculada contra o saldo daquele
 * momento: mandar agora, com o motivo trocado, lançaria uma diferença velha por cima do que alguém já corrigiu à
 * mão (caso da 1323129). Sai do retry pelo teto de tentativas (mesmo jeito de `decidirErroItemInventario`), com a
 * explicação na descrição; quem quiser lança de novo pela tela.
 */
export function decidirReenvioAjusteManual(
  mov: { tipo: TipoAjusteManual; motivo: string | null | undefined; tentativas: number | null | undefined },
  tetoTentativas: number
): DecisaoReenvioManual {
  if (motivoAjusteValido(mov.tipo, mov.motivo)) return { acao: 'enviar' }
  return {
    acao: 'encerrar',
    status: 'Erro',
    tentativas: Math.max(mov.tentativas ?? 0, tetoTentativas),
    descricao_status:
      `Encerrado, não foi reenviado ao Omie: gravado com motivo inválido "${mov.motivo ?? ''}" (o Omie só aceita ` +
      `${[...MOTIVOS_POR_TIPO[mov.tipo]].join('/')} para ${mov.tipo}). A diferença era do saldo daquele momento; ` +
      `se ainda faltar corrigir, lance de novo pela tela.`,
  }
}

/**
 * Passo do retry de 1 linha de ajuste manual: encerra (grava o teto e a explicação, SEM chamar o envio) ou envia.
 * Separado de `retryMovimentosManuaisPendentes` para ter teste de comportamento com fakes: é isto que impede uma
 * linha antiga com motivo inválido (1323129) de ir ao Omie com INV por cima de uma correção feita à mão.
 */
export async function encerrarOuEnviarAjusteManual<M extends { id: number; tipo: TipoAjusteManual; motivo: string | null | undefined; tentativas: number | null | undefined }>(
  mov: M,
  tetoTentativas: number,
  deps: {
    gravarEncerramento: (
      id: number,
      patch: { status: 'Erro'; tentativas: number; descricao_status: string }
    ) => Promise<{ error: { message: string } | null }>
    enviar: (mov: M) => Promise<{ status: string }>
  }
): Promise<{ resultado: 'encerrada' | 'sucesso' | 'falha'; erro?: string }> {
  const decisao = decidirReenvioAjusteManual(mov, tetoTentativas)
  if (decisao.acao === 'encerrar') {
    const { error } = await deps.gravarEncerramento(mov.id, {
      status: decisao.status,
      tentativas: decisao.tentativas,
      descricao_status: decisao.descricao_status,
    })
    if (error) return { resultado: 'falha', erro: `encerrar movimento ${mov.id} (motivo invalido) falhou: ${error.message}` }
    return { resultado: 'encerrada' }
  }
  const r = await deps.enviar(mov)
  return { resultado: r.status === 'Concluido' ? 'sucesso' : 'falha' }
}

/**
 * Motivo do ajuste manual escolhido pela pessoa (Fase A, Task 11): saída marcada como perda/quebra vai como PER
 * (o Omie aceita PER só em SAI); todo o resto, INV como sempre. Sem escolha = INV (a Central não muda).
 */
export function motivoDoAjusteManual(tipo: TipoAjusteManual, escolha?: string | null): 'INV' | 'PER' {
  return tipo === 'SAI' && escolha === 'PER' ? 'PER' : 'INV'
}

/** Custo unitário digitado na entrada: vazio = usa o custo médio de hoje; senão > 0 e < R$ 10.000.000. */
export function validarCustoInformado(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  if (!Number.isFinite(v) || v <= 0) return 'Custo unitário precisa ser maior que zero (ou deixe em branco para usar o custo médio).'
  if (v >= 1e7) return 'Custo unitário alto demais. Confira o valor.'
  return null
}

/**
 * Valor unitário mandado no IncluirAjusteEstoque: na entrada com custo digitado, o custo digitado (o Omie faz a média
 * com ele, regra E9); no resto, o CMC lido na hora (como sempre). Sem CMC e sem custo = "Sem CMC" de sempre.
 */
export function valorDoAjusteManual(
  tipo: TipoAjusteManual,
  custoInformado: number | null | undefined,
  cmcAtual: number | null | undefined
): { valor: number; fonte: 'informado' | 'cmc' } | { semCmc: true } {
  if (tipo === 'ENT' && custoInformado != null && custoInformado > 0) return { valor: custoInformado, fonte: 'informado' }
  if (cmcAtual != null && cmcAtual > 0) return { valor: cmcAtual, fonte: 'cmc' }
  return { semCmc: true }
}
