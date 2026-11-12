// Norte Cozinha, Configurações de compras e contagem (PURO, node --test): cobertura da lista de compras, WhatsApp de quem
// recebe os pedidos e dia da contagem semanal. Colunas de custo_cardapio_config (migration 474).

export type ConfigCompras = {
  /** Dias de consumo que a sugestão de compra cobre (1 a 90). */
  coberturaDias: number
  /** Só dígitos, com o código do país (ex.: 5571999999999); null = escolhe o contato a cada envio. */
  whatsappCompras: string | null
  /** 0 = domingo … 6 = sábado; null = lembrete desligado. */
  diaContagem: number | null
}

export const COMPRAS_PADRAO: ConfigCompras = { coberturaDias: 7, whatsappCompras: null, diaContagem: null }
export const COBERTURA_MIN = 1
export const COBERTURA_MAX = 90
export const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** Lê a linha do banco; valor fora da regra vira o padrão. */
export function lerConfigCompras(row: { cobertura_dias?: unknown; whatsapp_compras?: unknown; dia_contagem?: unknown } | null): ConfigCompras {
  if (!row) return { ...COMPRAS_PADRAO }
  const c = Number(row.cobertura_dias)
  const w = soDigitos(row.whatsapp_compras)
  const d = row.dia_contagem == null || row.dia_contagem === '' ? null : Number(row.dia_contagem)
  return {
    coberturaDias: Number.isInteger(c) && c >= COBERTURA_MIN && c <= COBERTURA_MAX ? c : COMPRAS_PADRAO.coberturaDias,
    whatsappCompras: /^\d{10,15}$/.test(w) ? w : null,
    diaContagem: d != null && Number.isInteger(d) && d >= 0 && d <= 6 ? d : null,
  }
}

/** Junta código do país e número digitados (com ou sem máscara) em só dígitos. Vazio = null. */
export function montarWhatsapp(ddi: string, numero: string): string | null {
  const n = soDigitos(numero)
  if (!n) return null
  const d = soDigitos(ddi) || '55'
  // Quem cola o número já com o 55 na frente não ganha o código duas vezes.
  return n.startsWith(d) && n.length >= d.length + 10 ? n : `${d}${n}`
}

/** Separa o número salvo em código do país + resto, para mostrar no formulário. Só conhece o 55; outro país fica todo no número. */
export function separarWhatsapp(salvo: string | null): { ddi: string; numero: string } {
  if (!salvo) return { ddi: '55', numero: '' }
  if (salvo.startsWith('55') && salvo.length >= 12) return { ddi: '55', numero: salvo.slice(2) }
  return { ddi: '', numero: salvo }
}

/** Valida o que chega do formulário (o servidor sempre chama). Devolve a lista de problemas. */
export function validarConfigCompras(c: { coberturaDias: unknown; whatsappCompras: unknown; diaContagem: unknown }): string[] {
  const erros: string[] = []
  const cob = Number(c.coberturaDias)
  if (!Number.isInteger(cob) || cob < COBERTURA_MIN || cob > COBERTURA_MAX) erros.push(`A cobertura deve ser um número inteiro de ${COBERTURA_MIN} a ${COBERTURA_MAX} dias.`)
  if (c.whatsappCompras != null && c.whatsappCompras !== '') {
    const w = String(c.whatsappCompras)
    if (!/^\d{10,15}$/.test(w)) erros.push('O WhatsApp de compras deve ter o código do país e o número, de 10 a 15 dígitos.')
  }
  if (c.diaContagem != null && c.diaContagem !== '') {
    const d = Number(c.diaContagem)
    if (!Number.isInteger(d) || d < 0 || d > 6) erros.push('Dia da contagem inválido.')
  }
  return erros
}

/** "+55 71 99999-9999" para mostrar (só formata o Brasil; o resto vai com + e os dígitos). */
export function whatsappLegivel(w: string | null): string {
  if (!w) return ''
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(w)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${w}`
}

/** Link do WhatsApp com o texto pronto. Sem número, o WhatsApp pergunta o contato. */
export function linkWhatsapp(numero: string | null, texto: string): string {
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`
}
