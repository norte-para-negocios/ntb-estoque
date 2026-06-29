import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { EtiquetaPDF, type Etiqueta, type EtiquetaConfig } from '@/components/etiqueta/EtiquetaPDF'
import { carregarEtiquetaConfig } from '@/lib/etiqueta-config'
import { formatarNomeProduto } from '@/lib/formatar-nome'

// Quantidade EXATA do Omie na etiqueta: ate 12 casas, sem arredondar.
// (o parametro dec e mantido por compatibilidade de chamada; nao trunca mais
//  a quantidade real — 0,816100 aparece como "0,8161", nao "1".)
function num(v: unknown, _dec?: number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 12 })
}

// Override de TAMANHO que o usuario escolheu no dialogo (largura/altura em cm).
// O resto do padrao (campos, cor, nome, etc.) vem do etiqueta_config da loja.
function parseTamanho(url: string): EtiquetaConfig {
  const sp = new URL(url).searchParams
  const lc = Number(sp.get('lc'))
  const ac = Number(sp.get('ac'))
  const cfg: EtiquetaConfig = {}
  if (lc >= 2 && lc <= 30) cfg.larguraCm = lc
  if (ac >= 2 && ac <= 30) cfg.alturaCm = ac
  return cfg
}

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.split('-')
  return `${dia}/${m}/${y}`
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select(
      'identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, validade, quantidade, dt_conclusao_real'
    )
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!op) return NextResponse.json({ error: 'Ordem não encontrada' }, { status: 404 })

  const { data: loja } = await supabase.from('lojas').select('cnpj, nome, nome_fantasia').eq('id', lojaId).single()
  const { data: prod } = await supabase
    .from('produtos')
    .select('codigo, descricao, unidade')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', op.identificacao_n_cod_produto)
    .maybeSingle()

  const unidade = prod?.unidade || 'UN'
  const codigoProduto = prod?.codigo || String(op.identificacao_n_cod_produto)
  const descricao = formatarNomeProduto(prod?.descricao)
  const qtdeOP = op.identificacao_n_qtde ?? 1
  const produzido = op.dt_conclusao_real
    ? fmtData(op.dt_conclusao_real as string)
    : new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
  const validade = op.validade ? fmtData(op.validade) : '-'
  const numOP = op.identificacao_c_num_op || op.num_ordem || ''
  const qr = await QRCode.toDataURL(String(codigoProduto), { margin: 1, width: 160 })

  // Se unidade é "UN": uma etiqueta por unidade ("i de N (UN)"). Senão: uma só (kg etc).
  const total =
    unidade === 'UN' ? Math.min(Math.max(1, Math.floor(Number(qtdeOP) || 1)), 1000) : 1
  const etiquetas: Etiqueta[] = []
  for (let i = 1; i <= total; i++) {
    const quantidade =
      unidade === 'UN' ? `${i} de ${num(qtdeOP, 0)} (UN)` : `${num(qtdeOP, 3)} (${unidade})`
    etiquetas.push({
      codigo_produto: String(codigoProduto),
      descricao,
      lote: String(numOP),
      quantidade,
      qtde_nf: '',
      qtde_etiqueta: num(op.quantidade || 1, 3), // nunca 0: se a qtd nao foi editada (null/0), usa 1
      inclusao: '',
      validade,
      produzido,
      fornecedor: '',
      cnpj: loja?.cnpj ?? '',
      qr,
      nome_loja: loja?.nome_fantasia || loja?.nome || '',
    })
  }

  const config: EtiquetaConfig = { ...(await carregarEtiquetaConfig(supabase, lojaId)), ...parseTamanho(request.url) }
  const element = createElement(EtiquetaPDF, { etiquetas, config }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  // Registra a impressao no historico (aditivo, nao quebra o PDF em caso de erro)
  try {
    const service = createServiceClient()
    await service.from('impressao_etiquetas').insert({
      loja_id: lojaId,
      origem: 'OP',
      referencia_id: Number(id),
      qtd_etiquetas: etiquetas.length,
      user_id: (await getUser())?.id ?? null,
    })
  } catch {
    // ignora falha de registro de historico
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etiquetas-op-${numOP}.pdf"`,
    },
  })
}
