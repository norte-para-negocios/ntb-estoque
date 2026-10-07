// Link para a venda no painel do lojista do Norte Vendas: /loja?venda=<id do pedido> abre Administração > Vendas >
// Histórico com o detalhe da venda (lib/linkVenda.ts do Vendas). Só para referências que são id de pedido (uuid).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const URL_VENDAS_PADRAO = 'https://nortevendas.norteparanegocios.com.br'

/** Pedido do Vendas a partir da ref do movimento/OP ("pedido" ou "pedido|produto|linha"). */
export function pedidoDaRef(ref: string | null | undefined): string | null {
  const p = String(ref ?? '').split('|')[0].trim()
  return UUID_RE.test(p) ? p.toLowerCase() : null
}

export function urlVendaNoVendas(ref: string | null | undefined, base: string | null | undefined = process.env.NTB_VENDAS_PUBLIC_URL): string | null {
  const pedido = pedidoDaRef(ref)
  if (!pedido) return null
  const raiz = String(base || URL_VENDAS_PADRAO).replace(/\/+$/, '')
  return `${raiz}/loja?venda=${pedido}`
}
