// Fase F: fechamento de período (mês) por loja — regras puras. O estado mora em estoque_periodo_fechado
// (migration 230); a trava de verdade é do banco (PF001). Aqui: as mesmas regras para o servidor recusar ANTES de
// mandar qualquer escrita datada ao Omie, para a tela e para os reenvios dos crons.
// Sem imports: node --test lib/estoque/periodo-fechado-puro.test.ts

export type MesFechado = { mes: string /* YYYY-MM */; fechadoEm: string | null; fechadoPorNome: string | null }
export type SituacaoPeriodo = 'fechado' | 'antigo' | 'aberto'
export type Pendencia = { tipo: string; quantidade: number; detalhe: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const OFFSET_BAHIA_MS = 3 * 3600_000 // America/Bahia: UTC−3, sem horário de verão

const pad = (n: number) => String(n).padStart(2, '0')
const idxMes = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1
const mesDoIdx = (i: number) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`

/** 'YYYY-MM' de uma data ('YYYY-MM-DD', timestamp ISO com fuso → dia da Bahia, ou 'DD/MM/YYYY' do Omie). */
export function mesDaData(d: string | null | undefined): string | null {
  if (!d) return null
  const s = d.trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) return Number(br[2]) >= 1 && Number(br[2]) <= 12 ? `${br[3]}-${br[2]}` : null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s)
    if (!Number.isFinite(t)) return null
    const b = new Date(t - OFFSET_BAHIA_MS)
    return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}`
  }
  const iso = s.match(/^(\d{4})-(\d{2})(-\d{2})?/)
  if (!iso) return null
  return Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? `${iso[1]}-${iso[2]}` : null
}

export function rotuloMes(mes: string): string {
  const i = Number(mes.slice(5, 7)) - 1
  return `${MESES[i] ?? mes} de ${mes.slice(0, 4)}`
}

function dataBR(d: string): string {
  const br = d.match(/^\d{2}\/\d{2}\/\d{4}$/)
  if (br) return d
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

/** Mensagem de recusa (mesmo texto do banco) ou null quando nenhuma data cai num mês fechado. */
export function bloqueioPorPeriodo(datas: (string | null | undefined)[], fechados: MesFechado[], oQue: string): string | null {
  const porMes = new Map(fechados.map((f) => [f.mes, f]))
  for (const d of datas) {
    const mes = mesDaData(d)
    const f = mes ? porMes.get(mes) : undefined
    if (!f || !d) continue
    const em = f.fechadoEm ? dataBR(new Date(Date.parse(f.fechadoEm) - OFFSET_BAHIA_MS).toISOString().slice(0, 10)) : '—'
    return `Período fechado: ${oQue} com data em ${dataBR(d.slice(0, 10))}. O mês ${rotuloMes(f.mes)} foi fechado em ${em} por ${f.fechadoPorNome || 'alguém'}. ` +
      'Para mudar, quem tem a permissão "Reabrir mês" reabre em Contador → Fechamento.'
  }
  return null
}

/**
 * fechado = mês com fechamento formal (trava); antigo = o aviso de sempre (antes do mês passado, ou até
 * ESTOQUE_MES_FECHADO_ATE): pede a 2ª confirmação; aberto = nada. Mesma regra de `mesDoAjusteFechado` para "antigo".
 */
export function situacaoDaData(dataISO: string, hojeISO: string, fechados: string[], fechadoAteEnv?: string | null): SituacaoPeriodo {
  const mes = mesDaData(dataISO)
  const hoje = mesDaData(hojeISO)
  if (!mes || !hoje) return 'antigo'
  if (fechados.includes(mes)) return 'fechado'
  if (idxMes(mes) < idxMes(hoje) - 1) return 'antigo'
  const f = (fechadoAteEnv ?? '').match(/^(\d{4})-(\d{2})$/)
  if (f && idxMes(mes) <= idxMes(`${f[1]}-${f[2]}`)) return 'antigo'
  return 'aberto'
}

/** Só fecha mês que já terminou (anterior ao mês de hoje). */
export function validarFechamento(mes: string, hojeISO: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return 'Mês inválido.'
  const hoje = mesDaData(hojeISO)
  if (!hoje || idxMes(mes) >= idxMes(hoje)) return 'Só dá para fechar um mês que já terminou.'
  return null
}

export function validarReabertura(motivo: string): string | null {
  return (motivo ?? '').trim().length < 10 ? 'Explique por que o mês vai ser reaberto (pelo menos 10 letras).' : null
}

/** Os n meses anteriores ao mês de hoje, do mais recente para o mais antigo. */
export function mesesDaTela(hojeISO: string, n = 12): string[] {
  const hoje = mesDaData(hojeISO)
  if (!hoje) return []
  const atual = idxMes(hoje)
  return Array.from({ length: n }, (_, k) => mesDoIdx(atual - 1 - k))
}

export function ehErroPeriodoFechado(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false
  return e.code === 'PF001' || (e.message ?? '').includes('Período fechado:')
}

/** Reenvio ao Omie pode sair (data fora de mês fechado). Sem data: sai (comportamento de sempre). */
export function foraDoMesFechado(data: string | null | undefined, fechados: Set<string>): boolean {
  if (!fechados.size) return true
  const mes = mesDaData(data)
  return !mes || !fechados.has(mes)
}
