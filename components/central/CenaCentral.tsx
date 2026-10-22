'use client'

import * as React from 'react'
import * as THREE from 'three'

// Cena 3D do cabeçalho de cada módulo (só desenvolvedores): objetos macios que flutuam, giram devagar e
// inclinam na direção do mouse. Carregada com next/dynamic (ssr:false), então não pesa em nenhuma outra tela.
// Pausa fora da tela e com a aba escondida; com "reduzir movimento" desenha um quadro só.

type Peca = { geo: THREE.BufferGeometry; cor: string; pos: [number, number, number]; rot?: [number, number, number]; esc?: number }

const CAIXA = (l: number, a: number, p: number) => new THREE.BoxGeometry(l, a, p, 1, 1, 1)

// Função (e não constante): cada montagem cria geometrias novas, porque o desmonte as descarta.
const composicoes = (): Record<string, Peca[]> => ({
  inicio: [
    { geo: new THREE.IcosahedronGeometry(0.9, 1), cor: 'marca', pos: [0, 0.1, 0] },
    { geo: CAIXA(0.7, 0.7, 0.7), cor: 'claro', pos: [-1.5, -0.5, 0.3], rot: [0.5, 0.6, 0] },
    { geo: new THREE.SphereGeometry(0.42, 32, 24), cor: 'ambar', pos: [1.45, 0.6, 0.2] },
    { geo: new THREE.TorusGeometry(0.45, 0.14, 20, 48), cor: 'claro', pos: [1.2, -0.7, 0], rot: [1.1, 0.3, 0] },
  ],
  estoque: [
    { geo: CAIXA(1.3, 0.9, 1.1), cor: 'marca', pos: [-0.2, -0.45, 0], rot: [0, 0.5, 0] },
    { geo: CAIXA(0.95, 0.7, 0.95), cor: 'claro', pos: [0.15, 0.4, 0.05], rot: [0, -0.3, 0] },
    { geo: CAIXA(0.7, 0.6, 0.7), cor: 'ambar', pos: [1.5, -0.6, 0.3], rot: [0.2, 0.7, 0] },
    { geo: CAIXA(0.55, 0.55, 0.55), cor: 'marca', pos: [-1.6, 0.5, 0.2], rot: [0.5, 0.4, 0.2] },
  ],
  compras: [
    { geo: new THREE.SphereGeometry(0.75, 40, 28), cor: 'marca', pos: [-0.3, 0, 0] },
    { geo: new THREE.TorusGeometry(1.15, 0.12, 20, 64), cor: 'claro', pos: [-0.3, 0, 0], rot: [1.2, 0.2, 0] },
    { geo: new THREE.SphereGeometry(0.34, 28, 20), cor: 'ambar', pos: [1.5, 0.7, 0.2] },
    { geo: new THREE.SphereGeometry(0.26, 28, 20), cor: 'claro', pos: [1.6, -0.6, 0.4] },
  ],
  producao: [
    { geo: new THREE.CylinderGeometry(0.85, 0.85, 0.35, 10), cor: 'marca', pos: [-0.5, 0, 0], rot: [1.2, 0, 0.3] },
    { geo: new THREE.CylinderGeometry(0.55, 0.55, 0.3, 8), cor: 'ambar', pos: [0.9, 0.55, 0.2], rot: [1.2, 0, 0.1] },
    { geo: new THREE.TorusKnotGeometry(0.4, 0.13, 90, 12), cor: 'claro', pos: [1.45, -0.7, 0.1] },
  ],
  fiscal: [
    { geo: CAIXA(1.05, 1.45, 0.07), cor: 'claro', pos: [-0.8, 0, -0.2], rot: [0, 0.35, -0.18] },
    { geo: CAIXA(1.05, 1.45, 0.07), cor: 'marca', pos: [0, 0, 0], rot: [0, 0.15, 0] },
    { geo: CAIXA(1.05, 1.45, 0.07), cor: 'ambar', pos: [0.85, 0, 0.2], rot: [0, -0.2, 0.15] },
  ],
  financas: [
    { geo: new THREE.CylinderGeometry(0.8, 0.8, 0.16, 48), cor: 'marca', pos: [-0.2, -0.45, 0], rot: [0.35, 0, 0.1] },
    { geo: new THREE.CylinderGeometry(0.8, 0.8, 0.16, 48), cor: 'claro', pos: [-0.2, -0.2, 0], rot: [0.35, 0, 0.1] },
    { geo: new THREE.CylinderGeometry(0.8, 0.8, 0.16, 48), cor: 'ambar', pos: [-0.2, 0.05, 0], rot: [0.35, 0, 0.1] },
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.12, 40), cor: 'marca', pos: [1.4, 0.4, 0.2], rot: [1.1, 0.4, 0] },
  ],
  administracao: [
    { geo: new THREE.OctahedronGeometry(0.95, 0), cor: 'marca', pos: [-0.1, 0, 0] },
    { geo: new THREE.IcosahedronGeometry(0.42, 0), cor: 'ambar', pos: [1.45, 0.55, 0.2] },
    { geo: new THREE.TetrahedronGeometry(0.5, 0), cor: 'claro', pos: [-1.5, -0.55, 0.3] },
    { geo: new THREE.TorusGeometry(0.4, 0.12, 16, 40), cor: 'claro', pos: [1.3, -0.7, 0.1], rot: [1, 0.2, 0] },
  ],
})

const facilita = (t: number) => {
  // easeOutBack: entra passando um pouco do tamanho e assenta.
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export default function CenaCentral({ modulo }: { modulo: string }) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const host = ref.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      return // sem WebGL: o cabeçalho fica só com o degradê
    }
    const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const css = getComputedStyle(host)
    const marca = css.getPropertyValue('--brand').trim() || '#168e9a'
    const cores: Record<string, string> = { marca, claro: '#e9f7f9', ambar: '#f2b04c' }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
    host.appendChild(renderer.domElement)

    const cena = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50)
    camera.position.set(0, 0.2, 7.2)
    cena.add(new THREE.HemisphereLight(0xffffff, 0x7fb4bb, 1.35))
    const sol = new THREE.DirectionalLight(0xffffff, 2.1)
    sol.position.set(-3, 4, 5)
    cena.add(sol)
    const contra = new THREE.DirectionalLight(0xa8e6ee, 1.1)
    contra.position.set(4, -1, -3)
    cena.add(contra)

    const grupo = new THREE.Group()
    cena.add(grupo)
    const materiais: THREE.Material[] = []
    const comp = composicoes()
    const pecas = (comp[modulo] ?? comp.inicio).map((p, k) => {
      const mat = new THREE.MeshStandardMaterial({ color: cores[p.cor], roughness: 0.32, metalness: p.cor === 'claro' ? 0.05 : 0.18 })
      materiais.push(mat)
      const m = new THREE.Mesh(p.geo, mat)
      m.position.set(...p.pos)
      if (p.rot) m.rotation.set(...p.rot)
      m.scale.setScalar(reduzir ? 1 : 0.001)
      grupo.add(m)
      return { m, base: new THREE.Vector3(...p.pos), vel: 0.18 + k * 0.07, fase: k * 1.7, atraso: k * 110 }
    })

    const tamanho = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // setSize limpa o canvas: redesenha já (vale também com o loop parado, no modo de movimento reduzido).
      renderer.render(cena, camera)
    }
    tamanho()
    const ro = new ResizeObserver(tamanho)
    ro.observe(host)

    const alvo = { x: 0, y: 0 }
    const onMove = (e: PointerEvent) => {
      alvo.x = (e.clientX / window.innerWidth - 0.5) * 2
      alvo.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    if (!reduzir) window.addEventListener('pointermove', onMove, { passive: true })

    let visivel = true
    let aba = !document.hidden
    let raf = 0
    const t0 = performance.now()
    const quadro = (agora: number) => {
      const t = agora - t0
      const s = t / 1000
      grupo.rotation.y += (alvo.x * 0.35 - grupo.rotation.y) * 0.06
      grupo.rotation.x += (alvo.y * 0.18 - grupo.rotation.x) * 0.06
      for (const p of pecas) {
        if (!reduzir) {
          const e = Math.min(Math.max((t - p.atraso) / 900, 0), 1)
          p.m.scale.setScalar(Math.max(facilita(e), 0.001))
          p.m.position.y = p.base.y + Math.sin(s * 0.9 + p.fase) * 0.09
          p.m.rotation.y += 0.004 * (p.vel * 4)
          p.m.rotation.x += 0.0015
        }
      }
      renderer.render(cena, camera)
      if (!reduzir && visivel && aba) raf = requestAnimationFrame(quadro)
      else raf = 0
    }
    const iniciar = () => {
      if (!raf && !reduzir && visivel && aba) raf = requestAnimationFrame(quadro)
    }
    quadro(performance.now())
    iniciar()

    const io = new IntersectionObserver(([e]) => {
      visivel = e.isIntersecting
      iniciar()
    })
    io.observe(host)
    const onVis = () => {
      aba = !document.hidden
      iniciar()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      for (const p of pecas) p.m.geometry.dispose()
      materiais.forEach((m) => m.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [modulo])

  return <div ref={ref} className="size-full" aria-hidden />
}
