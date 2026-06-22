import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type EtiquetaConfig,
  type CampoEtiqueta,
  ORDEM_CAMPOS_PADRAO,
  LARGURA_CM_PADRAO,
  ALTURA_CM_PADRAO,
} from '@/components/etiqueta/EtiquetaPDF'

// Linha crua da tabela etiqueta_config (snake_case do banco).
export interface EtiquetaConfigRow {
  loja_id: number
  nome_exibido: string | null
  mostrar_fabricacao: boolean
  mostrar_validade: boolean
  mostrar_qtde_nf: boolean
  mostrar_qtde_etiqueta: boolean
  mostrar_lote: boolean
  mostrar_recebido: boolean
  mostrar_fornecedor: boolean
  mostrar_cnpj: boolean
  ordem_campos: string[]
  fonte_escala: number
  negrito_nome: boolean
  negrito_descricao: boolean
  cor_destaque: string | null
  mostrar_logo: boolean
  mostrar_borda: boolean
  largura_cm: number
  altura_cm: number
  offset_x: number
  offset_y: number
}

// Valores padrão (espelham os defaults do banco) — usados quando a loja ainda
// não salvou nada e como base do formulário do admin.
export const ETIQUETA_FORM_PADRAO = {
  nome_exibido: '',
  mostrar_fabricacao: true,
  mostrar_validade: true,
  mostrar_qtde_nf: true,
  mostrar_qtde_etiqueta: true,
  mostrar_lote: true,
  mostrar_recebido: true,
  mostrar_fornecedor: true,
  mostrar_cnpj: true,
  ordem_campos: [...ORDEM_CAMPOS_PADRAO] as string[],
  fonte_escala: 1.0,
  negrito_nome: true,
  negrito_descricao: true,
  cor_destaque: '' as string,
  mostrar_logo: true,
  mostrar_borda: false,
  largura_cm: LARGURA_CM_PADRAO,
  altura_cm: ALTURA_CM_PADRAO,
  offset_x: 0,
  offset_y: 0,
}
export type EtiquetaFormValores = typeof ETIQUETA_FORM_PADRAO

// Linha do banco -> config do PDF (camelCase). null vira undefined p/ usar default.
export function rowParaConfig(r: Partial<EtiquetaConfigRow>): EtiquetaConfig {
  return {
    nomeExibido: r.nome_exibido ?? undefined,
    larguraCm: r.largura_cm != null ? Number(r.largura_cm) : undefined,
    alturaCm: r.altura_cm != null ? Number(r.altura_cm) : undefined,
    offsetX: r.offset_x != null ? Number(r.offset_x) : undefined,
    offsetY: r.offset_y != null ? Number(r.offset_y) : undefined,
    corDestaque: r.cor_destaque ?? null,
    fonteEscala: r.fonte_escala != null ? Number(r.fonte_escala) : undefined,
    negritoNome: r.negrito_nome ?? undefined,
    negritoDescricao: r.negrito_descricao ?? undefined,
    mostrarLogo: r.mostrar_logo ?? undefined,
    mostrarBorda: r.mostrar_borda ?? undefined,
    ordemCampos: Array.isArray(r.ordem_campos) ? (r.ordem_campos as CampoEtiqueta[]) : undefined,
    mostrarFabricacao: r.mostrar_fabricacao ?? undefined,
    mostrarValidade: r.mostrar_validade ?? undefined,
    mostrarQtdeNf: r.mostrar_qtde_nf ?? undefined,
    mostrarQtdeEtiqueta: r.mostrar_qtde_etiqueta ?? undefined,
    mostrarLote: r.mostrar_lote ?? undefined,
    mostrarRecebido: r.mostrar_recebido ?? undefined,
    mostrarFornecedor: r.mostrar_fornecedor ?? undefined,
    mostrarCnpj: r.mostrar_cnpj ?? undefined,
  }
}

// Carrega o padrão da loja (vazio = usa todos os defaults do PDF).
export async function carregarEtiquetaConfig(
  supabase: SupabaseClient,
  lojaId: number,
): Promise<EtiquetaConfig> {
  const { data } = await supabase.from('etiqueta_config').select('*').eq('loja_id', lojaId).maybeSingle()
  return data ? rowParaConfig(data as EtiquetaConfigRow) : {}
}

// Form do admin -> config do PDF (para a prévia ao vivo, sem ir ao banco).
export function formParaConfig(f: EtiquetaFormValores): EtiquetaConfig {
  return rowParaConfig({
    ...f,
    cor_destaque: f.cor_destaque || null,
  })
}

// Linha do banco -> valores concretos do formulário (sem undefined).
export function rowParaForm(r: EtiquetaConfigRow): EtiquetaFormValores {
  return {
    nome_exibido: r.nome_exibido ?? '',
    mostrar_fabricacao: r.mostrar_fabricacao,
    mostrar_validade: r.mostrar_validade,
    mostrar_qtde_nf: r.mostrar_qtde_nf,
    mostrar_qtde_etiqueta: r.mostrar_qtde_etiqueta,
    mostrar_lote: r.mostrar_lote,
    mostrar_recebido: r.mostrar_recebido,
    mostrar_fornecedor: r.mostrar_fornecedor,
    mostrar_cnpj: r.mostrar_cnpj,
    ordem_campos: r.ordem_campos?.length ? r.ordem_campos : [...ORDEM_CAMPOS_PADRAO],
    fonte_escala: Number(r.fonte_escala),
    negrito_nome: r.negrito_nome,
    negrito_descricao: r.negrito_descricao,
    cor_destaque: r.cor_destaque ?? '',
    mostrar_logo: r.mostrar_logo,
    mostrar_borda: r.mostrar_borda,
    largura_cm: Number(r.largura_cm),
    altura_cm: Number(r.altura_cm),
    offset_x: Number(r.offset_x),
    offset_y: Number(r.offset_y),
  }
}
