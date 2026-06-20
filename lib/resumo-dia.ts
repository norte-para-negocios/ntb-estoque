import { createServiceClient } from '@/lib/supabase/server'
import { statusInfo } from '@/lib/status-cor'
import { explicarErroOmie } from '@/lib/erro-omie-amigavel'
import { formatarNomeProduto } from '@/lib/formatar-nome'

// "Resumo do dia" — painel gerencial. Consulta ao vivo, escopado por loja, para um
// dia (fuso America/Bahia, UTC-3). Organizado por CATEGORIA: cada uma tem a sua
// contagem e a sua lista. O painel mostra os números de todas e a lista da escolhida.

export type CategoriaKey =
  | 'notas' | 'transferencias' | 'inventarios' | 'producao' | 'movimentacoes' | 'etiquetas' | 'erros'

export type Tom = 'ok' | 'warn' | 'err' | 'info' | 'neutro'

export type LinhaCategoria = {
  celulas: (string | null)[]
  status?: { label: string; tom: Tom } | null
}

export type CategoriaLista = {
  colunas: { label: string; alinharDir?: boolean }[]
  linhas: LinhaCategoria[]
  total: number // total real (a lista pode estar capada)
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
    opsPrevistas: 0, opsConcluidas: 0, movEntradas: 0, movSaidas: 0, etiquetas: 0, erros: 0,
  }
  if (!lojaIds.length) return { contagem: contagemVazia, cat, lista: vazia, multiLoja: false }

  const supabase = createServiceClient()
  const { ini, fim } = janelaDiaBahia(dataISO)
  const proxDia = proximoDiaISO(dataISO)
  const multiLoja = lojaIds.length > 1

  // --- CONTAGENS (todas, baratas) ---
  const [
    notasRows, transfCount, inventCount, opsPrevCount, opsConclCount, movRows, etiqRows, errosCount,
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
  } else if (cat === 'producao') {
    // Só o que foi PRODUZIDO no dia (OPs concluídas), agrupado por produto. As
    // "previstas" NÃO entram: previsão é plano, não atividade do dia.
    const { data } = await supabase.from('ordens_producao')
      .select('identificacao_n_cod_produto, identificacao_n_qtde, produto_descricao')
      .in('loja_id', lojaIds).eq('dt_conclusao_real', dataISO).limit(5000)
    const rows = (data ?? []) as { identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; produto_descricao: string | null }[]
    // Nome do produto: OPs do Omie vêm sem produto_descricao -> resolve pelo código.
    const codigos = [...new Set(rows.map((r) => r.identificacao_n_cod_produto).filter((v) => v != null) as number[])]
    const nomeProd = new Map<number, string>()
    if (codigos.length) {
      const { data: prods } = await supabase.from('produtos').select('codigo_produto, descricao').in('loja_id', lojaIds).in('codigo_produto', codigos)
      for (const p of (prods ?? []) as { codigo_produto: number; descricao: string }[]) nomeProd.set(p.codigo_produto, formatarNomeProduto(p.descricao))
    }
    const grupo = new Map<string, { produto: string; qtd: number; ops: number }>()
    for (const o of rows) {
      const produto = o.produto_descricao
        ? formatarNomeProduto(o.produto_descricao)
        : o.identificacao_n_cod_produto != null
          ? nomeProd.get(o.identificacao_n_cod_produto) ?? `Produto ${o.identificacao_n_cod_produto}`
          : '-'
      const g = grupo.get(produto) ?? { produto, qtd: 0, ops: 0 }
      g.qtd += Number(o.identificacao_n_qtde ?? 0)
      g.ops += 1
      grupo.set(produto, g)
    }
    const grupos = [...grupo.values()].sort((a, b) => b.qtd - a.qtd)
    lista = {
      colunas: [{ label: 'Produto' }, { label: 'OPs', alinharDir: true }, { label: 'Produzido', alinharDir: true }],
      total: grupos.length,
      linhas: grupos.map((g) => ({
        celulas: [g.produto, fmtNum(g.ops), fmtNum(g.qtd)],
        status: null,
      })),
    }
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
  } else if (cat === 'erros') {
    const { data } = await supabase.from('integration_attempts')
      .select('id, loja_id, model, error_message, created_at').in('loja_id', lojaIds).eq('error', true)
      .gte('created_at', ini).lt('created_at', fim).order('created_at', { ascending: false }).limit(LIMITE_LISTA)
    const rows = (data ?? []) as { loja_id: number; model: string | null; error_message: string | null; created_at: string }[]
    const lojas = multiLoja ? await nomesLojas(supabase, lojaIds) : null
    lista = {
      colunas: [{ label: 'Hora' }, { label: 'Origem' }, { label: 'Problema' }, ...(lojaTag ? [lojaTag] : [])],
      total: contagem.erros,
      linhas: rows.map((er) => {
        const exp = explicarErroOmie(er.error_message)
        return {
          celulas: [horaBahia(er.created_at), er.model ?? '-', exp?.titulo ?? 'Erro',
            ...(lojas ? [lojas.get(er.loja_id) ?? '-'] : [])],
          status: exp ? { label: exp.tipo === 'acao' ? 'Resolver' : exp.tipo === 'transitorio' ? 'Temporário' : 'Info', tom: exp.tipo === 'acao' ? 'err' : exp.tipo === 'transitorio' ? 'warn' : 'neutro' } : null,
        }
      }),
    }
  }

  return lista
}

export const CATEGORIA_LABEL: Record<CategoriaKey, string> = {
  notas: 'Notas Fiscais', transferencias: 'Transferências', inventarios: 'Inventários',
  producao: 'Produção', movimentacoes: 'Movimentações', etiquetas: 'Etiquetas', erros: 'Erros',
}
export const CATEGORIA_ORDEM: CategoriaKey[] = [
  'notas', 'transferencias', 'inventarios', 'producao', 'movimentacoes', 'etiquetas', 'erros',
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
