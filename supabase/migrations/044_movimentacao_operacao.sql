-- Movimentação por OPERAÇÃO (origem) × local × tipo SPED × família × mês, em R$ e
-- quantidade. Vem da aba "BD" do export MOV_DRV do Omie (tabela fato, ~935k linhas
-- por semestre) — é a ÚNICA fonte que traz a operação (Compra, Movimento Manual,
-- Consumo/Entrada da OP, PDV...) e o local de estoque por movimento. A API
-- ListarMovimentos só devolve entradas/saídas agregadas, sem operação nem local.
--
-- Como a BD é gigante (160MB), o import é por SCRIPT local (scripts/importar-mov-bd.mjs),
-- que faz streaming da aba e grava só os AGREGADOS aqui (alguns milhares de linhas).
--
-- ATENÇÃO ao valor: o "Valor Total do Movimento" do Omie é confiável para Compra,
-- Movimento Manual, Entrada/Consumo da OP e Nota de Entrada; mas é LIXO para o PDV
-- na saída (CMC podre de produto acabado dá valores astronômicos). A tela trata o
-- PDV em quantidade e sinaliza o valor como não-confiável.

create table if not exists movimentacao_operacao (
  loja_id   bigint not null references lojas(id) on delete cascade,
  origem    text   not null,   -- "Compra de Produto", "Movimento Manual de Estoque", "Consumo da Ordem de Produção"...
  sentido   text   not null check (sentido in ('E', 'S')), -- E=entrada (2.Entrada), S=saída (3.Saída)
  local     text   not null,   -- Local de Estoque (Descrição)
  tipo_sped text   not null,   -- "00-Mercadoria para Revenda", ...
  familia   text   not null,   -- Família de Produto
  mes       text   not null,   -- 'YYYY-MM'
  inventario boolean not null default false, -- saída manual por "Ajuste por Inventário" (separa perda real de ajuste)
  qtde      numeric not null default 0,
  valor     numeric not null default 0,      -- módulo (positivo); valor do PDV-saída é não-confiável
  primary key (loja_id, origem, sentido, local, tipo_sped, familia, mes, inventario)
);

create index if not exists idx_mov_oper_loja on movimentacao_operacao (loja_id);

create table if not exists movimentacao_operacao_meta (
  loja_id      bigint primary key references lojas(id) on delete cascade,
  importado_em timestamptz not null default now(),
  importado_por uuid,
  linhas       int not null default 0,   -- linhas de movimento lidas da BD
  arquivo      text
);

alter table movimentacao_operacao enable row level security;
create policy "movimentacao_operacao_select_por_loja"
  on movimentacao_operacao for select
  using (exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao.loja_id and lu.user_id = auth.uid()));

alter table movimentacao_operacao_meta enable row level security;
create policy "movimentacao_operacao_meta_select_por_loja"
  on movimentacao_operacao_meta for select
  using (exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao_meta.loja_id and lu.user_id = auth.uid()));
