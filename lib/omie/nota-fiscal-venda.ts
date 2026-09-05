import { omieRequest, type LojaOmie } from './client'

// Payload do método IncluirNfce (serviço produtos/cupomfiscalincluir/),
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

function montarDetItem(item: IncluirNfceItem, seqItem: number) {
  const vProd = Number((item.qCom * item.vUnCom).toFixed(2))
  return {
    seqItem,
    lCanc: 'N',
    lNaoMovEstoque: 'N',
    prodIdent: { cProd: item.cProd },
    prod: {
      cProd: item.cProd,
      xProd: item.xProd,
      NCM: item.ncm,
      CFOP: item.cfop,
      cUn: 'UN',
      nQuant: item.qCom,
      vUnit: item.vUnCom,
      vProd,
      vDesc: 0,
      vAcresc: 0,
    },
  }
}

export async function incluirNfce(loja: LojaOmie, payload: IncluirNfcePayload) {
  const vProdTotal = payload.itens.reduce((acc, i) => acc + Number((i.qCom * i.vUnCom).toFixed(2)), 0)
  const vTaxa = Math.max(0, Number((payload.vNF - vProdTotal).toFixed(2)))

  return omieRequest<{ status: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/cupomfiscalincluir',
    call: 'IncluirNfce',
    data: {
      NFe: {
        chNFe: payload.chNFe,
        nNF: payload.nNF,
        serie: payload.serie,
        dEmi: payload.dEmi,
        hEmi: payload.hEmi,
        tpAmb: payload.tpAmb,
        tpEmis: 1,
        lCanc: 'N',
        det: payload.itens.map((item, idx) => montarDetItem(item, idx + 1)),
        total: {
          vItem: vProdTotal,
          vProd: vProdTotal,
          vDesc: 0,
          vAcresc: 0,
          vICMS: 0,
          vCF: 0,
          vTaxa,
          vTotTrib: 0,
        },
      },
      formasPag: payload.pagamentos.map((p, idx) => ({
        seqPag: idx + 1,
        pagIdent: { pag: p.tPag },
        pag: { tPag: p.tPag, vPag: p.vPag },
        lCanc: 'N',
        lNaoGerarTitulo: 'S',
      })),
      nfce: {
        nfceXml: payload.nfceXml,
        nfceMd5: payload.nfceMd5,
        nfceProt: payload.nfceProt,
      },
    },
  })
}
