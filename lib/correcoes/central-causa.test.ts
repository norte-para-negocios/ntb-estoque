import { test } from 'node:test'
import assert from 'node:assert/strict'
import { causaNegativo, causaCusto, causaOP, causaContagem, causaSemCusto, causaTaxa, causaCupom } from './central-puro.ts'

test('causa em uma frase', () => {
  assert.equal(causaNegativo({ grupo: 'pi', saldo: '−64,89 kg', locais: 'Depósito', desde: null, cuponsSemOP: 0, opAberta: null, notaPendente: null }),
    'Saldo −64,89 kg no local Depósito. Foi usado nos pratos sem OP de preparo lançada.')
  assert.equal(causaNegativo({ grupo: 'mp', saldo: '−1,84 kg', locais: 'Depósito', desde: '10/10', cuponsSemOP: 0, opAberta: null, notaPendente: '955667' }),
    'Saldo −1,84 kg no local Depósito, negativo desde 10/10. Tem a nota 955667 esperando entrada no estoque.')
  assert.equal(causaNegativo({ grupo: 'pa', saldo: '−4 un', locais: 'Depósito', desde: null, cuponsSemOP: 1, opAberta: null, notaPendente: null }),
    'Saldo −4 un no local Depósito. 1 cupom deste prato ficou sem OP: a venda baixou o prato e não os insumos.')
  assert.equal(causaNegativo({ grupo: 'pa', saldo: '−4 un', locais: 'Depósito', desde: null, cuponsSemOP: 0, opAberta: 'OP 395567', notaPendente: null }),
    'Saldo −4 un no local Depósito. A OP 395567 está aberta: concluir repõe o saldo.')
  assert.equal(causaCusto({ cmc: 'R$ 600,00/un', ficha: null, vezes: null, anterior: 'R$ 3,00' }),
    'Custo médio de R$ 600,00/un; antes era R$ 3,00. Costuma ser entrada com custo ou unidade errada.')
  assert.equal(causaOP({ sentido: 'faltando', desde: '03/10', cupom: null, saldoLocal: '−10 un', qtd: '+232 un', insumos: 'R$ 139,2 mil' }),
    'Aberta desde 03/10. Concluir põe +232 un no saldo (hoje −10 un) e baixa os insumos (R$ 139,2 mil).')
  assert.equal(causaOP({ sentido: 'velha', desde: '25/09', cupom: null, saldoLocal: '2 un', qtd: '+1 un', insumos: null }),
    'Aberta desde 25/09 e ainda sem conclusão. Conclua com a data certa ou exclua se a produção não aconteceu.')
  assert.equal(causaContagem({ de: '5 kg', para: '4.658 kg', data: '31/08', sugerida: '4,658 kg', subiu: true }),
    'Contagem saltou de 5 kg para 4.658 kg em 31/08. Parece 4,658 kg digitado como 4.658 kg.')
  assert.equal(causaSemCusto({ insumo: 'CARURU (PI)', local: 'Depósito', pratos: ['Moqueca', 'Abará'], inativo: false }),
    'CARURU (PI) está sem custo no local Depósito. Moqueca e Abará não concluem OP no Omie (erro Client-193) e saem mais baratos do que são.')
  assert.equal(causaSemCusto({ insumo: 'X', local: '', pratos: ['Moqueca', 'Abará'], inativo: true }),
    'X está inativo, mas continua na ficha de Moqueca e Abará. Troque o insumo na ficha.')
  assert.equal(causaTaxa({ saldo: '−851 un' }),
    'Não é mercadoria: cada venda baixa o "estoque" e o saldo só desce (−851 un). Marcar como "não controla estoque" tira o item daqui.')
  assert.equal(causaCupom({ num: '206453', data: '12/10', hora: '15:20', itens: ['Moqueca ×1', 'Abará ×2'] }),
    'Cupom 206453 de 12/10 às 15:20: Moqueca ×1, Abará ×2 sem OP. A venda baixou os pratos, mas os insumos não saíram.')
})
