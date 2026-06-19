# Fase 6 - Cadastros: Relatorio de Implementacao

**Data:** 2026-06-19
**Branch:** joaquim/mega-plano-18-06

---

## 6.1 Familia "travada" no select do produto

### Causa raiz

`buscarFamilias()` em `lib/actions/produto.ts` buscava familias da tabela `produtos`
(campos `codigo_familia` + `descricao_familia`), nao da tabela `familias`. Uma familia
recem-criada localmente (origem = 'local') ainda nao tem nenhum produto vinculado, portanto
nunca aparecia no resultado da query.

### O que mudou

- **`lib/actions/produto.ts`** - `buscarFamilias()` agora busca na tabela `familias`
  (inativo = false, loja_id = lojaId), ordenada por nome. Familias sem `codigo_familia`
  (criadas localmente, sem sincronizacao com Omie ainda) recebem codigo = -(id do banco)
  para servir como chave unica no select sem colidir com IDs reais do Omie (sempre positivos).

- **`components/produtos/FormNovoProduto.tsx`** - Guarda adicionada: `codigoFamiliaOmie`
  recebe `null` quando `fam.codigo < 0` (familia local sem ID Omie), evitando enviar
  codigo negativo ao Omie.

- **`components/produtos/EditarProdutoForm.tsx`** - Mesma guarda adicionada. O filtro
  `f.codigo > 0` foi removido do select para permitir selecionar familias locais
  (o codigo negativo so e usado como chave do select; nunca vai ao Omie).

---

## 6.2 Excluir Local de Estoque

### Implementacao

- **`lib/actions/local-estoque.ts`** - Nova action `excluirLocalEstoque(id)`: verifica
  permissao `Locais de Estoque - Excluir`, deleta o registro do banco filtrando por
  `id + loja_id`, chama `revalidatePath('/local-estoque')`.
  Nota: o Omie nao expoe API publica para excluir local de estoque; a exclusao e apenas
  no banco NTB. O proximo sync (upsert por `codigo_local_estoque`) vai recriar o registro
  caso o local ainda exista no Omie.

- **`components/local-estoque/ExcluirLocalEstoque.tsx`** - Componente client: botao
  com icone Trash2, `window.confirm` antes de excluir, toast de sucesso/erro, `router.refresh()`.

- **`app/(app)/local-estoque/page.tsx`** - Permissao `podeExcluir` adicionada,
  componente importado, prop `acao` adicionada na `Lista` mostrando o botao apenas
  para usuarios com permissao.

A permissao `Locais de Estoque - Excluir` ja existia no catalogo (`lib/permissoes-catalogo.ts`,
linha 100), portanto nao foi necessario adicionar migration.

---

## 6.3 Cron de Sync de Familias

### O que foi feito

- **`app/api/cron/sync-familias/route.ts`** - Criado seguindo o padrao exato de
  `sync-locais/route.ts`: `assertCronAuth`, `getLojasAtivas`, `Promise.allSettled`,
  chama `syncFamilias` de `lib/omie/familia.ts` (funcao ja existia).

- **`vercel.json`** - Adicionado `{ "path": "/api/cron/sync-familias", "schedule": "0 15 * * *" }`
  no horario 00:15 (entre sync-locais 00:00 e sync-produtos 00:30).

### Pendencias (sem executar agora)

- **Fornecedor**: existe `lib/actions/fornecedor.ts` e `lib/omie/cliente-fornecedor.ts`
  mas nao ha route handler `sync-fornecedores`. O padrao existe para criar, mas nao
  foi solicitado expressamente e nao havia bug reportado. Recomenda-se criar junto com
  o proximo bloco de cadastros.

---

## Migrations aplicadas

Nenhuma. A permissao `Locais de Estoque - Excluir` ja existia no banco (catalogo
`permissoes-catalogo.ts`, migration 018).

---

## Resultado do tsc

`npx tsc --noEmit` - passou sem erros (saida vazia = OK).

---

## Hashes dos commits

- `676c0f2` - fix(6.1): corrigir select de familias no cadastro de produto
- `0477a2a` - feat(6.3): cron diario de sync de familias do Omie
- `a57faaa` - docs: relatorio de implementacao da Fase 6

---

## Pendencias para validar com Ramon

1. **Familia local no Omie**: Familias criadas localmente (sem ID Omie) aparecem agora
   no select, mas ao criar/editar um produto com essa familia, o campo `codigoFamilia`
   vai como `null` ao Omie (o produto fica sem familia no Omie ate a familia local ser
   sincronizada via "Puxar do Omie" ou o cron nocturno). Confirmar se esse comportamento
   e aceitavel ou se Ramon quer bloquear a criacao de produto com familia local.

2. **Excluir local no Omie**: A exclusao remove so do banco NTB. Se o local ainda
   existir no Omie, o proximo sync vai recriar. Para exclusao permanente e necessario
   excluir no Omie tambem (nao ha endpoint documentado para isso na API Omie publica;
   confirmar com Ramon antes de implementar).
