import { getProfile, getPermissoesNomes } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { UserMenu } from '@/components/shell/UserMenu'
import { rotasPermitidas } from '@/lib/permissoes-menu'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { estadoPedidoCompraLoja } from '@/lib/compras/pedido-compra-loja'
import { gravacaoPedidosOmieLigada } from '@/lib/compras/pedido-omie-gravar-puro'
import { leituraPedidosOmieLigada } from '@/lib/compras/pedidos-omie-puro'
import { ModoEstoqueProvider } from '@/components/estoque-proprio/ModoEstoque'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { carregarAcessos } from '@/lib/plataforma/assinaturas'
import { moduloDaRota } from '@/lib/plataforma/modulos-puro'
import { FaixaModulo } from '@/components/plataforma/FaixaModulo'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  const superAdmin = profile.is_super_admin === true
  // AdminLoja tambem gerencia usuarios (escopado a loja dele) -> ve a rota /usuario.
  const podeGerirUsuarios = isAdmin || profile.perfil === 'AdminLoja'

  const supabase = await createClient()

  // Fase 12 (velocidade): permissões, lojas do seletor e modo de estoque não dependem uns dos outros; em paralelo
  // (antes: 6 a 8 idas ao banco em série antes de a tela começar a aparecer).
  const lojasDoSeletor = async () => {
    let lojasQuery = supabase
      .from('lojas')
      .select('id, nome, nome_fantasia')
      .eq('ativo', true)
      .order('nome_fantasia')

    // Nao-admin so enxerga as lojas que tem em loja_user, e nunca ve lojas de teste.
    if (!isAdmin) {
      const { data: vinculos } = await supabase
        .from('loja_user')
        .select('loja_id')
        .eq('user_id', profile.id)
      const lojaIds = [
        ...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null)),
      ]
      lojasQuery = lojasQuery.eq('is_test', false).in('id', lojaIds.length ? lojaIds : [-1])
    }

    const { data } = await lojasQuery
    return data
  }

  const [permissoes, lojas, modoEstoque, { acessos }, cabecalhos] = await Promise.all([
    // Quais rotas do menu o usuario pode ver (4.2). Admin e super admin recebem null = todas.
    getPermissoesNomes(profile.current_loja_id),
    lojasDoSeletor(),
    // Itens soEstoqueProprio do menu: só para loja em modo estoque próprio.
    profile.current_loja_id != null ? modoDaLoja(profile.current_loja_id) : Promise.resolve(null),
    // Plataforma Norte: acesso da loja a cada módulo (falha aberta: erro de leitura = padrões, menu como hoje).
    carregarAcessos(),
    headers(),
  ])
  // Tela de um módulo que a loja não tem (vitrine): vai para a página do módulo. Rota livre (null) nunca é bloqueada.
  // Sem o cabeçalho (rota que o proxy não marcou): não decide módulo, senão '' vira 'erp' e pode redirecionar em loop.
  const rotaAtual = cabecalhos.get('x-ntb-rota')
  const moduloAtual = rotaAtual ? moduloDaRota(rotaAtual) : null
  if (moduloAtual && acessos[moduloAtual] === 'vitrine') redirect('/modulos/' + moduloAtual)
  const rotasVisiveis = isAdmin || superAdmin ? null : Array.from(rotasPermitidas(permissoes))
  const estoqueProprio = modoEstoque === 'proprio'
  // Tela de Estoque vale para loja propria e para loja Omie (espelho); some so em 'nenhum'.
  const temEstoque = modoEstoque === 'proprio' || modoEstoque === 'omie'
  // C1: "Pedidos de compra" também na loja Omie liberada (ou com a leitura dos pedidos do Omie ligada). Variáveis
  // desligadas = nenhuma consulta a mais e o menu de antes.
  const pedidosOmie = modoEstoque === 'omie' && profile.current_loja_id != null
    && (gravacaoPedidosOmieLigada(process.env) || leituraPedidosOmieLigada(process.env))
    && await estadoPedidoCompraLoja(profile.current_loja_id).then((e) => e.onde === 'omie' || e.lerOmie)

  return (
    <AppShell
      isAdmin={isAdmin}
      isSuperAdmin={superAdmin}
      podeGerirUsuarios={podeGerirUsuarios}
      rotasVisiveis={rotasVisiveis}
      estoqueProprio={estoqueProprio}
      temEstoque={temEstoque}
      pedidosOmie={pedidosOmie}
      pacioli={acessos.pacioli === 'abre'}
      modulos={acessos}
      centralUserId={superAdmin ? profile.id : undefined}
      lojaSelector={<LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />}
      userMenu={<UserMenu nome={profile.name} perfil={profile.perfil} />}
    >
      <FaixaModulo acessos={acessos} />
      <ModoEstoqueProvider proprio={estoqueProprio}>{children}</ModoEstoqueProvider>
    </AppShell>
  )
}
