// Monta o arquivo .pptx do relatório gerencial mensal a partir dos dados de
// lib/relatorio-mensal.ts -- mesmo formato do relatório que a NTB Consultoria
// (Ramon) já monta manualmente todo mês (dashboards de faturamento, vendas,
// família/fornecedores, compras/perdas, baixas de estoque), + as duas seções
// finais de recomendação padrão que sempre vão junto (texto fixo, igual em
// todo relatório mensal já enviado).
import PptxGenJS from 'pptxgenjs'
import type { RelatorioMensal } from './relatorio-mensal'
import type { RankingItem } from './dashboard-gerencial'

const BRAND = '1C8D99'
const BRAND_ESCURO = '0F5A63'
const CINZA_TEXTO = '3A3A3A'
const CINZA_CLARO = 'F3FAFB'

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
  slide.addText(titulo, { x: 0.4, y: 0.25, w: W - 0.8, h: 0.5, fontSize: 22, bold: true, color: BRAND_ESCURO })
  if (subtitulo) {
    slide.addText(subtitulo, { x: 0.4, y: 0.72, w: W - 0.8, h: 0.3, fontSize: 11, color: '777777', italic: true })
  }
}

// Tabela de ranking (label + valor em R$), usada em quase todo slide de dados.
function tabelaRanking(itens: RankingItem[], titulo: string): PptxGenJS.TableRow[] {
  const cabecalho: PptxGenJS.TableCell[] = [
    { text: titulo, options: { bold: true, fill: { color: BRAND }, color: 'FFFFFF', colspan: 2, fontSize: 11 } },
  ]
  const linhas: PptxGenJS.TableRow[] = [cabecalho]
  if (!itens.length) {
    linhas.push([{ text: 'Sem dados no período', options: { colspan: 2, color: '999999', italic: true, fontSize: 9 } }])
    return linhas
  }
  itens.forEach((item, i) => {
    linhas.push([
      { text: item.label, options: { fontSize: 9, fill: { color: i % 2 ? CINZA_CLARO : 'FFFFFF' } } },
      { text: fmtMoeda(item.valor), options: { fontSize: 9, align: 'right', fill: { color: i % 2 ? CINZA_CLARO : 'FFFFFF' } } },
    ])
  })
  return linhas
}

function kpiBox(slide: PptxGenJS.Slide, x: number, y: number, w: number, valor: string, rotulo: string): void {
  slide.addShape('roundRect', { x, y, w, h: 1.15, fill: { color: CINZA_CLARO }, line: { color: 'E6E9EF', width: 1 }, rectRadius: 0.08 })
  slide.addText(valor, { x, y: y + 0.12, w, h: 0.55, fontSize: 20, bold: true, color: BRAND_ESCURO, align: 'center' })
  slide.addText(rotulo, { x, y: y + 0.68, w, h: 0.4, fontSize: 10, color: CINZA_TEXTO, align: 'center' })
}

export async function gerarRelatorioMensalPptx(dados: RelatorioMensal): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'NTB_16_9', width: W, height: H })
  pptx.layout = 'NTB_16_9'
  const loja = dados.loja.nome
  const mesLabel = dados.mesLabel
  let n = 1

  // --- Slide 1: Capa ---
  {
    const slide = pptx.addSlide()
    slide.background = { color: BRAND_ESCURO }
    slide.addText('NTB Gestão de Estoque', { x: 0, y: 2.6, w: W, h: 0.7, fontSize: 30, bold: true, color: 'FFFFFF', align: 'center' })
    slide.addText(`Relatório Gerencial — ${mesLabel}`, { x: 0, y: 3.35, w: W, h: 0.5, fontSize: 18, color: 'D5F0F3', align: 'center' })
    slide.addText(`Cliente: ${loja}`, { x: 0, y: 3.95, w: W, h: 0.4, fontSize: 14, color: 'FFFFFF', align: 'center' })
  }
  n++

  // --- Slide 2: Faturamento Geral ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Faturamento Geral', `Venda PDV · ${mesLabel.split(' de ')[1]} · jan–${mesLabel.split(' de ')[0].slice(0, 3).toLowerCase()}`)
    const g = dados.faturamentoGeral
    kpiBox(slide, 0.4, 1.25, 2.8, fmtMoeda(g.faturamentoMes), `Faturamento ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 3.4, 1.25, 2.8, fmtMoeda(g.faturamentoAno), 'Total Geral (jan–mês)')
    kpiBox(slide, 6.4, 1.25, 2.8, fmtPct(g.pctComprasFatMes), `Compras/Fat. — ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 9.4, 1.25, 2.8, fmtPct(g.pctComprasFatMediaAno), 'Média do Ano')
    slide.addTable(tabelaRanking(g.porTipo, 'Faturamento por Tipo de Produto (jan–mês)'), {
      x: 0.4, y: 2.7, w: 12.5, colW: [9.5, 3], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
      autoPage: false,
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 3: Vendas por Produto — Produto Acabado ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Vendas por Produto', 'Venda PDV · total jan–mês · Produto Acabado (top 10)')
    slide.addTable(tabelaRanking(dados.vendasAcabado.mais, 'Mais Vendidos — Produto Acabado'), {
      x: 0.4, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    slide.addTable(tabelaRanking(dados.vendasAcabado.menos, 'Menos Vendidos — Produto Acabado'), {
      x: 6.8, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 4: Vendas por Produto — Revenda ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Vendas por Produto (continuação)', 'Venda PDV · total jan–mês · Mercadoria p/ Revenda (top 10)')
    slide.addTable(tabelaRanking(dados.vendasRevenda.mais, 'Mais Vendidos — Mercadoria p/ Revenda'), {
      x: 0.4, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    slide.addTable(tabelaRanking(dados.vendasRevenda.menos, 'Menos Vendidos — Mercadoria p/ Revenda'), {
      x: 6.8, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 5: Família e Fornecedores ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Família de Produto e Fornecedores', 'Total jan–mês')
    slide.addTable(tabelaRanking(dados.familiaTop10, 'Faturamento por Família (top 10)'), {
      x: 0.4, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    slide.addTable(tabelaRanking(dados.fornecedorTop10, 'Compras por Fornecedor (top 10)'), {
      x: 6.8, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 6: Compras e Perdas ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Compras e Perdas', `${mesLabel} · notas confirmadas`)
    const cp = dados.comprasPerdas
    kpiBox(slide, 0.4, 1.25, 2.9, fmtMoeda(cp.valorNotasMes), `Notas em ${mesLabel.split(' de ')[0]}`)
    kpiBox(slide, 3.5, 1.25, 2.9, fmtMoeda(cp.valorNotasAno), 'Total Geral (jan–mês)')
    kpiBox(slide, 6.6, 1.25, 2.9, fmtPct(cp.perdaMateriaPrimaPct), '% Perda Matéria-Prima (limite 6%)')
    kpiBox(slide, 9.7, 1.25, 2.9, fmtPct(cp.perdaRevendaPct), '% Perda Revenda')
    slide.addTable(tabelaRanking(cp.entradaNfPorTipo, 'Entrada de Notas Fiscais por Tipo (jan–mês)'), {
      x: 0.4, y: 2.7, w: 12.5, colW: [9.5, 3], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    const excedeuMP = cp.perdaMateriaPrimaPct != null && cp.perdaMateriaPrimaPct > 6
    const textoLimite =
      cp.perdaMateriaPrimaPct == null
        ? 'Sem movimento de perda de Matéria-Prima registrado neste mês.'
        : excedeuMP
          ? `Limite operacional de Matéria-Prima: 6%. ${mesLabel.split(' de ')[0]} segue acima do limite (${fmtPct(cp.perdaMateriaPrimaPct)}).`
          : 'Perda de Matéria-Prima dentro do limite operacional de 6% neste mês.'
    slide.addText(textoLimite, {
      x: 0.4, y: 6.5, w: 12.5, h: 0.4, fontSize: 10,
      color: cp.perdaMateriaPrimaPct == null ? '888888' : excedeuMP ? 'B5342A' : '3A7A3E',
      italic: true,
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slide 7: Baixas de Estoque ---
  {
    const slide = pptx.addSlide()
    tituloSlide(slide, 'Dashboard — Baixas de Estoque: Revenda vs. Matéria-Prima', 'Movimento Manual de Estoque · Saída · jan–mês · top 5 de cada tipo')
    slide.addTable(tabelaRanking(dados.baixasEstoque.revendaTop5, 'Material de Revenda'), {
      x: 0.4, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    slide.addTable(tabelaRanking(dados.baixasEstoque.materiaPrimaTop5, 'Matéria-Prima'), {
      x: 6.8, y: 1.3, w: 6.1, colW: [4.5, 1.6], fontSize: 9, border: { type: 'solid', color: 'E6E9EF', pt: 0.5 },
    })
    rodape(slide, loja, mesLabel, n)
  }
  n++

  // --- Slides 8-9: Pontos de Melhoria e Recomendações (texto fixo) ---
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
      slide.addText(titulo, { x, y, w: colW, h: 0.35, fontSize: 12, bold: true, color: BRAND_ESCURO })
      slide.addText(itens.map((t) => ({ text: t, options: { bullet: true, fontSize: 9, color: CINZA_TEXTO, breakLine: true } })), {
        x, y: y + 0.4, w: colW, h: 2.35, valign: 'top',
      })
    })
    rodape(slide, loja, mesLabel, n)
    n++
  }
  slideDePontos('1/2', pontosMelhoria)
  slideDePontos('2/2', pontosMelhoria2)

  // --- Slide 10: Recomendações — NTB Estoque (operacional) ---
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
      slide.addText(titulo, { x, y, w: colW, h: 0.35, fontSize: 12, bold: true, color: BRAND_ESCURO })
      slide.addText(itens.map((t) => ({ text: t, options: { bullet: true, fontSize: 9, color: CINZA_TEXTO, breakLine: true } })), {
        x, y: y + 0.4, w: colW, h: 2.35, valign: 'top',
      })
    })
    rodape(slide, loja, mesLabel, n)
  }

  const saida = await pptx.write({ outputType: 'nodebuffer' })
  return Buffer.from(saida as Uint8Array)
}
