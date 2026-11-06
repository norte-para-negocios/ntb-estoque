import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha, type ColunaExcel } from '@/lib/excel'
import { carregarCadastro, carregarConsumo } from '@/lib/estoque/consumo-perdas-loader'
import { textoSemContagem } from '@/lib/estoque/consumo-real-puro'
import { lerFiltroConsumo, linhasDaVisao } from '../filtro'

export const dynamic = 'force-dynamic'

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : '')

export async function GET(request: Request) {
  if (!(await ehDesenvolvedor())) return new Response('Não encontrado', { status: 404 })
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Relatório das lojas com estoque próprio', { status: 400 })
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { p, local, ver } = lerFiltroConsumo(sp, hojeBahiaISO())
  const avisos: string[] = []
  const [cad, d] = await Promise.all([carregarCadastro(lojaId, avisos), carregarConsumo(lojaId, p.ini, p.fim, local)])
  if (d.erro) avisos.push(d.erro)
  if (avisos.length) return new Response(avisos.join('\n'), { status: 500 })

  const nomeLocal = new Map(cad.locais.map((l) => [l.codigo, l.descricao]))
  const rows = linhasDaVisao(d.linhas, ver).map((l) => {
    const pr = cad.produtos.get(l.produto)
    return {
      ...l,
      insumo: pr?.descricao ?? String(l.produto),
      codigo: pr?.codigo ?? '',
      localNome: nomeLocal.get(l.local) ?? String(l.local),
      unidade: pr?.unidade ?? '',
      contadoIni: fmtData(l.contadoIniEm),
      contadoFim: fmtData(l.contadoFimEm),
      custoObs: l.custoEstimado ? 'Custo estimado' : '',
      realTexto: textoSemContagem(l.contagens),
    }
  })
  const inicio: ColunaExcel[] = [
    { key: 'insumo', label: 'Insumo', largura: 38 },
    { key: 'codigo', label: 'Código' },
    { key: 'localNome', label: 'Local', largura: 22 },
    { key: 'unidade', label: 'Unidade' },
  ]
  const colunas: ColunaExcel[] = ver === 'com'
    ? [
        ...inicio,
        { key: 'saldoIni', label: 'Contagem inicial', tipo: 'numero' },
        { key: 'contadoIni', label: 'Data da contagem inicial' },
        { key: 'entradas', label: 'Entradas', tipo: 'numero' },
        { key: 'saldoFim', label: 'Contagem final', tipo: 'numero' },
        { key: 'contadoFim', label: 'Data da contagem final' },
        { key: 'consumoReal', label: 'Consumo real', tipo: 'numero' },
        { key: 'teoricoVenda', label: 'Teórico das vendas', tipo: 'numero' },
        { key: 'teoricoOp', label: 'Teórico das produções', tipo: 'numero' },
        { key: 'teorico', label: 'Teórico', tipo: 'numero' },
        { key: 'desvio', label: 'Desvio', tipo: 'numero' },
        { key: 'custoUnitario', label: 'Custo unitário', tipo: 'moeda' },
        { key: 'teoricoValor', label: 'Teórico R$', tipo: 'moeda', somar: true },
        { key: 'realValor', label: 'Real R$', tipo: 'moeda', somar: true },
        { key: 'desvioValor', label: 'Desvio R$', tipo: 'moeda', somar: true },
        { key: 'ajustesPerdas', label: 'Perda lançada', tipo: 'numero' },
        { key: 'custoObs', label: 'Atenção', largura: 18 },
      ]
    : [
        ...inicio,
        { key: 'teoricoVenda', label: 'Vendas', tipo: 'numero' },
        { key: 'teoricoOp', label: 'Ordens de produção', tipo: 'numero' },
        { key: 'teorico', label: 'Teórico', tipo: 'numero' },
        { key: 'teoricoValor', label: 'Teórico R$', tipo: 'moeda', somar: true },
        { key: 'realTexto', label: 'Real', largura: 40 },
        { key: 'custoObs', label: 'Atenção', largura: 18 },
      ]
  const localTxt = local != null ? ` · local ${nomeLocal.get(local) ?? local}` : ''
  const aba: AbaPlanilha = {
    rows, colunas, nome: 'Consumo',
    opts: { titulo: 'Consumo teórico × real', subtitulo: `${p.ini} a ${p.fim}${localTxt} · ${ver === 'com' ? 'com contagem' : 'sem contagem'}`, autoFiltro: true },
  }
  return planilhaResponse(`consumo-${p.ini}-${p.fim}.xlsx`, await gerarPlanilhaMulti([aba]))
}
