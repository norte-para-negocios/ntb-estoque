# NTB Estoque - Exploração da API Omie + Paridade com o Laravel

> Levantamento read-only (2026-06-13). Nada foi alterado no Omie nem no banco.

## 1. Paridade: sistema novo (Next.js) vs antigo (Laravel)

Cobertura atual estimada: **~70%**. O núcleo operacional está completo (listar, contar,
sincronizar, etiquetas, ajustes de inventário/transferência, webhook, logs, admin).

### Gaps a portar (priorizados)

**Alta (core de negócio):**
1. Duplicar inventário (`InventarioController::duplicar`)
2. Duplicar transferência (`TransfersController::duplicar`)
3. Force-sync de inventário (reprocessar item a item) (`inventario.force-sync`)
4. Force-sync de transferência (`transfers.force-sync`)
5. Reprocessar transferência não enviada (`TransferenciaController::reprocess`)

**Alta (UX/segurança):**
6. Notificação em tempo real do fim de sync (Supabase Realtime no lugar do Laravel Echo)
7. Permissão granular por local de estoque (hoje o novo concede todas as permissões da loja)

**Média:**
8. Force-sync da loja inteira (`loja.sync.force`)
9. `editQuantidade` (excluir ajuste anterior no Omie + recriar) vs `setQuantidade` (hoje o novo só seta)
10. Relatórios PDF/CSV/Excel dedicados de NF e OP
11. Circuit breaker (proteção quando o Omie cai)

## 2. O que a API do Omie expõe (read-only, validado ao vivo com a chave da loja Brotas)

As chaves das 6 lojas têm escopo de leitura para MUITO além do estoque:

| Recurso | Endpoint / call | Volume (loja Brotas) |
|---|---|---|
| Pedidos de venda | `v1/produtos/pedido` / `ListarPedidos` | itens com produto, impostos, total |
| Clientes | `v1/geral/clientes` / `ListarClientes` | 5.243 |
| Contas a pagar | `v1/financas/contapagar` / `ListarContasPagar` | 28.077 |
| Contas a receber | `v1/financas/contareceber` / `ListarContasReceber` | 171.010 |
| Movimentos financeiros | `v1/financas/mf` / `ListarMovimentos` | 475.490 |
| Categorias | `v1/geral/categorias` / `ListarCategorias` | 197 |
| Departamentos | `v1/geral/departamentos` / `ListarDepartamentos` | 4 |
| NFes emitidas | `v1/produtos/nfconsultar` / `ListarNF` | 8.604 |
| Posição/CMC de estoque | `v1/estoque/consulta` / `ListarPosEstoque` | já em uso |

### Oportunidades alinhadas ao que o fundador pediu na reunião

- **Custo médio, margem, preço sugerido, CMV:** já temos o CMC via posição de estoque +
  valor de venda do produto. Dá pra montar uma tela de produtos com custo, margem real e
  sugestão de preço sem nova integração.
- **Análise de vendas:** `ListarPedidos` traz produto + valores + impostos. Permite
  curva ABC, giro de estoque, produtos mais vendidos, ticket médio.
- **Painel financeiro:** contas a pagar/receber + movimentos permitem fluxo de caixa,
  inadimplência, DRE simplificado. (Foi o que o Ramon citou como "substituir o Ome".)
- **Tudo é leitura:** podemos construir dashboards de BI sem risco de escrever no Omie.

### Observações

- Escopo confirmado: a chave de app de cada loja já libera vendas, financeiro e clientes.
- Esses dados NÃO precisam ser todos espelhados no Supabase. Para BI, dá pra consultar a
  API sob demanda (com cache) ou sincronizar só agregados.
