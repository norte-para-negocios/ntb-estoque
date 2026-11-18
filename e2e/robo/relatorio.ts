// Lógica pura do robô: gravidade, formato da lista de falhas e do inventário. Sem rede, sem navegador.
export type TipoFalha =
  | 'valor-invalido'
  | 'saldo-divergente'
  | 'erro-http-pagina'
  | 'erro-http-requisicao'
  | 'tela-quebrada'
  | 'erro-console'
  | 'tela-vazia'
  | 'timeout'
  | 'texto-cortado'
  | 'estouro-horizontal'
  | 'conta-divergente'

export type Gravidade = 1 | 2 | 3
export const ROTULO_GRAVIDADE: Record<Gravidade, string> = { 1: 'conta errada', 2: 'trava/erro', 3: 'visual' }

export function gravidadeDoTipo(t: TipoFalha): Gravidade {
  if (t === 'valor-invalido' || t === 'saldo-divergente' || t === 'conta-divergente') return 1
  if (t === 'texto-cortado' || t === 'estouro-horizontal') return 3
  return 2
}

export type Falha = {
  tipo: TipoFalha
  gravidade: Gravidade
  loja: string
  cargo: string
  tela: string
  passo: string
  esperado: string
  mostrado: string
  print: string
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function ordenarFalhas(fs: Falha[]): Falha[] {
  return [...fs].sort(
    (a, b) => a.gravidade - b.gravidade || cmp(a.loja, b.loja) || cmp(a.cargo, b.cargo) || cmp(a.tela, b.tela) || cmp(a.tipo, b.tipo) || cmp(a.mostrado, b.mostrado)
  )
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ')

/** Markdown da lista de falhas. Sem data nem tempo: duas rodadas iguais geram o mesmo texto. */
export function formatarListaFalhas(falhas: Falha[], meta: { visitas: number; telas: number; logins: number }): string {
  const o = ordenarFalhas(falhas)
  const n = (g: Gravidade) => o.filter((f) => f.gravidade === g).length
  const L: string[] = []
  L.push('# Falhas do robô (passeio por todas as telas)', '')
  L.push(`Logins: ${meta.logins} | telas distintas: ${meta.telas} | visitas: ${meta.visitas} | falhas: ${o.length}`, '')
  L.push(`- Gravidade 1, ${ROTULO_GRAVIDADE[1]}: ${n(1)}`, `- Gravidade 2, ${ROTULO_GRAVIDADE[2]}: ${n(2)}`, `- Gravidade 3, ${ROTULO_GRAVIDADE[3]}: ${n(3)}`, '')
  if (!o.length) {
    L.push('Nenhuma falha encontrada.', '')
    return L.join('\n')
  }
  for (const g of [1, 2, 3] as Gravidade[]) {
    const grupo = o.filter((f) => f.gravidade === g)
    if (!grupo.length) continue
    L.push(`## Gravidade ${g}: ${ROTULO_GRAVIDADE[g]} (${grupo.length})`, '')
    L.push('| Gravidade | Loja | Cargo | Tela | Passo | Esperado | Mostrado | Print |', '|---|---|---|---|---|---|---|---|')
    for (const f of grupo) L.push(`| ${g} ${ROTULO_GRAVIDADE[g]} | ${esc(f.loja)} | ${f.cargo} | ${esc(f.tela)} | ${esc(f.passo)} | ${esc(f.esperado)} | ${esc(f.mostrado)} | ${f.print} |`)
    L.push('')
  }
  return L.join('\n')
}

const RE_GRAVA = /^(salvar|gravar|excluir|remover|apagar|deletar|criar|novo|nova|adicionar|incluir|enviar|aprovar|reprovar|confirmar|finalizar|concluir|lan[cç]ar|importar|sincronizar|atualizar|desfazer|reverter|reenviar|emitir|cancelar (nota|op|ordem|pedido|inventário|inventario|transfer)|registrar|baixar (nota|conta)|pagar|receber|fechar (m[eê]s|caixa)|restaurar|resetar)\b/i

/** Só pelo texto: o botão grava dado? O robô nunca aciona; serve para o inventário. */
export function classificarAcao(texto: string): 'grava' | 'leitura' {
  return RE_GRAVA.test(texto.trim()) ? 'grava' : 'leitura'
}

/** O Next entrega a página 404 com HTTP 200 quando já começou a transmitir; só o texto denuncia. */
export function ehPaginaNaoEncontrada(texto: string): boolean {
  return /(^|\n)404\s*\n?\s*This page could not be found\.?/.test(texto) || /Página não encontrada/i.test(texto.slice(0, 400))
}

/** Textos que denunciam conta/valor quebrado (NaN, undefined...). Só palavra inteira. */
export function valoresInvalidos(texto: string): string[] {
  const achados: string[] = []
  for (const [re, nome] of [
    [/(?<![\p{L}\p{N}_])NaN(?![\p{L}\p{N}_])/u, 'NaN'],
    [/(?<![\p{L}\p{N}_])undefined(?![\p{L}\p{N}_])/u, 'undefined'],
    [/-?(?<![\p{L}\p{N}_])Infinity(?![\p{L}\p{N}_])/u, 'Infinity'],
    [/\[object Object\]/, '[object Object]'],
  ] as [RegExp, string][]) if (re.test(texto)) achados.push(nome)
  return achados
}

export type Acao = { texto: string; tipo: string }
export type TelaInventario = {
  tela: string
  loja: string
  cargo: string
  noMenu: boolean
  resultado: string
  titulo: string
  acoes: Acao[]
}

/** Inventário tela → botões e ações, juntando todos os logins que viram a tela. */
export function formatarInventario(visitas: TelaInventario[]): string {
  const porTela = new Map<string, TelaInventario[]>()
  for (const v of visitas) porTela.set(v.tela, [...(porTela.get(v.tela) ?? []), v])
  const L = ['# Inventário de telas e funções do ERP', '', 'Gerado só por leitura: o robô navega e lista; nenhum botão foi acionado. "grava" = botão que, pelo texto, grava dado.', '']
  for (const tela of [...porTela.keys()].sort(cmp)) {
    const vs = porTela.get(tela)!
    const titulo = vs.find((v) => v.titulo)?.titulo ?? ''
    L.push(`## ${tela}${titulo ? ` (${titulo})` : ''}`, '')
    const resultados = [...new Set(vs.map((v) => `${v.resultado}`))].sort(cmp)
    L.push(`- Resultado: ${resultados.join(', ')}`)
    L.push(`- Aparece no menu para: ${vs.filter((v) => v.noMenu).map((v) => `${v.loja}/${v.cargo}`).sort(cmp).join(', ') || 'ninguém'}`)
    const acoes = new Map<string, { tipo: string; quem: Set<string> }>()
    for (const v of vs) for (const a of v.acoes) {
      const k = `${a.tipo}|${a.texto}`
      if (!acoes.has(k)) acoes.set(k, { tipo: a.tipo, quem: new Set() })
      acoes.get(k)!.quem.add(`${v.loja}/${v.cargo}`)
    }
    if (acoes.size) {
      L.push('', '| Ação | Tipo | Efeito | Vista por |', '|---|---|---|---|')
      for (const k of [...acoes.keys()].sort(cmp)) {
        const a = acoes.get(k)!
        const texto = k.slice(k.indexOf('|') + 1)
        L.push(`| ${esc(texto)} | ${a.tipo} | ${classificarAcao(texto)} | ${a.quem.size === vs.length ? 'todos os logins que abriram' : [...a.quem].sort(cmp).join(', ')} |`)
      }
    }
    L.push('')
  }
  return L.join('\n')
}
