import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

// Seção "Movimentações de estoque geradas" da tela de detalhe de NF. Critério
// confirmado na Task 17 da auditoria de retry Omie (task-17-report.md,
// "Pergunta 3", movimentos <-> notas_fiscais): SEM FK. Correlação aproximada
// por produto (`movimentos.id_prod` = `nota_fiscal_items.n_id_produto`) +
// local de estoque (`movimentos.codigo_local_estoque` =
// `nota_fiscal_items.full_object->itensAjustes->>codigo_local_estoque`) +
// janela de ±7 dias em torno de `d_emissao_nfe`.
//
// ACHADO IMPORTANTE (Task 17, confirmado por leitura de código, não só
// ausência de FK): `concluirRecebimento`/`ConcluirRecebimento`
// (lib/omie/nota-fiscal.ts) e `saveNotaFiscal` NUNCA escrevem em
// `movimentos` -- das 13 combinações tipo/origem/motivo reais em
// `movimentos`, nenhuma tem motivo de recebimento de NF, e o total de
// entradas por ajuste (ENT/AJU/*) soma só ~237 linhas em toda a base, uma
// fração ínfima do volume real de recebimentos de NF nas 6 lojas. Ou seja:
// a maioria das NFs NÃO vai ter nenhum movimento correspondente aqui, e isso
// é o comportamento normal do sistema, não uma falha de dado ou de query --
// a mensagem de vazio precisa deixar isso explícito (mesmo padrão de aviso
// já usado nas outras seções desta auditoria).
//
// NOTA: isto é uma correlação DIFERENTE da usada em
// InventariosRelacionadosOP (que junta por `id_ajuste`, sujeita ao caveat de
// loja 4/cursor overshoot do sync-ajustes). Aqui não há `id_ajuste`
// envolvido -- é produto+local+data direto -- então aquele caveat específico
// NÃO se aplica a esta seção (ver Lição 4 do brief desta task).
//
// Fix round 1 (revisão desta task, 2026-08-09) -- ACHADO CRITICAL: a versão
// original rodava um único `.select()` sem `.order()`/`.range()`/`.limit()`.
// Este deploy tem `PGRST_DB_MAX_ROWS=1000` configurado -- exatamente o mesmo
// bug Critical já corrigido em `NotaFiscalVinculadaOP.tsx` (Task 18),
// reintroduzido aqui na direção oposta. Medido pela revisão em 250 NFs reais
// com >=10 itens dos últimos 90 dias: 6 (2,4%) excedem 1000 linhas de
// `movimentos` correspondentes, máximo 1.542 -- as linhas cortadas caíam no
// mesmo estado vazio "Nenhuma movimentação encontrada... comum e esperado",
// escondendo o corte atrás da MESMA frase que escondia o bug da Task 18.
// Corrigido com paginação real via `buscarTodasLinhas` (helper compartilhado,
// mesmo padrão de `app/(app)/relatorio-margem/page.tsx`), com `.order('id')`
// explícito -- nunca trunca. Também passou a filtrar `codigo_local_estoque`
// no servidor (além de `id_prod`), reduzindo o volume por página sem mudar o
// resultado (o pareamento final continua exato por (id_prod,
// codigo_local_estoque) em JS).
type MovimentoRow = {
  id: number
  tipo: string
  origem: string | null
  motivo: string | null
  id_prod: number
  codigo_local_estoque: number
  data: string
  quan: number | null
  valor: number | null
}

type ItemRef = { n_id_produto: number; codigo_local_estoque: number | null; descricao: string | null }

function fmtDataHora(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function addDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + dias)
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${mm}-${dd}`
}

export async function MovimentacoesGeradasNF({
  lojaId,
  itens, // itens da NF com n_id_produto + codigo_local_estoque (de full_object.itensAjustes) já resolvidos
  dataEmissao, // YYYY-MM-DD (d_emissao_nfe) ou null -- centro da janela de ±7 dias
}: {
  lojaId: number
  itens: ItemRef[]
  dataEmissao: string | null
}) {
  const supabase = await createClient()

  const itensValidos = itens.filter((i) => i.n_id_produto != null)
  const produtoCodes = [...new Set(itensValidos.map((i) => i.n_id_produto))]
  const locaisValidos = [...new Set(itensValidos.map((i) => i.codigo_local_estoque).filter((v): v is number => v != null))]
  const podeConsultar = produtoCodes.length > 0 && !!dataEmissao
  // Array (nao `let` reatribuido) de proposito -- `errosConsulta.push(...)`
  // dentro do callback `onErro` do buscarTodasLinhas eh mutacao, nao
  // reatribuicao de binding, o que evita o erro do eslint
  // `react-hooks/immutability` ("Cannot reassign variable after render
  // completes") que uma reatribuicao de `let` direto no callback dispara.
  // Mesmo padrao ja usado em relatorio-margem/page.tsx (`errosConsulta`).
  const errosConsultaMov: string[] = []
  const movsPorPar = new Map<string, MovimentoRow[]>() // chave: `${id_prod}:${codigo_local_estoque}`

  if (podeConsultar && dataEmissao) {
    const dtIni = addDias(dataEmissao, -7)
    const dtFim = addDias(dataEmissao, 7)
    // Paginação real via helper compartilhado (`.order('id')` + `.range()`) --
    // NUNCA truncar em silêncio (ver comentário no topo do arquivo, "Fix round
    // 1"). Filtra também por `codigo_local_estoque` no servidor (além de
    // `id_prod`) pra reduzir o volume; o pareamento final exato por
    // (id_prod, codigo_local_estoque) continua em JS depois, evitando trazer
    // movimento de um LOCAL diferente do item da NF quando a NF tem itens em
    // locais distintos.
    const rows = await buscarTodasLinhas<MovimentoRow>(
      (from, to) => {
        let q = supabase
          .from('movimentos')
          .select('id, tipo, origem, motivo, id_prod, codigo_local_estoque, data, quan, valor')
          .eq('loja_id', lojaId)
          .in('id_prod', produtoCodes)
          .gte('data', `${dtIni}T00:00:00`)
          .lt('data', `${addDias(dtFim, 1)}T00:00:00`)
        if (locaisValidos.length) q = q.in('codigo_local_estoque', locaisValidos)
        return q.order('id', { ascending: true }).range(from, to)
      },
      undefined,
      () => {
        errosConsultaMov.push('movimentos')
      }
    )
    for (const m of rows) {
      const chave = `${m.id_prod}:${m.codigo_local_estoque}`
      const lista = movsPorPar.get(chave) ?? []
      lista.push(m)
      movsPorPar.set(chave, lista)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-[13px] font-medium text-text-muted">Movimentações de estoque geradas</h2>
      <p className="mb-3 text-[11px] text-text-muted">
        Correlação aproximada por produto + local de estoque + data (±7 dias da emissão). O recebimento de NF
        normalmente NÃO gera linha em <code>movimentos</code> -- confirmado por leitura de código
        (concluirRecebimento nunca escreve nessa tabela); ausência de resultado aqui é o caso comum, não um
        erro.
      </p>

      {!podeConsultar ? (
        <p className="text-[13px] text-text-muted">
          {produtoCodes.length === 0
            ? 'Nenhum item desta NF tem código de produto identificado para cruzar com movimentações.'
            : 'Sem data de emissão para calcular a janela de ±7 dias.'}
        </p>
      ) : errosConsultaMov.length > 0 ? (
        <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text-muted">
          Não foi possível consultar movimentações agora (falha de banco/rede) -- tente recarregar a página.
          Isto é diferente de &ldquo;nenhuma movimentação encontrada&rdquo;.
        </p>
      ) : (
        <div className="space-y-3">
          {itensValidos.map((item, idx) => {
            const chave = `${item.n_id_produto}:${item.codigo_local_estoque}`
            const movs = (movsPorPar.get(chave) ?? []).sort((a, b) => a.data.localeCompare(b.data))
            return (
              <div key={idx} className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <div className="text-[13px] text-text">
                  {item.descricao ?? `Produto ${item.n_id_produto}`}{' '}
                  <span className="text-[11px] text-text-muted">
                    (local {item.codigo_local_estoque ?? '-'})
                  </span>
                </div>
                {movs.length === 0 ? (
                  <p className="mt-1 text-[11px] text-text-muted">
                    Nenhuma movimentação encontrada perto dessa data, nesse local -- comum e esperado (ver nota
                    acima).
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {movs.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-muted">
                        <span>
                          mov #{m.id} ({m.tipo}/{m.origem ?? '-'}/{m.motivo ?? '-'}) ·{' '}
                          <span className="num">{m.quan?.toLocaleString('pt-BR') ?? '-'}</span>
                        </span>
                        <span className="num">{fmtDataHora(m.data)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
