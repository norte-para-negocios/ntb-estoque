import { notFound } from 'next/navigation'
import { getProfile } from '@/lib/auth'

// Recursos novos ainda não lançados: só quem tem is_super_admin (desenvolvedores) vê e usa.
// Tirar uma rota desta lista (e o `superAdmin` dela em NavItems) é o que "lança" o recurso.
export const ROTAS_SO_DEV = [
  '/sugestao-compra',
  '/tarefas-compras',
  '/requisicao-compra',
  '/pedido-compra',
  '/devolucao-fornecedor',
  '/nfe-saida',
  '/transferencia-loja',
  '/contador',
  '/relatorio-posicao-estoque',
  '/relatorio-cmv',
  '/relatorio-produtos-fornecedor',
  // Finanças, etapa 1 (migrations 285/286): contas correntes, categorias, contas a pagar, pagamentos e extrato.
  '/financeiro',
  // Relatórios dinâmicos estilo Omie (tabela dinâmica por cubo): só desenvolvedor até conferir os números com o Omie.
  '/relatorios/dinamico',
  // Fase 5 (T5.3/T5.4, migration 400): consumo teórico × real, perdas com causa e variação de preço na nota. Só estoque próprio.
  '/relatorio-consumo',
  '/relatorio-perdas',
  '/relatorio-variacao-preco',
  // Fase 8: engenharia de cardápio (popularidade × margem). Só estoque próprio.
  '/relatorio-engenharia-cardapio',
  // Fase 6 (migration 450): clientes e transportadoras. Só estoque próprio.
  '/cliente',
  // Fase 9: histórico de cadastros (quem mudou o quê).
  '/historico-cadastro',
] as const

export async function ehDesenvolvedor(): Promise<boolean> {
  return (await getProfile()).is_super_admin === true
}

// Páginas e rotas de API: quem não é desenvolvedor recebe 404, como se a tela não existisse.
export async function exigirDev(): Promise<void> {
  if (!(await ehDesenvolvedor())) notFound()
}

// Server actions: recusa com erro (a tela já nem aparece para quem não é desenvolvedor).
export async function exigirDevAcao(): Promise<void> {
  if (!(await ehDesenvolvedor())) throw new Error('Recurso ainda em teste.')
}
