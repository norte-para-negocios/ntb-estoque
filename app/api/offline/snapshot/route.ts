// Uma página do snapshot de uma tabela, só das lojas do usuário. GET ?tabela=&depois=<json>&limite=
import { createServiceClient } from '@/lib/supabase/server'
import { autenticarCanal, erro, jsonGzip } from '@/lib/offline/canal'
import { lojasQuePodemLer, tabelaRestrita } from '@/lib/offline/permissao-tabela'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = await autenticarCanal(req)
  if (u instanceof Response) return u
  const sp = new URL(req.url).searchParams
  const tabela = sp.get('tabela') ?? ''
  if (!/^[a-z_][a-z0-9_]*$/.test(tabela)) return erro(400, 'Tabela inválida.')
  let depois: unknown = null
  try {
    depois = sp.get('depois') ? JSON.parse(sp.get('depois')!) : null
  } catch {
    return erro(400, 'Cursor inválido.')
  }
  // PostgREST de produção corta qualquer resposta em 1000 linhas (db-max-rows): página máxima = 1000.
  const limite = Math.min(Math.max(Number(sp.get('limite')) || 1000, 1), 1000)
  // Tabela com regra de cargo (financeiro, compras, notas, gestão): só entram as lojas em que o cargo tem a permissão.
  // Sem nenhuma: página vazia e `bloqueado` (200, não erro, para o app desktop não abortar a carga inicial das outras tabelas).
  const lojasDaTabela = tabela === 'lojas' ? u.permitidas : tabelaRestrita(tabela) ? lojasQuePodemLer(tabela, u.lojas, u.perm) : u.lojas
  if (!lojasDaTabela.length && tabelaRestrita(tabela)) return jsonGzip({ ok: true, linhas: [], depois: null, fim: true, bloqueado: true })
  const { data, error } = await createServiceClient().rpc('offline_snapshot', {
    p_tabela: tabela,
    // A lista de lojas (só cadastro, sem segredos) vem inteira para o seletor de loja funcionar.
    p_lojas: lojasDaTabela,
    p_user: u.userId,
    p_depois: depois,
    p_limite: limite,
  })
  if (error) {
    console.error('offline/snapshot', tabela, error.message)
    return erro(400, 'Tabela não sincronizável.')
  }
  const linhas = (data ?? []) as { pk: unknown; dado: unknown }[]
  return jsonGzip({ ok: true, linhas: linhas.map((l) => l.dado), depois: linhas.length ? linhas[linhas.length - 1].pk : null, fim: linhas.length < limite })
}
