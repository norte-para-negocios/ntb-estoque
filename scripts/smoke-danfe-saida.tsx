// Smoke do DANFE da NF-e de saída SEM banco e SEM SEFAZ: monta a devolução de exemplo, assina com certificado de
// teste, junta um protNFe de mentira e desenha o PDF. Uso: npx tsx scripts/smoke-danfe-saida.tsx saida.pdf
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { DanfePDF } from '../components/nfe-saida/DanfePDF'
import { dadosDanfe } from '../lib/nfe-saida/danfe-puro'
import { montarNfe } from '../lib/nfe-saida/nfe-puro'
import { montarProcNFe } from '../lib/nfe-saida/sefaz-puro'
import { assinarNfe } from '../lib/nfe-saida/assinatura'
import { dadosDevolucao } from '../lib/nfe-saida/exemplos'
import { certificadoDeTeste } from '../lib/nfe-saida/teste-apoio'

async function main() {
  const destino = process.argv[2] ?? 'danfe-teste.pdf'
  const { certPem, keyPem } = certificadoDeTeste()
  const { xml, id, chave } = montarNfe(dadosDevolucao(2))
  const assinado = assinarNfe(xml, id, certPem, keyPem)
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>TESTE</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-10-20T10:15:05-03:00</dhRecbto><nProt>129260000000001</nProt><digVal>AAAA</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
  const buf = await renderToBuffer(createElement(DanfePDF, { d: dadosDanfe(montarProcNFe(assinado, prot)) }) as Parameters<typeof renderToBuffer>[0])
  writeFileSync(destino, buf)
  console.log(`DANFE gravado em ${destino} (${buf.length} bytes), chave ${chave}`)
}
main()
