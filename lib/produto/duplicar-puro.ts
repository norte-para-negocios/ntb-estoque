// Duplicar produto / OP (Fase G [K9/M6], só estoque próprio). Puro (sem @/): node --test lib/produto/duplicar-puro.test.ts
// Duplicar não grava nada: abre o formulário de "novo" já preenchido, e a pessoa confere e salva (código novo automático).

type Dup = {
  id: number; codigo: string; codigoProduto: number; descricao: string; ean: string | null; vinculado: boolean; inativo: boolean
  variacoes: { id: number; codigo: string; codigoProduto: number; inativo: boolean }[]
}

/** Cópia para o formulário de produto novo: sem código, sem EAN (é único por produto), ativo e sem vínculo com o Vendas. */
export function duplicarProduto<T extends Dup>(p: T): T {
  const sufixo = ' (cópia)'
  const descricao = p.descricao.length + sufixo.length > 120 ? `${p.descricao.slice(0, 120 - sufixo.length)}${sufixo}` : `${p.descricao}${sufixo}`
  return {
    ...p, id: 0, codigo: '', codigoProduto: 0, descricao, ean: null, vinculado: false, inativo: false,
    variacoes: p.variacoes.map((v) => ({ ...v, id: 0, codigo: '', codigoProduto: 0, inativo: false })),
  }
}

/** Quantidade da OP original no formato do campo (vírgula decimal); sem quantidade válida, 1. */
export function quantidadeParaDuplicar(q: number | null | undefined): string {
  return q != null && Number.isFinite(q) && q > 0 ? String(q).replace('.', ',') : '1'
}
