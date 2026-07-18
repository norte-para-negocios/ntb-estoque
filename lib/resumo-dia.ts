import { createServiceClient } from '@/lib/supabase/server'
import { statusInfo } from '@/lib/status-cor'
import { explicarErroOmie } from '@/lib/erro-omie-amigavel'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import {
  complementarNotasFiscais,
  complementarOrdensProducao,
  complementarMovimentos,
  complementarMovimentosHistorico,
  limiteJanelaQuente,
} from '@/lib/historico-contabo'

// "Resumo do dia" — painel gerencial. Consulta ao vivo, escopado por loja, para um
// dia (fuso America/Bahia, UTC-3). Organizado por CATEGORIA: cada uma tem a sua
// contagem e a sua lista. O painel mostra os números de todas e a lista da escolhida.

export type CategoriaKey =
  | 'notas' | 'transferencias' | 'inventarios' | 'producao' | 'movimentacoes' | 'etiquetas' | 'erros' | 'auditoria'

export type Tom = 'ok' | 'warn' | 'err' | 'info' | 'neutro'

export type LinhaCategoria = {
  celulas: (string | null)[]
  status?: { label: string; tom: Tom } | null
  // Texto completo (ex.: mensagem de erro do Omie) para abrir ao clicar no selo.
  detalhe?: string | null
}

export type ItemGrafico = { label: string; valor: number }
export type Grafico = { titulo: string; unidade: 'num' | 'reais'; itens: ItemGrafico[] }

export type CategoriaLista = {
  colunas: { label: string; alinharDir?: boolean }[]
  linhas: LinhaCategoria[]
  total: number // total real (a lista pode estar capada)
  grafico?: Grafico // top itens para o gráfico de barras
}

// Top N de um mapa label->valor, ordenado desc.
function topN(m: Map<string, number>, n = 8): ItemGrafico[] {
  return [...m.entries()]
    .map(([label, valor]) => ({ label, valor }))
    .filter((i) => i.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n)
}

export type Contagem = {
  notas: number
  valorNotas: number
  transferencias: number
  inventarios: number
  opsPrevistas: number
  opsConcluidas: number
  movEntradas: number
  movSaidas: number
  etiquetas: number
  erros: number
  auditoria: number
}

export type ResumoDia = {
  contagem: Contagem
  cat: CategoriaKey
  lista: CategoriaLista
  multiLoja: boolean
}

const LIMITE_LISTA = 300

// --- helpers de data (fuso Bahia) ---
export function janelaDiaBahia(dataISO: string): { ini: string; fim: string } {
  const ini = `${dataISO}T03:00:00.000Z`
  const [y, m, d] = dataISO.split('-').map(Number)
  const prox = new Date(Date.UTC(y, m - 1, d + 1))
  const fim = `${prox.toISOString().slice(0, 10)}T03:00:00.000Z`
  return { ini, fim }
}
export function proximoDiaISO(dataISO: string): string {
  const [y, m, d] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}
export type PeriodoResumo = 'dia' | 'semana' | 'mes'
// Janela ROLANTE terminando em dataISO (inclusive): dia = so o dia; semana = 7 dias;
// mes = 30 dias. Pedido da reuniao 09/07 (Augusto, gerente regional, quer ver
// semanal/mensal, nao so diario) -- mesmo padrao ja usado na cobertura de auditoria.
// ini/fim: timestamptz (created_at); dataIni/dataFim: 'YYYY-MM-DD' (colunas de data pura).
export function janelaPeriodoBahia(
  dataISO: string,
  periodo: PeriodoResumo
): { ini: string; fim: string; dataIni: string; dataFim: string } {
  const dias = periodo === 'mes' ? 30 : periodo === 'semana' ? 7 : 1
  const [y, m, d] = dataISO.split('-').map(Number)
  const dataIni = new Date(Date.UTC(y, m - 1, d - (dias - 1))).toISOString().slice(0, 10)
  return { ini: janelaDiaBahia(dataIni).ini, fim: janelaDiaBahia(dataISO).fim, dataIni, dataFim: dataISO }
}
export function hojeBahia(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
function horaBahia(iso: string): string {
  const t = new Date(new Date(iso).getTime() - 3 * 3600 * 1000)
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}
function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}
function fmtMoeda(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDataBR(d: string | null): string {
  if (!d) return '-'
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d)
}
const tomDoToken = (t: string): Tom =>
  (['ok', 'warn', 'err', 'info', 'neutro'].includes(t) ? t : 'neutro') as Tom

type Supa = ReturnType<typeof createServiceClient>

async function nomesUsuarios(supabase: Supa, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean) as string[])]
  const map = new Map<string, string>()
  if (!uniq.length) return map
  const { data } = await supabase.from('profiles').select('id, name').in('id', uniq)
  for (const p of (data ?? []) as { id: string; name: string }[]) map.set(p.id, p.name)
  return map
}
async function nomesLocais(supabase: Supa, lojaIds: number[], codigos: (number | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(codigos.filter((v) => v != null) as number[])]
  const map = new Map<string, string>()
  if (!uniq.length) return map
  const { data } = await supabase
    .from('local_estoques')
    .select('loja_id, codigo_local_estoque, descricao')
    .in('loja_id', lojaIds)
    .in('codigo_local_estoque', uniq)
  for (const l of (data ?? []) as { loja_id: number; codigo_local_estoque: number; descricao: string }[])
    map.set(`${l.loja_id}-${l.codigo_local_estoque}`, l.descricao)
  return map
}
async function nomesLojas(supabase: Supa, lojaIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const { data } = await supabase.from('lojas').select('id, nome, nome_fantasia').in('id', lojaIds)
  for (const l of (data ?? []) as { id: number; nome: string | null; nome_fantasia: string | null }[])
    map.set(l.id, l.nome_fantasia || l.nome || `Loja ${l.id}`)
  return map
}

const vazia: CategoriaLista = { colunas: [], linhas: [], total: 0 }

export async function carregarResumoDia(
  lojaIds: number[],
  dataISO: string,
  cat: CategoriaKey,
  periodo: PeriodoResumo = 'dia'
): Promise<ResumoDia> {
  const contagemVazia: Contagem = {
    notas: 0, valorNotas: 0, transferencias: 0, inventarios: 0,
    opsPrevistas: 0, opsConcluidas: 0, movEntradas: 0, movSaidas: 0, etiquetas: 0, erros: 0, auditoria: 0,
  }
  if (!lojaIds.length) return { contagem: contagemVazia, cat, lista: vazia, multiLoja: false }

  const supabase = createServiceClient()
  const { ini, fim, dataIni, dataFim } = janelaPeriodoBahia(dataISO, periodo)
  const proxDia = proximoDiaISO(dataFim)
  const multiLoja = lojaIds.length > 1

  // --- CONTAGENS (todas, baratas) ---
  const [
    notasRows, transfCount, inventCount, opsPrevCount, opsConclCount, movRowsRaw, etiqRows, errosCount, auditCount,
  ] = await Promise.all([
    supabase.from('notas_fiscais').select('n_valor_nfe').in('loja_id', lojaIds)
      .gte('d_emissao_nfe', dataIni).lt('d_emissao_nfe', proxDia).is('deleted_at', null).eq('c_etapa', '60'),
    supabase.from('transferencias').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('inventarios').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('identificacao_d_dt_previsao', dataIni).lte('identificacao_d_dt_previsao', dataFim),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('dt_conclusao_real', dataIni).lte('dt_conclusao_real', dataFim),
    supabase.from('movimentos_historico').select('cod_prod, data, entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim),
    supabase.from('impressao_etiquetas').select('qtd_etiquetas').in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('integration_attempts').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).eq('error', true).gte('created_at', ini).lt('created_at', fim),
    supabase.from('audit_log').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
  ])

  let movRowsCompletas = (movRowsRaw.data ?? []) as { cod_prod: number; data: string; entradas: number | null; saidas: number | null }[]
  if (dataIni < limiteJanelaQuente()) {
    for (const lojaId of lojaIds) {
      movRowsCompletas = await complementarMovimentosHistorico(movRowsCompletas, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
    }
  }
  let movEntradas = 0, movSaidas = 0
  for (const m of movRowsCompletas) {
    movEntradas += Number(m.entradas ?? 0); movSaidas += Number(m.saidas ?? 0)
  }
  const contagem: Contagem = {
    notas: (notasRows.data ?? []).length,
    valorNotas: (notasRows.data ?? []).reduce((s, n) => s + Number((n as { n_valor_nfe: number }).n_valor_nfe ?? 0), 0),
    transferencias: transfCount.count ?? 0,
    inventarios: inventCount.count ?? 0,
    opsPrevistas: opsPrevCount.count ?? 0,
    opsConcluidas: opsConclCount.count ?? 0,
    movEntradas, movSaidas,
    etiquetas: (etiqRows.data ?? []).reduce((s, e) => s + Number((e as { qtd_etiquetas: number }).qtd_etiquetas ?? 0), 0),
    erros: errosCount.count ?? 0,
    auditoria: auditCount.count ?? 0,
  }

  const lista = await listarCategoria(supabase, lojaIds, dataISO, cat, contagem, multiLoja, periodo)
  return { contagem, cat, lista, multiLoja }
}

// Monta a lista de UMA categoria (colunas + linhas). Reutilizada pelo painel (uma
// categoria por vez) e pelo PDF completo (todas as categorias do dia/periodo).
async function listarCategoria(
  supabase: Supa,
  lojaIds: number[],
  dataISO: string,
  cat: CategoriaKey,
  contagem: Contagem,
  multiLoja: boolean,
  periodo: PeriodoResumo = 'dia',
): Promise<CategoriaLista> {
  const { ini, fim, dataIni, dataFim } = janelaPeriodoBahia(dataISO, periodo)
  const proxDia = proximoDiaISO(dataFim)
  const lojaTag = multiLoja ? { label: 'Loja' } : null
  let lista: CategoriaLista = vazia

  if (cat === 'notas') {
    const { data: notasQuentes } = await supabase.from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_nome, c_razao_social, n_valor_nfe, c_etapa, loja_id')
      .in('loja_id', lojaIds).gte('d_emissao_nfe', dataIni).lt('d_emissao_nfe', proxDia).is('deleted_at', null)
      .eq('c_etapa', '60')
      .order('d_emissao_nfe', { ascending: false }).limit(LIMITE_LISTA)
    let data = notasQuentes ?? []
    if (dataIni < limiteJanelaQuente()) {
      for (const lojaId of lojaIds) {
        data = await complementarNotasFiscais(data, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
      }
    }
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    const rows = data as { d_emissao_nfe: string; c_numero_nfe: string | null; c_nome: string | null; c_razao_social: string | null; n_valor_nfe: number | null; c_etapa: string | null; loja_id: number }[]
    lista = {
      colunas: [{ label: 'Emissão' }, { label: 'NFe' }, { label: 'Fornecedor' }, ...(lojaTag ? [lojaTag] : []), { label: 'Valor', alinharDir: true }],
      total: contagem.notas,
      linhas: rows.map((n) => ({
        celulas: [
          fmtDataBR(n.d_emissao_nfe), n.c_numero_nfe ?? '-', (n.c_nome || n.c_razao_social || '-'),
          ...(lojas ? [lojas.get(n.loja_id) ?? '-'] : []),
          fmtMoeda(Number(n.n_valor_nfe ?? 0)),
        ],
        status: n.c_etapa === '60' ? { label: 'Concluída', tom: 'ok' } : { label: 'Pendente', tom: 'warn' },
      })),
    }
    const fornec = new Map<string, number>()
    for (const n of rows) {
      const f = (n.c_nome || n.c_razao_social || '-').slice(0, 28)
      fornec.set(f, (fornec.get(f) ?? 0) + Number(n.n_valor_nfe ?? 0))
    }
    lista.grafico = { titulo: 'Por fornecedor (R$)', unidade: 'reais', itens: topN(fornec) }
  } else if (cat === 'transferencias') {
    const { data } = await supabase.from('transferencias')
      .select('id, loja_id, codigo_local_origem, codigo_local_destino, status, created_at, user_id')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim).order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { id: number; loja_id: number; codigo_local_origem: number | null; codigo_local_destino: number | null; status: string; created_at: string; user_id: string | null }[]

    const transfIds = rows.map((r) => r.id)
    const [users, locais, lojas, movRes] = await Promise.all([
      nomesUsuarios(supabase, rows.map((r) => r.user_id)),
      nomesLocais(supabase, lojaIds, rows.flatMap((r) => [r.codigo_local_origem, r.codigo_local_destino])),
      multiLoja ? nomesLojas(supabase, lojaIds) : Promise.resolve(null),
      transfIds.length
        ? supabase.from('movimentos').select('id, transferencia_id, id_prod').in('transferencia_id', transfIds).limit(5000)
        : Promise.resolve({ data: [] as { id: number; transferencia_id: number; id_prod: number }[] }),
    ])

    // Resolve product names
    let movItens = (movRes.data ?? []) as { id: number; transferencia_id: number; id_prod: number }[]
    if (transfIds.length && dataIni < limiteJanelaQuente()) {
      for (const lojaId of lojaIds) {
        movItens = await complementarMovimentos(movItens, { lojaId })
      }
    }
    const prodCods = [...new Set(movItens.map((m) => m.id_prod).filter(Boolean))]
    const nomeProd = new Map<number, string>()
    if (prodCods.length) {
      const { data: prods } = await supabase.from('produtos').select('codigo_produto, descricao').in('loja_id', lojaIds).in('codigo_produto', prodCods)
      for (const p of (prods ?? []) as { codigo_produto: number; descricao: string }[])
        nomeProd.set(p.codigo_produto, formatarNomeProduto(p.descricao))
    }

    // Produtos por transferência (deduplicados)
    const prodsPorTransf = new Map<number, string[]>()
    for (const m of movItens) {
      if (!m.transferencia_id || !m.id_prod) continue
      const arr = prodsPorTransf.get(m.transferencia_id) ?? []
      const nome = nomeProd.get(m.id_prod) ?? `Cód ${m.id_prod}`
      if (!arr.includes(nome)) arr.push(nome)
      prodsPorTransf.set(m.transferencia_id, arr)
    }
    const resumoProdutos = (id: number) => {
      const itens = prodsPorTransf.get(id) ?? []
      if (!itens.length) return '-'
      const head = itens.slice(0, 2).map((n) => n.slice(0, 22)).join(', ')
      return itens.length > 2 ? `${head} +${itens.length - 2}` : head
    }

    const loc = (loja: number, c: number | null) => (c != null ? locais.get(`${loja}-${c}`) ?? `Local ${c}` : '-')
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Pessoa' }, { label: 'Origem → Destino' }, { label: 'Produtos' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.transferencias,
      linhas: rows.map((t) => {
        const si = statusInfo(t.status)
        return {
          celulas: [horaBahia(t.created_at), t.user_id ? users.get(t.user_id) ?? 'Sistema' : 'Sistema',
            `${loc(t.loja_id, t.codigo_local_origem)} → ${loc(t.loja_id, t.codigo_local_destino)}`,
            resumoProdutos(t.id),
            ...(lojas ? [lojas.get(t.loja_id) ?? '-'] : [])],
          status: { label: si.label, tom: tomDoToken(si.token) },
        }
      }),
    }
    const transfPessoa = new Map<string, number>()
    for (const t of rows) {
      const p = t.user_id ? users.get(t.user_id) ?? 'Sistema' : 'Sistema'
      transfPessoa.set(p, (transfPessoa.get(p) ?? 0) + 1)
    }
    lista.grafico = { titulo: 'Por pessoa', unidade: 'num', itens: topN(transfPessoa) }
  } else if (cat === 'inventarios') {
    const { data } = await supabase.from('inventarios')
      .select('id, loja_id, codigo_local_estoque, status, finalizado, created_at, user_id')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim).order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { loja_id: number; codigo_local_estoque: number | null; status: string; finalizado: string | null; created_at: string; user_id: string | null }[]
    const [users, locais, lojas] = await Promise.all([
      nomesUsuarios(supabase, rows.map((r) => r.user_id)),
      nomesLocais(supabase, lojaIds, rows.map((r) => r.codigo_local_estoque)),
      multiLoja ? nomesLojas(supabase, lojaIds) : Promise.resolve(null),
    ])
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Pessoa' }, { label: 'Local' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.inventarios,
      linhas: rows.map((inv) => {
        const si = statusInfo(inv.status)
        return {
          celulas: [horaBahia(inv.created_at), inv.user_id ? users.get(inv.user_id) ?? 'Sistema' : 'Sistema',
            inv.codigo_local_estoque != null ? locais.get(`${inv.loja_id}-${inv.codigo_local_estoque}`) ?? `Local ${inv.codigo_local_estoque}` : '-',
            ...(lojas ? [lojas.get(inv.loja_id) ?? '-'] : [])],
          status: { label: si.label, tom: tomDoToken(si.token) },
        }
      }),
    }
    const invPessoa = new Map<string, number>()
    for (const inv of rows) {
      const p = inv.user_id ? users.get(inv.user_id) ?? 'Sistema' : 'Sistema'
      invPessoa.set(p, (invPessoa.get(p) ?? 0) + 1)
    }
    lista.grafico = { titulo: 'Por pessoa', unidade: 'num', itens: topN(invPessoa) }
  } else if (cat === 'producao') {
    // Só o que foi PRODUZIDO no dia (OPs concluídas), agrupado por produto. As
    // "previstas" NÃO entram: previsão é plano, não atividade do dia.
    const { data: opsQuentes } = await supabase.from('ordens_producao')
      .select('id, identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao')
      .in('loja_id', lojaIds).gte('dt_conclusao_real', dataIni).lte('dt_conclusao_real', dataFim).limit(5000)
    let opsProducaoData = opsQuentes ?? []
    if (dataIni < limiteJanelaQuente()) {
      for (const lojaId of lojaIds) {
        opsProducaoData = await complementarOrdensProducao(opsProducaoData, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
      }
    }
    const rows = opsProducaoData as { identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; produto_descricao: string | null }[]
    // Nome E TIPO do produto: OPs do Omie vêm sem descrição/tipo -> resolve pelo código.
    // Ramon quer ver a produção de EM PROCESSO/intermediário separada do ACABADO
    // (em processo = trabalho da cozinha; acabado = frente de loja).
    const codigos = [...new Set(rows.map((r) => r.identificacao_n_cod_produto).filter((v) => v != null) as number[])]
    const nomeProd = new Map<number, string>()
    const tipoProd = new Map<number, string>()
    if (codigos.length) {
      const { data: prods } = await supabase.from('produtos').select('codigo_produto, descricao, tipo_item').in('loja_id', lojaIds).in('codigo_produto', codigos)
      for (const p of (prods ?? []) as { codigo_produto: number; descricao: string; tipo_item: string | null }[]) {
        nomeProd.set(p.codigo_produto, formatarNomeProduto(p.descricao))
        if (p.tipo_item) tipoProd.set(p.codigo_produto, p.tipo_item)
      }
    }
    // tipo_item: '04' acabado; '03' em processo; '06' intermediário. Agrupa em processo+intermediário.
    const classificar = (cod: number | null): 'Em processo' | 'Acabado' | 'Outro' => {
      const t = cod != null ? tipoProd.get(cod) : null
      if (t === '04') return 'Acabado'
      if (t === '03' || t === '06') return 'Em processo'
      return 'Outro'
    }
    // Pedido da reuniao 09/07: card Produção so deve contar produto em processo/
    // acabado -- 'Outro' (tipo nao mapeado, ex.: material de consumo virando OP por
    // engano) era ruido misturado no card.
    const grupo = new Map<string, { produto: string; tipo: string; qtd: number; ops: number }>()
    for (const o of rows) {
      const tipo = classificar(o.identificacao_n_cod_produto)
      if (tipo === 'Outro') continue
      const produto = o.produto_descricao
        ? formatarNomeProduto(o.produto_descricao)
        : o.identificacao_n_cod_produto != null
          ? nomeProd.get(o.identificacao_n_cod_produto) ?? `Produto ${o.identificacao_n_cod_produto}`
          : '-'
      const g = grupo.get(produto) ?? { produto, tipo, qtd: 0, ops: 0 }
      g.qtd += Number(o.identificacao_n_qtde ?? 0)
      g.ops += 1
      grupo.set(produto, g)
    }
    // Em processo primeiro (o que o Ramon quer enxergar mais), depois acabado, depois outro.
    const ordemTipo: Record<string, number> = { 'Em processo': 0, 'Acabado': 1, 'Outro': 2 }
    const grupos = [...grupo.values()].sort((a, b) => (ordemTipo[a.tipo] - ordemTipo[b.tipo]) || (b.qtd - a.qtd))
    lista = {
      colunas: [{ label: 'Tipo' }, { label: 'Produto' }, { label: 'OPs', alinharDir: true }, { label: 'Produzido', alinharDir: true }],
      total: grupos.length,
      linhas: grupos.map((g) => ({
        celulas: [g.tipo, g.produto, fmtNum(g.ops), fmtNum(g.qtd)],
        status: null,
      })),
    }
    lista.grafico = { titulo: 'Mais produzidos', unidade: 'num', itens: grupos.slice(0, 8).map((g) => ({ label: g.produto.slice(0, 28), valor: g.qtd })) }
  } else if (cat === 'movimentacoes') {
    const { data: histQuentes } = await supabase.from('movimentos_historico')
      .select('loja_id, cod_prod, codigo, descricao, data, entradas, saidas').in('loja_id', lojaIds).gte('data', dataIni).lte('data', dataFim)
      .order('saidas', { ascending: false }).limit(LIMITE_LISTA)
    let movHistData = histQuentes ?? []
    if (dataIni < limiteJanelaQuente()) {
      for (const lojaId of lojaIds) {
        movHistData = await complementarMovimentosHistorico(movHistData, { lojaId, dataInicio: dataIni, dataFinal: dataFim })
      }
    }
    const rows = movHistData as { loja_id: number; codigo: string | null; descricao: string | null; entradas: number | null; saidas: number | null }[]
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    lista = {
      colunas: [{ label: 'Produto' }, ...(lojaTag ? [lojaTag] : []), { label: 'Entradas', alinharDir: true }, { label: 'Saídas', alinharDir: true }],
      total: rows.length,
      linhas: rows.map((m) => ({
        celulas: [[m.codigo, m.descricao].filter(Boolean).join(' - ') || '-',
          ...(lojas ? [lojas.get(m.loja_id) ?? '-'] : []),
          fmtNum(Number(m.entradas ?? 0)), fmtNum(Number(m.saidas ?? 0))],
        status: null,
      })),
    }
    lista.grafico = { titulo: 'Maiores saídas', unidade: 'num', itens: rows.slice(0, 8).map((m) => ({ label: ([m.codigo, m.descricao].filter(Boolean).join(' - ') || '-').slice(0, 28), valor: Number(m.saidas ?? 0) })).filter((i) => i.valor > 0) }
  } else if (cat === 'etiquetas') {
    const { data } = await supabase.from('impressao_etiquetas')
      .select('id, loja_id, qtd_etiquetas, user_id, created_at').in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim)
      .order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { loja_id: number; qtd_etiquetas: number | null; user_id: string | null; created_at: string }[]
    const [users, lojas] = await Promise.all([
      nomesUsuarios(supabase, rows.map((r) => r.user_id)),
      multiLoja ? nomesLojas(supabase, lojaIds) : Promise.resolve(null),
    ])
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Pessoa' }, ...(lojaTag ? [lojaTag] : []), { label: 'Etiquetas', alinharDir: true }],
      total: rows.length,
      linhas: rows.map((e) => ({
        celulas: [horaBahia(e.created_at), e.user_id ? users.get(e.user_id) ?? 'Sistema' : 'Sistema',
          ...(lojas ? [lojas.get(e.loja_id) ?? '-'] : []),
          fmtNum(Number(e.qtd_etiquetas ?? 0))],
        status: null,
      })),
    }
    const etqPessoa = new Map<string, number>()
    for (const e of rows) {
      const p = e.user_id ? users.get(e.user_id) ?? 'Sistema' : 'Sistema'
      etqPessoa.set(p, (etqPessoa.get(p) ?? 0) + Number(e.qtd_etiquetas ?? 0))
    }
    lista.grafico = { titulo: 'Por pessoa', unidade: 'num', itens: topN(etqPessoa) }
  } else if (cat === 'erros') {
    const { data } = await supabase.from('integration_attempts')
      .select('id, loja_id, model, error_message, created_at').in('loja_id', lojaIds).eq('error', true)
      .gte('created_at', ini).lt('created_at', fim).order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { loja_id: number; model: string | null; error_message: string | null; created_at: string }[]
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Origem' }, { label: 'Problema' }, { label: 'Mensagem Omie' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.erros,
      linhas: rows.map((er) => {
        const exp = explicarErroOmie(er.error_message)
        const msgLimpa = (er.error_message ?? '').replace(/^ERROR:\s*/i, '').trim()
        // Detalhe completo: explicacao amigavel (se houver) + mensagem crua do Omie.
        const detalhe = [exp?.explicacao, msgLimpa].filter(Boolean).join('\n\n') || msgLimpa || null
        return {
          celulas: [horaBahia(er.created_at), er.model ?? '-', exp?.titulo ?? 'Erro', msgLimpa.slice(0, 150) || '-',
            ...(lojas ? [lojas.get(er.loja_id) ?? '-'] : [])],
          status: exp ? { label: exp.tipo === 'acao' ? 'Resolver' : exp.tipo === 'transitorio' ? 'Temporário' : 'Info', tom: exp.tipo === 'acao' ? 'err' : exp.tipo === 'transitorio' ? 'warn' : 'neutro' } : { label: 'Ver erro', tom: 'err' },
          detalhe,
        }
      }),
    }
    const errTipo = new Map<string, number>()
    for (const er of rows) {
      const t = explicarErroOmie(er.error_message)?.titulo ?? 'Erro'
      errTipo.set(t, (errTipo.get(t) ?? 0) + 1)
    }
    lista.grafico = { titulo: 'Por tipo', unidade: 'num', itens: topN(errTipo) }
  } else if (cat === 'auditoria') {
    // Quem criou/editou/excluiu o quê no dia, escopado pela(s) loja(s) do usuário.
    // O selo (status) faz a cor da ação: criar=ok, editar=warn, excluir=err.
    const { data } = await supabase.from('audit_log')
      .select('created_at, user_nome, acao, entidade, entidade_id, descricao, loja_id')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim)
      .order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { created_at: string; user_nome: string | null; acao: string; entidade: string; entidade_id: string | null; descricao: string | null; loja_id: number | null }[]
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    const seloAcao: Record<string, { label: string; tom: Tom }> = {
      criar: { label: 'Criação', tom: 'ok' },
      editar: { label: 'Edição', tom: 'warn' },
      excluir: { label: 'Exclusão', tom: 'err' },
    }
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Pessoa' }, { label: 'Item' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.auditoria,
      linhas: rows.map((a) => ({
        celulas: [
          horaBahia(a.created_at),
          a.user_nome || 'Sistema',
          `${a.entidade}${a.descricao ? ` ${a.descricao}` : a.entidade_id ? ` #${a.entidade_id}` : ''}`,
          ...(lojas ? [a.loja_id ? lojas.get(a.loja_id) ?? '-' : '-'] : []),
        ],
        status: seloAcao[a.acao] ?? { label: a.acao, tom: 'neutro' },
      })),
    }
    const auditPessoa = new Map<string, number>()
    for (const a of rows) auditPessoa.set(a.user_nome || 'Sistema', (auditPessoa.get(a.user_nome || 'Sistema') ?? 0) + 1)
    lista.grafico = { titulo: 'Por pessoa', unidade: 'num', itens: topN(auditPessoa) }
  }

  return lista
}

export const CATEGORIA_LABEL: Record<CategoriaKey, string> = {
  notas: 'Notas Fiscais', transferencias: 'Transferências', inventarios: 'Inventários',
  producao: 'Produção', movimentacoes: 'Movimentações', etiquetas: 'Etiquetas', erros: 'Erros',
  auditoria: 'Auditoria',
}
export const CATEGORIA_ORDEM: CategoriaKey[] = [
  'notas', 'transferencias', 'inventarios', 'producao', 'movimentacoes', 'etiquetas', 'erros', 'auditoria',
]

// Relatório COMPLETO do dia: contagem + a lista de TODAS as categorias (para o PDF).
export async function carregarResumoDiaCompleto(lojaIds: number[], dataISO: string) {
  const base = await carregarResumoDia(lojaIds, dataISO, 'notas')
  const { contagem, multiLoja } = base
  const supabase = createServiceClient()
  const listas: { cat: CategoriaKey; label: string; lista: CategoriaLista }[] = []
  for (const c of CATEGORIA_ORDEM) {
    const lista = c === 'notas' ? base.lista : await listarCategoria(supabase, lojaIds, dataISO, c, contagem, multiLoja)
    listas.push({ cat: c, label: CATEGORIA_LABEL[c], lista })
  }
  return { contagem, multiLoja, listas }
}

export type ItemAcao = { titulo: string; tom: 'err' | 'warn' | 'info'; contagem: number; href: string }

// Painel de acao: pendencias que precisam de decisao HOJE, rankeadas
// err > warn > info. Sempre escopado pelas mesmas lojaIds do resumo.
export async function carregarPainelAcao(lojaIds: number[]): Promise<ItemAcao[]> {
  if (!lojaIds.length) return []
  const supabase = createServiceClient()
  const hojeISO = hojeBahia()
  const itens: ItemAcao[] = []

  // 1. Erros de integracao que exigem acao (classificador ja existe).
  const { data: errosRaw } = await supabase
    .from('integration_attempts')
    .select('error_message')
    .in('loja_id', lojaIds)
    .eq('error', true)
    .gte('created_at', `${hojeISO}T00:00:00.000Z`)
  const errosAcao = (errosRaw ?? []).filter((e) => explicarErroOmie(e.error_message as string | null)?.tipo === 'acao')
  if (errosAcao.length) itens.push({ titulo: 'Erros que precisam de ação', tom: 'err', contagem: errosAcao.length, href: '/log' })

  // 2. NF travada (etapa < 60 ha mais de 24h).
  const ontemISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const { count: nfTravada } = await supabase
    .from('notas_fiscais')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .is('deleted_at', null)
    .neq('c_etapa', '60')
    .lte('d_emissao_nfe', ontemISO)
  if (nfTravada) itens.push({ titulo: 'Notas fiscais travadas (etapa não concluída)', tom: 'warn', contagem: nfTravada, href: '/nota-fiscal?status=40' })

  // 3. OP atrasada (previsao passou, nao concluida).
  const { count: opAtrasada } = await supabase
    .from('ordens_producao')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .lt('identificacao_d_dt_previsao', hojeISO)
    .eq('concluida', false)
  if (opAtrasada) itens.push({ titulo: 'Ordens de produção atrasadas', tom: 'warn', contagem: opAtrasada, href: '/ordem-producao?status=atrasada' })

  // 4. Vencendo em 7 dias / vencido (mesma logica de /validade).
  const em7dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const { count: vencendo } = await supabase
    .from('ordens_producao')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .not('validade', 'is', null)
    .lte('validade', em7dias)
    .gt('quantidade', 0)
  if (vencendo) itens.push({ titulo: 'Produtos vencendo em até 7 dias (ou vencidos)', tom: 'warn', contagem: vencendo, href: '/validade?dias=7' })

  // 5. Contagem de inventario pendente (30 dias, mesma janela do painel de auditoria).
  const { data: locaisRows } = await supabase.from('local_estoques').select('codigo_local_estoque').in('loja_id', lojaIds).neq('inativo', 'S')
  const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: inventRecentes } = await supabase
    .from('inventarios')
    .select('codigo_local_estoque')
    .in('loja_id', lojaIds)
    .gte('created_at', trintaDiasAtras)
  const locaisComContagem = new Set((inventRecentes ?? []).map((i) => i.codigo_local_estoque))
  const semContagem = (locaisRows ?? []).filter((l) => !locaisComContagem.has(l.codigo_local_estoque)).length
  if (semContagem) itens.push({ titulo: 'Locais sem contagem de inventário há 30 dias', tom: 'info', contagem: semContagem, href: '/resumo?cat=auditoria' })

  // 6. Pendencias de classificacao (produtos sem familia).
  const { count: semFamilia } = await supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).in('loja_id', lojaIds).or('descricao_familia.is.null,descricao_familia.eq.')
  if (semFamilia) itens.push({ titulo: 'Produtos sem família cadastrada', tom: 'info', contagem: semFamilia, href: '/pendencias-classificacao' })

  const ORDEM_TOM: Record<ItemAcao['tom'], number> = { err: 0, warn: 1, info: 2 }
  return itens.sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom])
}
