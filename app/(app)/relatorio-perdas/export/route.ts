import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'
import { carregarCadastro, carregarPerdas } from '@/lib/estoque/consumo-perdas-loader'
import { ROTULO_CAUSA } from '@/lib/estoque/perdas-puro'
import { lerFiltroPerdas } from '../filtro'

export const dynamic = 'force-dynamic'

const fmtData = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

export async function GET(request: Request) {
  if (!(await ehDesenvolvedor())) return new Response('Não encontrado', { status: 404 })
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Relatório das lojas com estoque próprio', { status: 400 })
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { p, causa } = lerFiltroPerdas(sp, hojeBahiaISO())
  const avisos: string[] = []
  const [cad, r] = await Promise.all([carregarCadastro(lojaId, avisos), carregarPerdas(lojaId, p.ini, p.fim, avisos)])
  if (avisos.length) return new Response(avisos.join('\n'), { status: 500 })

  const nomeLocal = new Map(cad.locais.map((l) => [l.codigo, l.descricao]))
  // Como na tela: correção de dados não é perda. Sem filtro de causa, elas vão para uma aba à parte e não entram no total.
  const linhas = causa ? r.linhas.filter((l) => l.causa === causa) : r.linhas.filter((l) => l.causa !== 'correcao')
  const correcoes = causa ? [] : r.linhas.filter((l) => l.causa === 'correcao')
  const linha = (l: (typeof r.linhas)[number]) => {
    const pr = cad.produtos.get(l.produto)
    return {
      data: fmtData(l.data),
      produto: pr?.descricao ?? String(l.produto),
      codigo: pr?.codigo ?? '',
      local: nomeLocal.get(l.local) ?? String(l.local),
      causa: ROTULO_CAUSA[l.causa],
      quantidade: l.quantidade,
      unidade: pr?.unidade ?? '',
      custoUnitario: l.custoUnitario,
      valor: l.valor,
      motivo: l.motivo ?? '',
    }
  }
  const rows = linhas.map(linha)
  const colunas: AbaPlanilha['colunas'] = [
      { key: 'data', label: 'Data' },
      { key: 'produto', label: 'Produto', largura: 38 },
      { key: 'codigo', label: 'Código' },
      { key: 'local', label: 'Local', largura: 22 },
      { key: 'causa', label: 'Causa' },
      { key: 'quantidade', label: 'Quantidade', tipo: 'numero' },
      { key: 'unidade', label: 'Unidade' },
      { key: 'custoUnitario', label: 'Custo unitário', tipo: 'moeda' },
      { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
      { key: 'motivo', label: 'Motivo', largura: 48 },
  ]
  const aba: AbaPlanilha = {
    rows, nome: 'Perdas', colunas,
    opts: {
      titulo: 'Perdas e desperdício',
      subtitulo: `${p.ini} a ${p.fim}${causa ? ` · ${ROTULO_CAUSA[causa].toLowerCase()}` : ''} · correções de dados ficam na outra aba e não somam nas perdas`,
      autoFiltro: true,
    },
  }
  return planilhaResponse(`perdas-${p.ini}-${p.fim}.xlsx`, await gerarPlanilhaMulti(correcoes.length ? [aba, { rows: correcoes.map(linha), nome: 'Correções de dados', colunas, opts: { titulo: 'Correções de dados (não são perda)', autoFiltro: true } }] : [aba]))
}
