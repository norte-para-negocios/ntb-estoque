// lib/nf-impostos-item.ts
// Extrai os impostos com VALOR real (>0) do full_object de um item de NF
// (itensRecebimento da Omie). A maioria dos campos fiscais vem zerada ou
// vazia na pratica (achado real 2026-08-01, amostrado em produção com lojas
// no Simples Nacional e no regime normal) -- só vale mostrar o que
// efetivamente tem valor, senão a tela vira ruído de código tributário sem
// utilidade pra quem opera a loja.
type FullObjectItem = {
  itensIPI?: { nValIPI?: number }
  itensIBS?: { nValIbs?: number }
  itensCBS?: { nValCbs?: number }
  itensAjustes?: {
    itensSitTribEnt?: {
      nValPISE?: number
      nValCOFINSE?: number
      itensSitTribICMSSTEnt?: { nValorST?: number; nValorFCPE?: number }
    }
  }
} | null

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export type ImpostoItem = { label: string; valor: number }

export function impostosItem(fullObject: unknown): ImpostoItem[] {
  const fo = (fullObject ?? {}) as FullObjectItem
  const entrada = fo?.itensAjustes?.itensSitTribEnt
  const st = entrada?.itensSitTribICMSSTEnt

  const candidatos: ImpostoItem[] = [
    { label: 'IPI', valor: num(fo?.itensIPI?.nValIPI) },
    { label: 'ICMS-ST', valor: num(st?.nValorST) },
    { label: 'FCP', valor: num(st?.nValorFCPE) },
    { label: 'PIS', valor: num(entrada?.nValPISE) },
    { label: 'COFINS', valor: num(entrada?.nValCOFINSE) },
    { label: 'IBS', valor: num(fo?.itensIBS?.nValIbs) },
    { label: 'CBS', valor: num(fo?.itensCBS?.nValCbs) },
  ]

  return candidatos.filter((c) => c.valor > 0)
}
