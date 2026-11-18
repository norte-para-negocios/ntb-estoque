import { Hourglass } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { montarAguardandoOmie, textoAguardandoOmie, type LinhaFilaVenda, type MovimentoPendente } from '@/lib/movimentacoes/aguardando-omie'

// Acima disto a linha sai do retry automático e passa a aparecer em "Precisa de ação" (lib/actions/movimentacoes.ts).
const ERRO_MAX_TENTATIVAS = 30
const LIMITE = 50
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtData = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

/**
 * F-09: loja Omie. Venda que o Omie ainda não confirmou fica na fila (baixa em `movimentos` com Erro/Processando e OP em
 * `vendas_integracao_fila`) e não aparece na lista de Movimentações (só concluídas) nem em Ordens de Produção. Este aviso
 * mostra o que está esperando, com o motivo. Só renderiza quando há algo; falha de leitura não derruba a tela.
 * Só leitura; as tabelas não são legíveis pelo usuário comum, por isso o cliente de serviço (a página já checou a permissão).
 */
export async function AguardandoOmie({ lojaId }: { lojaId: number }) {
  let dados
  try {
    const sb = createServiceClient()
    const [{ data: movs, error: e1 }, { data: fila, error: e2 }] = await Promise.all([
      sb.from('movimentos')
        .select('id, id_prod, quan, data, obs, obs_item, status, tentativas, descricao_status')
        .eq('loja_id', lojaId)
        .eq('tipo', 'SAI')
        .is('transferencia_id', null)
        .is('id_ajuste', null)
        .in('status', ['Erro', 'Processando', 'Sem CMC'])
        .lt('tentativas', ERRO_MAX_TENTATIVAS)
        .or('obs.like.*Venda ntb-vendas #*,obs_item.like.*Venda ntb-vendas #*')
        .order('id', { ascending: false })
        .limit(LIMITE),
      sb.from('vendas_integracao_fila')
        .select('id, tipo, ref, payload, tentativas, ultimo_erro, proximo_em')
        .eq('loja_id', lojaId)
        .eq('tipo', 'op')
        .eq('status', 'Pendente')
        .order('id', { ascending: false })
        .limit(LIMITE),
    ])
    if (e1 || e2) return null
    const movimentos = (movs ?? []) as MovimentoPendente[]
    const linhas = (fila ?? []) as LinhaFilaVenda[]
    const codigos = new Set<number>(movimentos.map((m) => m.id_prod))
    for (const l of linhas) {
      const c = (l.payload as { codigo_produto?: number } | null)?.codigo_produto
      if (c != null) codigos.add(Number(c))
    }
    const produtos = new Map<number, string>()
    if (codigos.size) {
      const { data: prods } = await sb.from('produtos').select('codigo_produto, descricao').eq('loja_id', lojaId).in('codigo_produto', [...codigos])
      for (const p of (prods ?? []) as { codigo_produto: number; descricao: string | null }[]) if (p.descricao) produtos.set(Number(p.codigo_produto), p.descricao)
    }
    dados = montarAguardandoOmie({ movimentos, fila: linhas, produtos })
  } catch {
    return null
  }
  if (dados.total === 0) return null

  return (
    <section aria-label="Vendas aguardando o Omie" className="rounded-[var(--r-lg)] border border-warn/40 bg-warn/10 px-4 py-3 text-[13px] leading-relaxed">
      <div className="flex items-start gap-2.5">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-warn">{textoAguardandoOmie(dados)}</p>
          <p className="text-text-muted">
            São vendas do Norte Vendas que o Omie ainda não confirmou. O sistema tenta de novo sozinho; enquanto isso elas não aparecem na lista de movimentos
            nem em Ordens de Produção.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-text-muted hover:text-text">Ver o que está esperando</summary>
            <div className="mt-2 space-y-3 overflow-x-auto">
              {dados.saidas.length > 0 && (
                <table className="w-full text-left text-[12.5px]">
                  <caption className="pb-1 text-left font-medium text-text">Baixas de venda (aguardando o Omie)</caption>
                  <thead className="text-text-muted"><tr><th className="pr-3 font-normal">Produto</th><th className="pr-3 font-normal">Qtd</th><th className="pr-3 font-normal">Data</th><th className="pr-3 font-normal">Tentativas</th><th className="font-normal">Motivo</th></tr></thead>
                  <tbody>
                    {dados.saidas.map((s) => (
                      <tr key={`s-${s.id}`}><td className="pr-3">{s.produto}</td><td className="num pr-3">{fmtQtd(s.quantidade)}</td><td className="pr-3">{fmtData(s.data)}</td><td className="num pr-3">{s.tentativas}</td><td className="text-text-muted">{s.motivo}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {dados.ops.length > 0 && (
                <table className="w-full text-left text-[12.5px]">
                  <caption className="pb-1 text-left font-medium text-text">Ordens de produção (aguardando o Omie)</caption>
                  <thead className="text-text-muted"><tr><th className="pr-3 font-normal">Produto</th><th className="pr-3 font-normal">Qtd</th><th className="pr-3 font-normal">Tentativas</th><th className="font-normal">Motivo</th></tr></thead>
                  <tbody>
                    {dados.ops.map((o) => (
                      <tr key={`o-${o.id}`}><td className="pr-3">{o.produto}</td><td className="num pr-3">{fmtQtd(o.quantidade)}</td><td className="num pr-3">{o.tentativas}</td><td className="text-text-muted">{o.motivo}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        </div>
      </div>
    </section>
  )
}
