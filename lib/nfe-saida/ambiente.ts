// Ambiente da SEFAZ para a NF-e de SAÍDA (Fase F, F1/F2). Sem dependências: node --test lib/nfe-saida/ambiente.test.ts
//
// REGRA: o padrão é HOMOLOGAÇÃO (tpAmb 2, sem valor fiscal). Produção (tpAmb 1) só quando a variável de ambiente
// NFE_AMBIENTE for exatamente "producao" no servidor. Qualquer outro valor (vazio, "1", "prod", "PRODUCAO " etc.) =
// homologação. Não existe chave na tela nem no banco que mude isto: virar produção é um passo de deploy, com OK do dono.

export type TpAmb = 1 | 2

export function tpAmbDaNfe(valor: string | undefined | null = typeof process !== 'undefined' ? process.env.NFE_AMBIENTE : undefined): TpAmb {
  return valor === 'producao' ? 1 : 2
}

export function rotuloAmbiente(tp: TpAmb | number): string {
  return tp === 1 ? 'Produção' : 'Homologação (teste, sem valor fiscal)'
}
