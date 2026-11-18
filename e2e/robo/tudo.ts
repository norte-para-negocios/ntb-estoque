// Suíte completa do robô do ERP em sequência (ticket 12). Uso: npm run robo:tudo
//   --seco (ou ROBO_TUDO_SECO=1): só mostra a ordem e os comandos, sem executar nada.
//   ROBO_TUDO_SO=saldo,cmv / ROBO_TUDO_PULAR=cozinha: escolhe etapas.
// Os filtros que cada robô já tem (ROBO_LOJAS, ROBO_CENARIOS, ROBO_SEM_RESET, ROBO_SO...) passam direto para ele.
// Trava de sempre: só http://127.0.0.1|localhost:3107, .env.local com Supabase local e NTB_OMIE_BLOQUEADO=1, shell sem sobreposição e servidor da 3107 provado local (trava.ts).
// A suíte inteira leva horas (a cozinha sozinha ~16 min). Ao fim gera .local-data/robo-tudo/lista-final.md.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { verificarTravaLocal } from './trava.ts'
import { PORTA_ERP_LOCAL } from './base.ts'
import { montarPlano, formatarPlano } from './tudo-plano.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const seco = process.argv.includes('--seco') || process.env.ROBO_TUDO_SECO === '1'

function recusar(msg: string): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(2)
}

const plano = montarPlano(process.env)
if (plano.erro) recusar(plano.erro)

// ---- Trava: só a cópia local, Omie bloqueado ----
const trava = await verificarTravaLocal(RAIZ)
if (seco) {
  console.log(formatarPlano(plano))
  console.log('')
  console.log(`Trava (endereço, .env.local, shell e servidor da porta ${PORTA_ERP_LOCAL}): ${trava.ok ? `ok (${trava.origem})` : `RECUSARIA: ${trava.motivo}`}`)
  console.log('\nModo seco: nada foi executado.')
  process.exit(0)
}
if (!trava.ok) recusar(trava.motivo)

console.log(formatarPlano(plano))
console.log(`\nInício: ${new Date().toISOString()}. A suíte leva horas; não pare nem troque o ERP da porta ${PORTA_ERP_LOCAL}.\n`)

const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
const rodadas: string[] = []
const incompletas: string[] = []
for (const [i, e] of plano.etapas.entries()) {
  console.log(`\n===== ${i + 1}/${plano.etapas.length}: ${e.id} (npm run ${e.script}) =====`)
  const rodada = process.env.ROBO_RODADA ?? `tudo-${carimbo}`
  const r = spawnSync('npm', ['run', e.script], {
    cwd: RAIZ,
    stdio: 'inherit',
    env: { ...process.env, NTB_OMIE_BLOQUEADO: '1', ROBO_RODADA: rodada },
  })
  if (r.status === 2) recusar(`o robô ${e.id} recusou rodar (trava); suíte interrompida`)
  if (r.status !== 0) {
    incompletas.push(`${e.id} (saída ${r.status ?? r.signal})`)
    console.error(`Etapa ${e.id} terminou incompleta (${r.status ?? r.signal}); a suíte continua.`)
  } else rodadas.push(`${e.id}=${rodada}`)
}

console.log('\n===== lista final =====')
const l = spawnSync('npm', ['run', 'robo:lista'], {
  cwd: RAIZ,
  stdio: 'inherit',
  env: { ...process.env, ROBO_LISTA_RODADAS: rodadas.join(',') },
})
if (incompletas.length) console.error(`\nEtapas incompletas: ${incompletas.join(', ')}. A lista usou a rodada mais nova que existia desses robôs.`)
console.log(`\nFim: ${new Date().toISOString()}`)
process.exit(incompletas.length || l.status !== 0 ? 1 : 0)
