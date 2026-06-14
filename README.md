<div align="center">

# NTB Estoque

**Sistema de gestão de estoque multi-loja, integrado ao Omie em tempo real.**

Controle de produtos, notas fiscais, ordens de produção, inventários e transferências
para uma rede de 6 unidades — com sincronização automática, etiquetas com QR Code e
painel operacional que avisa o que precisa de atenção.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel)](https://vercel.com/)
[![Omie](https://img.shields.io/badge/Integra%C3%A7%C3%A3o-Omie-2EB5C3)](https://omie.com.br/)

</div>

---

## ✨ O que ele faz

| Módulo | Descrição |
|---|---|
| **Dashboard** | Painel "Precisa de atenção": validade vencendo, erros de sync, inventários abertos — tudo acionável. |
| **Notas Fiscais** | Recebimentos do Omie, seleção de itens e impressão de **etiquetas com QR Code** (individual ou em lote). |
| **Ordens de Produção** | Validade e quantidade por etiqueta, impressão, conclusão. |
| **Inventários** | Contagem por local de estoque, **leitura por QR Code via câmera**, ajuste real no Omie ao finalizar. |
| **Transferências** | Entre locais, com contagem e ajuste no Omie. |
| **Produtos / Locais** | Catálogo sincronizado, filtros por família e tipo, status de sincronização. |
| **Validade** | Produtos que vencem em 3 / 7 / 15 / 30 dias, com destaque por urgência. |
| **Saúde da integração** | Estado de sync das 6 lojas + erros com botão de reprocessar. |
| **Relatórios** | PDF de notas, ordens, transferências e folhas de contagem; exportação CSV. |
| **Administração** | Lojas, usuários e permissões granulares por loja e por local de estoque. |

Recursos transversais: **busca global** (atalho `/`), **modo escuro**, **paginação**,
**responsivo de verdade** (tabela no desktop, cards no celular) e **histórico de impressão**.

---

## 🔄 Sincronização automática (sem clicar)

O sistema fica atualizado sozinho, em **duas camadas**:

1. **Webhook do Omie** — tempo real. Cada nota, ordem ou local de estoque que muda no Omie
   é refletido em segundos. Configurado na URL `/api/webhook` de cada loja.
2. **GitHub Actions** — rede de segurança a cada 10 minutos (`.github/workflows/sync-omie.yml`),
   contornando o limite do cron gratuito do Vercel.

Detalhes em [`docs/sync-automatico.md`](docs/sync-automatico.md).

---

## 🧱 Stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts` para auth)
- **Supabase** — PostgreSQL + Auth + RLS multi-tenant por `loja_id`
- **Base UI** + Tailwind v4 com design tokens (claro/escuro)
- **@react-pdf/renderer** + `qrcode` para etiquetas e relatórios
- **html5-qrcode** para leitura por câmera
- **Vercel** (deploy) · **GitHub Actions** (cron de sync)

---

## 🗂️ Estrutura

```
app/
  (app)/              páginas autenticadas (nota-fiscal, inventario, produto, ...)
  (auth)/login        tela de login
  api/                webhook, cron de sync, sync manual
components/
  ui-kit/             design system (Lista, DataTable, StatCard, Filtros, ...)
  shell/              app-shell responsivo (Sidebar, MobileNav, busca global, tema)
  etiqueta/           geração da etiqueta PDF com QR
  relatorio/          PDFs de relatório
lib/
  omie/               integração com a API do Omie (sync de cada recurso)
  actions/            server actions
  auth.ts             sessão, perfil, permissões por loja
supabase/migrations/  schema e seeds
docs/                 documentação e planos de implementação
```

---

## 🚀 Rodando localmente

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de produção
```

### Variáveis de ambiente (`.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # bypassa RLS (uso server-side)
SUPABASE_DB_URL=postgresql://...     # migrations
CRON_SECRET=...                      # protege as rotas /api/cron
```

> As chaves do Omie de cada loja ficam na tabela `lojas` (não em variáveis de ambiente).

---

## 🔌 Integração Omie

Cada loja é uma conta Omie independente. O sistema consome (leitura):

- `ListarProdutos`, `ListarLocaisEstoque`, `ListarOrdemProducao`, `ListarRecebimentos`,
  `ListarPosEstoque` (CMC / saldo)

E **escreve** apenas ajustes de estoque ao finalizar inventário/transferência
(`IncluirAjusteEstoque` / `ExcluirAjusteEstoque`).

A mesma chave também expõe **vendas, clientes e financeiro** (contas a pagar/receber,
movimentos) — base para futuros painéis de BI (margem, curva ABC, fluxo de caixa).

---

## 🔐 Segurança

- Autenticação via Supabase Auth; rotas protegidas por `proxy.ts`.
- **Multi-tenant:** cada usuário só vê as lojas vinculadas (`loja_user`); permissões
  granulares por loja e por local de estoque.
- RLS no banco; `service_role` apenas em código server-side.
- Escritas no Omie são auditadas e nunca disparadas em testes automáticos.

---

<div align="center">
<sub>Construído por <b>Triforce Auto</b> para a Norte Para Negócios.</sub>
</div>
