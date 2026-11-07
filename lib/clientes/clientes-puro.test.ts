import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarCnpjCpf } from '../importacao/planilha-puro.ts'
import { juntarPapel, papeisDoFiltro, planoTransportadoras, validarCliente, type ClienteInput } from './clientes-puro.ts'

const base: ClienteInput = { papel: 'cliente', razao_social: 'Restaurante X', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '', email: '', telefone: '',
  cep: '', uf: '', cidade: '', bairro: '', logradouro: '', numero: '', complemento: '', rntrc: '', inativo: false }

test('validarCliente: normaliza documento, CPF = pessoa física, campos vazios viram null', () => {
  const r = validarCliente({ ...base, cnpj_cpf: '529.982.247-25', uf: 'ba', cep: '40.000-000' }, validarCnpjCpf)
  assert.ok(r.ok)
  if (r.ok) { assert.equal(r.linha.cnpj_cpf, '52998224725'); assert.equal(r.linha.pessoa_fisica, true); assert.equal(r.linha.uf, 'BA'); assert.equal(r.linha.cep, '40000000'); assert.equal(r.linha.email, null) }
  assert.deepEqual(validarCliente({ ...base, razao_social: ' ' }, validarCnpjCpf), { ok: false, erro: 'Informe a razão social (ou o nome)' })
  assert.equal(validarCliente({ ...base, cnpj_cpf: '11.222.333/0001-82' }, validarCnpjCpf).ok, false)
  assert.equal(validarCliente({ ...base, uf: 'XX' }, validarCnpjCpf).ok, false)
  assert.equal(validarCliente({ ...base, papel: 'outro' as never }, validarCnpjCpf).ok, false)
})

test('papel: juntar e filtro', () => {
  assert.equal(juntarPapel('cliente', 'transportadora'), 'ambos')
  assert.equal(juntarPapel('ambos', 'cliente'), 'ambos')
  assert.equal(juntarPapel('cliente', 'cliente'), 'cliente')
  assert.deepEqual(papeisDoFiltro('transportadora'), ['transportadora', 'ambos'])
  assert.equal(papeisDoFiltro(undefined), null)
})

test('planoTransportadoras: só com documento válido, sem repetir, cliente existente vira ambos, ignora "Cliente retira"', () => {
  const t = [
    { cNomeTransp: 'CERVEJARIA PETROPOLIS S A', cCnpjCpfTransp: '11.222.333/0001-81', cUFTransp: 'rj' },
    { cNomeTransp: 'CERVEJARIA PETROPOLIS S A', cCnpjCpfTransp: '11222333000181' },
    { cNomeTransp: 'Cliente retira', cCnpjCpfTransp: '52998224725' },
    { cNomeTransp: 'SEM DOC LTDA' },
    { cNomeTransp: 'Já é cliente', cCnpjCpfTransp: '52998224725' },
    { cNomeTransp: 'Já é transportadora', cCnpjCpfTransp: '04252011000110' },
  ]
  const r = planoTransportadoras(t, [{ id: 7, cnpj: '52998224725', papel: 'cliente' }, { id: 8, cnpj: '04252011000110', papel: 'transportadora' }], validarCnpjCpf)
  assert.deepEqual(r.inserir, [{ razao_social: 'CERVEJARIA PETROPOLIS S A', cnpj_cpf: '11222333000181', pessoa_fisica: false, inscricao_estadual: null, uf: 'RJ', rntrc: null }])
  assert.deepEqual(r.virarAmbos, [7])
})
