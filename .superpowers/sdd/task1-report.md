STATUS: DONE
COMMITS: (preencher após commit)
TSC: sem erros
MIGRATION_APLICADA: sim
PERMISSOES_NO_BANCO: Impressoes, Movimentacoes, Validade
MUDANCAS:
- supabase/migrations/027_permissoes_movimentacoes_validade_impressoes.sql: nova migration INSERT idempotente com as 3 permissoes
- lib/permissoes-catalogo.ts: 3 novos modulos (Movimentacoes, Validade, Impressoes) no grupo Operacao; MENU_PERMISSAO atualizado com as 3 rotas
- app/(app)/movimentacoes/page.tsx: requirePermissao trocado de 'Produtos' para 'Movimentacoes'
- app/(app)/validade/page.tsx: requirePermissao trocado de 'Ordens de Producao' para 'Validade'
- app/(app)/impressoes/page.tsx: requirePermissao trocado de 'Notas Fiscais' para 'Impressoes'; gating convertido de EmptyState para notFound() (padrao dos outros modulos); import notFound adicionado
