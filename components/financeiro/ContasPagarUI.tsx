'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Combobox } from '@/components/ui-kit/Combobox'
import { Money } from '@/components/ui-kit/Money'
import { Spinner } from '@/components/ui-kit/Spinner'
import { cancelarTituloPagar, estornarPagamentoTitulo, registrarPagamentoTitulo, salvarTituloPagar } from '@/lib/actions/financeiro'
import { calcularPagamento, paraCentavos } from '@/lib/financeiro/titulo-puro'
import { campo, chaveNova, PreviaMoeda, rotulo } from './comum'

export type OpcaoFornecedor = { id: number; nome: string }
export type OpcaoCategoria = { id: number; nome: string }
export type OpcaoConta = { id: number; nome: string }

export type DadosTitulo = {
  id: number; fornecedor_id: number; documento: string | null; valor: number; valor_quitado: number; data_emissao: string | null
  data_vencimento: string; data_competencia: string; categoria_id: number | null; observacao: string | null; status: string
}

const FORMAS = ['', 'Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão', 'Débito em conta', 'Outra']
const numTxt = (n: number) => String(n).replace('.', ',')

// ---------------------------------------------------------------------------------------------- incluir / editar
export function FormTitulo({ titulo, fornecedores, categorias, hoje, children, paginaCheia }: {
  titulo?: DadosTitulo; fornecedores: OpcaoFornecedor[]; categorias: OpcaoCategoria[]; hoje: string; children?: React.ReactNode
  /** Página própria de "Incluir": o formulário já nasce aberto e, ao salvar ou fechar, volta para a lista. */
  paginaCheia?: boolean
}) {
  const router = useRouter()
  const pago = titulo?.status === 'pago'
  const comPagamento = (titulo?.valor_quitado ?? 0) > 0
  const [aberto, setAberto] = useState(!!paginaCheia)
  const [forn, setForn] = useState(titulo ? String(titulo.fornecedor_id) : '')
  const [doc, setDoc] = useState(titulo?.documento ?? '')
  const [valor, setValor] = useState(titulo ? numTxt(titulo.valor) : '')
  const [emissao, setEmissao] = useState(titulo?.data_emissao ?? '')
  const [venc, setVenc] = useState(titulo?.data_vencimento ?? hoje)
  const [comp, setComp] = useState(titulo ? titulo.data_competencia.slice(0, 7) : '')
  const [cat, setCat] = useState(titulo?.categoria_id ? String(titulo.categoria_id) : '')
  const [obs, setObs] = useState(titulo?.observacao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave, setChave] = useState(() => chaveNova('cp'))
  // Chave nova sempre que os dados mudam: a mesma chave só vale para reenviar EXATAMENTE os mesmos dados (o servidor recusa o resto).
  useEffect(() => { setChave(chaveNova('cp')) }, [forn, doc, valor, emissao, venc, comp, cat, obs])

  function reiniciar() {
    setForn(titulo ? String(titulo.fornecedor_id) : ''); setDoc(titulo?.documento ?? ''); setValor(titulo ? numTxt(titulo.valor) : '')
    setEmissao(titulo?.data_emissao ?? ''); setVenc(titulo?.data_vencimento ?? hoje); setComp(titulo ? titulo.data_competencia.slice(0, 7) : '')
    setCat(titulo?.categoria_id ? String(titulo.categoria_id) : ''); setObs(titulo?.observacao ?? ''); setErro(null)
  }

  function salvar() {
    setErro(null)
    start(async () => {
      const r = await salvarTituloPagar({
        id: titulo?.id ?? null, fornecedorId: Number(forn), documento: doc, valor, dataEmissao: emissao, dataVencimento: venc,
        competencia: comp, categoriaId: cat ? Number(cat) : null, observacao: obs, chave,
      })
      if ('error' in r) { setErro(r.error); return }
      toast.success(titulo ? `Título nº ${r.numero} atualizado` : `Título nº ${r.numero} lançado`)
      setAberto(false)
      if (!titulo) { setForn(''); setDoc(''); setValor(''); setObs(''); setCat(''); setChave(chaveNova('cp')) }
      if (paginaCheia) router.push('/financeiro/contas-pagar')
      else router.refresh()
    })
  }
  const valido = !!forn && paraCentavos(valor) > 0 && !!venc

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) reiniciar(); setAberto(o); setErro(null); if (!o && paginaCheia) router.push('/financeiro/contas-pagar') } }}>
      {!paginaCheia && <DialogTrigger render={<button type="button" className={titulo ? 'text-[13px] font-medium text-brand hover:underline' : btnClass('primary')}>{children}</button>} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo ? 'Editar conta a pagar' : 'Nova conta a pagar'}</DialogTitle>
          {titulo && comPagamento && <p className="text-[13px] text-text-muted">Já há pagamento registrado: o valor não pode ficar abaixo do que foi pago e o fornecedor não muda.</p>}
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto text-[13px]">
          <div className={rotulo}><span>Fornecedor</span>
            {comPagamento
              ? <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2">{fornecedores.find((f) => String(f.id) === forn)?.nome ?? '—'}</p>
              : <>
                  <Combobox options={fornecedores.map((f) => ({ value: String(f.id), label: f.nome }))} value={forn} onChange={setForn} placeholder="Escolha um fornecedor do cadastro" />
                  {fornecedores.length === 0 && <p className="text-text-muted">Nenhum fornecedor no cadastro. <Link href="/fornecedor?criar=1" className="font-medium text-brand underline">Novo fornecedor</Link></p>}
                </>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Valor (R$)</span><input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" disabled={pago} /><PreviaMoeda texto={valor} /></label>
            <label className={rotulo}><span>Documento</span><input className={campo} value={doc} onChange={(e) => setDoc(e.target.value)} maxLength={60} placeholder="Nº da nota ou boleto" /></label>
            <label className={rotulo}><span>Vencimento</span><input type="date" className={campo} value={venc} onChange={(e) => setVenc(e.target.value)} disabled={pago} /></label>
            <label className={rotulo}><span>Competência</span><input type="month" className={campo} value={comp} onChange={(e) => setComp(e.target.value)} /></label>
            <label className={rotulo}><span>Emissão (opcional)</span><input type="date" className={campo} value={emissao} onChange={(e) => setEmissao(e.target.value)} /></label>
            <label className={rotulo}><span>Categoria</span>
              <select className={campo} value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">— sem categoria —</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          </div>
          <label className={rotulo}><span>Observação</span><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></label>
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || !valido} onClick={salvar}>{pend && <Spinner />}Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------- registrar pagamento
export function BotaoPagar({ tituloId, rotuloTitulo, restante, contas, hoje, children }: {
  tituloId: number; rotuloTitulo: string; restante: number; contas: OpcaoConta[]; hoje: string; children: React.ReactNode
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [conta, setConta] = useState(contas[0] ? String(contas[0].id) : '')
  const [data, setData] = useState(hoje)
  const [principal, setPrincipal] = useState(numTxt(restante))
  const [juros, setJuros] = useState('')
  const [desconto, setDesconto] = useState('')
  const [forma, setForma] = useState('')
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pend, start] = useTransition()
  const [chave, setChave] = useState(() => chaveNova('pg'))
  useEffect(() => { setChave(chaveNova('pg')) }, [conta, data, principal, juros, desconto, forma, obs])

  // Reabrir sempre começa limpo e com o saldo que falta AGORA (o título pode ter mudado desde a última vez).
  function reiniciar() {
    setConta(contas[0] ? String(contas[0].id) : ''); setData(hoje); setPrincipal(numTxt(restante)); setJuros(''); setDesconto('')
    setForma(''); setObs(''); setErro(null)
  }

  const restanteCent = Math.round(restante * 100)
  const conf = calcularPagamento({
    restanteCent, principalCent: paraCentavos(principal), jurosCent: juros.trim() ? paraCentavos(juros) : 0, descontoCent: desconto.trim() ? paraCentavos(desconto) : 0,
  })

  function pagar() {
    setErro(null)
    start(async () => {
      const r = await registrarPagamentoTitulo({ tituloId, contaId: Number(conta), dataPagamento: data, valorPrincipal: principal, juros, desconto, forma, observacao: obs, chave })
      if ('error' in r) { setErro(r.error); return }
      toast.success(r.status === 'pago' ? 'Pagamento registrado: título quitado' : 'Pagamento parcial registrado')
      setAberto(false)
      setChave(chaveNova('pg'))
      router.refresh()
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!pend) { if (o) reiniciar(); setAberto(o); setErro(null) } }}>
      <DialogTrigger render={<button type="button" className="text-[13px] font-medium text-brand hover:underline">{children}</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <p className="text-[13px] text-text-muted">{rotuloTitulo} · falta pagar <Money value={restante} />. Só registra: o Norte não faz o pagamento no banco.</p>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-auto text-[13px]">
          {contas.length === 0 && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 text-warn">Cadastre uma conta corrente ativa antes de registrar pagamentos. <Link href="/financeiro/contas-correntes?criar=1" className="font-medium underline">Nova conta corrente</Link></p>}
          <label className={rotulo}><span>Saiu de qual conta</span>
            <select className={campo} value={conta} onChange={(e) => setConta(e.target.value)}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={rotulo}><span>Data do pagamento</span><input type="date" className={campo} value={data} max={hoje} onChange={(e) => setData(e.target.value)} /></label>
            <label className={rotulo}><span>Forma</span>
              <select className={campo} value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS.map((f) => <option key={f} value={f}>{f || '—'}</option>)}</select>
            </label>
            <label className={rotulo}><span>Valor quitado do título (R$)</span><input inputMode="decimal" className={campo} value={principal} onChange={(e) => setPrincipal(e.target.value)} /><PreviaMoeda texto={principal} /></label>
            <span />
            <label className={rotulo}><span>Juros / multa (R$)</span><input inputMode="decimal" className={campo} value={juros} onChange={(e) => setJuros(e.target.value)} placeholder="0,00" /><PreviaMoeda texto={juros} /></label>
            <label className={rotulo}><span>Desconto (R$)</span><input inputMode="decimal" className={campo} value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /><PreviaMoeda texto={desconto} /></label>
          </div>
          <label className={rotulo}><span>Observação</span><input className={campo} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} /></label>
          {conf.ok
            ? <p className="rounded-[var(--r-md)] bg-surface-2 p-2">Sai da conta <strong><Money value={conf.pagoCent / 100} /></strong> · {conf.restanteDepoisCent === 0 ? 'o título fica pago' : <>ainda faltam <Money value={conf.restanteDepoisCent / 100} /></>}</p>
            : <p className="rounded-[var(--r-md)] bg-surface-2 p-2 text-warn">{conf.erro}</p>}
          {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} disabled={pend || !conf.ok || !conta} onClick={pagar}>{pend && <Spinner />}Registrar pagamento</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------------------------------------- cancelar / estornar
function PedeMotivo({ rotuloBotao, confirmar, aoConcluir, sucesso }: {
  rotuloBotao: string; confirmar: string; aoConcluir: (motivo: string) => Promise<{ ok: true } | { error: string }>; sucesso: string
}) {
  const router = useRouter()
  const [abrir, setAbrir] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pend, start] = useTransition()
  if (!abrir) return <button type="button" className="text-[13px] font-medium text-err hover:underline" onClick={() => setAbrir(true)}>{rotuloBotao}</button>
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input className="min-w-[180px] flex-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-1.5 text-[13px]" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" autoFocus />
      <button type="button" className={btnClass('outline')} disabled={pend || motivo.trim().length < 3} onClick={() => start(async () => {
        const r = await aoConcluir(motivo)
        if ('error' in r) toast.error('Não foi possível concluir', { description: r.error })
        else { toast.success(sucesso); setAbrir(false); router.refresh() }
      })}>{pend && <Spinner />}{confirmar}</button>
      <button type="button" className="text-[13px] text-text-muted hover:underline" onClick={() => setAbrir(false)}>voltar</button>
    </span>
  )
}

export const CancelarTitulo = ({ id }: { id: number }) => (
  <PedeMotivo rotuloBotao="Cancelar título" confirmar="Confirmar cancelamento" sucesso="Título cancelado" aoConcluir={(m) => cancelarTituloPagar(id, m)} />
)
export const EstornarPagamento = ({ id }: { id: number }) => (
  <PedeMotivo rotuloBotao="Estornar" confirmar="Confirmar estorno" sucesso="Pagamento estornado: o valor voltou ao extrato" aoConcluir={(m) => estornarPagamentoTitulo(id, m)} />
)

