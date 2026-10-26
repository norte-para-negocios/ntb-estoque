-- 297 — Categorias contábeis padrão para toda loja que ainda não tem nenhuma (a ODARA veio depois do seed da 069 e ficou com a lista vazia).
-- Só insere em loja SEM categoria: quem já personalizou a lista não ganha nome de volta. Idempotente (unique loja_id+nome).
insert into categorias_contabeis (loja_id, nome)
select l.id, c.nome
from lojas l
cross join (values
  ('Compra de mercadoria para revenda'),
  ('Matéria-prima'),
  ('Bebidas'),
  ('Embalagem'),
  ('Uso e consumo'),
  ('Material de escritório'),
  ('Serviços'),
  ('Ativo imobilizado')
) as c(nome)
where not exists (select 1 from categorias_contabeis x where x.loja_id = l.id)
on conflict (loja_id, nome) do nothing;
