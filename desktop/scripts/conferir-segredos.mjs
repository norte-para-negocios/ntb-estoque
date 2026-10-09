// Falha se algum valor do .env.local (chaves de produção) aparecer em qualquer arquivo do build.
// Uso: node conferir-segredos.mjs <arquivo .env> <diretório>
import fs from 'node:fs'
import path from 'node:path'

const [, , arqEnv, dir] = process.argv
if (!fs.existsSync(arqEnv)) {
  console.log('sem .env para conferir')
  process.exit(0)
}
const valores = fs.readFileSync(arqEnv, 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')])
  .filter(([k, v]) => v.length >= 16 && !k.startsWith('NEXT_PUBLIC_'))
let achados = 0
function varrer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) varrer(p)
    else if (e.isFile() && fs.statSync(p).size < 50_000_000) {
      const txt = fs.readFileSync(p, 'latin1')
      for (const [k, v] of valores) if (txt.includes(v)) { console.error(`SEGREDO ${k} encontrado em ${p}`); achados++ }
    }
  }
}
varrer(dir)
if (achados) process.exit(1)
console.log(`ok: ${valores.length} segredos conferidos, nenhum no build`)
