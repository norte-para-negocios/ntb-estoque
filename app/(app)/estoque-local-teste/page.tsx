import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
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
  if (lojaSelecionada) {
    const [{ data: saldosData }, { data: movimentosData }] = await Promise.all([
      supabase
        .from('estoque_local_saldos')
        .select('codigo_produto, saldo, atualizado_em')
        .eq('loja_id', lojaSelecionada)
        .order('codigo_produto')
        .returns<SaldoRow[]>(),
      supabase
        .from('movimentos_locais')
        .select('id, codigo_produto, tipo, quantidade, saldo_apos, origem_n_cod_op, pedido_ref, criado_em')
        .eq('loja_id', lojaSelecionada)
        .order('criado_em', { ascending: false })
        .limit(50)
        .returns<MovimentoRow[]>(),
    ])
    saldos = saldosData ?? []
    movimentos = movimentosData ?? []
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
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Código produto</th>
              <th className="py-1">Saldo</th>
              <th className="py-1">Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={s.codigo_produto} className="border-b">
                <td className="py-1">{s.codigo_produto}</td>
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
                <td className="py-1">{m.codigo_produto}</td>
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
