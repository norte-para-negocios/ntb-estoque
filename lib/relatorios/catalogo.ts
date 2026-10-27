// Catálogo dos relatórios do Omie no Norte Estoque: cada relatório é um preset (cubo + layout inicial).
// Fase 1 = Recebimentos (NF de entrada); as demais famílias entram por fase (ver omie-pendentes.ts e o plano).
import type { Layout, Medida } from './pivot.ts'
import type { PresetRelatorio } from './cubos/tipos.ts'
import { CUBO_RECEBIMENTOS } from './cubos/recebimentos'
import { PENDENTES_OMIE } from './omie-pendentes'

export const CUBOS = { recebimentos: CUBO_RECEBIMENTOS } as const
export type IdCubo = keyof typeof CUBOS

const soma = (campo: string): Medida => ({ campo, agg: 'soma' })
// As mesmas medidas que o Omie mostra por padrão nos relatórios de recebimento (as demais ficam disponíveis no painel de campos).
const MEDIDAS_RECEBIMENTO = ['Total de Mercadoria', 'Desconto', 'Frete', 'Seguro', 'Outras Despesas Acessórias', 'Valor do IPI', 'Valor do ICMS ST', 'Total do Documento Fiscal', 'Valor do ICMS', 'Valor do PIS', 'Valor do COFINS'].map(soma)
const MEDIDAS_RECEBIMENTO_PRODUTO = [soma('Quantidade'), ...MEDIDAS_RECEBIMENTO]

// O Omie mostra só notas válidas: sai a cancelada, e o resto (concluída, pendente, a conferir…) fica.
const semCanceladas = { Situação: ['Cancelada'] }
const recebimento = (linhas: string[], medidas = MEDIDAS_RECEBIMENTO): Layout => ({ linhas, colunas: [], medidas, filtros: {}, exceto: semCanceladas })

const REC = { cubo: 'recebimentos', familia: 'Compras', fase: 1 } as const

export const PRESETS: PresetRelatorio[] = [
  { ...REC, slugOmie: 'rel-com-recebimentos-por-periodo', titulo: 'Recebimentos por Período', pergunta: 'O que entrou, dia a dia?',
    layout: recebimento(['Data de Registro (completa)', 'Fornecedor/Cliente (Nome Fantasia)', 'Nota Fiscal']) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-mesano', titulo: 'Recebimentos por Mês/Ano', pergunta: 'Quanto entrou em cada mês?',
    layout: recebimento(['Data de Registro.Ano', 'Data de Registro.Mês', 'Fornecedor/Cliente (Nome Fantasia)', 'Nota Fiscal']) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-fornecedor', titulo: 'Recebimentos por Fornecedor', pergunta: 'De quem eu mais comprei?',
    layout: recebimento(['Fornecedor/Cliente (Nome Fantasia)', 'Data de Registro (completa)', 'Nota Fiscal']) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-produto', titulo: 'Recebimentos por Produto', pergunta: 'Quanto comprei de cada produto?',
    layout: recebimento(['Descrição do Produto (completa)', 'Unidade', 'Data de Registro (completa)', 'Fornecedor/Cliente (Nome Fantasia)', 'Nota Fiscal'], MEDIDAS_RECEBIMENTO_PRODUTO) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-categoria', titulo: 'Recebimentos por Categoria', pergunta: 'Em que categoria foi o gasto?',
    layout: recebimento(['Categoria', 'Descrição do Produto (completa)', 'Data de Registro (completa)', 'Fornecedor/Cliente (Nome Fantasia)', 'Nota Fiscal']) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-departamento', titulo: 'Recebimentos por Departamento', pergunta: 'Qual departamento gastou?',
    layout: recebimento(['Departamento', 'Fornecedor/Cliente (Nome Fantasia)', 'Data de Registro (completa)', 'Nota Fiscal']) },
  { ...REC, slugOmie: 'rel-com-recebimentos-por-projeto', titulo: 'Recebimentos por Projeto', pergunta: 'Quanto cada projeto consumiu?',
    layout: recebimento(['Projeto', 'Descrição do Produto (completa)', 'Data de Registro (completa)', 'Fornecedor/Cliente (Nome Fantasia)', 'Nota Fiscal']) },
  // sic: o Omie grafa "trasnportadora" no slug do menu
  { ...REC, slugOmie: 'rel-com-recebimentos-por-trasnportadora', titulo: 'Recebimentos por Transportadora', pergunta: 'Quanto de frete por transportadora?',
    layout: recebimento(['Transportadora (Nome Fantasia)', 'Data de Registro (completa)', 'Nota Fiscal']) },
]

export function presetPorSlug(slug: string): PresetRelatorio | undefined {
  return PRESETS.find((p) => p.slugOmie === slug)
}

/** Tudo que o Omie tem e ainda não entrou, para o hub mostrar "em breve". */
export const EM_BREVE = PENDENTES_OMIE
