import { ListaCozinha, type SpCozinha } from '@/components/custo-cardapio/ListaCozinha'

export default async function PratosPage({ searchParams }: { searchParams: Promise<SpCozinha> }) {
  return <ListaCozinha sp={await searchParams} tipo="prato" />
}
