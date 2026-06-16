-- Auditoria de cobertura do sync (Bloco 1.3): campos relevantes do full_object
-- que nao tinham coluna propria. Backfill a partir do proprio full_object (ja
-- persistido), sem chamar o Omie.

-- Ordem de producao: conclusao REAL vem de outrasInf.cConcluida/dConclusao.
-- A coluna adicionais_d_dt_conclusao e a data PLANEJADA (infAdicionais) e pode
-- estar preenchida numa OP nao concluida (4 casos hoje) -> falso positivo no
-- filtro de "concluida" (bug 3.3). Estas colunas dao o sinal correto.
alter table ordens_producao add column if not exists concluida boolean;
alter table ordens_producao add column if not exists dt_conclusao_real date;
alter table ordens_producao add column if not exists dt_inclusao date;

update ordens_producao set
  concluida = (full_object->'outrasInf'->>'cConcluida') = 'S',
  dt_conclusao_real = case
    when coalesce(full_object->'outrasInf'->>'dConclusao','') <> ''
    then to_date(full_object->'outrasInf'->>'dConclusao', 'DD/MM/YYYY') end,
  dt_inclusao = case
    when coalesce(full_object->'outrasInf'->>'dInclusao','') <> ''
    then to_date(full_object->'outrasInf'->>'dInclusao', 'DD/MM/YYYY') end
where full_object is not null;

-- Produtos: status e identificacao fiscal basica (cfop/marca vem vazios do
-- cadastro, entao ficam de fora). inativo destrava filtrar so produtos ativos.
alter table produtos add column if not exists inativo boolean default false;
alter table produtos add column if not exists bloqueado boolean default false;
alter table produtos add column if not exists ncm varchar(20);
alter table produtos add column if not exists ean varchar(20);

update produtos set
  inativo = (full_object->>'inativo') = 'S',
  bloqueado = (full_object->>'bloqueado') = 'S',
  ncm = nullif(full_object->>'ncm', ''),
  ean = nullif(full_object->>'ean', '')
where full_object is not null;
