'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Gera um codigo de onboarding curto, legivel e sem caracteres ambiguos.
function gerarCodigo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem I, O, 0, 1
  let s = ''
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  for (const b of bytes) s += chars[b % chars.length]
  // Formato NTB-XXXXXXXX para o usuario reconhecer.
  return `NTB-${s}`
}

// Gera (ou regenera) o codigo de onboarding de uma loja. Apenas admin global.
// Regenerar invalida o codigo anterior (quem tinha o antigo nao consegue mais usar).
export async function gerarCodigoLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()

  // Tenta ate achar um codigo livre (colisao e rarissima).
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo()
    const { error } = await supabase
      .from('lojas')
      .update({ codigo_onboarding: codigo })
      .eq('id', lojaId)
    if (!error) {
      revalidatePath('/loja')
      return { ok: true, codigo }
    }
    // 23505 = unique_violation -> tenta outro codigo.
    if (error.code !== '23505') return { error: 'Não foi possível gerar o código.' }
  }
  return { error: 'Não foi possível gerar um código único. Tente de novo.' }
}

// Remove o codigo (desliga o onboarding por codigo daquela loja). Apenas admin.
export async function removerCodigoLoja(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({ codigo_onboarding: null })
    .eq('id', lojaId)
  if (error) return { error: 'Não foi possível remover o código.' }
  revalidatePath('/loja')
  return { ok: true }
}
