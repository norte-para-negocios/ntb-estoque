import { redirect } from 'next/navigation'

// A auditoria virou uma categoria do Resumo do dia (escopada pela loja do
// usuário). Mantemos esta rota só como redirect para não quebrar links antigos.
export default function AuditoriaRedirect() {
  redirect('/resumo?cat=auditoria')
}
