#!/usr/bin/env python3
"""Cria a ODARA BEACH em modo 'proprio' no Norte Estoque e liga ao Norte Vendas, com cardápio de TESTE.

Roda NO SERVIDOR (VPS), depois que Estoque e Vendas novos estiverem no ar:
    python3 seed-odara.py            # idempotente: pode rodar de novo
Só mexe na loja ODARA (Vendas store e73782c1-...). Nunca toca o Sertão nem o Omie.
Segredos são lidos de /opt/ntb-vendas/.env.local e nunca impressos.
"""
import json, subprocess, sys, urllib.request

VENDAS_STORE = 'e73782c1-fb1a-44a5-904c-e942341d9a94'
ESTOQUE_URL = None
BOOT = None


def sh(cmd, stdin=None):
    r = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('ERRO: ' + ' '.join(cmd[:4]) + '\n' + r.stderr[-800:])
    return r.stdout


def psql(db, sql):
    return sh(['docker', 'exec', '-i', 'supabase-db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', db, '-At'], sql)


def q(db, sql):
    return [l.split('|') for l in psql(db, sql).splitlines() if l.strip()]


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def env():
    global ESTOQUE_URL, BOOT
    for line in open('/opt/ntb-vendas/.env.local'):
        if line.startswith('NTB_ESTOQUE_INTERNAL_URL='):
            ESTOQUE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
        if line.startswith('CROSS_SYSTEM_BOOTSTRAP_KEY='):
            BOOT = line.split('=', 1)[1].strip().strip('"')
    if not ESTOQUE_URL or not BOOT:
        raise SystemExit('Falta NTB_ESTOQUE_INTERNAL_URL / CROSS_SYSTEM_BOOTSTRAP_KEY')


def post(path, body, key):
    req = urllib.request.Request(ESTOQUE_URL + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit('HTTP %s em %s: %s' % (e.code, path, e.read()[:400]))


# nome, tipoItem SPED, unidade, ncm
INSUMOS = [
    ('Limão Tahiti', '01', 'G', '08055000'), ('Cachaça Prata', '01', 'ML', '22089000'), ('Açúcar Refinado', '01', 'G', '17019900'),
    ('Gin Seco', '01', 'ML', '22085000'), ('Água Tônica Lata', '01', 'UN', '22021000'), ('Batata Pré-Frita', '01', 'G', '20041000'),
    ('Óleo de Soja', '01', 'ML', '15079011'), ('Filé de Peixe', '01', 'G', '03044900'), ('Farinha de Trigo', '01', 'G', '11010010'),
    ('Pão de Hambúrguer', '01', 'UN', '19052090'), ('Blend Bovino', '01', 'G', '02013000'), ('Queijo Prato Fatiado', '01', 'G', '04069090'),
    ('Leite de Coco', '01', 'ML', '20089900'), ('Azeite de Dendê', '01', 'ML', '15119000'),
]
# nome, tipoItem, unidade, ncm, preço, destino, categoria, receita [(insumo, qtd, FC)]  (receita None = revenda direta)
VENDAVEIS = [
    ('Heineken 330ml', '00', 'UN', '22030000', 14.0, 'bar', 'Cervejas', None),
    ('Original 600ml', '00', 'UN', '22030000', 18.0, 'bar', 'Cervejas', None),
    ('Refrigerante Lata', '00', 'UN', '22021000', 7.0, 'bar', 'Bebidas', None),
    ('Água Mineral 500ml', '00', 'UN', '22021000', 5.0, 'bar', 'Bebidas', None),
    ('Caipirinha de Limão', '04', 'UN', '22089000', 22.0, 'bar', 'Drinks', [('Cachaça Prata', 60, 1), ('Limão Tahiti', 80, 1), ('Açúcar Refinado', 15, 1)]),
    ('Gin Tônica', '04', 'UN', '22089000', 32.0, 'bar', 'Drinks', [('Gin Seco', 50, 1), ('Água Tônica Lata', 1, 1)]),
    ('Porção de Batata Frita', '04', 'UN', '20041000', 28.0, 'kitchen', 'Petiscos', [('Batata Pré-Frita', 400, 1), ('Óleo de Soja', 60, 1)]),
    ('Isca de Peixe', '04', 'UN', '16041900', 46.0, 'kitchen', 'Petiscos', [('Filé de Peixe', 300, 1.3), ('Óleo de Soja', 80, 1), ('Farinha de Trigo', 60, 1)]),
    ('Hambúrguer da Casa', '04', 'UN', '19059090', 38.0, 'kitchen', 'Pratos', [('Pão de Hambúrguer', 1, 1), ('Blend Bovino', 180, 1), ('Queijo Prato Fatiado', 40, 1)]),
    ('Moqueca de Peixe', '04', 'UN', '16041900', 89.0, 'kitchen', 'Pratos', [('Filé de Peixe', 400, 1.3), ('Leite de Coco', 200, 1), ('Azeite de Dendê', 30, 1)]),
]
# estoque inicial: (local, produto, qtd, custo)
ESTOQUE = [
    ('Bar', 'Heineken 330ml', 48, 8.5), ('Bar', 'Original 600ml', 36, 9.0), ('Bar', 'Refrigerante Lata', 48, 3.2), ('Bar', 'Água Mineral 500ml', 60, 1.5),
    ('Bar', 'Cachaça Prata', 3000, 0.05), ('Bar', 'Gin Seco', 2000, 0.18), ('Bar', 'Água Tônica Lata', 36, 2.2), ('Bar', 'Limão Tahiti', 3000, 0.006), ('Bar', 'Açúcar Refinado', 2000, 0.005),
    ('Cozinha', 'Batata Pré-Frita', 10000, 0.007), ('Cozinha', 'Óleo de Soja', 5000, 0.009), ('Cozinha', 'Filé de Peixe', 6000, 0.045), ('Cozinha', 'Farinha de Trigo', 2000, 0.006),
    ('Cozinha', 'Pão de Hambúrguer', 40, 1.2), ('Cozinha', 'Blend Bovino', 5000, 0.035), ('Cozinha', 'Queijo Prato Fatiado', 1500, 0.04),
    ('Cozinha', 'Leite de Coco', 3000, 0.012), ('Cozinha', 'Azeite de Dendê', 1000, 0.02),
    ('Estoque Geral', 'Heineken 330ml', 120, 8.5), ('Estoque Geral', 'Refrigerante Lata', 120, 3.2), ('Estoque Geral', 'Água Mineral 500ml', 120, 1.5),
    ('Estoque Geral', 'Cachaça Prata', 6000, 0.05), ('Estoque Geral', 'Gin Seco', 4000, 0.18), ('Estoque Geral', 'Limão Tahiti', 5000, 0.006),
]
CATEGORIAS = ['Cervejas', 'Bebidas', 'Drinks', 'Petiscos', 'Pratos']


def main():
    env()
    # 1) loja no Estoque (modo proprio)
    r = q('postgres', "select id, integracao_api_key from lojas where nome ilike 'ODARA%' order by id limit 1")
    if r:
        loja_id, key = int(r[0][0]), r[0][1]
        print('Estoque: loja ODARA já existe, id', loja_id)
    else:
        resp = post('/api/integracao/lojas', {'nome': 'ODARA BEACH', 'stockMode': 'proprio'}, BOOT)
        loja_id, key = int(resp['lojaId']), resp['integracaoApiKey']
        print('Estoque: loja ODARA criada, id', loja_id, 'modo', resp.get('modo'))
    modo = q('postgres', 'select modo_estoque from lojas where id=%d' % loja_id)[0][0]
    if modo != 'proprio':
        raise SystemExit('A loja ODARA no Estoque está em modo %s, esperado proprio' % modo)

    # 2) Vendas: modo + integração
    psql('ntb_vendas', "update stores set stock_mode='proprio' where id=%s;" % lit(VENDAS_STORE))
    psql('ntb_vendas', "insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo) values (%s, %s, %s, true) "
         "on conflict (store_id) do update set ntb_estoque_url=excluded.ntb_estoque_url, ntb_estoque_api_key=excluded.ntb_estoque_api_key, ativo=true;"
         % (lit(VENDAS_STORE), lit(ESTOQUE_URL), lit(key)))
    print('Vendas: ODARA em modo proprio e integração ligada')

    # 3) locais semeados
    locais = {d: int(c) for c, d in [(a, b) for a, b in q('postgres', 'select codigo_local_estoque, descricao from local_estoques where loja_id=%d' % loja_id)]}
    for nome in ('Estoque Geral', 'Bar', 'Cozinha'):
        if nome not in locais:
            raise SystemExit('Local %s não foi semeado: %s' % (nome, list(locais)))

    # 4) produtos no Estoque (API, código por tipo)
    existentes = {d: (c, int(p)) for c, p, d in q('postgres', 'select codigo, codigo_produto, descricao from produtos where loja_id=%d' % loja_id)}
    cod = {}

    def garantir(nome, tipo, un, ncm, preco):
        if nome in existentes:
            cod[nome] = existentes[nome]
            return
        resp = post('/api/integracao/produtos', {'nome': nome, 'precoVenda': preco, 'ncm': ncm, 'unidade': un, 'tipoItem': tipo}, key)
        cod[nome] = (resp['codigo'], int(resp['codigoProduto']))
        print('  produto', nome, '->', resp['codigo'])
    for n, t, u, ncm in INSUMOS:
        garantir(n, t, u, ncm, 0)
    for n, t, u, ncm, preco, *_ in VENDAVEIS:
        garantir(n, t, u, ncm, preco)

    # 5) fichas técnicas
    for n, t, u, ncm, preco, dest, cat, rec in VENDAVEIS:
        if not rec:
            continue
        itens = [{'codigo_insumo': cod[i][1], 'quantidade_liquida': qt, 'fator_correcao': fc} for i, qt, fc in rec]
        ja = q('postgres', 'select 1 from fichas_tecnicas where loja_id=%d and codigo_produto=%d and ativa' % (loja_id, cod[n][1]))
        if not ja:
            psql('postgres', "select salvar_ficha(%d, %d, 1, %s::jsonb, false, 'seed-odara', 'Receita de teste');" % (loja_id, cod[n][1], lit(json.dumps(itens))))
            print('  ficha', n)

    # 6) estoque inicial (idempotente por ref)
    for local, prod, qtd, custo in ESTOQUE:
        psql('postgres', "select registrar_movimento(%d, %d, %d, 'ENT', 'SALDO_INICIAL', %s, %s, %s, 'seed-odara', 'Saldo inicial de teste');"
             % (loja_id, locais[local], cod[prod][1], lit('seed:' + str(cod[prod][1]) + ':' + str(locais[local])), qtd, custo))
    print('Estoque: saldos iniciais lançados')

    # 7) Vendas: categorias, produtos, mapeamento, mesas
    for i, c in enumerate(CATEGORIAS):
        psql('ntb_vendas', "insert into categories (store_id, name, \"order\") select %s, %s, %d where not exists (select 1 from categories where store_id=%s and name=%s);"
             % (lit(VENDAS_STORE), lit(c), i, lit(VENDAS_STORE), lit(c)))
    for n, t, u, ncm, preco, dest, cat, rec in VENDAVEIS:
        psql('ntb_vendas', "insert into products (store_id, name, price, destination, omie_codigo, ncm, category_id, available) "
             "select %s, %s, %s, %s, %s, %s, (select id from categories where store_id=%s and name=%s), true "
             "where not exists (select 1 from products where store_id=%s and name=%s);"
             % (lit(VENDAS_STORE), lit(n), preco, lit(dest), lit(cod[n][0]), lit(ncm), lit(VENDAS_STORE), lit(cat), lit(VENDAS_STORE), lit(n)))
    psql('ntb_vendas', "delete from store_estoque_locais where store_id=%s and destino in ('kitchen','bar');" % lit(VENDAS_STORE))
    for destino, nome in (('kitchen', 'Cozinha'), ('bar', 'Bar')):
        psql('ntb_vendas', "insert into store_estoque_locais (store_id, destino, omie_local_codigo, local_nome) values (%s, %s, %d, %s);"
             % (lit(VENDAS_STORE), lit(destino), locais[nome], lit(nome)))
    psql('ntb_vendas', "select sync_store_tables_secure(%s, 10);" % lit(VENDAS_STORE))
    print('Vendas: cardápio de teste, locais mapeados e 10 mesas criados')
    print('PRONTO')


if __name__ == '__main__':
    main()
