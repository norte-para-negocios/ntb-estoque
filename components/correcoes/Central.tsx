'use client'

// Central de correções (14/10/2026): hero com o progresso do dia, "Comece por aqui", grupos colapsáveis com busca,
// ordem e filtro, o que o robô fez e o painel universal. Desenho do protótipo aprovado; regras em
// lib/correcoes/central-puro.ts; dados do servidor em lib/correcoes/dados.ts.
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import s from './central.module.css'
import { Ic } from './icones'
import { Painel, chaveAlvo, type Entrada } from './Painel'
import { StatusPill, type Feito } from './CorrecaoGuiada'
import {
  GRUPOS, filtrarGrupo, fmtBRLCurto, fmtData, fmtDataLonga, resumoDoDia, comecePorAqui,
  type Alvo, type Grupo, type ProblemaComEstado, type UIGrupo,
} from '@/lib/correcoes/central-puro'
import type { DadosCentral } from '@/lib/correcoes/dados'
import type { PainelDados } from '@/lib/correcoes/painel-dados'
import { carregarPainel, lancarOPCorrecao, marcarEstadoProblema } from '@/lib/actions/central'
import { ehLimiteOmie } from '@/lib/estoque/escrita-omie-puro'

const UI_PADRAO: UIGrupo & { limite: number } = { q: '', ordem: 'valor', filtro: 'aberto', limite: 6 }
const sev = (v: number, g: Grupo): [string, string] =>
  g === 'taxa' || g === 'semcusto' ? ['var(--text-muted)', g === 'taxa' ? 'Sem valor' : 'Afeta margem'] : v >= 20000 ? ['var(--err)', 'Pesa muito'] : v >= 1000 ? ['var(--warn)', 'Pesa médio'] : ['var(--ok)', 'Pesa pouco']
const valorTxt = (v: number) => (v > 0 ? fmtBRLCurto(v) : '—')
const MOTIVO_ROBO: Record<string, string> = { ok: 'Corrigido', falhou: 'Falhou', parado: 'Parado', pendente_decisao: 'Aguardando decisão', desfeito: 'Desfeito' }

function Tag({ p }: { p: ProblemaComEstado['p'] }) {
  const cls = p.tag === 'Risco' ? s.tagRisco : p.tag === 'Sobrando' ? s.tagSobra : ''
  return <span className={`${s.tag} ${cls}`}>{p.tag}</span>
}

export function Central({ dados }: { dados: DadosCentral }) {
  const router = useRouter()
  const [over, setOver] = React.useState<Record<string, Feito>>({})
  React.useEffect(() => { setOver({}) }, [dados])
  const itens = React.useMemo<ProblemaComEstado[]>(() => dados.itens.map((x) => {
    const o = over[x.p.chave]
    if (!o) return x
    return { p: x.p, e: { estado: o.estado, reaberto: null, reg: o.estado === 'aberto' ? null : { chave: o.chave, estado: o.estado, motivo: o.motivo ?? null, mensagem: o.mensagem ?? null, acao: o.acao, ate: o.ate ?? null, assinatura: x.p.assinatura, user_nome: 'você', atualizado_em: new Date().toISOString() } } }
  }), [dados.itens, over])
  const resumo = React.useMemo(() => resumoDoDia(itens, dados.resumo.resolvidos - dados.itens.filter((x) => x.e.estado === 'resolvido').length), [itens, dados])
  const comece = React.useMemo(() => comecePorAqui(itens), [itens])
  const nome = React.useCallback((c: number) => dados.produtos[c]?.nome ?? `Produto ${c}`, [dados.produtos])
  const cmc = React.useCallback((c: number) => { const v = dados.produtos[c]?.cmc ?? 0; return v > 0 && v < 1000 ? v : 0 }, [dados.produtos])

  // Grupos: aberto/fechado guardado no navegador (só conveniência).
  const chaveLS = `central-correcoes:${dados.lojaId}`
  const [abertos, setAbertos] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    try { const x = JSON.parse(localStorage.getItem(chaveLS) ?? 'null'); if (x && typeof x === 'object') { setAbertos(x); return } } catch { /* sem armazenamento */ }
    if (dados.ordem[0]) setAbertos({ [dados.ordem[0]]: true })
  }, [chaveLS, dados.ordem])
  const alternar = (g: string, v?: boolean) => setAbertos((x) => { const n = { ...x, [g]: v ?? !x[g] }; try { localStorage.setItem(chaveLS, JSON.stringify(n)) } catch { /* ok */ } return n })
  const [ui, setUi] = React.useState<Record<string, typeof UI_PADRAO>>({})
  const uiG = (g: string) => ui[g] ?? UI_PADRAO
  const setUiG = (g: string, patch: Partial<typeof UI_PADRAO>) => setUi((x) => ({ ...x, [g]: { ...(x[g] ?? UI_PADRAO), ...patch } }))
  const irGrupo = (g: string) => { setPilha([]); alternar(g, true); setTimeout(() => document.getElementById(`g-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60) }

  // Painel.
  const [pilha, setPilha] = React.useState<Entrada[]>([])
  const [cache, setCache] = React.useState<Record<string, PainelDados | { error: string } | undefined>>({})
  const carregar = React.useCallback(async (a: { tipo: Alvo['tipo']; id: number }, forcar = false) => {
    const k = chaveAlvo(a)
    if (!forcar && cache[k] && !('error' in cache[k]!)) return
    setCache((c) => ({ ...c, [k]: forcar ? c[k] : undefined }))
    const r = await carregarPainel({ tipo: a.tipo, id: a.id })
    setCache((c) => ({ ...c, [k]: r }))
  }, [cache])
  const abrir = React.useCallback((a: Alvo, chave?: string, novo = false) => {
    setPilha((p) => {
      const topo = p[p.length - 1]
      if (!novo && topo && topo.tipo === a.tipo && topo.id === a.id) return [...p.slice(0, -1), { ...topo, prob: chave ?? topo.prob }]
      return [...(novo ? [] : p), { tipo: a.tipo, id: a.id, aba: 'resumo', q: '', prob: chave }]
    })
    void carregar(a)
  }, [carregar])
  const fechar = () => setPilha([])

  // Busca rápida global ("/" e ⌘K): na Central, abre o painel em vez de navegar.
  React.useEffect(() => {
    const h = (ev: Event) => {
      const det = (ev as CustomEvent<{ tipo: Alvo['tipo']; id: number }>).detail
      if (!det) return
      ev.preventDefault()
      const pb = itens.find((x) => x.p.alvo.tipo === det.tipo && x.p.alvo.id === det.id)
      abrir(det, pb?.p.chave, pilha.length === 0)
    }
    window.addEventListener('ntb:abrir-painel', h)
    return () => window.removeEventListener('ntb:abrir-painel', h)
  }, [itens, abrir, pilha.length])
  React.useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !pilha.length) return
      if (document.querySelector('[data-slot="busca-global"]')) return
      setPilha((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [pilha.length])

  // Toast.
  const [toast, setToast] = React.useState<{ txt: string; desfazer?: () => Promise<void> } | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mostrar = (txt: string, desfazer?: () => Promise<void>) => {
    setToast({ txt, desfazer })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 7000)
  }
  const onFeito = (f: Feito, txt: string, desfazer?: () => Promise<void>) => {
    setOver((o) => ({ ...o, [f.chave]: f }))
    mostrar(txt, desfazer ? async () => { await desfazer(); setOver((o) => ({ ...o, [f.chave]: { chave: f.chave, estado: 'aberto', acao: null } })); setToast(null); router.refresh() } : undefined)
    const topo = pilha[pilha.length - 1]
    if (topo) void carregar(topo, true)
    router.refresh()
  }

  const temGrupo = (g: Grupo) => itens.some((x) => x.p.grupo === g)
  const R = 50, L = 2 * Math.PI * R
  const arco = (n: number, off: number, cor: string) => <circle cx="58" cy="58" r={R} stroke={cor} strokeDasharray={`${(n / Math.max(1, resumo.total)) * L} ${L}`} strokeDashoffset={(-off * L) / Math.max(1, resumo.total)} />
  const feitos = resumo.resolvidos + resumo.ignorados
  const neg = (resumo.porGrupo.pa ?? 0) + (resumo.porGrupo.pi ?? 0) + (resumo.porGrupo.mp ?? 0)

  return (
    <div className={s.raiz}>
      {dados.isTest && <div className={s.teste}>Loja de teste: as correções que escrevem no Omie são simuladas (nada é enviado).</div>}
      {dados.avisos.length > 0 && <div className={s.avisos}>{dados.avisos.map((a) => <span key={a}>{a}</span>)}</div>}

      <section className={s.hero} aria-label="Resumo do dia">
        <div className={s.heroTxt}>
          <div className={s.eyebrow}>Saúde do estoque · {dados.lojaNome}</div>
          <h1>Central de correções</h1>
          <p className={s.lede}>{resumo.abertos === 0 ? 'Nada aberto. Os pedidos ao Ramon voltam para cá quando você reabrir.' : `${resumo.abertos} ${resumo.abertos === 1 ? 'ponto' : 'pontos'} para olhar. Os primeiros são os que mais distorcem o valor do estoque.`}</p>
          <div className={s.chips}>
            {([[neg, 'negativos', 'var(--err)', temGrupo('pa') ? 'pa' : temGrupo('pi') ? 'pi' : 'mp'], [resumo.porGrupo.custo ?? 0, 'custos fora do normal', 'var(--warn)', 'custo'], [resumo.porGrupo.op ?? 0, 'OPs abertas', 'var(--info)', 'op'], [resumo.porGrupo.cupom ?? 0, 'cupons sem OP', 'var(--brand)', 'cupom']] as const)
              .filter(([n]) => n > 0).map(([n, t, cor, g]) => <button key={t} className={s.chip} onClick={() => irGrupo(g)}><i style={{ background: cor }} /><span className={s.num}>{n}</span> {t}</button>)}
          </div>
        </div>
        <div className={s.progresso}>
          <div className={s.anel} role="img" aria-label={`${feitos} de ${resumo.total} resolvidos`}>
            <svg viewBox="0 0 116 116"><circle cx="58" cy="58" r={R} stroke="var(--surface-2)" />
              {resumo.resolvidos > 0 && arco(resumo.resolvidos, 0, 'var(--brand)')}
              {resumo.ignorados > 0 && arco(resumo.ignorados, resumo.resolvidos, 'var(--text-muted)')}
              {resumo.ramon > 0 && arco(resumo.ramon, feitos, 'var(--warn)')}
            </svg>
            <div className={s.meio}><div><b className={s.num}>{feitos}</b><span>de {resumo.total}</span></div></div>
          </div>
          <div className={s.progTxt}>
            <div className={s.linha1}>{resumo.total === 0 ? 'Nada para corrigir' : feitos === resumo.total ? 'Tudo revisado hoje' : feitos === 0 ? 'Nenhum resolvido ainda hoje' : `${feitos} de ${resumo.total} resolvidos hoje`}</div>
            <div className={s.legenda}>
              <span><i className={s.dot} style={{ background: 'var(--brand)' }} />{resumo.resolvidos} {resumo.resolvidos === 1 ? 'resolvido' : 'resolvidos'}</span>
              <span><i className={s.dot} style={{ background: 'var(--warn)' }} />{resumo.ramon} esperando Ramon</span>
              <span><i className={s.dot} style={{ background: 'var(--text-muted)' }} />{resumo.ignorados} {resumo.ignorados === 1 ? 'ignorado' : 'ignorados'}</span>
            </div>
            <div className={s.emjogo}>Ainda em aberto: <b className={s.num}>{fmtBRLCurto(resumo.emAberto)}</b></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="tComece">
        <div className={s.secTit}><h2 id="tComece">Comece por aqui</h2><span>Os 3 que mais pesam em reais</span></div>
        <div className={s.comece}>
          {comece.length === 0 ? (
            <div className={s.card} style={{ gridColumn: '1 / -1' }}><div className={s.vazio} style={{ padding: 6 }}><div className={`${s.vazioIc} ${s.pop}`}><Ic n="check" /></div><div><b>Nada urgente agora.</b><span>Tudo o que pesava em reais já foi tratado.</span></div></div></div>
          ) : comece.map((p, i) => (
            <button key={p.chave} className={`${s.card} ${s.entra}`} style={{ animationDelay: `${i * 40}ms` }} onClick={() => abrir(p.alvo, p.chave, true)}>
              <div className={s.cardTopo}><span className={s.cardN}>{i + 1}º · {GRUPOS[p.grupo].nome}</span><Tag p={p} /></div>
              <div className={s.cardNome}>{p.titulo}</div>
              <div className={s.cardCausa}>{p.causa}</div>
              <div className={s.cardRodape}><span><span className={`${s.cardValor} ${s.num}`}>{valorTxt(p.valor)}</span> <span className={s.muted}>{p.valorRotulo}</span></span><span className={s.linkAcao}>Corrigir <Ic n="chev" sm /></span></div>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="tGrupos">
        <div className={s.secTit}><h2 id="tGrupos">Tudo o que precisa de olhar</h2><span>Do maior para o menor valor</span></div>
        <div className={s.grupos}>
          {dados.ordem.length === 0 && <div className={s.grupo}><div className={s.vazio}><div className={s.vazioIc}><Ic n="check" /></div><div><b>Tudo certo.</b><span>Nenhum problema encontrado no estoque desta loja.</span></div></div></div>}
          {dados.ordem.map((g) => (
            <GrupoBloco key={g} g={g} itens={itens} u={uiG(g)} setU={(x) => setUiG(g, x)} aberto={!!abertos[g]} alternar={() => alternar(g)}
              ativo={pilha[pilha.length - 1]?.prob} abrir={(p) => abrir(p.alvo, p.chave, true)}
              extra={g === 'cupom' ? <FaixaCupons dados={dados} itens={itens} podeExecutar={dados.podeExecutar} onFim={(n) => { mostrar(n); router.refresh() }} /> : null} />
          ))}
        </div>
      </section>

      {dados.robo.length > 0 && (
        <section aria-labelledby="tRobo">
          <div className={s.secTit}><h2 id="tRobo">Feito pelo robô</h2><span>Últimos 7 dias · <a href="/correcoes" className={s.doc}>ver tudo</a></span></div>
          <div className={s.robo}>
            {dados.robo.slice(0, 12).map((r) => {
              const cod = Object.entries(dados.roboPorProduto).find(([, idx]) => idx.includes(dados.robo.indexOf(r)))?.[0]
              const prob = cod ? itens.find((x) => x.p.d.produto === Number(cod)) : undefined
              return (
                <div key={r.id} className={s.roboLinha}>
                  <span><b>{r.acao}</b> · {r.produto_desc ?? r.produto_cod}{prob && <> · <button className={s.doc} onClick={() => abrir(prob.p.alvo, prob.p.chave, true)}>problema ligado ›</button></>}</span>
                  <span className={r.status === 'ok' ? s.ok : r.status === 'falhou' ? s.err : s.warn}>{MOTIVO_ROBO[r.status] ?? r.status}</span>
                  <small>{fmtDataLonga(r.data_ref)}{r.de_valor != null || r.para_valor != null ? ` · ${r.de_valor ?? '—'} → ${r.para_valor ?? '—'}` : ''}{r.motivo ? ` · ${r.motivo}` : ''}</small>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className={s.rodapePag}><span>Saldo = soma dos locais na última leitura do Omie. Valor = quantidade × custo de referência (custo médio normal, ou o custo pela ficha).</span></div>

      <Painel pilha={pilha} dados={cache} itens={itens} hoje={dados.hoje} modo={dados.modo} podeExecutar={dados.podeExecutar} nome={nome} cmc={cmc}
        onPilha={(p) => { setPilha(p); const t = p[p.length - 1]; if (t) void carregar(t) }} onFechar={fechar}
        onAbrir={(a, c) => abrir(a, c)} onIrGrupo={irGrupo} onFeito={onFeito} />
      <Toast toast={toast} fechar={() => setToast(null)} />
    </div>
  )
}

function Toast({ toast, fechar }: { toast: { txt: string; desfazer?: () => Promise<void> } | null; fechar: () => void }) {
  const [m, setM] = React.useState(false)
  React.useEffect(() => setM(true), [])
  if (!m) return null
  return createPortal(
    <div className={s.portal}>
      <div className={`${s.toast} ${toast ? s.toastOn : ''}`} role="status" aria-live="polite">
        <span>{toast?.txt}</span>
        {toast?.desfazer ? <button onClick={() => void toast.desfazer!()}>Desfazer</button> : <button onClick={fechar}>Ok</button>}
      </div>
    </div>,
    document.body,
  )
}

function GrupoBloco({ g, itens, u, setU, aberto, alternar, ativo, abrir, extra }: {
  g: Grupo; itens: ProblemaComEstado[]; u: typeof UI_PADRAO; setU: (x: Partial<typeof UI_PADRAO>) => void; aberto: boolean; alternar: () => void
  ativo: string | undefined; abrir: (p: ProblemaComEstado['p']) => void; extra: React.ReactNode
}) {
  const todos = itens.filter((x) => x.p.grupo === g)
  const ab = todos.filter((x) => x.e.estado === 'aberto')
  const vAb = ab.reduce((s2, x) => s2 + x.p.valor, 0)
  const vTot = todos.reduce((s2, x) => s2 + x.p.valor, 0)
  const [cor, rot] = sev(vAb || vTot, g)
  const res = todos.filter((x) => x.e.estado === 'resolvido' || x.e.estado === 'ignorado').length
  const ram = todos.filter((x) => x.e.estado === 'ramon').length
  const { lista, contagem } = filtrarGrupo(itens, g, u)
  const vis = lista.slice(0, u.q ? 99 : u.limite)
  const rotSaldo = g === 'custo' ? 'Maior custo' : g === 'op' || g === 'cupom' ? 'Mais antiga' : 'Mais negativo'
  return (
    <section className={`${s.grupo} ${aberto ? s.grupoAberto : ''}`} id={`g-${g}`}>
      <button className={s.gCab} aria-expanded={aberto} aria-controls={`gc-${g}`} onClick={alternar}>
        <span className={s.chev}><Ic n="chev" /></span>
        <span className={s.gTit}><b>{GRUPOS[g].nome}</b><span>{GRUPOS[g].sub}</span></span>
        <span className={s.gPeso}><span className={`${s.v} ${s.num}`}>{g === 'taxa' || g === 'semcusto' ? '—' : fmtBRLCurto(vAb)}</span><span className={s.sev}><i className={s.dot} style={{ background: ab.length ? cor : 'var(--brand)' }} />{ab.length ? rot : 'Em dia'}</span></span>
        <span className={s.gCont}>
          <span className={s.pillN}>{ab.length ? `${ab.length} ${ab.length === 1 ? 'aberto' : 'abertos'}` : 'Nenhum aberto'}</span>
          <span className={s.mini} title={`${res} feitos, ${ram} esperando`}><b style={{ width: `${(res / Math.max(1, todos.length)) * 100}%`, background: 'var(--brand)' }} /><b style={{ width: `${(ram / Math.max(1, todos.length)) * 100}%`, background: 'var(--warn)' }} /></span>
        </span>
      </button>
      <div className={s.gCorpo} id={`gc-${g}`}><div>
        {aberto && extra}
        <div className={s.gFerr}>
          <label className={s.campoBusca}><Ic n="search" sm />
            <input type="search" value={u.q} placeholder={`Buscar em ${GRUPOS[g].nome.toLowerCase()}`} aria-label="Buscar neste grupo" onChange={(x) => setU({ q: x.target.value, limite: 6 })} />
          </label>
          <div className={s.seg} role="group" aria-label="Ordenar">
            {([['valor', 'Maior valor'], ['saldo', rotSaldo], ['nome', 'A–Z']] as const).map(([v, t]) => <button key={v} aria-pressed={u.ordem === v} onClick={() => setU({ ordem: v, limite: 6 })}>{t}</button>)}
          </div>
          <div className={s.seg} role="group" aria-label="Mostrar">
            {([['aberto', 'Abertos'], ['ramon', 'Esperando'], ['feito', 'Feitos'], ['todos', 'Todos']] as const).map(([v, t]) => <button key={v} aria-pressed={u.filtro === v} onClick={() => setU({ filtro: v, limite: 6 })}>{t} <span className={`${s.muted} ${s.num}`}>{contagem[v]}</span></button>)}
          </div>
        </div>
        <div className={s.lista}>
          {!vis.length ? (
            <div className={`${s.vazio} ${s.entra}`}><div className={s.vazioIc}><Ic n={u.filtro === 'aberto' && !u.q ? 'check' : 'sparkle'} /></div><div>
              <b>{u.q ? `Nada encontrado para “${u.q}”.` : u.filtro === 'aberto' ? (res + ram ? 'Nada aberto aqui.' : 'Nada para olhar aqui.') : u.filtro === 'ramon' ? 'Nenhum pedido ao Ramon neste grupo.' : 'Nada feito ainda neste grupo.'}</b>
              <span>{u.q ? 'Tente o nome, o código ou o número da OP.' : u.filtro === 'aberto' ? `${res} ${res === 1 ? 'feito' : 'feitos'}${ram ? `, ${ram} esperando o Ramon` : ''}. Um grupo a menos.` : 'Abra um item e escolha como corrigir.'}</span>
            </div></div>
          ) : vis.map(({ p, e }) => (
            <button key={p.chave} className={`${s.item} ${ativo === p.chave ? s.itemAtivo : ''}`} onClick={() => abrir(p)}>
              <span className={s.l1}><Tag p={p} /><span className={s.nome}>{p.titulo}</span></span>
              <span className={s.dir}>
                <span className={`${s.saldo} ${s.num} ${p.ladoErro ? s.err : s.muted}`}>{p.lado}</span>
                <span className={`${s.val} ${s.num}`}>{valorTxt(p.valor)}</span>
                {e.estado !== 'aberto' && <StatusPill e={e.estado} />}
                <Ic n="chev" sm className={s.muted} />
              </span>
              <span className={s.causa}>{e.reaberto && e.estado === 'aberto' ? `Voltou (marcado em ${fmtData(e.reaberto)}). ` : ''}{p.causa}</span>
            </button>
          ))}
          {lista.length > vis.length && <button className={s.mais} onClick={() => setU({ limite: u.limite + 10 })}>Mostrar mais {Math.min(10, lista.length - vis.length)} de {lista.length - vis.length}</button>}
        </div>
      </div></div>
    </section>
  )
}

/** Faixa do grupo "Cupons sem OP": aviso do PDV, resumo por dia e "Criar OPs que faltam" em lote (1 por vez). */
function FaixaCupons({ dados, itens, podeExecutar, onFim }: { dados: DadosCentral; itens: ProblemaComEstado[]; podeExecutar: boolean; onFim: (msg: string) => void }) {
  const abertos = itens.filter((x) => x.p.grupo === 'cupom' && x.e.estado === 'aberto' && x.p.d.cupom)
  const nItens = abertos.reduce((s2, x) => s2 + x.p.d.cupom!.itens.length, 0)
  const [etapa, setEtapa] = React.useState<'nada' | 'confirmar' | 'rodando' | 'fim'>('nada')
  const [log, setLog] = React.useState<string[]>([])
  async function rodar() {
    setEtapa('rodando'); setLog([])
    let criadas = 0, falhas = 0
    fora: for (const { p } of abertos) {
      const c = p.d.cupom!
      let tudoOk = true
      for (const i of c.itens) {
        const r = await lancarOPCorrecao({ origem: 'cupom', codigoProduto: i.produto, quantidade: i.quantidade, dataISO: c.data, nIdCupom: c.nIdCupom })
        if ('error' in r) {
          tudoOk = false; falhas++
          // Mês já enviado à contabilidade: o lote não confirma por ninguém; lança pelo próprio cupom, com a 2ª confirmação.
          if (r.precisaConfirmarMesFechado) { setLog((x) => [`Cupom ${c.num ?? c.nIdCupom}: mês já enviado à contabilidade, pulei. Abra o cupom para lançar com confirmação.`, ...x].slice(0, 30)); break }
          setLog((x) => [`Cupom ${c.num ?? c.nIdCupom} · ${i.nome}: ${r.error}`, ...x].slice(0, 30))
          if (r.parar || ehLimiteOmie(r.error)) { setLog((x) => ['Parei no primeiro bloqueio do Omie. Espere alguns minutos antes de continuar.', ...x]); break fora }
          continue
        }
        criadas++
        setLog((x) => [`Cupom ${c.num ?? c.nIdCupom} · ${i.nome}: ${r.aviso}`, ...x].slice(0, 30))
      }
      if (tudoOk) await marcarEstadoProblema({ chave: p.chave, estado: 'resolvido', acao: 'OPs do cupom criadas', assinatura: p.assinatura })
    }
    setEtapa('fim')
    onFim(`Cupons sem OP: ${criadas} OP${criadas === 1 ? '' : 's'} lançada${criadas === 1 ? '' : 's'}${falhas ? `, ${falhas} com erro` : ''}.`)
  }
  return (
    <div className={s.faixaCupom}>
      <span><b>A integração do PDV pode reprocessar sozinha; confira antes.</b> Ela já parou por dias e depois reprocessou sozinha. Antes de criar, a Central confere de novo as OPs do caixa daquele dia e não lança o que já tiver OP.</span>
      {dados.cuponsPorDia.length > 0 && <div className={s.dias}>{dados.cuponsPorDia.slice(0, 10).map((d) => <span key={d.data}>{fmtData(d.data)}: {d.cupons} cupo{d.cupons === 1 ? 'm' : 'ns'}, {d.itens.toLocaleString('pt-BR')} ite{d.itens === 1 ? 'm' : 'ns'}</span>)}</div>}
      {podeExecutar && abertos.length > 0 && (
        etapa === 'nada' || etapa === 'fim' ? <div><button className={`${s.btn} ${s.btnP}`} onClick={() => setEtapa('confirmar')}>Criar OPs que faltam ({nItens} {nItens === 1 ? 'prato' : 'pratos'} em {abertos.length} cupo{abertos.length === 1 ? 'm' : 'ns'})</button></div>
        : etapa === 'confirmar' ? (
          <div className={s.confirma}>
            <p><b>Confirme:</b> cria e conclui no Omie uma OP por prato, com a data de cada cupom, uma por vez. Para no primeiro bloqueio do Omie.</p>
            <div className={s.acoesFim}><button className={`${s.btn} ${s.btnS}`} onClick={() => setEtapa('nada')}>Voltar</button><button className={`${s.btn} ${s.btnP}`} onClick={rodar}><Ic n="check" sm />Sim, criar as OPs</button></div>
          </div>
        ) : <div>Criando, uma por vez… não feche a página.</div>
      )}
      {log.length > 0 && <div className={s.resultado} style={{ color: 'var(--text)' }}>{log.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </div>
  )
}
