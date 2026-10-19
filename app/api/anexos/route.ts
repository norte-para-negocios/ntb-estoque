import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import { caminhoAnexo, LIMITE_ANEXO_BYTES, origemAceita, validarAnexo } from '@/lib/anexos/anexos-puro'
import { BUCKET_ANEXOS, contextoAnexo, ehEntidadeAnexo, registroExiste } from '@/lib/anexos/servidor'

// Fase G [O2]: envio de anexo (multipart: entidade, entidade_id, arquivo). Sessão + permissão + loja + registro existe;
// tipo decidido pelo conteúdo; limite 8 MB; até 20 por registro. Só com internet (o desktop offline não tem Storage).
export async function POST(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origemAceita(req.headers.get('origin'), host) && !origemAceita(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403 })
  }
  const tamanhoCorpo = Number(req.headers.get('content-length') ?? 0)
  if (tamanhoCorpo > LIMITE_ANEXO_BYTES + 512 * 1024) return NextResponse.json({ error: 'Arquivo muito grande: o limite é 8 MB.' }, { status: 413 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Envio inválido' }, { status: 400 })
  const entidade = form.get('entidade')
  const entidadeId = String(form.get('entidade_id') ?? '')
  const arquivo = form.get('arquivo')
  if (!ehEntidadeAnexo(entidade)) return NextResponse.json({ error: 'Registro inválido' }, { status: 400 })
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'Selecione um arquivo' }, { status: 400 })

  const ctx = await contextoAnexo(entidade, 'enviar')
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (!(await registroExiste(ctx.lojaId, entidade, entidadeId))) return NextResponse.json({ error: 'Registro não encontrado nesta loja' }, { status: 404 })

  const sb = createServiceClient()
  const { count, error: errCount } = await sb.from('anexos').select('id', { count: 'exact', head: true })
    .eq('loja_id', ctx.lojaId).eq('entidade', entidade).eq('entidade_id', entidadeId).is('excluido_em', null)
  if (errCount) return NextResponse.json({ error: errCount.code === '42P01' ? 'Anexos ainda não ativados neste servidor.' : 'Falha ao consultar os anexos' }, { status: 503 })

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarAnexo({ nome: arquivo.name, tamanho: arquivo.size, bytes, existentes: count ?? 0 })
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

  const caminho = caminhoAnexo(ctx.lojaId, entidade, entidadeId, randomUUID(), v.tipo.ext)
  const { error: errUp } = await sb.storage.from(BUCKET_ANEXOS).upload(caminho, bytes, { contentType: v.tipo.mime, upsert: false })
  if (errUp) {
    console.error('anexos: falha no upload', errUp.message)
    return NextResponse.json({ error: 'Não foi possível guardar o arquivo agora. Tente de novo.' }, { status: 502 })
  }
  const perfil = await getProfile()
  const { data, error } = await sb.from('anexos').insert({
    loja_id: ctx.lojaId, entidade, entidade_id: entidadeId, nome_arquivo: v.nome, caminho, tipo_mime: v.tipo.mime, tamanho: arquivo.size,
    enviado_por: perfil.id, enviado_por_nome: perfil.name,
  }).select('id').single()
  if (error) {
    await sb.storage.from(BUCKET_ANEXOS).remove([caminho]) // não deixa arquivo órfão no bucket
    console.error('anexos: falha ao registrar', error.message)
    return NextResponse.json({ error: 'Não foi possível registrar o anexo. Tente de novo.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id, nome: v.nome })
}
