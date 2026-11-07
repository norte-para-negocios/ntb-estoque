// Fase 10: "Prontidão para sair do Omie". Da medição da RPC prontidao_migracao (migration 470) para uma lista de conferência
// com o que já está pronto, o que pede atenção e o que impede a virada. Puro: node --test lib/migracao/prontidao-puro.test.ts

export type Prontidao = {
  foto: string | null
  cadastro: { produtos: number; sem_unidade: number; ncm_invalido: number; sem_familia: number; familias: number; locais: number; fornecedores: number }
  fichas: { producao: number; lidas: number }
  saldo: { linhas: number; negativos: number; custo_zero: number; custo_absurdo: number; valor: number }
  kardex: { desde: string | null; linhas: number; comparados: number; batem: number; diferem: number; sem_kardex: number }
  pendencias: { ops_abertas: number; notas_pendentes: number }
}

export type Estado = 'ok' | 'atencao' | 'bloqueia'
export type ItemProntidao = { chave: string; titulo: string; estado: Estado; detalhe: string; acao: string | null }

const n = (x: number) => x.toLocaleString('pt-BR')
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

/** Regras da virada (plano mestre, Fase 10): saldo inicial e custo por produto x local provados iguais ao Omie, cadastro completo,
 *  fichas copiadas, sem OP aberta nem nota pendente no dia da troca. */
export function avaliarProntidao(p: Prontidao, hoje: string): { itens: ItemProntidao[]; resumo: Record<Estado, number>; pronta: boolean } {
  const itens: ItemProntidao[] = []
  const add = (i: ItemProntidao) => itens.push(i)
  const c = p.cadastro

  add({ chave: 'foto', titulo: 'Posição de estoque atualizada', estado: !p.foto ? 'bloqueia' : p.foto < hoje ? 'atencao' : 'ok',
    detalhe: p.foto ? `foto de ${p.foto.split('-').reverse().join('/')}` : 'nenhuma posição lida do Omie',
    acao: p.foto && p.foto >= hoje ? null : 'Atualizar a posição do Omie (só leitura) antes da conferência final.' })

  add({ chave: 'cadastro', titulo: 'Cadastro de produtos completo', estado: c.produtos === 0 || c.sem_unidade > 0 ? 'bloqueia' : c.sem_familia > 0 ? 'atencao' : 'ok',
    detalhe: `${n(c.produtos)} ativos; ${n(c.sem_unidade)} sem unidade; ${n(c.sem_familia)} sem família`,
    acao: c.sem_unidade > 0 ? 'Produto sem unidade não pode entrar no estoque próprio (a unidade trava no 1º movimento).' : c.sem_familia > 0 ? 'Dar família aos produtos (relatórios e contas a pagar por categoria dependem dela).' : null })

  add({ chave: 'ncm', titulo: 'NCM dos produtos de venda e revenda', estado: c.ncm_invalido > 0 ? 'atencao' : 'ok',
    detalhe: c.ncm_invalido ? `${n(c.ncm_invalido)} produto(s) tipo 00/04 sem NCM de 8 dígitos` : 'todos com NCM',
    acao: c.ncm_invalido ? 'Preencher o NCM antes de emitir nota pelo Norte (no Vendas a NFC-e usa o NCM do produto).' : null })

  add({ chave: 'fornecedores', titulo: 'Fornecedores copiados', estado: c.fornecedores === 0 ? 'bloqueia' : 'ok',
    detalhe: `${n(c.fornecedores)} fornecedor(es)`, acao: c.fornecedores === 0 ? 'Puxar os fornecedores do Omie (Fornecedores → Puxar do Omie, só leitura).' : null })

  const faltaFicha = Math.max(0, p.fichas.producao - p.fichas.lidas)
  add({ chave: 'fichas', titulo: 'Fichas técnicas lidas do Omie', estado: p.fichas.producao > 0 && p.fichas.lidas === 0 ? 'bloqueia' : faltaFicha > 0 ? 'atencao' : 'ok',
    detalhe: `${n(p.fichas.lidas)} de ${n(p.fichas.producao)} pratos/pré-preparos (${pct(p.fichas.lidas, p.fichas.producao)}%)`,
    acao: faltaFicha > 0 ? 'Ligar a leitura de fichas (sync-fichas) para esta loja e esperar completar; prato sem ficha não baixa insumo.' : null })

  const s = p.saldo
  add({ chave: 'negativos', titulo: 'Sem saldo negativo para o saldo inicial', estado: s.negativos > 0 ? 'bloqueia' : 'ok',
    detalhe: s.negativos ? `${n(s.negativos)} produto×local negativo(s)` : 'nenhum negativo',
    acao: s.negativos ? 'Achar a causa de cada negativo (nota, OP ou transferência faltando) no Omie antes da virada; não entra saldo inicial negativo.' : null })

  add({ chave: 'custo', titulo: 'Custo médio confiável', estado: s.custo_absurdo > 0 || s.custo_zero > 0 ? 'bloqueia' : 'ok',
    detalhe: `${n(s.custo_absurdo)} com custo ≥ R$ 1.000; ${n(s.custo_zero)} com saldo e custo zero · estoque vale R$ ${s.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    acao: s.custo_absurdo || s.custo_zero ? 'Corrigir o custo no Omie (ou definir o custo de entrada com o dono) antes de copiar o saldo inicial.' : null })

  const k = p.kardex
  const semHistorico = k.linhas === 0
  add({ chave: 'kardex', titulo: 'Saldo provado igual ao Omie (posição × kardex)', estado: semHistorico ? 'bloqueia' : k.diferem > 0 || k.sem_kardex > 0 ? 'atencao' : 'ok',
    detalhe: semHistorico ? 'kardex do Omie ainda não copiado para esta loja'
      : `${n(k.batem)} de ${n(k.comparados)} produto×local batem (${pct(k.batem, k.comparados)}%); ${n(k.diferem)} diferem; ${n(k.sem_kardex)} sem movimento lido · kardex desde ${k.desde?.split('-').reverse().join('/') ?? '—'}`,
    acao: semHistorico ? 'Ligar a cópia completa (espelho_completo) e esperar o kardex do ano.' : k.diferem || k.sem_kardex ? 'Reler o kardex dos produtos que diferem (o espelho pode estar atrasado) e só então comparar de novo.' : null })

  add({ chave: 'pendencias', titulo: 'Nada aberto no Omie no dia da troca', estado: p.pendencias.ops_abertas > 0 || p.pendencias.notas_pendentes > 0 ? 'atencao' : 'ok',
    detalhe: `${n(p.pendencias.ops_abertas)} OP(s) aberta(s); ${n(p.pendencias.notas_pendentes)} nota(s) de entrada pendente(s) (90 dias)`,
    acao: p.pendencias.ops_abertas || p.pendencias.notas_pendentes ? 'Concluir ou excluir as OPs e lançar as notas pendentes antes da virada.' : null })

  const resumo: Record<Estado, number> = { ok: 0, atencao: 0, bloqueia: 0 }
  for (const i of itens) resumo[i.estado]++
  return { itens, resumo, pronta: resumo.bloqueia === 0 }
}
