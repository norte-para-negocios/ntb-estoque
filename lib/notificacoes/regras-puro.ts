// Notificações dentro do app (Fase G, migration 222): das contagens de uma loja para as notificações do sininho.
// Puro (sem @/): node --test lib/notificacoes/regras-puro.test.ts
// Uma notificação por tipo e loja (chave = tipo), com `nivel` = a contagem principal: a RPC notificacoes_sincronizar
// só volta a marcar como "não lida" quando o nível SOBE (melhorar não incomoda ninguém).
// `avaliados` = tipos cuja situação é conhecida: o que não se aplica ao modo da loja entra (fica resolvido) e o que teve a
// consulta falhando (null) fica de fora, para uma falha de banco não "resolver" uma notificação verdadeira.

export const TIPOS_NOTIFICACAO = [
  'validade_vencida', 'validade_proxima', 'estoque_minimo', 'nota_parada',
  'op_corrigir_omie', 'movimento_teto', 'bloqueio_omie', 'vendas_fila_erro', 'pedido_aprovacao',
] as const
export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number]
export type Gravidade = 'err' | 'warn' | 'info'

/** Permissão necessária para VER cada tipo no sininho (Admin/AdminLoja veem tudo). */
export const PERMISSAO_DO_TIPO: Record<TipoNotificacao, string> = {
  validade_vencida: 'Validade',
  validade_proxima: 'Validade',
  estoque_minimo: 'Movimentacoes',
  nota_parada: 'Notas Fiscais',
  op_corrigir_omie: 'Ordens de Producao',
  movimento_teto: 'Movimentacoes',
  bloqueio_omie: 'Movimentacoes',
  vendas_fila_erro: 'Ordens de Producao',
  pedido_aprovacao: 'Compras - Aprovar pedidos',
}

export type DadosNotificacao = {
  modo: 'omie' | 'proprio' | 'nenhum'
  hoje: string // YYYY-MM-DD (Bahia)
  validade: { vencidos: number; vencendo: number; dias: number } | null
  abaixoMinimo: number | null
  notasParadas: { quantidade: number; diasMaisAntiga: number; dias: number } | null
  opsCorrigirOmie: number | null
  movimentosTeto: number | null
  bloqueiosOmie: { quantidade: number; metodo: string | null } | null
  vendasFilaErro: number | null
  pedidosAguardando: number | null
}

export type NotificacaoNova = {
  tipo: TipoNotificacao
  chave: string
  gravidade: Gravidade
  titulo: string
  mensagem: string
  link: string
  nivel: number
}

/** Janela das notas paradas: 45 dias para trás (nota mais velha que isso já foi resolvida por fora, ver painel de ação). */
export const JANELA_NOTAS_DIAS = 45

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

function menosDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

function aplica(tipo: TipoNotificacao, modo: DadosNotificacao['modo']): boolean {
  switch (tipo) {
    case 'op_corrigir_omie':
    case 'movimento_teto':
    case 'bloqueio_omie':
    case 'vendas_fila_erro':
      return modo === 'omie'
    case 'pedido_aprovacao':
      return modo === 'proprio'
    case 'nota_parada':
      return true
    default:
      return modo !== 'nenhum'
  }
}

export function montarNotificacoes(d: DadosNotificacao): { avaliados: TipoNotificacao[]; itens: NotificacaoNova[] } {
  const conhecido: Record<TipoNotificacao, boolean> = {
    validade_vencida: d.validade != null, validade_proxima: d.validade != null, estoque_minimo: d.abaixoMinimo != null,
    nota_parada: d.notasParadas != null, op_corrigir_omie: d.opsCorrigirOmie != null, movimento_teto: d.movimentosTeto != null,
    bloqueio_omie: d.bloqueiosOmie != null, vendas_fila_erro: d.vendasFilaErro != null, pedido_aprovacao: d.pedidosAguardando != null,
  }
  const avaliados = TIPOS_NOTIFICACAO.filter((t) => !aplica(t, d.modo) || conhecido[t])
  const itens: NotificacaoNova[] = []
  const add = (tipo: TipoNotificacao, n: Omit<NotificacaoNova, 'tipo' | 'chave'>) => {
    if (aplica(tipo, d.modo) && conhecido[tipo] && n.nivel > 0) itens.push({ tipo, chave: tipo, ...n })
  }

  if (d.validade) {
    add('validade_vencida', {
      gravidade: 'err', nivel: d.validade.vencidos, link: '/validade?modo=vencidos',
      titulo: `${plural(d.validade.vencidos, 'item vencido', 'itens vencidos')} em estoque`,
      mensagem: 'Dê baixa (perda) ou confira a validade antes de usar ou vender.',
    })
    add('validade_proxima', {
      gravidade: 'warn', nivel: d.validade.vencendo, link: `/validade?dias=${d.validade.dias}`,
      titulo: `${plural(d.validade.vencendo, 'item vence', 'itens vencem')} em até ${d.validade.dias} dias`,
      mensagem: 'Use primeiro o que vence antes.',
    })
  }
  if (d.abaixoMinimo != null) {
    add('estoque_minimo', {
      gravidade: 'warn', nivel: d.abaixoMinimo, link: d.modo === 'proprio' ? '/reposicao' : '/produto?vista=compras&repor=1',
      titulo: `${plural(d.abaixoMinimo, 'produto abaixo', 'produtos abaixo')} do estoque mínimo`,
      mensagem: 'Veja o que repor e quanto falta para chegar no mínimo.',
    })
  }
  if (d.notasParadas) {
    const n = d.notasParadas
    add('nota_parada', {
      gravidade: 'warn', nivel: n.quantidade,
      link: `/nota-fiscal?status=PENDENTE&ini=${menosDias(d.hoje, JANELA_NOTAS_DIAS)}&fim=${d.hoje}`,
      titulo: `${plural(n.quantidade, 'nota de entrada parada', 'notas de entrada paradas')} há ${n.dias} dias ou mais`,
      mensagem: d.modo === 'proprio'
        ? `Conferir e dar entrada no estoque. A mais antiga está parada há ${n.diasMaisAntiga} dias.`
        : `Concluir o recebimento no Omie. A mais antiga está parada há ${n.diasMaisAntiga} dias.`,
    })
  }
  add('op_corrigir_omie', {
    gravidade: 'err', nivel: d.opsCorrigirOmie ?? 0, link: '/log',
    titulo: `${plural(d.opsCorrigirOmie ?? 0, 'OP precisa', 'OPs precisam')} de correção no Omie`,
    mensagem: 'A conclusão foi recusada pelo Omie (insumo inativo, produto sem ficha...) e não será tentada de novo sozinha.',
  })
  add('movimento_teto', {
    gravidade: 'err', nivel: d.movimentosTeto ?? 0, link: '/movimentacoes',
    titulo: `${plural(d.movimentosTeto ?? 0, 'ajuste de estoque não entrou', 'ajustes de estoque não entraram')} no Omie`,
    mensagem: 'O reenvio automático desistiu depois de 30 tentativas. Confira e lance de novo pela tela se ainda fizer sentido.',
  })
  if (d.bloqueiosOmie) {
    add('bloqueio_omie', {
      gravidade: 'err', nivel: d.bloqueiosOmie.quantidade, link: '/log',
      titulo: 'O Omie bloqueou a chave da loja nas últimas 6 horas',
      mensagem: `${d.bloqueiosOmie.metodo ? `Método bloqueado: ${d.bloqueiosOmie.metodo}. ` : ''}Não insista agora: cada tentativa estende o bloqueio. Os envios automáticos retomam sozinhos.`,
    })
  }
  add('vendas_fila_erro', {
    gravidade: 'err', nivel: d.vendasFilaErro ?? 0, link: '/log',
    titulo: `${plural(d.vendasFilaErro ?? 0, 'venda do Norte Vendas não baixou', 'vendas do Norte Vendas não baixaram')} no Omie`,
    mensagem: 'Itens da fila de integração que pararam com erro nos últimos 7 dias.',
  })
  add('pedido_aprovacao', {
    gravidade: 'info', nivel: d.pedidosAguardando ?? 0, link: '/pedido-compra?etapa=aguardando_aprovacao',
    titulo: `${plural(d.pedidosAguardando ?? 0, 'pedido de compra aguardando', 'pedidos de compra aguardando')} aprovação`,
    mensagem: 'Aprove ou devolva ao comprador.',
  })
  return { avaliados, itens }
}
