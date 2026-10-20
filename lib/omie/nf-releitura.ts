// Releitura de nota de entrada já gravada quando o Omie avisa que ela foi concluída/revertida de novo (paridade
// numérica 20/10/2026, bug B7 de omie-rea/gaps/paridade-numerica-2026-10-20.md).
//
// Achado: o aviso "RecebimentoProduto.*" do Omie traz o id do recebimento em `event.cabecalho.nIdReceb`, não em
// `event.nIdReceb` (4.441 de 4.441 avisos gravados em `webhooks`, lojas 2–6, 03/09–20/10/2026). A rota do webhook lia
// `event.nIdReceb`, então NUNCA reconsultava a nota. O sync de 10 em 10 min (`ListarRecebimentos` com dtAltDe dos
// últimos 7 dias) não pega a nota re-concluída porque o Omie não muda `dAlt` nesse caso: a NF 3999 (loja 5) foi
// revertida, re-associada (item 80104 → 80107, ~R$ 3 mil) e concluída de novo em 07/10, e o NTB ficou com a cópia de
// 24/09. Em 20/10, 21 notas da loja 5 tinham aviso de conclusão/reversão posterior à última gravação.
//
// Correção barata: (1) a rota lê o id certo e só reconsulta em Concluido/Revertido (1 ConsultarRecebimento por aviso, não
// nos Incluido/Alterado); (2) o cron de notas (sync-nfs, a cada 10 min) relê no máximo 3 notas por loja e ciclo cujo
// aviso é mais novo que a última gravação (pega aviso que falhou e o atraso de antes da correção). Nunca na loja 4
// (produção protegida, não pode ficar mais pesada que hoje) nem na 7; para no primeiro erro e não repete a mesma nota por
// 6 h (o Omie bloqueia o método na 10ª requisição com erro, lib/omie/erros-omie.ts).
// Puro (sem imports): node --test lib/omie/nf-releitura.test.ts

export const TOPICOS_RELEITURA = ['RecebimentoProduto.Concluido', 'RecebimentoProduto.Revertido'] as const

/** Só conclusão e reversão mudam o que entra no estoque (associação do item, etapa); inclusão/alteração não. */
export function deveRelerNota(topico: string | null | undefined): boolean {
  return (TOPICOS_RELEITURA as readonly string[]).includes(String(topico ?? ''))
}

/** id do recebimento no aviso do Omie: `event.cabecalho.nIdReceb` (formato real); `event.nIdReceb` só por garantia. */
export function nIdRecebDoAviso(body: unknown): number | null {
  const ev = (body as { event?: { nIdReceb?: unknown; cabecalho?: { nIdReceb?: unknown } } } | null)?.event
  const v = Number(ev?.cabecalho?.nIdReceb ?? ev?.nIdReceb)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Lojas fora da releitura: OMIE_NF_RELEITURA_LOJAS_FORA (ids separados por vírgula); padrão "4,7". */
export function lojasForaDaReleitura(env: string | undefined): Set<number> {
  const s = env === undefined ? '4,7' : env
  return new Set(s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))
}

export const LIMITE_RELEITURA_POR_CICLO = 3
export const DIAS_RELEITURA = 30
export const ESPERA_APOS_FALHA_MS = 6 * 3600_000

export type AvisoNota = { n_id_receb: string | number | null; created_at: string }
export type NotaGravada = { n_id_receb: string; updated_at: string; deleted_at: string | null }

/** Notas a reler: aviso de conclusão/reversão mais novo que a última gravação, sem falha nas últimas 6 h, mais recentes
 *  primeiro, no máximo `limite`. Nota que o NTB não tem ou apagou fica de fora (o sync normal cuida da nova). */
export function escolherNotasParaReler(
  avisos: AvisoNota[], notas: NotaGravada[], opts: { limite?: number; agoraMs?: number; falhas?: Map<string, number> } = {},
): string[] {
  const limite = opts.limite ?? LIMITE_RELEITURA_POR_CICLO
  const agora = opts.agoraMs ?? Date.now()
  const ultimo = new Map<string, number>()
  for (const a of avisos) {
    if (a.n_id_receb == null) continue
    const k = String(a.n_id_receb)
    const t = Date.parse(a.created_at)
    if (Number.isFinite(t) && t > (ultimo.get(k) ?? -Infinity)) ultimo.set(k, t)
  }
  const gravada = new Map(notas.map((n) => [String(n.n_id_receb), n]))
  const fila: { k: string; t: number }[] = []
  for (const [k, t] of ultimo) {
    const n = gravada.get(k)
    if (!n || n.deleted_at) continue
    if (!(t > Date.parse(n.updated_at))) continue
    const falhou = opts.falhas?.get(k)
    if (falhou !== undefined && agora - falhou < ESPERA_APOS_FALHA_MS) continue
    fila.push({ k, t })
  }
  return fila.sort((a, b) => b.t - a.t || a.k.localeCompare(b.k)).slice(0, limite).map((x) => x.k)
}

// Falhas por nota, no processo (um `next start` só no servidor, mesmo padrão do disjuntor de erros-omie.ts).
const falhas = new Map<string, number>()
export function registrarFalhaReleitura(nIdReceb: string, agoraMs: number = Date.now()): void { falhas.set(nIdReceb, agoraMs) }
export function falhasReleitura(): Map<string, number> { return falhas }
