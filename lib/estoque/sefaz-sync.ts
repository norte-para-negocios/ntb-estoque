import { createServiceClient } from '@/lib/supabase/server'
import { carregarCredencialLoja, type CredencialLoja } from './sefaz-certificado'
import { consultarDistribuicao, consultarPorChave, enviarCiencia } from './sefaz-rede'
import { lerEvento, lerResNFe, proximaConsulta, tipoDocumento, type DocDistribuido } from './sefaz-distdfe'
import { lerNfe } from './nfe-xml'
import { cabecalhoDoResumo } from './nf-sefaz-mapa'
import { gravarNotaCompleta } from './nf-sefaz'
import { espelharNotaNoFrio } from './nf-frio'

// Puxa as notas de entrada da SEFAZ (NFeDistribuicaoDFe, Ambiente Nacional) para uma loja de estoque próprio, sozinho, como o Omie faz:
// resumo (resNFe) → ciência da operação → XML completo (procNFe) → nota no formato do Omie → conferência com o cadastro → entrada no estoque.
// Respeita o limite da SEFAZ: sem novidade ou consumo indevido (656) = esperar 1 hora (sefaz_nsu.bloqueado_ate); nunca consulta em loop.

export type ResultadoSync = {
  lojaId: number; ok: boolean; motivo?: string; erro?: string; bloqueadoAte?: string | null
  consultas: number; documentos: number; notas: number; resumos: number; lancadas: number; aConferir: number; ciencias: number; cancelamentos: number; ignorados: number; falhas: number
}

const vazio = (lojaId: number): ResultadoSync => ({ lojaId, ok: true, consultas: 0, documentos: 0, notas: 0, resumos: 0, lancadas: 0, aConferir: 0, ciencias: 0, cancelamentos: 0, ignorados: 0, falhas: 0 })
const MAX_LOTES_POR_EXECUCAO = 5
const MAX_CIENCIAS_POR_EXECUCAO = 15

type Ctx = { lojaId: number; cnpj: string; ambiente: 1 | 2; autoLancar: boolean; autoCiencia: boolean; uf?: string | null }
const ESPERA_BUSCA_CHAVE_MS = 60 * 60 * 1000

async function marcarDoc(lojaId: number, nsu: string, campos: Record<string, unknown>) {
  await createServiceClient().from('sefaz_documentos').update(campos).eq('loja_id', lojaId).eq('nsu', nsu)
}

async function notaPorChave(lojaId: number, chave: string): Promise<{ id: number } | null> {
  const { data } = await createServiceClient().from('notas_fiscais').select('id').eq('loja_id', lojaId).eq('c_chave_nfe', chave).is('deleted_at', null).maybeSingle()
  return data ? { id: Number(data.id) } : null
}

async function processarDocumento(ctx: Ctx, doc: DocDistribuido, r: ResultadoSync): Promise<void> {
  const sb = createServiceClient()
  const tipo = tipoDocumento(doc.schema)
  try {
    if (tipo === 'procNFe') {
      const nfe = lerNfe(doc.xml)
      if (nfe.fornecedor.cnpj === ctx.cnpj || nfe.tipoOperacao === '0') {
        r.ignorados++; await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, ignorado: 'nota emitida pela própria loja', chave: nfe.chave }); return
      }
      const res = await gravarNotaCompleta(ctx.lojaId, nfe, { ambiente: String(ctx.ambiente) as '1' | '2', origem: 'sefaz', nsu: doc.nsu, autoLancar: ctx.autoLancar, cnpjLoja: ctx.cnpj })
      r.notas++
      if (res.lancada) r.lancadas++; else r.aConferir++
      await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, chave: nfe.chave, nota_fiscal_id: res.notaId, erro: null })
      return
    }
    if (tipo === 'resNFe') {
      const res = lerResNFe(doc.xml)
      if (res.cnpj === ctx.cnpj || res.tipoOperacao === '0') {
        r.ignorados++; await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, ignorado: 'nota emitida pela própria loja', chave: res.chave }); return
      }
      const existente = await notaPorChave(ctx.lojaId, res.chave)
      let notaId = existente?.id ?? null
      if (!existente) {
        const { data, error } = await sb.rpc('gravar_nota_sefaz', { p_loja: ctx.lojaId, p_cab: cabecalhoDoResumo(res, String(ctx.ambiente) as '1' | '2', doc.nsu), p_itens: [] })
        if (error) throw new Error(error.message)
        notaId = Number((data as { nota_id: number }).nota_id)
        await sb.rpc('sincronizar_situacao_nota', { p_loja: ctx.lojaId, p_nota: notaId })
        void espelharNotaNoFrio(ctx.lojaId, notaId)
        r.resumos++
      }
      if (res.situacao === '3') await sb.rpc('sefaz_marcar_cancelada', { p_loja: ctx.lojaId, p_chave: res.chave })
      await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, chave: res.chave, nota_fiscal_id: notaId })
      return
    }
    if (tipo === 'procEventoNFe' || tipo === 'resEvento') {
      const ev = lerEvento(doc.xml)
      if (ev.tpEvento === '110111' && ev.chave) {
        const { data } = await sb.rpc('sefaz_marcar_cancelada', { p_loja: ctx.lojaId, p_chave: ev.chave })
        if ((data as { nota?: boolean } | null)?.nota) {
          r.cancelamentos++
          const n = await notaPorChave(ctx.lojaId, ev.chave); if (n) void espelharNotaNoFrio(ctx.lojaId, n.id)
        }
      }
      await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, chave: ev.chave || null, ignorado: ev.tpEvento === '110111' ? null : `evento ${ev.tpEvento} ignorado` })
      return
    }
    r.ignorados++
    await marcarDoc(ctx.lojaId, doc.nsu, { processado: true, ignorado: `documento ${doc.schema} ignorado` })
  } catch (e) {
    r.falhas++
    await marcarDoc(ctx.lojaId, doc.nsu, { erro: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
    console.error(`sefaz-sync loja ${ctx.lojaId}: falha ao processar NSU ${doc.nsu} (${doc.schema})`, e)
  }
}

async function darCiencias(ctx: Ctx, cred: CredencialLoja, r: ResultadoSync): Promise<void> {
  if (!ctx.autoCiencia) return
  const sb = createServiceClient()
  const { data: pend } = await sb.from('sefaz_documentos').select('id, chave').eq('loja_id', ctx.lojaId).eq('tipo', 'resNFe').is('ciencia_em', null).is('ignorado', null)
    .not('chave', 'is', null).order('id').limit(MAX_CIENCIAS_POR_EXECUCAO)
  for (const d of pend ?? []) {
    // já temos o XML completo desta chave: não precisa de ciência
    const { data: completo } = await sb.from('sefaz_documentos').select('id').eq('loja_id', ctx.lojaId).eq('chave', d.chave).eq('tipo', 'procNFe').limit(1)
    if (completo?.length) { await sb.from('sefaz_documentos').update({ ciencia_em: new Date().toISOString(), ciencia_cstat: 'xml-completo' }).eq('id', d.id); continue }
    try {
      const c = await enviarCiencia({ chave: d.chave as string, cnpj: ctx.cnpj, tpAmb: ctx.ambiente, cred })
      if (c.ok) { await sb.from('sefaz_documentos').update({ ciencia_em: new Date().toISOString(), ciencia_cstat: c.cStat, erro: null }).eq('id', d.id); r.ciencias++ }
      else await sb.from('sefaz_documentos').update({ ciencia_cstat: c.cStat, erro: `ciência recusada: ${c.xMotivo ?? c.cStat}` }).eq('id', d.id)
    } catch (e) {
      console.error(`sefaz-sync loja ${ctx.lojaId}: falha na ciência da operação`, e instanceof Error ? e.message : e)
      break // problema de rede/certificado: tenta de novo no próximo ciclo, sem insistir
    }
  }
}

// Depois da ciência, busca o XML completo pela chave (consChNFe) em vez de esperar o próximo NSU (até 1 hora de espera).
// No máximo uma tentativa por nota por hora (sefaz_documentos.busca_chave_em), para não cair no consumo indevido (656).
async function buscarCompletosPorChave(ctx: Ctx, cred: CredencialLoja, r: ResultadoSync): Promise<void> {
  const sb = createServiceClient()
  const limite = new Date(Date.now() - ESPERA_BUSCA_CHAVE_MS).toISOString()
  const { data: pend } = await sb.from('sefaz_documentos').select('id, chave').eq('loja_id', ctx.lojaId).eq('tipo', 'resNFe').not('ciencia_em', 'is', null).is('ignorado', null)
    .not('chave', 'is', null).or(`busca_chave_em.is.null,busca_chave_em.lt.${limite}`).order('id').limit(MAX_CIENCIAS_POR_EXECUCAO)
  for (const d of pend ?? []) {
    const { data: completo } = await sb.from('sefaz_documentos').select('id').eq('loja_id', ctx.lojaId).eq('chave', d.chave).eq('tipo', 'procNFe').limit(1)
    if (completo?.length) continue
    await sb.from('sefaz_documentos').update({ busca_chave_em: new Date().toISOString() }).eq('id', d.id)
    try {
      const ret = await consultarPorChave({ cnpj: ctx.cnpj, tpAmb: ctx.ambiente, chave: d.chave as string, uf: ctx.uf, cred })
      r.consultas++
      const docs = ret.docs.filter((x) => tipoDocumento(x.schema) === 'procNFe')
      if (!docs.length) continue
      const linhas = docs.map((x) => ({ loja_id: ctx.lojaId, nsu: x.nsu, schema: x.schema, tipo: 'procNFe', completo: true, xml: x.xml }))
      const { error } = await sb.from('sefaz_documentos').upsert(linhas, { onConflict: 'loja_id,nsu', ignoreDuplicates: true })
      if (error) throw new Error('Falha ao guardar o XML completo: ' + error.message)
      r.documentos += docs.length
      for (const x of docs) await processarDocumento(ctx, x, r)
    } catch (e) {
      console.error(`sefaz-sync loja ${ctx.lojaId}: falha ao buscar a nota pela chave`, e instanceof Error ? e.message : e)
      break
    }
  }
}

export async function sincronizarSefaz(lojaId: number): Promise<ResultadoSync> {
  const r = vazio(lojaId)
  const sb = createServiceClient()
  const agora = Date.now()
  const { data: loja } = await sb.from('lojas').select('id, cnpj, uf, modo_estoque, ativo, certificado_path').eq('id', lojaId).maybeSingle()
  if (!loja || loja.modo_estoque !== 'proprio') return { ...r, ok: false, motivo: 'A loja não usa estoque próprio.' }
  if (!loja.ativo) return { ...r, ok: false, motivo: 'Loja inativa.' }
  const cnpj = String(loja.cnpj ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14) return { ...r, ok: false, motivo: 'A loja precisa de um CNPJ válido para consultar as notas na SEFAZ.' }
  if (!loja.certificado_path) return { ...r, ok: false, motivo: 'A loja não tem certificado digital cadastrado.' }

  let { data: nsu } = await sb.from('sefaz_nsu').select('*').eq('loja_id', lojaId).maybeSingle()
  if (!nsu) {
    const { data: criado } = await sb.from('sefaz_nsu').insert({ loja_id: lojaId, cnpj }).select('*').single()
    nsu = criado
  }
  if (!nsu || !nsu.ativo) return { ...r, ok: true, motivo: 'Consulta à SEFAZ desligada para esta loja.' }
  const bloq = nsu.bloqueado_ate ? new Date(nsu.bloqueado_ate).getTime() : 0
  const ctx: Ctx = { lojaId, cnpj, ambiente: nsu.ambiente === 2 ? 2 : 1, autoLancar: !!nsu.auto_lancar, autoCiencia: !!nsu.auto_ciencia, uf: loja.uf }
  let cred: CredencialLoja
  try { cred = await carregarCredencialLoja(lojaId) }
  catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await sb.from('sefaz_nsu').update({ ultimo_erro: erro, ultima_consulta: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('loja_id', lojaId)
    await sb.from('lojas').update({ nota_fiscal_status: 'Erro' }).eq('id', lojaId)
    return { ...r, ok: false, erro }
  }
  if (bloq > agora) {
    // a espera de 1 hora vale só para a consulta por NSU; ciência e busca pela chave são outros pedidos e seguem
    try { await darCiencias(ctx, cred, r); await buscarCompletosPorChave(ctx, cred, r) }
    catch (e) { console.error(`sefaz-sync loja ${lojaId}: ciência/busca pela chave`, e instanceof Error ? e.message : e) }
    return { ...r, ok: true, motivo: 'A SEFAZ pede esperar antes de consultar de novo.', bloqueadoAte: nsu.bloqueado_ate }
  }
  await sb.from('lojas').update({ nota_fiscal_status: 'Processando' }).eq('id', lojaId)

  let ultNsu = String(nsu.ult_nsu ?? '0')
  let bloqueadoAte: number | null = null
  try {
    for (let lote = 0; lote < MAX_LOTES_POR_EXECUCAO; lote++) {
      const ret = await consultarDistribuicao({ cnpj, tpAmb: ctx.ambiente, ultNsu, uf: loja.uf, cred })
      r.consultas++
      if (ret.docs.length) {
        const linhas = ret.docs.map((d) => ({ loja_id: lojaId, nsu: d.nsu, schema: d.schema, tipo: tipoDocumento(d.schema), completo: d.completo, xml: d.xml }))
        const { error } = await sb.from('sefaz_documentos').upsert(linhas, { onConflict: 'loja_id,nsu', ignoreDuplicates: true })
        if (error) throw new Error('Falha ao guardar os documentos recebidos: ' + error.message)
        r.documentos += ret.docs.length
        for (const d of ret.docs) await processarDocumento(ctx, d, r)
      }
      // O NSU só avança depois dos documentos guardados: se algo acima falhar, a próxima execução relê o mesmo lote.
      const prox = proximaConsulta(ret, agora)
      const avancou = ret.cStat === '138' || ret.cStat === '137'
      if (avancou && ret.ultNsu) ultNsu = ret.ultNsu
      bloqueadoAte = prox.esperarAte
      await sb.from('sefaz_nsu').update({
        ult_nsu: ultNsu, max_nsu: ret.maxNsu || nsu.max_nsu, ultima_consulta: new Date().toISOString(), ultimo_cstat: ret.cStat, ultimo_motivo: ret.xMotivo,
        ultimo_erro: avancou ? null : `${ret.cStat} ${ret.xMotivo}`, bloqueado_ate: bloqueadoAte ? new Date(bloqueadoAte).toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('loja_id', lojaId)
      if (!avancou) { r.ok = ret.cStat === '656'; r.motivo = `SEFAZ ${ret.cStat}: ${ret.xMotivo}`; break }
      if (!prox.continuarJa) break
    }
    await darCiencias(ctx, cred, r)
    await buscarCompletosPorChave(ctx, cred, r)
    await sb.from('lojas').update({ nota_fiscal_status: r.falhas ? 'Erro' : 'Concluido', nota_fiscal_ultima_atualizacao: new Date().toISOString() }).eq('id', lojaId)
    r.bloqueadoAte = bloqueadoAte ? new Date(bloqueadoAte).toISOString() : null
    return r
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await sb.from('sefaz_nsu').update({ ultimo_erro: erro.slice(0, 500), ultima_consulta: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('loja_id', lojaId)
    await sb.from('lojas').update({ nota_fiscal_status: 'Erro' }).eq('id', lojaId)
    return { ...r, ok: false, erro }
  }
}

/** Lojas de estoque próprio com certificado e consulta ligada (para o cron). */
export async function lojasParaSefaz(): Promise<number[]> {
  const { data } = await createServiceClient().from('lojas').select('id').eq('modo_estoque', 'proprio').eq('ativo', true).not('certificado_path', 'is', null).eq('is_test', false)
  return (data ?? []).map((l) => Number(l.id))
}
