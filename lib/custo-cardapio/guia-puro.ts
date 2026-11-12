// Norte Cozinha, Guia de preparo: passos do modo de preparo, escala das quantidades e validação da ficha de preparo
// (texto e foto). PURO (sem banco, sem alias do Next), testado por node --test. Nada aqui grava nada.

/** Limites iguais aos da migration 474 (custo_receita_info). */
export const LIMITES_RECEITA = { modoPreparo: 20000, observacoes: 5000, tempoMin: 10000, rendimentoTexto: 200 } as const
export const LIMITE_FOTO_BYTES = 5 * 1024 * 1024

// "1.", "1)", "1 -", "1:", "Passo 1:", "Passo 1 -", "- ", "• ", "* "
const PREFIXO_PASSO = /^\s*(?:(?:passo|etapa)\s*\d+\s*[.):\-–—]?\s*|\d+\s*[.):\-–—]\s*|\d+º\s*[.):\-–—]?\s*|[-–—•*·]\s+)/i

/** Passos do modo de preparo: um por linha (linhas vazias e numeração digitada à mão saem). */
export function passosDoTexto(texto: string | null | undefined): string[] {
  if (!texto) return []
  return texto.replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(PREFIXO_PASSO, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export type DadosReceita = { modoPreparo: string; observacoes: string; tempoPreparoMin: string | number | null; rendimentoTexto: string }
export type ReceitaValida = { modo_preparo: string | null; observacoes: string | null; tempo_preparo_min: number | null; rendimento_texto: string | null }

const textoOuNull = (v: unknown) => {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s ? s : null
}

/** Valida e normaliza o que vem da tela antes de gravar. */
export function validarReceita(d: DadosReceita): { ok: true; row: ReceitaValida } | { ok: false; erro: string } {
  const modo = textoOuNull(d?.modoPreparo)
  if (modo && modo.length > LIMITES_RECEITA.modoPreparo) return { ok: false, erro: 'O modo de preparo passou de 20.000 caracteres.' }
  const obs = textoOuNull(d?.observacoes)
  if (obs && obs.length > LIMITES_RECEITA.observacoes) return { ok: false, erro: 'As observações passaram de 5.000 caracteres.' }
  const rend = textoOuNull(d?.rendimentoTexto)?.replace(/\s+/g, ' ') ?? null
  if (rend && rend.length > LIMITES_RECEITA.rendimentoTexto) return { ok: false, erro: 'O rendimento passou de 200 caracteres.' }
  const t = d?.tempoPreparoMin
  let tempo: number | null = null
  if (t != null && String(t).trim() !== '') {
    const n = Number(String(t).trim().replace(',', '.'))
    if (!Number.isInteger(n) || n < 0 || n > LIMITES_RECEITA.tempoMin) return { ok: false, erro: 'Tempo de preparo inválido: use minutos inteiros (até 10.000).' }
    tempo = n
  }
  return { ok: true, row: { modo_preparo: modo, observacoes: obs, tempo_preparo_min: tempo, rendimento_texto: rend } }
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatarTempo(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min <= 0) return null
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

export type TipoFoto = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' }

/** Tipo da foto pelo conteúdo (não pelo nome nem pelo que o navegador diz). */
export function tipoDaFoto(b: Uint8Array): TipoFoto | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return { mime: 'image/png', ext: 'png' }
  const asc = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
  if (b.length >= 12 && asc(0, 4) === 'RIFF' && asc(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

export function validarFoto(bytes: Uint8Array): { ok: true; tipo: TipoFoto } | { ok: false; erro: string } {
  if (!bytes.length) return { ok: false, erro: 'Selecione uma foto.' }
  if (bytes.length > LIMITE_FOTO_BYTES) return { ok: false, erro: 'Foto muito grande: o limite é 5 MB.' }
  const tipo = tipoDaFoto(bytes)
  if (!tipo) return { ok: false, erro: 'Use uma foto JPG, PNG ou WebP.' }
  return { ok: true, tipo }
}

/** Caminho no bucket cozinha-fotos: <loja>/<produto>-<momento>.<ext> (nome novo a cada troca: sem cache velho). */
export const caminhoFoto = (lojaId: number, codigo: number, momento: number, ext: TipoFoto['ext']) => `${lojaId}/${codigo}-${momento}.${ext}`

/** A foto é desta loja e deste produto (antes de apagar um caminho que veio do banco). */
export const fotoEhDe = (path: string | null | undefined, lojaId: number, codigo: number) =>
  !!path && new RegExp(`^${lojaId}/${codigo}-\\d+\\.(jpg|png|webp)$`).test(path)

// ---- Escala ----

/** Porções do prato num evento, com a folga de produção: convidados × porções por convidado × (1 + folga/100). */
export function porcoesEvento(convidados: number, porcoesPorConvidado: number, folgaPct: number): number {
  const c = Math.max(Number(convidados) || 0, 0)
  const p = Math.max(Number(porcoesPorConvidado) || 0, 0)
  const f = Math.max(Number(folgaPct) || 0, 0)
  return Math.round(c * p * (1 + f / 100) * 1000) / 1000
}

/** Porções do prato num cardápio (padrão 1). */
export const porcoesCardapio = (porcoes: number | string | null | undefined) => {
  const n = Number(porcoes)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 1
}

export type NoQtd = { codigo: number; quantidade: number; temFicha: boolean; filhos: NoQtd[] }

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Multiplica todas as quantidades da árvore (a escala visual "×N" do guia). */
export function escalarNos<T extends { quantidade: number; filhos: T[] }>(nos: T[], fator: number): T[] {
  const f = Number.isFinite(fator) && fator > 0 ? fator : 1
  if (f === 1) return nos
  return nos.map((n) => ({ ...n, quantidade: arred6(n.quantidade * f), filhos: escalarNos(n.filhos, f) }))
}

/** Preparações (nós com ficha) que as árvores pedem, somadas por produto, na ordem em que aparecem. */
export function preparacoesNecessarias(arvores: NoQtd[][]): Map<number, number> {
  const out = new Map<number, number>()
  const andar = (nos: NoQtd[]) => {
    for (const n of nos) {
      if (n.temFicha) out.set(n.codigo, arred6((out.get(n.codigo) ?? 0) + n.quantidade))
      if (n.filhos.length) andar(n.filhos)
    }
  }
  for (const a of arvores) andar(a)
  return out
}

/** Lê o "×N" digitado (aceita vírgula). Inválido = 1. */
export function lerEscala(s: string): number {
  const n = Number(String(s ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : 1
}

/** Contexto do guia na URL: "e12" = evento 12, "c3" = cardápio 3. */
export function lerContexto(v: string | null | undefined): { tipo: 'evento' | 'cardapio'; id: number } | null {
  const m = /^([ec])(\d{1,12})$/.exec(String(v ?? ''))
  if (!m) return null
  const id = Number(m[2])
  return id > 0 ? { tipo: m[1] === 'e' ? 'evento' : 'cardapio', id } : null
}

/** Busca sem acento e sem caixa. */
export const normalizarBusca = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Link do guia mantendo o contexto. */
export function hrefGuia(o: { p?: number | null; ctx?: string | null; b?: number | null; passados?: boolean }): string {
  const q = new URLSearchParams()
  if (o.ctx) q.set('ctx', o.ctx)
  if (o.p != null) q.set('p', String(o.p))
  if (o.b != null && Number.isFinite(o.b) && o.b > 0) q.set('b', String(Math.round(o.b * 1e6) / 1e6))
  if (o.passados) q.set('passados', '1')
  const s = q.toString()
  return s ? `/cozinha/guia?${s}` : '/cozinha/guia'
}
