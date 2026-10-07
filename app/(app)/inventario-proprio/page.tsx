import { redirect } from 'next/navigation'

// As contagens do estoque próprio agora acontecem na própria tela de Inventários (mesmos campos, mais opções).
export default function InventarioProprioRedirect() {
  redirect('/inventario')
}
