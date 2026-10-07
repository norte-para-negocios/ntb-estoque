-- Famílias dos produtos da ODARA BEACH (Estoque, loja 15, modo próprio). Idempotente: pode rodar de novo.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < familias-odara.sql
begin;

-- 1) Garante as famílias (procura pelo nome, sem diferenciar maiúscula; id próprio na mesma faixa do driver).
insert into familias (loja_id, codigo_familia, nome, inativo, origem)
select 15, nextval('seq_id_produto_proprio'), f.nome, false, 'local'
  from (values ('Bebidas'), ('Drinks'), ('Insumos de bar'), ('Insumos de cozinha'), ('Pratos e petiscos')) as f(nome)
 where not exists (select 1 from familias x where x.loja_id = 15 and lower(x.nome) = lower(f.nome));

-- 2) Liga cada produto da semente de teste à família certa (pelo código, que é imutável).
with mapa(codigo, familia) as (values
  ('90001', 'Bebidas'), ('90002', 'Bebidas'), ('90003', 'Bebidas'), ('90004', 'Bebidas'),
  ('90005', 'Drinks'), ('90006', 'Drinks'),
  ('80001', 'Insumos de bar'), ('80002', 'Insumos de bar'), ('80003', 'Insumos de bar'), ('80004', 'Insumos de bar'), ('80005', 'Insumos de bar'),
  ('80006', 'Insumos de cozinha'), ('80007', 'Insumos de cozinha'), ('80008', 'Insumos de cozinha'), ('80009', 'Insumos de cozinha'),
  ('80010', 'Insumos de cozinha'), ('80011', 'Insumos de cozinha'), ('80012', 'Insumos de cozinha'), ('80013', 'Insumos de cozinha'),
  ('80014', 'Insumos de cozinha'), ('70001', 'Insumos de cozinha'),
  ('90007', 'Pratos e petiscos'), ('90008', 'Pratos e petiscos'), ('90009', 'Pratos e petiscos'), ('90010', 'Pratos e petiscos')
)
update produtos p
   set codigo_familia = f.codigo_familia
  from mapa m
  join familias f on f.loja_id = 15 and lower(f.nome) = lower(m.familia)
 where p.loja_id = 15 and p.codigo = m.codigo and p.codigo_familia is distinct from f.codigo_familia;

-- 3) Conferência
select f.nome, count(p.*) as produtos
  from familias f left join produtos p on p.loja_id = f.loja_id and p.codigo_familia = f.codigo_familia
 where f.loja_id = 15 group by f.nome order by f.nome;

commit;
