// Tipos e textos da manifestação do destinatário (Fase B/R12), sem nenhuma dependência: a tela (componente de cliente)
// importa daqui; o resto (montar o evento, ler a resposta) fica em sefaz-manifestacao.ts.
export type TipoManifestacao = '210200' | '210220' | '210240'
export const MANIFESTACOES: Record<TipoManifestacao, { desc: string; rotulo: string; exigeJustificativa: boolean }> = {
  '210200': { desc: 'Confirmacao da Operacao', rotulo: 'Confirmar a operação', exigeJustificativa: false },
  '210220': { desc: 'Desconhecimento da Operacao', rotulo: 'Desconhecer a operação', exigeJustificativa: false },
  '210240': { desc: 'Operacao nao Realizada', rotulo: 'Operação não realizada', exigeJustificativa: true },
}
export const ehTipoManifestacao = (t: unknown): t is TipoManifestacao => t === '210200' || t === '210220' || t === '210240'

/** 210240 exige justificativa de 15 a 255 caracteres (depois do trim). */
export function validarJustificativa(tipo: TipoManifestacao, j: string | null | undefined): string | null {
  if (!MANIFESTACOES[tipo].exigeJustificativa) return null
  const t = (j ?? '').trim()
  if (t.length < 15) return 'Explique o motivo com pelo menos 15 caracteres.'
  if (t.length > 255) return 'O motivo passa de 255 caracteres.'
  return null
}

