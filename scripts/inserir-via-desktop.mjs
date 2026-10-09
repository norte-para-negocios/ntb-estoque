// Põe `viaDesktop` como 1ª linha de cada server action (lib/actions/*.ts com 'use server') e gera
// lib/offline/registro-acoes.ts. Idempotente: rodar de novo depois de criar ações novas.
// Uso: node scripts/inserir-via-desktop.mjs
import fs from 'node:fs'
import path from 'node:path'

// Nomes dos parâmetros de uma assinatura (server action não pode usar `arguments`).
function nomesDosParametros(lista, quem) {
  const partes = []
  let prof = 0
  let atual = ''
  for (const ch of lista) {
    if ('({[<'.includes(ch)) prof++
    else if (')}]>'.includes(ch)) prof--
    if (ch === ',' && prof === 0) { partes.push(atual); atual = '' } else atual += ch
  }
  if (atual.trim()) partes.push(atual)
  return partes
    .map((p) => p.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(\.\.\.)?([A-Za-z_$][\w$]*)/.exec(p)
      if (!m) throw new Error(`parâmetro desestruturado em ${quem}: ${p}`)
      return m[1] ? `...${m[2]}` : m[2]
    })
}

const DIR = path.join(import.meta.dirname, '..', 'lib', 'actions')
const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()
const registro = []
let inseridas = 0

for (const arq of arquivos) {
  const caminho = path.join(DIR, arq)
  let src = fs.readFileSync(caminho, 'utf8')
  if (!/^['"]use server['"]/m.test(src)) continue
  const modulo = arq.replace(/\.ts$/, '')
  const nomes = []
  // export async function nome(...)  {   -- acha a chave que abre o corpo (depois da assinatura)
  const re = /^export async function (\w+)\s*(<[^>]*>)?\s*\(/gm
  let m
  const pontos = []
  while ((m = re.exec(src))) {
    const nome = m[1]
    nomes.push(nome)
    // percorre parênteses da assinatura e um possível tipo de retorno até a "{" do corpo
    let i = re.lastIndex - 1
    let prof = 0
    for (; i < src.length; i++) {
      if (src[i] === '(') prof++
      else if (src[i] === ')') {
        prof--
        if (prof === 0) break
      }
    }
    const params = nomesDosParametros(src.slice(re.lastIndex, i), `${modulo}#${nome}`)
    // tipo de retorno pode ter chaves ({ ok: boolean }); acha a "{" que vem depois de ") ... " fora de tipo
    let j = i + 1
    let profTipo = 0
    let profAng = 0
    let achou = -1
    const temTipo = /^\s*:/.test(src.slice(j))
    for (; j < src.length; j++) {
      const ch = src[j]
      if (ch === '<') profAng++
      else if (ch === '>' && src[j - 1] !== '=') profAng--
      else if (ch === '{') {
        if (!temTipo) { achou = j; break }
        // dentro de tipo de retorno: '{' só é o corpo se o tipo já terminou (profundidade 0, sem '<' aberto)
        if (profTipo === 0 && profAng === 0 && /[)\]>A-Za-z0-9_\s]$/.test(src.slice(0, j).trimEnd().slice(-1)) && !/[:|&,(<]\s*$/.test(src.slice(0, j))) { achou = j; break }
        profTipo++
      } else if (ch === '}') profTipo--
    }
    if (achou < 0) throw new Error(`não achei o corpo de ${modulo}#${nome}`)
    const linha = `  const __d = viaDesktop('${modulo}#${nome}', ${nome}, [${params.join(', ')}]); if (__d) return __d as never\n`
    const depois = src.slice(achou + 1)
    if (depois.trimStart().startsWith(linha.trimStart().slice(0, 40))) continue
    pontos.push([achou + 1, linha])
  }
  for (const [pos, linha] of pontos.sort((a, b) => b[0] - a[0])) {
    src = src.slice(0, pos) + '\n' + linha.replace(/\n$/, '') + src.slice(pos)
    inseridas++
  }
  if (pontos.length && !src.includes("from '@/lib/offline/via-desktop'")) {
    src = src.replace(/^(['"]use server['"];?\n)/m, `$1\nimport { viaDesktop } from '@/lib/offline/via-desktop'\n`)
  }
  fs.writeFileSync(caminho, src)
  registro.push([modulo, nomes])
}

const linhas = [
  '// GERADO por scripts/inserir-via-desktop.mjs -- não editar à mão.',
  '// Todas as server actions, pelo nome usado no canal do app desktop (modulo#funcao).',
  ...registro.map(([mod], i) => `import * as m${i} from '@/lib/actions/${mod}'`),
  '',
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
  'type Acao = (...args: any[]) => Promise<unknown>',
  '',
  'export const ACOES: Readonly<Record<string, Acao>> = Object.freeze({',
  ...registro.flatMap(([mod, nomes], i) => nomes.map((n) => `  '${mod}#${n}': m${i}.${n} as Acao,`)),
  '})',
  '',
]
fs.writeFileSync(path.join(import.meta.dirname, '..', 'lib', 'offline', 'registro-acoes.ts'), linhas.join('\n'))
console.log(`linhas inseridas: ${inseridas}; ações no registro: ${registro.reduce((s, [, n]) => s + n.length, 0)}`)
