// Gera a lista final de falhas do ERP (ticket 12): lê o falhas.md mais recente de cada robô, junta com os achados
// das notas dos tickets e escreve .local-data/robo-tudo/lista-final.md. SÓ LÊ arquivos; não abre navegador nem banco.
// Uso: npm run robo:lista
// Variáveis: ROBO_LISTA_RODADAS=cmv=r5,saldo=2026-...  (força a rodada de cada robô; o resto usa a mais nova)
//            ROBO_LISTA_COPIA=/caminho/lista.md       (grava também uma cópia legível neste caminho)
import fs from 'node:fs'
import path from 'node:path'
import { lerTabelaFalhas, consolidar, formatarListaFinal, escolherRodada, type FalhaRastreada, type RodadaLida } from './consolidador.ts'
import { ACHADOS_DAS_NOTAS, RESSALVAS } from './achados-notas.ts'
import { ETAPAS } from './tudo-plano.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const DADOS = path.join(RAIZ, '.local-data')

const forcadas = new Map<string, string>()
for (const par of (process.env.ROBO_LISTA_RODADAS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const [r, d] = par.split('=')
  if (r && d) forcadas.set(r, d)
}

const falhas: FalhaRastreada[] = []
const rodadas: RodadaLida[] = []
const faltando: string[] = []
for (const e of ETAPAS) {
  const pasta = path.join(DADOS, e.saida)
  let rodada = forcadas.get(e.id) ?? null
  if (!rodada) {
    const subs = fs.existsSync(pasta) ? fs.readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()) : []
    rodada = escolherRodada(subs.map((d) => {
      const arq = path.join(pasta, d.name, 'falhas.md')
      const tem = fs.existsSync(arq)
      return { nome: d.name, mtimeMs: tem ? fs.statSync(arq).mtimeMs : 0, temFalhas: tem }
    }))
  }
  const arq = rodada ? path.join(pasta, rodada, 'falhas.md') : ''
  if (!rodada || !fs.existsSync(arq)) {
    faltando.push(e.id)
    continue
  }
  const linhas = lerTabelaFalhas(fs.readFileSync(arq, 'utf8'))
  for (const l of linhas) falhas.push({ ...l, robo: e.id, ticket: e.ticket, rodada, pastaSaida: e.saida })
  rodadas.push({ robo: e.id, ticket: e.ticket, rodada, falhas: linhas.length, pasta: `${e.saida}/${rodada}` })
}

const itens = consolidar([...falhas, ...ACHADOS_DAS_NOTAS])
const data = new Date().toISOString().slice(0, 10)
let md = formatarListaFinal(itens, { data, rodadas, ressalvas: RESSALVAS })
if (faltando.length) md += `\n## Robôs sem resultado para ler\n\nNenhuma rodada com falhas.md encontrada para: ${faltando.join(', ')}. Rode \`npm run robo:<nome>\` e gere a lista de novo (\`npm run robo:lista\`).\n`

const destino = path.join(DADOS, 'robo-tudo', 'lista-final.md')
fs.mkdirSync(path.dirname(destino), { recursive: true })
fs.writeFileSync(destino, md)
console.log(`Lista final: ${destino}`)
if (process.env.ROBO_LISTA_COPIA) {
  fs.mkdirSync(path.dirname(process.env.ROBO_LISTA_COPIA), { recursive: true })
  fs.writeFileSync(process.env.ROBO_LISTA_COPIA, md)
  console.log(`Cópia: ${process.env.ROBO_LISTA_COPIA}`)
}
const n = (g: number) => itens.filter((i) => i.gravidade === g).length
console.log(`Itens: ${itens.length} (gravidade 1: ${n(1)}, 2: ${n(2)}, 3: ${n(3)}); falhas lidas: ${falhas.length}; sem resultado: ${faltando.join(', ') || 'nenhum'}`)
