'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, Settings2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { salvarConfigSefaz } from '@/lib/actions/nota-fiscal-proprio'

export type EstadoSefaz = {
  existe: boolean; ativo: boolean; autoLancar: boolean; autoCiencia: boolean; ambiente: 1 | 2
  ultimaConsulta: string | null; bloqueadoAte: string | null; ultimoCstat: string | null; ultimoErro: string | null; semCertificado: boolean; aConferir: number
}

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export function StatusSefaz({ estado, podeConfigurar }: { estado: EstadoSefaz; podeConfigurar: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [cfg, setCfg] = useState({ autoLancar: estado.autoLancar, autoCiencia: estado.autoCiencia, ativo: estado.ativo, ambiente: estado.ambiente })
  const [pending, start] = useTransition()

  const problema = estado.semCertificado ? 'Cadastre o certificado digital da loja (Loja > Certificado) para a SEFAZ entregar as notas.' : estado.ultimoErro
  const salvar = () => start(async () => {
    const r = await salvarConfigSefaz(cfg)
    if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
    toast.success('Configuração da SEFAZ salva'); setAberto(false); router.refresh()
  })

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--r-lg)] bg-surface px-4 py-2.5 text-[13px] shadow-[var(--shadow-sm)]">
      <span className="flex items-center gap-2 font-medium text-text">
        {problema ? <TriangleAlert className="size-4 text-warn" /> : <CircleCheck className="size-4 text-ok" />}
        SEFAZ {estado.ativo ? 'ligada' : 'desligada'}
      </span>
      {problema
        ? <span className="text-warn">{problema}</span>
        : <span className="text-text-muted">
            {estado.ultimaConsulta ? `Última consulta ${hora(estado.ultimaConsulta)}` : 'Ainda não consultou'}
            {estado.bloqueadoAte && new Date(estado.bloqueadoAte).getTime() > Date.now() ? ` · próxima a partir de ${hora(estado.bloqueadoAte)}` : ''}
          </span>}
      {estado.aConferir > 0 && <span className="rounded-full bg-warn/15 px-2.5 py-0.5 font-medium text-warn">{estado.aConferir} {estado.aConferir === 1 ? 'nota a conferir' : 'notas a conferir'}</span>}
      {podeConfigurar && <button type="button" className="ml-auto inline-flex items-center gap-1.5 text-text-muted hover:text-text" onClick={() => setAberto(true)}><Settings2 className="size-4" />Ajustes</button>}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Notas de entrada pela SEFAZ</DialogTitle></DialogHeader>
          <div className="space-y-4 text-[14px]">
            <Opcao v={cfg.ativo} onChange={(v) => setCfg({ ...cfg, ativo: v })} titulo="Buscar notas na SEFAZ automaticamente" texto="O sistema consulta sozinho, a cada ciclo, e respeita a espera de 1 hora que a SEFAZ exige." />
            <Opcao v={cfg.autoCiencia} onChange={(v) => setCfg({ ...cfg, autoCiencia: v })} titulo="Dar ciência da operação" texto="Manifesta ciência da nota para a SEFAZ liberar o XML completo com os itens (como o Omie faz)." />
            <Opcao v={cfg.autoLancar} onChange={(v) => setCfg({ ...cfg, autoLancar: v })} titulo="Dar entrada no estoque sozinho" texto="Só quando TODOS os itens casam com um produto do cadastro (pelo de-para do fornecedor ou pelo código de barras) e a nota não tem divergência. O resto fica 'a conferir'." />
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-medium text-text">Ambiente da consulta</p><p className="text-text-muted">Produção traz as notas reais dos fornecedores (a consulta é só leitura).</p></div>
              <select className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-sm" value={cfg.ambiente} onChange={(e) => setCfg({ ...cfg, ambiente: Number(e.target.value) === 2 ? 2 : 1 })}>
                <option value={1}>Produção</option><option value={2}>Homologação</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)}>Cancelar</button>
            <button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Salvar</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Opcao({ v, onChange, titulo, texto }: { v: boolean; onChange: (v: boolean) => void; titulo: string; texto: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span><span className="block font-medium text-text">{titulo}</span><span className="block text-text-muted">{texto}</span></span>
      <input type="checkbox" className="mt-1 size-5 accent-[var(--brand)]" checked={v} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
