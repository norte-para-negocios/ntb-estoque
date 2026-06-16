'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { criptografar } from '@/lib/cripto'

// Bloco 5.2: a propria loja envia o certificado A1 (.pfx) + senha. Arquivo vai
// para o bucket privado 'certificados'; a senha e gravada criptografada. Nada
// sensivel (arquivo/senha) e logado.
export async function salvarCertificado(formData: FormData) {
  if (!(await isAdmin())) return { error: 'Sem permissão' }

  const lojaId = Number(formData.get('loja_id'))
  const senha = String(formData.get('senha') ?? '')
  const validade = String(formData.get('validade') ?? '')
  const arquivo = formData.get('arquivo') as File | null

  if (!lojaId) return { error: 'Loja inválida' }
  if (!arquivo || arquivo.size === 0) return { error: 'Selecione o arquivo do certificado (.pfx)' }
  if (!/\.(pfx|p12)$/i.test(arquivo.name)) return { error: 'O certificado deve ser um arquivo .pfx ou .p12' }
  if (arquivo.size > 5 * 1024 * 1024) return { error: 'Arquivo muito grande (máx 5 MB)' }
  if (!senha) return { error: 'Informe a senha do certificado' }

  const supabase = createServiceClient()
  const buffer = Buffer.from(await arquivo.arrayBuffer())
  const path = `loja-${lojaId}.pfx`

  const { error: upErr } = await supabase.storage
    .from('certificados')
    .upload(path, buffer, { upsert: true, contentType: 'application/x-pkcs12' })
  if (upErr) return { error: `Falha ao enviar o arquivo: ${upErr.message}` }

  const { error: dbErr } = await supabase
    .from('lojas')
    .update({
      certificado_path: path,
      certificado_nome: arquivo.name,
      certificado_senha_enc: criptografar(senha),
      certificado_validade: validade || null,
      certificado_atualizado: new Date().toISOString(),
    })
    .eq('id', lojaId)
  if (dbErr) return { error: `Falha ao salvar: ${dbErr.message}` }

  revalidatePath('/loja')
  return { ok: true }
}
