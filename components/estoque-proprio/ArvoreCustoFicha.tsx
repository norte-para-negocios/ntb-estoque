import type { ArvoreCusto, NoArvore } from '@/lib/estoque/arvore-custo-puro'
import { formatCustoUnit } from '@/lib/num-br'
import { fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'

// T5.5 (só desenvolvedor): custo de 1 unidade do produto pela ficha, aberto até o insumo comprado (prato → pré-preparo →
// insumos). Só mostra: a baixa não muda (pré-preparo que não abre na venda sai do estoque dele, produzido por OP).

type Info = { descricao: string; unidade: string }

function Linha({ n, nivel, info }: { n: NoArvore; nivel: number; info: Map<number, Info> }) {
  const i = info.get(n.codigo)
  const nome = i?.descricao ?? `Produto ${n.codigo}`
  const un = i?.unidade ?? ''
  const conteudo = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5" style={{ paddingLeft: nivel * 18 }}>
      <div className="min-w-0">
        <a href={`/estoque/produto/${n.codigo}`} className="text-[13px] text-text hover:underline">{nome}</a>
        {n.temFicha && <span className="ml-1.5 rounded-full bg-info/10 px-1.5 py-0.5 text-[11px] font-medium text-info">pré-preparo · ficha v{n.versao ?? '-'}{n.abreNaBaixa ? ' · abre na venda' : ''}</span>}
        {n.ciclo && <span className="ml-1.5 rounded-full bg-err/10 px-1.5 py-0.5 text-[11px] font-medium text-err">receita circular</span>}
        {n.semCusto && <span className="ml-1.5 rounded-full bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-warn">sem custo</span>}
        <div className="num text-[12px] text-text-muted">
          {fmtQtd(n.quantidade)} {un}
          {n.temFicha
            ? <> · pela ficha {n.custoUnitarioFicha != null ? formatCustoUnit(n.custoUnitarioFicha) : '-'} · custo médio hoje {n.custoUnitarioCmc != null ? formatCustoUnit(n.custoUnitarioCmc) : '-'}</>
            : <> × {n.custoUnitarioCmc != null ? formatCustoUnit(n.custoUnitarioCmc) : '-'}</>}
        </div>
      </div>
      <div className="num text-[13px] font-medium text-text">{fmtBRL(n.custo)}</div>
    </div>
  )
  if (!n.filhos.length) return <li className="border-t border-border/60">{conteudo}</li>
  return (
    <li className="border-t border-border/60">
      <details open>
        <summary className="cursor-pointer list-none">{conteudo}</summary>
        <ul>{n.filhos.map((f, k) => <Linha key={`${f.codigo}-${k}`} n={f} nivel={nivel + 1} info={info} />)}</ul>
      </details>
    </li>
  )
}

export function ArvoreCustoFicha({ arvore, unidade, info, custoMedio }: { arvore: ArvoreCusto; unidade: string; info: Map<number, Info>; custoMedio: number | null }) {
  return (
    <section aria-label="Custo pela ficha" className="rounded-[var(--r-lg)] bg-surface p-5 u-card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">Custo pela ficha, aberto até o insumo <span className="text-[13px] font-normal text-text-muted">(ficha v{arvore.versao ?? '-'}, por 1 {unidade})</span></h2>
        <div className="num text-[15px] font-semibold text-text">{fmtBRL(arvore.total)}{custoMedio != null && <span className="ml-2 text-[12px] font-normal text-text-muted">custo médio hoje {formatCustoUnit(custoMedio)}</span>}</div>
      </div>
      {arvore.semCusto > 0 && <p className="mb-1 text-[12px] text-warn">{arvore.semCusto} insumo(s) sem custo médio: entram como R$ 0.</p>}
      {arvore.ciclo && <p className="mb-1 text-[12px] text-err">Há uma receita circular gravada: um pré-preparo usa este produto. Corrija a ficha.</p>}
      <ul>{arvore.filhos.map((f, k) => <Linha key={`${f.codigo}-${k}`} n={f} nivel={0} info={info} />)}</ul>
      <p className="mt-2 text-[12px] text-text-muted">Pré-preparo vale o que a ficha dele dá com o custo médio de hoje dos insumos; ao lado, o custo médio dele (o que custou nas ordens de produção). Na venda, o pré-preparo sai do estoque dele, salvo quando a ficha dele abre na venda.</p>
    </section>
  )
}
