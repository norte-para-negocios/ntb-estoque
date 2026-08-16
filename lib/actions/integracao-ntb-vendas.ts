'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Integracao ntb-vendas -> ntb-estoque (ver app/api/integracao/ordem-producao/route.ts
// e migration 061_integracao_api_key.sql): cada venda fechada no ntb-vendas dispara
// uma Ordem de Producao aqui, autenticada por lojas.integracao_api_key. Ate 2026-08-16
// essa chave so existia via SQL manual -- pedido explicito do usuario pra ter UI dos
// dois lados (a UI do lado ntb-vendas, que consome essa chave, ja existia em
// StoreModule.tsx/AdminModule.tsx).

function gerarChave(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// URL publica desta instancia do ntb-estoque, pra mostrar junto da chave (o
// operador so precisa copiar os dois valores pro formulario do ntb-vendas).
// Mesmo fallback ja usado em app/(app)/loja/page.tsx: o app de verdade roda
// no Contabo, NEXT_PUBLIC_APP_URL nunca foi configurado la.
function urlPublica(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app-estoque.norteparanegocios.com.br'
}

// Gera (ou regenera) a chave de integracao de uma loja. So admin. A chave e
// retornada UMA VEZ no resultado da action -- nunca fica disponivel de volta
// depois (mesmo principio de write-only ja usado no CSC/senha do certificado
// deste projeto e do ntb-vendas). Regenerar invalida a chave anterior.
export async function gerarChaveIntegracaoNtbVendas(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const chave = gerarChave()
    const { error } = await supabase
      .from('lojas')
      .update({ integracao_api_key: chave })
      .eq('id', lojaId)
    if (!error) {
      revalidatePath('/loja')
      return { ok: true, chave, url: urlPublica() }
    }
    // 23505 = unique_violation -> tenta outra chave (colisao e rarissima).
    if (error.code !== '23505') return { error: 'Não foi possível gerar a chave.' }
  }
  return { error: 'Não foi possível gerar uma chave única. Tente de novo.' }
}

// Remove a chave (desliga a integração desse lado -- toda venda do
// ntb-vendas passa a receber 401 dessa loja até uma chave nova ser gerada
// e reconfigurada do outro lado). Apenas admin.
export async function removerChaveIntegracaoNtbVendas(lojaId: number) {
  if (!(await isAdmin())) return { error: 'Apenas administradores' }
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('lojas')
    .update({ integracao_api_key: null })
    .eq('id', lojaId)
  if (error) return { error: 'Não foi possível remover a chave.' }
  revalidatePath('/loja')
  return { ok: true }
}
