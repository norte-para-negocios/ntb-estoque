// Põe `await guardaModulo('<arquivo>#<acao>')` logo depois da linha do viaDesktop de cada server action
// (lib/actions/*.ts com 'use server'). Pula arquivos livres (moduloDaAcao = null). Idempotente.
// Rodar depois de scripts/inserir-via-desktop.mjs. Uso: node scripts/inserir-guarda-modulo.mjs
import fs from 'node:fs'
import path from 'node:path'
import { moduloDaAcao } from '../lib/plataforma/acoes-modulo.ts'

const DIR = path.join(import.meta.dirname, '..', 'lib', 'actions')
const IMPORT = "import { guardaModulo } from '@/lib/plataforma/guarda'"
let inseridas = 0
let arquivosTocados = 0

for (const arq of fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
  const caminho = path.join(DIR, arq)
  const src = fs.readFileSync(caminho, 'utf8')
  if (!/^['"]use server['"]/m.test(src)) continue
  const modulo = arq.replace(/\.ts$/, '')
  if (moduloDaAcao(modulo) === null) continue
  const linhas = src.split('\n')
  const saida = []
  let n = 0
  for (let i = 0; i < linhas.length; i++) {
    saida.push(linhas[i])
    const m = /^\s*const __d = viaDesktop\('([^']+)'/.exec(linhas[i])
    if (!m) continue
    const nova = `  await guardaModulo('${m[1]}')`
    if (linhas[i + 1] === nova) continue
    saida.push(nova)
    n++
  }
  if (!n) continue
  let out = saida.join('\n')
  if (!out.includes(IMPORT)) out = out.replace("import { viaDesktop } from '@/lib/offline/via-desktop'\n", `import { viaDesktop } from '@/lib/offline/via-desktop'\n${IMPORT}\n`)
  if (!out.includes(IMPORT)) throw new Error(`sem import do viaDesktop em ${arq}`)
  fs.writeFileSync(caminho, out)
  inseridas += n
  arquivosTocados++
}
console.log(`guardas inseridas: ${inseridas} em ${arquivosTocados} arquivos`)
