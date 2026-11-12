import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChefHat, FileText, Layers } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { EstruturaProduto } from '@/components/produtos/EstruturaProduto'
import { exigirDev } from '@/lib/recursos-dev'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { PainelPrato } from '@/components/custo-cardapio/PainelPrato'
import { arvoreDoPrato, carregarBase, ehPreparacao, type NoTela } from '@/lib/custo-cardapio/carregar'
import { precoReal } from '@/lib/custo-cardapio/preco-puro'
import { carregarInfoReceita } from '@/lib/custo-cardapio/receita-info'
import { EditorPreparo } from '@/components/custo-cardapio/guia/EditorPreparo'

const contar = (nos: NoTela[]): number => nos.reduce((a, n) => a + (n.suspeito ? 1 : 0) + contar(n.filhos), 0)

export default async function CustoPratoPage({ params }: { params: Promise<{ codigo: string }> }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const codigo = Number((await params).codigo)
  if (!Number.isFinite(codigo)) notFound()
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  const podeEditar = await requirePermissao(lojaId, 'Produtos - Editar')
  if (!base) notFound()
  const produto = base.produtos.get(codigo)
  const arvore = arvoreDoPrato(base, codigo)
  const titulo = produto?.descricao ?? `Produto ${codigo}`
  const prep = ehPreparacao(produto)
  const voltar = prep ? '/cozinha/preparacoes' : '/cozinha/pratos'

  if (!arvore) {
    return (
      <div className="space-y-4">
        <PageHeader title={titulo} icon={ChefHat} voltarHref={voltar} />
        <EmptyState icon={Layers} title="Este produto não tem ficha técnica" hint="Monte a estrutura no cadastro do produto e o custo aparece aqui.">
          <Link href={`/produto?q=${encodeURIComponent(produto?.codigoTexto ?? String(codigo))}`} className={btnClass('primary')}>Abrir no cadastro</Link>
        </EmptyState>
      </div>
    )
  }

  const ficha = base.fichas.get(codigo)
  const info = await carregarInfoReceita(lojaId, codigo)
  const rend = ficha && 'rendimento' in ficha && ficha.rendimento !== 1 ? ` · rende ${ficha.rendimento.toLocaleString('pt-BR')} ${(produto?.unidade ?? '').toLowerCase()}` : ''
  return (
    <div className="space-y-4">
      <PageHeader title={titulo} icon={ChefHat} voltarHref={voltar}
        description={`${produto?.codigoTexto ?? codigo}${produto?.familia ? ` · ${produto.familia}` : ''}${prep ? ' · preparação' : ''}${rend}. Custo por 1 ${(produto?.unidade ?? 'unidade').toLowerCase()}.`}
        actions={<>
          <a href={`/cozinha/pratos/${codigo}/ficha`} className={btnClass('outline')}><FileText className="size-4" /> Ficha em PDF</a>
          <a href={`/cozinha/pratos/${codigo}/ficha?cozinha=1`} className={btnClass('outline')}>Para a cozinha</a>
          {/* Mesmo editor do cadastro de produto (Omie: grava a estrutura no Omie; próprio: nova versão da ficha). */}
          <EstruturaProduto codigoProduto={codigo} descricao={titulo} tipoItem={produto?.tipo ?? null} podeEditar={podeEditar} />
        </>} />
      {arvore.ciclo && <p className="rounded-[var(--r-md)] bg-err/10 px-3 py-2 text-[13px] text-err">A ficha tem um ciclo (uma preparação usa a si mesma). O custo pode estar errado.</p>}
      <PainelPrato itens={arvore.filhos} taxas={base.taxas} precoCadastro={prep || !precoReal(produto?.preco) ? null : produto!.preco} semCusto={arvore.semCusto} suspeitos={contar(arvore.filhos)} />
      <EditorPreparo codigo={codigo} nome={titulo} info={info && {
        modoPreparo: info.modoPreparo, observacoes: info.observacoes, tempoPreparoMin: info.tempoPreparoMin, rendimentoTexto: info.rendimentoTexto,
        fotoUrl: info.fotoUrl, atualizadoPor: info.atualizadoPor, atualizadoEm: info.atualizadoEm,
      }} />
    </div>
  )
}
