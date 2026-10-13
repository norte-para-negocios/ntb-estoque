// "Nosso Omie" Fase 4 (escrever no Omie pela tela): regras puras de decisão e prévia.
// Sem imports: node --test lib/estoque/escrita-omie-puro.test.ts.

/** Loja protegida nesta rodada (Sertão, produção): nada escreve no Omie pela tela. */
export const LOJA_BLOQUEADA = 4

const arred = (n: number, casas = 6) => Math.round(n * 10 ** casas) / 10 ** casas

/** Motivo para recusar a escrita pela tela nesta loja, ou null quando pode. */
export function bloqueioDeEscrita(l: { id: number; modo: string }): string | null {
  if (l.id === LOJA_BLOQUEADA) return 'A loja 4 (Sertão) está bloqueada para escrita no Omie pela tela nesta rodada. Use os fluxos de sempre.'
  if (l.modo !== 'omie') return 'Esta tela só escreve no Omie em loja de estoque Omie.'
  return null
}

/** "Saldo contado" (quanto tem de verdade) ou "diferença" (+ sobra, − falta) → entrada/saída no Omie. */
export function deltaDoAjuste(i: { modo: 'contagem' | 'diferenca'; valor: number; saldoAtual: number }):
  { tipo: 'ENT' | 'SAI'; quantidade: number } | { erro: string } {
  if (!Number.isFinite(i.valor)) return { erro: 'Valor inválido.' }
  if (i.modo === 'contagem' && i.valor < 0) return { erro: 'O saldo contado não pode ser negativo.' }
  const d = arred(i.modo === 'contagem' ? i.valor - i.saldoAtual : i.valor)
  if (d === 0) return { erro: 'Nada a ajustar: a diferença é zero.' }
  return { tipo: d > 0 ? 'ENT' : 'SAI', quantidade: Math.abs(d) }
}

/**
 * Mês do ajuste já enviado à contabilidade: anterior ao mês passado (hoje 13/10 → agosto ou antes) ou
 * até `fechadoAte` (YYYY-MM, configurável). Data ilegível conta como fechado (pede a 2ª confirmação).
 */
export function mesDoAjusteFechado(dataISO: string, hojeISO: string, fechadoAte?: string | null): boolean {
  const m = dataISO.match(/^(\d{4})-(\d{2})/)
  const h = hojeISO.match(/^(\d{4})-(\d{2})/)
  if (!m || !h) return true
  const mes = Number(m[1]) * 12 + Number(m[2]) - 1
  const atual = Number(h[1]) * 12 + Number(h[2]) - 1
  if (mes < atual - 1) return true
  const f = (fechadoAte ?? '').match(/^(\d{4})-(\d{2})$/)
  return !!f && mes <= Number(f[1]) * 12 + Number(f[2]) - 1
}

/** Prévia da correção: quanto o lançamento valia, quanto passa a valer e o efeito no valor do estoque. */
export function impactoCorrecaoCusto(i: { tipo: 'ENT' | 'SAI'; quantidade: number; custoAtual: number; custoNovo: number }) {
  const quantidade = Math.abs(i.quantidade)
  const valorAtual = arred(quantidade * i.custoAtual, 2)
  const valorNovo = arred(quantidade * i.custoNovo, 2)
  const diferenca = arred(valorNovo - valorAtual, 2)
  return { quantidade, valorAtual, valorNovo, diferenca, efeitoNoEstoque: i.tipo === 'ENT' ? diferenca : -diferenca }
}

export function validarCustoNovo(custoNovo: number, custoAtual: number): string | null {
  if (!Number.isFinite(custoNovo) || custoNovo <= 0) return 'Informe um custo maior que zero.'
  if (custoNovo >= 1e7) return 'Custo grande demais: confira o valor.'
  if (Math.abs(custoNovo - custoAtual) < 1e-9) return 'O custo novo é igual ao atual.'
  return null
}

export type AjusteParaCorrigir = {
  tipo: string; id_ajuste: number | null; transferencia_id: number | null; cod_int_ajuste: string | null
  origem: string | null; motivo: string | null; origem_ajuste: string | null; quan: number | null; valor: number | null
  codigo_local_estoque: number | null
}

/**
 * Por que este ajuste não pode ter o custo corrigido pela tela (null = pode). Só entrada/saída já lançada no Omie;
 * transferência e inventário têm o próprio fluxo (o id do ajuste fica guardado lá) e venda do PDV não é ajuste.
 * Id negativo só existe em loja de teste (resposta simulada): aceito só com `aceitaIdSimulado`.
 */
export function motivoNaoCorrige(a: AjusteParaCorrigir, opts: { aceitaIdSimulado?: boolean } = {}): string | null {
  if (a.tipo !== 'ENT' && a.tipo !== 'SAI') return 'Só dá para corrigir o custo de entrada ou saída.'
  if (a.id_ajuste == null || (a.id_ajuste <= 0 && !opts.aceitaIdSimulado)) return 'Este ajuste ainda não foi lançado no Omie.'
  if (a.transferencia_id != null) return 'Ajuste de transferência: corrija pela tela de Transferências.'
  if (/^ITEM/i.test(a.cod_int_ajuste ?? '')) return 'Ajuste de inventário: corrija pela tela de Inventário.'
  if (a.origem === 'PDV' || a.motivo === 'PDV' || a.origem_ajuste === 'pdv') return 'Venda do PDV não é ajuste.'
  if (!a.quan || !Number.isFinite(Number(a.quan))) return 'Ajuste sem quantidade.'
  if (a.codigo_local_estoque == null) return 'Ajuste sem local de estoque.'
  return null
}

/** Código de integração do ajuste relançado (o refazer procura por ele antes de incluir de novo). */
export const codIntCorrecao = (id: number) => `CUSTO-${id}`

const TRAVADA_MS = 10 * 60_000

/** O que o "Refazer" pode fazer com uma correção parada (null = nada agora). */
export function proximaEtapaCorrecao(status: string, atualizadoEm: string, agoraMs: number): 'relancar' | 'verificar_exclusao' | null {
  const t = Date.parse(atualizadoEm)
  const velha = !Number.isFinite(t) || agoraMs - t > TRAVADA_MS
  if (status === 'pendente_relancar') return 'relancar'
  if (status === 'relancando' && velha) return 'relancar'
  if (status === 'excluindo' && velha) return 'verificar_exclusao'
  return null
}

export type ItemFicha = { produto: number; insumo: number; quantidade: number; perda: number }
export type Troca = { produto: number; quantidadeAtual: number; quantidadeNova: number; perda: number; jaTemNovo: boolean }

/** Pratos que usam `de`, com a quantidade nova (a do prato ou a fixa). Ordenado por produto. */
export function montarTrocas(itens: ItemFicha[], de: number, para: number, quantidadeFixa: number | null): Troca[] {
  if (de === para) return []
  const comNovo = new Set(itens.filter((i) => i.insumo === para).map((i) => i.produto))
  return itens.filter((i) => i.insumo === de)
    .map((i) => ({ produto: i.produto, quantidadeAtual: i.quantidade, quantidadeNova: quantidadeFixa ?? i.quantidade, perda: i.perda, jaTemNovo: comNovo.has(i.produto) }))
    .sort((a, b) => a.produto - b.produto)
}

export type ItemLido = { idMalha: number; idProdMalha: number; quantProdMalha: number; percPerdaProdMalha?: number }

/** Ficha lida ao vivo antes de escrever: o insumo antigo aparece 1 vez e o novo ainda não está. */
export function conferirAntesDaTroca(itens: ItemLido[], de: number, para: number): { ok: true; antigo: ItemLido } | { ok: false; motivo: string } {
  const antigos = itens.filter((i) => Number(i.idProdMalha) === de)
  if (!antigos.length) return { ok: false, motivo: 'O prato não usa mais o insumo antigo no Omie (atualize a prévia).' }
  if (antigos.length > 1) return { ok: false, motivo: 'O insumo antigo aparece mais de uma vez na ficha: confira no Omie.' }
  if (itens.some((i) => Number(i.idProdMalha) === para)) return { ok: false, motivo: 'O insumo novo já está na ficha deste prato: confira no Omie.' }
  return { ok: true, antigo: antigos[0] }
}

const mesmaQtd = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 1e-6

/** Releitura depois de cada escrita. */
export function conferirTroca(etapa: 'incluido' | 'excluido', itens: ItemLido[], de: number, para: number, quantidadeNova: number):
  { ok: true } | { ok: false; motivo: string } {
  const novos = itens.filter((i) => Number(i.idProdMalha) === para)
  const antigos = itens.filter((i) => Number(i.idProdMalha) === de)
  if (novos.length !== 1) return { ok: false, motivo: novos.length ? 'O insumo novo aparece mais de uma vez na ficha: confira no Omie.' : 'O insumo novo não apareceu na ficha relida.' }
  if (!mesmaQtd(novos[0].quantProdMalha, quantidadeNova)) return { ok: false, motivo: `O insumo novo entrou com quantidade ${novos[0].quantProdMalha} (esperado ${quantidadeNova}): confira no Omie.` }
  if (etapa === 'incluido' && antigos.length !== 1) return { ok: false, motivo: 'O insumo antigo sumiu da ficha antes da exclusão: confira no Omie.' }
  if (etapa === 'excluido' && antigos.length) return { ok: false, motivo: 'O insumo antigo continua na ficha depois da exclusão: a ficha está com os dois, confira no Omie.' }
  return { ok: true }
}

/** `intMalha` (código de integração do item da ficha, obrigatório no IncluirEstrutura). */
export function intMalhaDaTroca(agoraMs: number, sorte: number): string {
  return `TRC${agoraMs.toString(36)}${Math.floor(sorte * 36 ** 4).toString(36).padStart(4, '0')}`.slice(0, 20)
}

/** Bloqueio/limite do Omie: parar a fila na hora (repetir só estende o bloqueio). */
export function ehLimiteOmie(msg: string): boolean {
  return /MISUSE|consumo indevido|bloquead|REDUNDANT|consumo redundante|j. existe uma requisi|too many requests/i.test(msg)
}

/** Quais OPs selecionadas podem entrar no lote (abertas, com código do Omie, sem repetir, até `max`). */
export function selecionarLoteOPs(ops: { id: number; nCodOP: number | null; aberta: boolean }[], ids: number[], max = 100):
  { validas: number[]; ignoradas: { id: number; motivo: string }[] } {
  const porId = new Map(ops.map((o) => [o.id, o]))
  const validas: number[] = []
  const ignoradas: { id: number; motivo: string }[] = []
  const vistos = new Set<number>()
  for (const id of ids) {
    if (vistos.has(id)) { ignoradas.push({ id, motivo: 'Selecionada duas vezes.' }); continue }
    vistos.add(id)
    const o = porId.get(id)
    if (!o) { ignoradas.push({ id, motivo: 'OP não encontrada nesta loja.' }); continue }
    if (!o.aberta) { ignoradas.push({ id, motivo: 'A OP não está mais aberta.' }); continue }
    if (!o.nCodOP) { ignoradas.push({ id, motivo: 'OP sem código do Omie (aguarde a sincronização).' }); continue }
    if (validas.length >= max) { ignoradas.push({ id, motivo: `Passou do limite de ${max} OPs por vez.` }); continue }
    validas.push(id)
  }
  return { validas, ignoradas }
}

/** Saldo que decide sobrando/faltando: o do local da OP (sem local = total; local sem saldo = 0). */
export function saldoNoLocalDaOP(locais: { codigoLocal: number; saldo: number }[], localOP: number | null, total: number): number {
  if (!localOP) return total
  return locais.find((l) => l.codigoLocal === localOP)?.saldo ?? 0
}

export function isoParaBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
