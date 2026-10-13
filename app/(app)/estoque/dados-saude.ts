// Saúde do estoque ("nosso Omie" Fase 2): junta saldo, kardex, OPs, fichas e contagens e entrega às regras puras.
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import {
  custoAbsurdo, cmcPorLocalAtual, quaisVenderam, rotuloNegativoDesde, insumosSemCustoNoLocal, negativoDesde, opsSobrandoFaltando, oscilacoesContagem,
  produtosSemFichaQueVendem, saltosRecentes, ultimoCmcAnterior, type MovSaldo,
} from '@/lib/estoque/saude-puro'
import { diaDoMovimento } from '@/lib/estoque/quem-mexeu-puro'
import { carregarEstoqueOmieComPosicoes } from './dados-omie'
import { carregarEstoque, type LinhaEstoque } from './dados'
import { carregarOPsAbertas } from './dados-ops'
import { emLotes, fmtDataBR, historicoKardexDesde } from './dados-comum'
import { formatCustoUnit } from '@/lib/num-br'

export type ItemSaude = { chave: string; codigoProduto: number; descricao: string; codigo: string; detalhe: string; href: string; tom?: 'erro' | 'aviso' }
export type SecaoSaude = { chave: string; titulo: string; explicacao: string; itens: ItemSaude[]; naoSeAplica?: string }
export type SaudeDados = { secoes: SecaoSaude[]; avisos: string[] }

const DIAS_NEGATIVO = 60
const DIAS_CUSTO = 60
const DIAS_SALTO = 7
const DIAS_CONTAGEM = 120
const DIAS_VENDA = 30
const ROTULO_TIPO_CURTO: Record<string, string> = { '04': 'Produto acabado', '03': 'Produto em processo', '01': 'Matéria-prima', '00': 'Revenda', '07': 'Uso e consumo' }
const ORDEM_TIPO: Record<string, number> = { '04': 0, '03': 1, '01': 2 }
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

type Linha = Pick<LinhaEstoque, 'codigoProduto' | 'codigo' | 'descricao' | 'unidade' | 'tipoItem' | 'saldo' | 'cmc' | 'locais'> & { custoSuspeito?: boolean }

function item(p: Linha | undefined, cod: number, chave: string, detalhe: string, tom?: 'erro' | 'aviso'): ItemSaude {
  return {
    chave, codigoProduto: cod, descricao: p?.descricao ?? `Produto ${cod}`, codigo: p?.codigo ?? String(cod), detalhe,
    href: `/estoque/produto/${cod}`, tom,
  }
}

/** Seção de negativos (comum às duas fontes): `movs` já filtrados aos produtos negativos, na janela. */
type MovNeg = MovSaldo & { produto: number; quantidade: number }

/** `coberturaIni`: início da janela em que o histórico está completo (null = sem histórico do kardex: não mostra data). */
function secaoNegativos(linhas: Linha[], movs: MovNeg[], nomeLocal: Map<number, string>, coberturaIni: string | null): SecaoSaude {
  const negs = linhas.filter((l) => l.locais.some((x) => x.saldo < 0))
    .sort((a, b) => (ORDEM_TIPO[a.tipoItem ?? ''] ?? 9) - (ORDEM_TIPO[b.tipoItem ?? ''] ?? 9) || a.saldo - b.saldo)
  const porProduto = new Map<number, MovNeg[]>()
  for (const m of movs) porProduto.set(m.produto, [...(porProduto.get(m.produto) ?? []), m])
  const itens = negs.map((l) => {
    const lista = porProduto.get(l.codigoProduto) ?? []
    const desde = negativoDesde(lista)
    const primeira = new Map<number, MovNeg>()
    for (const m of [...lista].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem)) if (!primeira.has(m.local)) primeira.set(m.local, m)
    const partes = l.locais.filter((x) => x.saldo < 0).map((x) => {
      const p1 = primeira.get(x.codigoLocal)
      const r = rotuloNegativoDesde({
        desde: desde.get(x.codigoLocal), primeiraData: p1?.data, coberturaIni,
        saldoAntesDaPrimeira: p1 && p1.saldo != null ? p1.saldo - p1.quantidade : null,
      })
      const quando = r.tipo === 'sem_historico' ? 'histórico do kardex ainda não lido' : r.tipo === 'antes' ? `negativo desde antes de ${fmtDataBR(r.data)}` : `negativo desde ${fmtDataBR(r.data)}`
      return `${qtd(x.saldo)} ${l.unidade} em ${nomeLocal.get(x.codigoLocal) ?? x.local} (${quando})`
    })
    return item(l, l.codigoProduto, `neg-${l.codigoProduto}`, `${ROTULO_TIPO_CURTO[l.tipoItem ?? ''] ?? 'Outro tipo'} · ${partes.join('; ')}`, 'erro')
  })
  return { chave: 'negativos', titulo: 'Saldo negativo', explicacao: 'Saiu mais do que entrou. Abra o produto e confira os movimentos desde a data indicada.', itens }
}

function secoesCusto(linhas: Linha[], porProd: Map<number, MovSaldo[]>, nomeLocal: Map<number, string>, hoje: string, temHistorico = true): SecaoSaude[] {
  const prod = new Map(linhas.map((l) => [l.codigoProduto, l]))
  const absurdos: ItemSaude[] = []
  const saltos: ItemSaude[] = []
  for (const l of linhas) {
    const hist = ultimoCmcAnterior(porProd.get(l.codigoProduto) ?? [])
    let tipo = l.custoSuspeito ? 'alto' : custoAbsurdo(l.cmc, null)
    let detalhe = l.custoSuspeito ? 'custo médio fora do normal no Omie' : tipo ? `custo médio ${formatCustoUnit(l.cmc)} por ${l.unidade}` : ''
    if (!tipo) {
      for (const [local, h] of hist) {
        const t = custoAbsurdo(h.atual, h.anterior)
        if (t) { tipo = t; detalhe = `custo médio ${formatCustoUnit(h.atual)} em ${nomeLocal.get(local) ?? local} (antes ${formatCustoUnit(h.anterior)})`; break }
      }
    }
    if (tipo) absurdos.push(item(l, l.codigoProduto, `abs-${l.codigoProduto}`, detalhe, 'erro'))
  }
  const desde = addDias(hoje, -(DIAS_SALTO - 1))
  for (const [cod, movs] of porProd) {
    for (const s of saltosRecentes(movs, desde)) {
      saltos.push(item(prod.get(cod), cod, `salto-${cod}-${s.local}-${s.data}`, `${fmtDataBR(s.data)} em ${nomeLocal.get(s.local) ?? s.local}: de ${formatCustoUnit(s.de)} para ${formatCustoUnit(s.para)}`, 'aviso'))
    }
  }
  return [
    { chave: 'custo-absurdo', titulo: 'Custo médio absurdo', explicacao: temHistorico ? 'Custo de R$ 1.000 ou mais por unidade, ou 20 vezes o custo anterior. Costuma ser entrada com custo ou unidade errada.' : 'Custo de R$ 1.000 ou mais por unidade (a comparação com o custo anterior precisa do histórico do kardex, ainda não completo nesta loja).', itens: absurdos },
    {
      chave: 'salto', titulo: 'Custo que saltou nos últimos 7 dias', explicacao: 'O custo médio ficou 10 vezes maior (ou mais) numa entrada recente.', itens: saltos,
      naoSeAplica: temHistorico ? undefined : 'O histórico do kardex desta loja ainda não está completo: sem ele não dá para ver salto de custo.',
    },
  ]
}

function agruparPorProduto(movs: (MovSaldo & { produto: number })[]): Map<number, MovSaldo[]> {
  const m = new Map<number, MovSaldo[]>()
  for (const x of movs) m.set(x.produto, [...(m.get(x.produto) ?? []), x])
  return m
}

export async function carregarSaude(lojaId: number, modo: 'omie' | 'proprio'): Promise<SaudeDados> {
  return modo === 'omie' ? saudeOmie(lojaId) : saudeProprio(lojaId)
}

async function saudeOmie(lojaId: number): Promise<SaudeDados> {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const avisos: string[] = []
  const erro = (onde: string) => (e: { message: string }) => { avisos.push(`Não foi possível ler ${onde}: ${e.message}`) }
  const { visao, posicoes } = await carregarEstoqueOmieComPosicoes(lojaId)
  const linhas = visao.linhas as Linha[]
  const prod = new Map(linhas.map((l) => [l.codigoProduto, l]))
  const nomeLocal = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
  const tipos = new Map(linhas.map((l) => [l.codigoProduto, l.tipoItem]))
  type KRow = { n_cod_prod: number; codigo_local_estoque: number; data_mov: string; id_mov: number; quantidade: number; saldo_apos: number | null; cmc_apos: number | null }
  const paraMov = (k: KRow) => ({ produto: Number(k.n_cod_prod), data: k.data_mov, ordem: Number(k.id_mov), local: Number(k.codigo_local_estoque), quantidade: Number(k.quantidade), saldo: k.saldo_apos == null ? null : Number(k.saldo_apos), cmc: k.cmc_apos == null ? null : Number(k.cmc_apos) })
  // Só onde o cron sync-kardex já cobre (loja com espelho completo) o kardex tem a loja inteira; fora disso tem só os
  // produtos abertos na tela: as seções que dependem do histórico avisam em vez de dizer "Tudo certo".
  const { desde: cobertoDesde } = await historicoKardexDesde(lojaId)
  if (!cobertoDesde) avisos.push('O histórico do kardex desta loja ainda não foi lido por completo: "negativo desde" e salto de custo ficam sem data.')

  // 1. Negativos, com "desde" pelo kardex dos produtos negativos.
  const ini = cobertoDesde && cobertoDesde > addDias(hoje, -DIAS_NEGATIVO) ? cobertoDesde : addDias(hoje, -DIAS_NEGATIVO)
  const negCods = linhas.filter((l) => l.locais.some((x) => x.saldo < 0)).map((l) => l.codigoProduto)
  const kNeg = await emLotes(negCods, 50, (lote) => buscarTodasLinhas<KRow>((from, to) =>
    supabase.from('kardex_omie').select('id, n_cod_prod, codigo_local_estoque, data_mov, id_mov, quantidade, saldo_apos, cmc_apos')
      .eq('loja_id', lojaId).in('n_cod_prod', lote).gte('data_mov', ini).eq('cancelado', false).order('id').range(from, to), undefined, erro('o kardex')))
  const negativos = secaoNegativos(linhas, kNeg.map(paraMov), nomeLocal, cobertoDesde ? ini : null)

  // 2/3. Custo: só entradas mudam o custo médio.
  const kEnt = await buscarTodasLinhas<KRow>((from, to) =>
    supabase.from('kardex_omie').select('id, n_cod_prod, codigo_local_estoque, data_mov, id_mov, quantidade, saldo_apos, cmc_apos')
      .eq('loja_id', lojaId).gt('quantidade', 0).gte('data_mov', addDias(hoje, -DIAS_CUSTO)).eq('cancelado', false).order('id').range(from, to), undefined, erro('as entradas do kardex'))
  const custo = secoesCusto(linhas, cobertoDesde ? agruparPorProduto(kEnt.map(paraMov)) : new Map(), nomeLocal, hoje, !!cobertoDesde)

  // 4. OPs sobrando / faltando.
  const { ops, completa, erro: erroOps } = await carregarOPsAbertas(lojaId, 'omie')
  if (erroOps) avisos.push(`Não foi possível ler as OPs abertas: ${erroOps}`)
  const saldos = new Map(linhas.map((l) => [l.codigoProduto, l.saldo]))
  // Sobrando/faltando pelo saldo do LOCAL da OP (o prato pode estar positivo no total e negativo no local da OP).
  const saldosLocal = new Map(linhas.flatMap((l) => l.locais.map((x) => [`${l.codigoProduto}:${x.codigoLocal}`, x.saldo] as [string, number])))
  const so = opsSobrandoFaltando(saldos, tipos, ops.map((o) => ({
    id: o.id, produto: o.identificacao_n_cod_produto == null ? null : Number(o.identificacao_n_cod_produto), origem: o.origem_op,
    local: o.identificacao_codigo_local_estoque ? Number(o.identificacao_codigo_local_estoque) : null,
  })), !erroOps, saldosLocal)
  if (!completa) avisos.push('Esta loja não tem o espelho completo das OPs ligado: a lista de OPs abertas pode estar incompleta.')
  const opsSobrando: SecaoSaude = {
    chave: 'ops-sobrando', titulo: 'OPs do PDV sobrando', explicacao: 'OP aberta pela venda (cupom) de um prato que já não está negativo. Pode ser concluída ou excluída.',
    itens: so.sobrando.map((o) => {
      const op = ops.find((x) => x.id === o.id)!
      const p = prod.get(o.produto!)
      return { ...item(p, o.produto!, `op-${o.id}`, `OP ${op.identificacao_c_num_op ?? op.num_ordem ?? op.id} · ${qtd(Number(op.identificacao_n_qtde ?? op.quantidade ?? 0))} ${p?.unidade ?? ''} · saldo ${o.local ? 'no local da OP' : 'do prato'} ${qtd(o.local ? (saldosLocal.get(`${o.produto}:${o.local}`) ?? 0) : (p?.saldo ?? 0))}`, 'aviso'), href: `/ordem-producao/abertas?q=${encodeURIComponent(op.identificacao_c_num_op ?? String(op.id))}` }
    }),
  }
  const opsFaltando: SecaoSaude = {
    chave: 'ops-faltando', titulo: 'Prato negativo sem OP', explicacao: 'Produto acabado ou em processo com saldo negativo e nenhuma OP aberta para repor.',
    itens: so.faltando.map((cod) => item(prod.get(cod), cod, `falta-${cod}`, `saldo ${qtd(prod.get(cod)?.saldo ?? 0)} ${prod.get(cod)?.unidade ?? ''}`, 'erro')),
  }
  if (so.indisponivel) {
    opsSobrando.itens = []; opsSobrando.naoSeAplica = 'Não foi possível ler as OPs abertas agora.'
    opsFaltando.itens = []; opsFaltando.naoSeAplica = 'Não foi possível ler as OPs abertas agora.'
  }

  // 5. Insumo sem custo no local de consumo.
  type FRow = { codigo_produto: number; codigo_produto_insumo: number; codigo_local_estoque: number | null }
  let fichas: FRow[] = []
  let fichasOk = true
  fichas = await buscarTodasLinhas<FRow>((from, to) =>
    supabase.from('estrutura_produto_cache').select('id, codigo_produto, codigo_produto_insumo, codigo_local_estoque').eq('loja_id', lojaId).order('id').range(from, to),
    undefined, () => { fichasOk = false })
  const semCusto = insumosSemCustoNoLocal(fichas.map((f) => ({ produto: Number(f.codigo_produto), insumo: Number(f.codigo_produto_insumo), local: f.codigo_local_estoque == null ? null : Number(f.codigo_local_estoque) })), cmcPorLocalAtual(posicoes))
  const insumoSemCusto: SecaoSaude = {
    chave: 'insumo-sem-custo', titulo: 'Insumo sem custo no local de consumo', explicacao: 'O Omie não conclui a OP de um prato quando um insumo não tem custo no local de onde sai (erro Client-193).',
    itens: semCusto.map((s) => item(prod.get(s.insumo), s.insumo, `semcusto-${s.insumo}-${s.local}`, `sem custo em ${nomeLocal.get(s.local) ?? s.local} · usado em ${s.pratos.length} prato${s.pratos.length === 1 ? '' : 's'} (${s.pratos.slice(0, 3).map((p) => prod.get(p)?.descricao ?? p).join(', ')}${s.pratos.length > 3 ? '…' : ''})`, 'aviso')),
    naoSeAplica: fichasOk ? undefined : 'As fichas com local de consumo ainda não foram lidas (migration 160 pendente).',
  }

  // 6. Contagem que oscila (inventário: tipo SLD guarda a quantidade contada).
  type SRow = { id: number; id_prod: number; codigo_local_estoque: number; data: string; quan: number }
  const sld = await buscarTodasLinhas<SRow>((from, to) =>
    supabase.from('movimentos').select('id, id_prod, codigo_local_estoque, data, quan').eq('loja_id', lojaId).eq('tipo', 'SLD')
      .gte('data', `${addDias(hoje, -DIAS_CONTAGEM)}T00:00:00Z`).order('id').range(from, to), undefined, erro('as contagens'))
  const osc = oscilacoesContagem(sld.map((s) => ({ produto: Number(s.id_prod), local: Number(s.codigo_local_estoque), data: diaDoMovimento(s.data), ordem: Number(s.id), qtd: Number(s.quan) })))
  const ultimaOsc = new Map<string, (typeof osc)[number]>()
  for (const o of osc) ultimaOsc.set(`${o.produto}:${o.local}`, o)
  const contagem: SecaoSaude = {
    chave: 'contagem', titulo: 'Contagem que oscila', explicacao: 'Duas contagens seguidas do mesmo produto no mesmo local com diferença de 3 vezes ou mais (ou indo a zero). Costuma ser unidade trocada na contagem.',
    itens: [...ultimaOsc.values()].map((o) => item(prod.get(o.produto), o.produto, `osc-${o.produto}-${o.local}`, `${nomeLocal.get(o.local) ?? o.local}: contou ${qtd(o.de)} e depois ${qtd(o.para)} (${fmtDataBR(o.data)})`, 'aviso')),
  }

  // 7. Vende sem ficha: só produto cuja ficha já foi lida do Omie com 0 itens.
  type SyncRow = { codigo_produto: number; itens: number }
  let syncOk = true
  const sync = await buscarTodasLinhas<SyncRow>((from, to) =>
    supabase.from('estrutura_produto_sync').select('codigo_produto, itens').eq('loja_id', lojaId).order('codigo_produto').range(from, to), undefined, () => { syncOk = false })
  const lida = new Map(sync.map((s) => [Number(s.codigo_produto), Number(s.itens)]))
  const candidatos = [...lida.entries()].filter(([p, n]) => n === 0 && ['03', '04'].includes(tipos.get(p) ?? '')).map(([p]) => p)
  const vendidos = await quaisVenderam(candidatos, (cod) =>
    supabase.from('kardex_omie').select('id').eq('loja_id', lojaId).eq('n_cod_prod', cod)
      .not('id_cupom', 'is', null).gte('data_mov', addDias(hoje, -(DIAS_VENDA - 1))).limit(1))
  const semFicha: SecaoSaude = {
    chave: 'sem-ficha', titulo: 'Vende sem ficha técnica', explicacao: 'Produto acabado ou em processo vendido nos últimos 30 dias sem ficha no Omie: a venda não baixa os insumos.',
    itens: produtosSemFichaQueVendem(vendidos, lida, tipos).map((cod) => item(prod.get(cod), cod, `semficha-${cod}`, 'sem ficha técnica no Omie', 'aviso')),
    naoSeAplica: syncOk ? undefined : 'As fichas ainda não foram lidas do Omie (migration 160 pendente).',
  }
  if (syncOk && !sync.length) avisos.push('Nenhuma ficha técnica foi lida do Omie ainda: "Vende sem ficha" fica vazio até a primeira leitura.')

  return { secoes: [negativos, ...custo, opsSobrando, opsFaltando, insumoSemCusto, contagem, semFicha], avisos }
}

async function saudeProprio(lojaId: number): Promise<SaudeDados> {
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const avisos: string[] = []
  const erro = (onde: string) => (e: { message: string }) => { avisos.push(`Não foi possível ler ${onde}: ${e.message}`) }
  const visao = await carregarEstoque(lojaId)
  const linhas = visao.linhas as Linha[]
  const prod = new Map(linhas.map((l) => [l.codigoProduto, l]))
  const nomeLocal = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
  type MRow = { id: number; codigo_produto: number; codigo_local_estoque: number; data_ref: string; quantidade: number; saldo_apos: number; cmc_apos: number | null }
  const paraMov = (k: MRow) => ({ produto: Number(k.codigo_produto), data: k.data_ref, ordem: Number(k.id), local: Number(k.codigo_local_estoque), quantidade: Number(k.quantidade), saldo: Number(k.saldo_apos), cmc: k.cmc_apos == null ? null : Number(k.cmc_apos) })
  const cols = 'id, codigo_produto, codigo_local_estoque, data_ref, quantidade, saldo_apos, cmc_apos'

  const ini = addDias(hoje, -DIAS_NEGATIVO)
  const negCods = linhas.filter((l) => l.locais.some((x) => x.saldo < 0)).map((l) => l.codigoProduto)
  const mNeg = await emLotes(negCods, 50, (lote) => buscarTodasLinhas<MRow>((from, to) =>
    supabase.from('estoque_movimentos').select(cols).eq('loja_id', lojaId).in('codigo_produto', lote).gte('data_ref', ini).order('id').range(from, to), undefined, erro('os movimentos')))
  const negativos = secaoNegativos(linhas, mNeg.map(paraMov), nomeLocal, ini)

  const mEnt = await buscarTodasLinhas<MRow>((from, to) =>
    supabase.from('estoque_movimentos').select(cols).eq('loja_id', lojaId).gt('quantidade', 0).gte('data_ref', addDias(hoje, -DIAS_CUSTO)).order('id').range(from, to), undefined, erro('as entradas'))
  const custo = secoesCusto(linhas, agruparPorProduto(mEnt.map(paraMov)), nomeLocal, hoje)

  const fichas = await carregarFichasAtivas(supabase, lojaId).catch((e: Error) => { avisos.push(`Não foi possível ler as fichas: ${e.message}`); return new Map() })
  const itensFicha = [...fichas.values()].flatMap((f) => f.itens.map((i: { codigoInsumo: number }) => ({ produto: f.codigoProduto, insumo: i.codigoInsumo, local: 0 })))
  const cmc0 = new Map(linhas.map((l) => [`${l.codigoProduto}:0`, l.cmc]))
  const insumoSemCusto: SecaoSaude = {
    chave: 'insumo-sem-custo', titulo: 'Insumo sem custo', explicacao: 'Insumo de ficha técnica sem custo médio: o custo do prato e da produção sai menor do que é.',
    itens: insumosSemCustoNoLocal(itensFicha, cmc0).map((s) => item(prod.get(s.insumo), s.insumo, `semcusto-${s.insumo}`, `sem custo médio · usado em ${s.pratos.length} prato${s.pratos.length === 1 ? '' : 's'}`, 'aviso')),
  }

  const tipos = new Map(linhas.map((l) => [l.codigoProduto, l.tipoItem]))
  const candidatos = linhas.filter((l) => ['03', '04'].includes(l.tipoItem ?? '') && !fichas.has(l.codigoProduto)).map((l) => l.codigoProduto)
  const vendidos = await quaisVenderam(candidatos, (cod) =>
    supabase.from('estoque_movimentos').select('id').eq('loja_id', lojaId).eq('codigo_produto', cod)
      .eq('origem', 'VENDA').gte('data_ref', addDias(hoje, -(DIAS_VENDA - 1))).limit(1))
  const lida = new Map(candidatos.map((c) => [c, 0]))
  const semFicha: SecaoSaude = {
    chave: 'sem-ficha', titulo: 'Vende sem ficha técnica', explicacao: 'Produto acabado ou em processo vendido nos últimos 30 dias sem ficha ativa: a venda não baixa os insumos.',
    itens: produtosSemFichaQueVendem(vendidos, lida, tipos).map((cod) => item(prod.get(cod), cod, `semficha-${cod}`, 'sem ficha técnica ativa', 'aviso')),
  }

  const naoProprio = 'Não se aplica ao estoque próprio: aqui a venda baixa a ficha na hora, sem OP automática do PDV.'
  return {
    secoes: [
      negativos, ...custo,
      { chave: 'ops-sobrando', titulo: 'OPs do PDV sobrando', explicacao: '', itens: [], naoSeAplica: naoProprio },
      { chave: 'ops-faltando', titulo: 'Prato negativo sem OP', explicacao: '', itens: [], naoSeAplica: naoProprio },
      insumoSemCusto,
      { chave: 'contagem', titulo: 'Contagem que oscila', explicacao: '', itens: [], naoSeAplica: 'Ainda não disponível no estoque próprio: o inventário próprio grava a diferença, não a quantidade contada.' },
      semFicha,
    ],
    avisos,
  }
}
