import { redirect } from 'next/navigation'

export default async function FichaTecnicaProdutoRedirect({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  redirect(`/produto?q=${encodeURIComponent(codigo)}`)
}
