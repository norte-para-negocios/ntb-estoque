#!/usr/bin/env python3
"""Moqueca e Ensopado da ODARA BEACH como PRODUTOS SEPARADOS, cada um com a estrutura LITERAL da Donana (Omie, lida só em
leitura em 07/10/2026: scripts/odara/donana-estruturas-2026-10-07.json + donana-moq-ens-2026-10-07.json).

Cada item do cardápio "Moqueca ou Ensopado de …" vira produto MÃE no Estoque (sem saldo, sem ficha) com duas VARIAÇÕES
(ex.: "Moqueca de Camarão (200g)" e "Ensopado de Camarão (200g)"), cada uma com o seu código 90xxx e a sua ficha.
No Vendas, o produto deixa de ter código próprio (estoque_pai_codigo = mãe) e a escolha obrigatória "Preparo" passa a ter
em cada opção o código da variação: a venda baixa SÓ a variação escolhida.
Também troca pelas estruturas literais da Donana: Pescada Posta Frita (90472), Vermelho Frito (90139), Gin Tônica (90609).

Uso: python3 moq-ens-odara.py > moq-ens-odara.sql (Estoque). Depois moq-ens-odara-vendas.sql (Vendas) é gerado com os
códigos criados (lidos do banco do Estoque pelo nome). Sempre dry-run com ROLLBACK antes.
"""
import json, os, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
DON = {}
for f in ('donana-estruturas-2026-10-07.json', 'donana-moq-ens-2026-10-07.json'):
    for v in json.load(open(os.path.join(AQUI, f))).values():
        DON[v['ident']['codProduto']] = v

FEIJAO = 'FEIJAO FRADINHO (PI)'
# item do cardápio, nome da variação (sem o preparo), Donana moqueca, Donana ensopado, feijão (moq, ens) da variante Fradinho
# da Donana (o cardápio da ODARA serve arroz/pirão/feijão/farofa), escala da proteína quando a gramatura difere.
ITENS = [
    ('Moqueca ou Ensopado de Camarão (200g)', 'de Camarão (200g)', '90853', '90856', None, None),
    ('Moqueca ou Ensopado de Camarão (400g)', 'de Camarão (400g)', '90950', '90206', None, None),
    ('Moqueca ou Ensopado de Pescada (500g)', 'de Pescada (500g)', '90162', '90202', ('90163', '90203'), None),
    ('Moqueca ou Ensopado de Pescada e Camarão', 'de Pescada e Camarão', '90491', '90495', ('90489', '90493'), None),
    ('Moqueca ou Ensopado de Filé de Pescada (500g)', 'de Filé de Pescada (500g)', '90174', '90214', ('90175', '90215'),
     ('FILE PESCADA 450 g (PI)', 500 / 450)),
    ('Moqueca ou Ensopado de Filé de Pescada e Camarão', 'de Filé de Pescada e Camarão', '90556', '90557', ('90554', '90559'), None),
    ('Moqueca ou Ensopado de Pescada Individual', 'de Pescada Individual', '90894', '90898', None, None),
]
# fichas trocadas pela estrutura literal da Donana (código ODARA -> código Donana)
LITERAIS = {'90047': '90472', '90036': '90139', '90065': '90609'}
NOVOS = [  # (nome, unidade, ncm, tipo, família, ficha [(insumo, qtd)]) — da Donana, idênticos
    ('GIN IMPORTADO (MP)', 'ML', '22085000', '01', 'Destilados', None),
    ('PEIXE PESCADA AMARELA 600 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário', [('PEIXE PESCADA AMARELA (MP)', 1.245902)]),
    ('FILE PESCADA 400 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário', [('FILE DE PESCADA - G (MP)', 0.56)]),
]
ANTIGOS = ['Preparo Moqueca - porção inteira (PI)', 'Preparo Moqueca - porção individual (PI)',
           'Preparo Ensopado - porção inteira (PI)', 'Preparo Ensopado - porção individual (PI)']


def lit(s): return "'" + str(s).replace("'", "''") + "'"


def estrutura(cod, feijao_de=None, escala=None):
    itens = [(i['descrProdMalha'], float(i['quantProdMalha'])) for i in DON[cod]['itens']]
    if escala:
        itens = [(n, round(q * escala[1], 6) if n == escala[0] else q) for n, q in itens]
    if feijao_de and not any(n == FEIJAO for n, _ in itens):
        fq = [float(i['quantProdMalha']) for i in DON[feijao_de]['itens'] if i['descrProdMalha'] == FEIJAO]
        itens.append((FEIJAO, fq[0]))
    return itens


def estoque_sql():
    o = ['-- GERADO por scripts/odara/moq-ens-odara.py. Banco postgres (Estoque), loja 15 (ODARA).', 'begin;',
         "select set_config('ntb.sync_skip', '1', true);"]
    w = o.append
    w("""create function pg_temp.fam(p_nome text) returns bigint language sql as $f$
  select codigo_familia from familias where loja_id = 15 and lower(nome) = lower(p_nome) order by inativo, id limit 1 $f$;""")
    w("""create function pg_temp.cp(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_produto into v from produtos where loja_id = 15 and (descricao = p_nome or codigo = p_nome) and not inativo and descricao not like '[%' order by id limit 1;
  if v is null then raise exception 'produto não encontrado: %', p_nome; end if;
  return v;
end $f$;""")
    w("""create function pg_temp.ficha(p_prod bigint, p_itens jsonb, p_obs text) returns void language plpgsql as $f$
declare v_itens jsonb := '[]'::jsonb; i jsonb;
begin
  for i in select * from jsonb_array_elements(p_itens) loop
    v_itens := v_itens || jsonb_build_object('codigo_insumo', pg_temp.cp(i ->> 0), 'quantidade_liquida', (i ->> 1)::numeric, 'fator_correcao', 1);
  end loop;
  perform salvar_ficha(15, p_prod, 1, v_itens, false, 'moq-ens-odara', p_obs);
end $f$;""")
    w("""create function pg_temp.aposentar(p_cp bigint) returns void language plpgsql as $f$
declare r record;
begin
  for r in select codigo_local_estoque, saldo from estoque_saldos where loja_id = 15 and codigo_produto = p_cp and saldo <> 0 loop
    perform registrar_movimento(15, r.codigo_local_estoque, p_cp, 'AJU', 'AJUSTE', 'moq-ens-odara-2026-10-07', -r.saldo, null, 'moq-ens-odara',
                                'Produto substituído por Moqueca/Ensopado com código próprio');
  end loop;
  update fichas_tecnicas set ativa = false where loja_id = 15 and codigo_produto = p_cp and ativa;
  update produtos set inativo = true, pdv = false, grupo_id = null, vendas_ref = null,
         descricao = case when descricao like '[%' then descricao else '[Substituído] ' || descricao end, updated_at = now()
   where loja_id = 15 and codigo_produto = p_cp;
end $f$;""")
    w('create temp table mapa (item text, preparo text, codigo text, codigo_produto bigint, donana text);')

    w('-- 1) Matéria-prima e produtos em processo que faltavam (iguais à Donana)')
    for nome, un, ncm, tipo, fam, _ in NOVOS:
        w(f"""insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
select 15, novo_id_produto_proprio(), proximo_codigo_produto(15, {lit(tipo)}), {lit(nome)}, {lit(un)}, {lit(ncm)}, 0, false, {lit(tipo)}, pg_temp.fam({lit(fam)}), {lit(fam)}, false, now()
 where not exists (select 1 from produtos where loja_id = 15 and descricao = {lit(nome)} and not inativo);""")
    for nome, *_, ficha in NOVOS:
        if ficha:
            w(f"select pg_temp.ficha(pg_temp.cp({lit(nome)}), {lit(json.dumps(ficha, ensure_ascii=False))}::jsonb, 'Cópia literal da estrutura da Donana (Omie)');")

    w('-- 2) Mãe + Moqueca + Ensopado para cada item; o produto antigo e os componentes "Preparo" são aposentados')
    for item, sufixo, moq, ens, feij, esc in ITENS:
        w(f"""do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = {lit(item)} and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', {lit(item)}; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, {lit(item)}, 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ({lit(item)}, 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, {lit('Moqueca ' + sufixo)}, 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{{"Preparo": "Moqueca"}}'::jsonb, false, now());
  insert into mapa values ({lit(item)}, 'Moqueca', v_cm, v_m, {lit(moq)});
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, {lit('Ensopado ' + sufixo)}, 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{{"Preparo": "Ensopado"}}'::jsonb, false, now());
  insert into mapa values ({lit(item)}, 'Ensopado', v_ce, v_e, {lit(ens)});
  perform pg_temp.ficha(v_m, {lit(json.dumps(estrutura(moq, feij and feij[0], esc), ensure_ascii=False))}::jsonb,
                        {lit(f'Cópia literal da estrutura Donana {moq} ' + DON[moq]['ident']['descrProduto'] + (f' + feijão da {feij[0]}' if feij else '') + (f' · {esc[0]} x{esc[1]:.4f} (gramatura ODARA)' if esc else ''))});
  perform pg_temp.ficha(v_e, {lit(json.dumps(estrutura(ens, feij and feij[1], esc), ensure_ascii=False))}::jsonb,
                        {lit(f'Cópia literal da estrutura Donana {ens} ' + DON[ens]['ident']['descrProduto'] + (f' + feijão da {feij[1]}' if feij else '') + (f' · {esc[0]} x{esc[1]:.4f} (gramatura ODARA)' if esc else ''))});
end $$;""")
    for nome in ANTIGOS:
        w(f"select pg_temp.aposentar(codigo_produto) from produtos where loja_id = 15 and descricao = {lit(nome)} and not inativo;")

    w('-- 3) Fichas trocadas pela estrutura literal da Donana')
    for cod, don in LITERAIS.items():
        w(f"select pg_temp.ficha(pg_temp.cp({lit(cod)}), {lit(json.dumps(estrutura(don), ensure_ascii=False))}::jsonb, "
          f"{lit('Cópia literal da estrutura Donana ' + don + ' ' + DON[don]['ident']['descrProduto'])});")

    w("select item, preparo, codigo, donana from mapa order by item, preparo;")
    return '\n'.join(o)


if __name__ == '__main__':
    print(estoque_sql())
