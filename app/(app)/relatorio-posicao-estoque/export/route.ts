import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { gerarPlanilhaMulti, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { textoAvisoSuspeito } from '@/lib/relatorios/posicao-estoque-puro'
import { carregarPosicao, lerOpcoesPosicao, rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { exigirDev } from '@/lib/recursos-dev'

export const dynamic = 'force-dynamic'

// Todas as linhas da posição (a tela mostra até 500). Tipo SPED: colunas do registro H010 do Bloco H.
export async function GET(request: Request) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const op = lerOpcoesPosicao(Object.fromEntries(new URL(request.url).searchParams.entries()))
  const r = await carregarPosicao(lojaId, op)
  if (!r.linhas.length) return new Response('Sem posição de estoque para o filtro selecionado', { status: 404 })
  const sped = op.ver === 'sped'
  const rows = r.linhas.map((l) => ({
    codigo: l.codigo, descricao: l.descricao, local: l.local ?? '', familia: l.familia, tipo: rotuloTipo(l.tipo), ncm: l.ncm, unidade: l.unidade,
    inativo: l.inativo ? 'Sim' : 'Não', quant: l.quant, reservado: l.reservado, disponivel: l.disponivel, cmc: l.cmc, valor: l.valor,
    situacao: l.custoSuspeito ? 'Custo suspeito no Omie (custo de referência)' : '', posse: '0', posseDesc: 'Item de propriedade do informante e em seu poder',
  }))
  const colunas: ColunaExcel[] = sped
    ? [
        { key: 'codigo', label: 'COD_ITEM', tipo: 'texto', largura: 14 },
        { key: 'descricao', label: 'Descrição', tipo: 'texto', largura: 44 },
        { key: 'ncm', label: 'NCM', tipo: 'texto', largura: 12 },
        { key: 'tipo', label: 'Tipo (SPED)', tipo: 'texto', largura: 24 },
        { key: 'unidade', label: 'UNID', tipo: 'texto', largura: 8 },
        { key: 'quant', label: 'QTD', tipo: 'numero', largura: 14 },
        { key: 'cmc', label: 'VL_UNIT', tipo: 'numero', largura: 14 },
        { key: 'valor', label: 'VL_ITEM', tipo: 'moeda', largura: 16, somar: true },
        { key: 'posse', label: 'IND_PROP', tipo: 'texto', largura: 10 },
        { key: 'posseDesc', label: 'Indicador de propriedade', tipo: 'texto', largura: 44 },
        { key: 'situacao', label: 'Observação', tipo: 'texto', largura: 28 },
      ]
    : [
        { key: 'codigo', label: 'Código', tipo: 'texto', largura: 14 },
        { key: 'descricao', label: 'Produto', tipo: 'texto', largura: 44 },
        ...(op.ver === 'local' ? [{ key: 'local', label: 'Local', tipo: 'texto', largura: 20 } as ColunaExcel] : []),
        { key: 'familia', label: 'Família', tipo: 'texto', largura: 24 },
        { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
        { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 8 },
        { key: 'inativo', label: 'Inativo', tipo: 'texto', largura: 8 },
        { key: 'quant', label: 'Quantidade', tipo: 'numero', largura: 14, somar: true },
        { key: 'reservado', label: 'Reservado', tipo: 'numero', largura: 12 },
        { key: 'disponivel', label: 'Disponível', tipo: 'numero', largura: 12 },
        { key: 'cmc', label: 'Custo médio', tipo: 'numero', largura: 14 },
        { key: 'valor', label: 'Valor', tipo: 'moeda', largura: 16, somar: true },
        { key: 'situacao', label: 'Observação', tipo: 'texto', largura: 28 },
      ]
  const suspeito = textoAvisoSuspeito(r.total.suspeitas.length, r.total.ajusteOmie)
  const sc = sped ? null : r.saldoConferir
  const temSaldoConferir = !!sc && (sc.acumulados.length > 0 || sc.inativos.length > 0)
  const brlX = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const aviso = `${suspeito ? ` · ATENÇÃO: ${suspeito} (lista na aba Custo suspeito)` : ''}${sc && sc.acumulados.length ? ` · ATENÇÃO: ${brlX(sc.valorAcumulados)} em ${sc.acumulados.length} produtos com saldo maior que tudo o que entrou em 12 meses (aba Saldo a conferir)` : ''}${r.erros.length ? ` · ATENÇÃO: falha ao ler ${r.erros.join(', ')}` : ''}${r.locaisSumidos.length ? ` · ATENÇÃO: local(is) fora da última leitura do Omie: ${r.locaisSumidos.join(', ')}` : ''}`
  const buffer = await gerarPlanilhaMulti([{
    rows, colunas,
    opts: {
      titulo: sped ? 'Inventário tipo SPED (Bloco H)' : 'Posição de estoque',
      subtitulo: `Foto de ${r.dataFoto?.split('-').reverse().join('/') ?? '—'} · total ${r.total.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${aviso}`,
      autoFiltro: true,
    },
    nome: sped ? 'Bloco H' : 'Posição',
  }, ...(r.total.suspeitas.length ? [{
    rows: r.total.suspeitas.map((l) => ({ codigo: l.codigo, descricao: l.descricao, local: l.local, quant: l.quant, cmcOmie: l.cmcOmie, referencia: l.referencia ?? '', valorOmie: l.valorOmie, valor: l.valor, motivo: l.motivo })),
    colunas: [
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 14 },
      { key: 'descricao', label: 'Produto', tipo: 'texto', largura: 44 },
      { key: 'local', label: 'Local', tipo: 'texto', largura: 20 },
      { key: 'quant', label: 'Saldo', tipo: 'numero', largura: 12 },
      { key: 'cmcOmie', label: 'CMC no Omie', tipo: 'numero', largura: 16 },
      { key: 'referencia', label: 'Custo de referência', tipo: 'numero', largura: 16 },
      { key: 'valorOmie', label: 'Valor no Omie', tipo: 'moeda', largura: 18, somar: true },
      { key: 'valor', label: 'Valor usado', tipo: 'moeda', largura: 16, somar: true },
      { key: 'motivo', label: 'Por quê', tipo: 'texto', largura: 60 },
    ] as ColunaExcel[],
    opts: { titulo: 'Linhas com custo médio errado no Omie', subtitulo: 'O total da posição usa o custo de referência do produto nestas linhas. Corrija o custo (ou a unidade) no Omie.', autoFiltro: true },
    nome: 'Custo suspeito',
  }] : []), ...(temSaldoConferir && sc ? [{
    rows: [
      ...sc.acumulados.map((l) => ({ motivo: 'Saldo maior que tudo o que entrou em 12 meses (notas, produção e ajustes)', codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, saldo: l.saldo, comprado: l.comprado12m ?? '', valor: l.valor })),
      ...sc.inativos.map((l) => ({ motivo: 'Produto inativo com saldo', codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, saldo: l.saldo, comprado: l.comprado12m ?? '', valor: l.valor })),
    ],
    colunas: [
      { key: 'motivo', label: 'Conferir', tipo: 'texto', largura: 48 },
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 14 },
      { key: 'descricao', label: 'Produto', tipo: 'texto', largura: 44 },
      { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 8 },
      { key: 'saldo', label: 'Saldo no Omie', tipo: 'numero', largura: 14 },
      { key: 'comprado', label: 'Entrou em 12 meses (notas, produção, ajustes)', tipo: 'numero', largura: 18 },
      { key: 'valor', label: 'Valor no total', tipo: 'moeda', largura: 16 },
    ] as ColunaExcel[],
    opts: { titulo: 'Saldos do Omie a conferir', subtitulo: 'O total soma estes saldos como o Omie. Saldo maior que tudo o que entrou em 12 meses (notas, produção, ajustes) = falta de baixa (consumo, perda, produção). Confira com inventário.', autoFiltro: true },
    nome: 'Saldo a conferir',
  }] : [])])
  return planilhaResponse(sped ? 'inventario-bloco-h' : 'posicao-estoque', buffer)
}
