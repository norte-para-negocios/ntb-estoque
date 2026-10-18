-- Teste do custo médio com saldo negativo em registrar_movimento (migration 174). Cópia local, nunca em produção.
-- Regra do Omie (omie-rea/regras/estoque-saldo-e-custo.md E9/E10, provada em 18.311 entradas reais da loja 5):
--   entrada: CMC = (S0·C0 + q·custo) / (S0 + q) mesmo com S0 < 0; volta ao custo da entrada só se S0 + q = 0 ou o
--   resultado for ≤ 0. (A versão da 132 voltava ao custo da entrada sempre que S0 ≤ 0.)
do $$
declare r jsonb;
begin
  -- Produto 1 (caso real Omie, produto 2453991940 em 29/09): S0 = −2,76868 a 16,715783; entra 3 a 14,813333 → ponderado
  -- daria −7,957 (≤ 0) → custo da entrada.
  perform registrar_movimento(15, 1, 1, 'ENT', 'T', 'p1a', 1, 16.715783);
  perform registrar_movimento(15, 1, 1, 'SAI', 'T', 'p1b', 3.76868);
  r := registrar_movimento(15, 1, 1, 'ENT', 'T', 'p1c', 3, 14.813333);
  if (r->>'cmc')::numeric <> 14.813333 then raise exception 'produto 1: esperava 14.813333, veio %', r->>'cmc'; end if;

  -- Produto 2: S0 = −1 a 10; entra 4 a 20 → Omie pondera: (−10 + 80) / 3 = 23,333333 (a 132 dava 20).
  perform registrar_movimento(15, 1, 2, 'ENT', 'T', 'p2a', 1, 10);
  perform registrar_movimento(15, 1, 2, 'SAI', 'T', 'p2b', 2);
  r := registrar_movimento(15, 1, 2, 'ENT', 'T', 'p2c', 4, 20);
  if (r->>'cmc')::numeric <> 23.333333 then raise exception 'produto 2: esperava 23.333333, veio %', r->>'cmc'; end if;

  -- Produto 3: S0 = −2; entra 2 a 5 → saldo fica 0 (divisão por zero) → custo da entrada.
  perform registrar_movimento(15, 1, 3, 'ENT', 'T', 'p3a', 1, 9);
  perform registrar_movimento(15, 1, 3, 'SAI', 'T', 'p3b', 3);
  r := registrar_movimento(15, 1, 3, 'ENT', 'T', 'p3c', 2, 5);
  if (r->>'cmc')::numeric <> 5 then raise exception 'produto 3: esperava 5, veio %', r->>'cmc'; end if;

  -- Produto 4 (saldo positivo, igual antes): 10 a 2 + 10 a 4 → 3.
  perform registrar_movimento(15, 1, 4, 'ENT', 'T', 'p4a', 10, 2);
  r := registrar_movimento(15, 1, 4, 'ENT', 'T', 'p4b', 10, 4);
  if (r->>'cmc')::numeric <> 3 then raise exception 'produto 4: esperava 3, veio %', r->>'cmc'; end if;

  raise notice 'registrar_movimento (saldo negativo) OK';
end $$;
