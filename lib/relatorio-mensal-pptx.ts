// Monta o arquivo .pptx do relatório gerencial mensal a partir dos dados de
// lib/relatorio-mensal.ts -- mira o formato do relatório R07 (o mais
// recente e "mais profissional" segundo o próprio Ramon, ver memória
// reference_relatorio_mensal_ramon_spec.md): gráfico de linha/barra nativo
// em cada dashboard, não tabela. + as duas seções finais de recomendação
// padrão que sempre acompanham o relatório (texto fixo).
import PptxGenJS from 'pptxgenjs'
import type { RelatorioMensal, SerieMensal } from './relatorio-mensal'
import type { RankingItem } from './dashboard-gerencial'

const LARANJA = 'E8862B'
const NAVY = '1B2A3A'
const NAVY_CLARO = '3A5068'
const CINZA_TEXTO = '3A3A3A'
const CINZA_LINHA = 'E6E9EF'
const PALETA = ['E8862B', '1B2A3A', '5B8AA6', '8FBF6B', 'C0533E']

const W = 13.33
const H = 7.5

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtPct(v: number | null): string {
  return v == null ? '-' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function rodape(slide: PptxGenJS.Slide, loja: string, mesLabel: string, numero: number): void {
  slide.addText(`NTB Gestão de Estoque  •  ${loja}  •  ${mesLabel}`, {
    x: 0.4, y: H - 0.4, w: W - 1.2, h: 0.3, fontSize: 9, color: '888888',
  })
  slide.addText(String(numero), { x: W - 0.7, y: H - 0.4, w: 0.4, h: 0.3, fontSize: 9, color: '888888', align: 'right' })
}

function tituloSlide(slide: PptxGenJS.Slide, titulo: string, subtitulo?: string): void {
  slide.addText(titulo, { x: 0.4, y: 0.25, w: W - 0.8, h: 0.5, fontSize: 22, bold: true, color: NAVY })
  if (subtitulo) {
    slide.addText(subtitulo, { x: 0.4, y: 0.72, w: W - 0.8, h: 0.3, fontSize: 10, color: '777777', italic: true })
  }
}

function kpiBox(slide: PptxGenJS.Slide, x: number, y: number, w: number, valor: string, rotulo: string): void {
  slide.addShape('roundRect', { x, y, w, h: 1.05, fill: { color: 'F3FAFB' }, line: { color: CINZA_LINHA, width: 1 }, rectRadius: 0.08 })
  slide.addText(valor, { x, y: y + 0.1, w, h: 0.5, fontSize: 19, bold: true, color: NAVY, align: 'center' })
  slide.addText(rotulo, { x, y: y + 0.63, w, h: 0.38, fontSize: 9, color: CINZA_TEXTO, align: 'center' })
}

// Gráfico de linha, várias séries (Faturamento por Tipo, Compras/Perdas...).
function graficoLinha(
  slide: PptxGenJS.Slide,
  serie: { meses: string[]; series: { nome: string; valores: number[] }[] },
  opts: { x: number; y: number; w: number; h: number; titulo: string; formatoPct?: boolean }
): void {
  slide.addText(opts.titulo, { x: opts.x, y: opts.y, w: opts.w, h: 0.3, fontSize: 12, bold: true, color: LARANJA })
  const dados = serie.series.map((s) => ({
    name: s.nome,
    labels: serie.meses,
    values: s.valores,
  }))
  slide.addChart('line' as PptxGenJS.CHART_NAME, dados, {
    x: opts.x, y: opts.y + 0.35, w: opts.w, h: opts.h - 0.35,
    chartColors: PALETA,
    showLegend: true,
    legendPos: 'b',
    legendFontSize: 9,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: opts.formatoPct ? '0.00"%"' : '#,##0,"K"',
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 4,
    lineSmooth: false,
    valGridLine: { color: CINZA_LINHA, style: 'solid', size: 0.75 },
    catGridLine: { style: 'none' },
  })
}

// Gráfico de barra horizontal (ranking) -- "Mais/Menos vendidos", "Família",
// "Fornecedor". Ordena maior->menor de cima pra baixo (padrão do R07).
function graficoBarraRanking(
  slide: PptxGenJS.Slide,
  itens: RankingItem[],
  cor: string,
  opts: { x: number; y: number; w: number; h: number; titulo: string }
): void {
  slide.addText(opts.titulo, { x: opts.x, y: opts.y, w: opts.w, h: 0.3, fontSize: 12, bold: true, color: LARANJA })
  if (!itens.length) {
    slide.addText('Sem dados no período', { x: opts.x, y: opts.y + 0.4, w: opts.w, h: 0.3, fontSize: 9, color: '999999', italic: true })
    return
  }
  // addChart barDir='bar' desenha de baixo pra cima -- inverte a ordem pra o
  // maior aparecer no topo da lista, igual ao R07.
  const invertido = [...itens].reverse()
  slide.addChart(
    'bar' as PptxGenJS.CHART_NAME,
    [{ name: opts.titulo, labels: invertido.map((i) => i.label), values: invertido.map((i) => i.valor) }],
    {
      x: opts.x, y: opts.y + 0.35, w: opts.w, h: opts.h - 0.35,
      barDir: 'bar',
      chartColors: [cor],
      showLegend: false,
      showValue: true,
      dataLabelPosition: 'outEnd',
      dataLabelFontSize: 8,
      dataLabelFormatCode: '[>=1000]"R$"#,##0,"K";"R$"0.00',
      catAxisLabelFontSize: 8,
      valAxisHidden: true,
      catGridLine: { style: 'none' },
      valGridLine: { style: 'none' },
      barGapWidthPct: 30,
    }
  )
}

// Gráfico de barra agrupada por mês (Baixas de Estoque) -- não usado hoje
// (slide removido até resolver a divergência de fonte de dado, ver memória),
// mas mantido pronto pro dia que a fonte de MOV_DV for confiável.
export function graficoBarraMensal(
  slide: PptxGenJS.Slide,
  serie: SerieMensal,
  opts: { x: number; y: number; w: number; h: number; titulo: string }
): void {
  slide.addText(opts.titulo, { x: opts.x, y: opts.y, w: opts.w, h: 0.3, fontSize: 12, bold: true, color: LARANJA })
  slide.addChart(
    'bar' as PptxGenJS.CHART_NAME,
    serie.series.map((s) => ({ name: s.nome, labels: serie.meses, values: s.valores })),
    {
      x: opts.x, y: opts.y + 0.35, w: opts.w, h: opts.h - 0.35,
      barDir: 'col',
      chartColors: PALETA,
      showLegend: true,
      legendPos: 'b',
      legendFontSize: 8,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      barGapWidthPct: 40,
    }
  )
}

export async function gerarRelatorioMensalPptx(dados: RelatorioMensal): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'NTB_16_9', width: W, height: H })
  pptx.layout = 'NTB_16_9'
  const loja = dados.loja.nome
  const mesLabel = dados.mesLabel
  const periodoLabel = `jan–${dados.mesAtualLabel.split(' de ')[0].toLowerCase()} ${dados.ano}`
  let n = 1

  // --- Slide 1: Capa ---
  {
    const slide = pptx.addSlide()
    slide.background = { color: NAVY }
    slide.addText('NTB Gestão de Estoque', { x: 0, y: 2.6, w: W, h: 0.7, fontSize: 30, bold: true, color: 'FFFFFF', align: 'center' })
    slide.addText(`Relatório Gerencial — ${mesLabel}`, { x: 0, y: 3.35, w: W, h: 0.5, fontSize: 18, color: 'B7C6D6', align: 'center' })
    slide.addText(`Cliente: ${loja}`, { x: 0, y: 3.95, w: W, h: 0.4, fontSize: 14, color: 'FFFFFF', align: 'center' })
  }
  n++

  // --- Slide 2: Faturamento Geral ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Faturamento Geral', `Venda PDV · ${periodoLabel}`)
    const g = dados.faturamentoGeral
    graficoLinha(slide, g.serieTipo, { x: 0.4, y: 1.15, w: 6.1, h: 3.1, titulo: 'Faturamento por Tipo de Produto' })
    graficoLinha(
      slide,
      { meses: g.serieFatVsCompras.meses, series: [{ nome: 'Faturamento', valores: g.serieFatVsCompras.faturamento }, { nome: 'Compras', valores: g.serieFatVsCompras.compras }] },
      { x: 6.8, y: 1.15, w: 6.1, h: 3.1, titulo: 'Faturamento vs. Compras' }
    )
    kpiBox(slide, 0.4, 4.55, 2.9, fmtMoeda(g.faturamentoMes), `Faturamento ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 3.5, 4.55, 2.9, fmtMoeda(g.faturamentoAno), `Total Geral (${periodoLabel})`)
    kpiBox(slide, 6.6, 4.55, 2.9, fmtPct(g.pctComprasFatMes), `Compras/Fat. — ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 9.7, 4.55, 2.9, fmtPct(g.pctComprasFatMediaAno), 'Média do Período')
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 3: Vendas por Produto — Produto Acabado ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Vendas por Produto', `Venda PDV · total ${periodoLabel} · Produto Acabado (top 10)`)
    graficoBarraRanking(slide, dados.vendasAcabado.mais, LARANJA, { x: 0.4, y: 1.25, w: 6.1, h: 5.4, titulo: 'Mais Vendidos — Produto Acabado' })
    graficoBarraRanking(slide, dados.vendasRevenda.menos, NAVY_CLARO, { x: 6.8, y: 1.25, w: 6.1, h: 5.4, titulo: 'Menos Vendidos — Mercadoria p/ Revenda' })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 4: Vendas por Produto — Revenda ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Vendas por Produto (continuação)', `Venda PDV · total ${periodoLabel} · Mercadoria p/ Revenda (top 10)`)
    graficoBarraRanking(slide, dados.vendasRevenda.mais, LARANJA, { x: 0.4, y: 1.25, w: 6.1, h: 5.4, titulo: 'Mais Vendidos — Mercadoria p/ Revenda' })
    graficoBarraRanking(slide, dados.vendasAcabado.menos, NAVY_CLARO, { x: 6.8, y: 1.25, w: 6.1, h: 5.4, titulo: 'Menos Vendidos — Produto Acabado' })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 5: Família e Fornecedores ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Família de Produto e Fornecedores', `Total ${periodoLabel}`)
    graficoBarraRanking(slide, dados.familiaTop10, LARANJA, { x: 0.4, y: 1.25, w: 6.1, h: 5.4, titulo: 'Faturamento por Família (top 10)' })
    graficoBarraRanking(slide, dados.fornecedorTop10, NAVY_CLARO, { x: 6.8, y: 1.25, w: 6.1, h: 5.4, titulo: 'Compras por Fornecedor (top 10)' })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 6: Compras e Perdas ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Compras e Perdas', `${periodoLabel} · notas confirmadas`)
    const cp = dados.comprasPerdas
    graficoLinha(slide, cp.serieEntradaNf, { x: 0.4, y: 1.15, w: 6.1, h: 3.1, titulo: 'Entrada de Notas Fiscais por Tipo' })
    graficoLinha(
      slide,
      { meses: cp.seriePerda.meses, series: [
        { nome: '% Perda Mat. Prima', valores: cp.seriePerda.percMateriaPrima.map((v) => v ?? 0) },
        { nome: '% Perda Revenda', valores: cp.seriePerda.percRevenda.map((v) => v ?? 0) },
      ] },
      { x: 6.8, y: 1.15, w: 6.1, h: 3.1, titulo: '% Perda sobre Faturamento', formatoPct: true }
    )
    kpiBox(slide, 0.4, 4.55, 2.9, fmtMoeda(cp.valorNotasMes), `Notas em ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 3.5, 4.55, 2.9, fmtMoeda(cp.valorNotasAno), `Total Geral (${periodoLabel})`)
    const excedeuMP = cp.perdaMateriaPrimaPctMes != null && cp.perdaMateriaPrimaPctMes > 6
    const textoLimite =
      cp.perdaMateriaPrimaPctMes == null
        ? 'Sem movimento de perda de Matéria-Prima registrado neste mês.'
        : excedeuMP
          ? `Limite operacional de Matéria-Prima: 6%. ${mesLabel.split(' de ')[0]} segue acima do limite (${fmtPct(cp.perdaMateriaPrimaPctMes)}).`
          : `Perda de Matéria-Prima dentro do limite operacional de 6% em ${mesLabel.split(' de ')[0]} (${fmtPct(cp.perdaMateriaPrimaPctMes)}).`
    slide.addText(textoLimite, {
      x: 6.6, y: 4.6, w: 6.3, h: 0.9, fontSize: 10, valign: 'top',
      color: cp.perdaMateriaPrimaPctMes == null ? '888888' : excedeuMP ? 'B5342A' : '3A7A3E',
      italic: true,
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slides 7-8: Pontos de Melhoria e Recomendações (texto fixo) ---
  const pontosMelhoria: [string, string[]][] = [
    ['1. Padronização e Precisão dos Inventários', [
      'Inventários realizados diretamente pelo NTB garantem contagem padronizada, eliminando divergências entre físico e Omie.',
      'Redução de erros manuais e inconsistências de estoque.',
      'Histórico de inventários acessível e rastreável, facilitando auditorias internas.',
      'Inventários mais rápidos, inclusive via celular, permitindo execução por qualquer responsável.',
    ]],
    ['2. Transferências de Estoque com Rastreabilidade Total', [
      'Transferências registradas diretamente no NTB evitam perdas, desvios e lançamentos incorretos.',
      'Cada movimentação passa a ter origem, destino e responsável, fortalecendo a governança.',
      'Redução de movimentos manuais indevidos, que antes geravam distorções nos relatórios.',
      'A rastreabilidade melhora a tomada de decisão do administrativo de compras.',
    ]],
    ['3. Etiquetas Inteligentes e Padronização Operacional', [
      'Impressão de etiquetas padronizadas reduz erros de identificação de produtos.',
      'Facilita inventários, conferências e transferências.',
      'Aumenta a velocidade de separação e organização do estoque.',
      'Contribui para reduzir divergências entre estoque físico e Omie.',
    ]],
    ['4. Auditoria Interna Contínua (não apenas pontual)', [
      'Com o NTB exibindo origem, consumo e movimentos manuais, a auditoria passa a ser semanal e automática.',
      'Identificação rápida de produtos com custo acima do limite.',
      'Detecção de movimentos manuais suspeitos ou inconsistentes.',
      'Correção imediata de erros que antes só eram percebidos no fechamento do mês.',
    ]],
  ]
  const pontosMelhoria2: [string, string[]][] = [
    ['5. Sugestões Automáticas de Compra', [
      'Sistema gera recomendações com base em saldo atual de estoque, estoque mínimo e previsão de vendas da semana (comparada com a mesma semana do ano anterior).',
      'Evita compras excessivas.',
      'Evita falta de produtos em semanas de alta demanda.',
      'Reduz desperdício e melhora o capital de giro.',
    ]],
    ['6. Visão Completa da Movimentação dos Produtos', [
      'Relatórios dinâmicos permitem visualizar entradas, saídas, consumos, origem das movimentações, movimentos manuais e produtos com giro baixo ou alto.',
      'Essa visão integrada melhora a tomada de decisão do administrativo de compras.',
      'Facilita identificar causas de desvios deste ciclo.',
    ]],
    ['7. Acesso Rápido via Celular', [
      'Supervisores e responsáveis podem acompanhar estoque em tempo real.',
      'Decisões de compra, inventário e transferência podem ser feitas de qualquer lugar.',
      'Aumenta a velocidade de resposta e reduz gargalos operacionais.',
    ]],
    ['8. Benefícios Diretos para o Administrativo de Compras', [
      'Compras mais assertivas e alinhadas ao giro real.',
      'Redução de compras desnecessárias e desperdício.',
      'Melhor controle de fornecedores e custos.',
      'Aumento da margem operacional ao evitar desvios como os meses críticos analisados.',
      'Base sólida para negociações com fornecedores, com dados reais e atualizados.',
    ]],
  ]

  function slideDePontos(subtitulo: string, blocos: [string, string[]][]): void {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Pontos de Melhoria e Recomendações — NTB Estoque + Omie', subtitulo)
    const colW = 6.1
    blocos.forEach(([titulo, itens], i) => {
      const col = i % 2
      const linha = Math.floor(i / 2)
      const x = 0.4 + col * (colW + 0.3)
      const y = 1.25 + linha * 2.85
      slide.addText(titulo, { x, y, w: colW, h: 0.35, fontSize: 12, bold: true, color: LARANJA })
      slide.addText(itens.map((t) => ({ text: t, options: { bullet: true, fontSize: 9, color: CINZA_TEXTO, breakLine: true } })), {
        x, y: y + 0.4, w: colW, h: 2.35, valign: 'top',
      })
    })
    rodape(slide, loja, mesLabel, n)
    n++
  }
  slideDePontos('1/2', pontosMelhoria)
  slideDePontos('2/2', pontosMelhoria2)

  // --- Slide 9: Recomendações — NTB Estoque (operacional) ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Recomendações — NTB Estoque')
    const blocos: [string, string[]][] = [
      ['1. Treinamento dos Operadores (Prioridade Máxima)', [
        'Capacitar todos os operadores para usar corretamente o NTB Estoque.',
        'Treinamento prático no celular: lançamento de produção (abrir, consumir, produzir, encerrar); transferências entre setores e lojas; inventários conforme rotina definida.',
        'Inventário não substitui lançamento — ele apenas aponta divergências que a consultoria corrige.',
      ]],
      ['2. Padronização das Rotinas Operacionais', [
        'Lançar produção no momento da execução.',
        'Registrar transferências imediatamente após a movimentação física.',
        'Realizar inventários somente como auditoria, nunca como ajuste operacional.',
      ]],
      ['3. Relatórios Gerenciais na Aplicação', [
        'Visualizar lançamentos por operador; acompanhar auditorias, inventários e transferências; monitorar produtividade diária; identificar rapidamente falhas de lançamento.',
        'Resumo do dia (produção, inventários, transferências, auditorias).',
        'Cobertura de contagem (últimos 30 dias). Atuação por operador (quantidade de ações).',
      ]],
      ['4. Objetivo Final', [
        'Toda produção seja registrada.',
        'Toda movimentação tenha lançamento correspondente.',
        'Perdas fictícias sejam eliminadas.',
        'Indicadores reflitam a realidade operacional.',
      ]],
    ]
    const colW = 6.1
    blocos.forEach(([titulo, itens], i) => {
      const col = i % 2
      const linha = Math.floor(i / 2)
      const x = 0.4 + col * (colW + 0.3)
      const y = 1.25 + linha * 2.85
      slide.addText(titulo, { x, y, w: colW, h: 0.35, fontSize: 12, bold: true, color: LARANJA })
      slide.addText(itens.map((t) => ({ text: t, options: { bullet: true, fontSize: 9, color: CINZA_TEXTO, breakLine: true } })), {
        x, y: y + 0.4, w: colW, h: 2.35, valign: 'top',
      })
    })
    rodape(slide, loja, mesLabel, n)
  }

  const saida = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(saida as Uint8Array)
}
