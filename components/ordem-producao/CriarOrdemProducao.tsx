'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { UNIDADE_OP_LABEL, type UnidadeOP } from '@/lib/op-recorrencia'

const inputClass =
  'h-10 w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:h-11 max-sm:text-base'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Local = { codigo_local_estoque: number; descricao: string | null }

function hojeISO(): string {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bahia' }))
  const m = String(agora.getMonth() + 1).padStart(2, '0')
  const d = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${m}-${d}`
}

// Passo 1 da criacao de OP: so o cabecalho (data/recorrencia/local/obs). Os
// produtos sao escolhidos na tela seguinte (/ordem-producao/nova), igual ao
// fluxo da transferencia (modal de cabecalho -> tela dedicada de itens).
export function CriarOrdemProducao({ locais }: { locais: Local[] }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState('')
  const [data, setData] = useState(hojeISO())
  const [unidade, setUnidade] = useState<UnidadeOP>('nao')
  const [intervalo, setIntervalo] = useState('1')
  const [vezes, setVezes] = useState('4')
  const [obs, setObs] = useState('')
  const router = useRouter()

  function avancar() {
    if (!data) {
      toast.error('Informe a data de produção')
      return
    }
    const params = new URLSearchParams()
    params.set('data', data)
    params.set('unidade', unidade)
    if (unidade !== 'nao') {
      params.set('intervalo', intervalo)
      params.set('vezes', vezes)
    }
    if (local) params.set('local', local)
    if (obs.trim()) params.set('obs', obs.trim())
    setOpen(false)
    router.push(`/ordem-producao/nova?${params.toString()}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" className={btnClass('primary')}>
            <Plus className="size-4" /> Criar OP
          </button>
        }
      />
      <DialogContent className="bg-surface p-0" showCloseButton={false}>
        <div className="px-5 pt-5 text-[20px] font-bold tracking-[-0.01em] text-text">
          Nova(s) ordem(ns) de produção
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Data de produção</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`num ${inputClass}`} />
            </div>
            <div>
              <label className={labelClass}>Repetir</label>
              <select value={unidade} onChange={(e) => setUnidade(e.target.value as UnidadeOP)} className={inputClass}>
                {(Object.keys(UNIDADE_OP_LABEL) as UnidadeOP[]).map((u) => (
                  <option key={u} value={u}>{UNIDADE_OP_LABEL[u]}</option>
                ))}
              </select>
            </div>
          </div>

          {unidade !== 'nao' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>A cada</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={intervalo}
                  onChange={(e) => setIntervalo(e.target.value)}
                  className={inputClass}
                />
                <p className="mt-1.5 text-[12px] text-text-muted">
                  {unidade === 'dia' ? 'Ex.: 15 = de 15 em 15 dias' : unidade === 'semana' ? 'Ex.: 2 = a cada 2 semanas' : 'Ex.: 1 = todo mês'}
                </p>
              </div>
              <div>
                <label className={labelClass}>Quantas vezes</label>
                <select value={vezes} onChange={(e) => setVezes(e.target.value)} className={inputClass}>
                  {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30].map((n) => (
                    <option key={n} value={String(n)}>{n} vezes</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className={labelClass}>Local de estoque</label>
            <select value={local} onChange={(e) => setLocal(e.target.value)} className={inputClass}>
              <option value="">Padrão do produto</option>
              {locais.map((l) => (
                <option key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
                  {l.descricao || l.codigo_local_estoque}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Observação (opcional)</label>
            <input value={obs} onChange={(e) => setObs(e.target.value)} className={inputClass} placeholder="Ex.: lote, cupom..." />
          </div>

          <p className="text-[13px] text-text-muted">
            No próximo passo você escolhe os produtos e a validade de cada um. A data vai ao Omie como início, conclusão e previsão.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5 pt-1">
          <button type="button" onClick={avancar} className={btnClass('primary')}>
            Escolher produtos <ArrowRight className="size-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
