// Montagem dos comandos de scripts/aplicar-migration.mjs (Fase 1, B3). Tudo aqui é puro e testado; o script só faz o I/O
// (ssh + docker exec psql). A aplicação real é feita pelo controlador de madrugada; o modo `seco` roda a migration inteira
// numa transação e termina em ROLLBACK.

export function versaoDoArquivo(arquivo: string): number {
  const m = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(arquivo)
  if (!m) throw new Error(`nome de migration inválido: ${arquivo} (esperado NNN_nome_em_minusculas.sql)`)
  return Number(m[1])
}

function semComentarios(sql: string): string {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
}

export function classificarSql(sql: string): { transacaoPropria: boolean; semTransacao: boolean } {
  const codigo = semComentarios(sql)
  const transacaoPropria = /^\s*(begin|start\s+transaction|commit|rollback)\s*;/im.test(codigo)
  const semTransacao = /^\s*--\s*sem-transacao\b/im.test(sql) || /\bconcurrently\b/i.test(codigo)
  return { transacaoPropria, semTransacao }
}

const so = (s: string) => s.replace(/[^A-Za-z0-9_.@-]/g, '').slice(0, 60) || 'aplicar-migration'
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

export function montarAplicacao(p: { arquivo: string; sql: string; modo: 'real' | 'seco'; controleExiste: boolean; por: string }): { sql: string; embrulhada: boolean } {
  const versao = versaoDoArquivo(p.arquivo)
  const { transacaoPropria, semTransacao } = classificarSql(p.sql)
  const livre = transacaoPropria || semTransacao
  if (p.modo === 'seco' && livre) {
    throw new Error(`${p.arquivo}: não dá para testar a seco (${transacaoPropria ? 'controla a própria transação' : 'usa concurrently / sem-transacao'}); teste numa cópia do banco.`)
  }
  const registro = p.controleExiste
    ? `insert into public.schema_migrations (versao, arquivo, por) values (${versao}, ${lit(p.arquivo)}, ${lit(so(p.por))}) on conflict (versao) do nothing;\n`
    : ''
  const aviso = `notify pgrst, 'reload schema';\n`
  const corpo = p.sql.endsWith('\n') ? p.sql : `${p.sql}\n`
  if (livre) return { sql: `${corpo}${registro}${aviso}`, embrulhada: false }
  return { sql: `begin;\n${corpo}${registro}${aviso}${p.modo === 'seco' ? 'rollback;' : 'commit;'}\n`, embrulhada: true }
}

/** Só leitura: o controle existe? esta versão já foi aplicada? Saída: `controle|ja` (t/f|t/f). */
export const SQL_CONSULTA_CONTROLE = (versao: number) =>
  `set default_transaction_read_only = on;\nselect to_regclass('public.schema_migrations') is not null, ` +
  `case when to_regclass('public.schema_migrations') is null then false else exists (select 1 from public.schema_migrations where versao = ${Number(versao)}) end;\n`

/** Argumentos do ssh. O alvo vem do ambiente (o repo é público: nada de host ou chave no código). */
export function montarSsh(env: Record<string, string | undefined>): string[] {
  const alvo = env.NORTE_DB_SSH
  if (!alvo) throw new Error('defina NORTE_DB_SSH (ex.: root@servidor) e, se precisar, NORTE_DB_SSH_KEY (caminho da chave)')
  const chave = env.NORTE_DB_SSH_KEY ? ['-i', env.NORTE_DB_SSH_KEY] : []
  return [...chave, alvo, 'docker exec -i supabase-db psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1']
}
