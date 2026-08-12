-- Fix da revisão final (2026-08-12): loja_origem_id (migration 117) foi
-- criada sem ação de ON DELETE -- excluir uma loja real
-- (lib/actions/loja.ts) falha com violação de FK enquanto a gêmea de
-- teste existir, com uma mensagem incompreensível pro usuário. Usa SET
-- NULL: a loja de teste continua existindo (dado de teste é
-- descartável, mas não precisa ser apagado em cascata), só perde a
-- referência de qual loja real ela espelhava.

alter table lojas drop constraint if exists lojas_loja_origem_id_fkey;
alter table lojas add constraint lojas_loja_origem_id_fkey
  foreign key (loja_origem_id) references lojas(id) on delete set null;
