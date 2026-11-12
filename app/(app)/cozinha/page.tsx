import Link from 'next/link'
import { ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Secao, Lista, Linha, Vazio, dataLonga } from '@/components/custo-cardapio/inicio/Secao'
import { linhasDoCardapio } from '@/lib/custo-cardapio/carregar'
import { saldosDaLoja } from '@/lib/custo-cardapio/saldos'
import { custoDeAntes, dadosInsumos } from '@/lib/custo-cardapio/insumos'
import { arredondarPreco, custoSuspeito, resumir } from '@/lib/custo-cardapio/preco-puro'
import { altasDeCusto, cmvTipicoAgoraEAntes, deltaPorRaiz, pratosQueMaisDeixam, pratosQueMaisPesam, precisaComprar, quantidadeTexto } from '@/lib/custo-cardapio/insumos-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'
import { formatCustoUnit } from '@/lib/num-br'

// Norte Cozinha, Início: o retrato do custo do cardápio em 10 segundos. Só leitura.
// Consultas: carregarBase (taxas, produtos, fichas, foto do custo; cache por request), saldosDaLoja (foto dos saldos)
// e custoDeAntes (foto de ~30 dias atrás). Nada mais.

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
  const [antes, saldos] = await Promise.all([custoDeAntes(lojaId, base.modo, base.dataCusto), saldosDaLoja(lojaId, base.modo)])

  const linhas = linhasDoCardapio(base)
  const pratos = linhas.filter((l) => l.tipo === 'prato')
  const resumo = resumir(pratos)
  const suspeitoAgora = (cod: number) => custoSuspeito(base.cmc.get(cod) ?? null, d.unidade(cod))
  const ignorar = (cod: number) => suspeitoAgora(cod) || custoSuspeito(antes?.cmc.get(cod) ?? null, d.unidade(cod))
  const delta = antes ? deltaPorRaiz(d.usos, base.cmc, antes.cmc, ignorar) : new Map<number, number>()
  const tipico = cmvTipicoAgoraEAntes(pratos, delta)
  const altas = antes ? altasDeCusto(d.usos, base.cmc, antes.cmc, { ehPrato: d.ehPrato, ignorar }) : []
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
    ...(antes ? [{ n: altas.length, txt: altas.length === 1 ? 'insumo subiu no mês' : 'insumos subiram no mês', href: '/cozinha/insumos?filtro=subiu', tom: 'text-warn' }] : []),
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
              {mudou != null && antes && (Math.abs(mudou) < 0.0005
                ? `Igual a ${antes.dias} dias atrás.`
                : `${mudou > 0 ? 'Subiu' : 'Caiu'} ${pontos(mudou)} desde ${dataLonga(antes.data)}, só pelo custo dos insumos.`)}
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

        <Secao titulo="Insumos que subiram" sub={antes ? `Custo médio de hoje contra ${dataLonga(antes.data)}.` : undefined} acao={antes ? { href: '/cozinha/insumos?filtro=subiu', rotulo: 'Ver todos' } : undefined}>
          {!antes ? <Vazio>Ainda não há foto do custo de 30 dias atrás para comparar.</Vazio> : altas.length === 0 ? <Vazio>Nenhum insumo subiu 3% ou mais.</Vazio> : (
            <Lista>
              {altas.slice(0, 5).map((a) => {
                const ins = d.insumos.find((i) => i.codigo === a.codigo)
                return (
                  <Linha key={a.codigo} href={`/cozinha/insumos/${a.codigo}`} titulo={ins?.descricao ?? `Produto ${a.codigo}`}
                    detalhe={`${formatCustoUnit(a.antes, ins?.unidade)} para ${formatCustoUnit(a.agora, ins?.unidade)}`}
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
