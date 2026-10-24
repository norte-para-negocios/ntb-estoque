'use client'

import * as React from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// Cena 3D do cabeçalho de cada módulo (só desenvolvedores): uma mini maquete em "massinha" fosca vista de cima,
// com o que o módulo é (prateleira com caixas no Estoque, bancada com panela na Produção…). Escolhida pelo dono
// em 24/10/2026 entre três protótipos. As peças caem no lugar ao abrir e o conjunto inclina com o mouse.
// Carregada com next/dynamic (ssr:false); pausa fora da tela e com a aba escondida; com "reduzir movimento"
// desenha um quadro só.

type Cor = 'marca' | 'claro' | 'ambar' | 'kraft' | 'papel'
type Mats = Record<Cor, THREE.MeshStandardMaterial>
type Peca = { obj: THREE.Object3D; base: THREE.Vector3; atraso: number }

const CORES: Record<Cor, string> = { marca: '#117c87', claro: '#eaf6f7', ambar: '#f2b04c', kraft: '#d6b48a', papel: '#ffffff' }
const BASE = '#d5ecef'
const TOPO = -0.675 // altura da face de cima da base

const rb = (w: number, h: number, d: number, r = 0.06) => new RoundedBoxGeometry(w, h, d, 4, r)
const malha = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.Mesh(g, m)

// ---------- peças ----------
function caixa(M: Mats, w: number, h: number, d: number, corpo: Cor = 'kraft') {
  const g = new THREE.Group()
  g.add(malha(rb(w, h, d), M[corpo]))
  const fita = malha(rb(w * 0.22, 0.02, d + 0.01, 0.01), M.marca)
  fita.position.y = h / 2
  g.add(fita)
  const etiqueta = malha(rb(w * 0.34, h * 0.26, 0.02, 0.01), M.papel)
  etiqueta.position.set(-w * 0.18, -h * 0.08, d / 2 + 0.005)
  g.add(etiqueta)
  return g
}

function sacola(M: Mats) {
  const g = new THREE.Group()
  g.add(malha(rb(1.05, 1.2, 0.5, 0.07), M.marca))
  const alca = malha(new THREE.TorusGeometry(0.26, 0.04, 12, 40, Math.PI), M.ambar)
  alca.position.y = 0.6
  g.add(alca)
  const faixa = malha(rb(1.06, 0.14, 0.51, 0.02), M.claro)
  faixa.position.y = 0.1
  g.add(faixa)
  return g
}

/** Nota fiscal deitada (linhas em relevo). */
function nota(M: Mats) {
  const g = new THREE.Group()
  g.add(malha(rb(0.8, 0.04, 1.1, 0.02), M.papel))
  for (let i = 0; i < 4; i++) {
    const l = malha(rb(i === 0 ? 0.5 : 0.6, 0.05, 0.05, 0.02), i === 0 ? M.marca : M.claro)
    l.position.set(i === 0 ? -0.05 : 0, 0.01, -0.35 + i * 0.2)
    g.add(l)
  }
  const total = malha(rb(0.3, 0.05, 0.08, 0.02), M.ambar)
  total.position.set(0.15, 0.01, 0.42)
  g.add(total)
  return g
}

function panela(M: Mats) {
  const g = new THREE.Group()
  const perfil = [[0, -0.45], [0.7, -0.45], [0.78, -0.38], [0.8, 0.35], [0.86, 0.4], [0.8, 0.42]].map(([x, y]) => new THREE.Vector2(x, y))
  const corpo = malha(new THREE.LatheGeometry(perfil, 48), M.marca)
  g.add(corpo)
  const tampa = malha(new THREE.SphereGeometry(0.82, 48, 16, 0, Math.PI * 2, 0, 0.42), M.claro)
  tampa.position.y = 0.05
  g.add(tampa)
  const pino = malha(new THREE.SphereGeometry(0.1, 20, 14), M.ambar)
  pino.position.y = 0.42
  g.add(pino)
  for (const s of [-1, 1]) {
    const a = malha(new THREE.TorusGeometry(0.14, 0.045, 10, 24, Math.PI), M.ambar)
    a.position.set(s * 0.88, 0.2, 0)
    a.rotation.z = -s * (Math.PI / 2)
    g.add(a)
  }
  return g
}

function concha(M: Mats) {
  const g = new THREE.Group()
  const cabo = malha(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12), M.claro)
  cabo.position.y = 0.55
  g.add(cabo)
  g.add(malha(new THREE.SphereGeometry(0.26, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.ambar))
  return g
}

function bussola(M: Mats) {
  const g = new THREE.Group()
  g.add(malha(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 48), M.claro))
  const anel = malha(new THREE.TorusGeometry(0.62, 0.06, 16, 64), M.marca)
  anel.rotation.x = Math.PI / 2
  g.add(anel)
  const agulha = malha(new THREE.ConeGeometry(0.1, 0.5, 4), M.ambar)
  agulha.rotation.set(Math.PI / 2, 0, -Math.PI / 2 + 0.6)
  agulha.position.y = 0.1
  g.add(agulha)
  return g
}

function moedas(M: Mats, n: number) {
  const g = new THREE.Group()
  for (let i = 0; i < n; i++) {
    const m = malha(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 36), M.ambar)
    m.position.set(Math.sin(i * 1.3) * 0.02, i * 0.075, Math.cos(i * 1.7) * 0.02)
    g.add(m)
  }
  return g
}

function calculadora(M: Mats) {
  const g = new THREE.Group()
  g.add(malha(rb(0.75, 0.12, 1, 0.05), M.marca))
  const visor = malha(rb(0.55, 0.04, 0.22, 0.02), M.claro)
  visor.position.set(0, 0.07, -0.3)
  g.add(visor)
  for (let i = 0; i < 9; i++) {
    const t = malha(rb(0.13, 0.05, 0.13, 0.03), i === 8 ? M.ambar : M.papel)
    t.position.set(-0.18 + (i % 3) * 0.18, 0.07, -0.04 + Math.floor(i / 3) * 0.18)
    g.add(t)
  }
  return g
}

function carimbo(M: Mats) {
  const g = new THREE.Group()
  g.add(malha(rb(0.5, 0.14, 0.34, 0.04), M.marca))
  const haste = malha(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 16), M.claro)
  haste.position.y = 0.22
  g.add(haste)
  const pega = malha(new THREE.SphereGeometry(0.15, 20, 14), M.ambar)
  pega.position.y = 0.42
  g.add(pega)
  return g
}

/** Lojinha com toldo listrado (Administração: lojas e pessoas). */
function lojinha(M: Mats) {
  const g = new THREE.Group()
  const corpo = malha(rb(1.2, 0.85, 0.8, 0.05), M.papel)
  corpo.position.y = 0.42
  g.add(corpo)
  const porta = malha(rb(0.28, 0.5, 0.04, 0.02), M.marca)
  porta.position.set(-0.25, 0.27, 0.41)
  g.add(porta)
  const vitrine = malha(rb(0.4, 0.3, 0.04, 0.02), M.claro)
  vitrine.position.set(0.25, 0.4, 0.41)
  g.add(vitrine)
  for (let i = 0; i < 6; i++) {
    const listra = malha(rb(0.2, 0.06, 0.34, 0.02), i % 2 ? M.papel : M.marca)
    listra.position.set(-0.5 + i * 0.2, 0.86, 0.5)
    listra.rotation.x = 0.45
    g.add(listra)
  }
  return g
}

function engrenagem(M: Mats) {
  const g = new THREE.Group()
  const anel = malha(new THREE.CylinderGeometry(0.36, 0.36, 0.14, 32), M.ambar)
  g.add(anel)
  for (let i = 0; i < 8; i++) {
    const dente = malha(rb(0.14, 0.14, 0.14, 0.03), M.ambar)
    const a = (i / 8) * Math.PI * 2
    dente.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42)
    dente.rotation.y = -a
    g.add(dente)
  }
  const furo = malha(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 20), M.claro)
  g.add(furo)
  return g
}

// ---------- maquetes ----------
type Add = (o: THREE.Object3D, x: number, y: number, z: number, ry?: number, s?: number) => void

function maquete(modulo: string, M: Mats, add: Add) {
  const chao = (h: number) => TOPO + h / 2 // centro de uma peça de altura h pousada na base
  switch (modulo) {
    case 'estoque': {
      const prat = new THREE.Group()
      for (const y of [0, 0.6]) {
        const t = malha(rb(2.2, 0.08, 0.7, 0.03), M.kraft)
        t.position.y = y
        prat.add(t)
      }
      for (const x of [-1.05, 1.05]) {
        const p = malha(rb(0.08, 1.2, 0.7, 0.03), M.marca)
        p.position.set(x, 0.3, 0)
        prat.add(p)
      }
      add(prat, -0.2, TOPO + 0.04, -0.3)
      add(caixa(M, 0.5, 0.4, 0.5), -0.6, chao(0.4) + 0.08, -0.3, 0.2)
      add(caixa(M, 0.45, 0.4, 0.45), 0.1, chao(0.4) + 0.08, -0.3, -0.2)
      add(caixa(M, 0.4, 0.35, 0.4), -0.3, chao(0.35) + 0.68, -0.3, 0.3)
      add(caixa(M, 0.55, 0.45, 0.55, 'marca'), 1.2, chao(0.45), 0.5, 0.5)
      break
    }
    case 'compras':
      add(sacola(M), -0.6, TOPO + 0.45, 0, 0.4, 0.75)
      add(nota(M), 0.8, TOPO + 0.03, 0.3, 0.2, 0.9)
      add(caixa(M, 0.5, 0.4, 0.5), 0.6, chao(0.4), -0.5, 0.3)
      break
    case 'producao': {
      const bancada = new THREE.Group()
      const tampo = malha(rb(2.2, 0.12, 1, 0.04), M.kraft)
      tampo.position.y = 0.5
      bancada.add(tampo)
      for (const x of [-1, 1]) {
        const perna = malha(rb(0.1, 0.5, 0.9, 0.03), M.marca)
        perna.position.set(x, 0.22, 0)
        bancada.add(perna)
      }
      add(bancada, 0, TOPO - 0.03, 0)
      add(panela(M), -0.3, TOPO + 0.56 + 0.45 * 0.45, 0, 0, 0.45)
      add(concha(M), 0.6, TOPO + 0.56 + 0.16, 0.1, 0, 0.6)
      break
    }
    case 'fiscal':
      add(nota(M), -0.7, TOPO + 0.03, 0.1, 0.15)
      add(nota(M), -0.65, TOPO + 0.08, 0.05, -0.1)
      add(nota(M), -0.75, TOPO + 0.13, 0.12, 0.3)
      add(carimbo(M), 0.55, chao(0.14), 0.25, -0.4)
      add(caixa(M, 0.5, 0.35, 0.5, 'marca'), 1.1, chao(0.35), -0.55, 0.3)
      break
    case 'financas':
      add(moedas(M, 6), -0.9, TOPO + 0.04, 0.1)
      add(moedas(M, 4), -0.35, TOPO + 0.04, 0.45)
      add(moedas(M, 9), -0.55, TOPO + 0.04, -0.45)
      add(calculadora(M), 0.75, chao(0.12), 0.1, -0.35)
      break
    case 'administracao':
      add(lojinha(M), -0.35, TOPO, -0.2, 0.1)
      add(engrenagem(M), 1.0, chao(0.14), 0.5, 0.2)
      add(carimbo(M), 0.85, chao(0.14), -0.45, 0.6, 0.8)
      break
    default: {
      // Visão geral: os módulos como ladrilhos, e a bússola (o norte da loja).
      const cores: Cor[] = ['marca', 'ambar', 'papel', 'marca']
      cores.forEach((c, i) => add(malha(rb(0.62, 0.16, 0.62, 0.1), M[c]), -0.4 + (i % 2) * 0.8, chao(0.16), -0.4 + Math.floor(i / 2) * 0.8))
      add(bussola(M), 1.2, TOPO + 0.05, 0.6, 0, 0.6)
    }
  }
}

const facilita = (t: number) => {
  // easeOutBack: passa um pouco do lugar e assenta.
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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
    host.appendChild(renderer.domElement)

    const cena = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const ambiente = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    cena.environment = ambiente

    // Câmera ortográfica de cima, como foto de maquete.
    const camera = new THREE.OrthographicCamera(-2.4, 2.4, 1.2, -1.2, 0.1, 50)
    camera.position.set(4, 3.6, 5)
    camera.lookAt(0, -0.35, 0)

    const sol = new THREE.DirectionalLight(0xffffff, 1.6)
    sol.position.set(-3, 5, 4)
    sol.castShadow = true
    sol.shadow.mapSize.set(1024, 1024)
    sol.shadow.radius = 6
    sol.shadow.bias = -0.0008
    Object.assign(sol.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 })
    cena.add(sol)
    cena.add(new THREE.HemisphereLight(0xffffff, 0x9cc9ce, 0.6))

    const M = Object.fromEntries(
      (Object.keys(CORES) as Cor[]).map((c) => [c, new THREE.MeshStandardMaterial({ color: CORES[c], roughness: 0.92, metalness: 0 })])
    ) as Mats
    const matBase = new THREE.MeshStandardMaterial({ color: BASE, roughness: 0.95, metalness: 0 })

    const grupo = new THREE.Group()
    cena.add(grupo)
    const base = malha(rb(3.4, 0.25, 2.2, 0.12), matBase)
    base.position.y = -0.8
    grupo.add(base)

    const pecas: Peca[] = []
    maquete(modulo, M, (obj, x, y, z, ry = 0, s = 1) => {
      obj.position.set(x, y, z)
      obj.rotation.y = ry
      obj.scale.setScalar(s)
      grupo.add(obj)
      pecas.push({ obj, base: new THREE.Vector3(x, y, z), atraso: 120 + pecas.length * 110 })
    })
    grupo.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    if (!reduzir) for (const p of pecas) p.obj.visible = false

    const tamanho = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h, false)
      const a = w / h
      Object.assign(camera, { left: -1.4 * a, right: 1.4 * a, top: 1.4, bottom: -1.4 })
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
      grupo.rotation.y += (alvo.x * 0.18 - grupo.rotation.y) * 0.06
      grupo.rotation.x += (alvo.y * 0.06 - grupo.rotation.x) * 0.06
      if (!reduzir) {
        // As peças caem no lugar, uma depois da outra.
        for (const p of pecas) {
          const e = Math.min(Math.max((t - p.atraso) / 650, 0), 1)
          p.obj.visible = e > 0
          p.obj.position.y = p.base.y + (1 - facilita(e)) * 0.9
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
      grupo.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose()
      })
      Object.values(M).forEach((m) => m.dispose())
      matBase.dispose()
      ambiente.dispose()
      renderer.dispose()
      renderer.forceContextLoss() // libera o WebGL na hora: cada troca de módulo cria um contexto novo
      renderer.domElement.remove()
    }
  }, [modulo])

  return <div ref={ref} className="size-full" aria-hidden />
}
