import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { SincronizarBotoes } from './sincronizar-botoes'
import { btnClass } from '@/components/ui-kit/Button'

interface SaldoRow {
  codigo_produto: number
  saldo: number
  atualizado_em: string
}
interface MovimentoRow {
  id: number
  codigo_produto: number
  tipo: string
  quantidade: number
  saldo_apos: number
  origem_n_cod_op: number | null
  pedido_ref: string | null
  criado_em: string
}
interface LojaRow {
  id: number
  nome_fantasia: string
}

export default async function EstoqueLocalTestePage({
  searchParams,
}: {
  searchParams: Promise<{ loja?: string }>
}) {
  if (!(await isAdmin())) redirect('/')

  const supabase = createServiceClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome_fantasia')
    .eq('is_test', true)
    .order('nome_fantasia')
    .returns<LojaRow[]>()

  const { loja: lojaParam } = await searchParams
  const lojaSelecionada = lojaParam ? Number(lojaParam) : lojas?.[0]?.id

  let saldos: SaldoRow[] = []
  let movimentos: MovimentoRow[] = []
  let fichaTecnicaCobertos = 0
  let totalProdutosLoja = 0
  let nomes = new Map<number, string | null>()
  if (lojaSelecionada) {
    const [saldosData, { data: movimentosData }, fichaCodigos, produtosData] = await Promise.all([
      // Paginado -- corte de 1000 linhas do PostgREST batia aqui (5 das 6
      // lojas de teste têm mais de 1000 produtos), "Saldo atual (1000
      // produtos)" mentia o total. Mesmo helper/tiebreak (`.order('id')`)
      // já usado nas outras rotas deste plano.
      buscarTodasLinhas<SaldoRow>((from, to) =>
        supabase
          .from('estoque_local_saldos')
          .select('codigo_produto, saldo, atualizado_em')
          .eq('loja_id', lojaSelecionada)
          .order('id')
          .range(from, to)
      ),
      supabase
        .from('movimentos_locais')
        .select('id, codigo_produto, tipo, quantidade, saldo_apos, origem_n_cod_op, pedido_ref, criado_em')
        .eq('loja_id', lojaSelecionada)
        .order('criado_em', { ascending: false })
        .limit(50)
        .returns<MovimentoRow[]>(),
      // Cobertura real da ficha técnica local -- ver AGENTS.md ("estoque
      // local independente da Omie") pro porquê disto importa: a baixa de
      // estoque é no-op silencioso pra qualquer produto sem BOM local
      // aqui, e sem este indicador não havia nenhum lugar visível pro
      // operador enxergar isso. Conta distinct em JS (via buscarTodasLinhas,
      // paginado -- ficha_tecnica_local tem 1 linha por insumo, não por
      // produto, então count(head:true) contaria linha, não produto).
      buscarTodasLinhas<{ codigo_produto: number }>((from, to) =>
        supabase
          .from('ficha_tecnica_local')
          .select('codigo_produto')
          .eq('loja_id', lojaSelecionada)
          .order('id')
          .range(from, to)
      ),
      // Nome do produto -- mesmo padrão já usado em lib/movimentacao-manual.ts
      // e relatorio-movimentacao/page.tsx (Map codigo_produto -> descricao,
      // paginado pelo mesmo motivo do saldo acima).
      buscarTodasLinhas<{ codigo_produto: number; descricao: string | null }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto, descricao')
          .eq('loja_id', lojaSelecionada)
          .order('id')
          .range(from, to)
      ),
    ])
    saldos = saldosData
    movimentos = movimentosData ?? []
    fichaTecnicaCobertos = new Set(fichaCodigos.map((f) => f.codigo_produto)).size
    totalProdutosLoja = produtosData.length
    nomes = new Map(produtosData.map((p) => [p.codigo_produto, p.descricao]))
  }

  function nomeProduto(codigo: number) {
    return nomes.get(codigo) || `Produto ${codigo}`
  }

  const th = 'whitespace-nowrap px-4 py-2 text-left text-[13px] font-medium text-text-muted'
  const td = 'px-4 py-2'

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-text sm:text-[30px]">Estoque local de teste</h1>
        <p className="mt-1 text-[15px] text-text-muted">
          Só admin. Sem link na navegação principal. Dados aqui nunca aparecem em nenhum relatório real.
        </p>
      </div>

      <form method="get" className="flex items-center gap-2">
        <select
          name="loja"
          defaultValue={lojaSelecionada}
          className="h-[34px] min-w-0 rounded-[var(--r-md)] border-0 bg-surface-2 px-3 text-[14px] text-text outline-none focus:ring-2 focus:ring-brand/40 max-sm:h-10 max-sm:flex-1 max-sm:text-base"
        >
          {(lojas ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome_fantasia}
            </option>
          ))}
        </select>
        <button type="submit" className={`${btnClass('outline')} shrink-0`}>
          Trocar loja
        </button>
      </form>

      {lojaSelecionada && <SincronizarBotoes />}

      <section className="space-y-2">
        <h2 className="text-[17px] font-semibold text-text">
          Saldo atual (<span className="num">{saldos.length}</span> produtos)
        </h2>
        {lojaSelecionada && (
          <p className="text-[13px] text-text-muted">
            Ficha técnica: <span className="num">{fichaTecnicaCobertos}</span> de <span className="num">{totalProdutosLoja}</span> produtos com estrutura sincronizada
            {totalProdutosLoja > 0 && (
              <> (<span className="num">{((fichaTecnicaCobertos / totalProdutosLoja) * 100).toFixed(1)}%</span>)</>
            )}
            {' '}-- produtos sem estrutura não deduzem estoque local numa venda (baixa vira no-op silencioso).
          </p>
        )}
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          <table className="w-full min-w-[600px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border/60">
                <th className={th}>Produto</th>
                <th className={th}>Código</th>
                <th className={`${th} text-right`}>Saldo</th>
                <th className={th}>Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((s) => (
                <tr key={s.codigo_produto} className="border-b border-border/60 last:border-0 hover:bg-surface-2/40">
                  <td className={`${td} text-text`}>{nomeProduto(s.codigo_produto)}</td>
                  <td className={`${td} num text-text-muted`}>{s.codigo_produto}</td>
                  <td className={`${td} num text-right ${s.saldo < 0 ? 'font-semibold text-err' : 'text-text'}`}>{s.saldo}</td>
                  <td className={`${td} num whitespace-nowrap text-text-muted`}>{new Date(s.atualizado_em).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[17px] font-semibold text-text">Movimentos recentes</h2>
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          <table className="w-full min-w-[860px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border/60">
                <th className={th}>Quando</th>
                <th className={th}>Produto</th>
                <th className={th}>Tipo</th>
                <th className={`${th} text-right`}>Qtde</th>
                <th className={`${th} text-right`}>Saldo após</th>
                <th className={th}>OP origem</th>
                <th className={th}>Pedido</th>
              </tr>
            </thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/40">
                  <td className={`${td} num whitespace-nowrap text-text-muted`}>{new Date(m.criado_em).toLocaleString('pt-BR')}</td>
                  <td className={`${td} text-text`}>
                    {nomeProduto(m.codigo_produto)} <span className="num text-text-muted">({m.codigo_produto})</span>
                  </td>
                  <td className={`${td} text-text`}>{m.tipo}</td>
                  <td className={`${td} num text-right text-text`}>{m.quantidade}</td>
                  <td className={`${td} num text-right text-text`}>{m.saldo_apos}</td>
                  <td className={`${td} num text-text-muted`}>{m.origem_n_cod_op}</td>
                  <td className={`${td} num text-text-muted`}>{m.pedido_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
