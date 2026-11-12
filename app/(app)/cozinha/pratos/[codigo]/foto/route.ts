import { NextResponse } from 'next/server'
import { getAtorGestao, getCurrentLojaId, getProfile } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { createServiceClient } from '@/lib/supabase/server'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { BUCKET_FOTOS } from '@/lib/custo-cardapio/receita-info'
import { caminhoFoto, fotoEhDe, LIMITE_FOTO_BYTES, validarFoto } from '@/lib/custo-cardapio/guia-puro'

// Norte Cozinha (só dev): envio/troca da foto do prato (multipart, campo "foto"). Rota e não server action porque
// o corpo de server action é limitado a 1 MB. Tipo decidido pelo conteúdo (JPG, PNG, WebP), até 5 MB.
// Bucket privado cozinha-fotos, caminho <loja>/<produto>-<momento>.<ext>; a foto anterior é apagada depois de gravar a nova.

function origemAceita(req: Request) {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const host = new URL(origin).host
    return host === req.headers.get('host') || host === req.headers.get('x-forwarded-host')
  } catch {
    return false
  }
}

const erro = (msg: string, status: number) => NextResponse.json({ error: msg }, { status })

export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  if (!origemAceita(req)) return erro('Origem não permitida', 403)
  if (!(await ehDesenvolvedor())) return erro('Recurso ainda em teste.', 404)
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return erro('Sem permissão', 403)
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) return erro('Sem permissão nesta loja', 403)
  const codigo = Number((await params).codigo)
  if (!Number.isSafeInteger(codigo) || codigo <= 0) return erro('Produto inválido', 400)
  const base = await carregarBase(lojaId)
  if (!base?.produtos.has(codigo)) return erro('Produto não encontrado nesta loja', 404)

  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_FOTO_BYTES + 256 * 1024) return erro('Foto muito grande: o limite é 5 MB.', 413)
  const form = await req.formData().catch(() => null)
  const arquivo = form?.get('foto')
  if (!(arquivo instanceof File)) return erro('Selecione uma foto.', 400)
  if (arquivo.size > LIMITE_FOTO_BYTES) return erro('Foto muito grande: o limite é 5 MB.', 413)
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarFoto(bytes)
  if (!v.ok) return erro(v.erro, 400)

  const sb = createServiceClient()
  const { data: atual, error: errLer } = await sb.from('custo_receita_info').select('foto_path')
    .eq('loja_id', lojaId).eq('codigo_produto', codigo).maybeSingle()
  if (errLer) return erro('Não foi possível ler a ficha agora. Tente de novo.', 503)

  const caminho = caminhoFoto(lojaId, codigo, Date.now(), v.tipo.ext)
  const { error: errUp } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, bytes, { contentType: v.tipo.mime, upsert: false })
  if (errUp) {
    console.error('cozinha-fotos: falha no upload', errUp.message)
    return erro('Não foi possível guardar a foto agora. Tente de novo.', 502)
  }
  const nome = (await getProfile()).name
  const { error } = await sb.from('custo_receita_info').upsert(
    { loja_id: lojaId, codigo_produto: codigo, foto_path: caminho, atualizado_por: nome, updated_at: new Date().toISOString() },
    { onConflict: 'loja_id,codigo_produto' },
  )
  if (error) {
    await sb.storage.from(BUCKET_FOTOS).remove([caminho]) // não deixa arquivo órfão
    return erro('Não foi possível salvar a foto agora. Tente de novo.', 500)
  }
  if (atual?.foto_path && atual.foto_path !== caminho && fotoEhDe(atual.foto_path, lojaId, codigo)) {
    const { error: errRm } = await sb.storage.from(BUCKET_FOTOS).remove([atual.foto_path])
    if (errRm) console.error(`cozinha-fotos: foto antiga ${atual.foto_path} ficou no bucket: ${errRm.message}`)
  }
  return NextResponse.json({ ok: true })
}
