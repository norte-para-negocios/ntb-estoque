'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'

export type Ingrediente = { cod: number; nome: string; unidade: string; qtd: number }

export type DetalheOP = {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdPlanejada: number | null
  qtdProduzida: number | null
  dataPrevisao: string | null
  dataConclusao: string | null
  concluida: boolean
  podeReverter: boolean
  ingredientes: Ingrediente[]
}

export async function buscarDetalheOP(opId: number): Promise<{ error: string } | DetalheOP> {
  return { error: 'not implemented' } // substituído na Task 2
}

export type DetalheTransferencia = {
  id: number
  origem: string
  destino: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/transferencia/ContagemTransferencia').ItemMovimento[]
}

export async function buscarDetalheTransferencia(id: number): Promise<{ error: string } | DetalheTransferencia> {
  return { error: 'not implemented' } // substituído na Task 3
}

export type DetalheNotaFiscal = {
  id: string
  numero: string | null
  razaoSocial: string | null
  dataEmissao: string | null
  valor: number | null
  statusLabel: string
  statusTom: 'ok' | 'warn' | 'err'
  chaveNfe: string | null
  itens: import('@/components/nota-fiscal/ItensNotaFiscal').ItemNF[]
  categorias: { id: number; nome: string }[]
}

export async function buscarDetalheNotaFiscal(id: string): Promise<{ error: string } | DetalheNotaFiscal> {
  return { error: 'not implemented' } // substituído na Task 4
}

export type DetalheInventario = {
  id: number
  local: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/inventario/ContagemInventario').ItemContagem[]
}

export async function buscarDetalheInventario(id: number): Promise<{ error: string } | DetalheInventario> {
  return { error: 'not implemented' } // substituído na Task 5
}
