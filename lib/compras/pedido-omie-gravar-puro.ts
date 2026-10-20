// C1 (20/10/2026): pedido de compra do NTB gravado no Omie (IncluirPedCompra) nas lojas de estoque Omie.
// Regras puras (montagem do payload, portões, decisão de falha). node --test lib/compras/pedido-omie-gravar-puro.test.ts
// Plano e mapeamento campo a campo: docs/superpowers/plans/2026-10-20-c1-pedido-compra-omie.md.
// Formato do Omie: ~/Projects/omie-rea/endpoints/public-api/stock-and-purchase-detail.md (produtos/pedidocompra).
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { parcelasDoPedido, type Parcela } from './pedido-puro.ts'
// @ts-expect-error: idem
import { bloqueioDaResposta, classificarErroOmie, ehRecusaDoDisjuntor, proximaTentativa } from '../omie/erros-omie.ts'

// ---------------------------------------------------------------------------------------------------------------
// Portões. Nada escreve no Omie sem os DOIS: variável OMIE_GRAVAR_PEDIDOS_COMPRA=1 no servidor E a loja com
// lojas.omie_gravar_pedidos_compra = true (migration 270, padrão false).

export function gravacaoPedidosOmieLigada(env: Record<string, string | undefined>): boolean {
  return env.OMIE_GRAVAR_PEDIDOS_COMPRA === '1'
}

/** Sertão (produção protegida): mesma regra de `bloqueioDeEscrita` (lib/estoque/escrita-omie-puro.ts). */
export const LOJA_BLOQUEADA_PEDIDO_OMIE = 4

export type LojaPedidoOmie = { id: number; modo: string | null; optIn: boolean }

/** null = esta loja pode criar pedido no NTB e gravar no Omie. Senão, o motivo (a ordem importa: env primeiro). */
export function motivoSemGravacaoPedidoOmie(env: Record<string, string | undefined>, loja: LojaPedidoOmie): string | null {
  if (!gravacaoPedidosOmieLigada(env)) return 'Gravação de pedidos de compra no Omie desligada (OMIE_GRAVAR_PEDIDOS_COMPRA).'
  if (loja.modo !== 'omie') return 'Só loja de estoque Omie grava pedido de compra no Omie.'
  if (loja.id === LOJA_BLOQUEADA_PEDIDO_OMIE) return 'A loja 4 (Sertão) está bloqueada para escrita no Omie pela tela.'
  if (!loja.optIn) return 'Esta loja ainda não foi liberada para gravar pedidos de compra no Omie.'
  return null
}

/**
 * Onde o pedido de compra do NTB existe nesta loja. Com OMIE_GRAVAR_PEDIDOS_COMPRA desligada o resultado é o de
 * antes do C1: só 'proprio' (loja Omie = null = telas 404 e ações recusadas). `optIn` só é consultado com a variável
 * ligada (o chamador nem lê a coluna sem ela).
 */
export function pedidoCompraNaLoja(env: Record<string, string | undefined>, loja: LojaPedidoOmie): 'proprio' | 'omie' | null {
  if (loja.modo === 'proprio') return 'proprio'
  return motivoSemGravacaoPedidoOmie(env, loja) == null ? 'omie' : null
}

// ---------------------------------------------------------------------------------------------------------------
// Códigos de integração (idempotência). Derivados só do id do pedido no NTB: a 2ª tentativa manda o MESMO código,
// e o Omie recusa código de integração repetido; antes de incluir de novo, a tentativa consulta por ele.
// cCodIntPed e cCodIntItem têm no máximo 20 caracteres no Omie.

export const PREFIXO_COD_INT = 'NTB-PC-'

export function codigoIntegracaoPedido(pedidoId: number): string {
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) throw new Error(`id de pedido inválido: ${pedidoId}`)
  return `${PREFIXO_COD_INT}${pedidoId}`
}

export function codigoIntegracaoItem(pedidoId: number, linha: number): string {
  return `${pedidoId}-${linha}`
}

/** Id do pedido do NTB a partir do cCodIntPed (pedidos lidos do Omie); null quando o pedido não veio do NTB. */
export function pedidoNtbDoCodigo(cCodIntPed: string | null | undefined): number | null {
  const m = /^NTB-PC-(\d{1,13})$/.exec((cCodIntPed ?? '').trim())
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------------------------------------------------------
// Montagem do IncluirPedCompra.

export type ItemPedidoOmie = {
  linha: number
  codigoProduto: number
  descricao: string
  unidade: string | null
  /** unidades de estoque por unidade do pedido */
  fator: number
  /** na unidade do pedido */
  quantidade: number
  /** por unidade do pedido */
  precoUnitario: number
  codigoLocal: number | null
  obs: string | null
  /** cadastro local (espelho do Omie) */
  produto: { existe: boolean; inativo: boolean } | null
}

export type PedidoParaOmie = {
  id: number
  numero: number
  etapa: string
  previsaoEntrega: string | null
  frete: number
  outrasDespesas: number
  parcelas: Parcela[]
  numeroFornecedor: string | null
  contato: string | null
  obs: string | null
  obsInterna: string | null
  fornecedor: { id: number | null; nome: string; cnpj: string | null; codigoOmie: number | null; origem: string | null }
  itens: ItemPedidoOmie[]
}

export type ConfigPedidoOmie = {
  /** lojas.omie_pedido_categoria (ex. "2.01.01"); vazio = categoria padrão do Omie */
  categoria: string | null
  /** lojas.omie_pedido_email_aprovador: com ele o Omie já cria o pedido aprovado */
  emailAprovador: string | null
  /** codigo_local_estoque dos locais do espelho (local_estoques da loja) */
  locais: number[]
}

export type CabecalhoIncluir = {
  cCodIntPed: string
  dDtPrevisao: string
  nCodFor?: number
  cCnpjCpfFor?: string
  cCodCateg?: string
  cContato?: string
  cNumPedido?: string
  cObs?: string
  cObsInt: string
  cCodParc?: string
  nQtdeParc?: number
  cEmailAprovador?: string
}
export type ProdutoIncluir = { cCodIntItem: string; nCodProd: number; nQtde: number; nValUnit: number; codigo_local_estoque?: number; cObs?: string }
export type ParcelaIncluir = { nParcela: number; dVencto: string; nValor: number; nDias: number; nPercent: number }
export type FreteIncluir = { nValFrete: number; nValOutras: number }
export type IncluirPedCompra = {
  cabecalho_incluir: CabecalhoIncluir
  frete_incluir?: FreteIncluir
  produtos_incluir: ProdutoIncluir[]
  parcelas_incluir?: ParcelaIncluir[]
}

/** Primeiro código próprio do NTB (seq_fornecedor_proprio, migration 182): não existe no Omie. */
export const CODIGO_PROPRIO_MINIMO = 8_000_000_000_001

const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas
const corta = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').trim()
  return t ? t.slice(0, max) : undefined
}

/** aaaa-mm-dd → dd/mm/aaaa (o formato de data da API do Omie). */
export function dataParaOmie(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** O fornecedor tem código do Omie de verdade (sincronizado do Omie, fora da faixa própria e não veio de planilha)? */
export function codigoOmieDoFornecedor(f: PedidoParaOmie['fornecedor']): number | null {
  const c = Number(f.codigoOmie)
  if (!Number.isSafeInteger(c) || c <= 0 || c >= CODIGO_PROPRIO_MINIMO) return null
  if (f.origem && f.origem !== 'omie') return null
  return c
}

/**
 * Payload do IncluirPedCompra, ou a lista do que falta no NTB para gravar (nada vai ao Omie nesse caso).
 * Quantidade e preço vão em UNIDADE DE ESTOQUE (quantidade × fator, preço ÷ fator): é a unidade do cadastro do
 * produto no Omie, a mesma que o recebimento da NF-e confere. A unidade do pedido do NTB (caixa, fardo) fica na
 * observação do item.
 */
export function montarIncluirPedCompra(p: PedidoParaOmie, cfg: ConfigPedidoOmie): { payload: IncluirPedCompra } | { erros: string[] } {
  const erros: string[] = []
  if (p.etapa !== 'aprovado') erros.push(`Só pedido aprovado vai ao Omie (etapa atual: ${p.etapa}).`)
  const previsao = dataParaOmie(p.previsaoEntrega)
  if (!previsao) erros.push('Informe a previsão de entrega: o Omie exige a data no pedido de compra.')

  const codFor = codigoOmieDoFornecedor(p.fornecedor)
  const cnpj = (p.fornecedor.cnpj ?? '').replace(/\D/g, '')
  if (!codFor && cnpj.length !== 11 && cnpj.length !== 14) {
    erros.push(`O fornecedor "${p.fornecedor.nome}" não tem cadastro no Omie (escolha um fornecedor sincronizado do Omie ou informe o CNPJ).`)
  }

  if (!p.itens.length) erros.push('O pedido não tem itens.')
  if (p.itens.length > 300) erros.push('No máximo 300 itens por pedido.')
  const locais = new Set(cfg.locais.map(Number))
  const produtos: ProdutoIncluir[] = []
  for (const it of [...p.itens].sort((a, b) => a.linha - b.linha)) {
    const rot = `Item ${it.linha} (${it.descricao || it.codigoProduto})`
    if (!it.produto?.existe) erros.push(`${rot}: produto não está no cadastro do Omie desta loja.`)
    else if (it.produto.inativo) erros.push(`${rot}: produto inativo no Omie.`)
    const fator = Number(it.fator) || 1
    if (!(fator > 0)) erros.push(`${rot}: fator de conversão inválido.`)
    if (!(Number(it.quantidade) > 0)) erros.push(`${rot}: quantidade precisa ser maior que zero.`)
    if (!(Number(it.precoUnitario) >= 0)) erros.push(`${rot}: preço inválido.`)
    if (it.codigoLocal != null && !locais.has(Number(it.codigoLocal))) erros.push(`${rot}: local de estoque ${it.codigoLocal} não existe no Omie desta loja.`)
    const obsUnidade = fator !== 1 ? `${arred(it.quantidade, 6)} ${it.unidade ?? 'un.'} (1 ${it.unidade ?? 'un.'} = ${arred(fator, 6)})` : null
    const obs = [obsUnidade, it.obs?.trim() || null].filter(Boolean).join(' · ')
    produtos.push({
      cCodIntItem: codigoIntegracaoItem(p.id, it.linha),
      nCodProd: it.codigoProduto,
      nQtde: arred(it.quantidade * fator, 6),
      nValUnit: fator === 1 ? arred(it.precoUnitario, 6) : arred(it.precoUnitario / fator, 6),
      ...(it.codigoLocal != null ? { codigo_local_estoque: Number(it.codigoLocal) } : {}),
      ...(obs ? { cObs: obs } : {}),
    })
  }

  const categoria = corta(cfg.categoria, 20)
  if (categoria && !/^[0-9.]+$/.test(categoria)) erros.push(`Categoria de compra da loja inválida: "${categoria}".`)
  if ((Number(p.frete) || 0) < 0 || (Number(p.outrasDespesas) || 0) < 0) erros.push('Frete e outras despesas não podem ser negativos.')
  if (erros.length) return { erros }

  const mercadorias = arred(p.itens.reduce((a, i) => a + i.quantidade * i.precoUnitario, 0), 2)
  const total = arred(mercadorias + (Number(p.frete) || 0) + (Number(p.outrasDespesas) || 0), 2)
  const parcelas = parcelasDoPedido(p.parcelas ?? [], total, p.previsaoEntrega)

  const cab: CabecalhoIncluir = {
    cCodIntPed: codigoIntegracaoPedido(p.id),
    dDtPrevisao: previsao!,
    ...(codFor ? { nCodFor: codFor } : { cCnpjCpfFor: cnpj }),
    ...(categoria ? { cCodCateg: categoria } : {}),
    ...(corta(p.contato, 100) ? { cContato: corta(p.contato, 100) } : {}),
    ...(corta(p.numeroFornecedor, 30) ? { cNumPedido: corta(p.numeroFornecedor, 30) } : {}),
    ...(corta(p.obs, 4000) ? { cObs: corta(p.obs, 4000) } : {}),
    cObsInt: [`Pedido de compra nº ${p.numero} do Norte Estoque (${codigoIntegracaoPedido(p.id)}).`, p.obsInterna?.trim() || null].filter(Boolean).join(' ').slice(0, 4000),
    ...(parcelas.length ? { cCodParc: '999', nQtdeParc: parcelas.length } : {}),
    ...(corta(cfg.emailAprovador, 120) ? { cEmailAprovador: corta(cfg.emailAprovador, 120) } : {}),
  }
  const payload: IncluirPedCompra = { cabecalho_incluir: cab, produtos_incluir: produtos }
  const frete = arred(Number(p.frete) || 0, 2)
  const outras = arred(Number(p.outrasDespesas) || 0, 2)
  if (frete > 0 || outras > 0) payload.frete_incluir = { nValFrete: frete, nValOutras: outras }
  if (parcelas.length) {
    payload.parcelas_incluir = parcelas.map((x) => ({
      nParcela: x.numero, dVencto: dataParaOmie(x.vencimento)!, nValor: x.valor, nDias: x.dias, nPercent: x.percentual,
    }))
  }
  return { payload }
}

// ---------------------------------------------------------------------------------------------------------------
// Respostas e falhas.

export type RespostaIncluirPed = { nCodPed?: number | string; cCodIntPed?: string; cCodStatus?: string; cDescStatus?: string; cNumero?: string }

/** nCodPed do Omie quando a inclusão deu certo, senão null. */
export function pedidoIncluido(r: RespostaIncluirPed | null | undefined): { nCodPed: number; numero: string | null } | null {
  const n = Number(r?.nCodPed)
  if (!Number.isFinite(n) || n === 0) return null
  return { nCodPed: n, numero: (r?.cNumero ?? '').toString().trim() || null }
}

/** O Omie diz que o código de integração já existe: o pedido já foi gravado numa tentativa anterior. */
export function ehPedidoJaExiste(msg: string): boolean {
  return /j. (existe|est. cadastrad|foi cadastrad|cadastrad).*(integra|cCodIntPed|pedido)/i.test(msg)
}

/** Consulta por cCodIntPed que não achou o pedido (então é seguro incluir). Hipótese a confirmar no 1º teste. */
export function ehPedidoNaoEncontrado(msg: string): boolean {
  return /n.o (existem registros|encontrad|cadastrad|localizad)|inexistente/i.test(msg)
}

export type StatusEnvio = 'pendente' | 'enviando' | 'enviado' | 'precisa_corrigir'

/** Erro desconhecido/permanente: 3 tentativas; transitório: 8 (10, 20, 40, 80, 120... min). Bloqueio não conta. */
export const TETO_PERMANENTE = 3
export const TETO_TRANSITORIO = 8

export type DecisaoFalhaPedido = { status: 'pendente' | 'precisa_corrigir'; tentativas: number; proximaTentativaEm: string | null; erro: string; contaTentativa: boolean }

/**
 * O que gravar quando o IncluirPedCompra/ConsultarPedCompra falha. Nunca repete em laço: toda falha que conta
 * espaça a próxima tentativa (proximaTentativa) e tem teto; recusa do nosso disjuntor ou bloqueio do Omie não conta
 * tentativa (não é culpa do pedido) e espera o bloqueio passar. 10 erros no mesmo método = 30 min de bloqueio da chave.
 */
export function decidirFalhaPedido(msg: string, faultCode: string | undefined, tentativas: number, agoraMs: number = Date.now()): DecisaoFalhaPedido {
  const erro = (msg || 'Falha desconhecida').slice(0, 500)
  const seg = bloqueioDaResposta(msg, faultCode)
  if (ehRecusaDoDisjuntor(msg) || seg != null) {
    const espera = Math.max(seg ?? 900, 600)
    return { status: 'pendente', tentativas, proximaTentativaEm: new Date(agoraMs + espera * 1000).toISOString(), erro, contaTentativa: false }
  }
  const n = tentativas + 1
  const tipo = classificarErroOmie(msg)
  const teto = tipo === 'transitorio' ? TETO_TRANSITORIO : TETO_PERMANENTE
  if (n >= teto) return { status: 'precisa_corrigir', tentativas: n, proximaTentativaEm: null, erro, contaTentativa: true }
  return { status: 'pendente', tentativas: n, proximaTentativaEm: proximaTentativa(n, agoraMs), erro, contaTentativa: true }
}

// ---------------------------------------------------------------------------------------------------------------
// Etapas do NTB × gravação no Omie.

/** Mudança de etapa recusada porque o pedido já está (ou pode estar) no Omie. A migration 270 tem o mesmo gatilho. */
export function bloqueioEtapaPorOmie(acao: string, statusOmie: StatusEnvio | null | undefined, numeroOmie?: string | null): string | null {
  if (!['reabrir', 'cancelar'].includes(acao)) return null
  if (statusOmie === 'enviando') return 'Este pedido está sendo gravado no Omie agora. Tente de novo em instantes.'
  if (statusOmie === 'enviado') return `Este pedido já está no Omie${numeroOmie ? ` (nº ${numeroOmie})` : ''}: altere ou cancele lá. O NTB ainda não altera nem exclui pedido no Omie.`
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Filtros da fila (PostgREST `or`), compartilhados pelo código e pelo teste com PostgREST local
// (scripts/testes-sql/270_fila_postgrest.sh). Datas entre aspas: o ISO tem ":" e ".".

/** 'enviando' parado há mais que isso = tentativa morta no meio: reivindica e CONSULTA antes de incluir. */
export const ENVIANDO_TRAVADO_MS = 60 * 60_000
/** Botão "Enviar agora": no máximo 1 tentativa a cada 2 min por pedido. */
export const INTERVALO_MANUAL_MS = 2 * 60_000

/** Condição extra para reivindicar um pedido 'pendente' (além de status = pendente). */
export function filtroReivindicarPendente(agoraMs: number, manual: boolean): string {
  return manual
    ? `ultima_tentativa_em.is.null,ultima_tentativa_em.lte."${new Date(agoraMs - INTERVALO_MANUAL_MS).toISOString()}"`
    : `proxima_tentativa_em.is.null,proxima_tentativa_em.lte."${new Date(agoraMs).toISOString()}"`
}

/** Fila do cron: pendente na hora, ou 'enviando' esquecido. */
export function filtroFilaCron(agoraMs: number): string {
  const agora = new Date(agoraMs).toISOString()
  const travado = new Date(agoraMs - ENVIANDO_TRAVADO_MS).toISOString()
  return `and(status.eq.pendente,or(proxima_tentativa_em.is.null,proxima_tentativa_em.lte."${agora}")),and(status.eq.enviando,ultima_tentativa_em.lt."${travado}")`
}
