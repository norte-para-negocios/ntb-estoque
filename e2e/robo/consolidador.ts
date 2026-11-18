// Consolidador da lista final de falhas do ERP (ticket 12). Lógica pura: sem rede, sem disco, sem navegador.
// Lê as linhas dos falhas.md de cada robô, junta as que têm a mesma causa (várias lojas/cargos viram um item só)
// e escreve a lista numerada F-01... por gravidade. Só SUGERE correção; nada é corrigido.
import { ROTULO_GRAVIDADE, type Gravidade } from './relatorio.ts'

export type FalhaBruta = { gravidade: Gravidade; loja: string; cargo: string; tela: string; passo: string; esperado: string; mostrado: string; print: string }
export type FalhaRastreada = FalhaBruta & {
  robo: string
  ticket: string
  rodada: string
  /** Pasta de saída do robô dentro de .local-data (ex.: robo-cmv). Vazio para achados vindos só das notas. */
  pastaSaida: string
  /** Achado vindo das notas do ticket (não de um falhas.md): já traz o id da causa. */
  causa?: string
}

export type Causa = { id: string; titulo: string; explicacao: string; correcao: string }

// ---------- leitura da tabela do falhas.md ----------

const partirCelulas = (linha: string): string[] => {
  const partes = linha.split(/(?<!\\)\|/)
  return partes.slice(1, partes.length - 1).map((c) => c.trim().replace(/\\\|/g, '|'))
}

/** Lê as linhas de dados das tabelas de falhas (formato padrão e o do robô de permissões). */
export function lerTabelaFalhas(md: string): FalhaBruta[] {
  const out: FalhaBruta[] = []
  for (const linha of md.split('\n')) {
    if (!linha.startsWith('|')) continue
    const c = partirCelulas(linha)
    if (c.length !== 8) continue
    if (c[0] === 'Gravidade' || /^-+$/.test(c[0])) continue
    const g = Number(c[0].match(/^[123]/)?.[0])
    if (![1, 2, 3].includes(g)) continue
    out.push({ gravidade: g as Gravidade, loja: c[1], cargo: c[2], tela: c[3], passo: c[4], esperado: c[5], mostrado: c[6], print: c[7] })
  }
  return out
}

// ---------- causas conhecidas (texto em português simples; a correção é só sugestão) ----------

// A ordem deste catálogo é a ordem de importância dentro de cada gravidade.
export const CATALOGO: Causa[] = [
  {
    id: 'nota-digitada-sem-titulo',
    titulo: 'Nota digitada ("Lançar sem XML") na loja 19 não gera conta a pagar',
    explicacao: 'O estoque e o custo médio ficam certos, mas a dívida com o fornecedor não aparece no financeiro do dono. A mesma nota lançada por XML gera os títulos certos.',
    correcao: 'Gravar o vínculo da nota na compra antes de lançá-la, ou fazer o gatilho de conta a pagar disparar também quando o vínculo é gravado depois (hoje ele sai calado e não tenta de novo). Depois reexecutar `npm run robo:entrada`.',
  },
  {
    id: 'frio-paginacao',
    titulo: 'Sertão: faturamento "Por dia" pode errar um dia quando o período é longo (cupons repetidos e faltando)',
    explicacao: 'A leitura dos cupons em páginas de 5000 não tem ordem única: entre uma página e outra alguns cupons se repetem e outros somem. O dia 18/01/2026 saiu R$ 502,43 a menos. O resultado pode mudar de uma leitura para outra.',
    correcao: 'Acrescentar um desempate único (por exemplo o id do cupom) no order by de GET /fat_cupons em desktop/frio-api/server.js e conferir o server.js que roda no servidor de produção (fica fora do repositório).',
  },
  {
    id: 'faturamento-cancelados-historico',
    titulo: 'Sertão: faturamento do ano passado soma cupons cancelados',
    explicacao: 'Em jul/2025 a tela mostra R$ 249,03 a mais e em out/2025 R$ 8,50 a mais: é exatamente o total dos cupons cancelados do mês. O ano atual não tem o problema.',
    correcao: 'No caminho que lê o histórico (fato do frio), ignorar cupom cancelado, como o pré-agregado do ano atual já faz.',
  },
  {
    id: 'cmv-sem-baixa',
    titulo: 'ODARA: CMV de novembro/2026 sai menor porque 11 itens vendidos não baixaram o estoque',
    explicacao: 'O CMV da tela é R$ 58,91 menor que o recalculado, então o lucro aparece maior que o real. A tela Lucro avisa "11 itens vendidos não baixaram o estoque"; a tela CMV não separa isso de "sem custo".',
    correcao: 'Descobrir por que essas 11 vendas (camarão, cervejas, H2O, refrigerante, suco, porções) não deram baixa e corrigir a baixa. Enquanto isso, mostrar o aviso também na tela CMV e separar "sem baixa" de "sem custo".',
  },
  {
    id: 'offline-snapshot',
    titulo: 'Canal offline entrega tabelas inteiras a qualquer usuário logado, sem olhar o cargo',
    explicacao: 'Gerente e estoquista conseguem baixar, pelo endereço /api/offline/snapshot, tabelas do financeiro, faturamento, margem e metas (o estoquista também notas fiscais e compras). Na cópia as financeiras voltaram vazias, mas a porta está aberta.',
    correcao: 'Em autenticarCanal/snapshot, conferir a permissão do cargo para cada tabela (a mesma regra do menu) antes de devolver linhas.',
  },
  {
    id: 'log-aberto',
    titulo: 'Gerente e estoquista abrem a tela /log digitando o endereço',
    explicacao: 'O menu esconde "Logs de Integração" (só Admin), mas a página abre para qualquer usuário e mostra as chamadas da própria loja ao Omie. Conferi que não há chave nem senha nos registros. Pode ser intencional.',
    correcao: 'Decisão do dono: bloquear /log para quem não é Admin (igual ao menu) ou deixar aberto e mostrar o item no menu.',
  },
  {
    id: 'saldo-inativo',
    titulo: 'Sertão: produto inativo com saldo some da tela Estoque',
    explicacao: 'O saldo do Omie existe (ex.: VODKA SMIRNOFF 1L, 5750; Brócolis, 40), mas a tela Estoque esconde produto inativo, então o saldo some da lista e dos indicadores.',
    correcao: 'Mostrar na tela Estoque os inativos que têm saldo (ou um aviso com o total escondido), como a tela Posição de estoque já faz.',
  },
  {
    id: 'saldo-omie',
    titulo: 'Sertão: o saldo que o Omie informa não bate com a soma dos movimentos do kardex do próprio Omie',
    explicacao: 'O ERP mostra o que o Omie diz; quem se contradiz é o Omie (ex.: Carne do sol 200gr: o kardex soma 11, o Omie diz -1). Não é conta do ERP. Lista completa no itens.csv da rodada.',
    correcao: 'Decisão do dono: qual é a fonte de verdade do Sertão (posição do Omie ou kardex). Sugestão: marcar na tela os itens em que posição e kardex divergem e acertar os saldos no Omie (inventário).',
  },
  // gravidade 2
  {
    id: 'sertao-baixa-invisivel',
    titulo: 'Sertão: a venda que espera o Omie na fila não aparece em nenhuma tela',
    explicacao: 'Enquanto o Omie não confirma, a baixa pendente não aparece em Movimentações e a OP não aparece em Ordens de Produção. O dono só vê algo em "Precisa de ação" depois de 60 tentativas ou erro permanente.',
    correcao: 'Listar as saídas pendentes e as OPs da fila numa tela, com o aviso "aguardando o Omie".',
  },
  {
    id: 'retry-sem-mensagem',
    titulo: 'Retentativa de baixa pendente responde "falhou sem mensagem"',
    explicacao: 'Quando a saída pendente falha (HTTP 502), a rotina retry-ajustes-movimentos devolve só "falhou sem mensagem": o motivo real some.',
    correcao: 'Repassar a mensagem de erro do Omie (ou da trava) na resposta e no registro da tentativa.',
  },
  {
    id: 'pacioli-producao-no-dev',
    titulo: 'O ERP em desenvolvimento chama o Pacioli de produção pelo navegador',
    explicacao: 'Nas telas do dono o navegador tenta falar com pacioli.norteparanegocios.com.br. O robô bloqueou, mas quem chama não tem trava de ambiente.',
    correcao: 'Achar quem chama o Pacioli no navegador e fazê-lo respeitar a trava de ambiente (não chamar produção em desenvolvimento).',
  },
  {
    id: 'meta-dois-numeros',
    titulo: 'Cozinha: dois números diferentes para "pratos acima da meta" (ODARA)',
    explicacao: 'Início e lista de Pratos dizem 8 (mais de 5 pontos acima da meta). O Pacioli responde 18 (inclui os 10 "perto do limite"). Cada tela bate com a própria definição, mas o dono vê números diferentes para a mesma pergunta.',
    correcao: 'Decisão do dono: alinhar o rótulo (por exemplo "acima da meta" x "acima ou perto do limite") nas três telas.',
  },
  {
    id: 'hidratacao-central',
    titulo: 'Menu novo /central: aviso de tela diferente entre servidor e navegador',
    explicacao: 'O console acusa que o HTML do servidor não bate com o do navegador nas 7 telas /central (só para o dono). Não mostra conta errada, mas pode piscar ou redesenhar.',
    correcao: 'Achar o trecho que muda entre servidor e navegador (hora, window, localStorage, valor aleatório) e desenhar igual nos dois, ou deixar para depois da montagem.',
  },
  {
    id: 'chave-repetida-movimentacoes',
    titulo: 'Loja 19: lista de Movimentações com linhas de chave repetida',
    explicacao: 'O React acusa dois itens com a mesma chave; linhas podem aparecer duplicadas ou sumir da lista.',
    correcao: 'Usar o id único do movimento como chave da lista em /movimentacoes.',
  },
  // gravidade 3
  {
    id: 'sertao-fila-duplicada',
    titulo: 'Sertão: reenviar a mesma venda cria outra linha na fila',
    explicacao: 'Com a OP ainda na fila, reenviar o mesmo pedido leva a fila de 3 para 6 linhas. A baixa não duplica e o Omie recusa o código repetido, mas a fila cresce com linhas redundantes.',
    correcao: 'Não criar nova linha na fila quando já existe uma para o mesmo pedido e item.',
  },
  {
    id: 'estorno-contador',
    titulo: 'Estorno repetido responde que apagou ajustes que não apagou',
    explicacao: 'O segundo estorno da mesma venda responde "ajustesExcluidos: 4" mesmo sem devolver nada ao estoque. Só o número da resposta engana.',
    correcao: 'Devolver 0 quando não há nada a desfazer.',
  },
  {
    id: 'inventario-aviso-verde',
    titulo: 'Sertão: aviso verde "Inventário enviado ao Omie" com todos os itens em erro',
    explicacao: 'Ao concluir o inventário com os 4 itens em Erro, a tela avisa em verde que foi enviado e o inventário fica Finalizado, mas nenhum ajuste saiu. A lista mostra 0/4 em vermelho.',
    correcao: 'Trocar a mensagem quando há itens com erro (por exemplo "Finalizado, mas N itens não foram ao Omie") e deixar o aviso em cor de alerta.',
  },
  {
    id: 'texto-nome-produto-nota',
    titulo: 'Tela da nota troca o nome do produto de caixa alta para título e tira acento',
    explicacao: '"Alho Triturado (MP)" no pedido contra "ALHO TRITURADO (MP)" no cadastro, com acento tirado em alguns lugares. Só visual.',
    correcao: 'Mostrar o nome do produto como está no cadastro em todas as telas.',
  },
  {
    id: 'permissoes-sem-cargo',
    titulo: 'Para decidir: 34 permissões ficam sem cargo (só Admin tem)',
    explicacao: '30 foram deixadas assim de propósito (cadastros, Notas - Excluir, Corrigir custo, Reabrir mês, Pagar, Categorias). 4 do Financeiro criadas depois da auditoria também ficaram sem cargo: Aprovar pagamento alto valor, Configurar aprovação, Lançamentos e transferências, Contas a receber - Receber.',
    correcao: 'O dono confirma se as 4 do Financeiro devem ficar só com Admin; se não, acrescentar em cargo_permissao (lista completa em e2e/robo/matriz-permissoes.md).',
  },
]

const POSICAO = new Map(CATALOGO.map((c, i) => [c.id, i]))

const normalizar = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

/** Descobre a causa de uma falha. Mesma causa em lojas e cargos diferentes devolve o mesmo id. */
export function causaDe(f: FalhaRastreada): Causa {
  if (f.causa) {
    const c = CATALOGO.find((x) => x.id === f.causa)
    if (c) return c
  }
  const tela = f.tela
  const txt = `${f.passo} ${f.mostrado}`
  let id: string | null = null
  if (/tree hydrated/i.test(f.mostrado)) id = 'hidratacao-central'
  else if (/same key/i.test(f.mostrado)) id = 'chave-repetida-movimentacoes'
  else if (/\/api\/offline\/snapshot/.test(tela)) id = 'offline-snapshot'
  else if (tela === '/log') id = 'log-aberto'
  else if (tela.includes('ano_passado')) id = 'faturamento-cancelados-historico'
  else if (tela.includes('ver=diario')) id = 'frio-paginacao'
  else if ((tela.startsWith('/relatorio-cmv') || tela.startsWith('/relatorio-lucro')) && /CMV|custo/i.test(f.passo)) id = 'cmv-sem-baixa'
  else if (/RB190/.test(txt) && tela.startsWith('/financeiro')) id = 'nota-digitada-sem-titulo'
  else if (tela === '/estoque' && /origem da diferença: Omie/.test(txt)) id = 'saldo-omie'
  else if (tela === '/estoque' && /origem da diferença: ERP/.test(txt)) id = 'saldo-inativo'
  if (id) return CATALOGO.find((c) => c.id === id)!
  const chave = `outro:${normalizar(tela.replace(/\?.*$/, ''))}|${normalizar(f.mostrado).slice(0, 80)}`
  return {
    id: chave,
    titulo: `${tela.replace(/\?.*$/, '')}: ${f.mostrado.slice(0, 90)}`,
    explicacao: 'Causa ainda não classificada pelo consolidador.',
    correcao: 'A investigar: causa ainda não classificada (abrir o print e o passo para entender).',
  }
}

// ---------- consolidação ----------

export type Item = {
  codigo: string
  causa: string
  gravidade: Gravidade
  titulo: string
  explicacao: string
  correcao: string
  ocorrencias: number
  lojas: string[]
  cargos: string[]
  telas: string[]
  porLoja: Record<string, string[]>
  fontes: { robo: string; ticket: string; rodada: string; n: number }[]
  exemplos: FalhaRastreada[]
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const unicos = (xs: string[]) => [...new Set(xs)].sort(cmp)

export function consolidar(falhas: FalhaRastreada[]): Item[] {
  const grupos = new Map<string, { causa: Causa; membros: FalhaRastreada[] }>()
  for (const f of falhas) {
    const causa = causaDe(f)
    const g = grupos.get(causa.id)
    if (g) g.membros.push(f)
    else grupos.set(causa.id, { causa, membros: [f] })
  }
  const itens: Item[] = []
  for (const { causa, membros } of grupos.values()) {
    const ordenados = [...membros].sort((a, b) => cmp(a.loja, b.loja) || cmp(a.cargo, b.cargo) || cmp(a.tela, b.tela) || cmp(a.passo, b.passo))
    const porLoja: Record<string, string[]> = {}
    for (const m of ordenados) porLoja[m.loja] = unicos([...(porLoja[m.loja] ?? []), m.cargo])
    const fontes = new Map<string, { robo: string; ticket: string; rodada: string; n: number }>()
    for (const m of ordenados) {
      const k = `${m.robo}|${m.rodada}`
      const x = fontes.get(k)
      if (x) x.n++
      else fontes.set(k, { robo: m.robo, ticket: m.ticket, rodada: m.rodada, n: 1 })
    }
    itens.push({
      codigo: '',
      causa: causa.id,
      gravidade: Math.min(...membros.map((m) => m.gravidade)) as Gravidade,
      titulo: causa.titulo,
      explicacao: causa.explicacao,
      correcao: causa.correcao,
      ocorrencias: membros.length,
      lojas: unicos(membros.map((m) => m.loja)),
      cargos: unicos(membros.map((m) => m.cargo)),
      telas: unicos(membros.map((m) => m.tela)),
      porLoja,
      fontes: [...fontes.values()].sort((a, b) => cmp(a.robo, b.robo)),
      exemplos: ordenados.slice(0, 3),
    })
  }
  itens.sort((a, b) => {
    const pa = POSICAO.get(a.causa) ?? 1e6
    const pb = POSICAO.get(b.causa) ?? 1e6
    return a.gravidade - b.gravidade || pa - pb || b.ocorrencias - a.ocorrencias || cmp(a.causa, b.causa)
  })
  itens.forEach((it, i) => (it.codigo = `F-${String(i + 1).padStart(2, '0')}`))
  return itens
}

// ---------- escolha da rodada e caminho do print ----------

export function escolherRodada(pastas: { nome: string; mtimeMs: number; temFalhas: boolean }[]): string | null {
  const ok = pastas.filter((p) => p.temFalhas).sort((a, b) => b.mtimeMs - a.mtimeMs || cmp(a.nome, b.nome))
  return ok[0]?.nome ?? null
}

export function caminhoDoPrint(f: Pick<FalhaRastreada, 'print' | 'pastaSaida' | 'rodada'>): string {
  if (f.print.startsWith('prints/') && f.pastaSaida) return `${f.pastaSaida}/${f.rodada}/${f.print}`
  return f.print
}

// ---------- texto final ----------

export type RodadaLida = { robo: string; ticket: string; rodada: string; falhas: number; pasta: string }
export type Ressalva = { ticket: string; titulo: string; status: string; ressalvas: string[]; naoProvado: string[] }
export type ContextoLista = { data: string; rodadas: RodadaLida[]; ressalvas: Ressalva[] }

const esc1 = (s: string, max: number) => {
  const t = s.replace(/\s*⏎\s*/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const lista = (xs: string[], max = 10) => (xs.length > max ? `${xs.slice(0, max).join(', ')} e mais ${xs.length - max}` : xs.join(', '))

export function formatarListaFinal(itens: Item[], ctx: ContextoLista): string {
  const L: string[] = []
  const n = (g: Gravidade) => itens.filter((i) => i.gravidade === g).length
  L.push('# Lista final de falhas do ERP (Etapa 1)', '')
  L.push(`Gerada em ${ctx.data} a partir dos resultados dos robôs e das notas dos tickets. Nenhuma correção foi feita: cada item traz só uma sugestão. Escolha a ordem de correção pelos números F-01, F-02...`, '')
  L.push(`- Itens: ${itens.length} (gravidade 1, ${ROTULO_GRAVIDADE[1]}: ${n(1)}; gravidade 2, ${ROTULO_GRAVIDADE[2]}: ${n(2)}; gravidade 3, ${ROTULO_GRAVIDADE[3]}: ${n(3)})`)
  L.push('- Mesma causa em várias lojas, cargos ou telas vira um item só, com a lista de onde aparece.', '')
  if (ctx.rodadas.length) {
    L.push('## De onde vêm os dados', '', '| Robô | Ticket | Rodada lida | Falhas na rodada |', '|---|---|---|---|')
    for (const r of ctx.rodadas) L.push(`| ${r.robo} | ${r.ticket} | ${r.pasta} | ${r.falhas} |`)
    L.push('')
    const zero = ctx.rodadas.filter((r) => r.falhas === 0)
    if (zero.length) L.push(`Robôs sem nenhuma falha na rodada lida: ${zero.map((r) => `robô ${r.robo} (0 falhas)`).join('; ')}. Isso vale só para o que cada um cobre (veja "Não foi provado" abaixo).`, '')
  }
  if (!itens.length) L.push('Nenhuma falha encontrada nas rodadas lidas.', '')
  for (const g of [1, 2, 3] as Gravidade[]) {
    const grupo = itens.filter((i) => i.gravidade === g)
    if (!grupo.length) continue
    L.push(`## Gravidade ${g}: ${ROTULO_GRAVIDADE[g]} (${grupo.length})`, '')
    for (const it of grupo) {
      const ex = it.exemplos[0]
      L.push(`### ${it.codigo} · ${it.titulo}`, '')
      if (it.explicacao) L.push(it.explicacao, '')
      const onde = Object.entries(it.porLoja).sort(([a], [b]) => cmp(a, b)).map(([l, cs]) => `${l} (${cs.join(', ')})`)
      L.push(`- Onde aparece: ${onde.join('; ')}${it.ocorrencias > 1 ? ` — ${it.ocorrencias} ocorrências` : ''}`)
      L.push(`- Loja: ${it.lojas.join(', ')}`)
      L.push(`- Cargo: ${it.cargos.join(', ')}`)
      L.push(`- Tela: ${lista(it.telas)}`)
      L.push(`- Passo: ${esc1(ex.passo, 260)}`)
      L.push(`- Esperado: ${esc1(ex.esperado, 220)}`)
      L.push(`- Mostrado: ${esc1(ex.mostrado, 320)}`)
      L.push(`- Print: ${caminhoDoPrint(ex)}`)
      L.push(`- Correção sugerida: ${it.correcao}`)
      L.push(`- Veio de: ${it.fontes.map((f) => (f.robo.startsWith('notas') ? `notas do ticket ${f.ticket}` : `robô ${f.robo} (ticket ${f.ticket}, rodada ${f.rodada}, ${f.n} ocorrência${f.n > 1 ? 's' : ''})`)).join('; ')}`)
      if (it.ocorrencias > 1 && it.exemplos.length > 1) {
        L.push('- Outros exemplos:')
        for (const e of it.exemplos.slice(1)) L.push(`  - ${e.loja}/${e.cargo}, ${esc1(e.tela, 80)}: ${esc1(e.passo, 140)} → esperado ${esc1(e.esperado, 80)}; mostrado ${esc1(e.mostrado, 120)}`)
      }
      L.push('')
    }
  }
  L.push('## Não foi provado, ressalvas e observações por ticket', '')
  L.push('Estes pontos NÃO são falhas confirmadas do ERP: são o que o robô não conseguiu provar e o que ficou como ressalva na entrega de cada ticket.', '')
  for (const r of ctx.ressalvas) {
    L.push(`### Ticket ${r.ticket}: ${r.titulo}`, '')
    L.push(`Situação: ${r.status}.`, '')
    if (r.naoProvado.length) {
      L.push('Não foi provado:', '')
      for (const x of r.naoProvado) L.push(`- ${x}`)
      L.push('')
    }
    if (r.ressalvas.length) {
      L.push('Ressalvas e observações (não são falha):', '')
      for (const x of r.ressalvas) L.push(`- ${x}`)
      L.push('')
    }
  }
  return L.join('\n')
}
