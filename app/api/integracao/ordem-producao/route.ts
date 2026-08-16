import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { incluirOrdemProducao, concluirOrdemProducao, fetchOrdemProducao } from '@/lib/omie/ordem-producao'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

// Rota externa (nao-sessao) pro ntb-vendas disparar Ordem de Producao ao concluir
// uma venda. Autenticada por API key por loja (lojas.integracao_api_key, migration
// 061), diferente do resto do sistema que e Server Action presa a sessao logada.
// ATENCAO: escreve de verdade no Omie da loja. Cria E conclui a OP na hora (o
// lojista nao acompanha OP aberta pra esse fluxo — a venda ja aconteceu).

interface ItemPedido {
  codigo: string
  quantidade: number
}

interface ResultadoItem {
  codigo: string
  ok: boolean
  nCodOP?: number
  erro?: string
}

// O servidor (Vercel) roda em UTC, nao em horario de Brasilia -- perto da
// meia-noite UTC (~21h em Brasilia) `new Date()` local ja seria "amanha" pro
// Omie, que valida dDtConclusao contra o PROPRIO relogio (America/Sao_Paulo).
// Bug real encontrado em producao: OP criada com data de amanha, conclusao
// rejeitada ("data de conclusao nao pode ser maior que hoje"), OP ficava
// pendente e sumia dos filtros de "hoje". Forcar o timezone explicitamente.
function hojeBR(): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date())
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')}`
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { itens?: ItemPedido[]; pedidoRef?: string; ambiente?: 'homologacao' | 'producao' | null } | null
  if (!body?.itens?.length) {
    return NextResponse.json({ error: 'Informe itens: [{ codigo, quantidade }]' }, { status: 400 })
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

  const dData = hojeBR()
  const resultados: ResultadoItem[] = []

  // Sequencial (nao Promise.all): evita "consumo redundante" do Omie por chamadas
  // concorrentes na mesma conta.
  for (let i = 0; i < body.itens.length; i++) {
    const item = body.itens[i]
    if (!item?.codigo || !item.quantidade || item.quantidade <= 0) {
      resultados.push({ codigo: item?.codigo ?? '?', ok: false, erro: 'Item inválido' })
      continue
    }

    const { data: produto } = await supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', loja.id)
      .eq('codigo', item.codigo)
      .maybeSingle<{ codigo_produto: number }>()

    if (!produto) {
      resultados.push({ codigo: item.codigo, ok: false, erro: 'Produto sem cadastro correspondente no ntb-estoque' })
      continue
    }

    const cCodIntOP = `NTBV${Date.now()}${i}`.slice(0, 20)

    // Ambiente vem do store_fiscal_config do PRÓPRIO ntb-vendas (2026-08-16,
    // pedido explícito do usuário) — grava junto na observação, em formato
    // fixo `[Homologação]`/`[Produção]` no final, pra a tela de Ordem de
    // Produção conseguir detectar/filtrar. Declarado fora do try (não só dentro)
    // porque o `finally` abaixo também precisa dele pra loja de teste.
    const sufixoAmbiente = body.ambiente === 'homologacao' ? ' [Homologação]' : body.ambiente === 'producao' ? ' [Produção]' : ''
    const obs = (body.pedidoRef ? `Venda ntb-vendas #${body.pedidoRef}` : 'Venda ntb-vendas') + sufixoAmbiente

    let nCodOP: number | undefined
    let cNumOP: string | undefined
    try {
      const criada = await incluirOrdemProducao(loja, {
        cCodIntOP,
        nCodProduto: produto.codigo_produto,
        dData,
        nQtde: item.quantidade,
        obs,
      })
      cNumOP = criada?.cNumOP

      nCodOP = criada?.nCodOP
      if (!nCodOP) {
        resultados.push({ codigo: item.codigo, ok: false, erro: 'Omie não retornou a OP criada' })
        continue
      }

      await concluirOrdemProducao(loja, nCodOP, dData, item.quantidade, 'Concluída automaticamente (venda ntb-vendas)')

      await logIntegrationAttempt({
        loja_id: loja.id,
        model: 'OrdemProducao',
        request: `integracao/ordem-producao codigo=${item.codigo} qtde=${item.quantidade}`,
        response: `nCodOP=${nCodOP}`,
        code: String(nCodOP),
      })

      resultados.push({ codigo: item.codigo, ok: true, nCodOP })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
      await logIntegrationAttempt({
        loja_id: loja.id,
        model: 'OrdemProducao',
        request: `integracao/ordem-producao codigo=${item.codigo} qtde=${item.quantidade}`,
        error: true,
        // nCodOP presente aqui = a OP foi CRIADA mas a conclusao falhou (fica
        // pendente no Omie, precisa concluir manualmente ou reprocessar) --
        // diferente de falha na criacao, onde nenhuma OP chega a existir.
        error_message: nCodOP ? `[OP ${nCodOP} criada, conclusão falhou] ${msg}` : msg,
      })
      resultados.push({ codigo: item.codigo, ok: false, nCodOP, erro: msg })
    } finally {
      // Reflete o estado real (concluida ou nao) no banco local do ntb-estoque
      // mesmo quando a conclusao falha, pra a OP nao ficar invisivel na tela.
      if (nCodOP) {
        if (loja.is_test) {
          // Achado real (2026-08-16, "não sei se tá criando ordem de produção,
          // não sei o que tá acontecendo" — o usuário estava certo): pra loja
          // de teste a escrita é sempre SIMULADA (nunca existiu de verdade no
          // Omie), então fetchOrdemProducao (que reconsulta o Omie REAL) nunca
          // encontra nada e a linha local nunca era criada — a OP "existia" só
          // na resposta HTTP, invisível em qualquer tela. Grava direto com o
          // que já se sabe, sem depender de reconsulta nenhuma.
          const [dd, mm, yyyy] = dData.split('/')
          const hojeISO = `${yyyy}-${mm}-${dd}`
          await supabase
            .from('ordens_producao')
            .upsert(
              {
                loja_id: loja.id,
                identificacao_n_cod_op: nCodOP,
                identificacao_c_cod_int_op: cCodIntOP,
                // varchar(15) no banco — cNumOP simulado da Omie normalmente já
                // vem curto, mas o fallback (nCodOP em texto) precisa do slice
                // pra nunca estourar (achado real: cCodIntOP de 20 chars aqui
                // deu "value too long for type character varying(15)").
                identificacao_c_num_op: (cNumOP ?? String(nCodOP)).slice(0, 15),
                identificacao_n_cod_produto: produto.codigo_produto,
                identificacao_n_qtde: item.quantidade,
                identificacao_d_dt_previsao: hojeISO,
                observacao: obs,
                concluida: true,
                dt_conclusao_real: hojeISO,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'loja_id,identificacao_n_cod_op' }
            )
            .then(({ error }) => {
              if (error) console.error('integracao/ordem-producao: falha ao gravar OP simulada local:', error.message)
            })
        } else {
          await fetchOrdemProducao(loja, nCodOP).catch(() => {})
        }
      }
    }
  }

  return NextResponse.json({ lojaId: loja.id, resultados })
}
