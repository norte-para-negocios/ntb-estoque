import 'server-only'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

// Norte Cozinha, ficha de preparo (modo de preparo, observações, tempo, rendimento, foto): leitura por RLS
// (custo_receita_info, migration 474). A foto fica no bucket privado cozinha-fotos e só sai por URL assinada
// gerada aqui no servidor. Gravação só em lib/actions/cozinha-receitas.ts e na rota da foto.

export const BUCKET_FOTOS = 'cozinha-fotos'
const VALIDADE_URL_S = 60 * 60

export type InfoReceita = {
  codigo: number
  modoPreparo: string | null
  observacoes: string | null
  tempoPreparoMin: number | null
  rendimentoTexto: string | null
  fotoPath: string | null
  /** URL assinada (1 h) ou null. */
  fotoUrl: string | null
  atualizadoPor: string | null
  atualizadoEm: string | null
}

type Row = {
  codigo_produto: number; modo_preparo: string | null; observacoes: string | null; tempo_preparo_min: number | null
  rendimento_texto: string | null; foto_path: string | null; atualizado_por: string | null; updated_at: string | null
}
const SELECT = 'codigo_produto, modo_preparo, observacoes, tempo_preparo_min, rendimento_texto, foto_path, atualizado_por, updated_at'

const ler = (r: Row, fotoUrl: string | null): InfoReceita => ({
  codigo: Number(r.codigo_produto), modoPreparo: r.modo_preparo, observacoes: r.observacoes,
  tempoPreparoMin: r.tempo_preparo_min == null ? null : Number(r.tempo_preparo_min), rendimentoTexto: r.rendimento_texto,
  fotoPath: r.foto_path, fotoUrl, atualizadoPor: r.atualizado_por, atualizadoEm: r.updated_at,
})

/** URLs assinadas de vários caminhos numa chamada só. */
export async function urlsAssinadas(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unicos = [...new Set(paths.filter(Boolean))]
  if (!unicos.length) return out
  const { data, error } = await createServiceClient().storage.from(BUCKET_FOTOS).createSignedUrls(unicos, VALIDADE_URL_S)
  if (error) { console.error('cozinha-fotos: falha ao assinar URLs', error.message); return out }
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl)
  return out
}

/** Ficha de preparo de um produto da loja (null = ainda não preenchida ou migration ausente). */
export async function carregarInfoReceita(lojaId: number, codigo: number): Promise<InfoReceita | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('custo_receita_info').select(SELECT).eq('loja_id', lojaId).eq('codigo_produto', codigo).maybeSingle()
  if (error || !data) return null
  const r = data as Row
  const urls = r.foto_path ? await urlsAssinadas([r.foto_path]) : new Map<string, string>()
  return ler(r, r.foto_path ? urls.get(r.foto_path) ?? null : null)
}

/** Todas as fichas de preparo da loja (com as URLs das fotos), por produto. */
export async function infosDaLoja(lojaId: number): Promise<Map<number, InfoReceita>> {
  const supabase = await createClient()
  let falhou = false
  const rows = await buscarTodasLinhas<Row>((from, to) =>
    supabase.from('custo_receita_info').select(SELECT).eq('loja_id', lojaId).order('codigo_produto').range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  undefined, () => { falhou = true })
  const out = new Map<number, InfoReceita>()
  if (falhou && !rows.length) return out
  const urls = await urlsAssinadas(rows.map((r) => r.foto_path ?? '').filter(Boolean))
  for (const r of rows) out.set(Number(r.codigo_produto), ler(r, r.foto_path ? urls.get(r.foto_path) ?? null : null))
  return out
}

/** Bytes da foto para o PDF (o @react-pdf aceita Buffer). null se não der para baixar. */
export async function bytesDaFoto(path: string | null): Promise<{ data: Buffer; format: 'jpg' | 'png' } | null> {
  if (!path) return null
  const { data, error } = await createServiceClient().storage.from(BUCKET_FOTOS).download(path)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  // O @react-pdf só desenha JPG e PNG: WebP fica fora do PDF.
  if (buf[0] === 0xff && buf[1] === 0xd8) return { data: buf, format: 'jpg' }
  if (buf[0] === 0x89 && buf[1] === 0x50) return { data: buf, format: 'png' }
  return null
}
