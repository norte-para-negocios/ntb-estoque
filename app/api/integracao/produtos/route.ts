import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { incluirProduto, syncProdutos } from '@/lib/omie/produto'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

// Rota externa (nao-sessao) pro ntb-vendas criar um produto aqui
// automaticamente ao cadastrar um produto novo no cardapio, com um clique so
// ("Criar no NTB Estoque tambem"). Mesma autenticacao (Bearer
// lojas.integracao_api_key) e mesmo espirito da rota de Ordem de Producao --
// ESCREVE de verdade no Omie da loja (cria o produto).
//
// Cadastro de produto unificado, Direcao 1 (ntb-vendas -> ntb-estoque),
// (2026-08-16, pedido explicito do usuario). A volta (ntb-estoque ->
// ntb-vendas, Direcao 2) fica em lib/actions/produto.ts
// (enviarProdutoParaNtbVendas), chamando ntb-vendas:/api/integracao/produtos.

interface RequestBody {
  nome?: string
  precoVenda?: number
  ncm?: string
  unidade?: string
}

// Gera um codigo (SKU) curto e ja' com prefixo reconhecivel -- so' precisa
// ser unico dentro da loja no Omie, nao precisa ser "bonito".
function gerarCodigo(): string {
  return 'NTBV-' + Date.now().toString(36).toUpperCase()
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as RequestBody | null
  if (!body?.nome?.trim() || !body.precoVenda || body.precoVenda <= 0) {
    return NextResponse.json({ error: 'Informe nome e precoVenda (> 0)' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()

  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  const codigo = gerarCodigo()
  // Fallback generico (21069090, "outras preparacoes alimenticias") quando o
  // ntb-vendas nao manda NCM -- mesmo criterio ja usado nesta sessao pro
  // backfill manual de NCM da Vieras e Vinhos. E' um ponto de partida
  // tecnico, o contador da loja deve revisar depois.
  const ncm = body.ncm?.trim() || '21069090'
  const unidade = body.unidade?.trim() || 'UN'

  try {
    const criado = await incluirProduto(loja, {
      codigo,
      descricao: body.nome.trim(),
      unidade,
      ncm,
      valorUnitario: body.precoVenda,
    })

    if (!criado?.codigo_produto) {
      return NextResponse.json({ error: 'Omie não retornou o produto criado' }, { status: 502 })
    }

    // Loja de teste: a escrita foi SIMULADA (nunca existiu de verdade no
    // Omie, ver ehChamadaDeEscrita em lib/omie/client.ts) -- syncProdutos
    // reconsulta o Omie REAL via ListarProdutos e nunca acharia esse
    // produto. Mesmo achado/fix já aplicado pra Ordem de Produção
    // (fetchOrdemProducao): grava direto com o que já se sabe, sem
    // depender de reconsulta nenhuma.
    if (loja.is_test) {
      await supabase
        .from('produtos')
        .upsert(
          {
            loja_id: loja.id,
            codigo_produto: criado.codigo_produto,
            codigo,
            descricao: body.nome.trim(),
            unidade,
            ncm,
            valor_unitario: body.precoVenda,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'loja_id,codigo_produto' }
        )
        .then(({ error }) => {
          if (error) console.error('integracao/produtos: falha ao gravar produto simulado local:', error.message)
        })
    } else {
      // Re-sincroniza pra o produto novo aparecer no banco local (mesmo padrao
      // ja usado em criarLocalEstoque) -- sem isso, uma Ordem de Producao pra
      // esse produto (via /api/integracao/ordem-producao) nao acharia ele na
      // tabela `produtos` local até o proximo cron.
      await syncProdutos(loja).catch(() => {})
    }

    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'Produto',
      request: `integracao/produtos codigo=${codigo} nome=${body.nome}`,
      response: `codigo_produto=${criado.codigo_produto}`,
      code: String(criado.codigo_produto),
    })

    return NextResponse.json({ ok: true, codigo, codigoProduto: criado.codigo_produto })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'Produto',
      request: `integracao/produtos codigo=${codigo} nome=${body.nome}`,
      error: true,
      error_message: msg,
    })
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
