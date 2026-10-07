// Constantes e tipos do kardex que as telas (client) também usam: nada aqui importa código de servidor.

export type LinhaKardex = {
  id: number
  quando: string
  data_ref: string
  tipo: string
  origem: string
  ref: string
  linha: number
  quantidade: number
  custo: number | null
  saldo_apos: number
  user_id: string | null
  user_nome: string | null
  obs: string | null
  codigo_local: number
  local_nome: string | null
  codigo_produto: number
  codigo: string | null
  descricao: string | null
  unidade: string | null
  reverses_id: number | null
  estornado_por: number | null
  transferencia_ref: string | null
  custo_estimado: boolean
}

export const hojeBahia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

export const ROTULO_TIPO: Record<string, string> = { ENT: 'Entrada', SAI: 'Saída', AJU: 'Ajuste', TRF: 'Transferência', PRD: 'Produção', EST: 'Estorno' }
export const ROTULO_ORIGEM: Record<string, string> = {
  VENDA: 'Venda', COMPRA: 'Compra', PRODUCAO: 'Produção', TRANSFERENCIA: 'Transferência', AJUSTE: 'Ajuste manual',
  MANUAL: 'Ajuste manual', SALDO_INICIAL: 'Saldo inicial', INVENTARIO: 'Inventário', ESTORNO: 'Estorno',
}
export const OPCOES_ORIGEM = ['VENDA', 'COMPRA', 'PRODUCAO', 'TRANSFERENCIA', 'AJUSTE', 'INVENTARIO', 'ESTORNO']

/** Atalhos de período (datas YYYY-MM-DD em America/Bahia). */
export function atalhosPeriodo(hoje = hojeBahia()): { chave: string; label: string; ini: string; fim: string }[] {
  const d = new Date(hoje + 'T12:00:00')
  const somar = (dias: number) => {
    const x = new Date(d)
    x.setDate(x.getDate() - dias)
    return x.toLocaleDateString('en-CA')
  }
  const [y, m] = hoje.split('-')
  return [
    { chave: 'hoje', label: 'Hoje', ini: hoje, fim: hoje },
    { chave: '7d', label: '7 dias', ini: somar(6), fim: hoje },
    { chave: '30d', label: '30 dias', ini: somar(29), fim: hoje },
    { chave: 'mes', label: 'Este mês', ini: `${y}-${m}-01`, fim: hoje },
    { chave: 'ano', label: 'Este ano', ini: `${y}-01-01`, fim: hoje },
  ]
}
