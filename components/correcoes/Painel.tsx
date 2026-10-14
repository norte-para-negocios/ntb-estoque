'use client'

// Painel lateral universal da Central (folha de baixo no celular): produto, OP, nota, cupom e ajuste/contagem, com
// abas Resumo / Movimentos (busca) / Ligado a e navegação em pilha (voltar + caminho). Dados sob demanda.
import * as React from 'react'
import { createPortal } from 'react-dom'
import s from './central.module.css'
import { Ic, ICONE_ALVO } from './icones'
import { CorrecaoGuiada, type Feito } from './CorrecaoGuiada'
import { fmtData, normalizar, type Alvo, type ProblemaComEstado } from '@/lib/correcoes/central-puro'
import type { PainelDados } from '@/lib/correcoes/painel-dados'

export type Entrada = { tipo: Alvo['tipo']; id: number; aba: 'resumo' | 'mov' | 'lig'; q: string; prob?: string }
type Estado = PainelDados | { error: string } | undefined

type Props = {
  pilha: Entrada[]; dados: Record<string, Estado>; itens: ProblemaComEstado[]; hoje: string; modo: 'omie' | 'proprio'; podeExecutar: boolean
  nome: (cod: number) => string; cmc: (cod: number) => number
  onPilha: (p: Entrada[]) => void; onFechar: () => void; onAbrir: (alvo: Alvo, chave?: string) => void; onIrGrupo: (g: string) => void
  onFeito: (f: Feito, toast: string, desfazer?: () => Promise<void>) => void
}

export const chaveAlvo = (e: { tipo: string; id: number }) => `${e.tipo}:${e.id}`

export function Painel(props: Props) {
  const { pilha, dados } = props
  const aberto = pilha.length > 0
  const topo = pilha[pilha.length - 1]
  const corpo = React.useRef<HTMLDivElement>(null)
  const painel = React.useRef<HTMLElement>(null)
  const [montado, setMontado] = React.useState(false)
  React.useEffect(() => setMontado(true), [])
  React.useEffect(() => { corpo.current?.scrollTo({ top: 0 }) }, [topo?.tipo, topo?.id])

  // Arrastar a folha para baixo (celular).
  const y0 = React.useRef<number | null>(null)
  const dy = React.useRef(0)
  const alca = {
    onPointerDown: (e: React.PointerEvent) => { y0.current = e.clientY; dy.current = 0; (e.target as HTMLElement).setPointerCapture(e.pointerId); if (painel.current) painel.current.style.transition = 'none' },
    onPointerMove: (e: React.PointerEvent) => { if (y0.current == null || !painel.current) return; dy.current = Math.max(0, e.clientY - y0.current); painel.current.style.transform = `translateY(${dy.current}px)` },
    onPointerUp: () => { if (y0.current == null || !painel.current) return; painel.current.style.transition = ''; painel.current.style.transform = ''; if (dy.current > 120) props.onFechar(); y0.current = null },
  }

  if (!montado) return null
  const d = topo ? dados[chaveAlvo(topo)] : undefined
  const titulo = (x: Entrada) => { const v = dados[chaveAlvo(x)]; return v && !('error' in v) ? v.titulo : ({ produto: 'Produto', op: 'OP', nota: 'Nota', cupom: 'Cupom', ajuste: 'Ajuste' })[x.tipo] }
  const set = (patch: Partial<Entrada>) => props.onPilha([...pilha.slice(0, -1), { ...topo, ...patch }])
  const problemas = topo ? props.itens.filter((x) => x.p.alvo.tipo === topo.tipo && x.p.alvo.id === topo.id) : []
  const atual = problemas.find((x) => x.p.chave === topo?.prob) ?? problemas[0]

  return createPortal(
    <div className={s.portal}>
      <div className={`${s.veu} ${aberto ? s.veuOn : ''}`} onClick={props.onFechar} />
      <aside ref={painel} className={`${s.painel} ${aberto ? s.painelOn : ''}`} aria-label="Detalhes" aria-hidden={!aberto}>
        <div className={s.alca} {...alca} aria-hidden="true" />
        <div className={s.pNav}>
          <button className={s.iconBtn} aria-label={pilha.length > 1 ? `Voltar para ${titulo(pilha[pilha.length - 2])}` : 'Fechar'} onClick={() => (pilha.length > 1 ? props.onPilha(pilha.slice(0, -1)) : props.onFechar())}><Ic n="voltar" /></button>
          <nav className={s.migalhas} aria-label="Caminho">
            {pilha.map((x, i) => i === pilha.length - 1
              ? <span key={i} className={s.atual} title={titulo(x)}>{titulo(x)}</span>
              : <React.Fragment key={i}><button onClick={() => props.onPilha(pilha.slice(0, i + 1))} title={titulo(x)}>{titulo(x)}</button><span className={s.sep}>›</span></React.Fragment>)}
          </nav>
          {d && !('error' in d) && d.hrefPagina && <a className={s.iconBtn} href={d.hrefPagina} title="Abrir a página" aria-label="Abrir a página"><Ic n="externo" sm /></a>}
          <button className={s.iconBtn} aria-label="Fechar" onClick={props.onFechar}><Ic n="fechar" /></button>
        </div>
        <div className={s.pCorpo} ref={corpo}>
          {topo && (
            d === undefined ? <><div className={s.esqueleto} /><div className={s.esqueleto} style={{ height: 120 }} />{atual && <CorrecaoGuiada item={atual} outros={problemas} {...comuns(props)} painel={null} onTrocar={(c) => set({ prob: c })} />}</>
            : 'error' in d ? <div className={s.alerta}><Ic n="alert" sm /><span>{d.error}</span></div>
            : <Conteudo d={d} e={topo} set={set} props={props} atual={atual} problemas={problemas} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

const comuns = (p: Props) => ({ hoje: p.hoje, modo: p.modo, podeExecutar: p.podeExecutar, nome: p.nome, cmc: p.cmc, onAbrir: p.onAbrir, onIrGrupo: p.onIrGrupo, onFeito: p.onFeito })

function Conteudo({ d, e, set, props, atual, problemas }: { d: PainelDados; e: Entrada; set: (p: Partial<Entrada>) => void; props: Props; atual: ProblemaComEstado | undefined; problemas: ProblemaComEstado[] }) {
  const nLig = d.ligado.reduce((s2, g) => s2 + g.itens.length, 0)
  const abrir = (a: { tipo: Alvo['tipo']; id: number }) => {
    const pb = props.itens.find((x) => x.p.alvo.tipo === a.tipo && x.p.alvo.id === a.id)
    props.onAbrir(a, pb?.p.chave)
  }
  return (
    <>
      <div className={s.pCab}>
        <div className={s.pTipo}><Ic n={ICONE_ALVO[e.tipo]} sm />{d.tipoRotulo}{d.subtitulo && e.tipo === 'produto' ? ` · ${d.subtitulo}` : ''}</div>
        <h3>{d.titulo}</h3>
        {d.subtitulo && e.tipo !== 'produto' && <div className={s.pSub}>{d.subtitulo}</div>}
      </div>
      {d.kpis.length > 0 && <div className={s.kpis}>{d.kpis.map((k) => <div key={k.rot} className={s.kpi}><span>{k.rot}</span><b className={`${s.num} ${k.erro ? s.err : ''}`}>{k.valor}</b></div>)}</div>}
      <div className={s.abas}>
        <div className={s.seg} role="tablist">
          {([['resumo', 'Resumo', null], ['mov', 'Movimentos', d.movimentos.length], ['lig', 'Ligado a', nLig]] as const).map(([k, t, n]) => (
            <button key={k} role="tab" aria-pressed={e.aba === k} onClick={() => set({ aba: k })}>{t}{n != null && <span className={`${s.muted} ${s.num}`}> {n}</span>}</button>
          ))}
        </div>
      </div>
      {e.aba === 'mov' ? <Movimentos d={d} q={e.q} setQ={(q) => set({ q })} abrir={abrir} />
        : e.aba === 'lig' ? <div className={s.bloco}>{nLig ? <Ligado d={d} abrir={abrir} itens={props.itens} /> : <span className={s.muted}>Nada ligado.</span>}</div>
        : (
          <>
            {d.avisos.map((a, i) => <div key={i} className={`${s.alerta} ${s.alertaSuave}`}><Ic n="clock" sm /><span>{a}</span></div>)}
            {atual && <CorrecaoGuiada item={atual} outros={problemas} {...comuns(props)} painel={d} onTrocar={(c) => set({ prob: c })} />}
            {d.blocos.map((b) => <div key={b.titulo} className={s.bloco}><h4>{b.titulo}</h4><div style={{ fontSize: 14 }}>{b.texto}</div></div>)}
            {d.ficha && (
              <div className={s.bloco}>
                <h4>{d.ficha.titulo}</h4>
                <div className={s.ficha}>
                  {d.ficha.linhas.map((l, i) => (
                    <div key={i} className={s.f}>
                      <button onClick={() => l.produto && abrir({ tipo: 'produto', id: l.produto })}>{l.nome}</button>
                      <span className={`${s.num} ${s.muted}`}>{l.qtd}</span>
                      <span className={`${s.num} ${l.semCusto ? s.err : ''}`}>{l.custo}</span>
                    </div>
                  ))}
                  {d.ficha.total && <div className={s.f}><b>Total</b><span /><b className={s.num}>{d.ficha.total}</b></div>}
                </div>
              </div>
            )}
            {!problemas.length && (
              <div className={s.bloco}><div className={s.feito}><div className={s.feitoIc} style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Ic n="check" /></div>
                <div><b>Nada estranho aqui.</b><span>Veja os movimentos e o que está ligado nas abas acima.</span></div></div></div>
            )}
          </>
        )}
    </>
  )
}

function Movimentos({ d, q, setQ, abrir }: { d: PainelDados; q: string; setQ: (q: string) => void; abrir: (a: { tipo: Alvo['tipo']; id: number }) => void }) {
  const f = normalizar(q).trim()
  const l = f ? d.movimentos.filter((m) => normalizar([m.titulo, m.sub, m.link?.rotulo, fmtData(m.data), m.qtd].join(' ')).includes(f)) : d.movimentos
  return (
    <div className={s.bloco}>
      <label className={s.campoBusca}><Ic n="search" sm />
        <input type="search" placeholder="Buscar: cupom, OP, nota, data (12/10)…" value={q} onChange={(x) => setQ(x.target.value)} aria-label="Buscar nos movimentos" />
      </label>
      {d.movimentosAviso && <div className={s.muted} style={{ fontSize: 13 }}>{d.movimentosAviso}</div>}
      <div className={s.movLista}>
        {l.slice(0, 200).map((m, i) => (
          <div key={i} className={s.mov}>
            <span className={`${s.dt} ${s.num}`}>{fmtData(m.data)}</span>
            <span className={s.o}>{m.titulo}<small>{m.sub}{m.link && <> · <button className={s.doc} onClick={() => abrir(m.link!)}>{m.link.rotulo}</button></>}{m.href && <> · <a className={s.doc} href={m.href}>ver</a></>}</small></span>
            <span className={`${s.q} ${s.num} ${m.entrada ? s.ok : ''}`}>{m.qtd}{m.saldo && <small>saldo {m.saldo}</small>}</span>
          </div>
        ))}
        {!l.length && <div className={s.vazio}><div className={s.vazioIc}><Ic n="sparkle" /></div><div><b>{f ? 'Nada com esse termo.' : 'Sem movimentos no período.'}</b><span>{f ? 'Tente o número do cupom ou da OP.' : 'Abra a página para ver o histórico completo.'}</span></div></div>}
      </div>
    </div>
  )
}

function Ligado({ d, abrir, itens }: { d: PainelDados; abrir: (a: { tipo: Alvo['tipo']; id: number }) => void; itens: ProblemaComEstado[] }) {
  const temProb = (t: string, id: number) => itens.some((x) => x.p.alvo.tipo === t && x.p.alvo.id === id && x.e.estado === 'aberto')
  return (
    <>
      {d.ligado.map((g) => (
        <div key={g.titulo} className={s.ligGrupo}>
          <div className={s.ligT}><span>{g.titulo}</span><span className={s.num}>{g.itens.length}</span></div>
          {g.itens.slice(0, 12).map((x, i) => (
            <button key={i} className={s.lig} onClick={() => abrir(x)}>
              <span className={`${s.ico} ${temProb(x.tipo, x.id) ? s.icoAlerta : ''}`}><Ic n={ICONE_ALVO[x.tipo]} sm /></span>
              <span className={s.tx}><b>{x.titulo}</b><span>{x.sub}</span></span>
              <span className={`${s.vv} ${s.num} ${x.erro ? s.err : ''}`}>{x.valor}</span>
              <span className={s.muted}><Ic n="chev" sm /></span>
            </button>
          ))}
          {g.itens.length > 12 && <div className={s.muted} style={{ fontSize: 12, padding: '4px 2px' }}>+ {g.itens.length - 12} na página</div>}
        </div>
      ))}
    </>
  )
}
