// Traduz os erros crus do Omie (integration_attempts.error_message) em uma
// explicacao clara e acionavel para o usuario (bug 14 da reuniao 18/06).
// tipo: 'transitorio' = passa sozinho / so tentar de novo; 'acao' = precisa
// resolver algo; 'info' = nao e erro de verdade.

export type ErroAmigavel = {
  titulo: string
  explicacao: string
  tipo: 'transitorio' | 'acao' | 'info'
}

export function explicarErroOmie(raw: string | null | undefined): ErroAmigavel | null {
  if (!raw) return null
  const m = raw.replace(/^ERROR:\s*/i, '').trim()
  const t = m.toLowerCase()

  if (/consumo redundante|redundant/.test(t))
    return {
      titulo: 'Limite de requisições do Omie',
      explicacao: 'O Omie pediu para aguardar alguns segundos antes de tentar de novo (proteção contra excesso de chamadas). É temporário e o sistema repete sozinho. Não precisa fazer nada.',
      tipo: 'transitorio',
    }
  if (/requisição desse método sendo executada/.test(t))
    return {
      titulo: 'Omie ocupado com a mesma requisição',
      explicacao: 'O Omie já está processando uma chamada igual a essa. Aguarde alguns instantes e tente novamente.',
      tipo: 'transitorio',
    }
  if (/cadastro deste produto está inativo/.test(t))
    return {
      titulo: 'Produto inativo no Omie',
      explicacao: 'O produto está inativo no Omie, então não dá para movimentar o estoque dele. Reative o produto no Omie (ou tire ele da operação) e tente de novo.',
      tipo: 'acao',
    }
  if (/cálculo do saldo|saldo de estoque e cmc/.test(t))
    return {
      titulo: 'Omie ainda calculando saldo/custo',
      explicacao: 'O Omie ainda não terminou de calcular o saldo e o custo (CMC) desse produto no local. Tente novamente em instantes.',
      tipo: 'transitorio',
    }
  if (/já existe um ajuste de estoque/.test(t))
    return {
      titulo: 'Lançamento já enviado (duplicado)',
      explicacao: 'Esse ajuste já tinha sido enviado ao Omie antes. Não precisa reenviar.',
      tipo: 'info',
    }
  if (/não existem registros para a página/.test(t))
    return {
      titulo: 'Sem registros novos',
      explicacao: 'Não havia registros novos para trazer nessa consulta. Não é um erro de verdade.',
      tipo: 'info',
    }
  if (/fetch failed|econnreset|etimedout|timeout|network|socket hang up/.test(t))
    return {
      titulo: 'Falha de conexão com o Omie',
      explicacao: 'Houve uma instabilidade de rede ao falar com o Omie. Costuma resolver sozinho; tente novamente.',
      tipo: 'transitorio',
    }

  // Sem padrao conhecido: mostra a mensagem do Omie limpa (sem o "ERROR:").
  return { titulo: 'Erro retornado pelo Omie', explicacao: m, tipo: 'acao' }
}
