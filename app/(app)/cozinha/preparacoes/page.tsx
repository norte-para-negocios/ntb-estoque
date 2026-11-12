import { ListaCozinha, type SpCozinha } from '@/components/custo-cardapio/ListaCozinha'

export default async function PreparacoesPage({ searchParams }: { searchParams: Promise<SpCozinha> }) {
  return <ListaCozinha sp={await searchParams} tipo="preparacao" />
}
