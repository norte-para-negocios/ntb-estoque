// Regras puras da APROVAÇÃO de pagamento (migration 370). Espelham fin_aprovacao_nivel, trg_fin_titulo_aprovacao,
// fin_titulo_aprovacao_decidir e trg_fin_pagamento_exige_aprovacao. O banco é a fonte da verdade; isto valida a tela.
// Dinheiro em centavos inteiros.

export type Aprovacao = 'nao_exige' | 'pendente' | 'aprovado' | 'reprovado'
export type Nivel = 0 | 1 | 2

export const ROTULO_APROVACAO: Record<Aprovacao, string> = {
  nao_exige: 'Não precisa de aprovação',
  pendente: 'Aguardando aprovação',
  aprovado: 'Aprovada',
  reprovado: 'Reprovada',
}
export const ROTULO_NIVEL: Record<Nivel, string> = { 0: '—', 1: 'Gerente', 2: 'Admin/dono' }

export type ConfigFinanceiro = {
  ativa: boolean
  /** até este valor (inclusive) a conta não precisa de aprovação */
  ateCent: number
  /** acima deste valor só admin/dono aprova (entre os dois, o gerente) */
  altoAcimaCent: number
  /** quem lançou a conta pode aprovar a própria conta */
  autorPodeAprovar: boolean
  /** o gerador de contas recorrentes cria as contas dos próximos N dias */
  recorrentesDias: number
}

/** Padrões decididos pelo dono (05/11/2026), todos configuráveis por loja. */
export const CONFIG_PADRAO: ConfigFinanceiro = { ativa: false, ateCent: 1000_00, altoAcimaCent: 5000_00, autorPodeAprovar: true, recorrentesDias: 45 }

export function nivelExigido(c: ConfigFinanceiro, valorCent: number): Nivel {
  if (!c.ativa || valorCent <= c.ateCent) return 0
  return valorCent > c.altoAcimaCent ? 2 : 1
}

export function validarConfig(c: ConfigFinanceiro): string | null {
  for (const v of [c.ateCent, c.altoAcimaCent, c.recorrentesDias]) if (!Number.isFinite(v)) return 'Valor inválido.'
  if (c.ateCent < 0 || c.altoAcimaCent < 0) return 'Os valores das faixas não podem ser negativos.'
  if (c.altoAcimaCent < c.ateCent) return 'O valor do admin/dono não pode ser menor que o valor sem aprovação.'
  if (!Number.isInteger(c.recorrentesDias) || c.recorrentesDias < 1 || c.recorrentesDias > 366) return 'Os dias do gerador de recorrentes vão de 1 a 366.'
  return null
}

/** Permissões → nível: 'Financeiro - Aprovar pagamento alto valor' = 2; 'Financeiro - Aprovar pagamento' = 1. */
export const nivelDoUsuario = (podeAprovar: boolean, podeAlto: boolean): Nivel => (podeAlto ? 2 : podeAprovar ? 1 : 0)

export function decidirAprovacao(
  t: { aprovacao: Aprovacao; nivel: number; criadoPor: string | null; cancelada: boolean },
  u: { nivel: number; userId: string },
  acao: 'aprovar' | 'reprovar', motivo: string, autorPodeAprovar: boolean,
): string | null {
  if (t.cancelada) return 'Conta cancelada não passa por aprovação.'
  if (t.aprovacao !== 'pendente') return 'Esta conta não está aguardando aprovação.'
  if (u.nivel < 1) return 'Sem permissão para aprovar pagamentos.'
  if (u.nivel < t.nivel) return 'Esta conta passa do valor do gerente: só admin/dono aprova.'
  if (!autorPodeAprovar && t.criadoPor && t.criadoPor === u.userId) return 'Quem lançou a conta não pode aprovar nem reprovar a própria conta.'
  if (acao === 'reprovar' && motivo.trim().length < 3) return 'Informe o motivo da reprovação.'
  return null
}

/** Mudou o valor da conta: a aprovação acompanha a faixa nova. */
export function aprovacaoAoMudarValor(
  atual: { aprovacao: Aprovacao; nivel: number; nivelAprovado: number | null }, novoNivel: Nivel,
): { aprovacao: Aprovacao; nivel: number } | { erro: string } {
  if (atual.aprovacao === 'reprovado') return { erro: 'Conta reprovada: o valor não muda. Cancele e lance de novo.' }
  if (atual.aprovacao === 'aprovado') {
    return novoNivel > (atual.nivelAprovado ?? 0) ? { aprovacao: 'pendente', nivel: novoNivel } : { aprovacao: 'aprovado', nivel: atual.nivel }
  }
  return novoNivel === 0 ? { aprovacao: 'nao_exige', nivel: 0 } : { aprovacao: 'pendente', nivel: novoNivel }
}

export function bloqueioPagamento(t: { aprovacao: Aprovacao; valorAConfirmar: boolean }): string | null {
  if (t.aprovacao === 'pendente') return 'Conta aguardando aprovação: só pode ser paga depois de aprovada.'
  if (t.aprovacao === 'reprovado') return 'Conta reprovada: não pode ser paga.'
  if (t.valorAConfirmar) return 'Confirme o valor da conta (valor estimado) antes de pagar.'
  return null
}
