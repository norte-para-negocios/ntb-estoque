// Smoke do PDF do pedido de compra (sem banco): npx tsx scripts/smoke-pdf-pedido-compra.tsx [saida.pdf]
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { PedidoCompraPDF } from '../components/relatorio/PedidoCompraPDF'

async function main() {
  const el = createElement(PedidoCompraPDF, { d: {
    loja: 'Loja Teste', lojaCnpj: '00.000.000/0001-00', numero: 7, etapa: 'Aprovado', emissao: '19/10/2026', previsao: '25/10/2026',
    fornecedor: 'HORTIFRUTI TESTE', fornecedorCnpj: null, numeroFornecedor: 'A-77', contato: 'João',
    itens: [{ linha: 1, codigo: '80001', descricao: 'TOMATE', unidade: 'KG', quantidade: 10, preco: 4.5, obs: null }, { linha: 2, codigo: '90002', descricao: 'CERVEJA', unidade: 'CX', quantidade: 2, preco: 30, obs: 'gelada' }],
    mercadorias: 105, frete: 15, outras: 5, total: 125, parcelas: [{ numero: 1, vencimento: '24/11/2026', dias: 30, valor: 62.5 }, { numero: 2, vencimento: null, dias: 60, valor: 62.5 }],
    obs: 'Entregar pela manhã.', aprovadoPor: 'Dono',
  } }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  if (process.argv[2]) writeFileSync(process.argv[2], buf)
  console.log('PDF ok,', buf.length, 'bytes')
}
main().catch((e) => { console.error(e); process.exit(1) })
