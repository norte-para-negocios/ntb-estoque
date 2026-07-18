import { createServiceClient } from '@/lib/supabase/server'
import { omieRequest } from './client'
import type { LojaOmie } from './client'

// Faturamento via API (cupom fiscal / NFC-e do PDV) -> faturamento_importado.
// Mesma lógica de scripts/sync-faturamento-api.mjs, compartilhada entre a rota
// manual (/api/sync/faturamento, botão "Atualizar") e o cron
// (/api/cron/sync-faturamento). Só tipo/família: forma_pgto continua vindo só
// do import manual do FAT_DRV (não existe pela API do Omie).

const TIPO_NOME: Record<string, string> = {
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
}
type Cupom = {
  cabecalhoCupom?: { info?: { cCupomCancelado?: string } }
  itensCupom?: CupomItem[]
}
type CuponsResposta = { nTotPaginas?: number; cupons?: Cupom[] }

/**
 * Repuxa o faturamento (dimensões tipo/família) do ano corrente até o mês atual,
 * direto dos cupons fiscais do Omie, e substitui as linhas dessas 2 dimensões em
 * `faturamento_importado` para a loja. Retorna quantas linhas agregadas gravou.
 */
export async function syncFaturamento(loja: LojaOmie, opts?: { importadoPor?: string }): Promise<number> {
  const supabase = createServiceClient()

  // Mapa produto: codigo_produto -> { tipo, familia }.
  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, tipo_item, descricao_familia, codigo, descricao')
    .eq('loja_id', loja.id)
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

  // acc["dimensao|rotulo|mes"] = valor
  const acc = new Map<string, number>()
  const add = (dimensao: string, rotulo: string, mes: string, valor: number) => {
    if (!valor) return
    const k = `${dimensao}|${rotulo || 'Sem classificação'}|${mes}`
    acc.set(k, (acc.get(k) ?? 0) + valor)
  }

  for (let mes = 1; mes <= mesAtual; mes++) {
    const mm = String(mes).padStart(2, '0')
    const mesISO = `${ano}-${mm}`
    const de = `01/${mm}/${ano}`
    const ate = `${ultimoDia(ano, mes)}/${mm}/${ano}`
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
        if (c.cabecalhoCupom?.info?.cCupomCancelado === 'S') continue
        for (const it of c.itensCupom ?? []) {
          if (it.cItemCancelado === 'S' || it.cCupomCancelado === 'S') continue
          const v =
            Number(it.vItem ?? 0) ||
            Number(it.vUnit ?? 0) * Number(it.nQuant ?? 0) - Number(it.vDesc ?? 0) + Number(it.vAcresc ?? 0)
          if (!v) continue
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
  }

  // Observabilidade: se uma fatia grande do valor do mes caiu em "nao
  // identificado", provavelmente o catalogo de produtos esta desatualizado
  // (produto novo no PDV ainda nao sincronizado) -- alerta cedo em vez de deixar
  // o numero crescer silenciosamente por meses (ver docs/superpowers/specs/2026-07-18-*).
  const mesCorrenteISO = `${ano}-${String(mesAtual).padStart(2, '0')}`
  const totalMesCorrente = [...acc.entries()]
    .filter(([k]) => k.startsWith('produto|') && k.endsWith(`|${mesCorrenteISO}`))
    .reduce((s, [, v]) => s + v, 0)
  const naoIdentMesCorrente = acc.get(`produto|Produto não identificado|${mesCorrenteISO}`) ?? 0
  if (totalMesCorrente > 0 && naoIdentMesCorrente / totalMesCorrente > 0.1) {
    console.warn(
      `[faturamento] loja ${loja.id}: ${((naoIdentMesCorrente / totalMesCorrente) * 100).toFixed(1)}% ` +
      `do faturamento de ${mesCorrenteISO} caiu em "Produto não identificado" (R$ ${naoIdentMesCorrente.toFixed(2)} ` +
      `de R$ ${totalMesCorrente.toFixed(2)}). Provavel produto novo no PDV sem sync do cadastro ainda.`
    )
  }

  // Substitui só tipo/familia (forma_pgto, quando existe, vem do import manual e fica intacto).
  const { error: delErro } = await supabase
    .from('faturamento_importado')
    .delete()
    .eq('loja_id', loja.id)
    .in('dimensao', ['tipo', 'familia', 'produto', 'tipo>familia', 'familia>produto'])
  if (delErro) throw new Error(delErro.message)

  const rows = [...acc.entries()].map(([k, valor]) => {
    const [dimensao, rotulo, mes] = k.split('|')
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
