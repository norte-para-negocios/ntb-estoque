import { createClient } from '@/lib/supabase/server'
import { carregarHistorico } from '@/lib/historico/carregar'
import { consolidarHistorico } from '@/lib/historico/historico-puro'
import { ROTULOS_HISTORICO, type EntidadeHistorico } from '@/lib/historico/rotulos'
import { ListaMomentos, SecaoHistorico } from './ListaMomentos'

/**
 * Seção "Histórico de alterações" (Fase G [O3], migration 220): quem mudou o quê, quando, campo a campo, de → para.
 * Só leitura (sessão do usuário + RLS por loja). Itens (nota/pedido) aparecem pelo número da linha e o produto ligado.
 */
export async function HistoricoAlteracoes({
  lojaId,
  entidade,
  ids,
  titulo = 'Histórico de alterações',
}: {
  lojaId: number
  entidade: EntidadeHistorico
  ids: (string | number)[]
  titulo?: string
}) {
  const { linhas, erro, cortado } = await carregarHistorico(lojaId, entidade, ids)

  // Nome do produto dos itens (nota/pedido): pelo codigo_produto gravado no próprio histórico.
  const codigos = [...new Set(linhas.filter((l) => l.linha != null && l.campo === 'codigo_produto').flatMap((l) => [l.valor_de, l.valor_para]).filter((v): v is string => !!v && /^\d+$/.test(v)))]
  const nomes = new Map<string, string>()
  if (codigos.length) {
    const supabase = await createClient()
    const { data } = await supabase.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId).in('codigo_produto', codigos.slice(0, 300))
    for (const p of data ?? []) nomes.set(String(p.codigo_produto), `${p.descricao ?? ''}${p.codigo ? ` (${p.codigo})` : ''}`)
  }
  const momentos = consolidarHistorico(linhas, ROTULOS_HISTORICO[entidade], (linha, v) => {
    const nome = v.codigo_produto ? nomes.get(v.codigo_produto) : undefined
    return `Item ${linha}${nome ? ` · ${nome}` : ''}`
  })

  return (
    <SecaoHistorico titulo={titulo} descricao={momentos.length ? `${momentos.length} registro${momentos.length === 1 ? '' : 's'}` : undefined}>
      {erro === 'nao_ativado' ? (
        <p className="text-[13px] text-text-muted">O histórico de alterações ainda não foi ativado neste servidor.</p>
      ) : erro ? (
        <p className="text-[13px] text-text-muted">
          <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-err align-[1px]" />
          Não foi possível consultar o histórico agora (falha de banco/rede). Isto é diferente de &ldquo;nenhuma alteração&rdquo;.
        </p>
      ) : momentos.length === 0 ? (
        <p className="text-[13px] text-text-muted">Nenhuma alteração registrada desde que o histórico foi ativado.</p>
      ) : (
        <>
          <ListaMomentos momentos={momentos} />
          {cortado && <p className="mt-2 text-[13px] text-text-muted">Mostrando só as alterações mais recentes.</p>}
        </>
      )}
    </SecaoHistorico>
  )
}
