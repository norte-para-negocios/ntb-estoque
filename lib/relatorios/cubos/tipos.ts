import type { Layout, Linha } from '../pivot.ts'

export type TipoCampo = 'texto' | 'numero' | 'moeda' | 'data'
export type CampoCubo = { id: string; tipo: TipoCampo; grupo: string; /** Campo que só faz sentido como medida (valores). */ medida?: boolean }
/** O id do campo É o rótulo do Omie (ex.: "Fornecedor/Cliente (Nome Fantasia)"): a equipe acha o que já conhece. */
export type Cubo = { id: string; titulo: string; campos: CampoCubo[]; linhaDoCubo: (linhaRpc: Record<string, unknown>) => Linha }

export type FamiliaRelatorio = 'Compras' | 'Estoque' | 'Produção' | 'Vendas' | 'Financeiro' | 'Fiscal'
export type PresetRelatorio = {
  /** Slug do relatório no Omie (omie-rea/relatorios/<MOD>/<slug>). */
  slugOmie: string
  titulo: string
  /** A pergunta que o relatório responde (aparece no cartão do hub). */
  pergunta: string
  familia: FamiliaRelatorio
  cubo: string
  layout: Layout
  /** 1 = disponível agora; 2+ = fases seguintes do plano (aparece "em breve"). */
  fase: 1 | 2 | 3 | 4 | 5
}
