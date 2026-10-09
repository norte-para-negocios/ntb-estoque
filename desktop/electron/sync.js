// Motor de sincronização do app desktop.
//  - Primeira carga: snapshot das tabelas permitidas (lojas do usuário) + fato de faturamento.
//  - Pull a cada 20 s (log compactado do servidor), "fotos" a cada 10 min, faturamento a cada 15 min.
//  - Ações: com internet vão ao servidor na hora; sem internet entram na fila (FIFO) e são
//    reenviadas na volta, com ids provisórios trocados pelos reais; depois a reconciliação apaga o
//    que foi feito localmente e traz a versão do servidor.
const { ErroRede, ErroSessao, ErroVersao } = require('./remoto')
const aplicar = require('./aplicar')
const { ehProvisorio, reescreverIds } = require('./compartilhado/ids-provisorios')
const { parear } = require('./compartilhado/pareamento')

const INTERVALO_PULL = 20_000
const INTERVALO_FOTO = 10 * 60_000
const INTERVALO_FRIO = 15 * 60_000
const JANELA_FRIO_DIAS = 40
const TABELAS_FRIO = ['fat_cupons', 'fat_cupom_itens', 'fat_cupom_pagamentos']

function criarSync({ banco, remoto, cofre, fila, log = () => {}, aoMudarEstado = () => {} }) {
  let pool = null // conexão única para o motor (aplicações são sequenciais)
  let poolFrio = null
  let online = null // null = ainda não tentou falar com o servidor
  let ultimaSync = null
  let ultimoErro = null
  let carga = { pronta: true, fase: null, pct: 100 }
  let timers = []
  let cadeia = Promise.resolve() // serializa pull/fila/carga
  let ultimoFoto = 0
  let ultimoFrio = 0

  const emSerie = (fn) => {
    const p = cadeia.then(fn, fn)
    cadeia = p.catch(() => {})
    return p
  }

  // Conexão que cai (banco reiniciado, encerramento) é descartada e reaberta na próxima vez.
  function vigiar(c, limpar) {
    c.on('error', (e) => {
      log(`conexão local caiu: ${e.message}`)
      limpar()
    })
    return c
  }
  async function conexao() {
    if (!pool) pool = vigiar(await banco.conectar('estoque'), () => { pool = null })
    return pool
  }
  async function conexaoFrio() {
    if (!poolFrio) poolFrio = vigiar(await banco.conectar('frio'), () => { poolFrio = null })
    return poolFrio
  }
  async function fecharConexoes() {
    for (const c of [pool, poolFrio]) await c?.end().catch(() => {})
    pool = null
    poolFrio = null
  }

  async function meta(chave, valor) {
    const c = await conexao()
    if (valor === undefined) return (await c.query('select valor from ntb_local.meta where chave = $1', [chave])).rows[0]?.valor ?? null
    await c.query(
      'insert into ntb_local.meta values ($1, $2) on conflict (chave) do update set valor = excluded.valor',
      [chave, JSON.stringify(valor)],
    )
  }

  function lojasSync() {
    return cofre.ler('lojasSync') ?? []
  }

  function marcar(ok, erro) {
    online = ok
    if (ok) {
      ultimaSync = new Date().toISOString()
      ultimoErro = null
    } else if (erro) ultimoErro = erro
    aoMudarEstado()
  }

  async function chamar(fn) {
    try {
      const r = await fn()
      marcar(true)
      return r
    } catch (e) {
      if (e instanceof ErroRede) marcar(false, 'Sem internet')
      else if (e instanceof ErroSessao) marcar(false, 'Sessão expirada: saia e entre de novo com internet')
      else if (e instanceof ErroVersao) marcar(false, e.message)
      throw e
    }
  }

  // ---------------- carga inicial ----------------
  async function baixarTabela(c, tabela, lojas, progresso) {
    let depois = null
    let total = 0
    for (;;) {
      const qs = new URLSearchParams({ tabela, limite: '1000' })
      if (depois) qs.set('depois', JSON.stringify(depois))
      const { json } = await chamar(() => remoto.get(`/api/offline/snapshot?${qs}`, { headers: lojas ? { 'x-ntb-lojas': lojas.join(',') } : {} }))
      if (!json.ok) throw new Error(`snapshot ${tabela}: ${json.erro}`)
      await c.query('begin')
      try {
        await aplicar.modoAplicacao(c)
        total += await aplicar.upsert(c, tabela, json.linhas)
        await c.query('commit')
      } catch (e) {
        await c.query('rollback')
        throw e
      }
      progresso?.(total)
      if (json.fim || !json.depois) break
      depois = json.depois
    }
    return total
  }

  async function primeiraCarga({ lojas = null } = {}) {
    const c = await conexao()
    const { json: info } = await chamar(() => remoto.get('/api/offline/tabelas', { headers: lojas ? { 'x-ntb-lojas': lojas.join(',') } : {} }))
    if (!info.ok) throw new Error(info.erro)
    await meta('tabelas', info.tabelas)
    const cursorInicial = info.cursor
    const feitas = new Set((lojas ? [] : (await meta('carga_feitas'))) ?? [])
    const lista = info.tabelas.map((t) => t.tabela)
    let i = 0
    for (const tabela of lista) {
      i++
      if (feitas.has(tabela)) continue
      carga = { pronta: false, fase: `Baixando ${tabela}`, pct: Math.round((i / (lista.length + 1)) * 100) }
      aoMudarEstado()
      const n = await baixarTabela(c, tabela, lojas, (tot) => {
        carga = { ...carga, fase: `Baixando ${tabela} (${tot.toLocaleString('pt-BR')})` }
        aoMudarEstado()
      })
      log(`carga ${tabela}: ${n}`)
      if (!lojas) {
        feitas.add(tabela)
        await meta('carga_feitas', [...feitas])
      }
    }
    carga = { pronta: false, fase: 'Baixando faturamento', pct: 97 }
    aoMudarEstado()
    for (const loja of lojas ?? lojasSync()) await frioLoja(loja, null)
    if (!lojas) {
      await meta('cursor', cursorInicial)
      await meta('carga_completa', true)
      await meta('carga_feitas', [])
    }
    ultimoFoto = Date.now()
    ultimoFrio = Date.now()
    carga = { pronta: true, fase: null, pct: 100 }
    aoMudarEstado()
  }

  // ---------------- pull ----------------
  async function puxar() {
    const c = await conexao()
    let cursor = Number((await meta('cursor')) ?? 0)
    const tabelasLocais = new Set(((await meta('tabelas')) ?? []).map((t) => t.tabela))
    for (let voltas = 0; voltas < 50; voltas++) {
      const { json } = await chamar(() => remoto.post('/api/offline/mudancas', { cursor }))
      if (!json.ok) throw new Error(json.erro)
      if (json.refazer) {
        log('cursor abaixo do piso: refazendo a carga')
        await meta('carga_completa', false)
        await primeiraCarga()
        return
      }
      if (json.mudancas.length) {
        await c.query('begin')
        try {
          await aplicar.modoAplicacao(c)
          const porTabela = new Map()
          for (const m of json.mudancas) {
            if (!tabelasLocais.has(m.tabela)) continue
            const g = porTabela.get(m.tabela) ?? { upsert: [], apagar: [] }
            if (m.apagado) g.apagar.push(m.pk)
            else if (m.dado) g.upsert.push(m.dado)
            porTabela.set(m.tabela, g)
          }
          for (const [t, g] of porTabela) {
            await aplicar.apagar(c, t, g.apagar)
            await aplicar.upsert(c, t, g.upsert)
          }
          await c.query(
            "insert into ntb_local.meta values ('cursor', $1) on conflict (chave) do update set valor = excluded.valor",
            [JSON.stringify(json.cursor)],
          )
          await c.query('commit')
        } catch (e) {
          await c.query('rollback')
          throw e
        }
      }
      cursor = json.cursor
      // Loja atual mudou para uma que ainda não está no computador: baixa só ela.
      if (json.lojaAtual && !lojasSync().includes(json.lojaAtual)) {
        cofre.gravar('lojasSync', [...lojasSync(), json.lojaAtual].sort((a, b) => a - b))
        log(`loja nova no computador: ${json.lojaAtual}`)
        await primeiraCarga({ lojas: [json.lojaAtual] })
      }
      if (!json.mais) break
    }
  }

  async function fotos() {
    const c = await conexao()
    const tabelas = ((await meta('tabelas')) ?? []).filter((t) => t.modo === 'foto')
    for (const t of tabelas) {
      const linhas = []
      let depois = null
      for (;;) {
        const qs = new URLSearchParams({ tabela: t.tabela, limite: '1000' })
        if (depois) qs.set('depois', JSON.stringify(depois))
        const { json } = await chamar(() => remoto.get(`/api/offline/snapshot?${qs}`))
        if (!json.ok) throw new Error(json.erro)
        linhas.push(...json.linhas)
        if (json.fim || !json.depois) break
        depois = json.depois
      }
      await c.query('begin')
      try {
        await aplicar.modoAplicacao(c)
        await c.query(`delete from public."${t.tabela}" where loja_id = any($1)`, [lojasSync()])
        await aplicar.upsert(c, t.tabela, linhas)
        await c.query('commit')
      } catch (e) {
        await c.query('rollback')
        throw e
      }
    }
    ultimoFoto = Date.now()
  }

  // Fato de faturamento: banco "frio" local. desde = null baixa tudo da loja.
  async function frioLoja(loja, desde) {
    const f = await conexaoFrio()
    const dados = {}
    for (const tabela of TABELAS_FRIO) {
      dados[tabela] = []
      let depois = null
      for (;;) {
        const qs = new URLSearchParams({ tabela, loja: String(loja) })
        if (desde) qs.set('desde', desde)
        if (depois) qs.set('depois', JSON.stringify(depois))
        const { json } = await chamar(() => remoto.get(`/api/offline/frio?${qs}`, { timeoutMs: 180_000 }))
        if (!json.ok) throw new Error(`frio ${tabela}: ${json.erro}`)
        dados[tabela].push(...json.linhas)
        if (json.fim || !json.depois) break
        depois = json.depois
      }
    }
    await f.query('begin')
    try {
      if (desde) {
        await f.query(
          'delete from fat_cupom_itens i using fat_cupons c where c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom and i.loja_id = $1 and c.data >= $2',
          [loja, desde],
        )
        await f.query(
          'delete from fat_cupom_pagamentos p using fat_cupons c where c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom and p.loja_id = $1 and c.data >= $2',
          [loja, desde],
        )
        await f.query('delete from fat_cupons where loja_id = $1 and data >= $2', [loja, desde])
      } else {
        for (const t of TABELAS_FRIO) await f.query(`delete from ${t} where loja_id = $1`, [loja])
      }
      for (const t of TABELAS_FRIO) await aplicar.upsert(f, t, dados[t])
      await f.query('commit')
    } catch (e) {
      await f.query('rollback')
      throw e
    }
  }

  async function frio() {
    const desde = new Date(Date.now() - JANELA_FRIO_DIAS * 86400_000).toISOString().slice(0, 10)
    for (const loja of lojasSync()) await frioLoja(loja, desde)
    ultimoFrio = Date.now()
  }

  // ---------------- ações ----------------
  async function enviar(item) {
    for (let espera = 0; espera < 30; espera++) {
      const r = await chamar(() =>
        remoto.post('/api/offline/acao', { intentId: item.intentId, acao: item.acao, args: item.args }, {
          headers: { 'x-ntb-desktop': '1', 'x-ntb-refresh': 'nao-usar' },
          timeoutMs: 300_000,
        }),
      )
      if (r.status === 409 && r.json.tipo === 'processando') {
        await new Promise((ok) => setTimeout(ok, 2000))
        continue
      }
      return r
    }
    throw new ErroRede('servidor ocupado')
  }

  function pendentes() {
    return fila.itens().filter((i) => i.estado === 'pendente' || i.estado === 'aguardando_local')
  }

  async function executarAcao({ intentId, acao, args, modo }) {
    return emSerie(async () => {
      // Ação nova nunca passa na frente da fila (pode depender do que está nela).
      if (pendentes().length) {
        try {
          await enviarFila()
        } catch {
          // sem internet: segue para o caminho offline
        }
      }
      const reescrito = reescreverIds(args, fila.mapa())
      const temFila = pendentes().length > 0
      if (!temFila && remoto.temSessao()) {
        if (reescrito.faltando.length) {
          return { tipo: 'erro', erro: 'Esta operação depende de uma feita sem internet que não foi aceita pelo servidor. Veja em Sincronização.' }
        }
        try {
          const r = await enviar({ intentId, acao, args: reescrito.json })
          if (r.json.tipo === 'versao') return { tipo: 'erro', erro: r.json.erro }
          await puxar().catch((e) => log(`pull depois da ação: ${e.message}`))
          return { tipo: 'remoto', resultado: r.json }
        } catch (e) {
          if (e instanceof ErroVersao) return { tipo: 'erro', erro: e.message }
          if (e instanceof ErroSessao) return { tipo: 'erro', erro: 'Sua sessão expirou. Saia e entre de novo com internet.' }
          if (!(e instanceof ErroRede)) throw e
        }
      }
      // Sem internet (ou fila ainda com pendências)
      if (modo === 'local') {
        fila.incluir({ intentId, acao, args: reescrito.json, modo, estado: 'aguardando_local' })
        aoMudarEstado()
        return { tipo: 'executar_local' }
      }
      if (modo === 'fila') {
        fila.incluir({ intentId, acao, args: reescrito.json, modo, estado: 'pendente' })
        aoMudarEstado()
        return { tipo: 'enfileirado' }
      }
      return { tipo: 'erro', erro: temFila && online ? 'Aguarde: o app ainda está enviando as operações feitas sem internet.' : 'Sem internet. Esta ação precisa de conexão.' }
    })
  }

  async function resultadoLocal({ intentId, ok, valor, erro }) {
    const it = fila.achar(intentId)
    if (!it) return
    if (!ok) {
      log(`ação local falhou (${it.acao}): ${erro}`)
      fila.remover(intentId)
    } else {
      fila.atualizar(intentId, { estado: 'pendente', resultadoLocal: valor })
    }
    aoMudarEstado()
  }

  async function enviarFila() {
    const c = await conexao()
    for (const it of [...fila.itens()]) {
      // FIFO: uma ação ainda rodando no banco local segura as seguintes.
      if (it.estado === 'aguardando_local') break
      if (it.estado !== 'pendente') continue
      const { json: args, faltando } = reescreverIds(it.args, fila.mapa())
      if (faltando.length) {
        fila.atualizar(it.intentId, { estado: 'erro', erro: 'Depende de uma operação anterior que não foi aceita pelo servidor.' })
        continue
      }
      let r
      try {
        r = await enviar({ ...it, args })
      } catch (e) {
        if (e instanceof ErroRede || e instanceof ErroSessao || e instanceof ErroVersao) throw e
        fila.atualizar(it.intentId, { estado: 'erro', erro: e.message, tentativas: (it.tentativas ?? 0) + 1 })
        continue
      }
      const res = r.json
      if (res.tipo === 'em_andamento') {
        fila.atualizar(it.intentId, { estado: 'verificar', erro: res.erro })
        continue
      }
      if (!res.ok || r.status >= 400) {
        fila.atualizar(it.intentId, { estado: 'erro', erro: res.erro ?? `Recusado pelo servidor (${r.status}).` })
        continue
      }
      if (it.modo === 'local') {
        const locais = (await c.query(
          "select tabela, pk from ntb_local.alteracoes where intent_id = $1 and op = 'INSERT' order by seq",
          [it.intentId],
        )).rows
        // Tabelas que só existem no computador (audit_log etc.) não voltam do servidor: fora do pareamento.
        const sincronizadas = new Set(((await meta('tabelas')) ?? []).map((t) => t.tabela))
        const { mapa, divergentes } = parear(locais.filter((l) => sincronizadas.has(l.tabela)), res.criados ?? [])
        fila.somarMapa(mapa)
        if (divergentes.length) log(`pareamento divergente em ${it.acao}: ${divergentes.join(', ')}`)
      }
      fila.remover(it.intentId)
      aoMudarEstado()
    }
  }

  async function reconciliar() {
    const c = await conexao()
    const rows = (await c.query('select tabela, pk, max(seq) as seq from ntb_local.alteracoes group by tabela, pk')).rows
    if (!rows.length) return
    const maxSeq = Math.max(...rows.map((r) => Number(r.seq)))
    const sincronizadas = new Set(((await meta('tabelas')) ?? []).map((t) => t.tabela))
    const porTabela = new Map()
    for (const r of rows) porTabela.set(r.tabela, [...(porTabela.get(r.tabela) ?? []), r.pk])
    const atuais = []
    const itens = []
    for (const [tabela, pks] of porTabela) {
      if (!sincronizadas.has(tabela)) continue
      const reais = pks.filter((pk) => !Object.values(pk).some((v) => typeof v === 'number' && ehProvisorio(v)))
      for (let j = 0; j < reais.length; j += 1000) itens.push({ tabela, pks: reais.slice(j, j + 1000) })
    }
    for (let i = 0; i < itens.length; i += 50) {
      const { json } = await chamar(() => remoto.post('/api/offline/linhas', { itens: itens.slice(i, i + 50) }))
      if (!json.ok) throw new Error(json.erro)
      atuais.push(...json.linhas)
    }
    await c.query('begin')
    try {
      await aplicar.modoAplicacao(c)
      for (const [tabela, pks] of porTabela) {
        const prov = pks.filter((pk) => Object.values(pk).some((v) => typeof v === 'number' && ehProvisorio(v)))
        await aplicar.apagar(c, tabela, prov)
        if (!sincronizadas.has(tabela)) continue
        const destaTabela = atuais.filter((a) => a.tabela === tabela)
        await aplicar.apagar(c, tabela, destaTabela.filter((a) => !a.dado).map((a) => a.pk))
        await aplicar.upsert(c, tabela, destaTabela.filter((a) => a.dado).map((a) => a.dado))
      }
      await c.query('delete from ntb_local.alteracoes where seq <= $1', [maxSeq])
      await c.query('commit')
    } catch (e) {
      await c.query('rollback')
      throw e
    }
    log(`reconciliadas ${rows.length} linhas`)
  }

  // ---------------- ciclo ----------------
  async function ciclo() {
    if (!remoto.temSessao() || !cofre.ler('usuario')) return
    await emSerie(async () => {
      try {
        if (!(await meta('carga_completa'))) {
          await primeiraCarga()
        }
        if (pendentes().length) await enviarFila()
        if (!pendentes().length && fila.itens().every((i) => i.estado !== 'aguardando_local')) {
          await reconciliar()
          if (!fila.itens().length) fila.limpar()
        }
        await puxar()
        if (Date.now() - ultimoFoto > INTERVALO_FOTO) await fotos()
        if (Date.now() - ultimoFrio > INTERVALO_FRIO) await frio()
      } catch (e) {
        if (!(e instanceof ErroRede || e instanceof ErroSessao || e instanceof ErroVersao)) {
          ultimoErro = e.message
          log(`sync: ${e.stack ?? e.message}`)
          aoMudarEstado()
        }
        if (!(await meta('carga_completa').catch(() => false))) {
          carga = { pronta: false, fase: online ? `Erro na carga: ${e.message}` : 'Sem internet: a primeira carga continua quando a conexão voltar', pct: carga.pct }
          aoMudarEstado()
        }
      }
    })
  }

  async function iniciar() {
    const completa = await meta('carga_completa')
    carga = completa ? { pronta: true, fase: null, pct: 100 } : { pronta: false, fase: 'Aguardando login', pct: 0 }
    timers.push(setInterval(() => ciclo(), INTERVALO_PULL))
    setTimeout(() => ciclo(), 1000)
  }

  function parar() {
    timers.forEach(clearInterval)
    timers = []
    fecharConexoes()
  }

  return {
    iniciar,
    parar,
    agora: () => ciclo(),
    executarAcao,
    resultadoLocal,
    aoEntrar({ lojas, lojaAtual }) {
      const conj = new Set([...(lojas ?? []), ...(lojaAtual ? [lojaAtual] : [])])
      if (!lojasSync().length) cofre.gravar('lojasSync', [...conj].sort((a, b) => a - b))
      if (!carga.pronta) carga = { pronta: false, fase: 'Preparando', pct: 1 }
      setTimeout(() => ciclo(), 100)
    },
    temPendencias: () => fila.itens().length > 0,
    async trocarUsuario() {
      await emSerie(async () => {
        await fecharConexoes()
        await banco.recriar()
        aplicar.limparCache()
        fila.limpar()
        cofre.apagarUsuario()
        cofre.gravar('lojasSync', undefined)
        carga = { pronta: false, fase: 'Preparando', pct: 0 }
      })
    },
    async apagarTudo() {
      await this.trocarUsuario()
      return { ok: true }
    },
    async descartar(intentId) {
      const it = fila.achar(intentId)
      if (!it || it.estado === 'aguardando_local') return { ok: false }
      fila.remover(intentId)
      aoMudarEstado()
      setTimeout(() => ciclo(), 100)
      return { ok: true }
    },
    fila: () => fila.itens().map(({ intentId, acao, estado, erro, criadoEm, modo }) => ({ intentId, acao, estado, erro, criadoEm, modo })),
    status: () => ({
      online,
      ultimaSync,
      erro: ultimoErro,
      pendentes: pendentes().length,
      comErro: fila.itens().filter((i) => i.estado === 'erro' || i.estado === 'verificar').length,
      carga,
      logado: Boolean(cofre.ler('usuario')),
    }),
  }
}

module.exports = { criarSync }
