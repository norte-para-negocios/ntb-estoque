import { redirect } from 'next/navigation'

// A produção do estoque próprio vive na tela de Ordens de Produção (criar OP, concluir, reverter, histórico e custo).
// Esta rota antiga só redireciona.
export default function ProducaoPropriaRedirect() {
  redirect('/ordem-producao')
}
