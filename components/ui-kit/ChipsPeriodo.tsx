'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { ChipPeriodoOpcao } from '@/lib/periodo-rapido'

/**
 * Chips de atalho de período ACIMA da tabela: 1 clique escreve os MESMOS 2
 * searchParams (data_inicio/data_final) que a gaveta de filtro livre já usa
 * nesta tela, preservando os demais params. Mesmo molde de ChipsStatus.tsx,
 * mas escreve 2 params de uma vez em vez de 1.
 * `opcoes[0]` deve ser o default da própria tela (value='' -- ex.: "Ano
 * corrente" ou "Tudo"), pra sempre existir uma opção que limpa/reseta.
 */
export function ChipsPeriodo({
  basePath,
  opcoes,
}: {
  basePath: string
  opcoes: ChipPeriodoOpcao[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const iniAtual = sp.get('data_inicio') ?? ''
  const fimAtual = sp.get('data_final') ?? ''

  function selecionar(o: ChipPeriodoOpcao) {
    const params = new URLSearchParams(sp.toString())
    params.delete('page')
    if (o.value === '' && !o.dataIni && !o.dataFim) {
      params.delete('data_inicio')
      params.delete('data_final')
    } else {
      params.set('data_inicio', o.dataIni)
      params.set('data_final', o.dataFim)
    }
    const qs = params.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
      {opcoes.map((o) => {
        // Ativo = os 2 params atuais batem com este chip (ou, pro chip default
        // -- value === '', mesmo quando ele carrega datas concretas -- nenhum
        // dos dois está setado na URL, já que ausência de params sempre
        // significa "mostrando o default da página"). Período customizado da
        // gaveta sempre desativa todos os chips, igual ao comportamento já
        // existente em Faturamento.
        const ativo = o.value === '' ? !iniAtual && !fimAtual : iniAtual === o.dataIni && fimAtual === o.dataFim
        return (
          <button
            key={o.value || '_default'}
            type="button"
            aria-pressed={ativo}
            onClick={() => selecionar(o)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium u-motion u-press-sm ${
              ativo
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-muted hover:border-brand/50 hover:bg-surface-2 hover:text-text'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
