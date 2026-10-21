import { exigirDev } from '@/lib/recursos-dev'

// Finanças (etapa 1): recurso novo, ainda só para desenvolvedores (lib/recursos-dev.ts). Cada página confere também
// loja de estoque próprio e permissão (lib/financeiro/dados.ts: acessoFinanceiro).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirDev()
  return children
}
