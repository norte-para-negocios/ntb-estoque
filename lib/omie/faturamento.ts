import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest } from './client'
import type { LojaOmie } from './client'
import { buscarFatCupons } from '@/lib/faturamento-frio'

// Faturamento via API (cupom fiscal / NFC-e do PDV) -> faturamento_importado.
// Mesma lógica de scripts/sync-faturamento-api.mjs, compartilhada entre a rota
// manual (/api/sync/faturamento, botão "Atualizar") e o cron
// (/api/cron/sync-faturamento). Só tipo/família: forma_pgto continua vindo só
// do import manual do FAT_DRV (não existe pela API do Omie).

export const TIPO_NOME: Record<string, string> = {
  '00': 'Mercadoria p/ revenda', '01': 'Matéria-prima', '02': 'Embalagem', '03': 'Produto em processo',
  '04': 'Produto acabado', '05': 'Subproduto', '06': 'Produto intermediário', '07': 'Uso e consumo',
  '08': 'Ativo imobilizado', '09': 'Serviços', '10': 'Outros insumos', '99': 'Outras',
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()

type CupomItem = {
  idProduto?: number
  vItem?: number
  vUnit?: number
  nQuant?: number
  vDesc?: number
  vAcresc?: number
  cItemCancelado?: string
  cCupomCancelado?: string
  idItem?: number
  nSequencia?: number
  cCFOP?: string
  cNCM?: string
  xProd?: string
}
type CupomPagamento = {
  nSequencia?: number
  cTipoDoc?: string
  nValorDocumento?: number
  cCategoria?: string
  idContaCorrente?: number
}
type Cupom = {
  cabecalhoCupom?: {
    info?: { cCupomCancelado?: string; cCupomDevolvido?: string }
    nIdCupom?: number
    cChaveCupom?: string
    dDtEmissaoCupom?: string
    cHrEmissaoCupom?: string
    nNumCupom?: number
    nSerieCupom?: number
    seqCaixa?: number
    idCliente?: number
    idVendedor?: number
    nValorCupom?: number
  }
  itensCupom?: CupomItem[]
  pagamentosCupom?: CupomPagamento[]
}
type CuponsResposta = { nTotPaginas?: number; cupons?: Cupom[] }

type CupomBulkRow = {
  n_id_cupom: number; chave: string | null; data: string; hora: string | null
  num: string | null; serie: string | null; seq_caixa: number | null
  id_cliente: number | null; id_vendedor: number | null; valor: number
  cancelado: boolean; devolvido: boolean
}
type ItemBulkRow = {
  id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null
  ncm: string | null; quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null
}
type PagamentoBulkRow = {
  n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number
  categoria: string | null; id_conta_corrente: number | null
}

// Tamanho de lote pro POST em /fat_cupons_bulk. Um mes cheio (2000+ cupons,
// ~10 itens/cupom) gera payload JSON de vários MB e estoura o limite de
// body do Express (2mb) -- descoberto rodando a sync real via UI (413
// Payload Too Large, engolido silenciosamente pelo catch abaixo). Envia em
// pedacos de cupons (com os itens/pagamentos correspondentes) em vez de um
// POST único por mês.
const LOTE_CUPONS = 200

// Envia o fato (cupom+itens+pagamentos) pro Contabo, em lotes. Nao lanca
// erro se o Contabo falhar -- mesma filosofia de buscarFrio
// (historico-contabo.ts): o pre-agregado do Supabase, que sustenta a tela
// hoje, nunca pode quebrar por causa do fato novo.
async function gravarFatoNoFrio(lojaId: number, cupons: CupomBulkRow[], itens: ItemBulkRow[], pagamentos: PagamentoBulkRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !cupons.length) return
  for (let i = 0; i < cupons.length; i += LOTE_CUPONS) {
    const loteCupons = cupons.slice(i, i + LOTE_CUPONS)
    const idsLote = new Set(loteCupons.map((c) => c.n_id_cupom))
    const loteItens = itens.filter((it) => idsLote.has(it.n_id_cupom))
    const lotePagamentos = pagamentos.filter((p) => idsLote.has(p.n_id_cupom))
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${url}/fat_cupons_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
        body: JSON.stringify({ loja_id: lojaId, cupons: loteCupons, itens: loteItens, pagamentos: lotePagamentos }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    } catch (e) {
      console.error('faturamento: falha ao gravar fato no Contabo', e)
    }
  }
}

// Marca 1 cupom como cancelado no fato do Contabo (UPDATE pontual, não bulk
// upsert). Endpoint novo na ntb-frio-api (server.js, fora deste repo git):
// `POST /fat_cupons_marcar_cancelado`, aceita `{ loja_id, n_id_cupom }`, faz
// exatamente `UPDATE fat_cupons SET cancelado=true WHERE loja_id=$1 AND
// n_id_cupom=$2 AND cancelado=false` e responde `{ ok: true, atualizado:
// boolean }` -- já testado manualmente (cupom inexistente => atualizado:
// false, sem erro). Usado pela reconciliação de cupom sumido dentro do loop
// de meses de syncFaturamento (achado real 2026-08-10, ver comentário lá).
// Mesma filosofia de gravarFatoNoFrio: nunca lança exceção, só loga --
// falha de rede/timeout no lado do Contabo não pode quebrar a sync.
async function atualizarCanceladoNoFrio(lojaId: number, nIdCupom: number): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const resp = await fetch(`${url}/fat_cupons_marcar_cancelado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, n_id_cupom: nIdCupom }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('faturamento: falha ao marcar cupom sumido como cancelado', e)
  }
}

/**
 * Repuxa o faturamento (dimensões tipo/família) do ano corrente até o mês atual,
 * direto dos cupons fiscais do Omie, e substitui as linhas dessas 2 dimensões em
 * `faturamento_importado` para a loja. Retorna quantas linhas agregadas gravou.
 */
export async function syncFaturamento(loja: LojaOmie, opts?: { importadoPor?: string }): Promise<number> {
  const supabase = createServiceClient()

  // Mapa produto: codigo_produto -> { tipo, familia }. O PostgREST/Supabase
  // corta silenciosamente em 1000 linhas por padrão (sem erro) -- lojas com
  // mais de 1000 produtos cadastrados perdiam parte do catalogo aqui e todo
  // produto fora da primeira pagina virava "Produto nao identificado"
  // (achado real: loja com 2693 produtos so via os 1000 primeiros). Pagina
  // com .range ate esgotar.
  const prods: { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; codigo: string | null; descricao: string | null }[] = []
  for (let pagina = 0; ; pagina++) {
    const from = pagina * 1000
    const { data } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia, codigo, descricao')
      .eq('loja_id', loja.id)
      .range(from, from + 999)
    if (!data?.length) break
    prods.push(...data)
    if (data.length < 1000) break
  }
  const mapProd = new Map<number, { tipo: string | null; familia: string | null; nome: string }>()
  for (const p of prods ?? []) {
    mapProd.set(Number(p.codigo_produto), {
      tipo: p.tipo_item as string | null,
      familia: p.descricao_familia as string | null,
      nome: (p.descricao as string | null) || (p.codigo as string | null) || String(p.codigo_produto),
    })
  }

  const ano = new Date().getFullYear()
  const mesAtual = new Date().getMonth() + 1

  // acc[JSON.stringify([dimensao, rotulo, mes])] = valor -- JSON em vez de um
  // separador tipo "|" porque rotulo vem de descricao de produto sem
  // sanitizacao (achado real: loja com "JOHNNIE WALKER | BLACK" no catalogo
  // colidia com outro mes pelo split quebrado, gerando duplicate key em
  // faturamento_importado). JSON.stringify escapa qualquer caractere que
  // apareca no rotulo, sem essa classe de bug.
  const acc = new Map<string, number>()
  const add = (dimensao: string, rotulo: string, mes: string, valor: number) => {
    if (!valor) return
    const k = JSON.stringify([dimensao, rotulo || 'Sem classificação', mes])
    acc.set(k, (acc.get(k) ?? 0) + valor)
  }

  for (let mes = 1; mes <= mesAtual; mes++) {
    const mm = String(mes).padStart(2, '0')
    const mesISO = `${ano}-${mm}`
    const de = `01/${mm}/${ano}`
    const ate = `${ultimoDia(ano, mes)}/${mm}/${ano}`
    const cuponsBulk: CupomBulkRow[] = []
    const itensBulk: ItemBulkRow[] = []
    const pagamentosBulk: PagamentoBulkRow[] = []
    let pagina = 1
    let totPag = 1
    do {
      const r = await omieRequest<CuponsResposta>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/produtos/cupomfiscalconsultar',
        call: 'CuponsFiscais',
        data: { dDtEmissaoDe: de, dDtEmissaoAte: ate, nPagina: pagina, nRegPorPagina: 50 },
      })
      totPag = r.nTotPaginas ?? 1
      for (const c of r.cupons ?? []) {
        const cab = c.cabecalhoCupom
        const cancelado = cab?.info?.cCupomCancelado === 'S'
        const devolvido = cab?.info?.cCupomDevolvido === 'S'

        // Achado real (revisão final do plano de filtro de Situação,
        // 2026-08-10): antes o `continue` pulava ANTES deste push, então um
        // cupom cancelado nunca entrava em cuponsBulk -- nunca era reenviado
        // pro upsert do fato, ficando travado com o snapshot da primeira
        // sincronização (sempre "Normal") pra sempre, mesmo cancelado de
        // verdade na Omie depois. Movido o push pra antes do continue --
        // agora o UPSERT do servidor (ON CONFLICT (loja_id, n_id_cupom) DO
        // UPDATE) consegue corrigir o status na próxima sync.
        cuponsBulk.push({
          n_id_cupom: Number(cab?.nIdCupom),
          chave: cab?.cChaveCupom ?? null,
          data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : mesISO + '-01',
          hora: cab?.cHrEmissaoCupom ?? null,
          num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
          serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
          seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
          id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
          id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
          valor: Number(cab?.nValorCupom) || 0,
          cancelado,
          devolvido,
        })

        if (cancelado) continue // segue excluindo itens/pagamentos/acc, não mais o cabeçalho

        for (const p of c.pagamentosCupom ?? []) {
          pagamentosBulk.push({
            n_id_cupom: Number(cab?.nIdCupom),
            sequencia: Number(p.nSequencia ?? pagamentosBulk.length + 1),
            tipo_doc: p.cTipoDoc ?? null,
            valor: Number(p.nValorDocumento) || 0,
            categoria: p.cCategoria ?? null,
            id_conta_corrente: p.idContaCorrente != null ? Number(p.idContaCorrente) : null,
          })
        }
        for (const it of c.itensCupom ?? []) {
          if (it.cItemCancelado === 'S' || it.cCupomCancelado === 'S') continue
          itensBulk.push({
            id_item: Number(it.idItem ?? `${cab?.nIdCupom}${it.nSequencia}`),
            n_id_cupom: Number(cab?.nIdCupom),
            id_produto: it.idProduto != null ? Number(it.idProduto) : null,
            cfop: it.cCFOP ?? null,
            ncm: it.cNCM ?? null,
            quant: Number(it.nQuant) || 0,
            v_unit: Number(it.vUnit) || 0,
            v_desc: Number(it.vDesc) || 0,
            v_item: Number(it.vItem) || 0,
            x_prod: it.xProd ?? null,
          })
          const v =
            Number(it.vItem ?? 0) ||
            Number(it.vUnit ?? 0) * Number(it.nQuant ?? 0) - Number(it.vDesc ?? 0) + Number(it.vAcresc ?? 0)
          if (!v) continue

          // Achado real (2026-08-10): cupom devolvido continuava entrando no
          // acumulador pré-agregado (`faturamento_importado`, base do
          // Faturamento x Compras e da visão padrão do Faturamento) -- só
          // `cancelado` era excluído. Hoje não gera número errado (produção
          // não tem nenhum cupom devolvido=true), mas é a mesma classe de
          // guard-clause incompleto já corrigida acima nesta função. Mantém
          // devolvido no fato granular (`itensBulk`, já gravado acima) pra
          // quem usa o filtro de Situação=Devolvido -- só exclui do
          // pré-agregado, que deve refletir apenas venda Normal.
          if (devolvido) continue

          const info = it.idProduto != null ? mapProd.get(Number(it.idProduto)) : undefined
          const tipoLabel = info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado'
          const familiaLabel = info?.familia || 'Sem família'
          const produtoLabel = info?.nome || 'Produto não identificado'
          add('tipo', tipoLabel, mesISO, v)
          add('familia', familiaLabel, mesISO, v)
          add('produto', produtoLabel, mesISO, v)
          // Dimensões compostas pro drill (tipo -> família -> produto). Separador
          // literal '>>' não aparece em nomes do Omie.
          add('tipo>familia', `${tipoLabel}>>${familiaLabel}`, mesISO, v)
          add('familia>produto', `${familiaLabel}>>${produtoLabel}`, mesISO, v)
        }
      }
      pagina++
      // Rate limit do Omie: respeita ~300ms entre leituras.
      if (pagina <= totPag) await sleep(340)
    } while (pagina <= totPag)

    // Reconciliação (achado real 2026-08-10): cupom que some INTEIRAMENTE da
    // consulta da Omie (nem aparece como cancelado -- só não vem mais) fica
    // "fantasma" no fato pra sempre, contando como Normal. syncFaturamento já
    // busca TODOS os cupons do mês a cada run -- reusa esse mesmo fetch
    // (cuponsBulk) pra detectar sumiço sem nenhuma chamada extra à Omie:
    // qualquer n_id_cupom que já existia como não-cancelado no fato desse
    // MESMO loja+mês (mesmo range de datas de/ate acima, nunca ampliado) mas
    // não veio nesta resposta é candidato a sumido. Nunca lança -- reconciliação
    // é best-effort, igual gravarFatoNoFrio.
    try {
      const existentes = await buscarFatCupons({ lojaId: loja.id, dataInicio: `${mesISO}-01`, dataFinal: `${mesISO}-${String(ultimoDia(ano, mes)).padStart(2, '0')}` })
      const idsRetornados = new Set(cuponsBulk.map((c) => c.n_id_cupom))
      const sumidos = existentes.filter((c) => !c.cancelado && !idsRetornados.has(c.n_id_cupom))
      for (const c of sumidos) {
        await atualizarCanceladoNoFrio(loja.id, c.n_id_cupom)
      }
      if (sumidos.length) {
        console.warn(`[faturamento] loja ${loja.id}, ${mesISO}: ${sumidos.length} cupom(ns) sumiram da Omie, marcados cancelado`)
      }
    } catch (e) {
      console.error('faturamento: falha na reconciliação de cupons sumidos', e)
    }

    await gravarFatoNoFrio(loja.id, cuponsBulk, itensBulk, pagamentosBulk)
  }

  // Observabilidade: se uma fatia grande do valor do mes caiu em "nao
  // identificado", provavelmente o catalogo de produtos esta desatualizado
  // (produto novo no PDV ainda nao sincronizado) -- alerta cedo em vez de deixar
  // o numero crescer silenciosamente por meses (ver docs/superpowers/specs/2026-07-18-*).
  const mesCorrenteISO = `${ano}-${String(mesAtual).padStart(2, '0')}`
  const totalMesCorrente = [...acc.entries()]
    .filter(([k]) => {
      const [dimensao, , mes] = JSON.parse(k) as [string, string, string]
      return dimensao === 'produto' && mes === mesCorrenteISO
    })
    .reduce((s, [, v]) => s + v, 0)
  const naoIdentMesCorrente = acc.get(JSON.stringify(['produto', 'Produto não identificado', mesCorrenteISO])) ?? 0
  if (totalMesCorrente > 0 && naoIdentMesCorrente / totalMesCorrente > 0.1) {
    console.warn(
      `[faturamento] loja ${loja.id}: ${((naoIdentMesCorrente / totalMesCorrente) * 100).toFixed(1)}% ` +
      `do faturamento de ${mesCorrenteISO} caiu em "Produto não identificado" (R$ ${naoIdentMesCorrente.toFixed(2)} ` +
      `de R$ ${totalMesCorrente.toFixed(2)}). Provavel produto novo no PDV sem sync do cadastro ainda.`
    )
  }

  // Achado real (auditoria 2026-07-26): o delete apagava TODOS os meses (de
  // qualquer ano) dessas 5 dimensões antes de reinserir só o ano corrente --
  // destruindo permanentemente qualquer mes de ano anterior a cada sync
  // (nao era so uma janela de 90 dias, era "sempre so o ano atual, pra
  // sempre"). O loop acima (`for mes = 1..mesAtual`) so recalcula meses do
  // ANO CORRENTE -- o delete precisa ficar restrito ao mesmo intervalo,
  // senao meses de anos anteriores que um dia venham a ser gravados aqui
  // (backfill futuro) seriam apagados de novo no proximo sync.
  const mesIniAno = `${ano}-01`
  const mesFimAno = `${ano}-${String(mesAtual).padStart(2, '0')}`
  const { error: delErro } = await supabase
    .from('faturamento_importado')
    .delete()
    .eq('loja_id', loja.id)
    .in('dimensao', ['tipo', 'familia', 'produto', 'tipo>familia', 'familia>produto'])
    .gte('mes', mesIniAno)
    .lte('mes', mesFimAno)
  if (delErro) throw new Error(delErro.message)

  const rows = [...acc.entries()].map(([k, valor]) => {
    const [dimensao, rotulo, mes] = JSON.parse(k) as [string, string, string]
    return { loja_id: loja.id, dimensao, rotulo, mes, valor: Number(valor.toFixed(2)) }
  })
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabase.from('faturamento_importado').insert(rows.slice(i, i + 1000))
    if (error) throw new Error(error.message)
  }
  await supabase.from('faturamento_import_meta').upsert({
    loja_id: loja.id,
    importado_em: new Date().toISOString(),
    importado_por: opts?.importadoPor ?? null,
    arquivo: 'API cupom fiscal',
    linhas: rows.length,
  })

  return rows.length
}
