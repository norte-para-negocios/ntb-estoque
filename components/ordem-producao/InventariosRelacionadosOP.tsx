import { createClient } from '@/lib/supabase/server'

// Seção "Inventários relacionados" da tela de detalhe de OP. NÃO existe vínculo
// direto OP -> inventário no schema (confirmado na Task 17 da auditoria de retry
// Omie: `ordens_producao` não tem coluna de ajuste/inventário, e `full_object`
// só lista insumos, nunca referências de inventário). O único cruzamento
// possível é aproximado: mesmo produto + mesmo local de estoque + janela de
// tempo em torno da conclusão (query confirmada em
// .superpowers/sdd/2026-08-09-retry-omie-auditoria-detalhes/task-17-report.md,
// "Pergunta 1").
//
// Quando um item de inventário candidato tem `id_ajuste` preenchido, tentamos
// enriquecer com o `movimentos` correspondente (mesma loja + mesmo id_ajuste) --
// mas essa chave só cobre ~19,6% dos casos na base inteira (883/4.514,
// confirmado na Task 17), e a lacuna NÃO é um "ainda não sincronizou": pelo
// menos 2 das 3 causas são permanentes (loja 4 excluída por desenho do cron;
// cursor do sync-ajustes que já passou por cima do ajuste). Por isso a ausência
// de match aqui nunca é tratada como erro -- é o comportamento normal.
//
// IMPORTANTE (achado da revisão desta task): o caveat de loja 4/cursor
// overshoot é sobre esse ENRIQUECIMENTO por `id_ajuste` (inventario_items <->
// movimentos) -- um caminho que só existe DEPOIS que já achamos uma linha de
// inventário candidata. `inventario_items` em si é gravado pelo próprio fluxo
// de inventário do app, totalmente independente do `sync-ajustes` -- cursor
// overshoot/exclusão da loja 4 NUNCA podem ser a causa de uma LISTA VAZIA de
// inventários (rows.length === 0). Esse caveat fica só na nota por linha
// (quando o item tem id_ajuste mas nenhum movimento correspondente), nunca na
// mensagem de "nenhum inventário encontrado".
type InventarioRow = {
  id: number
  quan: number | null
  produto_descricao: string | null
  status: string | null
  data_inventario: string // vem do join com inventarios.data (timestamptz)
  status_inventario: string
  id_ajuste: number | null
  movimento_id: number | null
  movimento_tipo: string | null
  movimento_data: string | null
}

function fmtDataHora(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export async function InventariosRelacionadosOP({
  lojaId,
  produtoCodigoProduto,
  codigoLocalEstoque,
  dataReferencia, // YYYY-MM-DD (dt_conclusao_real ou identificacao_d_dt_previsao) ou null
}: {
  lojaId: number
  produtoCodigoProduto: number | null
  codigoLocalEstoque: number | null
  dataReferencia: string | null
}) {
  const supabase = await createClient()

  let rows: InventarioRow[] = []
  let consultou = false
  // errosConsulta: mesmo padrão já estabelecido nas Tasks 12-16 desta auditoria
  // (ver AGENTS.md) -- nenhuma das 3 queries deste componente checava `error`
  // antes desta correção. `falhaConsultaPrincipal` distingue as 2 queries que
  // DEFINEM a lista (inventarios/inventario_items) da 3ª, que é só
  // enriquecimento opcional (movimentos) -- uma falha nela não impede mostrar
  // as linhas já achadas, só perde o detalhe extra.
  const errosConsulta: string[] = []
  let falhaConsultaPrincipal = false

  if (produtoCodigoProduto != null && codigoLocalEstoque != null && dataReferencia) {
    consultou = true
    // Janela de ±3 dias em torno da data de referência da OP. Cast ::date do
    // lado do banco (via range de datas puras) evita o bug de limite de data
    // já corrigido na Task 17 (comparar timestamptz direto contra `dt+3`
    // derrubava silenciosamente o último dia da janela).
    const dtIni = addDias(dataReferencia, -3)
    const dtFim = addDias(dataReferencia, 3)

    // Duas consultas separadas (sem filtro dot-path no embed `inventarios!inner`)
    // -- achado documentado em components/movimentacoes/MovimentosTab.tsx: um
    // filtro no lado embedado deixa o plano do Postgres instável sob o role
    // autenticado (às vezes rápido, às vezes timeout), mesmo repetindo a MESMA
    // query. Buscar `inventarios` primeiro e casar em JS evita o mesmo risco.
    const { data: invsCandidatos, error: errInv } = await supabase
      .from('inventarios')
      .select('id, data, status')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', codigoLocalEstoque)
      .gte('data', `${dtIni}T00:00:00`)
      .lt('data', `${addDias(dtFim, 1)}T00:00:00`)
    if (errInv) {
      errosConsulta.push('inventários (janela de data)')
      falhaConsultaPrincipal = true
      console.error('InventariosRelacionadosOP: falha ao consultar inventarios', errInv.message)
    }

    const invMap = new Map((invsCandidatos ?? []).map((i) => [i.id, { data: i.data, status: i.status }]))
    const invIds = [...invMap.keys()]

    let candidatos: {
      id: number
      quan: number | null
      produto_descricao: string | null
      status: string | null
      id_ajuste: number | null
      inventario_id: number
    }[] = []
    if (invIds.length) {
      const { data: itens, error: errItens } = await supabase
        .from('inventario_items')
        .select('id, quan, produto_descricao, status, id_ajuste, inventario_id')
        .eq('loja_id', lojaId)
        .eq('produto_codigo_produto', produtoCodigoProduto)
        .in('inventario_id', invIds)
      if (errItens) {
        errosConsulta.push('itens de inventário')
        falhaConsultaPrincipal = true
        console.error('InventariosRelacionadosOP: falha ao consultar inventario_items', errItens.message)
      }
      candidatos = itens ?? []
    }

    // Enriquecimento opcional via id_ajuste (join com movimentos, mesma loja).
    // Só cobre uma fração dos casos -- ver comentário no topo do arquivo. Uma
    // falha aqui NÃO vira falhaConsultaPrincipal (as linhas já achadas acima
    // continuam válidas e são mostradas, só sem o detalhe extra).
    const idsAjuste = [...new Set(candidatos.map((c) => c.id_ajuste).filter((v): v is number => v != null))]
    const movMap = new Map<number, { id: number; tipo: string | null; data: string | null }>()
    if (idsAjuste.length) {
      const { data: movs, error: errMov } = await supabase
        .from('movimentos')
        .select('id, tipo, data, id_ajuste')
        .eq('loja_id', lojaId)
        .in('id_ajuste', idsAjuste)
      if (errMov) {
        errosConsulta.push('movimentos (enriquecimento por id_ajuste)')
        console.error('InventariosRelacionadosOP: falha ao consultar movimentos', errMov.message)
      }
      for (const m of movs ?? []) {
        if (m.id_ajuste != null) movMap.set(m.id_ajuste, { id: m.id, tipo: m.tipo, data: m.data })
      }
    }

    rows = candidatos
      .map((c) => {
        const inv = invMap.get(c.inventario_id)
        const mov = c.id_ajuste != null ? movMap.get(c.id_ajuste) : undefined
        return {
          id: c.id,
          quan: c.quan,
          produto_descricao: c.produto_descricao,
          status: c.status,
          data_inventario: inv?.data ?? '',
          status_inventario: inv?.status ?? '-',
          id_ajuste: c.id_ajuste,
          movimento_id: mov?.id ?? null,
          movimento_tipo: mov?.tipo ?? null,
          movimento_data: mov?.data ?? null,
        }
      })
      .sort((a, b) => a.data_inventario.localeCompare(b.data_inventario))
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-[13px] font-medium text-text-muted">Inventários relacionados</h2>
      <p className="mb-3 text-[11px] text-text-muted">
        Correlação aproximada por produto + local + data (±3 dias da conclusão/previsão). O sistema não
        grava vínculo direto entre ordem de produção e inventário -- isto é um cruzamento, não um registro.
      </p>

      {errosConsulta.length > 0 && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
          Falha ao consultar: <strong className="text-warn">{[...new Set(errosConsulta)].join(', ')}</strong> — os
          dados abaixo podem estar incompletos.
        </p>
      )}

      {!consultou ? (
        <p className="text-[13px] text-text-muted">
          Sem produto, local de estoque ou data de referência suficientes para cruzar com inventário.
        </p>
      ) : falhaConsultaPrincipal ? (
        <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text-muted">
          Não foi possível consultar inventários agora (falha de banco/rede) -- tente recarregar a página. Isto é
          diferente de &ldquo;nenhum inventário encontrado&rdquo;.
        </p>
      ) : rows.length === 0 ? (
        // Mensagem corrigida (revisão desta task): loja 4/cursor overshoot são
        // causas do ENRIQUECIMENTO por id_ajuste, não de inventario_items em si
        // -- não podem ser a causa de uma lista vazia. Ver comentário no topo.
        <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
          Nenhuma contagem de estoque encontrada perto dessa data, nesse local (aproximação por produto + local +
          tempo, ±3 dias -- não é um cruzamento exato).
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-text">{r.produto_descricao ?? 'Produto'}</span>
                <span className="num text-[12px] text-text-muted">{fmtDataHora(r.data_inventario)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-text-muted">
                <span>Contagem: <span className="num font-medium text-text">{r.quan?.toLocaleString('pt-BR') ?? '-'}</span></span>
                <span>Status do item: {r.status ?? '-'}</span>
                <span>Status do inventário: {r.status_inventario}</span>
              </div>
              {r.movimento_id ? (
                <p className="mt-1 text-[11px] text-ok">
                  Ajuste correspondente encontrado em Movimentações: mov #{r.movimento_id} ({r.movimento_tipo}),{' '}
                  {fmtDataHora(r.movimento_data)}.
                </p>
              ) : r.id_ajuste != null ? (
                <p className="mt-1 text-[11px] text-text-muted">
                  Este item tem <code>id_ajuste</code> ({r.id_ajuste}) mas nenhum movimento correspondente foi
                  encontrado em Movimentações -- cobre só ~20% dos casos na base inteira. Se a loja é a 4, isto é
                  permanente (excluída por desenho do sync de ajustes); mesmo fora dela, pode ser um caso de
                  &ldquo;cursor overshoot&rdquo; do sync (~1.786 linhas conhecidas em 3 lojas) -- religar o cron não
                  traz essas de volta.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function addDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + dias)
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${mm}-${dd}`
}
