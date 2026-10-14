import Link from 'next/link'
import { FUNDO_CLASSE, type CorToken } from '@/lib/status-cor'
import { MODULO_LABEL, STATUS_LABEL, opIdDe, type Modulo, type StatusCorrecao } from '@/lib/correcoes/robo'

export type CorrecaoRow = {
  id: number
  loja_id: number
  lote: string
  modulo: Modulo
  acao: string
  produto_cod: string
  produto_desc: string | null
  data_ref: string
  quantidade: number | null
  de_valor: number | null
  para_valor: number | null
  status: StatusCorrecao
  motivo: string | null
  omie_ref: string
  origem_ts: string
  dados: Record<string, unknown> | null
}

const COR_STATUS: Record<StatusCorrecao, CorToken> = {
  ok: 'ok',
  falhou: 'err',
  parado: 'warn',
  pendente_decisao: 'warn',
  desfeito: 'neutro',
}

const fmtNum = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

export function fmtHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function StatusCorrecaoPill({ status }: { status: StatusCorrecao }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
      <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[COR_STATUS[status]]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Produto (link para a lista filtrada) e, quando o robô informou dados.op_id, link da OP. Só navegação: nada escreve no Omie. */
export function ProdutoELinks({ r }: { r: CorrecaoRow }) {
  const opId = opIdDe(r.dados)
  return (
    <div className="min-w-0">
      {r.produto_cod ? (
        <Link href={`/produto?q=${encodeURIComponent(r.produto_cod)}`} className="block truncate text-[14px] font-medium text-text hover:text-brand">
          {r.produto_desc || r.produto_cod}
        </Link>
      ) : (
        <span className="block truncate text-[14px] text-text-muted">{r.produto_desc || 'Sem produto'}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted">
        {r.produto_cod && <span className="num">{r.produto_cod}</span>}
        {opId && (
          <Link href={`/ordem-producao/${opId}`} className="font-medium text-brand hover:underline">
            Ver OP
          </Link>
        )}
      </div>
    </div>
  )
}

export function AntesDepois({ r }: { r: CorrecaoRow }) {
  if (r.de_valor == null && r.para_valor == null) return <span className="text-text-muted">—</span>
  return (
    <span className="num whitespace-nowrap text-[14px]">
      <span className="text-text-muted">{fmtNum(r.de_valor)}</span>
      <span className="px-1 text-text-muted">→</span>
      <span className="font-medium text-text">{fmtNum(r.para_valor)}</span>
    </span>
  )
}

export function Quantidade({ v }: { v: number | null }) {
  return <span className="num text-[14px]">{fmtNum(v)}</span>
}

/** Cartão de uma correção para telas estreitas. */
export function CorrecaoCard({ r, mostrarModulo = false }: { r: CorrecaoRow; mostrarModulo?: boolean }) {
  return (
    <div className="space-y-1.5 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <ProdutoELinks r={r} />
        <StatusCorrecaoPill status={r.status} />
      </div>
      <div className="text-[13px] font-medium text-text">
        {r.acao}
        {mostrarModulo && <span className="font-normal text-text-muted"> · {MODULO_LABEL[r.modulo]}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="text-text-muted">Qtd <Quantidade v={r.quantidade} /></span>
        <span className="text-text-muted">Antes/depois <AntesDepois r={r} /></span>
      </div>
      {r.motivo && <p className="text-[13px] text-text-muted">{r.motivo}</p>}
      <p className="text-[12px] text-text-muted">{fmtHora(r.origem_ts)}</p>
    </div>
  )
}
