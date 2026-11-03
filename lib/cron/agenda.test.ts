import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

// Toda rota de app/api/cron precisa estar agendada em scripts/sync-cron.sh ou scripts/sync-espelho.sh, ou constar aqui com o motivo.
// Rota esquecida = sync que "existe" mas nunca roda (foi assim com sync-faturamento e prune; auditoria 2026-11, achado 4.1).
export const SOB_DEMANDA: Record<string, string> = {
  backfill: 'carga histórica manual, mês a mês, por loja (multiplica chamadas no mesmo app_key do Omie)',
  restaurar: 'traz de volta um mês do arquivo morto; só por decisão humana',
  arquivar: 'move NF/OP/movimentos antigos do banco quente para o Storage e APAGA do Postgres; sem agendamento até o dono decidir (dry_run é o padrão)',
  'enviar-pedidos-compra-omie': 'escrita no Omie; entra só na ativação do módulo de compras (route.ts: "entra só na ativação")',
}

const raiz = new URL('../../', import.meta.url)
const ler = (p: string) => readFileSync(new URL(p, raiz), 'utf8')
const rotas = readdirSync(new URL('app/api/cron/', raiz), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`app/api/cron/${d.name}/route.ts`, raiz)))
  .map((d) => d.name)

const scripts = ['scripts/sync-cron.sh', 'scripts/sync-espelho.sh']
const chamadas = new Set<string>()
for (const s of scripts) {
  for (const m of ler(s).matchAll(/^[^#\n]*\bhit\s+\/api\/cron\/([a-z0-9-]+)/gm)) chamadas.add(m[1])
}

test('toda rota de cron está agendada ou declarada sob demanda com motivo', () => {
  const soltas = rotas.filter((r) => !chamadas.has(r) && !(r in SOB_DEMANDA))
  assert.deepEqual(soltas, [], `rotas sem agendamento nem motivo: ${soltas.join(', ')}`)
})

test('os scripts não chamam rota inexistente', () => {
  const fantasmas = [...chamadas].filter((c) => !rotas.includes(c))
  assert.deepEqual(fantasmas, [])
})

test('rota sob demanda que passou a ser agendada sai da lista (a lista não apodrece)', () => {
  const obsoletas = Object.keys(SOB_DEMANDA).filter((r) => chamadas.has(r) || !rotas.includes(r))
  assert.deepEqual(obsoletas, [])
})

test('prune agendado 1x/dia; arquivar NÃO agendado', () => {
  assert.ok(chamadas.has('prune'))
  assert.ok(!chamadas.has('arquivar'))
  assert.match(ler('scripts/sync-cron.sh'), /hora" = "06" \]; then hit \/api\/cron\/prune/)
})
