# Reconciliação Vercel/Supabase-cloud × Contabo — Design

**Data:** 2026-08-08
**Gatilho:** usuário reportou (com prints e áudios de WhatsApp) que o
mesmo inventário aparecia diferente em `app-estoque.norteparanegocios.com.br`
(Contabo) e `ntb-estoque.vercel.app` (Vercel). Investigado nesta sessão:
os dois sistemas ficaram ativos em paralelo desde 2026-07-31 ~16:39 UTC,
recebendo escrita real e independente de usuários reais.

## Causa raiz

O Contabo nasceu como réplica lógica do Supabase cloud (mesmo banco de
auth). Quando o Contabo virou "principal" em 31/07, o Vercel nunca foi
desativado — e como a mesma senha funciona nos dois sistemas sem erro
nenhum, 4 usuários com conta anterior a 31/07 (Andre, Carlos Marinho,
Renato Pinho, Ramon) continuaram logando em ambos, alternadamente,
gravando dado real nos dois bancos sem perceber.

## Escopo confirmado (com evidência real, ver investigação desta sessão)

| Tabela | Fork | Só cloud | Só Contabo | Colide ID? |
|---|---|---|---|---|
| `inventarios` | id=202 (31/07 16:39 UTC) | 26 | 20 | Sim |
| `inventario_items` | id=6283 | 346 (+398 colisões) | 203 (+398 colisões) | Sim, inclusive ranges de id se sobrepõem |
| `transferencias` | id=557 (01/08 18:43 UTC) | 59 | 91 (59 colisões + 32 exclusivas) | Sim, desde o primeiro registro pós-fork |
| `movimentos` manuais | — | 87 (reflexo dos inventários acima) | 0 | — |
| `ordens_producao` (app) | — | 27 | 56 | Não (chave real é da Omie); Omie "cura" a maioria via sync |
| `audit_log` | id=953 | 0 | 87 | 233 colisões |
| `profiles`/`loja_user` | — | 0 novos | 1 (Edson, loja 5, nunca existiu no cloud) | — |

Fora de escopo (checado, sem divergência relevante ou não é escrita de
usuário): `convites`, `produto_substituicoes`, `previsao_venda`
(cron/job automático), `impressao_etiquetas` (baixo risco, reimprimível).

## Achado crítico: estoque físico não está incorreto

Amostra de 13/46 inventários divergentes (57 itens com `id_ajuste`
não-nulo) cruzada direto contra `ListarAjusteEstoque` da Omie, filtrando
por `cod_int_ajuste = "ITEM${item.id}"`: **57/57 confirmados reais, com
quantidade batendo exato**. O ajuste físico já aconteceu corretamente nos
dois casos — o problema é só o registro estar espalhado em dois bancos
que não se falam. Achado à parte, fora de escopo desta reconciliação: 9
itens de inventário nunca geraram ajuste real na Omie por falta de CMC
válido (bug pré-existente, não causado por este incidente).

## Arquitetura da reconciliação

Ordem: `inventarios` → `inventario_items` → `transferencias`. Antes de
qualquer escrita: dump bruto (JSON, com timestamp) de tudo que é
divergente nos dois bancos, salvo fora dos dois sistemas, como rede de
segurança.

Para cada tabela: identificar registros que existem só no Supabase cloud
(sem correspondente real no Contabo, comparando conteúdo — não só id),
atribuir um ID NOVO acima do maior ID já existente no Contabo,
preservando data/hora/usuário/conteúdo original, e inserir no Contabo.
**Nunca UPDATE nem DELETE em nada que já existe no Contabo.** Tabelas
filhas (`inventario_items`) têm sua FK pro pai remapeada junto.

`transferencias` tem um caso adicional: o mesmo usuário (Carlos, Renato)
gravou nos dois bancos. Regra de deduplicação: mesma loja + produto +
quantidade + local origem/destino + data (tolerância de mesmo dia) =
mesmo evento duplicado → mantém só a cópia do Contabo, descarta a do
cloud, registra a duplicata no log de auditoria. Sem esse casamento = dois
eventos reais diferentes → os dois entram, remapeados.

## Verificação obrigatória antes de fechar como seguro

Estender o cruzamento contra a Omie (`ListarAjusteEstoque` +
`cod_int_ajuste`) dos 13/46 já testados pros 46 inventários completos.
Para `transferencias`, investigar durante a implementação se existe
rastro equivalente na Omie (transferência entre locais também deveria
gerar ajuste) — se existir, mesmo padrão de verificação; se não, a
verificação vira "os dois bancos concordam que o evento aconteceu",
documentado como limitação.

## Documentação

Novo doc versionado `docs/incidente-divergencia-vercel-contabo-2026-08-08.md`
com o incidente completo (causa raiz, escopo, cruzamento Omie, o que foi
reconciliado e como) — não só nos relatórios de `.superpowers/`
(gitignored).

## Fase separada (depois da reconciliação, fora deste plano)

Aposentar o Vercel/Supabase cloud de vez: desativar login (ou redirecionar
o domínio pro Contabo) e pausar o projeto Supabase cloud — só depois de
confirmar a reconciliação completa e auditada.

## Fora de escopo deste plano

- Os 9 itens de inventário sem ajuste real na Omie por falta de CMC (bug
  pré-existente).
- Metadado local de `ordens_producao` (ex. `concluida_por`,
  `observacao`) que não volta do sync da Omie — risco baixo, registrar
  como follow-up.
- Aposentar o Vercel/Supabase cloud em si (fase separada, ver acima).
