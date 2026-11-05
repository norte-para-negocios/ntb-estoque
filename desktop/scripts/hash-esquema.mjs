// Calcula o hash de desktop/schema/*.sql e grava desktop/schema/hash.txt (o app lê e manda ao servidor)
// e lib/offline/esquema-atual.ts (o servidor compara). Rodar depois de gerar-schema.sh.
import fs from 'node:fs'
import path from 'node:path'
import { hashDoEsquema } from '../../lib/offline/esquema-puro.ts'

const raiz = path.join(import.meta.dirname, '..', '..')
const dir = path.join(raiz, 'desktop', 'schema')
const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((nome) => ({ nome, texto: fs.readFileSync(path.join(dir, nome), 'utf8') }))
const hash = hashDoEsquema(arquivos)
fs.writeFileSync(path.join(dir, 'hash.txt'), hash + '\n')
fs.writeFileSync(
  path.join(raiz, 'lib', 'offline', 'esquema-atual.ts'),
  `// GERADO por desktop/scripts/hash-esquema.mjs (a partir de desktop/schema/*.sql). Não editar.\nexport const ESQUEMA_HASH = '${hash}'\n`,
)
console.log('hash do esquema:', hash)
