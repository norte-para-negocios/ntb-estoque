// Põe `await guardaModulo('<arquivo>#<acao>')` logo depois da linha do viaDesktop de cada server action
// (lib/actions/*.ts com 'use server'). Sincroniza: arquivos livres (moduloDaAcao = null) e SEM_GUARDA ficam sem guarda (remove a que existir). Idempotente.
// Rodar depois de scripts/inserir-via-desktop.mjs. Uso: node scripts/inserir-guarda-modulo.mjs
import fs from 'node:fs'
import path from 'node:path'
import { moduloDaAcao } from '../lib/plataforma/acoes-modulo.ts'

const DIR = path.join(import.meta.dirname, '..', 'lib', 'actions')
const IMPORT = "import { guardaModulo } from '@/lib/plataforma/guarda'"
// Chamadas sem sessão (cron, app/api/cron/*): guardaModulo -> getProfile redirecionaria ao login. Nome completo.
const SEM_GUARDA = [
  'ordem-producao#retryOPsPendentes',
  'inventario#retryAjustesInventarioPendentes',
  'movimentacoes#retryMovimentosManuaisPendentes',
  'transferencia#retryMovimentosTransferenciaPendentes',
]
const GUARDA_RE = /^\s*(const __g = )?await guardaModulo\(/
let arquivosTocados = 0

for (const arq of fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
  const caminho = path.join(DIR, arq)
  const src = fs.readFileSync(caminho, 'utf8')
  if (!/^['"]use server['"]/m.test(src)) continue
  const modulo = arq.replace(/\.ts$/, '')
  const livre = moduloDaAcao(modulo) === null
  const linhas = src.split('\n').filter((l) => !GUARDA_RE.test(l))
  const saida = []
  for (const l of linhas) {
    saida.push(l)
    const m = /^\s*const __d = viaDesktop\('([^']+)'/.exec(l)
    if (!m || livre || SEM_GUARDA.includes(m[1])) continue
    saida.push(`  const __g = await guardaModulo('${m[1]}'); if (__g) return __g as never`)
  }
  let out = saida.join('\n')
  const tem = out.includes('guardaModulo(')
  if (tem && !out.includes(IMPORT)) out = out.replace("import { viaDesktop } from '@/lib/offline/via-desktop'\n", `import { viaDesktop } from '@/lib/offline/via-desktop'\n${IMPORT}\n`)
  if (tem && !out.includes(IMPORT)) throw new Error(`sem import do viaDesktop em ${arq}`)
  if (!tem) out = out.replace(IMPORT + '\n', '')
  if (out === src) continue
  fs.writeFileSync(caminho, out)
  arquivosTocados++
}
console.log(`arquivos alterados: ${arquivosTocados}`)
