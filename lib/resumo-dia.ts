import { createServiceClient } from '@/lib/supabase/server'
import { statusInfo } from '@/lib/status-cor'
import { explicarErroOmie } from '@/lib/erro-omie-amigavel'
import { formatarNomeProduto } from '@/lib/formatar-nome'

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

export async function carregarResumoDia(lojaIds: number[], dataISO: string, cat: CategoriaKey): Promise<ResumoDia> {
  const contagemVazia: Contagem = {
    notas: 0, valorNotas: 0, transferencias: 0, inventarios: 0,
    opsPrevistas: 0, opsConcluidas: 0, movEntradas: 0, movSaidas: 0, etiquetas: 0, erros: 0, auditoria: 0,
  }
  if (!lojaIds.length) return { contagem: contagemVazia, cat, lista: vazia, multiLoja: false }

  const supabase = createServiceClient()
  const { ini, fim } = janelaDiaBahia(dataISO)
  const proxDia = proximoDiaISO(dataISO)
  const multiLoja = lojaIds.length > 1

  // --- CONTAGENS (todas, baratas) ---
  const [
    notasRows, transfCount, inventCount, opsPrevCount, opsConclCount, movRows, etiqRows, errosCount, auditCount,
  ] = await Promise.all([
    supabase.from('notas_fiscais').select('n_valor_nfe').in('loja_id', lojaIds)
      .gte('d_emissao_nfe', dataISO).lt('d_emissao_nfe', proxDia).is('deleted_at', null),
    supabase.from('transferencias').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('inventarios').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).eq('identificacao_d_dt_previsao', dataISO),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).eq('dt_conclusao_real', dataISO),
    supabase.from('movimentos_historico').select('entradas, saidas').in('loja_id', lojaIds).eq('data', dataISO),
    supabase.from('impressao_etiquetas').select('qtd_etiquetas').in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('integration_attempts').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).eq('error', true).gte('created_at', ini).lt('created_at', fim),
    supabase.from('audit_log').select('id', { count: 'exact', head: true }).in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
  ])

  let movEntradas = 0, movSaidas = 0
  for (const m of (movRows.data ?? []) as { entradas: number | null; saidas: number | null }[]) {
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

  const lista = await listarCategoria(supabase, lojaIds, dataISO, cat, contagem, multiLoja)
  return { contagem, cat, lista, multiLoja }
}

// Monta a lista de UMA categoria (colunas + linhas). Reutilizada pelo painel (uma
// categoria por vez) e pelo PDF completo (todas as categorias do dia).
async function listarCategoria(
  supabase: Supa,
  lojaIds: number[],
  dataISO: string,
  cat: CategoriaKey,
  contagem: Contagem,
  multiLoja: boolean,
): Promise<CategoriaLista> {
  const { ini, fim } = janelaDiaBahia(dataISO)
  const proxDia = proximoDiaISO(dataISO)
  const lojaTag = multiLoja ? { label: 'Loja' } : null
  let lista: CategoriaLista = vazia

  if (cat === 'notas') {
    const { data } = await supabase.from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_nome, c_razao_social, n_valor_nfe, c_etapa, loja_id')
      .in('loja_id', lojaIds).gte('d_emissao_nfe', dataISO).lt('d_emissao_nfe', proxDia).is('deleted_at', null)
      .order('d_emissao_nfe', { ascending: false }).limit(LIMITE_LISTA)
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    const rows = (data ?? []) as { d_emissao_nfe: string; c_numero_nfe: string | null; c_nome: string | null; c_razao_social: string | null; n_valor_nfe: number | null; c_etapa: string | null; loja_id: number }[]
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
    const rows = (data ?? []) as { loja_id: number; codigo_local_origem: number | null; codigo_local_destino: number | null; status: string; created_at: string; user_id: string | null }[]
    const [users, locais, lojas] = await Promise.all([
      nomesUsuarios(supabase, rows.map((r) => r.user_id)),
      nomesLocais(supabase, lojaIds, rows.flatMap((r) => [r.codigo_local_origem, r.codigo_local_destino])),
      multiLoja ? nomesLojas(supabase, lojaIds) : Promise.resolve(null),
    ])
    const loc = (loja: number, c: number | null) => (c != null ? locais.get(`${loja}-${c}`) ?? `Local ${c}` : '-')
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Pessoa' }, { label: 'Origem → Destino' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.transferencias,
      linhas: rows.map((t) => {
        const si = statusInfo(t.status)
        return {
          celulas: [horaBahia(t.created_at), t.user_id ? users.get(t.user_id) ?? 'Sistema' : 'Sistema',
            `${loc(t.loja_id, t.codigo_local_origem)} → ${loc(t.loja_id, t.codigo_local_destino)}`,
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
    const { data } = await supabase.from('ordens_producao')
      .select('identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao')
      .in('loja_id', lojaIds).eq('dt_conclusao_real', dataISO).limit(5000)
    const rows = (data ?? []) as { identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; produto_descricao: string | null }[]
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
    const grupo = new Map<string, { produto: string; tipo: string; qtd: number; ops: number }>()
    for (const o of rows) {
      const produto = o.produto_descricao
        ? formatarNomeProduto(o.produto_descricao)
        : o.identificacao_n_cod_produto != null
          ? nomeProd.get(o.identificacao_n_cod_produto) ?? `Produto ${o.identificacao_n_cod_produto}`
          : '-'
      const tipo = classificar(o.identificacao_n_cod_produto)
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
    const { data } = await supabase.from('movimentos_historico')
      .select('loja_id, codigo, descricao, entradas, saidas').in('loja_id', lojaIds).eq('data', dataISO)
      .order('saidas', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { loja_id: number; codigo: string | null; descricao: string | null; entradas: number | null; saidas: number | null }[]
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
