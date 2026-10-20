import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, type ColunaExcel } from '@/lib/excel'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { rotuloMes } from '@/lib/estoque/periodo-fechado-puro'
import { carregarLivroEntradas } from '@/lib/contador/livro-entradas-loader'
import { carregarBlocoH } from '@/lib/contador/bloco-h-loader'
import { criarZip, type ArquivoZip } from '@/lib/contador/zip'
import { LivroEntradasPDF, type LivroPDFDados } from '@/components/relatorio/LivroEntradasPDF'

// Fase F: arquivos do pacote do contador (plano R6–R8). Tudo vem do banco: nenhuma chamada ao Omie nem à SEFAZ.

type Livro = Awaited<ReturnType<typeof carregarLivroEntradas>>
type BlocoH = Awaited<ReturnType<typeof carregarBlocoH>>
const br = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

export async function nomeDaLoja(lojaId: number): Promise<string> {
  const { data } = await createServiceClient().from('lojas').select('nome, nome_fantasia').eq('id', lojaId).maybeSingle()
  return (data?.nome_fantasia || data?.nome || `Loja ${lojaId}`) as string
}

const COLS_LIVRO: ColunaExcel[] = [
  { key: 'entrada', label: 'Data de entrada', tipo: 'texto', largura: 12 },
  { key: 'emissao', label: 'Emissão', tipo: 'texto', largura: 12 },
  { key: 'especie', label: 'Espécie', tipo: 'texto', largura: 8 },
  { key: 'serie', label: 'Série', tipo: 'texto', largura: 7 },
  { key: 'numero', label: 'Número', tipo: 'texto', largura: 12 },
  { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto', largura: 36 },
  { key: 'cnpj', label: 'CNPJ/CPF', tipo: 'texto', largura: 18 },
  { key: 'uf', label: 'UF', tipo: 'texto', largura: 5 },
  { key: 'cfop', label: 'CFOP', tipo: 'texto', largura: 8 },
  { key: 'valorContabil', label: 'Valor contábil', tipo: 'moeda', largura: 15, somar: true },
  { key: 'baseIcms', label: 'Base ICMS', tipo: 'moeda', largura: 14, somar: true },
  { key: 'icms', label: 'ICMS', tipo: 'moeda', largura: 12, somar: true },
  { key: 'icmsSt', label: 'ICMS-ST', tipo: 'moeda', largura: 12, somar: true },
  { key: 'ipi', label: 'IPI', tipo: 'moeda', largura: 12, somar: true },
  { key: 'pis', label: 'PIS', tipo: 'moeda', largura: 11, somar: true },
  { key: 'cofins', label: 'COFINS', tipo: 'moeda', largura: 11, somar: true },
  { key: 'chave', label: 'Chave de acesso', tipo: 'texto', largura: 48 },
]

function avisosDoLivro(l: Livro): string[] {
  return l.erros.length ? [`ATENÇÃO: falha ao ler ${l.erros.join(', ')}: o livro pode estar incompleto.`] : []
}

export async function planilhaLivro(l: Livro, loja: string, mes: string): Promise<Buffer> {
  const rows = l.linhas.map((x) => ({ ...x, entrada: br(x.dataEntrada), emissao: br(x.emissao) }))
  const resumo = [...l.totaisCfop, l.total].map((t) => ({ ...t, cfop: t.cfop === 'Total' ? 'Total geral' : t.cfop }))
  const aviso = avisosDoLivro(l).map((a) => ` · ${a}`).join('')
  return gerarPlanilhaMulti([
    { rows, colunas: COLS_LIVRO, opts: { titulo: `Livro de entradas — ${rotuloMes(mes)}`, subtitulo: `${loja} · ${l.total.notas} nota(s) · entrada de ${br(l.ini)} a ${br(l.fim)}${aviso}`, autoFiltro: true }, nome: 'Livro de entradas' },
    {
      rows: resumo,
      colunas: [
        { key: 'cfop', label: 'CFOP', tipo: 'texto', largura: 12 }, { key: 'notas', label: 'Notas', tipo: 'numero', largura: 8 },
        ...COLS_LIVRO.filter((c) => ['valorContabil', 'baseIcms', 'icms', 'icmsSt', 'ipi', 'pis', 'cofins'].includes(c.key)).map((c) => ({ ...c, somar: false })),
      ],
      opts: { titulo: `Resumo por CFOP — ${rotuloMes(mes)}`, subtitulo: loja },
      nome: 'Resumo por CFOP',
    },
  ])
}

export async function pdfLivro(l: Livro, loja: string, mes: string): Promise<Buffer> {
  const d: LivroPDFDados = { loja, mesRotulo: rotuloMes(mes), linhas: l.linhas, totaisCfop: l.totaisCfop, total: l.total, avisos: avisosDoLivro(l) }
  return renderToBuffer(createElement(LivroEntradasPDF, { d }) as Parameters<typeof renderToBuffer>[0])
}

export function descricaoFotoBlocoH(b: BlocoH): string {
  if (b.modo === 'proprio') return `Posição em ${br(b.dataPedida)} pelo estoque (todos os movimentos até o fim do dia)`
  if (!b.dataFoto) return `Sem foto de posição até ${br(b.dataPedida)}`
  return b.dataFoto === b.dataPedida ? `Foto da posição de ${br(b.dataFoto)}` : `Pedido ${br(b.dataPedida)}: a foto mais recente até lá é de ${br(b.dataFoto)} (loja Omie)`
}

export async function planilhaBlocoH(b: BlocoH, loja: string): Promise<Buffer> {
  const rows = b.linhas.map((l) => ({
    codigo: l.codigo, descricao: l.descricao, ncm: l.ncm, tipo: rotuloTipo(l.tipo), unidade: l.unidade, quant: l.quant, cmc: l.cmc, valor: l.valor,
    posse: '0', posseDesc: 'Item de propriedade do informante e em seu poder', situacao: l.custoSuspeito ? 'Custo fora do normal (vale 0)' : '',
  }))
  const colunas: ColunaExcel[] = [
    { key: 'codigo', label: 'COD_ITEM', tipo: 'texto', largura: 14 },
    { key: 'descricao', label: 'Descrição', tipo: 'texto', largura: 44 },
    { key: 'ncm', label: 'NCM', tipo: 'texto', largura: 12 },
    { key: 'tipo', label: 'Tipo (SPED)', tipo: 'texto', largura: 24 },
    { key: 'unidade', label: 'UNID', tipo: 'texto', largura: 8 },
    { key: 'quant', label: 'QTD', tipo: 'numero', largura: 14 },
    { key: 'cmc', label: 'VL_UNIT', tipo: 'numero', largura: 14 },
    { key: 'valor', label: 'VL_ITEM', tipo: 'moeda', largura: 16, somar: true },
    { key: 'posse', label: 'IND_PROP', tipo: 'texto', largura: 10 },
    { key: 'posseDesc', label: 'Indicador de propriedade', tipo: 'texto', largura: 44 },
    { key: 'situacao', label: 'Observação', tipo: 'texto', largura: 28 },
  ]
  const aviso = b.erros.length ? ` · ATENÇÃO: falha ao ler ${b.erros.join(', ')}` : ''
  return gerarPlanilhaMulti([{
    rows, colunas,
    opts: { titulo: 'Inventário tipo SPED (Bloco H)', subtitulo: `${loja} · ${descricaoFotoBlocoH(b)} · total ${b.total.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${aviso}`, autoFiltro: true },
    nome: 'Bloco H',
  }])
}

/** XMLs guardados das notas do livro (procNFe, o mais recente por chave). Loja Omie não guarda XML aqui. */
export async function xmlsDasNotas(lojaId: number, chaves: string[]): Promise<{ arquivos: ArquivoZip[]; semXml: string[] }> {
  const sb = createServiceClient()
  const achados = new Map<string, string>()
  for (let i = 0; i < chaves.length; i += 100) {
    const lote = chaves.slice(i, i + 100)
    const { data, error } = await sb.from('sefaz_documentos').select('id, chave, xml').eq('loja_id', lojaId).eq('tipo', 'procNFe')
      .in('chave', lote).not('xml', 'is', null).order('id', { ascending: false })
    if (error) { console.error('pacote: xmls', error.message); continue }
    for (const d of data ?? []) if (d.chave && !achados.has(d.chave)) achados.set(d.chave, d.xml as string)
  }
  return {
    arquivos: [...achados.entries()].map(([chave, xml]) => ({ nome: `xml-nfe-entrada/NFe${chave}.xml`, dados: xml })),
    semXml: chaves.filter((c) => !achados.has(c)),
  }
}

/** NF-e de SAÍDA emitidas pelo Norte Estoque no período (só PRODUÇÃO; Fase F, migration 260): procNFe das autorizadas
 *  e canceladas, e o procEventoNFe do cancelamento e da última CC-e. Sem a 260 devolve vazio. */
export async function xmlsNfeSaida(lojaId: number, ini: string, fim: string): Promise<{ arquivos: ArquivoZip[]; notas: number; canceladas: number }> {
  const { data, error } = await createServiceClient().from('nfe_saida').select('chave, status, xml_autorizado, cancel_xml, cce_xml, cce_seq')
    .eq('loja_id', lojaId).eq('tp_amb', 1).in('status', ['autorizada', 'cancelada']).gte('data_emissao', ini).lte('data_emissao', fim).order('numero')
  if (error) return { arquivos: [], notas: 0, canceladas: 0 }
  const arquivos: ArquivoZip[] = []
  for (const n of data ?? []) {
    if (n.xml_autorizado) arquivos.push({ nome: `xml-nfe-saida/NFe${n.chave}.xml`, dados: n.xml_autorizado as string })
    if (n.cancel_xml) arquivos.push({ nome: `xml-nfe-saida/NFe${n.chave}-cancelamento.xml`, dados: n.cancel_xml as string })
    if (n.cce_xml) arquivos.push({ nome: `xml-nfe-saida/NFe${n.chave}-cce${n.cce_seq}.xml`, dados: n.cce_xml as string })
  }
  return { arquivos, notas: (data ?? []).length, canceladas: (data ?? []).filter((n) => n.status === 'cancelada').length }
}

/** Pacote do mês: XMLs + livro (Excel e PDF) + Bloco H (Excel) + LEIA-ME. */
export async function montarPacote(lojaId: number, mes: string, dataBlocoH: string): Promise<{ zip: Buffer; nome: string }> {
  const loja = await nomeDaLoja(lojaId)
  const [livro, bloco] = await Promise.all([carregarLivroEntradas(lojaId, mes), carregarBlocoH(lojaId, dataBlocoH)])
  const chaves = [...new Set(livro.notas.map((n) => n.chave).filter((c): c is string => !!c && /^\d{44}$/.test(c)))]
  const [xlsLivro, pdf, xlsBloco, xmls, saida] = await Promise.all([
    planilhaLivro(livro, loja, mes), pdfLivro(livro, loja, mes), planilhaBlocoH(bloco, loja), xmlsDasNotas(lojaId, chaves),
    xmlsNfeSaida(lojaId, livro.ini, livro.fim),
  ])
  const semChave = livro.notas.filter((n) => !n.chave || !/^\d{44}$/.test(n.chave)).map((n) => n.numero ?? String(n.id))
  const leiaMe = [
    `Pacote do contador — ${loja} — ${rotuloMes(mes)}`,
    `Gerado pelo Norte Estoque em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}.`,
    '',
    `livro-de-entradas.xlsx / .pdf: ${livro.total.notas} nota(s) de entrada com data de entrada de ${br(livro.ini)} a ${br(livro.fim)}, uma linha por nota e CFOP. Valor contábil ${livro.total.valorContabil.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    `inventario-bloco-h.xlsx: ${descricaoFotoBlocoH(bloco)}. ${bloco.linhas.length} produto(s), total ${bloco.total.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    `xml-nfe-entrada/: ${xmls.arquivos.length} XML(s) de NF-e de entrada guardados no Norte Estoque.`,
    ...(xmls.semXml.length ? ['', `Notas do livro SEM XML guardado aqui (${xmls.semXml.length}). Em loja ligada ao Omie, baixe pelo Painel do Contador do Omie:`, ...xmls.semXml] : []),
    ...(semChave.length ? ['', `Notas sem chave de acesso (lançadas sem XML): ${semChave.join(', ')}`] : []),
    ...(livro.erros.length || bloco.erros.length ? ['', `ATENÇÃO: falha ao ler ${[...livro.erros, ...bloco.erros].join(', ')}. Gere o pacote de novo.`] : []),
    '',
    `xml-nfe-saida/: ${saida.notas} NF-e de saída emitida(s) pelo Norte Estoque em produção (devolução ao fornecedor e transferência entre lojas)${saida.canceladas ? `, ${saida.canceladas} cancelada(s) (com o XML do cancelamento)` : ''}. Devolução ainda "a emitir" não tem NF-e e não entra.`,
  ].join('\r\n')
  const arquivos: ArquivoZip[] = [
    { nome: 'LEIA-ME.txt', dados: leiaMe },
    { nome: 'livro-de-entradas.xlsx', dados: xlsLivro },
    { nome: 'livro-de-entradas.pdf', dados: pdf },
    { nome: `inventario-bloco-h-${bloco.dataPedida}.xlsx`, dados: xlsBloco },
    ...xmls.arquivos,
    ...saida.arquivos,
  ]
  return { zip: criarZip(arquivos), nome: `pacote-contador-${mes}.zip` }
}
