import { redirect } from 'next/navigation'

// A Saúde do estoque virou a Central de correções (14/10/2026). Links antigos continuam funcionando.
export default function SaudeEstoquePage() {
  redirect('/estoque/correcoes')
}
