// Exemplos de NF-e de saída para os testes (dados de mentira: CNPJs de exemplo com dígito válido, nenhum real).
// @ts-expect-error: import com .ts exigido pelo node --test (o tsc do Next não aceita a extensão)
import { itemDevolucao, itemTransferencia, NAT_OP, textoDevolucao, textoTransferencia, cfopPorUf, cfopDevolucaoBase } from './regras-puro.ts'
import type { ConfigFiscal, ItemOrigem } from './regras-puro'
import type { DadosNfeSaida, Endereco } from './nfe-puro'

export const ENDERECO_EMIT: Endereco = { xLgr: 'Rua da Aurora', nro: 'S/N', xBairro: 'Praia do Forte', cMun: '2921005', xMun: 'Mata de São João', uf: 'BA', cep: '48280000', fone: '71999990000' }
export const ENDERECO_FORN: Endereco = { xLgr: 'Av. Tancredo Neves', nro: '1000', xCpl: 'Galpão 3 – fundos', xBairro: 'Caminho das Árvores', cMun: '2927408', xMun: 'Salvador', uf: 'BA', cep: '41820020' }
export const ENDERECO_SP: Endereco = { xLgr: 'Rua Augusta', nro: '50', xBairro: 'Consolação', cMun: '3550308', xMun: 'São Paulo', uf: 'SP', cep: '01305000' }

export const ORIGEM_AZEITE: ItemOrigem = {
  nItem: 1, cProd: 'AZ-500', cEAN: '7891234567895', xProd: 'AZEITE EXTRA VIRGEM 500ML & CIA', ncm: '15091000', cest: '1700100', uCom: 'CX', qCom: 2, vUnCom: 300,
  vProd: 600, vDesc: 20, vFrete: 30, vSeg: 0, vOutro: 10, orig: 0,
  icms: { vBC: 620, pICMS: 20.5, vICMS: 127.1, modBC: 3, vBCST: 800, pICMSST: 20.5, vICMSST: 36.9, modBCST: 4, pMVAST: 29.03 },
  vIPI: 60,
}
export const ORIGEM_TOMATE: ItemOrigem = {
  nItem: 2, cProd: '0042', cEAN: null, xProd: 'TOMATE ITALIANO KG', ncm: '07020000', cest: null, uCom: 'KG', qCom: 12.5, vUnCom: 8.4,
  vProd: 105, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0, orig: 0,
  icms: { vBC: 0, pICMS: 0, vICMS: 0, modBC: null, vBCST: 0, pICMSST: 0, vICMSST: 0, modBCST: null, pMVAST: null },
  vIPI: 0,
}

export const CONFIG_SIMPLES: ConfigFiscal = { crt: 1, cstPisCofins: '49', csosnTransferencia: '400', cstTransferencia: '41', csosnRemessa: '900', cstRemessa: '90' }

const CHAVE_ORIGEM = '29261011444777000161550010000123451000012340'

export function dadosDevolucao(tpAmb: 1 | 2 = 2, crt: 1 | 3 = 1): DadosNfeSaida {
  const cfop = cfopPorUf(cfopDevolucaoBase('1403'), 'BA', 'BA')
  return {
    tpAmb, cUF: '29', serie: 920, numero: 7, cNF: '48151623', dhEmi: '2026-10-20T10:15:00-03:00', natOp: NAT_OP.devolucao, finNFe: 4,
    emit: { cnpj: '11222333000181', xNome: 'ODARA RESTAURANTE LTDA', xFant: 'ODARA', ender: ENDERECO_EMIT, ie: '123456789', crt },
    dest: { doc: '11444777000161', xNome: 'DISTRIBUIDORA DE ALIMENTOS EXEMPLO LTDA', ender: ENDERECO_FORN, ie: '987654321' },
    autXml: ['13937073000156'],
    refNFe: [CHAVE_ORIGEM],
    itens: [
      itemDevolucao(ORIGEM_AZEITE, { proporcao: 0.5, cfop, crt, cstPisCofins: '49' }),
      itemDevolucao(ORIGEM_TOMATE, { proporcao: 1, cfop: cfopPorUf(cfopDevolucaoBase('1102'), 'BA', 'BA'), crt, cstPisCofins: '49' }),
    ],
    transp: { modFrete: 9 },
    infCpl: textoDevolucao({ numeroOrigem: '12345', serieOrigem: '1', emissaoOrigem: '2026-10-10', chaveOrigem: CHAVE_ORIGEM, total: false, motivo: 'Produto com embalagem avariada “amassada”', crt, numeroInterno: 3 }),
  }
}

export function dadosTransferencia(tpAmb: 1 | 2 = 2): DadosNfeSaida {
  const natureza = 'transferencia' as const
  return {
    tpAmb, cUF: '29', serie: 920, numero: 8, cNF: '23162342', dhEmi: '2026-10-20T11:00:00-03:00', natOp: NAT_OP.transferencia, finNFe: 1,
    emit: { cnpj: '11222333000181', xNome: 'ODARA RESTAURANTE LTDA', ender: ENDERECO_EMIT, ie: '123456789', crt: 1 },
    dest: { doc: '11222333000262', xNome: 'ODARA FILIAL SP', ender: ENDERECO_SP, ie: 'ISENTO' },
    itens: [
      itemTransferencia({ codigo: 'P601', descricao: 'AZEITE 500ML', ncm: '15091000', cest: null, ean: '7891234567895', unidade: 'UN', origem: 0, tipoItem: '00', quantidade: 3, custoUnitario: 30.123456 },
        { natureza, cfg: CONFIG_SIMPLES, ufEmit: 'BA', ufDest: 'SP' }),
      itemTransferencia({ codigo: 'P700', descricao: 'MOLHO DA CASA', ncm: '21039091', cest: null, ean: null, unidade: 'KG', origem: 0, tipoItem: '04', quantidade: 1.25, custoUnitario: 22 },
        { natureza, cfg: CONFIG_SIMPLES, ufEmit: 'BA', ufDest: 'SP' }),
    ],
    transp: { modFrete: 0, transportadora: { doc: '11444777000161', xNome: 'TRANSPORTES EXEMPLO', uf: 'BA' }, vol: { qVol: 2, esp: 'CAIXA', pesoL: 12.5, pesoB: 13 } },
    infCpl: textoTransferencia({ natureza, numeroInterno: 1, crt: 1 }),
  }
}
