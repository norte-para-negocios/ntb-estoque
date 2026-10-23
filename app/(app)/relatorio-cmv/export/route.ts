import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'
import { carregarCmv } from '@/lib/relatorios/cmv-loader'
import { agruparCmv, cmvFormulaOmie, custoForaDoNormal, textoCustoForaDoNormal } from '@/lib/relatorios/cmv-puro'
import { DIM_DA_ABA, lerParamsCmv, textoFonte } from '@/lib/relatorios/cmv-params'
import { exigirDev } from '@/lib/recursos-dev'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const p = lerParamsCmv(Object.fromEntries(new URL(request.url).searchParams.entries()), hojeBahiaISO())
  const aba = p.aba === 'estoque' ? 'produtos' : p.aba
  const d = await carregarCmv(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias }, DIM_DA_ABA[aba])
  if (!d.linhas.length) return new Response('Sem vendas no período/filtro selecionado', { status: 404 })
  const linhas = d.fonte === 'proprio' ? d.linhas : agruparCmv(d.linhas, DIM_DA_ABA[aba])
  const nome = aba === 'familias' ? 'Família' : aba === 'tipos' ? 'Tipo' : 'Produto'
  const fora = d.fonte === 'kardex' && d.custoTrocado ? custoForaDoNormal(d.linhas) : null
  const txtFora = fora ? textoCustoForaDoNormal(fora, (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : ''
  const sub = `${p.ini} a ${p.fim} · ${textoFonte(d.fonte, d.cobertura, d.dataFoto, d.custoTrocado)}${d.avisos.length ? ` · ATENÇÃO: ${d.avisos.join(' ')}` : ''}${txtFora ? ` · ${txtFora} Lista na aba "Custo fora do normal".` : ''}`
  const abas: AbaPlanilha[] = [{
    rows: linhas.filter((l) => l.faturamento !== 0 || l.cmv !== 0).map((l) => ({
      rotulo: l.rotulo, familia: l.familia, tipo: l.tipo, quant: l.quant, faturamento: l.faturamento, cmv: l.cmv,
      margem: Math.round((l.faturamento - l.cmv) * 100) / 100, cmvOmie: l.cmvOmie, obs: l.custoSuspeito ? 'Custo de hoje acima do preço de venda: ficou zero' : Math.abs(l.cmvOmie - l.cmv) > 0.005 ? 'Custo do Omie fora do normal: trocado pelo custo normal do produto' : l.semCusto ? 'Sem custo' : '', pct: l.faturamento > 0 ? Math.round(((l.faturamento - l.cmv) / l.faturamento) * 1000) / 10 : null, consumo: l.consumo,
    })),
    colunas: [
      { key: 'rotulo', label: nome, tipo: 'texto', largura: 44 },
      ...(aba === 'produtos' && d.fonte !== 'proprio' ? [{ key: 'familia', label: 'Família', tipo: 'texto' as const, largura: 24 }, { key: 'tipo', label: 'Tipo', tipo: 'texto' as const, largura: 22 }] : []),
      { key: 'quant', label: 'Quantidade vendida', tipo: 'numero', largura: 14, somar: true },
      { key: 'faturamento', label: 'Faturamento', tipo: 'moeda', largura: 16, somar: true },
      { key: 'cmv', label: 'CMV', tipo: 'moeda', largura: 16, somar: true },
      ...(d.fonte === 'kardex' ? [{ key: 'cmvOmie', label: 'CMV pelo custo do Omie', tipo: 'moeda' as const, largura: 18, somar: true }] : []),
      { key: 'margem', label: 'Margem bruta', tipo: 'moeda', largura: 16, somar: true },
      { key: 'pct', label: 'Margem %', tipo: 'numero', largura: 10 },
      ...(d.fonte === 'kardex' ? [{ key: 'consumo', label: 'Consumo OP (CPV)', tipo: 'moeda' as const, largura: 16, somar: true }] : []),
      ...(aba === 'produtos' ? [{ key: 'obs', label: 'Observação', tipo: 'texto' as const, largura: 34 }] : []),
    ],
    opts: { titulo: `CMV por ${nome.toLowerCase()}`, subtitulo: sub, autoFiltro: true },
    nome: 'CMV',
  }]
  if (d.fonte === 'kardex') {
    abas.push({
      rows: agruparCmv(d.linhas, 'produto').map((l) => ({
        rotulo: l.rotulo, tipo: l.tipo, ei: l.ei, compras: l.compras, producao: l.producao, ef: l.ef, formula: cmvFormulaOmie(l),
        custo: Math.abs(l.eiOmie - l.ei) > 0.005 || Math.abs(l.efOmie - l.ef) > 0.005 ? `Custo do Omie fora do normal no estoque: inicial ${l.eiOmie.toLocaleString('pt-BR')} / final ${l.efOmie.toLocaleString('pt-BR')} pelo Omie` : '',
        vendas: l.cmv, consumo: l.consumo, outras: Math.round((l.outrasSaidas - l.outrasEntradas) * 100) / 100,
        quebra: l.quebra > 0.01 ? `Saldo pulou ${l.quebra.toLocaleString('pt-BR')} sem movimento no espelho: fora do total da fórmula` : '',
      })),
      colunas: [
        { key: 'rotulo', label: 'Produto', tipo: 'texto', largura: 44 },
        { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
        { key: 'ei', label: 'Estoque inicial (EI)', tipo: 'moeda', largura: 16, somar: true },
        { key: 'compras', label: 'Compras (C)', tipo: 'moeda', largura: 16, somar: true },
        { key: 'producao', label: 'Produção (P)', tipo: 'moeda', largura: 16, somar: true },
        { key: 'ef', label: 'Estoque final (EF)', tipo: 'moeda', largura: 16, somar: true },
        { key: 'formula', label: 'CMV/CPV (EI + C + P − EF)', tipo: 'moeda', largura: 18, somar: true },
        { key: 'vendas', label: 'Saídas de venda', tipo: 'moeda', largura: 16, somar: true },
        { key: 'consumo', label: 'Consumo OP', tipo: 'moeda', largura: 16, somar: true },
        { key: 'outras', label: 'Outras saídas − entradas', tipo: 'moeda', largura: 18, somar: true },
        { key: 'quebra', label: 'Quebra no kardex', tipo: 'texto', largura: 40 },
        { key: 'custo', label: 'Custo trocado', tipo: 'texto', largura: 44 },
      ],
      opts: { titulo: 'CMV/CPV pelo estoque (fórmula do Omie)', subtitulo: sub, autoFiltro: true },
      nome: 'Pelo estoque',
    })
  }
  if (fora?.produtos.length) {
    abas.push({
      rows: fora.produtos.map((x) => ({ ...x, referencia: x.semReferencia ? 'sem custo confiável' : x.referencia == null ? '' : `R$ ${x.referencia.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}` })),
      colunas: [
        { key: 'rotulo', label: 'Produto', tipo: 'texto', largura: 44 },
        { key: 'quant', label: 'Quantidade vendida', tipo: 'numero', largura: 14 },
        { key: 'faturamento', label: 'Faturamento', tipo: 'moeda', largura: 16, somar: true },
        { key: 'cmvOmie', label: 'CMV pelo Omie', tipo: 'moeda', largura: 18, somar: true },
        { key: 'cmv', label: 'CMV usado', tipo: 'moeda', largura: 16, somar: true },
        { key: 'consumoOmie', label: 'Consumo OP pelo Omie', tipo: 'moeda', largura: 18, somar: true },
        { key: 'consumo', label: 'Consumo OP usado', tipo: 'moeda', largura: 16, somar: true },
        { key: 'eiOmie', label: 'Estoque inicial pelo Omie', tipo: 'moeda', largura: 18, somar: true },
        { key: 'ei', label: 'Estoque inicial usado', tipo: 'moeda', largura: 16, somar: true },
        { key: 'efOmie', label: 'Estoque final pelo Omie', tipo: 'moeda', largura: 18, somar: true },
        { key: 'ef', label: 'Estoque final usado', tipo: 'moeda', largura: 16, somar: true },
        { key: 'movimentos', label: 'Movimentos trocados', tipo: 'numero', largura: 12, somar: true },
        { key: 'saldosEstoque', label: 'Saldos de estoque trocados', tipo: 'numero', largura: 12, somar: true },
        { key: 'referencia', label: 'Custo normal (unidade)', tipo: 'texto', largura: 20 },
      ],
      opts: { titulo: 'Custo fora do normal no Omie (corrigir custo ou unidade no Omie)', subtitulo: txtFora, autoFiltro: true },
      nome: 'Custo fora do normal',
    })
  }
  return planilhaResponse('cmv', await gerarPlanilhaMulti(abas))
}
