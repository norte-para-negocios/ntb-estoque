import { redirect } from 'next/navigation'

// A ficha técnica do estoque próprio é a "Estrutura" do produto (ícone de camadas na lista de Produtos): componentes, quantidade,
// fator de correção, perda, rendimento e sub-receita. Esta rota antiga só redireciona.
export default function FichaTecnicaRedirect() {
  redirect('/produto')
}
