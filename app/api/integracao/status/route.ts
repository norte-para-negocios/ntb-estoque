import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Status da loja ligada ao Norte Vendas (04/10/2026, auditoria de integração): o Vendas usa pra mostrar
// "Conectado" só quando a chave responde de verdade e pra avisar "MODO TESTE: nada vai para o Omie real".
// Só leitura: não cria nada e NÃO chama o Omie. Nunca devolve chave (nem app_key/secret do Omie), só se existem.
// Mesma autenticação das outras rotas de integração (lojas.integracao_api_key).
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, nome, is_test, omie_app_key, omie_app_secret')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number; nome: string | null; is_test: boolean; omie_app_key: string | null; omie_app_secret: string | null }>()
  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  return NextResponse.json({
    nome: loja.nome,
    // Loja de teste: toda escrita no Omie é simulada (lib/omie/client.ts, ehChamadaDeEscrita).
    simulada: !!loja.is_test,
    // Loja real com chave do Omie de verdade (sem chave, a baixa não tem para onde ir).
    omieReal: !loja.is_test && !!loja.omie_app_key && !!loja.omie_app_secret,
    versao: 2,
  })
}
