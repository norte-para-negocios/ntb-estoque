import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  avisoAoDesfazer, categoriaDaNota, competenciaDaNota, dataDaDuplicata, origemDoTitulo, planoParcelasDaNota, resumoTitulosDaNota,
  rotuloCategoria, selecaoParaGerar, type TituloDaNota,
} from './titulos-da-nota-puro.ts'
import { lerNfe } from '../estoque/nfe-xml.ts'
import { cabecalhoDaNota } from '../estoque/nf-sefaz-mapa.ts'

// Conta a pagar gerada pela nota de entrada (Fase 4, passo 1). Espelha fin_parcelas_da_nota (migration 340).

const fo = (lista: unknown[]) => ({ parcelas: { parcelasLista: lista } })

test('dataDaDuplicata: dd/mm/aaaa (formato gravado) e aaaa-mm-dd; data inválida vira null', () => {
  assert.equal(dataDaDuplicata('19/11/2026'), '2026-11-19')
  assert.equal(dataDaDuplicata('2026-11-19'), '2026-11-19')
  assert.equal(dataDaDuplicata('2026-11-19T00:00:00-03:00'), '2026-11-19')
  assert.equal(dataDaDuplicata('31/02/2026'), null)
  assert.equal(dataDaDuplicata(''), null)
  assert.equal(dataDaDuplicata(null), null)
  assert.equal(dataDaDuplicata('amanhã'), null)
})

test('nota com 3 duplicatas: uma parcela por duplicata, na ordem do XML, com vencimento e valor de cada uma', () => {
  const p = planoParcelasDaNota(fo([
    { nSequencia: 1, dVencimento: '07/11/2026', vParcela: 1083.15 },
    { nSequencia: 2, dVencimento: '07/12/2026', vParcela: 1083.15 },
    { nSequencia: 3, dVencimento: '06/01/2027', vParcela: 1083.16 },
  ]), 3249.46, '2026-10-08', '2026-11-05')
  assert.equal(p.regra, 'duplicatas')
  assert.deepEqual(p.parcelas, [
    { parcela: 1, totalParcelas: 3, vencimento: '2026-11-07', valorCent: 108315 },
    { parcela: 2, totalParcelas: 3, vencimento: '2026-12-07', valorCent: 108315 },
    { parcela: 3, totalParcelas: 3, vencimento: '2027-01-06', valorCent: 108316 },
  ])
  assert.equal(p.diferencaCent, 0)
})

test('nota sem duplicatas: à vista, uma conta só no total da nota vencendo na emissão (decidido pelo dono em 05/11)', () => {
  const p = planoParcelasDaNota({}, 512.4, '2026-11-03', '2026-11-05')
  assert.equal(p.regra, 'sem_duplicata')
  assert.deepEqual(p.parcelas, [{ parcela: 1, totalParcelas: 1, vencimento: '2026-11-03', valorCent: 51240 }])
  // sem emissão: vence hoje
  assert.equal(planoParcelasDaNota(fo([]), 10, null, '2026-11-05').parcelas[0].vencimento, '2026-11-05')
})

test('duplicata sem valor é ignorada; duplicata sem vencimento vence na emissão; numeração só das válidas', () => {
  const p = planoParcelasDaNota(fo([
    { nSequencia: 1, dVencimento: '10/11/2026', vParcela: 0 },
    { nSequencia: 2, dVencimento: '', vParcela: '200.50' },
    { nSequencia: 3, dVencimento: '10/12/2026', vParcela: 100 },
  ]), 300.5, '2026-11-01', '2026-11-05')
  assert.equal(p.regra, 'duplicatas')
  assert.deepEqual(p.parcelas.map((x) => [x.parcela, x.totalParcelas, x.vencimento, x.valorCent]), [[1, 2, '2026-11-01', 20050], [2, 2, '2026-12-10', 10000]])
})

test('soma das duplicatas diferente do total da nota: vale a duplicata, a diferença fica registrada', () => {
  const p = planoParcelasDaNota(fo([{ dVencimento: '10/11/2026', vParcela: 90 }]), 100, '2026-11-01', '2026-11-05')
  assert.equal(p.diferencaCent, -1000)
  assert.equal(p.parcelas[0].valorCent, 9000)
})

test('nota sem valor e sem duplicata não gera conta', () => {
  const p = planoParcelasDaNota(null, 0, '2026-11-01', '2026-11-05')
  assert.equal(p.regra, 'sem_valor')
  assert.deepEqual(p.parcelas, [])
})

test('do XML real ao plano: cobr/dup (nDup, dVenc, vDup) passa por lerNfe e cabecalhoDaNota sem perder nada', () => {
  const xml = `<nfeProc><NFe><infNFe Id="NFe29261100000000000191550010000012341000012345"><ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>00000000000191</CNPJ><xNome>ATACADO TESTE LTDA</xNome></emit><dest><CNPJ>11222333000181</CNPJ></dest>
    <det nItem="1"><prod><cProd>A1</cProd><xProd>ARROZ</xProd><uCom>KG</uCom><qCom>10</qCom><vUnCom>30</vUnCom><vProd>300.00</vProd></prod></det>
    <total><ICMSTot><vProd>300.00</vProd><vNF>300.00</vNF></ICMSTot></total>
    <cobr><fat><nFat>1234</nFat><vOrig>300.00</vOrig><vLiq>300.00</vLiq></fat>
      <dup><nDup>001</nDup><dVenc>2026-11-10</dVenc><vDup>100.00</vDup></dup>
      <dup><nDup>002</nDup><dVenc>2026-11-17</dVenc><vDup>100.00</vDup></dup>
      <dup><nDup>003</nDup><dVenc>2026-11-24</dVenc><vDup>100.00</vDup></dup></cobr>
  </infNFe></NFe></nfeProc>`
  const nfe = lerNfe(xml)
  const cab = cabecalhoDaNota(nfe, { ambiente: '1', origem: 'sefaz', alertas: [] })
  const p = planoParcelasDaNota(cab.full_object, cab.valor, nfe.emissao, '2026-11-05')
  assert.equal(p.regra, 'duplicatas')
  assert.deepEqual(p.parcelas.map((x) => [x.parcela, x.totalParcelas, x.vencimento, x.valorCent]),
    [[1, 3, '2026-11-10', 10000], [2, 3, '2026-11-17', 10000], [3, 3, '2026-11-24', 10000]])
})

const t = (x: Partial<TituloDaNota>): TituloDaNota => ({
  id: 1, numero: 1, parcela: 1, total_parcelas: 1, valor: 100, valor_quitado: 0, data_vencimento: '2026-11-10', status: 'aberto', ...x,
})

test('resumo: nota lançada com as parcelas ativas não tem aviso', () => {
  const r = resumoTitulosDaNota([t({ id: 1 }), t({ id: 2, parcela: 2 })], 'lancada', null)
  assert.equal(r.ativos.length, 2)
  assert.equal(r.totalAtivoCent, 20000)
  assert.equal(r.aviso, null)
})

test('resumo: nota desfeita com parcela paga avisa e pede decisão humana (nada é apagado)', () => {
  const r = resumoTitulosDaNota([t({ id: 1, status: 'pago', valor_quitado: 100 }), t({ id: 2, parcela: 2, status: 'cancelado' })], 'pendente', null)
  assert.equal(r.ativos.length, 1)
  assert.equal(r.cancelados.length, 1)
  assert.match(r.aviso ?? '', /desfeita/)
  assert.match(r.aviso ?? '', /1 parcela já paga/)
})

test('resumo: nota lançada sem conta a pagar mostra o motivo da falha', () => {
  const r = resumoTitulosDaNota([], 'lancada', 'Nota sem CNPJ do fornecedor')
  assert.match(r.aviso ?? '', /não tem conta a pagar/)
  assert.match(r.aviso ?? '', /Nota sem CNPJ do fornecedor/)
  // nota ainda pendente: sem conta é o normal
  assert.equal(resumoTitulosDaNota([], 'pendente', null).aviso, null)
})

test('avisoAoDesfazer: só fala quando sobrou parcela paga', () => {
  assert.equal(avisoAoDesfazer({ cancelados: 3, com_pagamento: 0 }), null)
  assert.match(avisoAoDesfazer({ cancelados: 1, com_pagamento: 2 }) ?? '', /2 parcelas já pagas continuam/)
  assert.equal(avisoAoDesfazer(null), null)
})

test('origemDoTitulo: título da nota liga à nota; manual não tem link', () => {
  assert.deepEqual(origemDoTitulo('nota_entrada', 42, 'NF 340'), { rotulo: 'Nota de entrada NF 340', href: '/nota-fiscal/42' })
  assert.deepEqual(origemDoTitulo('manual', null), { rotulo: 'Lançado à mão', href: null })
  assert.deepEqual(origemDoTitulo('nota_entrada', null), { rotulo: 'nota_entrada', href: null })
})

// ---------------------------------------------------------------------- decisões do dono de 05/11 (migration 360)

test('categoriaDaNota: categoria da família de MAIOR VALOR dos itens (mapa família → categoria da loja)', () => {
  const mapa = new Map([[10, 501], [20, 502]])
  const r = categoriaDaNota([
    { codigoFamilia: 10, valor: 100 }, { codigoFamilia: 20, valor: 80 }, { codigoFamilia: 20, valor: 30 },
  ], mapa)
  assert.deepEqual(r, { categoriaId: 502, codigoFamilia: 20, motivo: 'mapeada' }) // família 20 soma 110 > 100
})

test('categoriaDaNota: família predominante SEM categoria = sem categoria (não usa a 2ª família nem inventa padrão)', () => {
  const mapa = new Map([[10, 501]])
  assert.deepEqual(categoriaDaNota([{ codigoFamilia: 10, valor: 10 }, { codigoFamilia: 30, valor: 90 }], mapa),
    { categoriaId: null, codigoFamilia: 30, motivo: 'familia_sem_categoria' })
  // nenhuma família mapeada
  assert.equal(categoriaDaNota([{ codigoFamilia: 10, valor: 10 }], new Map()).categoriaId, null)
})

test('categoriaDaNota: produto sem família conta como grupo próprio; se for o maior, fica sem categoria', () => {
  const mapa = new Map([[10, 501]])
  assert.deepEqual(categoriaDaNota([{ codigoFamilia: null, valor: 60 }, { codigoFamilia: 10, valor: 40 }], mapa),
    { categoriaId: null, codigoFamilia: null, motivo: 'sem_familia' })
})

test('categoriaDaNota: item que não gera conta a pagar fica fora; sem itens = sem categoria', () => {
  const mapa = new Map([[10, 501], [20, 502]])
  assert.equal(categoriaDaNota([{ codigoFamilia: 20, valor: 999, geraContaPagar: false }, { codigoFamilia: 10, valor: 1 }], mapa).categoriaId, 501)
  assert.deepEqual(categoriaDaNota([], mapa), { categoriaId: null, codigoFamilia: null, motivo: 'sem_itens' })
})

test('categoriaDaNota: empate em valor = família de menor código (o banco usa a mesma ordem); centavos sem erro de ponto flutuante', () => {
  const mapa = new Map([[10, 501], [20, 502]])
  assert.equal(categoriaDaNota([{ codigoFamilia: 20, valor: 0.1 + 0.2 }, { codigoFamilia: 10, valor: 0.3 }], mapa).categoriaId, 501)
  // empate entre família e "sem família": a família ganha
  assert.equal(categoriaDaNota([{ codigoFamilia: null, valor: 50 }, { codigoFamilia: 20, valor: 50 }], mapa).categoriaId, 502)
})

test('competenciaDaNota: mês da ENTRADA da nota (não da emissão); sem entrada, emissão; sem nada, vencimento', () => {
  assert.equal(competenciaDaNota('2026-11-02', '2026-10-30', '2026-11-20'), '2026-11-01')
  assert.equal(competenciaDaNota(null, '2026-10-30', '2026-11-20'), '2026-10-01')
  assert.equal(competenciaDaNota(null, null, '2026-12-05'), '2026-12-01')
  assert.equal(competenciaDaNota('lixo', '2026-10-30', '2026-11-20'), '2026-10-01')
})

test('rotuloCategoria: conta sem categoria aparece como "A definir"', () => {
  assert.equal(rotuloCategoria(null), 'A definir')
  assert.equal(rotuloCategoria('  '), 'A definir')
  assert.equal(rotuloCategoria('Bebidas'), 'Bebidas')
})

test('selecaoParaGerar: só ids válidos, sem repetir, com teto; acima do teto avisa', () => {
  assert.deepEqual(selecaoParaGerar([3, 3, '4', 0, -1, 'x', 5.5], 50), { ids: [3, 4], erro: null })
  assert.deepEqual(selecaoParaGerar([], 50), { ids: [], erro: 'Selecione pelo menos uma nota.' })
  const r = selecaoParaGerar([1, 2, 3], 2)
  assert.deepEqual(r.ids, [])
  assert.match(r.erro ?? '', /no máximo 2/)
})

test('avisos de parcela paga em nota desfeita apontam para a decisão do gerente', () => {
  const pago: TituloDaNota = { id: 1, numero: 7, parcela: 1, total_parcelas: 1, valor: 50, valor_quitado: 50, data_vencimento: '2026-11-10', status: 'pago' }
  assert.match(resumoTitulosDaNota([pago], 'pendente', null).aviso ?? '', /gerente/)
  assert.match(avisoAoDesfazer({ com_pagamento: 1 }) ?? '', /gerente/)
})
