import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { planilhaCadastro, respostaModelo } from '@/lib/importacao/modelo'
import { familiasDaLoja, produtosExistentes } from '@/lib/importacao/existentes'
import { linhasExportProdutos } from '@/lib/importacao/exportar-puro'

export const dynamic = 'force-dynamic'

// Fase 6: o cadastro atual de produtos no MESMO formato da importação (editar a planilha e importar de volta). Só dev, só estoque próprio.
export async function GET() {
  if (!(await ehDesenvolvedor())) return new Response('Não encontrado', { status: 404 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Só no estoque próprio', { status: 400 })
  if (!(await requirePermissao(lojaId, 'Produtos - Importar planilha'))) return new Response('Sem permissão', { status: 403 })
  try {
    const [existentes, familias] = await Promise.all([produtosExistentes(lojaId), familiasDaLoja(lojaId)])
    const buf = await planilhaCadastro('produtos', linhasExportProdutos(existentes, familias))
    return respostaModelo('produtos', buf, `cadastro-produtos-${hojeBahiaISO()}.xlsx`)
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Falha ao ler o cadastro', { status: 500 })
  }
}
