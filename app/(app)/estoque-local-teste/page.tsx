import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { SincronizarBotoes } from './sincronizar-botoes'

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

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Estoque local de teste</h1>
      <p className="text-sm text-muted-foreground">
        Só admin. Sem link na navegação principal. Dados aqui nunca aparecem em nenhum relatório real.
      </p>

      <form method="get" className="flex gap-2 items-center">
        <select name="loja" defaultValue={lojaSelecionada} className="border rounded px-2 py-1">
          {(lojas ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome_fantasia}
            </option>
          ))}
        </select>
        <button type="submit" className="border rounded px-3 py-1">
          Trocar loja
        </button>
      </form>

      {lojaSelecionada && <SincronizarBotoes />}

      <section>
        <h2 className="font-semibold mb-2">Saldo atual ({saldos.length} produtos)</h2>
        {lojaSelecionada && (
          <p className="text-sm text-muted-foreground mb-2">
            Ficha técnica: {fichaTecnicaCobertos} de {totalProdutosLoja} produtos com estrutura sincronizada
            {totalProdutosLoja > 0 && (
              <> ({((fichaTecnicaCobertos / totalProdutosLoja) * 100).toFixed(1)}%)</>
            )}
            {' '}-- produtos sem estrutura não deduzem estoque local numa venda (baixa vira no-op silencioso).
          </p>
        )}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Produto</th>
              <th className="py-1">Código</th>
              <th className="py-1">Saldo</th>
              <th className="py-1">Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={s.codigo_produto} className="border-b">
                <td className="py-1">{nomeProduto(s.codigo_produto)}</td>
                <td className="py-1 text-muted-foreground">{s.codigo_produto}</td>
                <td className={`py-1 ${s.saldo < 0 ? 'text-red-600 font-semibold' : ''}`}>{s.saldo}</td>
                <td className="py-1">{new Date(s.atualizado_em).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Movimentos recentes</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Quando</th>
              <th className="py-1">Produto</th>
              <th className="py-1">Tipo</th>
              <th className="py-1">Qtde</th>
              <th className="py-1">Saldo após</th>
              <th className="py-1">OP origem</th>
              <th className="py-1">Pedido</th>
            </tr>
          </thead>
          <tbody>
            {movimentos.map((m) => (
              <tr key={m.id} className="border-b">
                <td className="py-1">{new Date(m.criado_em).toLocaleString('pt-BR')}</td>
                <td className="py-1">
                  {nomeProduto(m.codigo_produto)} <span className="text-muted-foreground">({m.codigo_produto})</span>
                </td>
                <td className="py-1">{m.tipo}</td>
                <td className="py-1">{m.quantidade}</td>
                <td className="py-1">{m.saldo_apos}</td>
                <td className="py-1">{m.origem_n_cod_op}</td>
                <td className="py-1">{m.pedido_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
