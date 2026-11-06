import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Toda permissão criada por migration precisa chegar a algum cargo padrão (Gerente/Estoquista/Conferente),
// senão funcionário com cargo nunca recebe a tela (auditoria 2026-11: 56 órfãs). Ver
// docs/auditoria/2026-11-norte-erp/05-proposta-permissoes.md.

const DIR = path.join(import.meta.dirname, '..', 'supabase', 'migrations')

/** Permissões que de propósito só Admin/AdminLoja têm. Cada uma com o motivo. */
export const SO_ADMIN: Record<string, string> = {
  'Notas Fiscais - Excluir': 'apaga nota; destrutivo, decisão do dono da loja',
  'Estoque - Corrigir custo': 'muda custo médio; só quem responde pelo CMV',
  'Fechamento - Reabrir mes': 'reabre período contábil já fechado',
  'Financeiro - Contas a pagar - Pagar': 'movimenta dinheiro (pagar/estornar)',
  'Financeiro - Categorias': 'estrutura do DRE',
  'Financeiro - Aprovar pagamento alto valor': 'aprova conta acima da faixa do gerente: decisão do dono (370)',
  'Financeiro - Configurar aprovacao': 'define quem aprova e a partir de que valor (370)',
  'Financeiro - Lancamentos e transferencias': 'movimenta dinheiro no extrato, como o Pagar (370)',
  'Categorias Contabeis - Criar': 'cadastro contábil',
  'Categorias Contabeis - Editar': 'cadastro contábil',
  'Categorias Contabeis - Excluir': 'cadastro contábil',
}

/** Cadastros: o cargo Gerente é "sem a parte de cadastro" desde a migration 046. */
const CADASTRO = /^(Produtos|Familias|Fornecedores|Locais de Estoque)\b/

function semComentario(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

function migrations(): { versao: number; sql: string }[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ versao: Number(f.split('_')[0]), sql: semComentario(fs.readFileSync(path.join(DIR, f), 'utf8')) }))
}

function permissoesCriadas(): Map<string, number> {
  const out = new Map<string, number>()
  for (const { versao, sql } of migrations()) {
    for (const bloco of sql.matchAll(/insert\s+into\s+(?:public\.)?permissoes\s*\(\s*nome\s*\)\s*values\s*([\s\S]*?)(?:on\s+conflict|;)/gi)) {
      for (const m of bloco[1].matchAll(/\(\s*'([^']+)'\s*\)/g)) if (!out.has(m[1])) out.set(m[1], versao)
    }
  }
  return out
}

function nomesEmCargoPermissao(): Set<string> {
  const out = new Set<string>()
  for (const { sql } of migrations()) {
    if (!/insert\s+into\s+(?:public\.)?cargo_permissao/i.test(sql)) continue
    for (const m of sql.matchAll(/'([^']+)'/g)) out.add(m[1])
  }
  return out
}

test('o parser acha as permissões conhecidas', () => {
  const p = permissoesCriadas()
  assert.ok(p.size >= 79, `só achei ${p.size}`)
  for (const n of ['Notas Fiscais', 'Compras - Criar', 'Financeiro - Categorias', 'Correcoes - Executar']) assert.ok(p.has(n), n)
})

test('toda permissão criada por migration entra em um cargo padrão (ou está em SO_ADMIN com motivo)', () => {
  const nos = nomesEmCargoPermissao()
  const sem: string[] = []
  for (const [nome, versao] of permissoesCriadas()) {
    if (nos.has(nome)) continue
    if (versao < 46 && !CADASTRO.test(nome)) continue // a regra "Gerente = tudo menos cadastro" da 046 pegou
    if (CADASTRO.test(nome)) continue // cadastro: de propósito fora do Gerente (046)
    if (SO_ADMIN[nome]) continue
    sem.push(nome)
  }
  assert.deepEqual(sem, [], `permissão sem cargo: ponha em cargo_permissao (nova migration) ou em SO_ADMIN com motivo`)
})

test('SO_ADMIN não guarda permissão que já entrou em cargo nem permissão que não existe', () => {
  const nos = nomesEmCargoPermissao()
  const criadas = permissoesCriadas()
  for (const nome of Object.keys(SO_ADMIN)) {
    assert.ok(criadas.has(nome), `${nome} não existe`)
    assert.ok(!nos.has(nome), `${nome} já está em cargo: tire de SO_ADMIN`)
  }
})
