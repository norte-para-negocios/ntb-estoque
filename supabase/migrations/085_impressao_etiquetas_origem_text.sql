-- 085_impressao_etiquetas_origem_text.sql
-- 084 alargou o CHECK constraint pra aceitar 'PRODUTO' (7 chars) mas a coluna
-- continuou varchar(2) -- todo insert com origem='PRODUTO' falhava (silencioso,
-- por causa do try/catch na rota que insere) com "value too long for type
-- character varying(2)". O CHECK constraint ja governa quais valores sao
-- validos, entao um limite de tamanho em cima disso e redundante e fragil
-- contra qualquer valor futuro -- troca pra text (sem limite arbitrario).
alter table impressao_etiquetas alter column origem type text;
