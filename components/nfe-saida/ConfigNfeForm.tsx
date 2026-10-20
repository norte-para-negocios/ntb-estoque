'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { definirProximoNumeroNfe, salvarConfigNfe, type ConfigNfeEntrada } from '@/lib/actions/nfe-saida'

// Configuração fiscal da NF-e de saída (só quem administra a loja): regime (CRT), séries, autXML, CSTs padrão,
// texto fixo das informações complementares, código IBGE do município e o próximo número de cada série.

const input = 'w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2'
type Numeracao = { tpAmb: 1 | 2; serie: number; ultimo: number }

export function ConfigNfeForm({ inicial, numeracao, podeEditar }: { inicial: ConfigNfeEntrada; numeracao: Numeracao[]; podeEditar: boolean }) {
  const router = useRouter()
  const [c, setC] = useState(inicial)
  const [pend, start] = useTransition()
  const [prox, setProx] = useState<{ tpAmb: '1' | '2'; serie: string; numero: string }>({ tpAmb: '1', serie: String(inicial.serieProducao ?? ''), numero: '' })
  const set = <K extends keyof ConfigNfeEntrada>(k: K, v: ConfigNfeEntrada[K]) => setC((x) => ({ ...x, [k]: v }))
  const simples = c.crt !== 3
  const numOuNull = (s: string) => (s.trim() === '' ? null : Number(s))

  return (
    <div className="space-y-4 text-[13px]">
      <fieldset disabled={!podeEditar || pend} className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1"><span>Regime tributário (CRT)</span>
          <select className={input} value={c.crt ?? ''} onChange={(e) => set('crt', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— escolha —</option>
            <option value="1">1 - Simples Nacional</option><option value="2">2 - Simples Nacional, excesso de sublimite</option>
            <option value="3">3 - Regime normal</option><option value="4">4 - MEI</option>
          </select>
        </label>
        <label className="space-y-1"><span>Série em produção</span>
          <input className={input} inputMode="numeric" value={c.serieProducao ?? ''} onChange={(e) => set('serieProducao', numOuNull(e.target.value))} placeholder="ex.: 1" />
        </label>
        <label className="space-y-1"><span>Série em homologação (teste)</span>
          <input className={input} inputMode="numeric" value={c.serieHomologacao} onChange={(e) => set('serieHomologacao', Number(e.target.value) || 0)} />
        </label>
        <label className="space-y-1"><span>Código IBGE do município da loja</span>
          <input className={input} inputMode="numeric" maxLength={7} value={c.codigoMunicipio ?? ''} onChange={(e) => set('codigoMunicipio', e.target.value)} placeholder="7 dígitos" />
        </label>
        <label className="space-y-1 md:col-span-2"><span>CNPJ do escritório de contabilidade (autXML; na BA é obrigatório, sem ele vai o da SEFAZ-BA)</span>
          <input className={input} inputMode="numeric" value={c.autxmlCnpj ?? ''} onChange={(e) => set('autxmlCnpj', e.target.value)} />
        </label>
        <label className="space-y-1"><span>CST PIS/COFINS das saídas</span>
          <select className={input} value={c.cstPisCofins} onChange={(e) => set('cstPisCofins', e.target.value)}>
            <option value="49">49 - Outras operações de saída</option><option value="99">99 - Outras operações</option>
          </select>
        </label>
        {simples ? (
          <>
            <label className="space-y-1"><span>CSOSN da transferência</span>
              <select className={input} value={c.csosnTransferencia} onChange={(e) => set('csosnTransferencia', e.target.value)}>
                {['400', '102', '103', '300', '900'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span>CSOSN da remessa</span>
              <select className={input} value={c.csosnRemessa} onChange={(e) => set('csosnRemessa', e.target.value)}>
                {['900', '400', '102', '103', '300'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="space-y-1"><span>CST da transferência</span>
              <select className={input} value={c.cstTransferencia} onChange={(e) => set('cstTransferencia', e.target.value)}>
                {['41', '40', '50', '90'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span>CST da remessa</span>
              <select className={input} value={c.cstRemessa} onChange={(e) => set('cstRemessa', e.target.value)}>
                {['90', '40', '41', '50'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          </>
        )}
        <p className="text-text-muted md:col-span-3">Responsável técnico (grupo infRespTec): algumas UFs exigem. Preencha os quatro campos ou deixe todos vazios.</p>
        <label className="space-y-1"><span>CNPJ do responsável técnico</span>
          <input className={input} inputMode="numeric" value={c.respTecCnpj ?? ''} onChange={(e) => set('respTecCnpj', e.target.value)} />
        </label>
        <label className="space-y-1"><span>Contato</span>
          <input className={input} maxLength={60} value={c.respTecContato ?? ''} onChange={(e) => set('respTecContato', e.target.value)} />
        </label>
        <label className="space-y-1"><span>E-mail</span>
          <input className={input} maxLength={60} value={c.respTecEmail ?? ''} onChange={(e) => set('respTecEmail', e.target.value)} />
        </label>
        <label className="space-y-1"><span>Telefone</span>
          <input className={input} inputMode="numeric" value={c.respTecFone ?? ''} onChange={(e) => set('respTecFone', e.target.value)} />
        </label>
        <label className="space-y-1 md:col-span-3"><span>Texto fixo nas informações complementares (opcional)</span>
          <textarea className={`${input} min-h-[60px]`} maxLength={2000} value={c.infoComplementar ?? ''} onChange={(e) => set('infoComplementar', e.target.value)} />
        </label>
      </fieldset>
      {podeEditar && (
        <button type="button" className={btnClass('primary')} disabled={pend} onClick={() => start(async () => {
          const r = await salvarConfigNfe(c)
          if ('error' in r) toast.error('Configuração', { description: r.error })
          else { toast.success('Configuração da NF-e salva'); router.refresh() }
        })}>{pend && <Spinner />}Salvar configuração</button>
      )}

      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="font-medium text-text">Numeração</p>
        {numeracao.length === 0 ? <p className="text-text-muted">Nenhum número usado ainda.</p> : (
          <ul className="text-text-muted">
            {numeracao.map((n) => <li key={`${n.tpAmb}-${n.serie}`}>{n.tpAmb === 1 ? 'Produção' : 'Homologação'} · série {n.serie}: último número {n.ultimo}</li>)}
          </ul>
        )}
        {podeEditar && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span>Ambiente</span>
              <select className={input} value={prox.tpAmb} onChange={(e) => setProx((p) => ({ ...p, tpAmb: e.target.value as '1' | '2' }))}>
                <option value="1">Produção</option><option value="2">Homologação</option>
              </select>
            </label>
            <label className="space-y-1"><span>Série</span><input className={`${input} w-24`} inputMode="numeric" value={prox.serie} onChange={(e) => setProx((p) => ({ ...p, serie: e.target.value }))} /></label>
            <label className="space-y-1"><span>Próximo número</span><input className={`${input} w-32`} inputMode="numeric" value={prox.numero} onChange={(e) => setProx((p) => ({ ...p, numero: e.target.value }))} /></label>
            <button type="button" className={btnClass('outline')} disabled={pend || !prox.numero || prox.serie === ''} onClick={() => start(async () => {
              const r = await definirProximoNumeroNfe(prox.tpAmb === '1' ? 1 : 2, Number(prox.serie), Number(prox.numero))
              if ('error' in r) toast.error('Numeração', { description: r.error })
              else { toast.success('Próximo número definido'); router.refresh() }
            })}>Definir</button>
            <p className="w-full text-[12px] text-text-muted">Use para continuar a sequência que a loja já usava em outro emissor (o número nunca volta para trás).</p>
          </div>
        )}
      </div>
    </div>
  )
}
