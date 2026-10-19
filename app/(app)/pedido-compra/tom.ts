import type { CorToken } from '@/lib/status-cor'
import type { Tom } from '@/lib/compras/pedido-puro'

export const TOM_COR: Record<Tom, CorToken> = { ok: 'ok', aviso: 'warn', erro: 'err', neutro: 'neutro', info: 'info' }
