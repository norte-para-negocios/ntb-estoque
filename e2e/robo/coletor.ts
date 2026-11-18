// Coletor que roda dentro da página (só lê o DOM; não clica em nada).
export function coletar() {
  const raiz = document.querySelector('main') ?? document.body
  const visivel = (e: Element) => {
    const r = (e as HTMLElement).getBoundingClientRect()
    const s = getComputedStyle(e as HTMLElement)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const texto = (raiz as HTMLElement).innerText ?? ''
  const titulo = (document.querySelector('main h1, h1') as HTMLElement | null)?.innerText?.trim() ?? ''
  const rot = (e: Element) => ((e as HTMLElement).innerText || e.getAttribute('aria-label') || e.getAttribute('title') || (e as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').slice(0, 80)
  const acoes: { texto: string; tipo: string }[] = []
  const vistos = new Set<string>()
  for (const e of raiz.querySelectorAll('button, [role=button], [role=tab], input[type=submit], a[href]')) {
    if (!visivel(e)) continue
    const ehLink = e.tagName === 'A'
    if (ehLink && e.closest('tbody, [role=row], [role=grid], [role=gridcell]')) continue
    const tipo = ehLink ? 'link' : e.getAttribute('role') === 'tab' ? 'aba' : 'botão'
    const t = rot(e) || '(ícone sem rótulo)'
    const k = `${tipo}|${t}`
    if (vistos.has(k)) continue
    vistos.add(k)
    acoes.push({ texto: t, tipo })
    if (acoes.length >= 150) break
  }
  // texto cortado: conteúdo escondido por overflow sem reticências
  const cortados: string[] = []
  let totalCortados = 0
  for (const e of raiz.querySelectorAll('*')) {
    const h = e as HTMLElement
    if (!h.innerText || h.clientWidth < 8 || !visivel(h)) continue
    const s = getComputedStyle(h)
    if (!/^(hidden|clip)$/.test(s.overflowX)) continue
    if (s.textOverflow === 'ellipsis') continue
    if (h.scrollWidth > h.clientWidth + 2) {
      totalCortados++
      if (cortados.length < 5) cortados.push(`${h.tagName.toLowerCase()} "${h.innerText.trim().replace(/\s+/g, ' ').slice(0, 50)}" (largura ${h.clientWidth}px, conteúdo ${h.scrollWidth}px)`)
    }
  }
  const estouro = document.documentElement.scrollWidth > window.innerWidth + 2
  let overlay = ''
  const portal = document.querySelector('nextjs-portal') as (Element & { shadowRoot: ShadowRoot | null }) | null
  const t = portal?.shadowRoot?.textContent ?? ''
  if (/Runtime|Build Error|Unhandled|Application error/i.test(t)) overlay = t.replace(/\s+/g, ' ').slice(0, 200)
  const linksMenu = [...document.querySelectorAll('aside a[href]')].map((a) => a.getAttribute('href') ?? '')
  return { texto, titulo, acoes, cortados, totalCortados, estouro, overlay, linksMenu, temMain: !!document.querySelector('main') }
}
