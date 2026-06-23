// Parser das abas-resumo do export FAT_DRV do Omie (faturamento). Função PURA:
// recebe as abas já lidas (nome + matriz de células) e devolve linhas
// (dimensao, rotulo, mes, valor). Não depende de exceljs — o caller lê o xlsx.
//
// As abas-resumo são tabelas dinâmicas: algumas linhas de filtro no topo, uma
// linha de cabeçalho com os meses (jan, fev, ...) e o rótulo da dimensão na 1ª
// coluna, e as linhas de dados abaixo até "Total Geral".

export type DimensaoFat = 'tipo' | 'familia' | 'forma_pgto'
export interface LinhaFat {
  dimensao: DimensaoFat
  rotulo: string
  mes: string // 'YYYY-MM'
  valor: number
}
export interface AbaLida {
  nome: string
  linhas: (string | number | null)[][] // [linha][coluna], 0-based, valores crus
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
}

// Mapeia o nome da aba -> dimensão (tolerante a typo/acentos/espaços do Ramon).
function dimDaAba(nome: string): DimensaoFat | null {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/forma de pg|forma de pag|pgto|pagamento/.test(n)) return 'forma_pgto'
  if (/fat.*fam|por fam/.test(n)) return 'familia'
  if (/fat.*tipo|tipo de prod|por tipo/.test(n)) return 'tipo'
  return null
}

const txt = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const mesDe = (v: unknown): string | null => MESES[txt(v).toLowerCase().slice(0, 3)] ?? null
// Número pt-BR ou já numérico; lixo vira NaN.
function num(v: unknown): number {
  if (typeof v === 'number') return v
  const s = txt(v).replace(/[^\d,.-]/g, '')
  if (!s) return NaN
  // se tem vírgula, assume pt-BR (vírgula decimal); senão ponto decimal
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return n
}

// Parseia UMA aba (já sabida a dimensão). Acha a linha de cabeçalho (a que tem
// 'jan' seguido de 'fev'), descobre as colunas dos meses e lê os dados.
function parseAba(linhas: AbaLida['linhas'], dimensao: DimensaoFat, ano: number): LinhaFat[] {
  let hdr = -1
  let janCol = -1
  for (let r = 0; r < Math.min(linhas.length, 20); r++) {
    const row = linhas[r] ?? []
    const j = row.findIndex((c) => mesDe(c) === '01')
    if (j >= 0 && mesDe(row[j + 1]) === '02') {
      hdr = r
      janCol = j
      break
    }
  }
  if (hdr < 0) return []

  const header = linhas[hdr]
  // colunas de mês: a partir de janCol enquanto for nome de mês
  const mesCols: { col: number; mm: string }[] = []
  for (let c = janCol; c < header.length; c++) {
    const mm = mesDe(header[c])
    if (mm) mesCols.push({ col: c, mm })
    else if (/total\s*geral/i.test(txt(header[c]))) break
  }
  const rotCol = janCol - 1 < 0 ? 0 : janCol - 1

  const out: LinhaFat[] = []
  for (let r = hdr + 1; r < linhas.length; r++) {
    const row = linhas[r] ?? []
    const rotulo = txt(row[rotCol])
    if (!rotulo) continue
    if (/total\s*geral/i.test(rotulo)) break
    for (const { col, mm } of mesCols) {
      const v = num(row[col])
      if (Number.isFinite(v) && v !== 0) {
        out.push({ dimensao, rotulo, mes: `${ano}-${mm}`, valor: Number(v.toFixed(2)) })
      }
    }
  }
  return out
}

/**
 * Parseia o export FAT_DRV: varre as abas, pega as de resumo conhecidas
 * (Fat por família / por tipo / por forma de pgto) e devolve as linhas agregadas.
 */
export function parseFaturamentoResumo(abas: AbaLida[], ano: number): LinhaFat[] {
  const out: LinhaFat[] = []
  const vistos = new Set<DimensaoFat>()
  for (const aba of abas) {
    const dim = dimDaAba(aba.nome)
    if (!dim || vistos.has(dim)) continue
    const linhas = parseAba(aba.linhas, dim, ano)
    if (linhas.length) {
      out.push(...linhas)
      vistos.add(dim)
    }
  }
  return out
}
