import { createClient } from '@/lib/supabase/server'
import { requirePermissao } from '@/lib/auth'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { dataOmieBR } from '@/lib/data-bahia'
import type { LojaOmie } from '@/lib/omie/client'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ArrowLeftRight } from 'lucide-react'
import { BuscaProdutoInline } from '@/components/movimentacoes/BuscaProdutoInline'
import { FiltroDataMovimentos } from '@/components/movimentacoes/FiltroDataMovimentos'
import { FiltroLocalMovimentos } from '@/components/movimentacoes/FiltroLocalMovimentos'
import { FiltroFamiliaMovimentos } from '@/components/movimentacoes/FiltroFamiliaMovimentos'
import { FiltroTipoMovimentos } from '@/components/movimentacoes/FiltroTipoMovimentos'
import { NovoAjusteManual } from '@/components/movimentacoes/NovoAjusteManual'
import { escapeIlikeOr } from '@/lib/utils-busca'
import { statusNF } from '@/lib/nf-status'
import {
  complementarMovimentosHistorico,
  complementarMovimentos,
  complementarOrdensProducao,
  buscarFrioNotaFiscalItems,
  buscarFrioTudo,
  limiteJanelaQuente,
} from '@/lib/historico-contabo'

function fmtDataDetalhe(d: string): string {
  if (d.includes('T')) {
    return new Date(d).toLocaleString('pt-BR', {
      timeZone: 'America/Bahia', day: '2-digit', month: '2-digit',
      year: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }
  const [y, mo, dia] = d.slice(0, 10).split('-')
  return `${dia}/${mo}/${y}`
}

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

type SP = { data_inicio?: string; data_final?: string; produto?: string; local?: string; familia?: string; tipo?: string }

type LinhaDetalhe = {
  chave: string
  data: string
  tipo: string
  quan: number
  local: number | null
  destino: number | null
  obs: string | null
  status: string | null
}

const TIPOS: Record<string, { label: string; cor: string }> = {
  ENT: { label: 'Entrada', cor: 'text-ok' },
  SAI: { label: 'Saída', cor: 'text-err' },
  SLD: { label: 'Inventário', cor: 'text-text' },
  TRF: { label: 'Transferência', cor: 'text-warn' },
  TPQ: { label: 'Perda / Quebra', cor: 'text-text-muted' },
  OP:  { label: 'Ordem de Produção', cor: 'text-brand' },
}

// Contribuicao assinada de um movimento no saldo de um local especifico. TRF/TPQ
// tem origem (sai) e destino (entra) -- os demais tipos so afetam `local`.
function sinalEm(m: { tipo: string; quan: number; local: number | null; destino: number | null }, localX: number): number {
  const abs = Math.abs(m.quan)
  if (m.tipo === 'TRF' || m.tipo === 'TPQ') {
    let s = 0
    if (m.local === localX) s -= abs
    if (m.destino === localX) s += abs
    return s
  }
  if (m.local !== localX) return 0
  if (m.tipo === 'ENT') return abs
  if (m.tipo === 'SAI') return -abs
  if (m.tipo === 'SLD') return m.quan // ja assinado (diferenca de contagem de inventario)
  return 0
}

export async function MovimentosTab({ sp, lojaId }: { sp: SP; lojaId: number }) {
  const supabase = await createClient()
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  // Padrão: data única = hoje (diferente do Histórico que usa período de 30 dias)
  const ini = sp.data_inicio || hojeISO
  const fim = sp.data_final || sp.data_inicio || hojeISO
  const localFiltro = sp.local ? Number(sp.local) : null

  const [{ data: locaisRaw }, { data: familiasRaw }, podeCriar] = await Promise.all([
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .neq('inativo', 'S')
      .order('descricao'),
    supabase
      .from('familias')
      .select('nome')
      .eq('loja_id', lojaId)
      .eq('inativo', false)
      .order('nome'),
    requirePermissao(lojaId, 'Movimentacoes - Criar'),
  ])
  const locais = (locaisRaw ?? []) as { codigo_local_estoque: number; descricao: string | null }[]
  const familias = ((familiasRaw ?? []) as { nome: string }[]).map((f) => f.nome)

  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null
  let movDetalhes: LinhaDetalhe[] = []
  let idsProdDetalhes: number[] = []
  let produtoUnico: { id_prod: number; codigo: string; descricao: string } | null = null
  const locaisMap = new Map<number, string>()
  let saldoInicial: number | null = null
  let saldoFinal: number | null = null
  // Total OFICIAL: vem direto do sync do Omie (movimentos_historico, mesma fonte
  // da aba Historico) -- e o numero que vale. A tabela de detalhe abaixo mistura
  // ajustes reais (sync Omie) com OP/NF/inventario RECONSTRUIDOS localmente (pra
  // explicar o "por que"), que podem nao bater 1:1 com o que o Omie registrou.
  let totalOmie: { entradas: number; saidas: number } | null = null

  if (termo) {
    const { data: prodsMatch } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao')
      .eq('loja_id', lojaId)
      .or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      .limit(100)

    idsProdDetalhes = [...new Set((prodsMatch ?? []).map((p) => Number(p.codigo_produto)).filter(Boolean))]

    // Filtro adicional de familia/tipo: restringe os produtos ja achados pela busca.
    if ((sp.familia || sp.tipo) && idsProdDetalhes.length) {
      let fq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).in('codigo_produto', idsProdDetalhes)
      if (sp.familia) fq = fq.eq('descricao_familia', sp.familia)
      if (sp.tipo) fq = fq.eq('tipo_item', sp.tipo)
      const { data: prodsFiltro } = await fq
      const codigosFiltro = new Set((prodsFiltro ?? []).map((p) => Number(p.codigo_produto)))
      idsProdDetalhes = idsProdDetalhes.filter((id) => codigosFiltro.has(id))
    }

    if (idsProdDetalhes.length === 1) {
      const p = (prodsMatch ?? []).find((x) => Number(x.codigo_produto) === idsProdDetalhes[0]) as
        | { codigo_produto: number; codigo: string; descricao: string }
        | undefined
      if (p) produtoUnico = { id_prod: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao }
    }

    if (idsProdDetalhes.length) {
      const fimExcl = new Date(Date.parse(fim) + 86400000).toISOString().slice(0, 10)

      const { data: histRowsRaw } = await supabase
        .from('movimentos_historico')
        .select('cod_prod, data, entradas, saidas')
        .eq('loja_id', lojaId)
        .in('cod_prod', idsProdDetalhes)
        .gte('data', ini)
        .lte('data', fim)
      const histRows = await complementarMovimentosHistorico(histRowsRaw ?? [], { lojaId, dataInicio: ini, dataFinal: fim })
      if (histRows) {
        totalOmie = histRows.reduce(
          (acc, r) => ({ entradas: acc.entradas + (Number(r.entradas) || 0), saidas: acc.saidas + (Number(r.saidas) || 0) }),
          { entradas: 0, saidas: 0 }
        )
      }

      const [{ data: movsData }, { data: opsData }, { data: nfItemsData }, { data: invItems }] = await Promise.all([
        supabase
          .from('movimentos')
          .select('id, data, tipo, quan, codigo_local_estoque, codigo_local_estoque_destino, obs, status, id_ajuste')
          .eq('loja_id', lojaId)
          .in('id_prod', idsProdDetalhes)
          .gte('data', ini)
          .lt('data', fimExcl)
          .order('data', { ascending: false })
          .limit(500),
        supabase
          .from('ordens_producao')
          .select('id, identificacao_n_cod_op, identificacao_d_dt_previsao, dt_conclusao_real, concluida, identificacao_n_qtde, quantidade, identificacao_c_num_op, num_ordem')
          .eq('loja_id', lojaId)
          .in('identificacao_n_cod_produto', idsProdDetalhes)
          .gte('identificacao_d_dt_previsao', ini)
          .lte('identificacao_d_dt_previsao', fim)
          .order('identificacao_d_dt_previsao', { ascending: false })
          .limit(300),
        // Achado real (pattern 1, mesma classe do fix em lib/movimentacao-operacao-auto.ts
        // e migration 083): sem filtrar etapa/cancelamento, NF pendente (c_etapa != '60')
        // ou cancelada (cCancelada = 'S') virava uma linha "Saída" na reconstrução --
        // uma NF cancelada não tira produto do estoque de verdade. Filtro fica em JS
        // (abaixo), NAO como `.is`/`.eq` nas colunas do embed `notas_fiscais!inner`:
        // medido nesta auditoria que qualquer condicao dot-path no embed (mesmo só uma)
        // deixa o plano do Postgres instavel sob o role autenticado/anon -- às vezes
        // ~300ms, às vezes >10s ou timeout (57014), mesmo repetindo a MESMA query sem
        // mudar nada. Trazer as colunas cruas e filtrar depois de receber os dados
        // evita esse plano ruim (validado: 6/6 execucoes rapidas sem filtro no embed).
        supabase
          .from('nota_fiscal_items')
          .select('id, n_id_receb, n_sequencia, n_id_produto, n_qtde_nfe, c_codigo_produto, notas_fiscais!inner(d_emissao_nfe, c_numero_nfe, c_natureza_operacao, deleted_at, c_etapa, full_object)')
          .eq('loja_id', lojaId)
          .in('n_id_produto', idsProdDetalhes)
          .limit(500),
        supabase
          .from('inventario_items')
          .select('produto_codigo_produto, quan, inventarios!inner(id, data)')
          .eq('loja_id', lojaId)
          .in('produto_codigo_produto', idsProdDetalhes)
          .limit(200),
      ])

      type RawMov = { id: number; data: string; tipo: string; quan: number | null; codigo_local_estoque: number | null; codigo_local_estoque_destino: number | null; obs: string | null; status: string | null; id_ajuste: number | null }
      type RawOP = { id: number; identificacao_n_cod_op: number; identificacao_d_dt_previsao: string | null; dt_conclusao_real: string | null; concluida: boolean | null; identificacao_n_qtde: number | null; quantidade: number | null; identificacao_c_num_op: string | null; num_ordem: string | null }
      type RawNFI = { id: number; n_id_receb: string; n_sequencia: number; n_id_produto: number; n_qtde_nfe: number | null; c_codigo_produto: string | null; notas_fiscais: { d_emissao_nfe: string; c_numero_nfe: string | null; c_natureza_operacao: string | null; deleted_at: string | null; c_etapa: string | null; full_object: { infoCadastro?: { cCancelada?: string } } | null }[] }
      // Item de nota fiscal ja normalizado (Supabase e Contabo tem formatos diferentes
      // de join -- aninhado vs colunas nf_* -- normalizados pra este shape comum).
      // n_id_receb/n_sequencia (chave natural do item, mesma usada em
      // complementarNotaFiscalItems): o `id` sozinho nao serve mais pra dedupe
      // quente+frio (Contabo gera seu proprio bigserial `id`, independente do
      // Supabase, desde o dual-write de NF -- ver historico-contabo.ts).
      type NFIItem = { id: number; n_id_receb: string; n_sequencia: number; n_id_produto: number; n_qtde_nfe: number | null; d_emissao_nfe: string | null; c_numero_nfe: string | null; c_natureza_operacao: string | null }
      // /nota_fiscal_items do Contabo so junta d_emissao_nfe/c_numero_nfe/c_natureza_operacao
      // (colunas nf_*) -- nao devolve etapa/cancelamento do cabecalho, por isso
      // `nota_fiscal_id` e usado abaixo pra cruzar com um fetch a parte de /notas_fiscais.
      // n_id_receb/n_sequencia sao colunas proprias de nota_fiscal_items (nao
      // prefixadas nf_*, que sao so do join com o cabecalho) -- o endpoint ja devolve.
      type RawNFIFrio = { id: number; nota_fiscal_id: number; n_id_receb: string; n_sequencia: number; n_id_produto: number; n_qtde_nfe: number | null; nf_d_emissao_nfe: string | null; nf_c_numero_nfe: string | null; nf_c_natureza_operacao: string | null }
      type RawNFHeaderFrio = { id: number; c_etapa: string | null; full_object: { infoCadastro?: { cCancelada?: string } } | null }
      type RawInv = { produto_codigo_produto: number; quan: number | null; inventarios: { id: number; data: string }[] }

      const movs = await complementarMovimentos(movsData ?? [], { lojaId, dataInicio: ini, dataFinal: fimExcl })
      const ops = await complementarOrdensProducao(opsData ?? [], { lojaId, dataInicio: ini, dataFinal: fim })

      const nfItemsQuentes: NFIItem[] = ((nfItemsData ?? []) as unknown as RawNFI[])
        .filter((nfi) => {
          const nf = Array.isArray(nfi.notas_fiscais) ? nfi.notas_fiscais[0] : nfi.notas_fiscais
          if (!nf || nf.deleted_at) return false
          return statusNF(nf.c_etapa, nf.full_object).label === 'Concluída'
        })
        .map((nfi) => {
          const nf = Array.isArray(nfi.notas_fiscais) ? nfi.notas_fiscais[0] : nfi.notas_fiscais
          return {
            id: nfi.id, n_id_receb: nfi.n_id_receb, n_sequencia: nfi.n_sequencia, n_id_produto: nfi.n_id_produto, n_qtde_nfe: nfi.n_qtde_nfe,
            d_emissao_nfe: nf?.d_emissao_nfe ?? null, c_numero_nfe: nf?.c_numero_nfe ?? null, c_natureza_operacao: nf?.c_natureza_operacao ?? null,
          }
        })
      let nfItems: NFIItem[] = nfItemsQuentes
      if (ini < limiteJanelaQuente()) {
        const frios = await buscarFrioNotaFiscalItems<RawNFIFrio>({ lojaId, dataInicio: ini, dataFinal: fim })
        // Achado real (pattern adjacente ao 1, encontrado ao investigar entLines):
        // o endpoint /nota_fiscal_items so aceita loja_id + periodo, sem filtro de
        // produto -- sem este filtro, a fatia fria trazia SAI de QUALQUER produto
        // da loja no periodo, nao so do produto buscado nesta tela.
        const friosDoProduto = frios.filter((f) => idsProdDetalhes.includes(Number(f.n_id_produto)))
        // Mesmo achado de cancelamento acima, mas pro lado frio: /nota_fiscal_items
        // nao devolve etapa/cCancelada do cabecalho, entao busca /notas_fiscais do
        // mesmo periodo (endpoint ja filtra deleted_at is null no servidor) pra
        // cruzar por nota_fiscal_id e descartar NF pendente/cancelada.
        let notasValidas = new Set<number>()
        if (friosDoProduto.length) {
          const headers = await buscarFrioTudo<RawNFHeaderFrio>('/notas_fiscais', { loja_id: lojaId, data_inicio: ini, data_final: fim }, 2000)
          notasValidas = new Set(
            headers
              .filter((h) => statusNF(h.c_etapa, h.full_object).label === 'Concluída')
              .map((h) => h.id)
          )
        }
        const friosNormalizados: NFIItem[] = friosDoProduto
          .filter((f) => notasValidas.has(f.nota_fiscal_id))
          .map((f) => ({
            id: f.id, n_id_receb: f.n_id_receb, n_sequencia: f.n_sequencia, n_id_produto: f.n_id_produto, n_qtde_nfe: f.n_qtde_nfe,
            d_emissao_nfe: f.nf_d_emissao_nfe, c_numero_nfe: f.nf_c_numero_nfe, c_natureza_operacao: f.nf_c_natureza_operacao,
          }))
        // Chave natural n_id_receb+n_sequencia (id do ITEM, nao da nota) -- mesma
        // razao do fix em historico-contabo.ts: o Contabo gera seu proprio `id`
        // bigserial por linha, independente do Supabase, desde o dual-write de NF.
        const chave = (n: NFIItem) => `${n.n_id_receb}|${n.n_sequencia}`
        const vistos = new Set(nfItemsQuentes.map(chave))
        nfItems = [...nfItemsQuentes, ...friosNormalizados.filter((n) => !vistos.has(chave(n)))]
      }

      const movsRaw = movs as RawMov[]
      const movLines: LinhaDetalhe[] = movsRaw.map((m) => ({
        chave: `mov-${m.id}`,
        data: m.data,
        tipo: m.tipo,
        quan: Number(m.quan) || 0,
        local: m.codigo_local_estoque != null ? Number(m.codigo_local_estoque) : null,
        destino: m.codigo_local_estoque_destino != null ? Number(m.codigo_local_estoque_destino) : null,
        obs: m.obs,
        status: m.status,
      }))

      const opLines: LinhaDetalhe[] = ((ops ?? []) as RawOP[]).map((op) => ({
        chave: `op-${op.id}`,
        data: op.dt_conclusao_real || op.identificacao_d_dt_previsao || ini,
        tipo: 'OP',
        quan: Number(op.quantidade) || Number(op.identificacao_n_qtde) || 0,
        local: null,
        destino: null,
        obs: `OP ${op.identificacao_c_num_op || op.num_ordem || op.id}${op.concluida ? '' : ' (em andamento)'}`,
        status: op.concluida ? 'Concluido' : 'Iniciado',
      }))

      const entLines: LinhaDetalhe[] = nfItems
        .filter((nfi) => {
          const d = nfi.d_emissao_nfe?.slice(0, 10)
          return d && d >= ini && d <= fim
        })
        .map((nfi, idx) => ({
          chave: `sai-${nfi.n_id_produto}-${nfi.d_emissao_nfe?.slice(0, 10)}-${idx}`,
          data: nfi.d_emissao_nfe ?? ini,
          tipo: 'SAI',
          quan: Number(nfi.n_qtde_nfe) || 0,
          local: null,
          destino: null,
          obs: [nfi.c_numero_nfe ? `NF ${nfi.c_numero_nfe}` : null, nfi.c_natureza_operacao ?? null].filter(Boolean).join(' — ') || 'Saída (NF)',
          status: 'Concluido',
        }))

      const sldLines: LinhaDetalhe[] = ((invItems ?? []) as unknown as RawInv[])
        .filter((ii) => {
          const inv = Array.isArray(ii.inventarios) ? ii.inventarios[0] : ii.inventarios
          const d = inv?.data?.slice(0, 10)
          return d && d >= ini && d <= fim
        })
        .map((ii) => {
          const inv = Array.isArray(ii.inventarios) ? ii.inventarios[0] : ii.inventarios
          return {
            chave: `sld-${ii.produto_codigo_produto}-${inv?.id}`,
            data: inv?.data ?? ini,
            tipo: 'SLD',
            quan: Number(ii.quan) || 0,
            local: null,
            destino: null,
            obs: 'Inventário',
            status: 'Concluido',
          }
        })

      const codigosLocais = [...new Set(
        movLines.flatMap((m) => [m.local, m.destino]).filter((c): c is number => c != null)
      )]
      if (codigosLocais.length) {
        const { data: locaisNomes } = await supabase
          .from('local_estoques')
          .select('codigo_local_estoque, descricao')
          .eq('loja_id', lojaId)
          .in('codigo_local_estoque', codigosLocais)
        for (const l of (locaisNomes ?? []) as { codigo_local_estoque: number; descricao: string | null }[]) {
          if (l.descricao) locaisMap.set(Number(l.codigo_local_estoque), l.descricao)
        }
      }

      let todas = [...movLines, ...opLines, ...entLines, ...sldLines]
      // OP/NF/inventario nao tem local registrado nesta tela: com filtro de local
      // ativo, so os ajustes (movLines) sao atribuiveis a um local especifico.
      if (localFiltro) todas = todas.filter((m) => m.local === localFiltro || m.destino === localFiltro)
      movDetalhes = todas.sort((a, b) => (a.data > b.data ? -1 : a.data < b.data ? 1 : 0))

      // Saldo inicial/final: so calculavel com local unico selecionado e produto
      // unico identificado (senao "saldo" nao tem um numero unico pra mostrar).
      if (localFiltro && produtoUnico) {
        const { data: lojaRow } = await supabase
          .from('lojas')
          .select('id, omie_app_key, omie_app_secret')
          .eq('id', lojaId)
          .single<LojaOmie>()
        if (lojaRow) {
          try {
            const posicao = await getPosicaoProduto(lojaRow, localFiltro, produtoUnico.id_prod, dataOmieBR(null))
            if (posicao) {
              let saldoAtual = posicao.n_saldo
              if (fim < hojeISO) {
                const { data: posterioresRaw } = await supabase
                  .from('movimentos')
                  .select('id, tipo, quan, codigo_local_estoque, codigo_local_estoque_destino, id_ajuste')
                  .eq('loja_id', lojaId)
                  .eq('id_prod', produtoUnico.id_prod)
                  .eq('status', 'Concluido')
                  .gte('data', fimExcl)
                  .limit(1000)
                const posteriores = await complementarMovimentos(posterioresRaw ?? [], { lojaId, dataInicio: fimExcl })
                for (const p of posteriores as { tipo: string; quan: number | null; codigo_local_estoque: number | null; codigo_local_estoque_destino: number | null; id_ajuste: number | null }[]) {
                  saldoAtual -= sinalEm(
                    { tipo: p.tipo, quan: Number(p.quan) || 0, local: p.codigo_local_estoque, destino: p.codigo_local_estoque_destino },
                    localFiltro
                  )
                }
              }
              saldoFinal = saldoAtual
              const somaPeriodo = movLines
                .filter((m) => m.status === 'Concluido')
                .reduce((s, m) => s + sinalEm(m, localFiltro), 0)
              saldoInicial = saldoFinal - somaPeriodo
            }
          } catch {
            // Omie instavel: nao quebra a tela, so nao mostra o saldo.
          }
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BuscaProdutoInline valorAtual={sp.produto ?? ''} />
        <FiltroDataMovimentos ini={ini} fim={fim} />
        <FiltroLocalMovimentos locais={locais} valorAtual={sp.local ?? ''} />
        <FiltroFamiliaMovimentos familias={familias} valorAtual={sp.familia ?? ''} />
        <FiltroTipoMovimentos valorAtual={sp.tipo ?? ''} />
        {podeCriar && produtoUnico && (
          <NovoAjusteManual locais={locais} produto={produtoUnico} />
        )}
      </div>

      {(saldoInicial != null || saldoFinal != null) && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            Saldo inicial (antes de {fmtDataDetalhe(ini)}) <span className="num font-semibold text-text">{fmtQtd(saldoInicial ?? 0)}</span>
          </span>
          <span className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted">
            Saldo final (até {fmtDataDetalhe(fim)}) <span className="num font-semibold text-text">{fmtQtd(saldoFinal ?? 0)}</span>
          </span>
        </div>
      )}

      {totalOmie && (
        <div className="rounded-lg border border-brand/30 bg-brand-soft/30 px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Total oficial (Omie)</p>
          <p className="mt-0.5 text-sm text-text">
            Entradas <span className="num font-semibold text-ok">{fmtQtd(totalOmie.entradas)}</span>
            {' · '}
            Saídas <span className="num font-semibold text-err">{fmtQtd(totalOmie.saidas)}</span>
          </p>
          <p className="mt-1 text-[12px] text-text-muted">
            Vem direto do sync do Omie (mesma fonte da aba Histórico) — é o número que vale. A tabela abaixo é uma
            reconstrução local (ajustes + OP + NF + inventário) pra explicar <em>o que</em> causou a movimentação;
            pode não bater 1:1 com o total acima.
          </p>
        </div>
      )}

      {!termo ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Selecione um produto"
          hint="Digite o nome ou código do produto para ver todos os tipos de movimentação."
        />
      ) : (
        <Lista
          linhas={movDetalhes}
          chaveLinha={(m) => m.chave}
          colunas={[
            {
              label: 'Data',
              larguraDesktop: 'w-36',
              render: (m) => (
                <span className="num text-[12px] text-text-muted">{fmtDataDetalhe(m.data)}</span>
              ),
            },
            {
              label: 'Tipo',
              primaria: true,
              larguraDesktop: 'w-44',
              render: (m) => {
                const t = TIPOS[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
                return (
                  <span>
                    <span className={`font-medium text-[13px] ${t.cor}`}>{t.label}</span>
                    {m.obs && (
                      <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-muted">
                        {m.obs}
                      </span>
                    )}
                  </span>
                )
              },
            },
            {
              label: 'Quantidade',
              alinhar: 'right',
              larguraDesktop: 'w-28',
              render: (m) => {
                const negativo = m.tipo === 'SAI' || m.tipo === 'TPQ'
                const cor = negativo ? 'text-err' : m.tipo === 'ENT' || m.tipo === 'OP' ? 'text-ok' : 'text-text'
                const sinal = negativo ? '-' : m.tipo === 'ENT' || m.tipo === 'OP' ? '+' : ''
                return (
                  <span className={`num font-medium ${cor}`}>
                    {sinal}{fmtQtd(m.quan)}
                  </span>
                )
              },
            },
            {
              label: 'Local / Destino',
              larguraDesktop: 'w-48',
              render: (m) => {
                if (m.local == null) return <span className="text-text-muted">-</span>
                const nomeOrig = locaisMap.get(m.local) ?? String(m.local)
                const nomeDest = m.destino != null ? (locaisMap.get(m.destino) ?? String(m.destino)) : null
                return (
                  <span className="text-[12px] text-text-muted">
                    {nomeOrig}
                    {nomeDest && <span> → {nomeDest}</span>}
                  </span>
                )
              },
            },
            {
              label: 'Status',
              larguraDesktop: 'w-28',
              render: (m) => {
                const cor = m.status === 'Erro' ? 'text-err' : m.status === 'Concluido' ? 'text-ok' : 'text-text-muted'
                return <span className={`text-[11px] ${cor}`}>{m.status ?? '-'}</span>
              },
            },
          ]}
          vazio={
            <EmptyState
              icon={ArrowLeftRight}
              title="Sem movimentações"
              hint={
                idsProdDetalhes.length === 0
                  ? 'Produto não encontrado no cadastro.'
                  : localFiltro
                    ? 'Nenhum ajuste registrado neste local e período. OP/NF/inventário não têm local registrado, por isso somem com o filtro de local ativo.'
                    : 'Nenhuma OP ou movimento encontrado neste período para este produto.'
              }
            />
          }
        />
      )}
    </div>
  )
}

