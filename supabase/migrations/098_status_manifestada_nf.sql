-- 098_status_manifestada_nf.sql
-- Pedido real do usuário (2026-07-31): a Omie manda um campo próprio de
-- recebimento/manifestação (full_object.infoCadastro.cRecebido, 'S'/'N'),
-- documentado no levantamento da API (docs/superpowers/specs/2026-06-26-
-- omie-varredura-spec.md) mas nunca usado em código -- achado confirmado
-- direto no dado real: c_etapa=40 sempre tem cRecebido='N' (231 notas),
-- c_etapa=60 quase sempre tem cRecebido='S' (10487 de 10491) -- os 2 nao
-- sao exatamente a mesma coisa, entao "Manifestada" vira uma opção própria
-- de status (ao lado de Concluída/Pendente/Cancelada), não um sinônimo de
-- Concluída.
create or replace function nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text)
returns boolean
language sql immutable as $$
  select case coalesce(p_status, 'CONCLUIDA')
    when 'TODAS' then true
    when 'CANCELADA' then coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') = 'S'
    when 'MANIFESTADA' then coalesce(p_full_object->'infoCadastro'->>'cRecebido', 'N') = 'S'
    when 'PENDENTE' then p_c_etapa <> '60' and coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    else p_c_etapa = '60' and coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
  end;
$$;
