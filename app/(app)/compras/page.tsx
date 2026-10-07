import { redirect } from 'next/navigation'

// As compras agora fazem parte de Notas Fiscais (notas puxadas da SEFAZ + importar XML + lançar sem XML).
export default function ComprasPage() {
  redirect('/nota-fiscal')
}
