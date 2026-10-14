'use client'

// Correção guiada de um problema (painel da Central): causa, dependências, opções com prévia do efeito, confirmação e
// execução pelas ações de sempre (Fase 4) ou pelas novas da Central. Uma escrita no Omie por vez.
import * as React from 'react'
import s from './central.module.css'
import { Ic } from './icones'
import {
  GRUPOS, localDaAcao, lerNumeroBR, opcoesDoProblema, previaAcao, fmtData, fmtQtd, fmtBRL,
  type AcaoId, type Alvo, type EstadoEfetivo, type EstadoProblema, type OpcaoDef, type Problema, type ProblemaComEstado,
} from '@/lib/correcoes/central-puro'
import type { AjusteCusto, PainelDados } from '@/lib/correcoes/painel-dados'
import { ajusteOmie, corrigirCustoAjuste } from '@/lib/actions/estoque-omie'
import { acaoOPLote } from '@/lib/actions/ops-lote'
import { corrigirContagemCentral, lancarOPCorrecao, marcarEstadoProblema, marcarNaoControla } from '@/lib/actions/central'
import { ehLimiteOmie } from '@/lib/estoque/escrita-omie-puro'

export type Feito = { chave: string; estado: EstadoProblema; acao: string | null; motivo?: string | null; mensagem?: string | null; ate?: string | null }
type Props = {
  item: ProblemaComEstado; outros: ProblemaComEstado[]; hoje: string; modo: 'omie' | 'proprio'; podeExecutar: boolean
  nome: (cod: number) => string; cmc: (cod: number) => number; painel: PainelDados | null
  onTrocar: (chave: string) => void; onAbrir: (alvo: Alvo, chave?: string) => void; onIrGrupo: (chave: string) => void
  onFeito: (f: Feito, toast: string, desfazer?: () => Promise<void>) => void
}

const OMIE: AcaoId[] = ['zerar', 'contagem', 'op_preparo', 'op_prato', 'corrigir_custo', 'concluir', 'mudar_data', 'excluir', 'corrigir_contagem', 'criar_ops_cupom']
const PRECISA_CENTRAL: AcaoId[] = ['op_preparo', 'op_prato', 'criar_ops_cupom']
const STATUS: Record<EstadoProblema, [string, string]> = {
  aberto: ['var(--err)', 'Aberto'], resolvido: ['var(--brand)', 'Resolvido'], ramon: ['var(--warn)', 'Esperando Ramon'], ignorado: ['var(--text-muted)', 'Ignorado'],
}
export function StatusPill({ e }: { e: EstadoProblema }) {
  return <span className={s.status}><i className={s.dot} style={{ background: STATUS[e][0] }} />{STATUS[e][1]}</span>
}
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function CorrecaoGuiada(props: Props) {
  const { item, outros, hoje, modo, podeExecutar } = props
  const { p, e } = item
  return (
    <div className={`${s.problema} ${s.entra}`}>
      <div className={s.rot}>
        <span>{outros.length > 1 ? `${outros.length} problemas neste item` : GRUPOS[p.grupo].nome}</span>
        <StatusPill e={e.estado} />
      </div>
      {outros.length > 1 && (
        <div className={s.outrosProb}>
          {outros.map((o) => <button key={o.p.chave} aria-pressed={o.p.chave === p.chave} onClick={() => props.onTrocar(o.p.chave)}>{GRUPOS[o.p.grupo].nome}</button>)}
        </div>
      )}
      <div className={s.frase}>{p.causa}</div>
      {e.reaberto && e.estado === 'aberto' && (
        <div className={`${s.alerta} ${s.alertaSuave}`}><Ic n="clock" sm /><span>Voltou a aparecer depois de marcado em {fmtData(e.reaberto)}{e.reg?.user_nome ? ` por ${e.reg.user_nome}` : ''}.</span></div>
      )}
      {p.depende.map((d, i) => (
        <div key={i} className={`${s.alerta} ${d.chave?.startsWith('custo:') || d.chave?.startsWith('semcusto:') ? '' : s.alertaSuave}`}>
          <Ic n="alert" sm />
          <span>{d.texto}{' '}
            {d.chave === 'grupo:cupom' && <button className={s.doc} onClick={() => props.onIrGrupo('cupom')}>Ver cupons sem OP ›</button>}
            {d.chave?.startsWith('fichas:troca:') && <a className={s.doc} href={`/estoque/fichas?trocar=1&troca_de=${d.chave.split(':')[2]}`}>Trocar nas fichas ›</a>}
            {d.alvo && d.chave !== 'grupo:cupom' && <button className={s.doc} onClick={() => props.onAbrir(d.alvo!, d.chave)}>Abrir ›</button>}
          </span>
        </div>
      ))}
      {e.estado !== 'aberto'
        ? <BlocoFeito item={item} onFeito={props.onFeito} />
        : <Opcoes {...props} modo={modo} podeExecutar={podeExecutar} hoje={hoje} />}
    </div>
  )
}

function BlocoFeito({ item, onFeito }: { item: ProblemaComEstado; onFeito: Props['onFeito'] }) {
  const { p, e } = item
  const [ocupado, setOcupado] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const r = e.reg
  const cor = e.estado === 'resolvido' ? ['var(--brand-soft)', 'var(--brand)', 'check'] : e.estado === 'ramon' ? ['var(--warn-soft)', 'var(--warn)', 'send'] : ['var(--surface-2)', 'var(--text-muted)', 'eyeoff']
  const tit = e.estado === 'resolvido' ? 'Corrigido' : e.estado === 'ramon' ? 'Pedido guardado para o Ramon' : 'Ignorado'
  async function reabrir() {
    setOcupado(true); setErro(null)
    const x = await marcarEstadoProblema({ chave: p.chave, estado: 'aberto', assinatura: p.assinatura })
    setOcupado(false)
    if ('error' in x) { setErro(x.error); return }
    onFeito({ chave: p.chave, estado: 'aberto', acao: null }, `Reaberto: ${p.titulo}`)
  }
  return (
    <>
      <div className={s.feito}>
        <div className={`${s.feitoIc} ${s.pop}`} style={{ background: cor[0], color: cor[1] }}><Ic n={cor[2]} /></div>
        <div>
          <b>{tit}</b>
          <span>{[r?.acao ?? r?.motivo, r?.user_nome, r ? hora(r.atualizado_em) : null, r?.ate ? `até ${fmtData(r.ate)}` : null].filter(Boolean).join(' · ')}</span>
          {r?.mensagem && <div style={{ fontSize: 13, marginTop: 6 }}>“{r.mensagem}”</div>}
        </div>
      </div>
      {erro && <div className={s.alerta}><Ic n="alert" sm /><span>{erro}</span></div>}
      <div className={s.acoesFim}>
        <span className={s.muted} style={{ fontSize: 13 }}>{e.estado === 'ramon' ? 'Quando ele responder, reabra e corrija.' : e.estado === 'resolvido' ? 'Some da lista quando o Omie for relido sem o problema.' : 'Mudou de ideia?'}</span>
        <button className={`${s.btn} ${s.btnS}`} disabled={ocupado} onClick={reabrir}><Ic n="undo" sm />Reabrir</button>
      </div>
    </>
  )
}

function Opcoes(props: Props) {
  const { item, hoje, modo, podeExecutar, painel } = props
  const { p } = item
  const defs = React.useMemo(() => {
    const todas = opcoesDoProblema(p, hoje)
    return modo === 'proprio' ? todas.filter((d) => !OMIE.includes(d.acao)) : todas
  }, [p, hoje, modo])
  const [acao, setAcao] = React.useState<AcaoId | null>(defs[0]?.acao ?? null)
  const [vals, setVals] = React.useState<Record<string, Record<string, string>>>(() => Object.fromEntries(defs.map((d) => [d.acao, Object.fromEntries(d.campos.map((c) => [c.id, c.inicial]))])))
  const [etapa, setEtapa] = React.useState<'escolher' | 'confirmar' | 'executando'>('escolher')
  const [ignorando, setIgnorando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [log, setLog] = React.useState<string[]>([])
  const [ajusteSel, setAjusteSel] = React.useState<number | null>(null)
  const [mesFechado, setMesFechado] = React.useState(false)
  React.useEffect(() => { setAcao(defs[0]?.acao ?? null); setEtapa('escolher'); setErro(null); setLog([]); setMesFechado(false) }, [p.chave, defs])

  const def = defs.find((d) => d.acao === acao) ?? defs[0]
  const ajustes: AjusteCusto[] = painel?.ajustesCusto ?? []
  const v = def ? { ...(vals[def.acao] ?? {}) } : {}
  const bloqueada = (d: OpcaoDef) => (!podeExecutar && PRECISA_CENTRAL.includes(d.acao)) ? 'Precisa da permissão "Corrigir pela Central de correções".' : null
  let pv = def ? previaAcao(def.acao, p, v, { nome: props.nome, cmc: props.cmc, hoje }) : { vazio: 'Nada a fazer aqui.' }
  if (def?.acao === 'corrigir_custo' && !('vazio' in pv) && ajusteSel == null) pv = { vazio: ajustes.length ? 'Escolha o ajuste que trouxe o custo errado.' : 'Nenhum ajuste de entrada dos últimos 90 dias para corrigir: o custo veio de OP ou nota. Corrija a origem (OP/nota) ou pergunte ao Ramon.' }
  if (def && (def.acao === 'zerar' || def.acao === 'contagem' || def.acao === 'corrigir_contagem') && localDaAcao(p).local == null) pv = { vazio: 'Não sei em qual local ajustar: abra a página do produto.' }

  const set = (campo: string, valor: string) => setVals((x) => ({ ...x, [def!.acao]: { ...(x[def!.acao] ?? {}), [campo]: valor } }))

  async function executar() {
    if (!def) return
    setEtapa('executando'); setErro(null); setLog([])
    const motivoBase = `Central de correções: ${def.feito.toLowerCase()}`
    const falha = (msg: string) => { setErro(msg); setEtapa('escolher') }
    try {
      const d = p.d
      switch (def.acao) {
        case 'zerar': {
          for (const l of d.locaisNeg ?? []) {
            const r = await ajusteOmie({ codigoProduto: d.produto!, codigoLocal: l.local, motivo: motivoBase, novoSaldo: 0, somenteSeNegativo: true })
            if ('error' in r) return falha(`${l.nome}: ${r.error}`)
            setLog((x) => [...x, `${l.nome}: ${r.aviso ?? 'ok'}`])
            if (r.alerta) return falha(r.aviso ?? 'O Omie não confirmou: acompanhe em Movimentações.')
          }
          break
        }
        case 'contagem': {
          const loc = localDaAcao(p)
          const r = await ajusteOmie({ codigoProduto: d.produto!, codigoLocal: loc.local!, motivo: `${motivoBase} (contou ${v.contado})`, novoSaldo: v.contado })
          if ('error' in r) return falha(r.error)
          setLog([r.aviso ?? 'ok'])
          if (r.alerta) return falha(r.aviso ?? '')
          break
        }
        case 'corrigir_contagem': {
          if (d.contagem?.movId == null) return falha('Não achei o lançamento desta contagem: corrija pela tela de Ajustes.')
          const r = await corrigirContagemCentral({ movimentoId: d.contagem.movId, para: lerNumeroBR(v.para)! })
          if ('error' in r) return falha(r.error)
          setLog([r.aviso])
          break
        }
        case 'op_preparo':
        case 'op_prato': {
          const r = await lancarOPCorrecao({ origem: 'correcao', codigoProduto: d.produto!, quantidade: lerNumeroBR(v.qtd)!, dataISO: v.data, confirmarMesFechado: mesFechado })
          if ('error' in r) {
            if (r.precisaConfirmarMesFechado) { setMesFechado(true); return falha(`${r.error} Marque a confirmação de mês fechado e confirme de novo.`) }
            return falha(r.error)
          }
          setLog([r.aviso])
          break
        }
        case 'concluir':
        case 'excluir':
        case 'mudar_data': {
          const r = await acaoOPLote({ acao: def.acao === 'concluir' ? 'concluir' : def.acao === 'excluir' ? 'excluir' : 'data', opId: d.op!.id, dataISO: v.data ?? null })
          if ('error' in r) return falha(r.error)
          setLog([r.simulado ? 'Loja de teste: simulado, nada foi ao Omie.' : 'Feito no Omie.'])
          break
        }
        case 'corrigir_custo': {
          const a = ajustes.find((x) => x.movimentoId === ajusteSel)
          if (!a) return falha('Escolha o ajuste.')
          const r = await corrigirCustoAjuste({ movimentoId: a.movimentoId, custoNovo: lerNumeroBR(v.custo)!, custoAtualVisto: a.custo, confirmarMesFechado: mesFechado })
          if ('error' in r) {
            if (r.precisaConfirmarMesFechado) { setMesFechado(true); return falha(`${r.error} Marque a confirmação de mês fechado e confirme de novo.`) }
            return falha(r.error)
          }
          setLog([r.aviso])
          break
        }
        case 'criar_ops_cupom': {
          const c = d.cupom!
          let falhas = 0
          for (const i of c.itens) {
            const r = await lancarOPCorrecao({ origem: 'cupom', codigoProduto: i.produto, quantidade: i.quantidade, dataISO: c.data, nIdCupom: c.nIdCupom, confirmarMesFechado: mesFechado })
            if ('error' in r) {
              if (r.precisaConfirmarMesFechado) { setMesFechado(true); return falha(`${r.error} Marque a confirmação de mês fechado e confirme de novo.`) }
              falhas++
              setLog((x) => [...x, `${i.nome}: ${r.error}`])
              if (r.parar || ehLimiteOmie(r.error)) return falha(`Parei no primeiro bloqueio do Omie (${i.nome}). Espere alguns minutos antes de continuar.`)
              continue
            }
            setLog((x) => [...x, `${i.nome}: ${r.aviso}`])
          }
          // Só marca resolvido se todos os pratos ficaram com OP (achado I1 da revisão final).
          if (falhas) return falha(`${falhas} ${falhas === 1 ? 'prato ficou' : 'pratos ficaram'} sem OP: veja o motivo acima. O cupom continua aberto.`)
          break
        }
        case 'nao_controla': {
          const r = await marcarNaoControla({ codigoProduto: d.produto! })
          if ('error' in r) return falha(r.error)
          props.onFeito({ chave: p.chave, estado: 'resolvido', acao: def.feito }, `${def.feito}: ${p.titulo}`, async () => { await marcarNaoControla({ codigoProduto: d.produto!, desfazer: true }) })
          return
        }
        case 'ramon': {
          const r = await marcarEstadoProblema({ chave: p.chave, estado: 'ramon', mensagem: v.msg, acao: def.feito, assinatura: p.assinatura })
          if ('error' in r) return falha(r.error)
          props.onFeito({ chave: p.chave, estado: 'ramon', acao: def.feito, mensagem: v.msg }, `Pedido guardado: ${p.titulo}`, async () => { await marcarEstadoProblema({ chave: p.chave, estado: 'aberto' }) })
          return
        }
      }
      const r = await marcarEstadoProblema({ chave: p.chave, estado: 'resolvido', acao: def.feito, assinatura: p.assinatura })
      props.onFeito({ chave: p.chave, estado: 'resolvido', acao: def.feito }, `${def.feito}: ${p.titulo}${'error' in r ? ' (o estado não foi guardado)' : ''}`)
    } catch (x) {
      falha(x instanceof Error ? x.message : String(x))
    }
  }

  async function ignorar(motivo: 'resolvi' | 'nao' | 'depois') {
    const estado: EstadoProblema = motivo === 'resolvi' ? 'resolvido' : 'ignorado'
    const texto = motivo === 'resolvi' ? 'Já resolvi no Omie' : motivo === 'nao' ? 'Não é problema' : 'Olhar outro dia'
    const r = await marcarEstadoProblema({ chave: p.chave, estado, motivo: texto, acao: motivo === 'resolvi' ? texto : null, ate: motivo === 'depois' ? hoje : null, assinatura: p.assinatura })
    if ('error' in r) { setErro(r.error); return }
    props.onFeito({ chave: p.chave, estado, acao: motivo === 'resolvi' ? texto : null, motivo: texto, ate: motivo === 'depois' ? hoje : null }, `${motivo === 'resolvi' ? 'Resolvido' : 'Ignorado'}: ${p.titulo}`, async () => { await marcarEstadoProblema({ chave: p.chave, estado: 'aberto' }) })
  }

  if (!def) return <div className={s.muted} style={{ fontSize: 13 }}>Abra a página para corrigir.</div>
  if (etapa !== 'escolher' && !('vazio' in pv)) {
    return (
      <div className={`${s.confirma} ${s.entra}`}>
        <p><b>Confirme:</b> {pv.omie}</p>
        {pv.aviso && <p style={{ color: '#ffb340' }}>{pv.aviso}</p>}
        {mesFechado && (
          <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={mesFechado} onChange={(x) => setMesFechado(x.target.checked)} /> Sei que o mês já foi enviado à contabilidade e quero {def.acao === 'corrigir_custo' ? 'corrigir' : 'lançar'} mesmo assim.</label>
        )}
        {log.length > 0 && <div className={s.resultado}>{log.map((l, i) => <span key={i}>{l}</span>)}</div>}
        <div className={s.acoesFim}>
          <button className={`${s.btn} ${s.btnS}`} disabled={etapa === 'executando'} onClick={() => setEtapa('escolher')}>Voltar</button>
          <button className={`${s.btn} ${s.btnP}`} disabled={etapa === 'executando'} onClick={executar}><Ic n="check" sm />{etapa === 'executando' ? 'Fazendo…' : `Sim, ${def.botao.toLowerCase()}`}</button>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className={s.rot} style={{ marginTop: 2 }}><span>Como corrigir</span></div>
      <div className={s.opcoes} role="radiogroup">
        {defs.map((d) => {
          const on = d.acao === def.acao
          const bloq = bloqueada(d)
          return (
            <div key={d.acao} className={`${s.opcao} ${bloq ? s.opcaoOff : ''}`} role="radio" tabIndex={0} aria-checked={on}
              onClick={(x) => { if ((x.target as HTMLElement).closest('input, textarea, a, label')) return; setAcao(d.acao); setErro(null) }}
              onKeyDown={(x) => { if (x.key === ' ' || x.key === 'Enter') { x.preventDefault(); setAcao(d.acao) } }}>
              <span className={s.radio} />
              <b>{d.titulo}</b>
              <span className={s.opcaoD}>{bloq ?? d.descricao}</span>
              {on && d.campos.length > 0 && (
                <div className={s.form}>
                  {d.campos.map((c) => c.tipo === 'texto' ? (
                    <label key={c.id} className="full" style={{ flexBasis: '100%' }}>{c.rotulo}
                      <textarea className={s.msg} value={v[c.id] ?? ''} onChange={(x) => set(c.id, x.target.value)} />
                    </label>
                  ) : (
                    <label key={c.id}>{c.rotulo}
                      <span className={s.inp}>
                        {c.sufixo === 'R$' && <em>R$</em>}
                        <input type={c.tipo === 'data' ? 'date' : 'text'} inputMode={c.tipo === 'numero' ? 'decimal' : undefined} max={c.tipo === 'data' ? hoje : undefined}
                          value={v[c.id] ?? ''} onChange={(x) => set(c.id, x.target.value)} />
                        {c.sufixo && c.sufixo !== 'R$' && <em>{c.sufixo}</em>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {on && d.acao === 'corrigir_custo' && ajustes.length > 0 && (
                <div className={s.escolha}>
                  {ajustes.slice(0, 12).map((a) => (
                    <label key={a.movimentoId}>
                      <input type="radio" name={`aj-${p.chave}`} checked={ajusteSel === a.movimentoId} onChange={() => setAjusteSel(a.movimentoId)} />
                      <span>{fmtData(a.data)} · {a.tipo === 'ENT' ? 'entrada' : 'saída'} de {fmtQtd(a.quantidade, p.d.unidade ?? null)} a <b className={a.foraDoNormal ? s.err : ''}>{fmtBRL(a.custo)}</b>{a.motivo ? ` · ${a.motivo}` : ''}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className={s.previa}>
        {'vazio' in pv ? (
          <><span className={s.t}>Antes de confirmar</span><span className={s.muted} style={{ fontSize: 14 }}>{pv.vazio}</span></>
        ) : (
          <>
            <span className={s.t}>O que vai acontecer</span>
            {pv.linhas.map((l, i) => <div key={i} className={s.lin}><span>{l.rot}</span><span className={`${s.dePara} ${s.num}`}>{l.de && <><s>{l.de}</s>→</>}<span>{l.para}</span></span></div>)}
            {pv.aviso && <div className={s.alerta} style={{ marginTop: 2 }}><Ic n="alert" sm /><span>{pv.aviso}</span></div>}
            <div className={s.omie}>{pv.omie}</div>
          </>
        )}
      </div>
      {erro && <div className={s.alerta}><Ic n="alert" sm /><span>{erro}</span></div>}
      {log.length > 0 && <div className={s.resultado}>{log.map((l, i) => <span key={i}>{l}</span>)}</div>}
      <div className={s.acoesFim}>
        <div className={s.esq}><button className={`${s.btn} ${s.btnG}`} onClick={() => setIgnorando((x) => !x)}><Ic n="eyeoff" sm />Ignorar</button></div>
        <button className={`${s.btn} ${s.btnP}`} disabled={'vazio' in pv || !!bloqueada(def)} onClick={() => setEtapa('confirmar')}>{def.botao}</button>
      </div>
      {ignorando && (
        <div className={`${s.ignorar} ${s.entra}`}>Por quê?
          <button onClick={() => ignorar('resolvi')}>Já resolvi no Omie</button>
          <button onClick={() => ignorar('nao')}>Não é problema</button>
          <button onClick={() => ignorar('depois')}>Olhar outro dia</button>
        </div>
      )}
    </>
  )
}

export type { EstadoEfetivo, Problema }
