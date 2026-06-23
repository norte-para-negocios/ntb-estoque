import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'

function fmtData(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const dataInicio = searchParams.get('data_inicio') || undefined
  const dataFinal = searchParams.get('data_final') || undefined
  const status = searchParams.get('status') || undefined
  const motivo = searchParams.get('motivo') || undefined

  // Paginacao interna (PostgREST limita 1000) para nao truncar a exportacao.
  const PAGE_SIZE = 1000
  type Linha = {
    id: number
    data: string | null
    codigo_local_origem: number | null
    codigo_local_destino: number | null
    status: string | null
    motivo: string | null
    user_id: string | null
  }
  const transRaw: Linha[] = []

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('transferencias')
      .select('id, data, codigo_local_origem, codigo_local_destino, status, motivo, user_id')
      .eq('loja_id', lojaId)
      // desempate por PK: paginar por 'data' (não-única) pulava/duplicava linhas
      .order('data', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (dataInicio) q = q.gte('data', dataInicio)
    if (dataFinal) q = q.lte('data', `${dataFinal}T23:59:59`)
    if (status === 'C') q = q.eq('status', 'Concluido')
    else if (status === 'A') q = q.neq('status', 'Concluido')
    if (motivo === 'TRF' || motivo === 'TPQ') q = q.eq('motivo', motivo)
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    transRaw.push(...(bloco as Linha[]))
    if (bloco.length < PAGE_SIZE) break
  }

  // Nomes dos locais (inclui inativos: o historico mostra o nome, nao o codigo).
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  // Responsavel (user_id -> nome).
  const userIds = [...new Set(transRaw.map((t) => t.user_id).filter(Boolean))]
  const { data: profs } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds as string[])
    : { data: [] as { id: string; name: string | null }[] }
  const nomeMap = new Map((profs ?? []).map((p) => [p.id, p.name]))

  const rows = transRaw.map((t) => ({
    num: `#${t.id}`,
    origem: String(localMap.get(t.codigo_local_origem ?? -1) || t.codigo_local_origem || '-'),
    destino: String(localMap.get(t.codigo_local_destino ?? -1) || t.codigo_local_destino || '-'),
    data: fmtData(t.data),
    motivo: t.motivo === 'TPQ' ? 'Perda / quebra' : 'Transferência',
    responsavel: nomeMap.get(t.user_id ?? '') || '-',
    status: t.status || '-',
  }))

  const buffer = await gerarPlanilha(
    rows,
    [
      { key: 'num', label: 'Transferência', tipo: 'texto', largura: 14 },
      { key: 'origem', label: 'Origem', tipo: 'texto', largura: 20 },
      { key: 'destino', label: 'Destino', tipo: 'texto', largura: 20 },
      { key: 'data', label: 'Data', tipo: 'texto', largura: 14 },
      { key: 'motivo', label: 'Motivo', tipo: 'texto', largura: 16 },
      { key: 'responsavel', label: 'Responsável', tipo: 'texto', largura: 22 },
      { key: 'status', label: 'Status', tipo: 'texto', largura: 14 },
    ],
    { titulo: 'Transferências' },
  )

  return planilhaResponse('transferencias.xlsx', buffer)
}
