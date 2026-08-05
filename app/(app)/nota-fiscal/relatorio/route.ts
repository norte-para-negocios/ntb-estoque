import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { escapeIlike, escapeIlikeOr, buscarTudoPaginado, buscarTodosPorIds } from '@/lib/utils-busca'
import { fmtData } from '@/lib/pdf-utils'
import { RelatorioNFPDF, type RelatorioNFItem } from '@/components/relatorio/RelatorioNFPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { statusNF, NAO_CANCELADA_OR } from '@/lib/nf-status'
import { CATEGORIAS_NF, resolverCategoriaOrClause } from '@/lib/nota-fiscal-categoria'

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="erro.pdf"',
    },
  })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  const fornecedor = searchParams.get('fornecedor') || ''
  const numNfe = searchParams.get('num_nfe') || ''
  const status = searchParams.get('status') || ''
  // tipo/familia vem como lista separada por virgula (multi-select) na URL.
  const tipo = searchParams.get('tipo') || ''
  const tiposArr = valoresMulti(tipo)
  const produto = searchParams.get('produto') || ''
  const categoria = searchParams.get('categoria') || ''
  const categoriaOrClause = resolverCategoriaOrClause(categoria)
  // Achado real (revisão final da auditoria de filtros/relatórios,
  // 2026-08-05, item I3): natureza/familia/local eram filtros expostos na
  // tela (nota-fiscal/page.tsx) mas NUNCA chegavam até aqui -- o PDF gerava
  // sempre sem esses 3 filtros, mesmo quando ativos na tela (medido: loja 3,
  // 01/05-05/08, família "Horti - Frut": 117 na tela x 516 no PDF, 4,4x de
  // diferença).
  const natureza = searchParams.get('natureza') || ''
  const familia = searchParams.get('familia') || ''
  const familiasArr = valoresMulti(familia)
  const localParam = searchParams.get('local') || ''
  const localCod = localParam && !Number.isNaN(Number(localParam)) ? Number(localParam) : null

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  // Mesma logica de filtro da tela/export (nota-fiscal/page.tsx e
  // export/route.ts), agora incluindo familia/local.
  let notaIdsFiltro: number[] | null = null
  let codigos: string[] | null = null
  if (tiposArr.length || familiasArr.length || produto || localCod !== null) {
    if (tiposArr.length || familiasArr.length) {
      // Paginado: produtos.tipo_item/descricao_familia pode passar de 1000
      // linhas numa unica loja (ex: loja 6, tipo "99" tem 1143) -- sem
      // .range() o PostgREST trunca em silencio e o relatorio some com
      // notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) => {
        let q = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).order('id', { ascending: true }).range(from, to)
        if (tiposArr.length) q = q.in('tipo_item', tiposArr)
        if (familiasArr.length) q = q.in('descricao_familia', familiasArr)
        return q
      })
      codigos = prodCodigos.map((p) => String(p.codigo_produto))
      if (codigos.length === 0) {
        notaIdsFiltro = [-1]
      }
    }

    if (notaIdsFiltro === null) {
      let itemRows: { nota_fiscal_id: number | null }[]
      if (codigos) {
        // codigos e' `let` (reatribuido acima) -- alias `const` pra manter o
        // narrowing de nao-nulo dentro do closure abaixo.
        const codigosNaoNulos = codigos
        // Achado real (Task 10, 2026-08-05): `codigos` pode ter centenas/
        // milhares de elementos (ex.: loja 3, tipo=07, 633 codigos) -- um
        // `.in('produto_codigo', codigos)` direto sofre o MESMO 414 URI Too
        // Long do filtro de id mais abaixo. Busca em lotes de codigo
        // (buscarTodosPorIds, ver lib/utils-busca.ts) em vez de um `.in()` unico.
        itemRows = await buscarTodosPorIds<{ nota_fiscal_id: number | null }>(codigosNaoNulos, (loteCodigos, from, to) => {
          let q = supabase
            .from('nota_fiscal_items')
            .select('nota_fiscal_id')
            .eq('loja_id', lojaId)
            .in('produto_codigo', loteCodigos)
            .order('id', { ascending: true })
            .range(from, to)
          if (produto) {
            const p = escapeIlikeOr(produto)
            q = q.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
          }
          if (localCod !== null) q = q.eq('full_object->itensAjustes->>codigo_local_estoque', String(localCod))
          return q
        })
      } else {
        itemRows = await buscarTudoPaginado<{ nota_fiscal_id: number | null }>((from, to) => {
          let q = supabase
            .from('nota_fiscal_items')
            .select('nota_fiscal_id')
            .eq('loja_id', lojaId)
            .order('id', { ascending: true })
            .range(from, to)
          if (produto) {
            const p = escapeIlikeOr(produto)
            q = q.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
          }
          if (localCod !== null) q = q.eq('full_object->itensAjustes->>codigo_local_estoque', String(localCod))
          return q
        })
      }
      const notaIds = Array.from(
        new Set(itemRows.map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
      notaIdsFiltro = notaIds.length ? notaIds : [-1]
    }
  }

  const PAGE_SIZE = 1000
  type Nota = {
    id: number
    n_id_receb: string
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
    full_object: unknown
  }
  let notas: Nota[] = []

  // Filtros comuns (texto/status/categoria), sem id nem paginação -- usados
  // tanto pela query direta (sem filtro de produto/tipo) quanto pelos lotes
  // de id abaixo (ver buscarTodosPorIds).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder de query do supabase-js, tipo concreto muda a cada `.eq()/.ilike()/.or()` encadeado
  function aplicarFiltrosComuns(qIn: any): any {
    let q = qIn
    if (numNfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(numNfe)}%`)
    // Achado real (revisão final round 2, 2026-08-05, problema 2): fornecedor
    // só filtrava `c_nome` (nome fantasia) -- mesma classe de bug de família/
    // local/natureza já corrigida acima (ficou de fora daquela rodada). A
    // tela (nota-fiscal/page.tsx) já filtra com OR de razão social + nome
    // fantasia -- medido ao vivo, loja 3: 1819 de 2402 notas têm razão social
    // diferente do nome fantasia (fornecedor=SENDAS: 73 notas na tela, PDF
    // vazio antes deste fix). Replicado aqui, mesmo padrão de escape
    // (`escapeIlike`, igual ao que page.tsx já usa dentro do próprio `.or()`).
    // Achado real (revisão final round 3, 2026-08-05): `escapeIlike` só escapa
    // curingas de LIKE (`%`/`_`), não vírgula/parênteses -- dentro de um
    // `.or()` do PostgREST esses dois caracteres são sintaxe própria (separam
    // condições e agrupam), então um fornecedor com "," ou "(" no nome/razão
    // social quebrava o parsing da árvore lógica do filtro. Envolver o valor
    // em aspas duplas dentro da string do `.or()` neutraliza `,`/`(`/`)` pro
    // parser do PostgREST sem alterar o valor buscado (ao contrário de
    // `escapeIlikeOr`, que apaga esses caracteres).
    if (fornecedor) q = q.or(`c_razao_social.ilike."%${escapeIlike(fornecedor)}%",c_nome.ilike."%${escapeIlike(fornecedor)}%"`)
    if (status === 'C' || status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'P' || status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
    else if (status === 'MANIFESTADA') q = q.eq('full_object->infoCadastro->>cRecebido', 'S')
    // Achado real (revisão final, item I3): natureza nunca era aplicado aqui,
    // mesmo sendo repassado na URL -- mesma lógica de nota-fiscal/page.tsx.
    if (natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(natureza)}%`)
    if (categoriaOrClause) q = q.or(categoriaOrClause)
    return q
  }

  if (notaIdsFiltro !== null) {
    // Achado real (Task 10, 2026-08-04/05, auditoria de filtros/relatorios):
    // notaIdsFiltro resolve o filtro de tipo/produto em TODO o historico da
    // loja (sem limite de data), podendo chegar a milhares de ids (ex.: loja
    // 3, tipo=01 = Materia Prima, 1626 notas historicas). Um .in('id', [...])
    // direto com essa lista gera uma URL de ~11KB e o PostgREST/nginx
    // respondem 414 URI Too Long -- silenciosamente tratado como "nenhuma
    // nota" (ver buscarTodosPorIds em lib/utils-busca.ts). Busca em lotes
    // pequenos o bastante pra nunca estourar o limite de URL.
    notas = await buscarTodosPorIds<Nota>(notaIdsFiltro, (lote, from, to) =>
      aplicarFiltrosComuns(
        supabase
          .from('notas_fiscais')
          .select('id, n_id_receb, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, full_object')
          .eq('loja_id', lojaId)
          .gte('d_emissao_nfe', dataInicio)
          .lte('d_emissao_nfe', dataFinal)
          .is('deleted_at', null)
          .in('id', lote)
          .range(from, to),
      ),
    )
    notas.sort((a, b) => {
      const cmp = (a.d_emissao_nfe ?? '') < (b.d_emissao_nfe ?? '') ? -1 : (a.d_emissao_nfe ?? '') > (b.d_emissao_nfe ?? '') ? 1 : a.id - b.id
      return cmp
    })
  } else {
    function buildQuery(from: number, to: number) {
      const q = supabase
        .from('notas_fiscais')
        .select('id, n_id_receb, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, full_object')
        .eq('loja_id', lojaId)
        .gte('d_emissao_nfe', dataInicio)
        .lte('d_emissao_nfe', dataFinal)
        .is('deleted_at', null)
        // d_emissao_nfe se repete (varias notas no mesmo dia) -- sem um desempate
        // unico, paginar em blocos de 1000 pode duplicar ou pular linhas no
        // limite entre blocos (mesmo risco do resto do fix desta auditoria).
        .order('d_emissao_nfe', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
      return aplicarFiltrosComuns(q)
    }

    for (let pagina = 0; ; pagina++) {
      const from = pagina * PAGE_SIZE
      const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
      if (!bloco?.length) break
      notas.push(...(bloco as Nota[]))
      if (bloco.length < PAGE_SIZE) break
    }
  }

  // Task 1 (auditoria de filtros/completude, 2026-08-04, ver
  // lib/historico-contabo.ts e task-1-report.md "Fix round 1"): antes, este
  // guard decidia se completava com o Contabo-frio quando o periodo cruzava
  // os 90 dias. Verificado ao vivo que o Supabase self-hosted ja cobre
  // virtualmente o mesmo intervalo que o frio pra notas_fiscais/
  // nota_fiscal_items -- o complemento (e o calculo de notaIdsFrioSet, que so
  // filtrava a fatia fria) virou trabalho jogado fora. Usa so o Supabase.
  const notasCompletas = notas

  const itens: RelatorioNFItem[] = notasCompletas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: statusNF(n.c_etapa, n.full_object).label,
    valor: n.n_valor_nfe ?? 0,
  }))

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (fornecedor) filtrosAtivos.push(`Fornecedor: ${fornecedor}`)
  if (numNfe) filtrosAtivos.push(`NF: ${numNfe}`)
  if (status) filtrosAtivos.push(`Status: ${status === 'C' || status === 'CONCLUIDA' ? 'Concluída' : status === 'CANCELADA' ? 'Cancelada' : status === 'MANIFESTADA' ? 'Manifestada' : 'Pendente'}`)
  if (tiposArr.length) filtrosAtivos.push(`Tipo: ${tiposArr.map((t) => labelTipoItem(t)).join(', ')}`)
  if (produto) filtrosAtivos.push(`Produto: ${produto}`)
  if (categoria) {
    const nomesCategorias = valoresMulti(categoria)
      .map((v) => CATEGORIAS_NF.find((c) => c.value === v)?.label ?? v)
      .join(', ')
    filtrosAtivos.push(`Categoria: ${nomesCategorias}`)
  }
  // Achado real (revisão final, item I3): familia/local/natureza faltavam no
  // subtitulo do PDF -- mesmos 3 filtros que faltavam na aplicação do filtro
  // em si (corrigido acima).
  if (natureza) filtrosAtivos.push(`Natureza: ${natureza}`)
  if (familiasArr.length) filtrosAtivos.push(`Família: ${familiasArr.join(', ')}`)
  if (localCod !== null) {
    const { data: localRow } = await supabase
      .from('local_estoques')
      .select('descricao')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', localCod)
      .maybeSingle()
    filtrosAtivos.push(`Local: ${localRow?.descricao ?? localCod}`)
  }

  const periodo = `${fmtData(dataInicio)} a ${fmtData(dataFinal)}`
  const filtros = filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined

  const nomeArquivo = `relatorio-nf-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioNFPDF, {
    loja: nomeLoja,
    periodo,
    filtros,
    notas: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivo}"`,
    },
  })
}
