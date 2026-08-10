// Leitura do fato de faturamento por cupom, gravado no Contabo (sem cópia
// no Supabase -- Faturamento nunca teve janela quente, ver spec
// docs/superpowers/specs/2026-07-18-faturamento-fato-cupom-design.md).
// Mesmo espirito de lib/relatorio-frio-nf.ts: um modulo por dominio de
// leitura fria, sempre via buscarFrio.
import { buscarFrio, buscarFrioTudo } from '@/lib/historico-contabo'
import { TIPO_NOME } from '@/lib/omie/faturamento'

export type LinhaFatAgregado = { rotulo: string; mes?: string; valor: number; qtde_itens: number }

export async function buscarFatAgregado(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  group: 'dia' | 'forma' | 'produto'
  group2?: 'mes'
}): Promise<LinhaFatAgregado[]> {
  const rows = (await buscarFrio<{ rotulo: string; mes?: string; valor: string | number; qtde_itens: string | number }>(
    '/fat_agregado',
    { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal, group: opts.group, group2: opts.group2 },
  )) ?? []
  return rows.map((r) => ({ rotulo: String(r.rotulo), mes: r.mes, valor: Number(r.valor) || 0, qtde_itens: Number(r.qtde_itens) || 0 }))
}

export type CupomFat = {
  n_id_cupom: number; chave: string | null; data: string; hora: string | null
  num: string | null; serie: string | null; valor: number; cancelado: boolean; devolvido: boolean
}

// Achado real (auditoria movimentacao-operacao-auto, 2026-07-19): /fat_cupons
// (limit 5000) e /fat_cupom_itens (limit 20000) no servidor cortavam em
// silencio pra qualquer loja com historico de 1 ano -- loja 5 sozinha tem
// 31038 cupons e 213669 itens desde 01/07/2025 (so ~16%/9% vinha antes do
// fix). Servidor ganhou suporte a `offset` (mesmo padrao de /notas_fiscais);
// client agora pagina igual aos outros dominios frios.
export async function buscarFatCupons(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<CupomFat[]> {
  const rows = await buscarFrioTudo<CupomFat & { valor: string | number }>('/fat_cupons', {
    loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal,
  }, 5000)
  return rows.map((r) => ({ ...r, valor: Number(r.valor) || 0 }))
}

export async function buscarFatCupomItens(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<ItemFat[]> {
  const rows = await buscarFrioTudo<ItemFat & { quant: string | number; v_unit: string | number; v_desc: string | number; v_item: string | number }>(
    '/fat_cupom_itens', { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal }, 20000,
  )
  return rows.map((i) => ({ ...i, quant: Number(i.quant) || 0, v_unit: Number(i.v_unit) || 0, v_desc: Number(i.v_desc) || 0, v_item: Number(i.v_item) || 0 }))
}

// Busca em lote (nao 1 cupom por vez) -- mesmo padrao de buscarFatCupomItens.
export async function buscarFatCupomPagamentosPeriodo(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<PagamentoFat[]> {
  const rows = await buscarFrioTudo<PagamentoFat & { valor: string | number }>(
    '/fat_cupom_pagamentos', { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal }, 20000,
  )
  return rows.map((p) => ({ ...p, valor: Number(p.valor) || 0 }))
}

export type ItemFat = {
  id_item: number; n_id_cupom: number; id_produto: number | null; cfop: string | null; ncm: string | null
  quant: number; v_unit: number; v_desc: number; v_item: number; x_prod: string | null
}
export type PagamentoFat = {
  n_id_cupom: number; sequencia: number; tipo_doc: string | null; valor: number
  categoria: string | null; id_conta_corrente: number | null
}

export type LinhaMatrizFrio = { rotulo: string; mes: string; valor: number }

// Reagrega o fato de faturamento (Contabo) por tipo/familia, cruzando com o
// cadastro de produtos LOCAL (Contabo nao pode duplicar `produtos` -- mesmo
// motivo documentado em lib/historico-contabo.ts pra agregarMovimentacaoJS).
// Usada quando o periodo pedido cruza pra antes do ano corrente -- sem isso,
// as abas Tipo/Familia perdiam silenciosamente qualquer mes de ano anterior
// (achado real, auditoria 2026-07-26: `faturamento_importado` so guarda o
// ano corrente -- ver comentario em lib/omie/faturamento.ts -- e a tela
// nunca completava com o Contabo nessas abas; loja 5 mostrava R$4,99M em vez
// de R$9,78M reais na aba Tipo com periodo "Todos").
function agregarFaturamentoPorTipoFamilia(
  itens: ItemFat[],
  mesPorCupom: Map<number, string>,
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null; nome?: string }>,
  dim: 'tipo' | 'familia' | 'tipo>familia' | 'familia>produto'
): LinhaMatrizFrio[] {
  const acc = new Map<string, LinhaMatrizFrio>()
  for (const it of itens) {
    const mes = mesPorCupom.get(it.n_id_cupom)
    if (!mes) continue
    // Mesmo fallback de lib/omie/faturamento.ts (syncFaturamento): v_item cru
    // pode vir zerado do Omie em casos raros; recalcula a partir de
    // unit*qtde-desconto quando isso acontece.
    const v = it.v_item || (it.v_unit * it.quant - it.v_desc)
    if (!v) continue
    const info = it.id_produto != null ? metaPorCodigo.get(Number(it.id_produto)) : undefined
    const tipoLabel = info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado'
    const familiaLabel = info?.familia || 'Sem família'
    const produtoLabel = info?.nome || 'Produto não identificado'
    // Separador literal '>>' -- mesmo usado pela ingestao (lib/omie/faturamento.ts,
    // add('tipo>familia', ...)/add('familia>produto', ...)) pro drill do
    // pre-agregado casar com o mesmo formato aqui.
    const rotulo =
      dim === 'tipo' ? tipoLabel :
      dim === 'familia' ? familiaLabel :
      dim === 'tipo>familia' ? `${tipoLabel}>>${familiaLabel}` :
      `${familiaLabel}>>${produtoLabel}`
    const chave = `${rotulo}|${mes}`
    const ent = acc.get(chave) ?? { rotulo, mes, valor: 0 }
    ent.valor += v
    acc.set(chave, ent)
  }
  return [...acc.values()]
}

// Ponto de entrada pro complemento historico das abas Tipo/Familia/Produto do
// relatorio de Faturamento -- chamado so quando o periodo pedido cruza pra
// antes do ano corrente (ver app/(app)/relatorio-faturamento/page.tsx).
// Produto delega pro agregado do servidor (nao precisa cruzar tipo/familia),
// mas AINDA precisa de `produtos` local pra resolver `id_produto` (rotulo cru
// que o /fat_agregado devolve, ver docs/superpowers/specs/2026-07-18-*) pro
// nome exibido -- achado real (revisao 2026-07-26): sem isso, a aba Produto
// mostrava o id numerico cru pro periodo historico (ilegivel, e sem somar
// com a linha do mesmo produto no ano corrente, que usa nome como rotulo).
export async function buscarFaturamentoFrioHistorico(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  dim: 'tipo' | 'familia' | 'produto' | 'tipo>familia' | 'familia>produto'
  metaPorCodigo: Map<number, { tipo: string | null; familia: string | null; nome?: string }>
}): Promise<LinhaMatrizFrio[]> {
  if (opts.dim === 'produto') {
    const rows = await buscarFatAgregado({
      lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal, group: 'produto', group2: 'mes',
    })
    const acc = new Map<string, LinhaMatrizFrio>()
    for (const r of rows) {
      if (!r.mes) continue
      const idProduto = Number(r.rotulo)
      const nome = (Number.isFinite(idProduto) ? opts.metaPorCodigo.get(idProduto)?.nome : undefined) || 'Produto não identificado'
      const chave = `${nome}|${r.mes}`
      const ent = acc.get(chave) ?? { rotulo: nome, mes: r.mes, valor: 0 }
      ent.valor += r.valor
      acc.set(chave, ent)
    }
    return [...acc.values()]
  }
  const [cupons, itens] = await Promise.all([
    buscarFatCupons({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal }),
    buscarFatCupomItens({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal }),
  ])
  const mesPorCupom = new Map(cupons.map((c) => [c.n_id_cupom, c.data.slice(0, 7)]))
  return agregarFaturamentoPorTipoFamilia(itens, mesPorCupom, opts.metaPorCodigo, opts.dim)
}

// Filtro de Situação (plano 2026-08-10-filtro-situacao-faturamento, Task 2).
// '' (vazio, default do painel principal) preserva o comportamento de hoje:
// Normal + Devolvido combinados -- cupom cancelado já nunca chega em
// `fat_cupons` pela ingestão (lib/omie/faturamento.ts, `cCupomCancelado ===
// 'S'` pula o push do cupom inteiro), então basta excluir cancelado aqui
// também, defensivamente. 'NORMAL'/'DEVOLVIDO'/'CANCELADO'/'TODOS' são os
// mesmos 4 valores não-default que `cupomBateStatus` (page.tsx, usado só
// dentro de "Ver cupons") já reconhece -- confirmado na Task 1 do plano, sem
// precisar tocar naquela função. Única diferença deliberada: o fallback do
// vazio aqui é "Normal + Devolvido" (o default do painel), não "Normal
// isolado" como em `cupomBateStatus` -- ambiguidade já documentada na Task 1
// (o valor vazio significa coisas diferentes nos dois modos hoje), não um bug
// novo introduzido por esta função.
function cupomBateSituacao(c: CupomFat, status: string): boolean {
  if (status === 'TODOS') return true
  if (status === 'CANCELADO') return c.cancelado
  if (status === 'DEVOLVIDO') return c.devolvido
  if (status === 'NORMAL') return !c.cancelado && !c.devolvido
  return !c.cancelado // '' (vazio) = Normal + Devolvido
}

// Mesmo propósito de `buscarFatAgregado` (mesmos parâmetros + mesmo formato de
// retorno), mas filtrado por situação do cupom -- o endpoint pré-agregado do
// servidor (`/fat_agregado`) não tem noção de status, então aqui a agregação
// acontece em JS sobre o fato linha-a-linha (`buscarFatCupons` +
// `buscarFatCupomItens`/`buscarFatCupomPagamentosPeriodo`, já existentes),
// filtrando pelas linhas cujo cupom bate a situação escolhida.
//
// Achado real da Task 1 deste plano: `agregarFaturamentoPorTipoFamilia` (logo
// acima) NÃO serve direto aqui -- ela só aceita `dim` em
// tipo/familia/tipo>familia/familia>produto, não um `group` solto no mesmo
// shape de `buscarFatAgregado` (dia/forma/produto). Por isso esta é uma
// lógica paralela, seguindo o MESMO MOLDE (mapa `Map<string, LinhaFatAgregado>`,
// chave via `JSON.stringify([rotulo, mes])`, valor explícito vindo do fato) --
// não uma reutilização literal daquela função.
//
// Cuidado deliberado (Task 1 achou um bug pré-existente a não reproduzir): o
// caminho principal de `page.tsx` (`usarFato && !verCupons`) usa o resultado
// de `buscarFatAgregado({ group: 'produto' })` DIRETO, sem segunda etapa de
// resolução -- `rotulo` fica com o `id_produto` numérico cru sempre que
// `group === 'produto'`. Aqui, quando `metaPorCodigo` é passado, `id_produto`
// é resolvido pro nome do produto (mesmo padrão de
// `buscarFaturamentoFrioHistorico`, dim `'produto'`, e de
// `agregarFaturamentoPorTipoFamilia` pro rótulo de produto) -- sem
// `metaPorCodigo`, cai no mesmo comportamento cru de `buscarFatAgregado`
// (drop-in compatível, não piora nada que já não fosse verdade hoje).
export async function buscarFatAgregadoPorSituacao(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  group: 'dia' | 'forma' | 'produto'
  group2?: 'mes'
  status: string
  metaPorCodigo?: Map<number, { tipo: string | null; familia: string | null; nome?: string }>
}): Promise<LinhaFatAgregado[]> {
  const cupons = await buscarFatCupons({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal })
  const cuponsValidos = cupons.filter((c) => cupomBateSituacao(c, opts.status))
  const cuponsOk = new Set(cuponsValidos.map((c) => c.n_id_cupom))
  const mesPorCupom = new Map(cuponsValidos.map((c) => [c.n_id_cupom, c.data.slice(0, 7)]))
  const diaPorCupom = new Map(cuponsValidos.map((c) => [c.n_id_cupom, c.data]))

  const acc = new Map<string, LinhaFatAgregado>()

  if (opts.group === 'forma') {
    const pagamentos = await buscarFatCupomPagamentosPeriodo({
      lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal,
    })
    for (const p of pagamentos) {
      if (!cuponsOk.has(p.n_id_cupom)) continue
      const v = Number(p.valor) || 0
      if (!v) continue
      const rotulo = p.tipo_doc || 'Não identificado'
      const mes = opts.group2 === 'mes' ? mesPorCupom.get(p.n_id_cupom) : undefined
      const chave = JSON.stringify([rotulo, mes])
      const ent = acc.get(chave) ?? { rotulo, mes, valor: 0, qtde_itens: 0 }
      ent.valor += v
      ent.qtde_itens += 1
      acc.set(chave, ent)
    }
    return [...acc.values()]
  }

  const itens = await buscarFatCupomItens({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal })
  for (const it of itens) {
    if (!cuponsOk.has(it.n_id_cupom)) continue
    // Mesmo fallback de agregarFaturamentoPorTipoFamilia/lib/omie/faturamento.ts:
    // v_item cru às vezes vem zerado do Omie; recalcula via unit*qtde-desconto.
    const v = it.v_item || (it.v_unit * it.quant - it.v_desc)
    if (!v) continue
    let rotulo: string
    if (opts.group === 'dia') {
      const dia = diaPorCupom.get(it.n_id_cupom)
      if (!dia) continue
      rotulo = dia
    } else {
      // group === 'produto'
      const info = opts.metaPorCodigo && it.id_produto != null ? opts.metaPorCodigo.get(Number(it.id_produto)) : undefined
      rotulo = info?.nome || (it.id_produto != null ? String(it.id_produto) : 'Produto não identificado')
    }
    const mes = opts.group2 === 'mes' ? mesPorCupom.get(it.n_id_cupom) : undefined
    const chave = JSON.stringify([rotulo, mes])
    const ent = acc.get(chave) ?? { rotulo, mes, valor: 0, qtde_itens: 0 }
    ent.valor += v
    ent.qtde_itens += 1
    acc.set(chave, ent)
  }
  return [...acc.values()]
}

export async function buscarFatCupomDetalhe(
  lojaId: number,
  nIdCupom: number,
): Promise<{ cupom: CupomFat | null; itens: ItemFat[]; pagamentos: PagamentoFat[] }> {
  const [cuponsRaw, itensRaw, pagamentosRaw] = await Promise.all([
    buscarFrio<CupomFat & { valor: string | number }>('/fat_cupons', { loja_id: lojaId, n_id_cupom: nIdCupom }),
    buscarFrio<ItemFat & { quant: string | number; v_unit: string | number; v_desc: string | number; v_item: string | number }>(
      '/fat_cupom_itens', { loja_id: lojaId, n_id_cupom: nIdCupom },
    ),
    buscarFrio<PagamentoFat & { valor: string | number }>('/fat_cupom_pagamentos', { loja_id: lojaId, n_id_cupom: nIdCupom }),
  ])
  const cupons = cuponsRaw ?? []
  const itens = itensRaw ?? []
  const pagamentos = pagamentosRaw ?? []
  const cupom = cupons[0] ? { ...cupons[0], valor: Number(cupons[0].valor) || 0 } : null
  return {
    cupom,
    itens: itens.map((i) => ({ ...i, quant: Number(i.quant) || 0, v_unit: Number(i.v_unit) || 0, v_desc: Number(i.v_desc) || 0, v_item: Number(i.v_item) || 0 })),
    pagamentos: pagamentos.map((p) => ({ ...p, valor: Number(p.valor) || 0 })),
  }
}
