import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modeloPlanilha, respostaModelo } from '@/lib/importacao/modelo'

export async function GET() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Importar planilha'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  return respostaModelo('fornecedores', await modeloPlanilha('fornecedores'))
}
