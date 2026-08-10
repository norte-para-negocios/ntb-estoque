import { createClient } from '@/lib/supabase/server'
import { SELO_CLASSE } from '@/lib/status-cor'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

// Seção "Histórico de status/manifestação" -- mescla `webhooks` (eventos reais
// da Omie pra este recebimento) com `audit_log` (ações manuais no app), numa
// única linha do tempo ordenada por data.
//
// Achado real (grep de `registrarAuditoria` em lib/actions/nota-fiscal.ts,
// confirmado ao vivo no Postgres de produção antes de escrever esta query --
// mesma cautela da Task 18, que descobriu que o valor pra OP NÃO era o que o
// brief original supunha): a entidade gravada é `'nota fiscal'` (com espaço,
// minúsculo, SEM acento -- diferente de 'ordem de produção' que tem acento),
// e o `entidade_id` é `nf.c_numero_nfe` (o NÚMERO da nota, ex. '000005124'),
// NÃO o `id` interno nem o `n_id_receb`. Confirmado com a query real:
//   select entidade, count(*) from audit_log group by entidade;
//   -- 'nota fiscal' | 3   (a MENOR de todas as entidades -- transferência
//   -- tem 572, ordem de produção 527)
// Só 3 chamadas de registrarAuditoria existem no arquivo inteiro: concluir
// (manifestar), reverter, excluir -- não existe criar/editar pra NF (a nota
// é criada pelo webhook, nunca por ação manual no app). Ou seja, é ESPERADO
// que a maioria das NFs não tenha NENHUM registro de audit_log -- não é sinal
// de problema.
//
// webhooks: cada evento de RecebimentoProduto.* traz `nIdReceb` dentro de
// `message.event.cabecalho` (confirmado ao vivo, ver task-19-report.md) --
// casado contra `nf.n_id_receb` em JS (ver comentário mais abaixo sobre o
// porquê de não filtrar isso no servidor). Tópicos reais observados na base:
// Incluido, Alterado, Concluido, Revertido. Caveat conhecido (AGENTS.md,
// "Limitações conhecidas"): webhooks anteriores a 2026-07-05 foram perdidos
// pelo prune de 7 dias que existia antes do dual-write pro Contabo -- uma NF
// antiga sem NENHUM webhook aqui não é bug, é esse limite de retenção
// conhecido.
const TOPIC_LABEL: Record<string, string> = {
  Incluido: 'Recebimento incluído',
  Alterado: 'Recebimento alterado',
  Concluido: 'Recebimento concluído (manifestado)',
  Revertido: 'Manifestação revertida',
  Excluido: 'Recebimento excluído',
}

const ACAO_LABEL: Record<string, string> = {
  concluir: 'Manifestada',
  reverter: 'Manifestação revertida',
  excluir: 'Excluída',
}

const LIMITE = 100

type EventoTimeline = {
  key: string
  ts: string
  origem: 'omie' | 'app'
  label: string
  autor: string | null
  detalhe: string | null
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export async function HistoricoStatusNF({
  lojaId,
  nIdReceb,
  numeroNFe,
}: {
  lojaId: number
  nIdReceb: string | null
  numeroNFe: string | null
}) {
  const supabase = await createClient()

  const errosConsulta: string[] = []

  // Filtra só por loja_id + topic (nível único de seta JSON, `message->>topic`
  // -- o mesmo padrão já usado em várias telas, ex. nota-fiscal/page.tsx
  // `full_object->infoCadastro->>cCancelada`), e casa o `nIdReceb` (dentro de
  // `message.event.cabecalho`, dois níveis abaixo) em JS. Deliberadamente NÃO
  // usado um filtro `.eq('message->event->cabecalho->>nIdReceb', ...)` com
  // dois níveis de seta encadeados no servidor -- essa forma nunca foi
  // testada de ponta a ponta contra o PostgREST real nesta sessão (só
  // validada a tradução SQL equivalente via psql direto).
  //
  // Fix round 1 (revisão desta task, 2026-08-09) -- Important: a versão
  // original buscava com `.order('created_at')` mas SEM `.limit()`/`.range()`,
  // confiando em "hoje o volume é pequeno" (1.614 linhas em TODA a tabela).
  // Isso não protege contra o teto SILENCIOSO de `PGRST_DB_MAX_ROWS=1000`
  // deste deploy -- hoje o máximo real por loja é 557 (confirmado pela
  // revisão), mas se a retenção ou o volume crescerem além de 1000/loja, o
  // corte vira silencioso e a UI atribuiria a ausência ao prune de 05/07 já
  // documentado (mensagem convincente, mas errada -- exatamente o tipo de
  // misatribuição que a Lição 4 desta task pede pra evitar). Corrigido com
  // paginação real via `buscarTodasLinhas` (mesmo helper usado em
  // `MovimentacoesGeradasNF.tsx`), buscando TODOS os webhooks de
  // `RecebimentoProduto.*` da loja antes de filtrar por `nIdReceb` -- só
  // então corta pra `LIMITE` (100) na exibição.
  const webhooksTodos = nIdReceb
    ? await buscarTodasLinhas<{ id: number; message: unknown; created_at: string }>(
        (from, to) =>
          supabase
            .from('webhooks')
            .select('id, message, created_at')
            .eq('loja_id', lojaId)
            .ilike('message->>topic', 'RecebimentoProduto%')
            .order('id', { ascending: true })
            .range(from, to),
        undefined,
        () => {
          errosConsulta.push('eventos do Omie (webhooks)')
        }
      )
    : []
  const webhooksDoRecebimento = webhooksTodos
    .filter((w) => {
      const msg = w.message as { event?: { cabecalho?: { nIdReceb?: number | string } } }
      return String(msg.event?.cabecalho?.nIdReceb ?? '') === nIdReceb
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIMITE)

  const { data: auditRaw, error: auditErro } = numeroNFe
    ? await supabase
        .from('audit_log')
        .select('id, acao, user_nome, descricao, created_at')
        .eq('loja_id', lojaId)
        .eq('entidade', 'nota fiscal')
        .eq('entidade_id', numeroNFe)
        .order('created_at', { ascending: false })
        .limit(LIMITE)
    : { data: [], error: null }
  if (auditErro) {
    errosConsulta.push('ações no app (audit_log)')
    console.error('HistoricoStatusNF: falha ao consultar audit_log', auditErro.message)
  }

  const eventos: EventoTimeline[] = [
    ...webhooksDoRecebimento.map((w) => {
      const msg = w.message as { topic?: string; author?: { name?: string }; event?: { cabecalho?: { cEtapa?: string } } }
      const topico = (msg.topic ?? '').split('.')[1] ?? msg.topic ?? '?'
      return {
        key: `wh-${w.id}`,
        ts: w.created_at,
        origem: 'omie' as const,
        label: TOPIC_LABEL[topico] ?? `Evento Omie: ${msg.topic ?? '?'}`,
        autor: msg.author?.name ?? null,
        detalhe: msg.event?.cabecalho?.cEtapa ? `etapa ${msg.event.cabecalho.cEtapa}` : null,
      }
    }),
    ...(auditRaw ?? []).map((a) => ({
      key: `al-${a.id}`,
      ts: a.created_at,
      origem: 'app' as const,
      label: ACAO_LABEL[a.acao] ?? a.acao,
      autor: a.user_nome,
      detalhe: a.descricao,
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts))

  const falhaConsultaTotal = errosConsulta.length === 2 // as 2 fontes falharam -- nenhum dado confiável pra mostrar

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-[13px] font-medium text-text-muted">Histórico de status / manifestação</h2>
      <p className="mb-3 text-[11px] text-text-muted">
        Linha do tempo combinando eventos reais recebidos da Omie (webhooks) com ações manuais registradas no
        app (concluir/reverter/excluir -- a nota em si é criada pelo webhook, nunca por ação manual, então não
        existe &ldquo;criar&rdquo;/&ldquo;editar&rdquo; aqui). Webhooks de antes de 05/07/2026 foram perdidos
        por um prune antigo (ver AGENTS.md) -- ausência de eventos numa NF antiga pode ser esse limite, não
        falta de atividade real.
      </p>

      {errosConsulta.length > 0 && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
          Falha ao consultar: <strong className="text-warn">{errosConsulta.join(', ')}</strong> — os dados
          abaixo podem estar incompletos.
        </p>
      )}

      {falhaConsultaTotal ? (
        <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text-muted">
          Não foi possível consultar o histórico agora (falha de banco/rede) -- tente recarregar a página.
        </p>
      ) : eventos.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {nIdReceb
            ? 'Nenhum evento encontrado para esta nota (webhooks antigos podem ter sido perdidos pelo prune -- ver nota acima).'
            : 'Esta nota ainda não tem código de recebimento da Omie -- sem histórico de eventos.'}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {eventos.map((e) => (
              <li key={e.key} className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-2 last:border-none last:pb-0">
                <div>
                  <span className="text-[13px] text-text">{e.label}</span>
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      SELO_CLASSE[e.origem === 'omie' ? 'info' : 'brand']
                    }`}
                  >
                    {e.origem === 'omie' ? 'Omie' : 'Ação no app'}
                  </span>
                  {e.detalhe && <span className="text-[13px] text-text-muted"> · {e.detalhe}</span>}
                  <div className="text-[11px] text-text-muted">{e.autor ?? 'Desconhecido'}</div>
                </div>
                <span className="num shrink-0 text-[12px] text-text-muted">{fmtDataHora(e.ts)}</span>
              </li>
            ))}
          </ul>
          {(webhooksDoRecebimento.length === LIMITE || auditRaw?.length === LIMITE) && (
            <p className="mt-2 text-[11px] text-text-muted">Mostrando até {LIMITE} eventos mais recentes de cada fonte.</p>
          )}
        </>
      )}
    </div>
  )
}
