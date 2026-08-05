const JANELA_QUENTE_DIAS = 90

// Achado real (Task 1 do plano de auditoria de filtros/completude, 2026-08-04,
// ver .superpowers/sdd/2026-08-04-auditoria-filtros-relatorios/task-1-report.md):
// JANELA_QUENTE_DIAS=90 foi calibrado pro Supabase CLOUD (free tier, 500MB), que
// so guardava os ultimos 90 dias de fato. NESTA MESMA SESSAO o Supabase cloud foi
// desligado -- o app roda 100% self-hosted no Contabo (container `supabase-db`)
// desde entao, sem limite de disco. Confirmado lendo o cron de poda
// (app/api/cron/prune/route.ts): ele so apaga `webhooks` e
// `integration_attempts` -- nunca `movimentos`, `movimentos_historico`,
// `notas_fiscais`, `nota_fiscal_items` ou `ordens_producao`. Ou seja, a premissa
// que gerou este arquivo (Supabase = so 90 dias) esta obsoleta pra essas 5
// tabelas.
//
// Verificado ao vivo (producao) especificamente pra `notas_fiscais`, loja 3
// (DONANA RIO VERMELHO, referencia ja usada em docs/validacao-dados-2026-08-01.md),
// com uma unica query rodando count(*)/sum(n_valor_nfe)/min/max juntos (evita
// number chutado num comentario permanente -- achado C1 da revisao desta task):
//   - Periodo de 6 meses cruzando os 90 dias (2026-02-01 a 2026-08-04): Supabase
//     self-hosted = 1025 notas, sum(n_valor_nfe) = R$1.369.374,66;
//     Contabo-frio (count=true) = 1026 notas.
//   - SEM filtro de data (historico inteiro, desde 2025-06-28): Supabase
//     self-hosted = 2397 notas; Contabo-frio = 2393 notas.
//   - Tela de Nota Fiscal em producao (mesmo filtro, loja 3, fev-ago/2026):
//     1026 notas / R$1.370.142,66 -- bate com o merge quente+frio (a 1 nota de
//     diferenca e sincronizacao normal do dia, nao um buraco sistematico).
// Conclusao: pra `notas_fiscais`/`nota_fiscal_items`, o Supabase self-hosted ja
// cobre virtualmente o mesmo intervalo que o Contabo-frio -- a distincao
// quente/frio baseada em JANELA_QUENTE_DIAS virou redundante pra essas duas
// tabelas. `complementarNotasFiscais`/`complementarNotaFiscalItems` abaixo foram
// simplificadas pra so consultar o frio no lookup por id/notaFiscalId (nota
// especifica que por algum motivo nao esteja no Supabase) -- o codigo de
// leitura do Contabo-frio (buscarFrioTudo, mesclar*PorChaveNatural,
// contarNotasFiscaisAntigas) continua intacto, so passou a ser chamado com
// menos frequencia.
//
// Fix round 1 (achado C2 da revisao desta task): 2 callers destas funcoes --
// app/(app)/nota-fiscal/relatorio/route.ts e app/(app)/nota-fiscal/export/route.ts
// -- tinham seu PROPRIO guard duplicado (`dataInicio < limiteJanelaQuente()`)
// decidindo se completavam com o frio antes mesmo de chamar
// complementarNotasFiscais. Com o gate interno simplificado pra so olhar
// `opts.id`, aquele guard externo virou morto (sempre chamava a funcao, que
// agora so retorna as quentes) -- na pratica, as 2 rotas paravam de buscar o
// frio pra QUALQUER periodo, silenciosamente. Corrigido nos 2 arquivos: removido
// o guard externo (e o calculo de notaIdsFrioSet/buscarNotaIdsFrio, que so
// filtrava a fatia fria que deixou de ser buscada), deixando explicito que
// essas 2 rotas usam so o Supabase agora -- consistente com o mesmo achado.
// Retestado ao vivo (ver task-1-report.md, secao "Fix round 1").
//
// NAO testado (e por isso NAO alterado) neste achado: `movimentos`,
// `movimentos_historico` e `ordens_producao` -- `complementarMovimentos`,
// `complementarMovimentosHistorico` e `complementarOrdensProducao` continuam
// gateados por `foraDaJanelaQuente` como antes. Essas tabelas tem achados
// proprios documentados abaixo (duplicatas reais em `movimentos_historico`,
// gap estatico conhecido em `movimentos`) que precisam de verificacao propria
// antes de aplicar a mesma simplificacao -- ver Tasks 5 (Producao) e 6
// (Movimentacoes) do mesmo plano de auditoria.
//
// Data mais antiga que ainda fica no Supabase apos a poda. Qualquer consulta
// que peca algo mais velho que isso precisa completar com o Contabo.
function limiteJanelaQuente(): string {
  return new Date(Date.now() - JANELA_QUENTE_DIAS * 86400000).toISOString().slice(0, 10)
}

function foraDaJanelaQuente(dataInicio?: string | null): boolean {
  if (!dataInicio) return true // sem filtro de data = a leitura espera "tudo"
  return dataInicio < limiteJanelaQuente()
}

// Timeout por requisicao. Achado real (auditoria Notas Fiscais 2026-07-19): o
// teto antigo de 5s era curto demais pra paginas de 2000+ linhas sobre a
// internet publica -- medido ao vivo, /notas_fiscais?offset=0 (2000 linhas)
// levou entre 4.6s e 9.1s por chamada. Com 5s, a requisicao abortava NO MEIO
// da paginacao com frequencia dependente so da latencia do momento.
const TIMEOUT_PADRAO_MS = 20000

// Retorna `null` (em vez de []) quando a requisicao falha/expira, pra quem
// pagina (buscarFrioTudo) conseguir distinguir "acabaram as paginas" (resposta
// bem-sucedida com menos linhas que o pedido) de "a chamada falhou" -- as duas
// situacoes antes produziam o mesmo `[]` e eram tratadas como equivalentes,
// truncando a paginacao em silencio sempre que uma pagina do meio falhasse.
export async function buscarFrio<T>(
  caminho: string,
  params: Record<string, string | number | undefined>,
  timeoutMs = TIMEOUT_PADRAO_MS,
): Promise<T[] | null> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return []
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(`${url}${caminho}?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
      // Dado historico muda (novas notas chegam, cron de sync roda) e o cache
      // de fetch do framework em Server Components (server-side, nao o cache
      // do navegador) pode reter uma resposta antiga -- inclusive uma
      // capturada durante uma falha ja corrigida, mascarando o efeito de
      // qualquer fix nesta funcao ate o processo reiniciar (confundiu esta
      // propria auditoria: o total continuava errado em dev mesmo depois do
      // fix, ate reiniciar o `next dev`). Nunca cachear e o certo aqui.
      cache: 'no-store',
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { rows?: T[] }
    return json.rows ?? []
  } catch (e) {
    console.error(`historico-contabo: falha ao consultar ${caminho}`, e)
    return null
  }
}

// Contagem real (sem LIMIT) para cards/badges -- usa o parametro count=true do
// endpoint, que faz um select count(*) no Contabo em vez de trazer as linhas
// (evita truncar em falso o numero quando ha mais registros que o teto do modo normal).
// dataInicio e opcional (mantido pra nao quebrar o chamador original, o card "total
// de OPs" da home, que so quer "tudo ate dataFinal") -- passar quando o chamador
// precisar contar so dentro de um periodo (ver uso em ordem-producao/page.tsx).
export async function contarOrdensProducaoAntigas(opts: {
  lojaId: number
  dataInicio?: string
  dataFinal: string
  // Ver o mesmo parametro em complementarOrdensProducao -- precisa bater com o
  // `campo` usado pra buscar as linhas, senao a contagem (usada pra detectar
  // corte silencioso em totaisParciais) compara periodos diferentes.
  campo?: 'conclusao' | 'previsao'
}): Promise<number> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return 0
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const prefixoData = opts.campo === 'previsao' ? 'previsao' : 'data'
    const qs = new URLSearchParams({ loja_id: String(opts.lojaId), count: 'true' })
    qs.set(`${prefixoData}_final`, opts.dataFinal)
    if (opts.dataInicio) qs.set(`${prefixoData}_inicio`, opts.dataInicio)
    const resp = await fetch(`${url}/ordens_producao?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
      cache: 'no-store', // ver comentario em buscarFrio sobre cache de fetch mascarar dado historico
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { count?: number }
    return json.count ?? 0
  } catch (e) {
    console.error('historico-contabo: falha ao contar ordens_producao antigas', e)
    return 0
  }
}

// Mesmo padrao acima, para /notas_fiscais -- usado como cinto-de-seguranca em
// nota-fiscal/page.tsx: compara contra o numero de linhas frias efetivamente
// trazidas por buscarFrioTudo pra detectar paginacao incompleta (ex: Contabo
// fora do ar bem no meio, ou as 3 tentativas de buscarFrioTudo esgotadas) e
// avisar em vez de mostrar um total errado sem dizer nada.
export async function contarNotasFiscaisAntigas(opts: {
  lojaId: number
  dataInicio?: string
  dataFinal: string
  busca?: string
}): Promise<number> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return 0
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const qs = new URLSearchParams({ loja_id: String(opts.lojaId), data_final: opts.dataFinal, count: 'true' })
    if (opts.dataInicio) qs.set('data_inicio', opts.dataInicio)
    if (opts.busca) qs.set('busca', opts.busca)
    const resp = await fetch(`${url}/notas_fiscais?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
      cache: 'no-store', // ver comentario em buscarFrio sobre cache de fetch mascarar dado historico
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { count?: number }
    return json.count ?? 0
  } catch (e) {
    console.error('historico-contabo: falha ao contar notas_fiscais antigas', e)
    return 0
  }
}

// Mesmo padrao acima, para /movimentos -- usado como cinto-de-seguranca em
// `complementarMovimentos` (parametro opcional `onFrioIncompleto`, ver
// abaixo): compara contra o numero de linhas frias efetivamente trazidas por
// buscarFrioTudo pra detectar paginacao incompleta (Contabo fora do ar bem no
// meio, ou as 3 tentativas de buscarFrioTudo esgotadas). Achado real (revisao
// final da auditoria de filtros/relatorios, item I5): antes, essa truncagem
// so virava um `console.error` (ver buscarFrioTudo) -- fonte=manual em
// /relatorio-movimentacao podia mostrar total silenciosamente incompleto sem
// nenhum aviso na tela, mesmo padrao de bug ja corrigido em nota-fiscal
// (totaisParciais).
export async function contarMovimentosAntigas(opts: {
  lojaId: number
  dataInicio?: string
  dataFinal?: string
}): Promise<number> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return 0
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const qs = new URLSearchParams({ loja_id: String(opts.lojaId), count: 'true' })
    if (opts.dataInicio) qs.set('data_inicio', opts.dataInicio)
    if (opts.dataFinal) qs.set('data_final', opts.dataFinal)
    const resp = await fetch(`${url}/movimentos?${qs.toString()}`, {
      headers: { 'X-Api-Key': key ?? '' },
      signal: controller.signal,
      cache: 'no-store', // ver comentario em buscarFrio sobre cache de fetch mascarar dado historico
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    const json = (await resp.json()) as { count?: number }
    return json.count ?? 0
  } catch (e) {
    console.error('historico-contabo: falha ao contar movimentos antigos', e)
    return 0
  }
}

// A API do Contabo tem LIMIT fixo no servidor pros endpoints de historico longo
// (nao aceita LIMIT arbitrario do cliente, so `offset`) -- acha real (audit Notas
// Fiscais 2026-07-19): nenhum client deste repo de fato fazia o loop de paginas,
// entao /notas_fiscais (LIMIT 2000 no servidor) e /nota_fiscal_items (LIMIT 5000)
// truncavam em silencio pra loja com mais historico que isso (achado real: loja 3
// tinha 2248 notas fiscais no Contabo, loja 5 tinha 2561 -- o badge de "Notas
// Fiscais" pra periodo desde o inicio mostrava 2050 em vez das 2650 reais).
//
// Segundo achado real na MESMA auditoria, depois de corrigir o de cima: mesmo
// paginando, o total continuava errado e MUDAVA a cada carregamento (1423,
// depois 1932, valor real 2629) -- causa raiz era o timeout de 5s por chamada
// (curto demais pra paginas de 2000 linhas, ver TIMEOUT_PADRAO_MS acima)
// combinado com o fato de `buscarFrio` devolver `[]` tanto pra "acabou" quanto
// pra "falhou" -- uma pagina do MEIO que abortasse por timeout era lida como
// "fim dos dados" e a paginacao parava ali, perdendo tudo dali pra frente em
// silencio, de forma nao-deterministica (dependia so da latencia daquele
// carregamento). Agora falha distinta (`null`) tenta de novo com backoff antes
// de desistir, e so para o loop numa resposta bem-sucedida curta o bastante.
export async function buscarFrioTudo<T>(
  caminho: string,
  params: Record<string, string | number | undefined>,
  tamanhoPagina: number,
): Promise<T[]> {
  const tudo: T[] = []
  for (let offset = 0; ; offset += tamanhoPagina) {
    let pagina: T[] | null = null
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      pagina = await buscarFrio<T>(caminho, { ...params, offset })
      if (pagina !== null) break
      if (tentativa < 2) await new Promise((r) => setTimeout(r, 500 * (tentativa + 1)))
    }
    if (pagina === null) {
      console.error(
        `historico-contabo: desistindo de ${caminho} no offset ${offset} apos 3 tentativas -- dado pode estar incompleto`,
      )
      break
    }
    tudo.push(...pagina)
    if (pagina.length < tamanhoPagina) break
  }
  return tudo
}

// Achado real (auditoria do bug de duplicacao de movimentos, 2026-07-25,
// estendido pra NF/OP em 2026-07-26): assim que ganharem dual-write continuo
// pro Contabo (lib/omie/nota-fiscal.ts, lib/omie/ordem-producao.ts), essas 3
// tabelas passam a ter o MESMO problema que `movimentos` teve -- o Contabo
// gera seu proprio `id` (bigserial) pra cada linha nova, independente do
// Supabase. mesclarPorId (por `.id`) nao reconhece como o mesmo registro.
// Dedupe pela chave natural em vez disso, mesmo padrao ja usado em
// complementarMovimentos/complementarMovimentosHistorico. Como
// n_id_receb/n_sequencia/identificacao_n_cod_op sao sempre preenchidos pra
// todo registro real vindo do Omie (ao contrario de id_ajuste em
// `movimentos`, que podia ser nulo), nao precisa de fallback pro `.id`.
function mesclarNotasFiscaisPorChaveNatural<T extends { id: number; n_id_receb: string }>(
  quentes: T[],
  frias: T[]
): T[] {
  const vistos = new Set(quentes.map((r) => r.n_id_receb))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.n_id_receb))]
}

function mesclarNotaFiscalItemsPorChaveNatural<T extends { id: number; n_id_receb: string; n_sequencia: number }>(
  quentes: T[],
  frias: T[]
): T[] {
  const chave = (r: T) => `${r.n_id_receb}|${r.n_sequencia}`
  const vistos = new Set(quentes.map(chave))
  return [...quentes, ...frias.filter((r) => !vistos.has(chave(r)))]
}

function mesclarOrdensProducaoPorChaveNatural<T extends { id: number; identificacao_n_cod_op: number }>(
  quentes: T[],
  frias: T[]
): T[] {
  const vistos = new Set(quentes.map((r) => r.identificacao_n_cod_op))
  return [...quentes, ...frias.filter((r) => !vistos.has(r.identificacao_n_cod_op))]
}

export async function complementarNotasFiscais<T extends { id: number; n_id_receb: string }>(
  quentes: T[],
  opts: {
    lojaId: number
    dataInicio?: string
    dataFinal?: string
    busca?: string
    id?: number
    // Filtro adicional aplicado SO na fatia fria antes do merge -- o endpoint
    // do Contabo nao sabe filtrar por status no servidor. Opcional: chamadores
    // que nao precisam (a maioria) continuam exatamente como antes.
    filtrarFrias?: (row: T) => boolean
  }
): Promise<T[]> {
  // Simplificado (Task 1, ver achado no topo do arquivo): Supabase self-hosted
  // ja cobre o mesmo intervalo que o Contabo-frio pra notas_fiscais -- so
  // completa do frio pra lookup por id (nota especifica que por algum motivo
  // nao esteja no Supabase). Antes: `if (!foraDaJanelaQuente(opts.dataInicio)
  // && !opts.id) return quentes` (consultava o frio sempre que o periodo
  // cruzasse os 90 dias, mesmo sem necessidade real).
  if (!opts.id) return quentes
  const friasRaw = await buscarFrioTudo<T>('/notas_fiscais', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    busca: opts.busca,
    id: opts.id,
  }, 2000)
  const frias = opts.filtrarFrias ? friasRaw.filter(opts.filtrarFrias) : friasRaw
  return mesclarNotasFiscaisPorChaveNatural(quentes, frias)
}

export async function complementarNotaFiscalItems<T extends { id: number; n_id_receb: string; n_sequencia: number }>(
  quentes: T[],
  opts: { lojaId: number; notaFiscalId?: number | number[]; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  // Simplificado (Task 1, ver achado no topo do arquivo): mesmo raciocinio de
  // complementarNotasFiscais -- so completa do frio pra lookup por
  // notaFiscalId especifico. Antes: `if (!opts.notaFiscalId &&
  // !foraDaJanelaQuente(opts.dataInicio)) return quentes`.
  if (!opts.notaFiscalId) return quentes
  const frias = await buscarFrioTudo<T>('/nota_fiscal_items', {
    loja_id: opts.lojaId,
    nota_fiscal_id: Array.isArray(opts.notaFiscalId) ? opts.notaFiscalId.join(',') : opts.notaFiscalId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  }, 5000)
  return mesclarNotaFiscalItemsPorChaveNatural(quentes, frias)
}

export async function complementarOrdensProducao<T extends { id: number; identificacao_n_cod_op: number }>(
  quentes: T[],
  opts: {
    lojaId: number
    dataInicio?: string
    dataFinal?: string
    validadeInicio?: string
    validadeFinal?: string
    busca?: string
    id?: number
    // 'conclusao' (default, mantido por compatibilidade): data_inicio/data_final
    // filtram dt_conclusao_real no servidor -- e o que lib/resumo-dia.ts espera
    // (quer OPs concluidas dentro do periodo). 'previsao': filtra
    // identificacao_d_dt_previsao (data planejada) em vez disso -- usar quando o
    // lado quente (Supabase) tambem filtra por identificacao_d_dt_previsao, senao
    // quente e frio ficam comparando periodos diferentes. Achado real
    // (2026-07-19): ordem-producao/page.tsx filtra o quente por
    // identificacao_d_dt_previsao mas chamava isto sem `campo`, entao o
    // complemento frio filtrava por dt_conclusao_real -- OPs nao concluidas
    // (sem dt_conclusao_real) do Contabo nunca entravam quando um periodo era
    // aplicado, e OPs concluidas apareciam/sumiam no periodo errado (data de
    // conclusao, nao a planejada).
    campo?: 'conclusao' | 'previsao'
  }
): Promise<T[]> {
  const precisa =
    opts.id || foraDaJanelaQuente(opts.dataInicio) || foraDaJanelaQuente(opts.validadeInicio)
  if (!precisa) return quentes
  // Achado real (auditoria 2026-07-19): /ordens_producao tem o MESMO limite
  // fixo de 2000 no servidor que os outros endpoints de historico longo --
  // sem offset, uma chamada sem filtro de data (dataInicio vazio = "quer
  // tudo") vinha cortada em silencio. Lojas tem 40mil a 88mil OPs no Contabo
  // (loja 5: 88491) -- so ~2-5% chegava. Servidor ganhou suporte a `offset`.
  const prefixoData = opts.campo === 'previsao' ? 'previsao' : 'data'
  const frias = opts.id
    ? (await buscarFrio<T>('/ordens_producao', { loja_id: opts.lojaId, id: opts.id })) ?? []
    : await buscarFrioTudo<T>('/ordens_producao', {
        loja_id: opts.lojaId,
        [`${prefixoData}_inicio`]: opts.dataInicio,
        [`${prefixoData}_final`]: opts.dataFinal,
        validade_inicio: opts.validadeInicio,
        validade_final: opts.validadeFinal,
        busca: opts.busca,
      }, 2000)
  return mesclarOrdensProducaoPorChaveNatural(quentes, frias)
}

// Achado real (auditoria do bug de duplicacao, 2026-07-25): diferente de
// notas_fiscais/nota_fiscal_items/ordens_producao (copia unica e congelada
// desde 07-12, id preservado 1:1), `movimentos` ganhou escrita continua pro
// Contabo em 07-18 (lib/omie/sync-ajustes.ts -> POST /movimentos_bulk) que
// NUNCA envia o `id` -- cada base gera o seu bigserial de forma independente
// pro mesmo registro logico. Confirmado ao vivo: mesmo id_ajuste (9568796382)
// tem id=1036091 no Supabase e id=1035472 no Contabo. mesclarPorId (por
// `.id`) nao reconhece que e o mesmo registro -- o Supabase hoje NAO poda
// `movimentos` (guarda historico completo desde 01/07/2025), entao toda vez
// que um relatorio pede um periodo que cruza a janela quente, a fatia
// recente aparece duplicada (uma vez vinda do Supabase, outra do Contabo).
// A chave natural real e `(loja_id, id_ajuste)` -- ja usada corretamente no
// UPSERT dos dois lados (migration 059, ver AGENTS.md) -- entao dedupe por
// ela aqui tambem, com fallback pro `id` só pros poucos registros antigos
// sem `id_ajuste` (existiam antes da chave natural existir). NAO inclui
// `loja_id` na chave por design -- esta funcao so e segura quando quentes/
// frias ja sao de 1 loja so (todo caller de complementarMovimentos hoje
// filtra por loja antes de chamar). Achado na revisao deste fix
// (2026-07-25): o fallback por `.id` continua exposto ao MESMO bug original
// em escala reduzida -- dois registros sem `id_ajuste`, um de cada banco,
// podem coincidir de `id` por acaso (ja provamos que os bigserial das duas
// bases sao independentes). Aceito como risco residual (poucas dezenas de
// registros por loja, de antes da chave natural existir).
function mesclarMovimentosPorChaveNatural<T extends { id: number; id_ajuste: number | null }>(
  quentes: T[],
  frias: T[]
): T[] {
  const chave = (r: T) => (r.id_ajuste != null ? `aj:${r.id_ajuste}` : `id:${r.id}`)
  const vistos = new Set(quentes.map(chave))
  return [...quentes, ...frias.filter((r) => !vistos.has(chave(r)))]
}

// Achado real (auditoria movimentacao-operacao-auto, 2026-07-19): /movimentos
// tem o MESMO limite fixo de 5000 no servidor que /notas_fiscais e
// /nota_fiscal_items ja tinham (ver buscarFrioTudo acima) -- so que sem
// offset, entao nunca foi paginado. Loja 5 sozinha tem 51937 ajustes desde
// 01/07/2025 (so ~10% vinha antes do fix). Servidor ganhou suporte a
// `offset` (mesmo padrao); client agora pagina igual aos outros.
// `onFrioIncompleto` (revisao final da auditoria de filtros/relatorios, item
// I5): parametro opcional, nao quebra nenhum dos 3 call sites existentes que
// nao passam nada (lib/movimentacao-operacao-auto.ts, lib/resumo-dia.ts,
// lib/actions/busca-global.ts) -- mesmo padrao non-breaking ja usado no
// `onErro` de rpcTodos (lib/supabase/rpc-todos.ts) nesta mesma rodada de
// hardening. So dispara a query extra de contagem (contarMovimentosAntigas)
// quando o caller passa o callback, pra nao pagar o custo de rede a mais nos
// 3 call sites que nao precisam desse sinal.
export async function complementarMovimentos<T extends { id: number; id_ajuste: number | null }>(
  quentes: T[],
  opts: { lojaId: number; dataInicio?: string; dataFinal?: string; idProd?: number; transferenciaId?: number },
  onFrioIncompleto?: (friasEncontradas: number, friasEsperadas: number) => void
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const frias = await buscarFrioTudo<T>('/movimentos', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
    id_prod: opts.idProd,
    transferencia_id: opts.transferenciaId,
  }, 5000)
  if (onFrioIncompleto) {
    const friasEsperadas = await contarMovimentosAntigas({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal })
    if (frias.length < friasEsperadas) onFrioIncompleto(frias.length, friasEsperadas)
  }
  return mesclarMovimentosPorChaveNatural(quentes, frias)
}

// Achado real (auditoria de relatorios, 2026-07-26): o Postgres do Contabo
// tem linhas literalmente duplicadas em `movimentos_historico` (mesmo
// cod_prod+data+valores) -- sobra de reprocessamento de backfill antigo,
// fora do controle deste app. A chave natural real da tabela e
// `(loja_id, cod_prod, data)` (migration 015) -- linhas com a mesma chave sao
// o MESMO registro logico e nao devem ser somadas 2x. Medido: 213 linhas
// extras em 5 datas so na loja 2, inflando entradas/saidas em ~2%/~0.3%
// sempre que o periodo cruza os 90 dias. Usado tanto aqui (merge quente+frio)
// quanto em buscarMovimentosHistoricoBrutos (que nao mescla, so busca cru).
function dedupeMovimentosHistoricoPorChaveNatural<T extends { cod_prod: number; data: string }>(linhas: T[]): T[] {
  const vistos = new Set<string>()
  const unicas: T[] = []
  for (const l of linhas) {
    const chave = `${l.cod_prod}|${l.data}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    unicas.push(l)
  }
  return unicas
}

// Achado real (auditoria 2026-07-19): /movimentos_historico tem o MESMO
// limite fixo de 5000 no servidor -- sem paginacao, lojas com 66mil a
// 110mil linhas (loja 5: 109819) vinham cortadas em silencio. Servidor
// ganhou suporte a `offset`.
export async function complementarMovimentosHistorico<T extends { cod_prod: number; data: string }>(
  quentes: T[],
  opts: { lojaId: number; codProd?: number; dataInicio?: string; dataFinal?: string }
): Promise<T[]> {
  if (!foraDaJanelaQuente(opts.dataInicio)) return quentes
  const friasRaw = await buscarFrioTudo<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    cod_prod: opts.codProd,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  }, 5000)
  const frias = dedupeMovimentosHistoricoPorChaveNatural(friasRaw)
  const vistos = new Set(quentes.map((r) => `${r.cod_prod}|${r.data}`))
  return [...quentes, ...frias.filter((r) => !vistos.has(`${r.cod_prod}|${r.data}`))]
}

// Busca crua de nota_fiscal_items por periodo (sem mesclar) -- usada quando o
// caller precisa dos campos nf_d_emissao_nfe/nf_c_numero_nfe/nf_c_natureza_operacao
// do join que o endpoint /nota_fiscal_items ja faz internamente (ex: MovimentosTab).
export async function buscarFrioNotaFiscalItems<T>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  return buscarFrioTudo<T>('/nota_fiscal_items', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  }, 5000)
}

// O endpoint /movimentos_historico do ntb-frio-api (server.js, fora deste repo --
// ver AGENTS.md) roda "order by data desc limit 5000" SEM paginacao (sem offset/
// cursor). Achado real (auditoria 2026-07-18): pra lojas/periodos com mais de 5000
// linhas no recorte frio, o endpoint devolvia silenciosamente so os dias mais
// recentes (os 5000 primeiros da ordenacao DESC) -- meses inteiros do inicio do
// periodo pedido desapareciam da tela de Movimentacao sem erro nem aviso (ex:
// pedido jan-jul/2026 devolvia so linhas de mar/abr, sumindo com jan/fev/mai/jun/jul
// do lado frio). addDias/bisecta o intervalo de data recursivamente sempre que um
// lote vier "no teto" (>= 5000), ate cada pedaco vir abaixo do teto -- mesmo
// principio de paginacao do rpcTodos/selTodos (RPC/PostgREST), so que aqui a
// "pagina" e um recorte de datas, ja que o endpoint não aceita offset.
const LIMITE_CONTABO_SEM_PAGINACAO = 5000

function addDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

async function buscarMovimentosHistoricoBrutosSemDedupe<T>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  const lote = (await buscarFrio<T>('/movimentos_historico', {
    loja_id: opts.lojaId,
    data_inicio: opts.dataInicio,
    data_final: opts.dataFinal,
  })) ?? []
  if (lote.length < LIMITE_CONTABO_SEM_PAGINACAO || opts.dataInicio >= opts.dataFinal) return lote
  const diasTotais = Math.round(
    (new Date(`${opts.dataFinal}T00:00:00Z`).getTime() - new Date(`${opts.dataInicio}T00:00:00Z`).getTime()) / 86400000
  )
  const meio = addDias(opts.dataInicio, Math.floor(diasTotais / 2))
  if (meio <= opts.dataInicio) return lote // 1 dia so e ja bateu o teto -- nao da pra bisectar mais
  const [a, b] = await Promise.all([
    buscarMovimentosHistoricoBrutosSemDedupe<T>({ ...opts, dataFinal: meio }),
    buscarMovimentosHistoricoBrutosSemDedupe<T>({ ...opts, dataInicio: addDias(meio, 1) }),
  ])
  return [...a, ...b]
}

// Usado so pelo caso especial do relatorio-movimentacao: busca linhas cruas
// sem mesclar com nada, pra agregacao acontecer em JS. Dedupe por chave
// natural (ver dedupeMovimentosHistoricoPorChaveNatural acima) aplicado uma
// unica vez aqui, depois de toda a bisecao terminar -- os pedacos bisectados
// nao se sobrepoem em data, entao duplicatas so existem DENTRO de cada
// pedaco, nunca entre eles, mas dedupar so no final evita qualquer duvida.
export async function buscarMovimentosHistoricoBrutos<T extends { cod_prod: number; data: string }>(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<T[]> {
  const bruto = await buscarMovimentosHistoricoBrutosSemDedupe<T>(opts)
  return dedupeMovimentosHistoricoPorChaveNatural(bruto)
}

export type LinhaMovHistoricoBruta = {
  loja_id: number
  cod_prod: number
  codigo: string | null
  descricao: string | null
  data: string
  entradas: number
  saidas: number
}

type MetaProduto = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }

// Reimplementa em JS o mesmo agrupamento da funcao SQL relatorio_movimentacao_matriz
// (supabase/migrations/066_relatorio_movimentacao_filtros.sql) -- usada so para a fracao
// da consulta que caiu fora da janela quente, ja que produtos (join da funcao SQL)
// nao pode ser duplicado no Contabo. Se a funcao SQL mudar de novo, replicar aqui tambem.
export function agregarMovimentacaoJS(
  linhas: LinhaMovHistoricoBruta[],
  metaPorCodigo: Map<number, MetaProduto>,
  precoPorProduto: Map<number, number>,
  dim: 'tipo' | 'familia' | 'produto',
  sentido: 'entradas' | 'saidas'
): { rotulo: string; mes: string; qtde: number; valor: number }[] {
  const grupos = new Map<string, { rotulo: string; mes: string; qtde: number; valor: number }>()
  for (const l of linhas) {
    const meta = metaPorCodigo.get(l.cod_prod)
    const rotulo =
      (dim === 'tipo' ? meta?.tipo_item : dim === 'familia' ? meta?.descricao_familia : l.descricao) ||
      'Sem classificação'
    const mes = l.data.slice(0, 7)
    // Number() e essencial: entradas/saidas sao `numeric` no Postgres, e o
    // driver `pg` do lado do servidor Contabo so normaliza bigint/date (ver
    // AGENTS.md) -- numeric chega como STRING. Sem isso, "+=" concatena
    // string em vez de somar (achado real: coluna de mes virando um numero
    // com 50+ digitos na tela de Movimentacao).
    const qtde = Number(sentido === 'entradas' ? l.entradas : l.saidas) || 0
    if (!qtde) continue
    const preco = precoPorProduto.get(l.cod_prod) ?? 0
    // JSON.stringify em vez de "|": rotulo vem de descricao de produto sem
    // sanitizacao, um "|" no nome colidiria 2 chaves diferentes (mesmo
    // achado ja corrigido em lib/omie/faturamento.ts).
    const chave = JSON.stringify([rotulo, mes])
    const acc = grupos.get(chave) ?? { rotulo, mes, qtde: 0, valor: 0 }
    acc.qtde += qtde
    acc.valor += qtde * preco
    grupos.set(chave, acc)
  }
  return [...grupos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.mes.localeCompare(b.mes))
}

// Aplica o mesmo filtro de cod_prod / produto que a RPC relatorio_movimentacao_matriz
// aplica no lado quente (p_cod_prods / p_produto, ver migration 066) --
// buscarMovimentosHistoricoBrutos traz TODAS as linhas da loja sem filtro (Contabo
// nao cruza com `produtos`), entao o caller precisa filtrar em JS antes de agregar.
// Achado real (auditoria 2026-07-18): sem isso, um filtro de tipo/familia/local/
// produto ficava sem efeito na fatia >90 dias -- a matriz e o Excel exibiam
// centenas de produtos não relacionados ao filtro sempre que o período pedido
// cruzava a janela quente.
export function filtrarLinhasMovHistorico<
  T extends { cod_prod: number; codigo: string | null; descricao: string | null },
>(linhas: T[], codigosPermitidos: number[] | null, produtoBusca: string | null): T[] {
  let out = linhas
  if (codigosPermitidos !== null) {
    const permitidos = new Set(codigosPermitidos)
    out = out.filter((l) => permitidos.has(l.cod_prod))
  }
  if (produtoBusca) {
    const termo = produtoBusca.toLowerCase()
    out = out.filter(
      (l) => (l.descricao ?? '').toLowerCase().includes(termo) || (l.codigo ?? '').toLowerCase().includes(termo)
    )
  }
  return out
}

export { limiteJanelaQuente, foraDaJanelaQuente }
