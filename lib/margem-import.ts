// Parser da aba "MARGEM" do export FAT_DRV do Omie (margem por produto). Função
// PURA. A aba é uma tabela dinâmica: filtros no topo, uma linha com os meses (cada
// mês ocupa 3 colunas: PDV - Valor Unit, CMC Atual, % Margem) e, abaixo, uma linha
// por produto (Família | Código | Descrição | [PDV CMC Margem] por mês).
//
// A % Margem é a que o Ramon já calcula (a fórmula dele inclui custos que não
// aparecem na planilha), então guardamos o valor DELE, sem recalcular.

export interface LinhaMargem {
  codigo: string
  descricao: string
  familia: string
  mes: string // 'YYYY-MM'
  pdv: number | null
  cmc: number | null
  margem: number | null // % margem do export (null quando #DIV/0!)
}
export interface AbaLida {
  nome: string
  linhas: (string | number | null)[][]
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
}

const txt = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
// minúsculo + sem acento (detecção de cabeçalho robusta a acento/encoding).
const norm = (v: unknown): string => txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const mesDe = (v: unknown): string | null => MESES[txt(v).toLowerCase().slice(0, 3)] ?? null

// Número pt-BR/numérico; erros de fórmula ("#DIV/0!", "#N/D") e texto viram NaN.
function num(v: unknown): number {
  if (typeof v === 'number') return v
  const raw = txt(v)
  if (!raw || /[a-z#]/i.test(raw)) return NaN // "#DIV/0!", "#N/D" etc.
  const s = raw.replace(/[^\d,.-]/g, '')
  if (!s) return NaN
  return s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
}
const orNull = (n: number): number | null => (Number.isFinite(n) ? n : null)

const abaMargem = (nome: string): boolean => /margem/i.test(nome.normalize('NFD').replace(/[̀-ͯ]/g, ''))

function parseMargem(linhas: AbaLida['linhas'], ano: number): LinhaMargem[] {
  // Linha de cabeçalho dos produtos: a que tem "Código" e "Descrição".
  let hdr = -1
  let codigoCol = -1
  let descCol = -1
  for (let r = 0; r < Math.min(linhas.length, 15); r++) {
    const row = linhas[r] ?? []
    const cc = row.findIndex((c) => /codigo/.test(norm(c)))
    const dc = row.findIndex((c) => /descri/.test(norm(c)))
    if (cc >= 0 && dc >= 0) { hdr = r; codigoCol = cc; descCol = dc; break }
  }
  if (hdr < 0) return []

  // Os meses ficam na linha de cima, no 1º subcampo (PDV) de cada bloco de 3.
  const linhaMes = linhas[hdr - 1] ?? []
  const blocos: { mm: string; pdv: number; cmc: number; mar: number }[] = []
  for (let pdv = descCol + 1; pdv < 240; pdv += 3) {
    const mm = mesDe(linhaMes[pdv])
    if (!mm) break // meses contíguos; para no fim dos blocos
    blocos.push({ mm, pdv, cmc: pdv + 1, mar: pdv + 2 })
  }
  if (!blocos.length) return []

  const out: LinhaMargem[] = []
  let familia = ''
  for (let r = hdr + 1; r < linhas.length; r++) {
    const row = linhas[r] ?? []
    const fam = txt(row[0])
    if (fam) familia = fam // célula mesclada: vem só na 1ª linha do grupo
    const codigo = txt(row[codigoCol])
    const descricao = txt(row[descCol])
    if (!codigo) continue
    if (/total\s*geral/i.test(codigo) || /total\s*geral/i.test(fam)) break
    for (const b of blocos) {
      const pdv = orNull(num(row[b.pdv]))
      if (pdv == null || pdv === 0) continue // sem venda no mês -> ignora
      out.push({
        codigo,
        descricao,
        familia,
        mes: `${ano}-${b.mm}`,
        pdv,
        cmc: orNull(num(row[b.cmc])),
        margem: orNull(num(row[b.mar])),
      })
    }
  }
  return out
}

/** Parseia o export FAT_DRV: acha a aba "MARGEM" e devolve a margem por produto/mês. */
export function parseMargemProduto(abas: AbaLida[], ano: number): LinhaMargem[] {
  for (const aba of abas) {
    if (!abaMargem(aba.nome)) continue
    const linhas = parseMargem(aba.linhas, ano)
    if (linhas.length) return linhas
  }
  return []
}
