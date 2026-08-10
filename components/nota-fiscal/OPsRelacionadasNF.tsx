import { createClient } from '@/lib/supabase/server'
import { formatarNomeProduto } from '@/lib/formatar-nome'

// Seção "Ordens de produção relacionadas" da tela de detalhe de NF. Mesmo
// cruzamento aproximado da Task 17/18
// (.superpowers/sdd/2026-08-09-retry-omie-auditoria-detalhes/task-17-report.md,
// "Pergunta 2"), direção OPOSTA à do Task 18: lá era insumo da OP -> NF de
// entrada retroativa; aqui é produto da NF -> OPs que consomem esse produto
// como insumo (nIdProdutoMalha em full_object.itensDetalhes), na mesma loja,
// numa janela de até 30 dias PRA FRENTE da emissão (a compra normalmente
// precede a produção). NÃO é rastreabilidade de lote real -- é uma pista.
//
// Usa a RPC `ops_relacionadas_por_produto` (migration 107) em vez de um
// filtro supabase-js direto. Medido ao vivo antes de escrever este
// componente: `ordens_producao` não tem índice em `full_object` nem nas
// colunas de data, e é uma tabela grande por loja (loja 5: 111.520 linhas).
// Filtrar por `full_object @> '{"itensDetalhes":[{"nIdProdutoMalha":X}]}'`
// sozinho, um código de produto por vez, custou ~640ms-1s POR CÓDIGO na
// loja 5/6 (seq scan completo) -- uma NF com p90=15 itens diferentes exigiria
// dezenas de queries desse tipo = minutos de carregamento. A RPC filtra
// primeiro por loja_id + data (coalesce(dt_conclusao_real,
// identificacao_d_dt_previsao)) no MESMO scan, ANTES do unnest do array de
// insumos, cobrindo qualquer quantidade de códigos de produto numa única
// query: 154ms na loja 5 (maior tabela) no teste real. Ver comentário
// completo + números em supabase/migrations/107_ops_relacionadas_por_produto.sql.
//
// IMPORTANTE: a migration 107 precisa estar aplicada em produção (`docker
// exec -i supabase-db psql -U supabase_admin -d postgres <
// supabase/migrations/107_ops_relacionadas_por_produto.sql`) para esta seção
// funcionar -- não foi aplicada nesta sessão (deploy consolidado fica pro
// final do plano, conforme instrução do brief). Enquanto não aplicada, a
// chamada de RPC falha e a seção mostra o banner de falha de consulta (não
// quebra a página).
type OPRow = {
  id: number
  identificacao_n_cod_op: number | null
  identificacao_c_num_op: string | null
  num_ordem: string | null
  identificacao_n_cod_produto: number | null
  identificacao_n_qtde: number | null
  dt_conclusao_real: string | null
  identificacao_d_dt_previsao: string | null
  concluida: boolean | null
  insumos_batidos: number[] | null
}

function fmtDataBR(d: string | null): string | null {
  if (!d) return null
  const m = d.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

// Cap de segurança: um produto comum (ex. um ingrediente básico) pode ser
// insumo de dezenas/centenas de OPs distintas numa janela de 30 dias (medido
// ao vivo: 1.402 linhas pra só 3 códigos de produto na loja 5) -- sem um
// limite, a seção viraria uma lista impraticável de rolar. Mesmo padrão de
// LIMITE já usado em HistoricoEdicoesOP.tsx (100), com aviso quando atingido.
const LIMITE = 100

function addDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + dias)
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${mm}-${dd}`
}

export async function OPsRelacionadasNF({
  lojaId,
  produtoCodes,
  dataEmissao, // YYYY-MM-DD (d_emissao_nfe) ou null -- início da janela de 30 dias
}: {
  lojaId: number
  produtoCodes: number[]
  dataEmissao: string | null
}) {
  const supabase = await createClient()

  const podeConsultar = produtoCodes.length > 0 && !!dataEmissao
  let rows: OPRow[] = []
  let falhaConsulta = false

  if (podeConsultar && dataEmissao) {
    const dtFim = addDias(dataEmissao, 30)
    const { data, error } = await supabase
      .rpc('ops_relacionadas_por_produto', {
        p_loja_id: lojaId,
        p_produto_codes: produtoCodes,
        p_data_ini: dataEmissao,
        p_data_fim: dtFim,
      })
      .limit(LIMITE)
    if (error) {
      falhaConsulta = true
      console.error('OPsRelacionadasNF: falha ao consultar ops_relacionadas_por_produto', error.message)
    }
    rows = (data ?? []) as OPRow[]
  }

  // Nomes dos produtos ACABADOS das OPs encontradas (não confundir com o
  // produto da NF, que é o insumo).
  const codigosProdutoAcabado = [...new Set(rows.map((r) => r.identificacao_n_cod_produto).filter((v): v is number => v != null))]
  const { data: produtos, error: produtosErro } = codigosProdutoAcabado.length
    ? await supabase.from('produtos').select('codigo_produto, descricao').eq('loja_id', lojaId).in('codigo_produto', codigosProdutoAcabado)
    : { data: [] as { codigo_produto: number; descricao: string }[], error: null }
  if (produtosErro) {
    console.error('OPsRelacionadasNF: falha ao consultar produtos (nomes)', produtosErro.message)
  }
  const nomeProduto = new Map((produtos ?? []).map((p) => [p.codigo_produto, formatarNomeProduto(p.descricao)]))

  const ordenadas = [...rows].sort((a, b) => {
    const da = a.dt_conclusao_real ?? a.identificacao_d_dt_previsao ?? ''
    const db = b.dt_conclusao_real ?? b.identificacao_d_dt_previsao ?? ''
    return db.localeCompare(da)
  })

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-[13px] font-medium text-text-muted">Ordens de produção relacionadas</h2>
      <p className="mb-3 text-[11px] text-text-muted">
        Correlação fraca: OPs que consomem, como insumo, algum produto desta NF, na mesma loja, até 30 dias
        depois da emissão. O sistema não guarda nenhum vínculo real entre nota fiscal e ordem de produção --
        isto NÃO é rastreabilidade de lote, é só uma pista de &ldquo;pra onde pode ter ido esse insumo&rdquo;.
      </p>

      {!podeConsultar ? (
        <p className="text-[13px] text-text-muted">
          {produtoCodes.length === 0
            ? 'Nenhum item desta NF tem código de produto identificado para cruzar com ordens de produção.'
            : 'Sem data de emissão para calcular a janela de 30 dias.'}
        </p>
      ) : falhaConsulta ? (
        <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text-muted">
          Não foi possível consultar ordens de produção agora (falha de banco/rede) -- tente recarregar a
          página. Isto é diferente de &ldquo;nenhuma OP encontrada&rdquo;.
        </p>
      ) : ordenadas.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] text-text-muted">
          Nenhuma OP encontrada consumindo produtos desta NF como insumo nessa janela de 30 dias. Comum e
          esperado -- a correlação é fraca por natureza (produção não é fácil de datar a partir da compra).
        </p>
      ) : (
        <div className="space-y-2">
          {ordenadas.map((r) => {
            const numOP = r.identificacao_c_num_op || r.num_ordem || `#${r.id}`
            const dataRef = r.dt_conclusao_real ?? r.identificacao_d_dt_previsao
            return (
              <a
                key={r.id}
                href={`/ordem-producao/${r.id}`}
                className="block rounded-md border border-border bg-surface-2/40 px-3 py-2 transition-colors hover:border-brand"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-text">OP {numOP}</span>
                  <span className="num text-[12px] text-text-muted">{fmtDataBR(dataRef)}</span>
                </div>
                <div className="mt-1 text-[12px] text-text-muted">
                  Produz{' '}
                  <span className="text-text">
                    {r.identificacao_n_cod_produto != null
                      ? (nomeProduto.get(r.identificacao_n_cod_produto) || `#${r.identificacao_n_cod_produto}`)
                      : '-'}
                  </span>{' '}
                  · Qtde <span className="num">{r.identificacao_n_qtde != null ? Number(r.identificacao_n_qtde).toLocaleString('pt-BR') : '-'}</span>
                  {' · '}
                  {r.concluida ? <span className="text-ok">Concluída</span> : <span className="text-warn">Não concluída</span>}
                </div>
                {r.insumos_batidos && r.insumos_batidos.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    Insumo(s) desta NF usado(s): <span className="num">{r.insumos_batidos.join(', ')}</span>
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )}
      {ordenadas.length === LIMITE && (
        <p className="mt-2 text-[11px] text-text-muted">Mostrando as {LIMITE} OPs mais recentes na janela.</p>
      )}
    </div>
  )
}
