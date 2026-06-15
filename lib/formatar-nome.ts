// Os produtos vem do Omie em CAIXA ALTA e quase sempre SEM acento ("ACUCAR CRISTAL").
// Esta funcao conserta a exibicao: capitaliza e devolve a acentuacao das palavras
// comuns de alimentos/mercearia, sem tocar no dado original (a busca usa o original).

// Palavras que aparecem em nomes de produto e precisam de acento. Chave SEM acento
// e em minusculo; valor JA acentuado e minusculo (a capitalizacao acontece depois).
const ACENTOS: Record<string, string> = {
  acucar: 'açúcar', acucares: 'açúcares', oleo: 'óleo', oleos: 'óleos',
  cafe: 'café', cafes: 'cafés', pao: 'pão', paes: 'pães', feijao: 'feijão',
  limao: 'limão', limoes: 'limões', melao: 'melão', mamao: 'mamão', maca: 'maçã',
  macas: 'maçãs', agua: 'água', aguas: 'águas', acai: 'açaí', maracuja: 'maracujá',
  alcool: 'álcool', porcao: 'porção', porcoes: 'porções', refeicao: 'refeição',
  semola: 'sêmola', acafrao: 'açafrão', manjericao: 'manjericão', pimentao: 'pimentão',
  coracao: 'coração', requeijao: 'requeijão', parmesao: 'parmesão', linguica: 'linguiça',
  file: 'filé', files: 'filés', pure: 'purê', guarana: 'guaraná', cha: 'chá',
  caja: 'cajá', cupuacu: 'cupuaçu', rucula: 'rúcula', salsao: 'salsão', agriao: 'agrião',
  paprica: 'páprica', oregano: 'orégano', pessego: 'pêssego', pera: 'pêra',
  funcionario: 'funcionário', funcionarios: 'funcionários', descartavel: 'descartável',
  descartaveis: 'descartáveis', sache: 'sachê', saches: 'sachês', cacau: 'cacau',
  caju: 'caju', toddy: 'toddy', graos: 'grãos', grao: 'grão', baiao: 'baião',
  feijoada: 'feijoada', vinagrete: 'vinagrete', maionese: 'maionese', alho: 'alho',
  manteiga: 'manteiga', azeite: 'azeite', tapioca: 'tapioca', cuscuz: 'cuscuz',
  lombo: 'lombo', costela: 'costela', file_mignon: 'filé', picanha: 'picanha',
  bisteca: 'bisteca', mortadela: 'mortadela', presunto: 'presunto', queijo: 'queijo',
  mussarela: 'mussarela', provolone: 'provolone', catupiry: 'catupiry', polpa: 'polpa',
  geleia: 'geleia', leite: 'leite', iogurte: 'iogurte', creme: 'creme', nata: 'nata',
  goiabada: 'goiabada', bananada: 'bananada', rapadura: 'rapadura', fuba: 'fubá',
  farinha: 'farinha', mandioca: 'mandioca', macarrao: 'macarrão', lasanha: 'lasanha',
  nhoque: 'nhoque', panqueca: 'panqueca', cebola: 'cebola', tomate: 'tomate',
  pimenta: 'pimenta', coentro: 'coentro', salsa: 'salsa', cebolinha: 'cebolinha',
  acucareiro: 'açucareiro', acucareira: 'açucareira', refri: 'refri', refrigerante: 'refrigerante',
}

// Siglas/unidades que devem ficar em MAIUSCULO (nao capitalizar como palavra normal).
const SIGLAS = new Set([
  'MC', 'MP', 'PA', 'KG', 'G', 'ML', 'L', 'LT', 'CX', 'UN', 'UND', 'FD', 'PCT', 'PC',
  'PT', 'NF', 'OP', 'PET', 'TP', 'GF', 'CC', 'KS', 'BD', 'SC', 'GR', 'MG', 'PP', 'GG',
])

// Preposicoes/conjuncoes que ficam minusculas no meio do nome.
const MINUSCULAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'por', 'a', 'o',
  'ao', 'aos', 'na', 'no', 'em', 'ou',
])

function capitalizarPalavra(p: string): string {
  if (!p) return p
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

// Formata um nucleo de palavra (ja sem a pontuacao das bordas).
function formatarNucleo(parte: string): string {
  if (!parte) return parte
  const lower = parte.toLowerCase()
  const upper = parte.toUpperCase()
  if (/\d/.test(parte)) return upper // codigos/medidas (350ML, 1KG, COLORCX12)
  if (SIGLAS.has(upper)) return upper
  if (MINUSCULAS.has(lower)) return lower
  const acento = ACENTOS[lower]
  if (acento) return capitalizarPalavra(acento)
  if (parte.length <= 2) return upper // demais siglas curtas (C/, S/)
  return capitalizarPalavra(parte)
}

/**
 * Formata o nome do produto para exibicao. Nao altera o dado original.
 * Ex.: "ACUCAR CRISTAL BELLA 1KG" -> "Açúcar Cristal Bella 1KG"
 *      "ACUCAR DEMERARA (MC)"     -> "Açúcar Demerara (MC)"
 */
export function formatarNomeProduto(desc: string | null | undefined): string {
  if (!desc) return ''
  return desc
    .trim()
    .split(/(\s+)/) // mantem os espacos para nao colar tokens
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token
      // separa pontuacao das bordas (parenteses, pontos) e processa so o nucleo
      const m = token.match(/^([^0-9A-Za-zÀ-ÿ]*)(.*?)([^0-9A-Za-zÀ-ÿ]*)$/)
      if (!m) return token
      const [, pre, nucleo, pos] = m
      if (!nucleo) return token
      // o nucleo pode ter barras internas (C/TAMPA) ou pontos (Ref.)
      const formatado = nucleo
        .split(/([/.])/)
        .map((seg) => (seg === '/' || seg === '.' ? seg : formatarNucleo(seg)))
        .join('')
      return pre + formatado + pos
    })
    .join('')
}
