import { createServiceClient } from '@/lib/supabase/server'
import { carregarCredencialLoja, type CredencialLoja } from '@/lib/estoque/sefaz-certificado'
import { tpAmbDaNfe, type TpAmb } from './ambiente'
import { assinarEventoNfe, assinarNfe } from './assinatura'
import {
  codigoUfIbge, dataHoraSaoPaulo, gerarCnf, montarNfe, r2, validarDadosNfe, type DadosNfeSaida, type Endereco,
} from './nfe-puro'
import { lerNotaOrigem } from './origem-puro'
import {
  cfopDevolucaoBase, cfopPorUf, dentroDoPrazoCancelamento, itemDevolucao, itemTransferencia, NAT_OP, proporcaoDevolvida, textoDevolucao,
  textoTransferencia, type ConfigFiscal, type Crt, type NaturezaSaida,
} from './regras-puro'
import {
  lerRetornoAutorizacao, lerRetornoConsulta, lerRetornoEvento, mensagemSefaz, montarConsReci, montarConsSit, montarEnvEvento, montarEnviNFe,
  montarEventoCancelamento, montarEventoCce, montarProcEvento, montarProcNFe, trecho, validarCorrecao, validarJustificativa, type ResultadoSefaz,
} from './sefaz-puro'
import { ErroAntesDoEnvio, postSefaz } from './rede'
import { urlServico } from './webservices'

// Orquestra a NF-e de SAÍDA (Fase F, F1/F2): monta os dados a partir do banco, reserva o número (migration 260),
// assina, envia, grava o retorno; consulta, cancelamento (110111), CC-e (110110) e descarte. Só servidor.
// O ambiente vem SEMPRE de tpAmbDaNfe() (NFE_AMBIENTE; padrão homologação). Nada aqui mexe em estoque: a saída das
// unidades já aconteceu ao registrar a devolução (231) ou a transferência (261).

export type OrigemNfe = 'devolucao' | 'transferencia_loja'
export type OpcoesEmissao = {
  modFrete?: 0 | 1 | 2 | 3 | 4 | 9
  transportadora?: { doc?: string | null; xNome?: string | null; ie?: string | null; uf?: string | null } | null
  volumes?: { qVol?: number | null; esp?: string | null; pesoL?: number | null; pesoB?: number | null } | null
  observacao?: string | null
}
export type Usuario = { id: string | null; nome: string | null }
export type ResultadoNfe = { ok: true; id: number; status: string; mensagem: string } | { error: string; id?: number }

// CNPJ da SEFAZ-BA: a BA exige o grupo autXML (cStat 486) e a própria mensagem de rejeição sugere este CNPJ quando a
// loja não informa o do escritório de contabilidade (achado do Norte Vendas em homologação, 03/08/2026).
const AUTXML_SEFAZ_BA = '13937073000156'

const sb = () => createServiceClient()
// Nada fala com a SEFAZ de PRODUÇÃO se o servidor não estiver com NFE_AMBIENTE=producao (nem consulta/cancelamento de
// uma nota de produção antiga): a trava vale para toda chamada, não só para a emissão.
const PRODUCAO_DESLIGADA = 'O ambiente de produção da NF-e está desligado neste servidor (NFE_AMBIENTE). Peça ao suporte.'
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const num = (v: unknown) => Number(v ?? 0) || 0

function msgBanco(e: { message?: string; code?: string } | null): string {
  if (!e) return 'Erro desconhecido'
  if ((e.code === '22023' || e.code === 'PF001') && e.message) return e.message
  if (/nfe_|transferencia_loja/.test(e.message ?? '') && /does not exist|not find/.test(e.message ?? '')) return 'A NF-e de saída ainda não foi ativada nesta instalação (migrations 260/261).'
  console.error('nfe-saida:', e.message)
  return 'Não foi possível concluir agora. Tente de novo; se continuar, avise o suporte.'
}

// ------------------------------------------------------------------------------------------------ emitente
type Emitente = { dados: DadosNfeSaida['emit']; uf: string; cUF: string; cfg: ConfigFiscal; autXml: string[]; infExtra: string | null }

export async function carregarEmitente(lojaId: number): Promise<Emitente | { error: string }> {
  const [{ data: l }, { data: c, error: ec }] = await Promise.all([
    sb().from('lojas').select('cnpj, nome, razao_social, nome_fantasia, logradouro, numero, complemento, bairro, codigo_municipio, cidade, uf, cep, telefone1, inscricao_estadual, modo_estoque').eq('id', lojaId).maybeSingle(),
    sb().from('nfe_config').select('*').eq('loja_id', lojaId).maybeSingle(),
  ])
  if (ec) return { error: msgBanco(ec) }
  if (!l) return { error: 'Loja não encontrada' }
  if (l.modo_estoque !== 'proprio') return { error: 'NF-e de saída pelo app só existe na loja de estoque próprio.' }
  if (!c?.crt) return { error: 'Configure o regime tributário (CRT) da loja em NF-e de saída → Configuração.' }
  const uf = String(l.uf ?? '').toUpperCase()
  const cUF = codigoUfIbge(uf)
  if (!cUF) return { error: 'Cadastre a UF da loja.' }
  const ender: Endereco = {
    xLgr: l.logradouro ?? '', nro: l.numero || 'S/N', xCpl: l.complemento, xBairro: l.bairro ?? '', cMun: dig(l.codigo_municipio),
    xMun: l.cidade ?? '', uf, cep: dig(l.cep), fone: l.telefone1,
  }
  const aut = dig(c.autxml_cnpj)
  return {
    uf, cUF,
    dados: { cnpj: dig(l.cnpj), xNome: l.razao_social || l.nome, xFant: l.nome_fantasia, ender, ie: String(l.inscricao_estadual ?? ''), crt: Number(c.crt) as Crt },
    cfg: {
      crt: Number(c.crt) as Crt, cstPisCofins: c.cst_pis_cofins ?? '49', csosnTransferencia: c.csosn_transferencia ?? '400',
      cstTransferencia: c.cst_transferencia ?? '41', csosnRemessa: c.csosn_remessa ?? '900', cstRemessa: c.cst_remessa ?? '90',
    },
    autXml: aut.length === 14 ? [aut] : uf === 'BA' ? [AUTXML_SEFAZ_BA] : [],
    infExtra: c.info_complementar ?? null,
  }
}

// ------------------------------------------------------------------------------------------------ dados por origem
type Montagem = { dados: Omit<DadosNfeSaida, 'numero' | 'serie' | 'cNF' | 'dhEmi'>; destNome: string; destDoc: string }

function transporte(o: OpcoesEmissao): DadosNfeSaida['transp'] {
  return { modFrete: o.modFrete ?? 9, transportadora: o.transportadora ?? null, vol: o.volumes ?? null }
}

export async function montarDevolucao(lojaId: number, devolucaoId: number, tpAmb: TpAmb, opcoes: OpcoesEmissao, emit: Emitente): Promise<Montagem | { error: string }> {
  const { data: dev, error } = await sb().from('devolucoes_fornecedor')
    .select('id, numero, compra_id, motivo, situacao, itens:devolucoes_fornecedor_itens(compra_item_id, quantidade, cfop, linha)')
    .eq('id', devolucaoId).eq('loja_id', lojaId).maybeSingle()
  if (error) return { error: msgBanco(error) }
  if (!dev) return { error: 'Devolução não encontrada nesta loja.' }
  if (dev.situacao !== 'a_emitir') return { error: 'Só se emite NF-e de devolução "a emitir".' }
  const { data: compra } = await sb().from('compras_proprio').select('chave_acesso').eq('id', dev.compra_id).eq('loja_id', lojaId).maybeSingle()
  const chave = compra?.chave_acesso as string | null
  if (!chave) return { error: 'A nota de entrada não tem chave de acesso (compra lançada sem XML): a NF-e de devolução precisa referenciar a NF-e do fornecedor. Emita pelo contador.' }
  const { data: doc } = await sb().from('sefaz_documentos').select('xml').eq('loja_id', lojaId).eq('chave', chave).eq('tipo', 'procNFe').order('id', { ascending: false }).limit(1).maybeSingle()
  if (!doc?.xml) return { error: 'O XML da nota de entrada não está guardado. Importe o XML em Notas Fiscais → Importar XML e tente de novo.' }
  let origem
  try { origem = lerNotaOrigem(doc.xml) } catch (e) { return { error: `Não foi possível ler o XML da nota de entrada: ${e instanceof Error ? e.message : e}` } }

  type ItemDev = { compra_item_id: number; quantidade: number; cfop: string | null; linha: number }
  const itensDev = ((dev.itens ?? []) as ItemDev[]).sort((a, b) => a.linha - b.linha)
  const idsItem = itensDev.map((i) => i.compra_item_id)
  const { data: itensCompra } = await sb().from('compras_proprio_itens').select('id, linha, movimento_id, cfop_entrada').eq('loja_id', lojaId).in('id', idsItem)
  const movIds = (itensCompra ?? []).map((i) => num(i.movimento_id)).filter(Boolean)
  const { data: movs } = await sb().from('estoque_movimentos').select('id, quantidade').eq('loja_id', lojaId).in('id', movIds.length ? movIds : [0])
  const qMov = new Map((movs ?? []).map((m) => [num(m.id), num(m.quantidade)]))
  const porId = new Map((itensCompra ?? []).map((i) => [num(i.id), i]))

  let total = true
  const itens = []
  for (const d of itensDev) {
    const ic = porId.get(num(d.compra_item_id))
    if (!ic) return { error: `Item ${d.linha} da devolução sem item da nota de entrada.` }
    const o = origem.itens.find((x: { nItem: number }) => x.nItem === num(ic.linha))
    if (!o) return { error: `O item ${ic.linha} não está no XML da nota de entrada.` }
    const recebido = qMov.get(num(ic.movimento_id)) ?? 0
    let f: number
    try { f = proporcaoDevolvida(num(d.quantidade), recebido) } catch (e) { return { error: `Item ${ic.linha}: ${e instanceof Error ? e.message : e}` } }
    if (f < 1) total = false
    const base = d.cfop || `5.${cfopDevolucaoBase(ic.cfop_entrada).slice(1)}`
    itens.push(itemDevolucao(o, { proporcao: f, cfop: cfopPorUf(base, emit.uf, origem.emitente.ender.uf || origem.ufEmit), crt: emit.cfg.crt, cstPisCofins: emit.cfg.cstPisCofins }))
  }
  if (origem.itens.length !== itensDev.length) total = false
  const dest = { doc: origem.emitente.doc, xNome: origem.emitente.xNome, ender: origem.emitente.ender, ie: origem.emitente.ie }
  return {
    destNome: dest.xNome, destDoc: dest.doc,
    dados: {
      tpAmb, cUF: emit.cUF, natOp: NAT_OP.devolucao, finNFe: 4, emit: emit.dados, dest, autXml: emit.autXml, refNFe: [chave], itens,
      transp: transporte(opcoes),
      infCpl: textoDevolucao({
        numeroOrigem: origem.numero, serieOrigem: origem.serie, emissaoOrigem: origem.emissao, chaveOrigem: chave, total, motivo: dev.motivo,
        crt: emit.cfg.crt, numeroInterno: dev.numero, extra: [opcoes.observacao, emit.infExtra].filter(Boolean).join(' '),
      }),
    },
  }
}

export async function montarTransferencia(lojaId: number, transfId: number, tpAmb: TpAmb, opcoes: OpcoesEmissao, emit: Emitente): Promise<Montagem | { error: string }> {
  const { data: t, error } = await sb().from('transferencias_loja')
    .select('id, numero, loja_destino_id, natureza, situacao, obs, itens:transferencias_loja_itens(linha, codigo_produto, quantidade, custo_unitario)')
    .eq('id', transfId).eq('loja_id', lojaId).maybeSingle()
  if (error) return { error: msgBanco(error) }
  if (!t) return { error: 'Transferência não encontrada nesta loja.' }
  if (t.situacao !== 'registrada') return { error: 'Só se emite NF-e de transferência registrada.' }
  const { data: d } = await sb().from('lojas')
    .select('cnpj, nome, razao_social, logradouro, numero, complemento, bairro, codigo_municipio, cidade, uf, cep, telefone1, inscricao_estadual')
    .eq('id', t.loja_destino_id).maybeSingle()
  if (!d) return { error: 'Loja de destino não encontrada.' }
  type It = { linha: number; codigo_produto: number; quantidade: number; custo_unitario: number }
  const itensT = ((t.itens ?? []) as It[]).sort((a, b) => a.linha - b.linha)
  const { data: prods } = await sb().from('produtos').select('codigo_produto, codigo, descricao, ncm, ean, unidade, tipo_item, full_object')
    .eq('loja_id', lojaId).in('codigo_produto', itensT.map((i) => i.codigo_produto))
  const pm = new Map((prods ?? []).map((p) => [num(p.codigo_produto), p]))
  const ufDest = String(d.uf ?? '').toUpperCase()
  const natureza = t.natureza as NaturezaSaida
  const itens = itensT.map((i) => {
    const p = pm.get(num(i.codigo_produto))
    const extras = ((p?.full_object as { extras?: Record<string, unknown> } | null)?.extras ?? {}) as Record<string, unknown>
    return itemTransferencia({
      codigo: String(p?.codigo ?? i.codigo_produto), descricao: String(p?.descricao ?? ''), ncm: p?.ncm ?? null, cest: extras.cest ? String(extras.cest) : null,
      ean: p?.ean ?? null, unidade: String(p?.unidade ?? 'UN'), origem: Number(extras.origem ?? 0) || 0, tipoItem: p?.tipo_item ?? null,
      quantidade: num(i.quantidade), custoUnitario: num(i.custo_unitario),
    }, { natureza, cfg: emit.cfg, ufEmit: emit.uf, ufDest: ufDest || emit.uf })
  })
  const dest = {
    doc: dig(d.cnpj), xNome: d.razao_social || d.nome, ie: d.inscricao_estadual,
    ender: { xLgr: d.logradouro ?? '', nro: d.numero || 'S/N', xCpl: d.complemento, xBairro: d.bairro ?? '', cMun: dig(d.codigo_municipio), xMun: d.cidade ?? '', uf: ufDest, cep: dig(d.cep), fone: d.telefone1 },
  }
  return {
    destNome: dest.xNome, destDoc: dest.doc,
    dados: {
      tpAmb, cUF: emit.cUF, natOp: NAT_OP[natureza], finNFe: 1, emit: emit.dados, dest, autXml: emit.autXml, itens, transp: transporte(opcoes),
      infCpl: textoTransferencia({ natureza, numeroInterno: t.numero, obs: [t.obs, opcoes.observacao].filter(Boolean).join(' '), crt: emit.cfg.crt, extra: emit.infExtra }),
    },
  }
}

/** Confere tudo o que dá para conferir sem reservar número (para a tela avisar o que falta antes do clique). */
export async function conferirAntesDeEmitir(lojaId: number, origem: OrigemNfe, origemId: number, opcoes: OpcoesEmissao = {}): Promise<{ ok: true; tpAmb: TpAmb; faltas: string[] } | { error: string }> {
  const tpAmb = tpAmbDaNfe()
  const emit = await carregarEmitente(lojaId)
  if ('error' in emit) return emit
  const m = origem === 'devolucao' ? await montarDevolucao(lojaId, origemId, tpAmb, opcoes, emit) : await montarTransferencia(lojaId, origemId, tpAmb, opcoes, emit)
  if ('error' in m) return m
  return { ok: true, tpAmb, faltas: validarDadosNfe({ ...m.dados, numero: 1, serie: 1, cNF: '12345678', dhEmi: dataHoraSaoPaulo() }) }
}

// ------------------------------------------------------------------------------------------------ emitir
type LinhaNfe = {
  id: number; loja_id: number; tp_amb: number; serie: number; numero: number; status: string; chave: string | null; xml_assinado: string | null
  protocolo: string | null; dh_recbto: string | null; n_recibo: string | null; cce_seq: number; enviando_desde: string | null
}

async function linha(lojaId: number, id: number): Promise<LinhaNfe | null> {
  const { data } = await sb().from('nfe_saida').select('id, loja_id, tp_amb, serie, numero, status, chave, xml_assinado, protocolo, dh_recbto, n_recibo, cce_seq, enviando_desde')
    .eq('id', id).eq('loja_id', lojaId).maybeSingle()
  return (data as LinhaNfe | null) ?? null
}

async function credencial(lojaId: number, cnpjLoja: string): Promise<CredencialLoja | { error: string }> {
  try {
    const c = await carregarCredencialLoja(lojaId)
    if (c.cnpjCertificado && c.cnpjCertificado.slice(0, 8) !== cnpjLoja.slice(0, 8)) return { error: 'O certificado digital cadastrado é de outro CNPJ.' }
    return c
  } catch (e) { return { error: e instanceof Error ? e.message : 'Certificado indisponível' } }
}

async function gravarResultado(n: LinhaNfe, r: ResultadoSefaz, xmlRetorno: string, tipo: 'retorno' | 'consulta', u: Usuario): Promise<ResultadoNfe> {
  const status = r.status === 'processando' ? 'incerta' : r.status
  const proc = r.status === 'autorizada' && r.protNFe && n.xml_assinado ? montarProcNFe(n.xml_assinado, r.protNFe) : null
  const { error } = await sb().rpc('nfe_registrar_retorno', {
    p_id: n.id, p_loja: n.loja_id, p_status: status, p_c_stat: r.cStat, p_x_motivo: r.xMotivo, p_protocolo: r.protocolo,
    p_dh_recbto: r.dhRecbto, p_n_recibo: r.nRec, p_xml_autorizado: proc, p_xml_retorno: xmlRetorno.slice(0, 200000), p_tipo_evento: tipo,
    p_user: u.id, p_user_nome: u.nome,
  })
  if (error) return { error: `A SEFAZ respondeu (${r.cStat ?? 'sem código'}), mas não foi possível gravar: ${msgBanco(error)}. Use "Consultar na SEFAZ".`, id: n.id }
  const texto = status === 'autorizada' ? `NF-e nº ${n.numero} autorizada (protocolo ${r.protocolo}).`
    : status === 'incerta' ? `A SEFAZ ainda não deu a resposta final (${mensagemSefaz(r.cStat, r.xMotivo)}). Use "Consultar na SEFAZ" em instantes.`
    : status === 'denegada' ? `NF-e denegada: ${mensagemSefaz(r.cStat, r.xMotivo)}`
    : `NF-e rejeitada: ${mensagemSefaz(r.cStat, r.xMotivo)}`
  return { ok: true, id: n.id, status, mensagem: texto }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function emitirNfe(lojaId: number, origem: OrigemNfe, origemId: number, opcoes: OpcoesEmissao, u: Usuario): Promise<ResultadoNfe> {
  const tpAmb = tpAmbDaNfe()
  const emit = await carregarEmitente(lojaId)
  if ('error' in emit) return emit
  const m = origem === 'devolucao' ? await montarDevolucao(lojaId, origemId, tpAmb, opcoes, emit) : await montarTransferencia(lojaId, origemId, tpAmb, opcoes, emit)
  if ('error' in m) return m
  const faltas = validarDadosNfe({ ...m.dados, numero: 1, serie: 1, cNF: '12345678', dhEmi: dataHoraSaoPaulo() })
  if (faltas.length) return { error: `Falta cadastro para emitir: ${faltas.join('; ')}.` }
  const cred = await credencial(lojaId, emit.dados.cnpj)
  if ('error' in cred) return cred

  // número (ou a NF-e que já existe para este documento: duplo clique)
  const { data: res, error: er } = await sb().rpc('nfe_reservar', { p_loja: lojaId, p_tp_amb: tpAmb, p_origem_tipo: origem, p_origem_id: origemId, p_user: u.id, p_user_nome: u.nome })
  if (er) return { error: msgBanco(er) }
  const reserva = res as { id: number; numero: number; serie: number; status: string; duplicado: boolean }
  if (reserva.duplicado && !['rascunho', 'rejeitada'].includes(reserva.status)) {
    return reserva.status === 'autorizada'
      ? { ok: true, id: reserva.id, status: 'autorizada', mensagem: `Esta devolução/transferência já tem a NF-e nº ${reserva.numero} autorizada.` }
      : { error: 'Já há um envio desta NF-e sem resposta final: use "Consultar na SEFAZ".', id: reserva.id }
  }

  const dhEmi = dataHoraSaoPaulo()
  const dados: DadosNfeSaida = { ...m.dados, numero: reserva.numero, serie: reserva.serie, cNF: gerarCnf(reserva.numero), dhEmi }
  let montada: ReturnType<typeof montarNfe>
  let assinado: string
  try {
    montada = montarNfe(dados)
    assinado = assinarNfe(montada.xml, montada.id, cred.certPem, cred.keyPem)
  } catch (e) { return { error: `Não foi possível montar/assinar a NF-e: ${e instanceof Error ? e.message : e}`, id: reserva.id } }

  const { error: ei } = await sb().rpc('nfe_iniciar_envio', {
    p_id: reserva.id, p_loja: lojaId, p_chave: montada.chave, p_xml_assinado: assinado, p_dh_emissao: dhEmi, p_valor: r2(montada.totais.vNF),
    p_dest_nome: m.destNome, p_dest_doc: m.destDoc, p_dados: { ...dados, emit: { ...dados.emit }, totais: montada.totais }, p_user: u.id, p_user_nome: u.nome,
  })
  if (ei) return { error: msgBanco(ei), id: reserva.id }
  const n = (await linha(lojaId, reserva.id))!

  let body: string
  try {
    const r = await postSefaz({ url: urlServico(emit.uf, tpAmb, 'NfeAutorizacao'), servico: 'NfeAutorizacao', corpo: montarEnviNFe(assinado, `${n.id}${n.numero}`.slice(-15)), cred })
    body = r.body
    if (r.status >= 500 && !/cStat/.test(body)) throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ErroAntesDoEnvio) {
      await sb().rpc('nfe_registrar_erro', { p_id: n.id, p_loja: lojaId, p_mensagem: msg, p_voltar_rascunho: true, p_user: u.id, p_user_nome: u.nome })
      return { error: `A NF-e não foi enviada: ${msg}. Pode tentar de novo.`, id: n.id }
    }
    await sb().rpc('nfe_registrar_retorno', { p_id: n.id, p_loja: lojaId, p_status: 'incerta', p_c_stat: null, p_x_motivo: msg.slice(0, 300), p_user: u.id, p_user_nome: u.nome })
    return { error: `A SEFAZ não respondeu (${msg}). A nota pode ter sido autorizada: use "Consultar na SEFAZ" antes de qualquer outra coisa.`, id: n.id }
  }

  let r = lerRetornoAutorizacao(body)
  // assíncrono (103/105 com recibo): consulta o recibo algumas vezes antes de devolver
  const nRec = r.nRec
  if (r.status === 'processando' && nRec) {
    for (let i = 0; i < 3 && r.status === 'processando'; i++) {
      await espera(2500)
      try {
        const rr = await postSefaz({ url: urlServico(emit.uf, tpAmb, 'NfeRetAutorizacao'), servico: 'NfeRetAutorizacao', corpo: montarConsReci(tpAmb, nRec), cred })
        const lido = lerRetornoAutorizacao(rr.body)
        r = { ...lido, nRec: lido.nRec ?? nRec }
        body = rr.body
      } catch { break }
    }
  }
  return gravarResultado(n, r, body, 'retorno', u)
}

// ------------------------------------------------------------------------------------------------ consultar
export async function consultarNfe(lojaId: number, nfeId: number, u: Usuario): Promise<ResultadoNfe> {
  const n = await linha(lojaId, nfeId)
  if (!n) return { error: 'NF-e não encontrada.' }
  if (!n.chave) return { error: 'Esta NF-e ainda não foi enviada (sem chave).', id: n.id }
  const emit = await carregarEmitente(lojaId)
  if ('error' in emit) return emit
  const cred = await credencial(lojaId, emit.dados.cnpj)
  if ('error' in cred) return cred
  const tp = n.tp_amb as TpAmb
  if (tp === 1 && tpAmbDaNfe() !== 1) return { error: PRODUCAO_DESLIGADA, id: n.id }
  try {
    const r = await postSefaz({ url: urlServico(emit.uf, tp, 'NfeConsultaProtocolo'), servico: 'NfeConsultaProtocolo', corpo: montarConsSit(tp, n.chave), cred })
    const c = lerRetornoConsulta(r.body)
    if (c.cancelada && n.status === 'autorizada') {
      const proc = trecho(r.body, 'procEventoNFe')
      const { error } = await sb().rpc('nfe_registrar_cancelamento', { p_id: n.id, p_loja: lojaId, p_protocolo: c.protocolo, p_dh: null, p_justificativa: 'Cancelamento confirmado na consulta', p_xml: proc, p_xml_retorno: r.body.slice(0, 200000), p_user: u.id, p_user_nome: u.nome })
      if (error) return { error: msgBanco(error), id: n.id }
      return { ok: true, id: n.id, status: 'cancelada', mensagem: 'A SEFAZ informa que esta NF-e está cancelada.' }
    }
    return gravarResultado(n, c, r.body, 'consulta', u)
  } catch (e) {
    return { error: `Não foi possível consultar agora: ${e instanceof Error ? e.message : e}`, id: n.id }
  }
}

// ------------------------------------------------------------------------------------------------ cancelar e CC-e
export async function cancelarNfe(lojaId: number, nfeId: number, justificativa: string, u: Usuario): Promise<ResultadoNfe> {
  const erroJ = validarJustificativa(justificativa)
  if (erroJ) return { error: erroJ }
  const { data: chk, error: ec } = await sb().rpc('nfe_checar_evento', { p_id: nfeId, p_loja: lojaId, p_tipo: 'cancelamento' })
  if (ec) return { error: msgBanco(ec), id: nfeId }
  const n = (await linha(lojaId, nfeId))!
  if (!dentroDoPrazoCancelamento(n.dh_recbto)) return { error: 'Passou o prazo de cancelamento (24 horas da autorização). Fale com o contador (NF-e de entrada do fornecedor ou estorno).', id: n.id }
  const c = chk as { chave: string; protocolo: string; tp_amb: number }
  const emit = await carregarEmitente(lojaId)
  if ('error' in emit) return emit
  const cred = await credencial(lojaId, emit.dados.cnpj)
  if ('error' in cred) return cred
  const tp = c.tp_amb as TpAmb
  if (tp === 1 && tpAmbDaNfe() !== 1) return { error: PRODUCAO_DESLIGADA, id: nfeId }
  let ev
  try { ev = montarEventoCancelamento({ chave: c.chave, tpAmb: tp, protocolo: c.protocolo, justificativa }) } catch (e) { return { error: e instanceof Error ? e.message : String(e), id: n.id } }
  const assinado = assinarEventoNfe(ev.xml, ev.id, cred.certPem, cred.keyPem)
  let body: string
  try {
    body = (await postSefaz({ url: urlServico(emit.uf, tp, 'RecepcaoEvento'), servico: 'RecepcaoEvento', corpo: montarEnvEvento(assinado, `${n.id}1`), cred })).body
  } catch (e) {
    return { error: `Não foi possível falar com a SEFAZ (${e instanceof Error ? e.message : e}). Depois use "Consultar na SEFAZ" para ver se o cancelamento entrou.`, id: n.id }
  }
  const r = lerRetornoEvento(body)
  if (r.registrado && r.retEvento) {
    const { error } = await sb().rpc('nfe_registrar_cancelamento', {
      p_id: n.id, p_loja: lojaId, p_protocolo: r.protocolo, p_dh: r.dhRegEvento, p_justificativa: justificativa.trim(),
      p_xml: montarProcEvento(assinado, r.retEvento), p_xml_retorno: body.slice(0, 200000), p_user: u.id, p_user_nome: u.nome,
    })
    if (error) return { error: `Cancelada na SEFAZ, mas não foi possível gravar: ${msgBanco(error)}. Use "Consultar na SEFAZ".`, id: n.id }
    return { ok: true, id: n.id, status: 'cancelada', mensagem: `NF-e nº ${n.numero} cancelada (protocolo ${r.protocolo}).` }
  }
  if (r.cStat === '573') return consultarNfe(lojaId, n.id, u) // já estava cancelada: confirma pela consulta
  await sb().rpc('nfe_registrar_erro', { p_id: n.id, p_loja: lojaId, p_mensagem: `Cancelamento recusado: ${mensagemSefaz(r.cStat, r.xMotivo)}`, p_user: u.id, p_user_nome: u.nome })
  return { error: `A SEFAZ recusou o cancelamento: ${mensagemSefaz(r.cStat, r.xMotivo)}`, id: n.id }
}

export async function corrigirNfe(lojaId: number, nfeId: number, correcao: string, u: Usuario): Promise<ResultadoNfe> {
  const erroC = validarCorrecao(correcao)
  if (erroC) return { error: erroC }
  const { data: chk, error: ec } = await sb().rpc('nfe_checar_evento', { p_id: nfeId, p_loja: lojaId, p_tipo: 'carta de correção' })
  if (ec) return { error: msgBanco(ec), id: nfeId }
  const c = chk as { chave: string; tp_amb: number; cce_seq: number }
  const emit = await carregarEmitente(lojaId)
  if ('error' in emit) return emit
  const cred = await credencial(lojaId, emit.dados.cnpj)
  if ('error' in cred) return cred
  const tp = c.tp_amb as TpAmb
  if (tp === 1 && tpAmbDaNfe() !== 1) return { error: PRODUCAO_DESLIGADA, id: nfeId }
  const seq = num(c.cce_seq) + 1
  const ev = montarEventoCce({ chave: c.chave, tpAmb: tp, seq, correcao })
  const assinado = assinarEventoNfe(ev.xml, ev.id, cred.certPem, cred.keyPem)
  let body: string
  try {
    body = (await postSefaz({ url: urlServico(emit.uf, tp, 'RecepcaoEvento'), servico: 'RecepcaoEvento', corpo: montarEnvEvento(assinado, `${nfeId}${seq}`), cred })).body
  } catch (e) { return { error: `Não foi possível falar com a SEFAZ: ${e instanceof Error ? e.message : e}`, id: nfeId } }
  const r = lerRetornoEvento(body)
  if (!r.registrado || !r.retEvento) {
    await sb().rpc('nfe_registrar_erro', { p_id: nfeId, p_loja: lojaId, p_mensagem: `CC-e recusada: ${mensagemSefaz(r.cStat, r.xMotivo)}`, p_user: u.id, p_user_nome: u.nome })
    return { error: `A SEFAZ recusou a carta de correção: ${mensagemSefaz(r.cStat, r.xMotivo)}`, id: nfeId }
  }
  const { error } = await sb().rpc('nfe_registrar_cce', {
    p_id: nfeId, p_loja: lojaId, p_seq: seq, p_texto: correcao.trim(), p_protocolo: r.protocolo, p_xml: montarProcEvento(assinado, r.retEvento),
    p_xml_retorno: body.slice(0, 200000), p_user: u.id, p_user_nome: u.nome,
  })
  if (error) return { error: `CC-e registrada na SEFAZ, mas não foi possível gravar: ${msgBanco(error)}`, id: nfeId }
  return { ok: true, id: nfeId, status: 'autorizada', mensagem: `Carta de correção nº ${seq} registrada (protocolo ${r.protocolo}).` }
}

export async function descartarNfe(lojaId: number, nfeId: number, motivo: string | null, u: Usuario): Promise<ResultadoNfe> {
  const { data, error } = await sb().rpc('nfe_descartar', { p_id: nfeId, p_loja: lojaId, p_user: u.id, p_user_nome: u.nome, p_motivo: motivo })
  if (error) return { error: msgBanco(error), id: nfeId }
  const r = data as { numero_livre?: number }
  return { ok: true, id: nfeId, status: 'descartada', mensagem: `NF-e descartada${r.numero_livre ? `: o número ${r.numero_livre} volta para a próxima emissão` : ''}.` }
}
