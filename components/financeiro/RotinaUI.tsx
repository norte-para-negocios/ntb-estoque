'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import {
  confirmarValorTitulo, decidirAprovacaoTitulo, estornarLancamentoAvulso, estornarTransferencia, gerarRecorrentesAgora,
  registrarLancamentoAvulso, registrarTransferencia, salvarConfigFinanceiro, salvarRecorrente,
} from '@/lib/actions/financeiro'
import { paraCentavos } from '@/lib/financeiro/titulo-puro'
import type { ConfigFinanceiro } from '@/lib/financeiro/aprovacao-puro'
import { OPCOES_DIA_SEMANA, validarRecorrente, type Periodicidade } from '@/lib/financeiro/recorrentes-puro'
import { validarLancamento, validarTransferencia } from '@/lib/financeiro/lancamentos-puro'
import type { Recorrente } from '@/lib/financeiro/consultas'
import { PedeMotivo } from './ContasPagarUI'
import { campo, chaveNova, PreviaMoeda, rotulo } from './comum'

// Fase 4 passo 2 (migration 370), telas só dev: aprovação de pagamento, contas recorrentes, lançamento avulso e transferência.

type Opcao = { id: number; nome: string }
const reais = (cent: number) => (cent / 100).toFixed(2).replace('.', ',')

// ----------------------------------------------------------------------------------------------------- configuração
export function FormConfigAprovacao({ config, podeEditar }: { config: ConfigFinanceiro; podeEditar: boolean }) {
  const router = useRouter()
  const [ativa, setAtiva] = useState(config.ativa)
  const [ate, setAte] = useState(reais(config.ateCent))
  const [alto, setAlto] = useState(reais(config.altoAcimaCent))
  const [autor, setAutor] = useState(config.autorPodeAprovar)
  const [dias, setDias] = useState(String(config.recorrentesDias))
  const [pend, start] = useTransition()
  const salvar = () => start(async () => {
    const r = await salvarConfigFinanceiro({ ativa, ate, altoAcima: alto, autorPodeAprovar: autor, recorrentesDias: dias })
    if ('error' in r) { toast.error(r.error); return }
    toast.success('Configuração salva')
    router.refresh()
  })
  return (
    <div className="space-y-3 text-[13px]">
      <label className="flex items-center gap-2"><input type="checkbox" checked={ativa} disabled={!podeEditar} onChange={(e) => setAtiva(e.target.checked)} />
        <span className="font-medium text-text">Exigir aprovação antes de pagar</span></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={rotulo}><span>Até este valor não precisa aprovar (R$)</span>
          <input inputMode="decimal" className={campo} value={ate} disabled={!podeEditar} onChange={(e) => setAte(e.target.value)} /><PreviaMoeda texto={ate} /></label>
        <label className={rotulo}><span>Acima deste valor só admin/dono aprova (R$)</span>
          <input inputMode="decimal" className={campo} value={alto} disabled={!podeEditar} onChange={(e) => setAlto(e.target.value)} /><PreviaMoeda texto={alto} /></label>
        <label className={rotulo}><span>Recorrentes: gerar contas dos próximos (dias)</span>
          <input inputMode="numeric" className={campo} value={dias} disabled={!podeEditar} onChange={(e) => setDias(e.target.value)} /></label>
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={autor} disabled={!podeEditar} onChange={(e) => setAutor(e.target.checked)} />
          <span>Quem lançou a conta pode aprová-la</span></label>
      </div>
      <p className="text-text-muted">Entre os dois valores, o gerente aprova. Vale para toda conta nova (manual, da nota e recorrente), pelo valor de cada conta. Ligar não muda as contas que já existem; desligar não libera as que estão aguardando.</p>
      {podeEditar && <button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend && <Spinner />}Salvar configuração</button>}
    </div>
  )
}

// --------------------------------------------------------------------------------------------- aprovar / reprovar
export function DecidirAprovacao({ tituloId, rotulo: rot }: { tituloId: number; rotulo: string }) {
  const router = useRouter()
  const [motivo, setMotivo] = useState('')
  const [pend, start] = useTransition()
  const decidir = (acao: 'aprovar' | 'reprovar') => {
    if (acao === 'reprovar' && motivo.trim().length < 3) { toast.error('Escreva o motivo da reprovação.'); return }
    if (acao === 'reprovar' && !window.confirm(`Reprovar ${rot}? Ela não poderá ser paga.`)) return
    start(async () => {
      const r = await decidirAprovacaoTitulo(tituloId, acao, motivo)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(acao === 'aprovar' ? 'Conta aprovada: já pode ser paga' : 'Conta reprovada')
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btnClass('primary')} disabled={pend} onClick={() => decidir('aprovar')}>{pend && <Spinner />}Aprovar</button>
      <input aria-label="Motivo da reprovação" className={`${campo} max-w-[260px]`} placeholder="Motivo (para reprovar)" value={motivo}
        onChange={(e) => setMotivo(e.target.value)} maxLength={300} disabled={pend} />
      <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => decidir('reprovar')}>Reprovar</button>
    </div>
  )
}

export function ConfirmarValor({ tituloId, valorAtual }: { tituloId: number; valorAtual: number }) {
  const router = useRouter()
  const [valor, setValor] = useState(reais(Math.round(valorAtual * 100)))
  const [pend, start] = useTransition()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Valor de verdade" inputMode="decimal" className={`${campo} max-w-[160px]`} value={valor} onChange={(e) => setValor(e.target.value)} />
      <PreviaMoeda texto={valor} />
      <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => start(async () => {
        const r = await confirmarValorTitulo(tituloId, valor)
        if ('error' in r) { toast.error(r.error); return }
        toast.success('Valor confirmado')
        router.refresh()
      })}>{pend && <Spinner />}Confirmar valor</button>
    </div>
  )
}

// --------------------------------------------------------------------------------------------------------- recorrentes
export function FormRecorrente({ recorrente, fornecedores, categorias, hoje, children }: {
  recorrente?: Recorrente; fornecedores: Opcao[]; categorias: Opcao[]; hoje: string; children: React.ReactNode
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const ini = () => ({
    descricao: recorrente?.descricao ?? '', fornecedorId: recorrente ? String(recorrente.fornecedor_id) : '',
    categoriaId: recorrente?.categoria_id ? String(recorrente.categoria_id) : '', documento: recorrente?.documento ?? '',
    valor: recorrente ? reais(Math.round(recorrente.valor * 100)) : '', estimado: recorrente?.valor_estimado ?? false,
    periodicidade: (recorrente?.periodicidade ?? 'mensal') as Periodicidade, dia: String(recorrente?.dia ?? 10),
    inicio: recorrente?.data_inicio ?? hoje, fim: recorrente?.data_fim ?? '', ativa: recorrente?.ativa ?? true, obs: recorrente?.observacao ?? '',
  })
  const [f, setF] = useState(ini)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const set = <K extends keyof ReturnType<typeof ini>>(k: K, v: ReturnType<typeof ini>[K]) => setF((x) => ({ ...x, [k]: v }))
  const salvar = () => {
    const invalido = validarRecorrente({ descricao: f.descricao, fornecedorId: Number(f.fornecedorId), valorCent: paraCentavos(f.valor),
      periodicidade: f.periodicidade, dia: Number(f.dia), inicio: f.inicio, fim: f.fim || null })
    if (invalido) { setErro(invalido); return }
    setErro(null)
    start(async () => {
      const r = await salvarRecorrente({ id: recorrente?.id ?? null, descricao: f.descricao, fornecedorId: Number(f.fornecedorId),
        categoriaId: f.categoriaId ? Number(f.categoriaId) : null, documento: f.documento, valor: f.valor, valorEstimado: f.estimado,
        periodicidade: f.periodicidade, dia: Number(f.dia), inicio: f.inicio, fim: f.fim || null, ativa: f.ativa, observacao: f.obs })
      if ('error' in r) { setErro(r.error); return }
      toast.success(recorrente ? 'Recorrente atualizada' : 'Recorrente criada: as contas saem no próximo "Gerar contas" (ou no automático de cada dia)')
      setAberto(false)
      router.refresh()
    })
  }
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) { setF(ini()); setErro(null) } setAberto(o) } }}>
      <DialogTrigger render={<button type="button" className={recorrente ? 'text-[13px] font-medium text-brand hover:underline' : btnClass('primary')}>{children}</button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>{recorrente ? 'Editar conta recorrente' : 'Nova conta recorrente'}</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto text-[13px]">
          <label className={rotulo}><span>Descrição</span><input className={campo} value={f.descricao} maxLength={120} placeholder="Ex.: Aluguel da loja" onChange={(e) => set('descricao', e.target.value)} /></label>
          <label className={rotulo}><span>Fornecedor</span>
            <select className={campo} value={f.fornecedorId} onChange={(e) => set('fornecedorId', e.target.value)}>
              <option value="">Escolha…</option>{fornecedores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select></label>
          <label className={rotulo}><span>Categoria</span>
            <select className={campo} value={f.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
              <option value="">A definir</option>{categorias.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Valor (R$)</span><input inputMode="decimal" className={campo} value={f.valor} onChange={(e) => set('valor', e.target.value)} /><PreviaMoeda texto={f.valor} /></label>
            <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={f.estimado} onChange={(e) => set('estimado', e.target.checked)} /><span>Valor estimado (confirmar antes de pagar)</span></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Repete</span>
              <select className={campo} value={f.periodicidade} onChange={(e) => { const p = e.target.value as Periodicidade; setF((x) => ({ ...x, periodicidade: p, dia: p === 'semanal' ? '1' : '10' })) }}>
                <option value="mensal">Todo mês</option><option value="semanal">Toda semana</option>
              </select></label>
            {f.periodicidade === 'mensal'
              ? <label className={rotulo}><span>Dia do vencimento</span><input inputMode="numeric" className={campo} value={f.dia} onChange={(e) => set('dia', e.target.value)} /></label>
              : <label className={rotulo}><span>Dia da semana</span>
                  <select className={campo} value={f.dia} onChange={(e) => set('dia', e.target.value)}>{OPCOES_DIA_SEMANA.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Início</span><input type="date" className={campo} value={f.inicio} onChange={(e) => set('inicio', e.target.value)} /></label>
            <label className={rotulo}><span>Fim (opcional)</span><input type="date" className={campo} value={f.fim} onChange={(e) => set('fim', e.target.value)} /></label>
          </div>
          <label className={rotulo}><span>Documento (opcional)</span><input className={campo} value={f.documento} maxLength={60} onChange={(e) => set('documento', e.target.value)} /></label>
          <label className={rotulo}><span>Observação</span><input className={campo} value={f.obs} maxLength={300} onChange={(e) => set('obs', e.target.value)} /></label>
          {recorrente && <label className="flex items-center gap-2"><input type="checkbox" checked={f.ativa} onChange={(e) => set('ativa', e.target.checked)} /><span>Ativa (desligada não gera contas novas)</span></label>}
          <p className="text-text-muted">Dia 29, 30 ou 31 em mês mais curto vence no último dia. Mudar aqui não altera as contas já geradas.</p>
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter><button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend && <Spinner />}Salvar</button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GerarRecorrentesBotao() {
  const router = useRouter()
  const [pend, start] = useTransition()
  return (
    <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => start(async () => {
      const r = await gerarRecorrentesAgora()
      if ('error' in r) { toast.error(r.error); return }
      if (r.falhas) toast.error(`${r.falhas} vencimento(s) não geraram conta: veja o aviso na recorrente.`)
      toast.success(r.gerados ? `${r.gerados} conta(s) a pagar gerada(s).` : 'Nada novo: as contas do período já existem.')
      router.refresh()
    })}>{pend && <Spinner />}Gerar contas agora</button>
  )
}

// ------------------------------------------------------------------------------------- lançamento avulso e transferência
export function FormAvulso({ contas, categorias, hoje }: { contas: Opcao[]; categorias: (Opcao & { tipo: 'despesa' | 'receita' })[]; hoje: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<'saida' | 'entrada'>('saida')
  const [conta, setConta] = useState('')
  const [data, setData] = useState(hoje)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState('')
  const [chave, setChave] = useState(() => chaveNova('av'))
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const cats = categorias.filter((c) => c.tipo === (tipo === 'saida' ? 'despesa' : 'receita'))
  const salvar = () => {
    const cat = categorias.find((c) => c.id === Number(categoria))
    const invalido = !conta ? 'Escolha a conta corrente.' : validarLancamento({ tipo, valorCent: paraCentavos(valor), data, hoje, categoriaTipo: cat?.tipo ?? null, descricao })
    if (invalido) { setErro(invalido); return }
    setErro(null)
    start(async () => {
      const r = await registrarLancamentoAvulso({ contaId: Number(conta), data, tipo, valor, descricao, categoriaId: Number(categoria), chave })
      if ('error' in r) { setErro(r.error); return }
      toast.success('Lançamento registrado no extrato')
      setAberto(false)
      router.refresh()
    })
  }
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) { setValor(''); setDescricao(''); setCategoria(''); setData(hoje); setChave(chaveNova('av')); setErro(null) } setAberto(o) } }}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}>Lançamento avulso</button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Lançamento avulso</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Tipo</span>
              <select className={campo} value={tipo} onChange={(e) => { setTipo(e.target.value as 'saida' | 'entrada'); setCategoria('') }}>
                <option value="saida">Saída (despesa)</option><option value="entrada">Entrada (receita)</option></select></label>
            <label className={rotulo}><span>Conta</span>
              <select className={campo} value={conta} onChange={(e) => setConta(e.target.value)}>
                <option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Data</span><input type="date" className={campo} value={data} max={hoje} onChange={(e) => setData(e.target.value)} /></label>
            <label className={rotulo}><span>Valor (R$)</span><input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /><PreviaMoeda texto={valor} /></label>
          </div>
          <label className={rotulo}><span>Descrição</span><input className={campo} value={descricao} maxLength={300} placeholder="Ex.: Gás de cozinha" onChange={(e) => setDescricao(e.target.value)} /></label>
          <label className={rotulo}><span>Categoria</span>
            <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Escolha…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter><button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend && <Spinner />}Registrar</button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FormTransferencia({ contas, hoje }: { contas: Opcao[]; hoje: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [data, setData] = useState(hoje)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [chave, setChave] = useState(() => chaveNova('tr'))
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const salvar = () => {
    const invalido = validarTransferencia({ origemId: Number(origem), destinoId: Number(destino), valorCent: paraCentavos(valor), data, hoje })
    if (invalido) { setErro(invalido); return }
    setErro(null)
    start(async () => {
      const r = await registrarTransferencia({ origemId: Number(origem), destinoId: Number(destino), data, valor, descricao, chave, hoje })
      if ('error' in r) { setErro(r.error); return }
      toast.success('Transferência registrada: saiu de uma conta e entrou na outra')
      setAberto(false)
      router.refresh()
    })
  }
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) { setValor(''); setDescricao(''); setData(hoje); setChave(chaveNova('tr')); setErro(null) } setAberto(o) } }}>
      <DialogTrigger render={<button type="button" className={btnClass('outline')}>Transferência entre contas</button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Transferência entre contas</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>De</span>
              <select className={campo} value={origem} onChange={(e) => setOrigem(e.target.value)}>
                <option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <label className={rotulo}><span>Para</span>
              <select className={campo} value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Escolha…</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Data</span><input type="date" className={campo} value={data} max={hoje} onChange={(e) => setData(e.target.value)} /></label>
            <label className={rotulo}><span>Valor (R$)</span><input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /><PreviaMoeda texto={valor} /></label>
          </div>
          <label className={rotulo}><span>Descrição (opcional)</span><input className={campo} value={descricao} maxLength={200} placeholder="Ex.: Depósito do caixa" onChange={(e) => setDescricao(e.target.value)} /></label>
          <p className="text-text-muted">Não entra na DRE: o total das contas da loja não muda.</p>
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter><button type="button" className={btnClass('primary')} disabled={pend} onClick={salvar}>{pend && <Spinner />}Transferir</button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const EstornarAvulso = ({ id }: { id: number }) => (
  <PedeMotivo rotuloBotao="Estornar" confirmar="Confirmar estorno" sucesso="Lançamento estornado" aoConcluir={(m) => estornarLancamentoAvulso(id, m)} />
)
export const EstornarTransferencia = ({ id }: { id: number }) => (
  <PedeMotivo rotuloBotao="Estornar" confirmar="Confirmar estorno" sucesso="Transferência estornada" aoConcluir={(m) => estornarTransferencia(id, m)} />
)
