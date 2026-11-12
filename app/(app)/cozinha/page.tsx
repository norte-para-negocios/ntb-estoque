import Link from 'next/link'
import { CalendarDays, ChefHat, ClipboardCheck, Package } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Secao, Lista, Linha, Vazio, dataLonga } from '@/components/custo-cardapio/inicio/Secao'
import { linhasDoCardapio } from '@/lib/custo-cardapio/carregar'
import { saldosDaLoja } from '@/lib/custo-cardapio/saldos'
import { dadosInsumos, rotuloFonte, variacaoDeCompras, variacoes } from '@/lib/custo-cardapio/insumos'
import { arredondarPreco, custoSuspeito, resumir } from '@/lib/custo-cardapio/preco-puro'
import { altasDeCusto, cmvTipicoAgoraEAntes, custoAntesImplicito, deltaPorRaiz, pratosQueMaisDeixam, pratosQueMaisPesam, precisaComprar, quantidadeTexto } from '@/lib/custo-cardapio/insumos-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarConfigCozinha } from '@/lib/custo-cardapio/config'
import { contagemDaSemana, proximoEvento } from '@/lib/custo-cardapio/inicio'
import { estadoContagem, valorEmEstoque } from '@/lib/custo-cardapio/inicio-puro'
import { DIAS_SEMANA } from '@/lib/custo-cardapio/config-puro'
import { diasAte, formatarData } from '@/lib/custo-cardapio/eventos-puro'

// Norte Cozinha, Início: o retrato do custo do cardápio em 10 segundos. Só leitura.
// Consultas: carregarBase (taxas, produtos, fichas, foto do custo; cache por request), saldosDaLoja (foto dos saldos)
// e variacaoDeCompras (notas de compra de 120 dias, itens em lotes de ≤200 notas); próximo evento (custo_eventos + reservas),
// contagem da semana (inventários do ERP desde segunda) e configurações (dia da contagem).

const pontos = (v: number) => `${(Math.abs(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${Math.abs(v * 100) >= 1.95 ? 'pontos' : 'ponto'}`

export default async function InicioCozinhaPage() {
  const lojaId = await getCurrentLojaId()
  const d = await dadosInsumos(lojaId)
  if (!d) {
    return (
      <div className="space-y-4">
        <PageHeader title="Início" icon={ChefHat} />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O custo do prato sai das fichas técnicas e do custo dos insumos, que esta loja não tem." />
      </div>
    )
  }
  const { base } = d
  const t = base.taxas
  const [vc, saldos, cfg, evento, contagem] = await Promise.all([
    variacaoDeCompras(lojaId, base.modo), saldosDaLoja(lojaId, base.modo), carregarConfigCozinha(lojaId), proximoEvento(base),
    contagemDaSemana(lojaId, base.modo),
  ])
  const hoje = hojeBahiaISO()
  const ativos = d.insumos.filter((i) => !i.inativo)
  const valorEstoque = valorEmEstoque(ativos.map((i) => ({ saldo: saldos.porProduto.get(i.codigo)?.saldo ?? 0, custo: i.suspeito ? null : i.custo })))
  const contagemSemana = estadoContagem(hoje, cfg.compras.diaContagem, ativos.filter((i) => contagem.contados.has(i.codigo)).length, ativos.length)
  const linkInventario = base.modo === 'proprio' ? '/inventario-proprio' : '/inventario'
  const diasEvento = evento?.data ? diasAte(evento.data, new Date(`${hoje}T12:00:00`)) : null
  const vars = variacoes(d, vc)
  const temCompras = vars.size > 0
  // Impacto em R$ na escala do custo médio de hoje, com a variação do preço de compra.
  const antesImpl = custoAntesImplicito(base.cmc, vars)

  const linhas = linhasDoCardapio(base)
  const pratos = linhas.filter((l) => l.tipo === 'prato')
  const resumo = resumir(pratos)
  const suspeitoAgora = (cod: number) => custoSuspeito(base.cmc.get(cod) ?? null, d.unidade(cod))
  const ignorar = suspeitoAgora
  const delta = deltaPorRaiz(d.usos, base.cmc, antesImpl, ignorar)
  const tipico = cmvTipicoAgoraEAntes(pratos, delta)
  const altas = altasDeCusto(d.usos, base.cmc, antesImpl, { ehPrato: d.ehPrato, ignorar })
  const nSubiram = d.insumos.filter((i) => !i.inativo && (vars.get(i.codigo) ?? 0) >= 0.03).length
  const pesam = pratosQueMaisPesam(pratos, t.metaCmv)
  const deixam = pratosQueMaisDeixam(pratos)

  const abaixo = d.insumos
    .map((i) => ({ i, s: saldos.porProduto.get(i.codigo) }))
    .filter((x): x is { i: typeof x.i; s: NonNullable<typeof x.s> } => !!x.s && !x.i.inativo && precisaComprar(x.s.saldo, x.s.minimo))
    .sort((a, b) => b.i.pratos - a.i.pratos || a.i.descricao.localeCompare(b.i.descricao, 'pt-BR'))

  const insumosSemCusto = d.insumos.filter((i) => i.custo == null && !i.inativo).length
  const problemas = [
    { n: pratos.filter((l) => l.suspeitos > 0).length, rotulo: 'pratos com custo de insumo a conferir', dica: 'custo médio fora do normal para a unidade (entrada lançada na unidade errada)', href: '/cozinha/pratos?filtro=suspeito' },
    { n: pratos.filter((l) => l.semCusto > 0).length, rotulo: 'pratos com insumo sem custo', dica: 'o CMV real é maior que o mostrado', href: '/cozinha/pratos?filtro=faltando' },
    { n: resumo.semPreco, rotulo: 'pratos sem preço de venda', dica: 'ficam fora do CMV típico', href: '/cozinha/pratos?filtro=sem_preco' },
    { n: insumosSemCusto, rotulo: 'insumos sem custo', dica: 'nunca entraram com custo no estoque', href: '/cozinha/insumos?filtro=sem_custo' },
  ].filter((p) => p.n > 0)
  const totalProblemas = problemas.reduce((a, p) => a + p.n, 0)

  const acima = tipico.agora != null && tipico.agora > t.metaCmv + 1e-9
  const mudou = tipico.agora != null && tipico.antes != null ? tipico.agora - tipico.antes : null
  const fatos = [
    { n: resumo.acima, txt: resumo.acima === 1 ? 'prato acima da meta' : 'pratos acima da meta', href: '/cozinha/pratos?filtro=acima', tom: 'text-err' },
    ...(temCompras ? [{ n: nSubiram, txt: nSubiram === 1 ? 'insumo subiu no mês' : 'insumos subiram no mês', href: '/cozinha/insumos?filtro=subiu', tom: 'text-warn' }] : []),
    { n: abaixo.length, txt: abaixo.length === 1 ? 'insumo abaixo do mínimo' : 'insumos abaixo do mínimo', href: '/cozinha/estoque?filtro=abaixo', tom: 'text-warn' },
    { n: totalProblemas, txt: 'dados para arrumar', href: '#arrumar', tom: 'text-text' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Início" icon={ChefHat} description="Como está o custo do cardápio, o que subiu e o que precisa de atenção." />
      {base.avisos.map((a) => <p key={a} className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">{a}</p>)}

      <section className="rounded-[var(--r-lg)] bg-surface p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <p className="text-[13px] text-text-muted">CMV do prato típico</p>
        {tipico.agora == null ? (
          <div className="mt-2">
            <p className="text-[19px] font-semibold text-text">Ainda não dá para calcular o CMV</p>
            <p className="mt-1 max-w-[60ch] text-[14px] text-text-muted">Nenhum prato tem preço de venda e custo completo ao mesmo tempo. Arrume os dados abaixo e o número aparece aqui.</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p className={`num text-[56px] font-semibold leading-none tracking-[-0.04em] ${acima ? 'text-err' : 'text-ok'}`}>{pct(tipico.agora)}</p>
            <p className="max-w-[46ch] pb-1.5 text-[15px] leading-snug text-text-muted">
              {acima ? `${pontos(tipico.agora - t.metaCmv)} acima da meta de ${pct(t.metaCmv, 0)}.` : `Dentro da meta de ${pct(t.metaCmv, 0)}.`}{' '}
              {mudou != null && temCompras && (Math.abs(mudou) < 0.0005
                ? `Sem mudança pelo preço de compra dos últimos 30 dias.`
                : `${mudou > 0 ? 'Subiu' : 'Caiu'} ${pontos(mudou)} com o preço de compra dos últimos 30 dias (${rotuloFonte(vc)}).`)}
            </p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
          {fatos.map((f) => (
            <Link key={f.txt} href={f.href} className="group inline-flex items-baseline gap-1.5">
              <span className={`num font-semibold ${f.n > 0 ? f.tom : 'text-text-muted'}`}>{f.n}</span>
              <span className="text-text-muted group-hover:text-text">{f.txt}</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-text-muted">
          Metade dos pratos com preço e custo completo fica abaixo deste CMV. Custo dos insumos: {base.modo === 'omie' ? `custo médio do Omie${base.dataCusto ? ` em ${dataLonga(base.dataCusto)}` : ''}` : 'custo médio do estoque'}.
        </p>
      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <Link href={evento ? `/cozinha/eventos/${evento.id}` : '/cozinha/eventos'} className="block rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)] u-motion hover:bg-surface-2/60">
          <p className="flex items-center gap-1.5 text-[13px] text-text-muted"><CalendarDays className="size-4" /> Próximo evento</p>
          {evento ? (
            <>
              <p className="mt-2 truncate text-[17px] font-semibold text-text">{evento.nome}</p>
              <p className="num text-[13px] text-text-muted">
                {formatarData(evento.data)}{diasEvento === 0 ? ' · hoje' : diasEvento === 1 ? ' · amanhã' : diasEvento != null ? ` · em ${diasEvento} dias` : ''} · {evento.convidados} {evento.convidados === 1 ? 'convidado' : 'convidados'}{evento.status === 'orcamento' ? ' · orçamento' : ''}
              </p>
              <p className="mt-3 text-[14px]">
                {evento.compra.aComprar === 0
                  ? <span className="text-ok">Tudo em estoque</span>
                  : <span className="text-warn">Falta comprar {evento.compra.aComprar} {evento.compra.aComprar === 1 ? 'item' : 'itens'}{evento.compra.custoCompra > 0 ? ` (${brl(evento.compra.custoCompra)})` : ''}</span>}
                {evento.compra.conflitos > 0 && <span className="text-err"> · {evento.compra.conflitos} {evento.compra.conflitos === 1 ? 'insumo já está' : 'insumos já estão'} todo reservado para outros eventos</span>}
              </p>
              {evento.naSemana > 1 && <p className="mt-1 text-[12px] text-text-muted">{evento.naSemana} eventos nos próximos 7 dias</p>}
            </>
          ) : (
            <p className="mt-2 text-[14px] text-text-muted">Nenhum evento marcado de hoje em diante.</p>
          )}
        </Link>

        <Link href={contagemSemana.estado === 'desligada' ? '/cozinha/configuracoes' : linkInventario}
          className={`block rounded-[var(--r-lg)] p-5 shadow-[var(--shadow-sm)] u-motion ${contagemSemana.estado === 'pendente' ? 'bg-warn/10 hover:bg-warn/15' : 'bg-surface hover:bg-surface-2/60'}`}>
          <p className="flex items-center gap-1.5 text-[13px] text-text-muted"><ClipboardCheck className="size-4" /> Contagem da semana</p>
          {contagemSemana.estado === 'desligada' ? (
            <p className="mt-2 text-[14px] text-text-muted">Lembrete desligado. Escolha o dia da contagem em Configurações.</p>
          ) : contagemSemana.estado === 'feita' ? (
            <>
              <p className="mt-2 text-[17px] font-semibold text-ok">Feita</p>
              <p className="num text-[13px] text-text-muted">{contagemSemana.contados} de {contagemSemana.total} insumos das fichas contados desde segunda.</p>
            </>
          ) : contagemSemana.estado === 'ainda_nao' ? (
            <>
              <p className="mt-2 text-[17px] font-semibold text-text">Ainda não é o dia</p>
              <p className="text-[13px] text-text-muted">{DIAS_SEMANA[cfg.compras.diaContagem ?? 0]}, {formatarData(contagemSemana.dia).slice(0, 5)}.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[17px] font-semibold text-warn">{contagemSemana.diasAtraso === 0 ? 'Hoje é dia de contar' : `Atrasada há ${contagemSemana.diasAtraso} ${contagemSemana.diasAtraso === 1 ? 'dia' : 'dias'}`}</p>
              <p className="num text-[13px] text-text-muted">
                {contagemSemana.contados > 0 ? `${contagemSemana.contados} de ${contagemSemana.total} insumos contados; falta chegar à metade.` : `Nenhum dos ${contagemSemana.total} insumos das fichas contado nesta semana.`}
                {' '}<span className="font-medium text-brand">Abrir o inventário</span>
              </p>
            </>
          )}
          {contagem.ultima && contagemSemana.estado !== 'desligada' && <p className="mt-1 text-[12px] text-text-muted">Última contagem em {dataLonga(contagem.ultima)}.</p>}
          {contagem.erro && <p className="mt-1 text-[12px] text-text-muted">Não deu para ler os inventários agora.</p>}
        </Link>

        <Link href="/cozinha/estoque" className="block rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)] u-motion hover:bg-surface-2/60">
          <p className="flex items-center gap-1.5 text-[13px] text-text-muted"><Package className="size-4" /> Valor em estoque</p>
          <p className="num mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] text-text">{brl(valorEstoque)}</p>
          <p className="mt-2 text-[13px] text-text-muted">Insumos das fichas, saldo × custo médio{saldos.data ? ` (saldo de ${dataLonga(saldos.data)})` : ''}.</p>
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Secao titulo="Pratos que mais pesam" sub="Quanto cada venda custa a mais do que a meta permite." acao={{ href: '/cozinha/pratos?filtro=acima', rotulo: 'Ver todos' }}>
          {pesam.length === 0 ? <Vazio>Nenhum prato com preço passa da meta.</Vazio> : (
            <Lista>
              {pesam.map((p) => (
                <Linha key={p.codigo} href={`/cozinha/pratos/${p.codigo}`} titulo={p.descricao}
                  detalhe={`Custa ${brl(p.custo)}, vende a ${brl(p.preco)}. Para a meta: ${brl(arredondarPreco(p.sugeridoSalao))}.`}
                  valor={pct(p.cmv)} tomValor={p.situacao === 'acima' ? 'err' : 'warn'} valorDetalhe={`+${brl(p.excesso)} por venda`} />
              ))}
            </Lista>
          )}
        </Secao>

        <Secao titulo="Insumos que subiram" sub={`Preço médio de compra dos últimos 30 dias contra os 90 dias anteriores, ${rotuloFonte(vc)}.`} acao={temCompras ? { href: '/cozinha/insumos?filtro=subiu', rotulo: 'Ver todos' } : undefined}>
          {!temCompras ? <Vazio>Nenhum insumo foi comprado nas duas janelas (últimos 30 dias e os 90 antes), então não há o que comparar.</Vazio> : altas.length === 0 ? <Vazio>Nenhum insumo subiu 3% ou mais.</Vazio> : (
            <Lista>
              {altas.slice(0, 5).map((a) => {
                const ins = d.insumos.find((i) => i.codigo === a.codigo)
                const c = vc.porProduto.get(a.codigo)
                return (
                  <Linha key={a.codigo} href={`/cozinha/insumos/${a.codigo}`} titulo={ins?.descricao ?? `Produto ${a.codigo}`}
                    detalhe={c ? `Compra de ${formatCustoUnit(c.antes, ins?.unidade)} para ${formatCustoUnit(c.agora, ins?.unidade)}` : undefined}
                    valor={`+${pct(a.variacao)}`} tomValor="err"
                    valorDetalhe={!a.pratos ? 'só em preparações' : a.impactoMedio < 0.01 ? `${a.pratos} pratos, menos de R$ 0,01 cada` : `+${brl(a.impactoMedio)} em ${a.pratos} ${a.pratos === 1 ? 'prato' : 'pratos'}`} />
                )
              })}
            </Lista>
          )}
        </Secao>

        <Secao titulo="Pratos que mais deixam" sub="Dentro da meta e com a maior sobra por venda no salão, depois das taxas." acao={{ href: '/cozinha/pratos', rotulo: 'Ver todos' }}>
          {deixam.length === 0 ? <Vazio>Nenhum prato dentro da meta com preço.</Vazio> : (
            <Lista>
              {deixam.map((p) => (
                <Linha key={p.codigo} href={`/cozinha/pratos/${p.codigo}`} titulo={p.descricao}
                  detalhe={`Custa ${brl(p.custo)}, vende a ${brl(p.preco)}.`} valor={`${brl(p.sobraSalao)}`} tomValor="ok" valorDetalhe={`CMV ${pct(p.cmv)}`} />
              ))}
            </Lista>
          )}
        </Secao>

        <Secao titulo="Abaixo do mínimo" sub={`Insumos das fichas com saldo abaixo do estoque mínimo${saldos.data ? ` (saldo de ${dataLonga(saldos.data)})` : ''}.`}
          acao={abaixo.length ? { href: '/cozinha/estoque?ver=compras', rotulo: 'Lista de compras' } : undefined}>
          {abaixo.length === 0 ? <Vazio>Nenhum insumo das fichas está abaixo do mínimo.</Vazio> : (
            <Lista>
              {abaixo.slice(0, 5).map(({ i, s }) => (
                <Linha key={i.codigo} href={`/cozinha/insumos/${i.codigo}`} titulo={i.descricao}
                  detalhe={`Usado em ${i.pratos} ${i.pratos === 1 ? 'prato' : 'pratos'}`}
                  valor={quantidadeTexto(Math.round(s.saldo * 1000) / 1000, i.unidade)} tomValor={s.saldo < 0 ? 'err' : 'warn'}
                  valorDetalhe={`mínimo ${quantidadeTexto(s.minimo, i.unidade)}`} />
              ))}
            </Lista>
          )}
        </Secao>
      </div>

      <div id="arrumar" className="scroll-mt-24">
        <Secao titulo="Para arrumar" sub="Dados que deixam o custo ou o CMV errado. Cada linha abre a lista já filtrada.">
          {problemas.length === 0 ? <Vazio>Nada para arrumar: todo prato tem preço e todo insumo tem custo.</Vazio> : (
            <Lista>
              {problemas.map((p) => <Linha key={p.href} href={p.href} titulo={`${p.n} ${p.rotulo}`} detalhe={p.dica} />)}
            </Lista>
          )}
        </Secao>
      </div>
    </div>
  )
}
