import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: import com .ts exigido pelo node --test
import { acoesNfe, cfopDevolucaoBase, DEVOLUCAO_DA_ENTRADA, cfopEntreLojas, cfopPorUf, dentroDoPrazoCancelamento, icmsEntreLojas, itemDevolucao, naturezaEntreLojas, proporcaoDevolvida, rotuloStatusNfe, textoDevolucao } from './regras-puro.ts'
// @ts-expect-error: idem
import { CONFIG_SIMPLES, ORIGEM_AZEITE, ORIGEM_TOMATE } from './exemplos.ts'
// @ts-expect-error: idem
import { CFOP_DEVOLUCAO_SAIDA } from './nfe-puro.ts'

test('CFOP: o 1º dígito segue a UF (5 dentro, 6 fora); devolução pelo CFOP de entrada', () => {
  assert.equal(cfopPorUf('5.202', 'BA', 'BA'), '5202')
  assert.equal(cfopPorUf('5202', 'BA', 'SE'), '6202')
  assert.equal(cfopPorUf('6411', 'ba', 'BA'), '5411')
  assert.throws(() => cfopPorUf('52', 'BA', 'BA'))
  assert.equal(cfopDevolucaoBase('1102'), '5202')
  assert.equal(cfopDevolucaoBase('2.102'), '5202') // a UF decide depois (cfopPorUf)
  assert.equal(cfopDevolucaoBase('1403'), '5411')
  assert.equal(cfopDevolucaoBase('1407'), '5413')
  assert.equal(cfopDevolucaoBase('1556'), '5556')
  assert.equal(cfopDevolucaoBase('1551'), '5553')
  assert.equal(cfopDevolucaoBase('1653'), '5662')
  assert.equal(cfopDevolucaoBase('1917'), '5918')
  assert.equal(cfopDevolucaoBase('1920'), '5921')
  // I1: sem CFOP de devolução válido (bonificação, outras): null = não emite pelo app (5.910/5.949 + finNFe 4 = 327)
  assert.equal(cfopDevolucaoBase('1910'), null)
  assert.equal(cfopDevolucaoBase('1949'), null)
  assert.equal(cfopDevolucaoBase('1124'), null)
  assert.equal(cfopDevolucaoBase(null), '5202')
  // todo par da tabela cai num CFOP com indDevol (dentro e fora do estado)
  for (const e of Object.keys(DEVOLUCAO_DA_ENTRADA)) {
    const c = cfopDevolucaoBase('1' + e)!
    assert.ok(CFOP_DEVOLUCAO_SAIDA.has(cfopPorUf(c, 'BA', 'BA')) && CFOP_DEVOLUCAO_SAIDA.has(cfopPorUf(c, 'BA', 'SP')), e)
  }
  assert.ok(!CFOP_DEVOLUCAO_SAIDA.has('5949') && !CFOP_DEVOLUCAO_SAIDA.has('5910') && !CFOP_DEVOLUCAO_SAIDA.has('5152'))
})

test('transferência × remessa pela raiz do CNPJ; CFOP x.151 para produção própria', () => {
  assert.equal(naturezaEntreLojas('11.222.333/0001-81', '11222333000262'), 'transferencia')
  assert.equal(naturezaEntreLojas('11222333000181', '99888777000100'), 'remessa')
  assert.equal(cfopEntreLojas('transferencia', '00', 'BA', 'BA'), '5152')
  assert.equal(cfopEntreLojas('transferencia', '04', 'BA', 'SP'), '6151')
  assert.equal(cfopEntreLojas('remessa', '04', 'BA', 'BA'), '5949')
})

test('ICMS de transferência/remessa pelo regime e pela configuração', () => {
  assert.deepEqual(icmsEntreLojas('transferencia', CONFIG_SIMPLES, 0), { grupo: 'SN102', orig: 0, csosn: '400' })
  assert.deepEqual(icmsEntreLojas('remessa', CONFIG_SIMPLES, 1), { grupo: 'SN900', orig: 1 })
  const normal = { ...CONFIG_SIMPLES, crt: 3 as const }
  assert.deepEqual(icmsEntreLojas('transferencia', normal, 0), { grupo: '40', orig: 0, cst: '41' })
  assert.deepEqual(icmsEntreLojas('remessa', normal, 0), { grupo: '90', orig: 0 })
})

test('proporção sobre o FATURADO na unidade de estoque (o fator de compra some), com teto no faturado', () => {
  // nota faturou 2 CX de 12 UN = 24 UN; devolve 6 UN digitadas = 1/4 → 0,5 CX na nota (mesmo se recebeu só 20)
  const f = proporcaoDevolvida(6, 24)
  assert.equal(f, 0.25)
  const it = itemDevolucao(ORIGEM_AZEITE, { proporcao: f, cfop: '5411', crt: 1, cstPisCofins: '49' })
  assert.equal(it.qCom, 0.5)
  assert.equal(it.uCom, 'CX')
  assert.equal(it.vUnCom, 300)
  assert.equal(it.vDesc, 5)
  assert.equal(it.vFrete, 7.5)
  assert.deepEqual(it.ipiDevol, { pDevol: 25, vIPIDevol: 15 })
  assert.throws(() => proporcaoDevolvida(25, 24), /faturada/)
  assert.throws(() => proporcaoDevolvida(0, 24))
})

test('devolução: ICMS próprio recalculado na BC proporcional; ST proporcional; sem ICMS na origem = CSOSN 900 vazio', () => {
  const az = itemDevolucao(ORIGEM_AZEITE, { proporcao: 0.5, cfop: '5411', crt: 1, cstPisCofins: '49' })
  assert.equal(az.icms.grupo, 'SN900')
  if (az.icms.grupo !== 'SN900') return
  assert.deepEqual(az.icms.proprio, { modBC: 3, vBC: 310, pICMS: 20.5, vICMS: 63.55 })
  assert.deepEqual(az.icms.st, { modBCST: 4, pMVAST: 29.03, vBCST: 400, pICMSST: 20.5, vICMSST: 18.45 })
  const tom = itemDevolucao(ORIGEM_TOMATE, { proporcao: 1, cfop: '5202', crt: 1, cstPisCofins: '49' })
  assert.deepEqual(tom.icms, { grupo: 'SN900', orig: 0, proprio: null, st: null })
  assert.equal(tom.ipiDevol, null)
  // regime normal: só próprio = CST 00; com ST = CST 90; nada = CST 90 vazio
  const semSt = { ...ORIGEM_AZEITE, icms: { ...ORIGEM_AZEITE.icms, vICMSST: 0, vBCST: 0 } }
  assert.equal(itemDevolucao(semSt, { proporcao: 1, cfop: '5202', crt: 3, cstPisCofins: '49' }).icms.grupo, '00')
  assert.equal(itemDevolucao(ORIGEM_AZEITE, { proporcao: 1, cfop: '5411', crt: 3, cstPisCofins: '49' }).icms.grupo, '90')
  assert.equal(itemDevolucao(ORIGEM_TOMATE, { proporcao: 1, cfop: '5202', crt: 3, cstPisCofins: '49' }).icms.grupo, '90')
})

test('texto da devolução cita a nota de origem, o motivo e o Simples', () => {
  const t = textoDevolucao({ numeroOrigem: '12345', serieOrigem: '1', emissaoOrigem: '2026-10-10', chaveOrigem: '2'.repeat(44), total: true, motivo: 'vencido', crt: 1, numeroInterno: 9 })
  assert.match(t, /Devolucao total da NF-e 12345 serie 1 de 10\/10\/2026, chave 2{44}\./)
  assert.match(t, /Motivo: vencido\./)
  assert.match(t, /Simples Nacional/)
})

test('situação e ações da NF-e na tela', () => {
  const agora = Date.parse('2026-10-20T13:00:00Z')
  assert.equal(rotuloStatusNfe('enviando', '2026-10-20T12:59:30Z', agora), 'Enviando à SEFAZ')
  assert.equal(rotuloStatusNfe('enviando', '2026-10-20T12:50:00Z', agora), 'Sem resposta da SEFAZ')
  assert.deepEqual(acoesNfe('rejeitada'), { enviar: true, mesmoXml: false, consultar: true, descartar: true, cancelar: false, cce: false, baixar: false })
  assert.deepEqual(acoesNfe('incerta'), { enviar: false, mesmoXml: false, consultar: true, descartar: false, cancelar: false, cce: false, baixar: false })
  // C1: rejeitada sem prova de que a SEFAZ não tem a chave (consulta 217 recente, 204/539): só o mesmo XML, sem descarte
  assert.deepEqual(acoesNfe('rejeitada', null, agora, false), { enviar: true, mesmoXml: true, consultar: true, descartar: false, cancelar: false, cce: false, baixar: false })
  assert.equal(acoesNfe('enviando', '2026-10-20T12:50:00Z', agora).consultar, true)
  assert.equal(acoesNfe('autorizada').cancelar, true)
  assert.equal(dentroDoPrazoCancelamento('2026-10-19T14:00:00Z', agora), true)
  assert.equal(dentroDoPrazoCancelamento('2026-10-19T12:00:00Z', agora), false)
  assert.equal(dentroDoPrazoCancelamento(null, agora), false)
})
