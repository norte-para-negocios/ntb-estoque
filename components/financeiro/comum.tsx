import { FUNDO_CLASSE, type CorToken } from '@/lib/status-cor'
import { previaMoeda, ROTULO_SITUACAO, type SituacaoTitulo } from '@/lib/financeiro/titulo-puro'

export const campo = 'w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[14px] text-text'
export const rotulo = 'block space-y-1 text-[13px]'

/** Mostra como o texto digitado será lido ("= R$ 1.500,00"); avisa se não for um valor claro. */
export function PreviaMoeda({ texto }: { texto: string }) {
  if (!texto.trim()) return null
  const p = previaMoeda(texto)
  return p ? <span className="text-text-muted">= {p}</span> : <span className="text-err">Valor não reconhecido (use 1.500,00)</span>
}

export const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
export const mesBR = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')
export const chaveNova = (prefixo: string) => `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const COR: Record<SituacaoTitulo, CorToken> = { aberto: 'info', parcial: 'warn', pago: 'ok', atrasado: 'err', cancelado: 'neutro' }

export function SituacaoSelo({ situacao }: { situacao: SituacaoTitulo }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
      <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[COR[situacao]]}`} />
      {ROTULO_SITUACAO[situacao]}
    </span>
  )
}

export const OPCOES_SITUACAO: { value: string; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'em_aberto', label: 'Em aberto (inclui atrasadas)' },
  { value: 'atrasado', label: 'Atrasadas' },
  { value: 'aberto', label: 'Em dia' },
  { value: 'parcial', label: 'Pagas em parte' },
  { value: 'pago', label: 'Pagas' },
  { value: 'cancelado', label: 'Canceladas' },
]

export const GRUPOS_DRE: { value: string; label: string }[] = [
  { value: 'receita_bruta', label: 'Receita bruta' },
  { value: 'deducoes', label: 'Deduções (impostos sobre vendas)' },
  { value: 'cmv', label: 'Custo das mercadorias (CMV)' },
  { value: 'despesa_operacional', label: 'Despesas operacionais' },
  { value: 'despesa_pessoal', label: 'Despesas com pessoal' },
  { value: 'despesa_administrativa', label: 'Despesas administrativas' },
  { value: 'despesa_financeira', label: 'Despesas financeiras' },
  { value: 'receita_financeira', label: 'Receitas financeiras' },
  { value: 'imposto_resultado', label: 'Impostos sobre o resultado' },
  { value: 'investimento', label: 'Investimentos' },
  { value: 'outras', label: 'Outras' },
]
export const rotuloGrupoDre = (v: string) => GRUPOS_DRE.find((g) => g.value === v)?.label ?? v
