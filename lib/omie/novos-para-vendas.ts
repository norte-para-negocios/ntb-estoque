// Produto novo do Omie → cardápio do Norte Vendas (03/11/2026, pedido do Ramon: "cadastrei o Mousse de coco aniversário
// e ele não apareceu no Norte Vendas; produto de frente de loja tem que puxar sozinho"). Puro, sem `@/`.
// Só produto de venda (tipo 00 revenda / 04 produto acabado, mesma regra do catálogo da loja própria), ativo, desbloqueado,
// e só o que foi INCLUÍDO no Omie a partir de INICIO_CRIACAO_AUTOMATICA: o Sertão tem ~700 produtos 00/04 e o cardápio
// ~250; os antigos que não estão lá ficaram de fora de propósito. O Vendas decide categoria e nunca duplica
// (ntb-vendas: lib/produtosNovosOmie.ts). Preço vai como está no Omie (R$ 0,01 = brinde de aniversário, de propósito).

export const INICIO_CRIACAO_AUTOMATICA = '2026-10-29'
const TIPOS_DE_VENDA = new Set(['00', '04'])
const MAX_IRMAOS = 200

export type ProdutoOmieLocal = {
  codigo: string | null
  descricao: string | null
  valor_unitario: number | string | null
  tipo_item: string | null
  codigo_familia: number | string | null
  descricao_familia: string | null
  inativo: boolean | null
  bloqueado: boolean | null
  /** full_object.info.dInc do Omie, "DD/MM/AAAA" */
  dinc: string | null
}

export type NovoParaVendas = { omieCodigo: string; nome: string; preco: number; familia: string; irmaos: string[] }

/** "29/10/2026" → "2026-10-29"; inválido → null */
export function dataInclusaoIso(dinc: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dinc ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function deVenda(p: ProdutoOmieLocal): boolean {
  return !!p.codigo && !!p.descricao?.trim() && TIPOS_DE_VENDA.has(String(p.tipo_item ?? '')) && !p.inativo && !p.bloqueado
}

export function novosParaVendas(produtos: ProdutoOmieLocal[], inicio: string = INICIO_CRIACAO_AUTOMATICA): NovoParaVendas[] {
  const porFamilia = new Map<string, string[]>()
  for (const p of produtos) {
    const fam = String(p.codigo_familia ?? '0')
    if (!deVenda(p) || fam === '0' || fam === '') continue
    const l = porFamilia.get(fam) ?? []
    l.push(p.codigo!)
    porFamilia.set(fam, l)
  }
  const out: NovoParaVendas[] = []
  for (const p of produtos) {
    if (!deVenda(p)) continue
    const inc = dataInclusaoIso(p.dinc)
    if (!inc || inc < inicio) continue
    const fam = String(p.codigo_familia ?? '0')
    const irmaos = fam === '0' || fam === '' ? [] : (porFamilia.get(fam) ?? []).filter((c) => c !== p.codigo).slice(0, MAX_IRMAOS)
    out.push({
      omieCodigo: p.codigo!,
      nome: p.descricao!.trim(),
      preco: Number(p.valor_unitario) || 0,
      familia: (p.descricao_familia ?? '').trim(),
      irmaos,
    })
  }
  return out
}
