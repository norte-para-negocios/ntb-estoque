import { createHash } from 'crypto'
import { omieRequest, type LojaOmie } from './client'

// Payload que o ntb-vendas manda (formato do antigo IncluirNfce; hoje so
// chNFe e nfceXml vao pro Omie, via ImportarNFCe -- ver abaixo),
// campos confirmados na documentação oficial da Omie (fetch feito em
// 2026-09-05, ver docs/superpowers/specs/2026-09-05-envio-nota-fiscal-
// omie-design.md no ntb-vendas). NÃO existe campo de observação/texto
// livre neste payload — a Omie não recebe nenhum rótulo de "quem
// enviou"; isso fica só em integration_attempts (ver Task 3).
export interface IncluirNfceItem {
  cProd: string
  xProd: string
  ncm: string
  cfop: string
  qCom: number
  vUnCom: number
}

export interface IncluirNfcePagamento {
  // Código SEFAZ de forma de pagamento (Nota Técnica 2015/002), mesmo
  // valor já usado no <detPag>/<tPag> do XML da própria nota — não
  // recalcular aqui, receber pronto de quem monta o payload.
  tPag: string
  vPag: number
}

export interface IncluirNfcePayload {
  chNFe: string // chave de acesso, 44 dígitos
  nNF: number
  serie: number
  dEmi: string // AAAA-MM-DD
  hEmi: string // HH:mm:ss
  tpAmb: 1 | 2 // 1 = produção, 2 = homologação
  itens: IncluirNfceItem[]
  pagamentos: IncluirNfcePagamento[]
  nfceXml: string // XML completo já assinado + protNFe (nfeProc)
  nfceMd5: string // MD5 hex do nfceXml
  nfceProt: string // número do protocolo de autorização
  vNF: number // valor total da nota
}

// Registro na Omie via ImportarNFCe (servico produtos/nfce/) -- trocado em
// 2026-09-28 depois do 1o teste real na loja 4: o IncluirNfce montado a mao
// (cupomfiscalincluir) era recusado ("Tag [CPROD] nao faz parte de prodIdent")
// e ainda exigiria emissor/caixa/conta/categoria. O ImportarNFCe le itens,
// totais e pagamentos do proprio XML autorizado. Validado ao vivo na loja 4:
// cupom criado + titulo no contas a receber; ExcluirCupom remove os dois.
// Regras descobertas no teste:
// - nfceMd5 e o MD5 do XML em LATIN-1 (em UTF-8 o Omie recusa "MD5 diferente").
// - todo cProd do XML precisa existir como produto no Omie (erro 5445 senao);
//   o NCM do XML pode ser diferente do cadastro.
// - resposta HTTP 200 com cCodStatus != "0" e erro (omieRequest nao lanca).
const EMISSOR = { emiNome: 'NORTEVENDAS', emiVersao: '1.0', emiId: '01' }

type ImportarNfceResposta = {
  idImportacao?: number
  idCupom?: number
  idLote?: number
  cCodStatus?: string
  cDesStatus?: string
}

async function importarNfceUmaVez(loja: LojaOmie, payload: IncluirNfcePayload, gerarTitulo: boolean) {
  const r = await omieRequest<ImportarNfceResposta>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/nfce',
    call: 'ImportarNFCe',
    data: {
      ...EMISSOR,
      chNFe: payload.chNFe,
      nfceXml: payload.nfceXml,
      nfceMd5: createHash('md5').update(Buffer.from(payload.nfceXml, 'latin1')).digest('hex'),
      cAcaoCliente: 'CONSUMIDOR',
      // 'S': a baixa de estoque ja acontece na venda (OP + saida, ver
      // lib/vendas-integracao.ts). Movimentar aqui de novo baixaria em dobro.
      cNaoMovEstoque: 'S',
      cNaoGerarTitulo: gerarTitulo ? 'N' : 'S',
      cIncluirProduto: 'N',
    },
  })
  if (!loja.is_test && r?.cCodStatus !== undefined && String(r.cCodStatus) !== '0') {
    throw new Error(`ImportarNFCe ${r.cCodStatus}: ${r.cDesStatus ?? 'erro sem descricao'}`)
  }
  return r
}

/**
 * Registra a NFC-e na Omie gerando o titulo financeiro (pedido do dono, 2026-09-28:
 * "registrar tudo no financeiro do Omie"). Se o Omie recusar por algo do titulo
 * (conta corrente, categoria, cliente, forma de pagamento sem configuracao), registra
 * a nota sem titulo pra nao perder o cupom e devolve `semTitulo` com o motivo --
 * aparece no log de integracao pra corrigir a configuracao no Omie.
 * Nota ja importada antes (ex.: reenvio da fila depois de timeout) conta como sucesso.
 */
export async function incluirNfce(loja: LojaOmie, payload: IncluirNfcePayload) {
  try {
    const r = await importarNfceUmaVez(loja, payload, true)
    return { ...r, comTitulo: true as const }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/j. (foi )?(importad|cadastrad|inclu.d)|j. existe|duplicad/i.test(msg)) {
      return { cCodStatus: '0', cDesStatus: msg, jaImportada: true as const, comTitulo: true as const }
    }
    if (!/t.tulo|conta corrente|categoria|forma de pagamento|financeir|lan.amento|parcela/i.test(msg)) throw e
    const r = await importarNfceUmaVez(loja, payload, false)
    return { ...r, comTitulo: false as const, semTitulo: msg }
  }
}
