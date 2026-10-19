// Histórico de alterações (Fase G [O3], migration 220): transforma as linhas cruas de historico_alteracoes em
// "momentos" legíveis (quem, quando, o que mudou). Puro (sem @/): node --test lib/historico/*.test.ts
//
// Regras:
// - um momento = uma transação (txid) de um autor; mais novo primeiro;
// - por (tabela, linha): valor inicial = 1º "de" (delete/update) e valor final = último "para" (insert/update);
//   existia antes e existe depois → "alterou" só com os campos cujo início ≠ fim (apagar e recriar igual, como o
//   pc_salvar faz com os itens do rascunho, some); só depois → "criou"/"item incluído"; só antes → "excluiu"/"item removido".

export type LinhaHistorico = {
  id: number
  tabela: string
  linha: string | null
  operacao: 'insert' | 'update' | 'delete'
  campo: string | null
  valor_de: string | null
  valor_para: string | null
  autor_nome: string | null
  origem: 'app' | 'sistema'
  txid: number
  created_at: string
}

export type Formato = 'texto' | 'numero' | 'moeda' | 'data' | 'codigo'
export type RotulosEntidade = {
  tabelaPrincipal: string
  campos: Record<string, { rotulo: string; formato?: Formato }>
}

export type Mudanca = { campo: string; rotulo: string; de: string; para: string }
export type TipoItem = 'criou' | 'alterou' | 'excluiu' | 'item_incluido' | 'item_alterado' | 'item_removido'
export type ItemMomento = { tipo: TipoItem; linha: string | null; titulo: string; mudancas: Mudanca[] }
export type MomentoHistorico = { quando: string; autor: string; origem: 'app' | 'sistema'; itens: ItemMomento[] }

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_HORA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/
const RE_NUM = /^-?\d+(\.\d+)?$/

export function formatarValor(valor: string | null | undefined, formato?: Formato): string {
  if (valor == null || valor === '') return '—'
  if (valor === 'true') return 'Sim'
  if (valor === 'false') return 'Não'
  const d = valor.match(RE_DATA)
  if (d) return `${d[3]}/${d[2]}/${d[1]}`
  if ((formato === 'numero' || formato === 'moeda') && RE_NUM.test(valor)) {
    const n = Number(valor)
    return formato === 'moeda'
      ? `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
  }
  if (formato === 'data' || (formato !== 'codigo' && RE_HORA.test(valor))) {
    const h = valor.match(RE_HORA)
    if (h) {
      const dt = new Date(valor)
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      }
    }
  }
  return valor
}

function rotuloDoCampo(campo: string, rot: RotulosEntidade): { rotulo: string; formato?: Formato } {
  const r = rot.campos[campo]
  if (r) return r
  const ultimo = campo.split('.').pop() ?? campo
  const humano = ultimo.replace(/_/g, ' ')
  return { rotulo: humano.charAt(0).toUpperCase() + humano.slice(1) }
}

type Grupo = { tabela: string; linha: string | null; linhas: LinhaHistorico[] }

function itemDoGrupo(g: Grupo, rot: RotulosEntidade, rotuloLinha?: (linha: string, valores: Record<string, string | null>) => string): ItemMomento | null {
  const principal = g.tabela === rot.tabelaPrincipal && g.linha == null
  const antes = g.linhas.some((x) => x.operacao !== 'insert')
  const depois = g.linhas.some((x) => x.operacao !== 'delete')
  const inicio = new Map<string, string | null>()
  const fim = new Map<string, string | null>()
  for (const x of [...g.linhas].sort((a, b) => a.id - b.id)) {
    if (x.campo == null) continue
    if (x.operacao !== 'insert' && !inicio.has(x.campo)) inicio.set(x.campo, x.valor_de)
    if (x.operacao !== 'delete') fim.set(x.campo, x.valor_para)
  }
  const campos = [...new Set(g.linhas.filter((x) => x.campo != null).sort((a, b) => a.id - b.id).map((x) => x.campo as string))]
  const mud = (de: (c: string) => string | null, para: (c: string) => string | null, so?: (c: string) => boolean): Mudanca[] =>
    campos.filter((c) => !so || so(c)).map((c) => {
      const { rotulo, formato } = rotuloDoCampo(c, rot)
      return { campo: c, rotulo, de: formatarValor(de(c), formato), para: formatarValor(para(c), formato) }
    })

  let tipo: TipoItem
  let mudancas: Mudanca[]
  if (!antes && depois) {
    tipo = principal ? 'criou' : 'item_incluido'
    mudancas = mud(() => null, (c) => fim.get(c) ?? null, (c) => (fim.get(c) ?? null) != null)
  } else if (antes && !depois) {
    tipo = principal ? 'excluiu' : 'item_removido'
    mudancas = mud((c) => inicio.get(c) ?? null, () => null, (c) => (inicio.get(c) ?? null) != null)
  } else {
    tipo = principal ? 'alterou' : 'item_alterado'
    mudancas = mud((c) => inicio.get(c) ?? null, (c) => fim.get(c) ?? null, (c) => (inicio.get(c) ?? null) !== (fim.get(c) ?? null))
    if (!mudancas.length) return null
  }
  const valores: Record<string, string | null> = {}
  for (const c of campos) valores[c] = fim.get(c) ?? inicio.get(c) ?? null
  const titulo = principal ? '' : rotuloLinha && g.linha != null ? rotuloLinha(g.linha, valores) : `Item ${g.linha ?? ''}`.trim()
  return { tipo, linha: g.linha, titulo, mudancas }
}

const ORDEM_TIPO: Record<TipoItem, number> = { criou: 0, alterou: 1, excluiu: 2, item_incluido: 3, item_alterado: 4, item_removido: 5 }

export function consolidarHistorico(
  linhas: LinhaHistorico[],
  rot: RotulosEntidade,
  rotuloLinha?: (linha: string, valores: Record<string, string | null>) => string,
): MomentoHistorico[] {
  const porMomento = new Map<string, LinhaHistorico[]>()
  for (const x of linhas) {
    const k = JSON.stringify([x.txid, x.autor_nome ?? '', x.origem])
    porMomento.set(k, [...(porMomento.get(k) ?? []), x])
  }
  const momentos: (MomentoHistorico & { _ordem: number })[] = []
  for (const grupoLinhas of porMomento.values()) {
    const grupos = new Map<string, Grupo>()
    for (const x of grupoLinhas) {
      const k = JSON.stringify([x.tabela, x.linha])
      const g = grupos.get(k) ?? { tabela: x.tabela, linha: x.linha, linhas: [] }
      g.linhas.push(x)
      grupos.set(k, g)
    }
    const itens = [...grupos.values()]
      .map((g) => itemDoGrupo(g, rot, rotuloLinha))
      .filter((i): i is ItemMomento => i != null)
      .sort((a, b) => ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo] || Number(a.linha ?? 0) - Number(b.linha ?? 0))
    if (!itens.length) continue
    const primeira = grupoLinhas.reduce((a, b) => (a.id < b.id ? a : b))
    momentos.push({
      quando: primeira.created_at,
      autor: primeira.autor_nome || (primeira.origem === 'app' ? 'Usuário' : 'Sistema'),
      origem: primeira.origem,
      itens,
      _ordem: Math.max(...grupoLinhas.map((x) => x.id)),
    })
  }
  return momentos.sort((a, b) => b._ordem - a._ordem).map(({ _ordem, ...m }) => { void _ordem; return m })
}

// ---------------------------------------------------------------------------------------------------- ficha técnica
// Histórico da ficha técnica do estoque próprio. Não precisa de gatilho: cada gravação já cria uma versão nova
// (fichas_tecnicas + ficha_tecnica_itens, itens imutáveis, migration 133); o histórico é a diferença entre versões
// consecutivas. Fica neste arquivo porque módulo puro não importa valor de outro com .ts (tsc).

export type ItemVersao = { codigoInsumo: number; quantidadeLiquida: number; fatorCorrecao: number; perdaPct: number }
export type VersaoFicha = {
  versao: number
  rendimento: number
  expandirNaVenda: boolean
  obs: string | null
  ativa: boolean
  criadaPor: string | null
  criadaEm: string
  itens: ItemVersao[]
}

const num = (n: number) => formatarValor(String(n), 'numero')
const CAMPOS_ITEM: { chave: keyof ItemVersao; rotulo: string }[] = [
  { chave: 'quantidadeLiquida', rotulo: 'Quantidade líquida' },
  { chave: 'fatorCorrecao', rotulo: 'Fator de correção' },
  { chave: 'perdaPct', rotulo: 'Perda (%)' },
]

function valoresItem(i: ItemVersao): Mudanca[] {
  return CAMPOS_ITEM.map((c) => ({ campo: c.chave, rotulo: c.rotulo, de: '—', para: num(i[c.chave] as number) }))
}

export function diffVersoesFicha(versoes: VersaoFicha[], nomeInsumo: (codigo: number) => string): MomentoHistorico[] {
  const ordenadas = [...versoes].sort((a, b) => a.versao - b.versao)
  const out: MomentoHistorico[] = []
  ordenadas.forEach((atual, idx) => {
    const ant = idx > 0 ? ordenadas[idx - 1] : null
    const itens: ItemMomento[] = []
    if (!ant) {
      itens.push({ tipo: 'criou', linha: null, titulo: '', mudancas: [
        { campo: 'versao', rotulo: 'Versão', de: '—', para: String(atual.versao) },
        { campo: 'rendimento', rotulo: 'Rendimento', de: '—', para: num(atual.rendimento) },
      ] })
      for (const i of atual.itens) itens.push({ tipo: 'item_incluido', linha: String(i.codigoInsumo), titulo: nomeInsumo(i.codigoInsumo), mudancas: valoresItem(i) })
    } else {
      const cab: Mudanca[] = [{ campo: 'versao', rotulo: 'Versão', de: String(ant.versao), para: String(atual.versao) }]
      if (ant.rendimento !== atual.rendimento) cab.push({ campo: 'rendimento', rotulo: 'Rendimento', de: num(ant.rendimento), para: num(atual.rendimento) })
      if (ant.expandirNaVenda !== atual.expandirNaVenda) cab.push({ campo: 'expandir_na_venda', rotulo: 'Baixar os insumos na venda', de: formatarValor(String(ant.expandirNaVenda)), para: formatarValor(String(atual.expandirNaVenda)) })
      if ((ant.obs ?? '') !== (atual.obs ?? '')) cab.push({ campo: 'obs', rotulo: 'Observação', de: formatarValor(ant.obs), para: formatarValor(atual.obs) })
      // A versão sempre muda; se só ela mudou e nada mais, mostra a regravação mesmo assim (alguém salvou).
      itens.push({ tipo: 'alterou', linha: null, titulo: '', mudancas: cab.length > 1 ? cab.slice(1) : cab })
      const antPor = new Map(ant.itens.map((i) => [i.codigoInsumo, i]))
      const atuPor = new Map(atual.itens.map((i) => [i.codigoInsumo, i]))
      for (const i of atual.itens) {
        const a = antPor.get(i.codigoInsumo)
        if (!a) {
          itens.push({ tipo: 'item_incluido', linha: String(i.codigoInsumo), titulo: nomeInsumo(i.codigoInsumo), mudancas: valoresItem(i) })
          continue
        }
        const m = CAMPOS_ITEM.filter((c) => a[c.chave] !== i[c.chave])
          .map((c) => ({ campo: c.chave, rotulo: c.rotulo, de: num(a[c.chave] as number), para: num(i[c.chave] as number) }))
        if (m.length) itens.push({ tipo: 'item_alterado', linha: String(i.codigoInsumo), titulo: nomeInsumo(i.codigoInsumo), mudancas: m })
      }
      for (const a of ant.itens) {
        if (!atuPor.has(a.codigoInsumo)) {
          itens.push({ tipo: 'item_removido', linha: String(a.codigoInsumo), titulo: nomeInsumo(a.codigoInsumo),
            mudancas: CAMPOS_ITEM.map((c) => ({ campo: c.chave, rotulo: c.rotulo, de: num(a[c.chave] as number), para: '—' })) })
        }
      }
    }
    out.push({ quando: atual.criadaEm, autor: atual.criadaPor || 'Sistema', origem: atual.criadaPor ? 'app' : 'sistema', itens })
  })
  return out.reverse()
}
