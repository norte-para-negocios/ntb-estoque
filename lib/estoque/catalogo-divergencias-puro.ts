// Fase 6 lote 2: compara o catálogo do Estoque com o do Vendas DEPOIS da reconciliação e lista o que ela não
// conseguiu igualar. Nada é corrigido aqui: só vira linha em sync_divergencias para alguém olhar.

export type ProdutoEstoque = {
  codigo: string | null; vendas_ref: string | null; descricao: string | null; valor_unitario: number | null
  inativo: boolean | null; pdv: boolean | null; ncm: string | null; tipo_item: string | null
}
export type ProdutoVendas = { vendas_ref: string; codigo: string | null; nome: string | null; preco: number | null; ativo: boolean | null; ncm: string | null }
export type Divergencia = { entidade: 'produto'; ref: string; tipo: 'so_estoque' | 'so_vendas' | 'conflito'; detalhe: string }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const txt = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')
const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function compararCatalogo(estoque: ProdutoEstoque[], vendas: ProdutoVendas[]): Divergencia[] {
  const out: Divergencia[] = []
  const porCodigo = new Map(estoque.filter((p) => txt(p.codigo)).map((p) => [txt(p.codigo), p]))
  const refsVendas = new Set(vendas.map((v) => v.vendas_ref))
  const codigosVendas = new Set(vendas.map((v) => txt(v.codigo)).filter(Boolean))

  for (const v of vendas) {
    const cod = txt(v.codigo)
    const e = cod ? porCodigo.get(cod) : undefined
    if (!e) {
      out.push({ entidade: 'produto', ref: cod || `vendas:${v.vendas_ref}`, tipo: 'so_vendas', detalhe: `"${txt(v.nome)}" existe no Vendas e não no Estoque${cod ? '' : ' (sem código)'}.` })
      continue
    }
    const dif: string[] = []
    if (txt(v.nome).toLowerCase() !== txt(e.descricao).toLowerCase()) dif.push(`nome: Estoque "${txt(e.descricao)}" × Vendas "${txt(v.nome)}"`)
    if (v.preco != null && e.valor_unitario != null && Math.abs(Number(v.preco) - Number(e.valor_unitario)) > 0.005)
      dif.push(`preço: Estoque ${brl(Number(e.valor_unitario))} × Vendas ${brl(Number(v.preco))}`)
    if (v.ativo != null && e.inativo != null && v.ativo === e.inativo) dif.push(`situação: Estoque ${e.inativo ? 'inativo' : 'ativo'} × Vendas ${v.ativo ? 'ativo' : 'inativo'}`)
    if (soDigitos(v.ncm) && soDigitos(e.ncm) && soDigitos(v.ncm) !== soDigitos(e.ncm)) dif.push(`NCM: Estoque ${soDigitos(e.ncm)} × Vendas ${soDigitos(v.ncm)}`)
    if (dif.length) out.push({ entidade: 'produto', ref: cod, tipo: 'conflito', detalhe: `"${txt(e.descricao)}": ${dif.join('; ')}.` })
  }

  for (const e of estoque) {
    const cod = txt(e.codigo)
    if (!cod || !e.pdv || e.inativo || (e.tipo_item !== '00' && e.tipo_item !== '04')) continue
    if (codigosVendas.has(cod)) continue
    if (e.vendas_ref && refsVendas.has(e.vendas_ref)) continue
    out.push({ entidade: 'produto', ref: cod, tipo: 'so_estoque', detalhe: `"${txt(e.descricao)}" está à venda no Estoque e não existe no Vendas.` })
  }
  return out
}

/** O que gravar: novas, atualizar o texto das que continuam e resolver as que sumiram (só desses 3 tipos). */
export function planoDivergencias(abertas: { id: number; ref: string; tipo: string; detalhe: string | null }[], atuais: Divergencia[]) {
  const chave = (ref: string, tipo: string) => `${tipo}|${ref}`
  const abertasPorChave = new Map(abertas.map((a) => [chave(a.ref, a.tipo), a]))
  const atuaisPorChave = new Map(atuais.map((d) => [chave(d.ref, d.tipo), d]))
  return {
    inserir: atuais.filter((d) => !abertasPorChave.has(chave(d.ref, d.tipo))),
    atualizar: atuais.flatMap((d) => { const a = abertasPorChave.get(chave(d.ref, d.tipo)); return a && a.detalhe !== d.detalhe ? [{ id: a.id, detalhe: d.detalhe }] : [] }),
    resolver: abertas.filter((a) => !atuaisPorChave.has(chave(a.ref, a.tipo))).map((a) => a.id),
  }
}
