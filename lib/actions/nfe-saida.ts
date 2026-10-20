'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getProfile, isAdminDaLoja, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import {
  cancelarNfe, conferirAntesDeEmitir, consultarNfe, corrigirNfe, descartarNfe, emitirNfe, type OpcoesEmissao, type OrigemNfe, type ResultadoNfe,
} from '@/lib/nfe-saida/emissao'

// Fase F (F1/F2): NF-e de SAÍDA do estoque próprio (devolução ao fornecedor e transferência entre lojas). Precisa de
// internet e do certificado da loja (fora da política offline do desktop). Permissão "Compras - Emitir NF-e".
// Ambiente: NFE_AMBIENTE no servidor (padrão homologação); nada na tela troca isso.

type Erro = { error: string }
const PERMISSAO = 'Compras - Emitir NF-e'

async function contexto(): Promise<{ lojaId: number; u: { id: string; nome: string } } | Erro> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'NF-e de saída pelo app só existe na loja de estoque próprio.' }
  if (!(await requirePermissao(lojaId, PERMISSAO))) return { error: 'Sem permissão para emitir NF-e' }
  const p = await getProfile()
  return { lojaId, u: { id: p.id, nome: p.name } }
}

function atualizar() {
  revalidatePath('/devolucao-fornecedor')
  revalidatePath('/transferencia-loja')
  revalidatePath('/nfe-saida')
  revalidatePath('/nota-fiscal/[id]', 'page')
}

function opcoesLimpas(o: OpcoesEmissao | undefined): OpcoesEmissao {
  const mod = Number(o?.modFrete)
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  return {
    modFrete: ([0, 1, 2, 3, 4, 9] as const).find((x) => x === mod) ?? 9,
    transportadora: o?.transportadora && (o.transportadora.doc || o.transportadora.xNome) ? {
      doc: String(o.transportadora.doc ?? '').replace(/\D/g, '') || null, xNome: String(o.transportadora.xNome ?? '').slice(0, 60) || null,
      ie: String(o.transportadora.ie ?? '').replace(/\D/g, '') || null, uf: String(o.transportadora.uf ?? '').slice(0, 2).toUpperCase() || null,
    } : null,
    volumes: o?.volumes ? { qVol: n(o.volumes.qVol), esp: String(o.volumes.esp ?? '').slice(0, 60) || null, pesoL: n(o.volumes.pesoL), pesoB: n(o.volumes.pesoB) } : null,
    observacao: String(o?.observacao ?? '').slice(0, 500) || null,
  }
}

const valida = (origem: string): origem is OrigemNfe => origem === 'devolucao' || origem === 'transferencia_loja'

/** O que falta no cadastro para emitir (sem reservar número nem falar com a SEFAZ). */
export async function conferirNfeSaida(origem: OrigemNfe, origemId: number): Promise<{ ok: true; tpAmb: 1 | 2; faltas: string[] } | Erro> {
  const __d = viaDesktop('nfe-saida#conferirNfeSaida', conferirNfeSaida, [origem, origemId]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if (!valida(origem)) return { error: 'Documento inválido' }
  return conferirAntesDeEmitir(ctx.lojaId, origem, Number(origemId))
}

export async function emitirNfeSaida(origem: OrigemNfe, origemId: number, opcoes?: OpcoesEmissao): Promise<ResultadoNfe> {
  const __d = viaDesktop('nfe-saida#emitirNfeSaida', emitirNfeSaida, [origem, origemId, opcoes]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  if (!valida(origem)) return { error: 'Documento inválido' }
  const r = await emitirNfe(ctx.lojaId, origem, Number(origemId), opcoesLimpas(opcoes), ctx.u)
  if ('ok' in r) await registrarAuditoria('criar', 'NF-e de saída', r.id, `${origem} ${origemId}: ${r.mensagem}`)
  atualizar()
  return r
}

export async function consultarNfeSaida(nfeId: number): Promise<ResultadoNfe> {
  const __d = viaDesktop('nfe-saida#consultarNfeSaida', consultarNfeSaida, [nfeId]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const r = await consultarNfe(ctx.lojaId, Number(nfeId), ctx.u)
  atualizar()
  return r
}

export async function cancelarNfeSaida(nfeId: number, justificativa: string): Promise<ResultadoNfe> {
  const __d = viaDesktop('nfe-saida#cancelarNfeSaida', cancelarNfeSaida, [nfeId, justificativa]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const r = await cancelarNfe(ctx.lojaId, Number(nfeId), String(justificativa ?? ''), ctx.u)
  if ('ok' in r) await registrarAuditoria('cancelar', 'NF-e de saída', r.id, String(justificativa ?? '').trim())
  atualizar()
  return r
}

export async function corrigirNfeSaida(nfeId: number, correcao: string): Promise<ResultadoNfe> {
  const __d = viaDesktop('nfe-saida#corrigirNfeSaida', corrigirNfeSaida, [nfeId, correcao]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const r = await corrigirNfe(ctx.lojaId, Number(nfeId), String(correcao ?? ''), ctx.u)
  if ('ok' in r) await registrarAuditoria('editar', 'NF-e de saída (CC-e)', r.id, String(correcao ?? '').trim().slice(0, 200))
  atualizar()
  return r
}

export async function descartarNfeSaida(nfeId: number, motivo?: string): Promise<ResultadoNfe> {
  const __d = viaDesktop('nfe-saida#descartarNfeSaida', descartarNfeSaida, [nfeId, motivo]); if (__d) return __d as never
  const ctx = await contexto()
  if ('error' in ctx) return ctx
  const r = await descartarNfe(ctx.lojaId, Number(nfeId), motivo ?? null, ctx.u)
  if ('ok' in r) await registrarAuditoria('excluir', 'NF-e de saída (descartada)', r.id, motivo ?? '')
  atualizar()
  return r
}

// ------------------------------------------------------------------------------------------------ configuração
export type ConfigNfeEntrada = {
  crt: number | null; serieProducao: number | null; serieHomologacao: number; autxmlCnpj: string | null; cstPisCofins: string
  csosnTransferencia: string; cstTransferencia: string; csosnRemessa: string; cstRemessa: string; infoComplementar: string | null
  codigoMunicipio: string | null
}

/** Configuração fiscal (só quem administra a loja). Grava em nfe_config e o código IBGE do município em lojas. */
export async function salvarConfigNfe(c: ConfigNfeEntrada): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('nfe-saida#salvarConfigNfe', salvarConfigNfe, [c]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Só na loja de estoque próprio.' }
  if (!(await isAdminDaLoja(lojaId))) return { error: 'Só quem administra a loja muda a configuração fiscal.' }
  const p = await getProfile()
  const crt = c.crt == null ? null : Number(c.crt)
  if (crt != null && ![1, 2, 3, 4].includes(crt)) return { error: 'CRT inválido' }
  const serieOk = (s: number | null) => s == null || (Number.isInteger(s) && s >= 0 && s <= 999)
  if (!serieOk(c.serieProducao) || !serieOk(c.serieHomologacao)) return { error: 'Série precisa ser um número de 0 a 999' }
  const aut = String(c.autxmlCnpj ?? '').replace(/\D/g, '')
  if (aut && aut.length !== 14) return { error: 'CNPJ do escritório de contabilidade (autXML) precisa ter 14 dígitos' }
  const mun = String(c.codigoMunicipio ?? '').replace(/\D/g, '')
  if (mun && mun.length !== 7) return { error: 'O código IBGE do município tem 7 dígitos' }
  const sb = createServiceClient()
  const { error } = await sb.from('nfe_config').upsert({
    loja_id: lojaId, crt, serie_producao: c.serieProducao, serie_homologacao: c.serieHomologacao ?? 920, autxml_cnpj: aut || null,
    cst_pis_cofins: c.cstPisCofins || '49', csosn_transferencia: c.csosnTransferencia || '400', cst_transferencia: c.cstTransferencia || '41',
    csosn_remessa: c.csosnRemessa || '900', cst_remessa: c.cstRemessa || '90', info_complementar: (c.infoComplementar ?? '').trim() || null,
    updated_at: new Date().toISOString(), updated_by: p.name,
  }, { onConflict: 'loja_id' })
  if (error) return { error: /nfe_config/.test(error.message) ? 'A NF-e de saída ainda não foi ativada nesta instalação (migration 260).' : 'Não foi possível salvar (confira os códigos).' }
  const { error: e2 } = await sb.from('lojas').update({ codigo_municipio: mun || null }).eq('id', lojaId)
  if (e2) return { error: 'Configuração salva, mas não foi possível gravar o código do município.' }
  await registrarAuditoria('editar', 'configuração da NF-e de saída', lojaId, `CRT ${crt ?? '-'}, série prod ${c.serieProducao ?? '-'}, homolog ${c.serieHomologacao}`)
  revalidatePath('/nfe-saida')
  return { ok: true }
}

/** Próximo número de uma série (para continuar a sequência de outro emissor). Nunca volta para trás. */
export async function definirProximoNumeroNfe(tpAmb: 1 | 2, serie: number, proximo: number): Promise<{ ok: true } | Erro> {
  const __d = viaDesktop('nfe-saida#definirProximoNumeroNfe', definirProximoNumeroNfe, [tpAmb, serie, proximo]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Só na loja de estoque próprio.' }
  if (!(await isAdminDaLoja(lojaId))) return { error: 'Só quem administra a loja muda a numeração.' }
  const { error } = await createServiceClient().rpc('nfe_definir_proximo_numero', { p_loja: lojaId, p_tp_amb: tpAmb === 1 ? 1 : 2, p_serie: Number(serie), p_proximo: Number(proximo) })
  if (error) return { error: error.code === '22023' ? error.message : 'Não foi possível mudar a numeração.' }
  await registrarAuditoria('editar', 'numeração da NF-e', lojaId, `ambiente ${tpAmb}, série ${serie}, próximo ${proximo}`)
  revalidatePath('/nfe-saida')
  return { ok: true }
}
