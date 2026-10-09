import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { urlEChaveAtuais } from '@/lib/supabase/server'

// App desktop (canal /api/offline): manda a sessão no header Authorization em vez de cookie.
// Validamos o token no GoTrue (setSession chama /user) e o transformamos nos mesmos cookies que
// o navegador mandaria, então createClient()/getProfile() funcionam sem mudança. Header não é
// enviado sozinho por navegador, então não abre CSRF. O desktop garante token com folga de
// validade e manda um refresh fictício, para o servidor nunca girar o refresh token dele.
async function injetarSessaoDesktop(request: NextRequest, url: string, key: string) {
  if (request.headers.get('x-ntb-desktop') !== '1') return
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return
  const recebidos: { name: string; value: string }[] = []
  const tmp = createServerClient(url, key, {
    cookies: {
      getAll() {
        return []
      },
      setAll(cs) {
        cs.forEach(({ name, value }) => recebidos.push({ name, value }))
      },
    },
  })
  const { error } = await tmp.auth.setSession({
    access_token: auth.slice(7),
    refresh_token: request.headers.get('x-ntb-refresh') || 'nao-usar',
  })
  if (error) return
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith('sb-')) request.cookies.delete(c.name)
  }
  recebidos.forEach(({ name, value }) => request.cookies.set(name, value))
}

export async function proxy(request: NextRequest) {
  // App desktop: o Next local só atende pedidos que passaram pelo gateway (que confere Host/Origin);
  // acesso direto à porta dele (outro site, DNS rebinding) é recusado.
  if (process.env.NTB_MODO_LOCAL === '1' && request.headers.get('x-ntb-gw') !== process.env.NTB_GATEWAY_TOKEN) {
    return new NextResponse('Bloqueado', { status: 403 })
  }
  const { url, key } = urlEChaveAtuais('anon')
  await injetarSessaoDesktop(request, url, key)

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/cadastro') ||
    path === '/manifest.webmanifest' ||
    path.startsWith('/api/webhook') ||
    path.startsWith('/api/cron') ||
    path.startsWith('/api/integracao') ||
    // canal do app desktop: cada rota autentica pelo header (lib/offline/canal.ts)
    path.startsWith('/api/offline')

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && (path.startsWith('/login') || path.startsWith('/cadastro'))) {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
