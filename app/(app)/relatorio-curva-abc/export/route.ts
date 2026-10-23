import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'
import { carregarBaseAbc } from '@/lib/relatorios/curva-abc-loader'
import { curvaAbc, separarTaxas, ROTULO_CLASSE } from '@/lib/relatorios/curva-abc-puro'
import { lerParamsAbc } from '@/lib/relatorios/curva-abc-params'

export const dynamic = 'force-dynamic'

// Mesmas colunas da Curva ABC do Omie (COM_PRD_ABC_VALOR/QUANTIDADE), todas as linhas.
export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const p = lerParamsAbc(sp, hojeBahiaISO())
  const { itens, aviso } = await carregarBaseAbc(lojaId, p.ini, p.fim, p.base, { tipos: p.tipos, familias: p.familias })
  const { curva: produtos, fora } = separarTaxas(itens, p.base !== 'vendas' || p.taxas)
  const curva = curvaAbc(produtos, p.medida).filter((l) => !p.classe || l.classe === p.classe)
  if (!curva.length) return new Response('Sem dados no período/filtro selecionado', { status: 404 })
  const rows = curva.map((l) => ({
    classe: ROTULO_CLASSE[l.classe], ordem: l.ordem, codigo: l.codigo, produto: l.rotulo, familia: l.familia, tipo: l.tipo,
    medida: l[p.medida], pct: l.pct, pctAcum: l.pctAcumulado, outra: p.medida === 'valor' ? l.quant : l.valor,
  }))
  const porValor = p.medida === 'valor'
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'classe', label: 'ABC', tipo: 'texto', largura: 20 },
      { key: 'ordem', label: 'Ordem', tipo: 'numero', largura: 8 },
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 12 },
      { key: 'produto', label: 'Produto', tipo: 'texto', largura: 44 },
      { key: 'familia', label: 'Família', tipo: 'texto', largura: 24 },
      { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
      { key: 'medida', label: porValor ? 'Valor' : 'Quantidade', tipo: porValor ? 'moeda' : 'numero', largura: 16, somar: true },
      { key: 'pct', label: '% participação', tipo: 'numero', largura: 14 },
      { key: 'pctAcum', label: '% acumulado', tipo: 'numero', largura: 14 },
      { key: 'outra', label: porValor ? 'Quantidade' : 'Valor', tipo: porValor ? 'numero' : 'moeda', largura: 16, somar: true },
    ],
    opts: {
      titulo: `Curva ABC de ${p.base === 'vendas' ? 'vendas' : 'compras'} por ${porValor ? 'valor' : 'quantidade'}`,
      subtitulo: `${p.ini} a ${p.fim} · A = até 20% acumulado, B = até 80%, C = resto${fora.length ? ` · fora da curva (não são produtos): ${fora.map((f) => `${f.rotulo} ${porValor ? f.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : f.quant}`).join(', ')}` : ''}${p.base === 'vendas' && p.taxas ? ' · taxas incluídas na curva, como no Omie' : ''}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}`,
      autoFiltro: true,
    },
    nome: 'Curva ABC',
  }])
  return planilhaResponse('curva-abc', buffer)
}
