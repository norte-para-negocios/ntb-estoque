import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { EtiquetaPDF, type Etiqueta, type EtiquetaConfig } from '@/components/etiqueta/EtiquetaPDF'
import { carregarEtiquetaConfig } from '@/lib/etiqueta-config'

// PDF de exemplo do padrão da etiqueta. Recebe a config atual (mesmo não salva)
// em base64 no param `cfg`; sem param, usa o padrão salvo da loja. Só gestores.
export async function GET(request: Request) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const lojaId = await getCurrentLojaId()

  const sp = new URL(request.url).searchParams
  let config: EtiquetaConfig = {}
  const cfgParam = sp.get('cfg')
  if (cfgParam) {
    try {
      config = JSON.parse(Buffer.from(cfgParam, 'base64').toString('utf8')) as EtiquetaConfig
    } catch {
      config = {}
    }
  } else {
    config = await carregarEtiquetaConfig(createServiceClient(), lojaId)
  }

  const qr = await QRCode.toDataURL('90629', { margin: 1, width: 160 })
  const base = {
    codigo_produto: '90629',
    descricao: 'CHOPP BRAHMA CLARO BARRIL KEG 50L',
    cnpj: '12.345.678/0001-90',
    nome_loja: config.nomeExibido?.trim() || 'SUA LOJA',
    qr,
  }
  // Uma única etiqueta de exemplo, com todos os campos preenchidos, para o admin
  // ver o padrão completo (os campos ocultos somem conforme a config).
  const etiquetas: Etiqueta[] = [
    {
      ...base,
      lote: 'OP-1234',
      quantidade: '1 de 10 (UN)',
      qtde_nf: '10 (CX)',
      qtde_etiqueta: '1 (CX)',
      validade: '28/06/2026',
      produzido: '21/06/2026',
      inclusao: '20/06/2026',
      fornecedor: 'SENDAS DISTRIBUIDORA S/A',
    },
  ]

  const element = createElement(EtiquetaPDF, { etiquetas, config }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="etiqueta-teste.pdf"' },
  })
}
