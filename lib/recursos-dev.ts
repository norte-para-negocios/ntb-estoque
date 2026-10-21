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
