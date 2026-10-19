'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { criarLimitador, ipDoCliente } from '@/lib/seguranca/regras'

// Fase H: o login não tinha limite de tentativas (o GoTrue vê todo mundo vindo de 127.0.0.1, então o limite dele
// por IP não separa ninguém). 10 tentativas por e-mail+IP e 30 por IP a cada 5 minutos (memória do processo).
const excedeuPorConta = criarLimitador(10, 5 * 60_000)
const excedeuPorIp = criarLimitador(30, 5 * 60_000)

export async function login(_prevState: unknown, formData: FormData) {
  const __d = viaDesktop('auth#login', login, [_prevState, formData]); if (__d) return __d as never
  if (process.env.NTB_MODO_LOCAL !== '1') {
    const h = await headers()
    const ip = ipDoCliente((n) => h.get(n))
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const porIp = excedeuPorIp(ip)
    if (excedeuPorConta(`${ip}|${email}`) || porIp) return { error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' }
  }
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })
  if (error) {
    // App desktop: o login local explica o motivo (sem internet há mais de 30 dias, outro usuário com pendências...).
    if (process.env.NTB_MODO_LOCAL === '1' && error.message) return { error: error.message }
    return { error: 'E-mail ou senha inválidos.' }
  }
  redirect('/home')
}

export async function logout() {
  const __d = viaDesktop('auth#logout', logout, []); if (__d) return __d as never
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
