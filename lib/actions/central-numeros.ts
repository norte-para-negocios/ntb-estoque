'use server'

// Números do dia do menu novo (só desenvolvedores). Só leitura, contagens com `head: true` (nada de linhas
// trafegando); cada uma isolada: se uma falhar, só aquela tela fica sem número.

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { exigirDevAcao } from '@/lib/recursos-dev'
import { hojeBahia } from '@/lib/resumo-dia'
import { addDias } from '@/lib/faturamento-dias'
import { montarNumeros, type Numeros } from '@/lib/central/numeros'

type Res = { count: number | null; error: unknown }

export async function numerosDaCentral(): Promise<Numeros> {
  await exigirDevAcao()
  const lojaId = await getCurrentLojaId()
  const db = createServiceClient()
  const hoje = hojeBahia()

  const contar = async (p: PromiseLike<Res>): Promise<number | null> => {
    try {
      const { count, error } = await p
      return error ? null : count
    } catch {
      return null
    }
  }

  const [produtosAtivos, inventariosAbertos, transferenciasAbertas, lotes, lotesVencendo, notasEsperando, opsAbertas, opsConcluidasHoje] =
    await Promise.all([
      contar(db.from('produtos').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).or('inativo.is.null,inativo.eq.false')),
      contar(db.from('inventarios').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('status', 'Em contagem')),
      contar(db.from('transferencias').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('status', 'Em contagem')),
      contar(db.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)),
      contar(
        db.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).gt('saldo', 0).lte('validade', addDias(hoje, 7))
      ),
      // Mesma janela da Central de correções: nota antiga parada não acende o alerta para sempre.
      contar(
        db.from('notas_fiscais').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('c_etapa', '40').is('deleted_at', null).gte('d_emissao_nfe', addDias(hoje, -30))
      ),
      contar(db.from('ordens_producao').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('concluida', false)),
      contar(db.from('ordens_producao').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).eq('dt_conclusao_real', hoje)),
    ])

  return montarNumeros({
    produtosAtivos,
    inventariosAbertos,
    transferenciasAbertas,
    // Loja sem controle de lote (as do Omie): sem número, em vez de um "0 lotes" que não quer dizer nada.
    lotesVencendo: lotes ? lotesVencendo : null,
    notasEsperando,
    opsAbertas,
    opsConcluidasHoje,
  })
}
