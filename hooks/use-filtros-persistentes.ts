'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Params de navegacao/paginacao que nunca sao persistidos.
const PARAMS_IGNORADOS = new Set(['page', 'pagina'])

function chaveStorage(rota: string) {
  return `ntb:filtros:${rota}`
}

function extrairFiltros(sp: URLSearchParams): Record<string, string> {
  const filtros: Record<string, string> = {}
  sp.forEach((value, key) => {
    if (!PARAMS_IGNORADOS.has(key)) {
      filtros[key] = value
    }
  })
  return filtros
}

/**
 * Persiste os filtros ativos (params da URL, exceto pagina) no localStorage,
 * com escopo por rota. Restaura na montagem quando a URL nao tem filtros.
 * Retorna `limpar` para limpar storage + URL de uma vez.
 *
 * @param rota - chave de escopo (ex.: '/produto', '/movimentacoes')
 */
export function useFiltrosPersistentes(rota: string) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // Controla se ja passamos pelo efeito de montagem.
  const montado = useRef(false)
  // Controla se o save effect deve pular a primeira execucao.
  const primeiroSave = useRef(true)
  // Indica se o hook esta ativo (rota nao-vazia).
  const ativo = rota.length > 0

  // Efeito de montagem: restaura filtros salvos se a URL nao tiver filtros.
  useEffect(() => {
    if (!ativo) return
    if (montado.current) return
    montado.current = true

    const temFiltrosNaURL = Array.from(searchParams.keys()).some(
      (k) => !PARAMS_IGNORADOS.has(k),
    )

    if (temFiltrosNaURL) {
      // URL ja tem filtros -- salva e sai (prioridade da URL sobre storage).
      const filtros = extrairFiltros(new URLSearchParams(searchParams.toString()))
      try {
        localStorage.setItem(chaveStorage(rota), JSON.stringify(filtros))
      } catch { /* storage bloqueado, ignora */ }
      return
    }

    // Sem filtros na URL: tenta restaurar do storage.
    try {
      const raw = localStorage.getItem(chaveStorage(rota))
      if (!raw) return

      const filtros = JSON.parse(raw) as Record<string, string>
      if (!filtros || typeof filtros !== 'object' || Object.keys(filtros).length === 0) return

      const params = new URLSearchParams(searchParams.toString())
      Object.entries(filtros).forEach(([k, v]) => {
        if (v) params.set(k, v)
      })

      router.replace(`${pathname}?${params.toString()}`)
    } catch { /* parse error ou storage bloqueado, ignora */ }
  // Intencional: roda so na montagem.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Efeito de save: persiste filtros sempre que searchParams muda, exceto na primeira execucao.
  useEffect(() => {
    if (!ativo) return
    if (primeiroSave.current) {
      primeiroSave.current = false
      return
    }

    const filtros = extrairFiltros(new URLSearchParams(searchParams.toString()))
    try {
      if (Object.keys(filtros).length > 0) {
        localStorage.setItem(chaveStorage(rota), JSON.stringify(filtros))
      } else {
        localStorage.removeItem(chaveStorage(rota))
      }
    } catch { /* ignora */ }
  }, [ativo, searchParams, rota])

  // Limpa storage e URL (mantendo apenas params de paginacao), para uso no botao Limpar.
  const limpar = useCallback(() => {
    if (ativo) {
      try {
        localStorage.removeItem(chaveStorage(rota))
      } catch { /* ignora */ }
    }

    const params = new URLSearchParams()
    // Preserva params de navegacao (ex.: page) se presentes.
    searchParams.forEach((value, key) => {
      if (PARAMS_IGNORADOS.has(key)) params.set(key, value)
    })

    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }, [ativo, rota, searchParams, pathname, router])

  return { limpar }
}
