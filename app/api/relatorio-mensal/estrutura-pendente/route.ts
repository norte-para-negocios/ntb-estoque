import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export const dynamic = 'force-dynamic'

// Produtos com OP concluída no período pedido que AINDA não têm ficha
// técnica em cache -- o botão da tela usa essa lista pra saber o que
// mandar pra app/api/sync/estrutura-produto (não sincroniza o catálogo
// inteiro, só quem teve OP de verdade no mês do relatório). Gate em
// isAdmin() (não getAtorGestao().podeGerir) pra ficar consistente com
// app/api/sync/estrutura-produto/route.ts -- este endpoint só existe em
// função de disparar aquela sync (que bate na Omie de verdade), então
// não faz sentido ficar mais permissivo que ela.
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  const { searchParams } = new URL(request.url)
  const dataIni = searchParams.get('dataIni')
  const dataFim = searchParams.get('dataFim')
  if (!dataIni || !dataFim) {
    return NextResponse.json({ error: 'dataIni e dataFim obrigatórios' }, { status: 400 })
  }

  const supabase = createServiceClient()
  // As duas consultas abaixo eram `.select()` cru, sem paginação nem checagem
  // de erro -- cortavam em 1000 linhas pelo default do PostgREST (uma loja
  // gera muito mais de 1000 OPs concluídas num mês, e o cache tem 1 linha por
  // INSUMO) e uma falha virava silenciosamente "nada cacheado"/"nenhuma OP".
  // Nos dois sentidos o estrago é real: subestimar o cacheado dispara uma
  // sync gigante contra a Omie de um cliente pagante (risco de
  // MISUSE_API_PROCESS); subestimar as OPs esconde produto pendente. Por isso
  // qualquer erro aqui vira 502 explícito, nunca lista parcial.
  const erros: string[] = []
  const ops = await buscarTodasLinhas<{ identificacao_n_cod_produto: number }>(
    (from, to) =>
      supabase
        .from('ordens_producao')
        .select('identificacao_n_cod_produto')
        .eq('loja_id', lojaId)
        .eq('concluida', true)
        .gte('dt_conclusao_real', dataIni)
        .lte('dt_conclusao_real', dataFim)
        .order('id')
        .range(from, to),
    undefined,
    (e) => erros.push(e.message)
  )
  if (erros.length) {
    return NextResponse.json({ error: `Falha ao consultar Ordens de Produção: ${erros[0]}` }, { status: 502 })
  }
  const codigosNoPeriodo = [...new Set(ops.map((o) => Number(o.identificacao_n_cod_produto)))]
  if (!codigosNoPeriodo.length) return NextResponse.json({ pendentes: [] })

  const jaCacheados = await buscarTodasLinhas<{ codigo_produto: number }>(
    (from, to) =>
      supabase
        .from('estrutura_produto_cache')
        .select('codigo_produto')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigosNoPeriodo)
        .order('id')
        .range(from, to),
    undefined,
    (e) => erros.push(e.message)
  )
  if (erros.length) {
    return NextResponse.json({ error: `Falha ao consultar ficha técnica em cache: ${erros[0]}` }, { status: 502 })
  }
  const cacheados = new Set(jaCacheados.map((r) => Number(r.codigo_produto)))
  const pendentes = codigosNoPeriodo.filter((c) => !cacheados.has(c))

  return NextResponse.json({ pendentes })
}
