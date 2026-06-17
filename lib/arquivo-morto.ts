// Arquivo morto: offload do histórico que sai da janela quente (12 meses) para o
// Supabase Storage (.json.gz), liberando os 500 MB do Postgres. Ver
// docs/superpowers/plans/2026-06-17-estrategia-espaco.md e a migration 016.
import { gzipSync, gunzipSync } from 'node:zlib'
import type { createServiceClient } from '@/lib/supabase/server'

const BUCKET = 'arquivo-morto'

// Tabelas de histórico arquiváveis -> coluna de data que define o "mês".
// OP usa a conclusão real (OPs pendentes, sem conclusão, nunca saem do quente).
export const TABELAS_ARQUIVAVEIS = {
  movimentos_historico: 'data',
  ordens_producao: 'dt_conclusao_real',
  notas_fiscais: 'd_emissao_nfe',
} as const

export type TabelaArquivavel = keyof typeof TABELAS_ARQUIVAVEIS

type Supa = ReturnType<typeof createServiceClient>

// Primeiro dia do mês de corte (UTC): tudo com data < corte é arquivável.
// meses=12, hoje jun/2026 -> '2025-06-01' (mantém jun/2025 em diante no quente).
export function mesCorte(hoje: Date, meses: number): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, 1))
  return d.toISOString().slice(0, 10)
}

// Limites [início, fimExclusivo) de um período 'AAAA-MM'.
function limitesMes(periodo: string): [string, string] {
  const [a, m] = periodo.split('-').map(Number)
  const ini = new Date(Date.UTC(a, m - 1, 1)).toISOString().slice(0, 10)
  const fim = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10)
  return [ini, fim]
}

// Lê todas as linhas de um período, paginando (teto de 1000 do PostgREST).
async function lerLinhasDoMes(supabase: Supa, tabela: TabelaArquivavel, periodo: string) {
  const col = TABELAS_ARQUIVAVEIS[tabela]
  const [ini, fim] = limitesMes(periodo)
  const linhas: Record<string, unknown>[] = []
  const LOTE = 1000
  for (let off = 0; ; off += LOTE) {
    const { data, error } = await supabase
      .from(tabela)
      .select('*')
      .gte(col, ini)
      .lt(col, fim)
      .order(col, { ascending: true })
      .range(off, off + LOTE - 1)
    if (error) throw new Error(`ler ${tabela} ${periodo}: ${error.message}`)
    if (!data || !data.length) break
    linhas.push(...(data as Record<string, unknown>[]))
    if (data.length < LOTE) break
  }
  return linhas
}

export type ResultadoArquivar = {
  tabela: TabelaArquivavel
  periodo: string
  linhas: number
  bytes?: number
  path?: string
  status: 'arquivado' | 'simulado' | 'ja_existe' | 'vazio' | 'erro'
  erro?: string
}

// Arquiva UM período de UMA tabela: exporta -> gzip -> Storage -> marca d'água -> delete.
// dryRun não lê nem move nada: reporta a contagem (vinda da RPC) como simulação.
export async function arquivarPeriodo(
  supabase: Supa,
  tabela: TabelaArquivavel,
  periodo: string,
  dryRun: boolean,
  linhasEsperadas = 0,
): Promise<ResultadoArquivar> {
  const col = TABELAS_ARQUIVAVEIS[tabela]
  const path = `${tabela}/${periodo}.json.gz`

  // Já arquivado? não reprocessa (evita duplicar e re-apagar).
  const { data: existente } = await supabase
    .from('arquivos_mortos')
    .select('id')
    .eq('tabela', tabela)
    .eq('periodo', periodo)
    .maybeSingle()
  if (existente) return { tabela, periodo, linhas: 0, status: 'ja_existe' }

  // Dry-run: não toca nos dados, usa a contagem já apurada pela RPC.
  if (dryRun) return { tabela, periodo, linhas: linhasEsperadas, path, status: 'simulado' }

  const linhas = await lerLinhasDoMes(supabase, tabela, periodo)
  if (!linhas.length) return { tabela, periodo, linhas: 0, status: 'vazio' }

  const buf = gzipSync(Buffer.from(JSON.stringify(linhas)))
  const up = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: 'application/gzip',
    upsert: true,
  })
  if (up.error) return { tabela, periodo, linhas: linhas.length, status: 'erro', erro: up.error.message }

  // Marca d'água ANTES do delete: se o delete falhar, o arquivo ainda consta como salvo.
  const { error: insErr } = await supabase
    .from('arquivos_mortos')
    .insert({ tabela, periodo, path, linhas: linhas.length, bytes: buf.byteLength })
  if (insErr) return { tabela, periodo, linhas: linhas.length, status: 'erro', erro: insErr.message }

  const [ini, fim] = limitesMes(periodo)
  const { error: delErr } = await supabase.from(tabela).delete().gte(col, ini).lt(col, fim)
  if (delErr) {
    return { tabela, periodo, linhas: linhas.length, status: 'erro', erro: `upload/registro ok, delete falhou: ${delErr.message}` }
  }
  return { tabela, periodo, linhas: linhas.length, bytes: buf.byteLength, path, status: 'arquivado' }
}

// Restaura UM período sob demanda: baixa -> descomprime -> re-insere (upsert) na
// própria tabela, deixando os dados consultáveis pelas telas normais.
export async function restaurarPeriodo(supabase: Supa, tabela: TabelaArquivavel, periodo: string) {
  const { data: reg } = await supabase
    .from('arquivos_mortos')
    .select('path')
    .eq('tabela', tabela)
    .eq('periodo', periodo)
    .maybeSingle()
  if (!reg) throw new Error(`nada arquivado para ${tabela} ${periodo}`)

  const dl = await supabase.storage.from(BUCKET).download(reg.path)
  if (dl.error || !dl.data) throw new Error(`download ${reg.path}: ${dl.error?.message ?? 'vazio'}`)
  const buf = Buffer.from(await dl.data.arrayBuffer())
  const linhas = JSON.parse(gunzipSync(buf).toString('utf8')) as Record<string, unknown>[]

  const LOTE = 500
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from(tabela).upsert(linhas.slice(i, i + LOTE))
    if (error) throw new Error(`reinserir ${tabela} ${periodo}: ${error.message}`)
  }
  await supabase
    .from('arquivos_mortos')
    .update({ restaurado_em: new Date().toISOString() })
    .eq('tabela', tabela)
    .eq('periodo', periodo)

  return { tabela, periodo, linhas: linhas.length }
}
