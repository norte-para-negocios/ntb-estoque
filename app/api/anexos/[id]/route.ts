import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { cabecalhoDownload, MIMES_ANEXO } from '@/lib/anexos/anexos-puro'
import { BUCKET_ANEXOS, contextoAnexo, ehEntidadeAnexo } from '@/lib/anexos/servidor'

const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

// Fase G [O2]: baixa (ou abre, ?ver=1, só PDF/imagem) um anexo da loja atual. O arquivo passa pelo servidor: o navegador
// nunca recebe URL do Storage.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: 'Anexo inválido' }, { status: 400 })
  const lojaId = await getCurrentLojaId()
  const sb = createServiceClient()
  const { data: a } = await sb.from('anexos').select('id, loja_id, entidade, nome_arquivo, caminho, tipo_mime, excluido_em')
    .eq('id', id).eq('loja_id', lojaId).maybeSingle()
  if (!a || a.excluido_em || !ehEntidadeAnexo(a.entidade)) return NextResponse.json({ error: 'Anexo não encontrado' }, { status: 404 })
  const ctx = await contextoAnexo(a.entidade, 'ver')
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { data: blob, error } = await sb.storage.from(BUCKET_ANEXOS).download(a.caminho as string)
  if (error || !blob) return NextResponse.json({ error: 'Arquivo indisponível agora' }, { status: 502 })
  const mime = MIMES_ANEXO.includes(a.tipo_mime as string) ? (a.tipo_mime as string) : 'application/octet-stream'
  const ver = new URL(req.url).searchParams.get('ver') === '1' && INLINE.has(mime)
  return new Response(blob.stream(), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': cabecalhoDownload(a.nome_arquivo as string, ver),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(blob.size),
    },
  })
}
