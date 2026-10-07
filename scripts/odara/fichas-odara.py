#!/usr/bin/env python3
"""Gera scripts/odara/fichas-odara.sql: estrutura dos produtos da ODARA BEACH (Estoque loja 15, modo próprio) a partir das
estruturas REAIS da Donana (loja 2, lidas do Omie só em leitura via ConsultarEstrutura em 07/10/2026).

- Matérias-primas (80xxx) e produtos em processo (70xxx) com o MESMO nome, unidade, NCM, tipo e família da Donana.
- Sub-receitas dos 70xxx com ficha (expandir_na_venda = false: o PI sai do estoque dele; a OP de preparo do PI consome a MP,
  como na Donana). Só os componentes de escolha (Preparo Moqueca/Ensopado, acompanhamento da Carne do Sol, Acarajé/Abará)
  abrem na venda (expandir = true).
- Fichas dos 90xxx da ODARA escaladas para as porções do cardápio; escolhas do Vendas ganham o código do componente.
- Limpeza do cardápio/insumos de teste (apaga sem movimento, inativa e zera com ajuste o que tem movimento).
Uso: python3 fichas-odara.py > fichas-odara.sql ; aplicar com psql -v ON_ERROR_STOP=1 (sempre dry-run com ROLLBACK antes).
"""
import json

# ---------------------------------------------------------------- cadastro (nome, unidade, ncm, tipo, família)
# Da Donana (loja 2), idêntico:
DONANA = """80002|ACUCAR CRISTAL (MP)|KG|17019900|01|Atacado
80003|BATATA PRE-FRITA (MP)|KG|20041000|01|Atacado
80007|ALFACE CRESPA (MP)|KG|07051100|01|Horti - Frut
80009|ALHO (MP)|KG|07032010|01|Horti - Frut
80011|AMENDOIM TORRADO (MP)|KG|20081100|01|Feira
80015|ARROZ BCO (MP)|KG|10063021|01|Atacado
80017|AZEITE DE DENDE 2000 (MP)|L|15111000|01|Feira
80020|BATATA INGLESA (MP)|KG|07011000|01|Horti - Frut
80023|CACHAÇA 51 (MP)|ML|22084000|01|Destilados
80027|CAMARAO CONG 41/50 (MP)|KG|03061790|01|Frutos do mar
80028|CAMARAO CONG S/CAB CRU BLOCO 36/40 (MP)|KG|03061790|01|Frutos do mar
80030|CARNE DO SOL (MP)|KG|02102000|01|Proteínas
80031|CEBOLA (MP)|KG|07031011|01|Horti - Frut
80035|COENTRO (MP)|KG|07039090|01|Horti - Frut
80039|EXTRATO DE TOMATE (MP)|KG|20029000|01|Atacado
80042|FARINHA DE TRIGO (MP)|KG|11010010|01|Atacado
80043|FEIJAO FRADINHO (MP)|KG|07133590|01|Atacado
80052|ALHO TRITURADO (MP)|G|07123900|01|Atacado
80056|LARANJA (MP)|KG|08051000|01|Horti - Frut
80060|OVO DE GALINHA (MP)|UN|04071100|01|Horti - Frut
80062|PIMENTAO (MP)|KG|07096000|01|Horti - Frut
80063|PIMENTA MALAGUETA (MP)|KG|07096000|01|Horti - Frut
80065|SALSA (MP)|KG|07039090|01|Horti - Frut
80074|LEITE DE COCO (MOQ) (MP)|ML|20098990|01|Atacado
80075|LEITE L.VIDA (MP)|L|04012010|01|Atacado
80077|LIMAO TAHITI (MP)|KG|08055000|01|Horti - Frut
80089|MARG C/SAL (MP)|G|15171000|01|Atacado
80099|OLEO SOJA (MP)|ML|15079011|01|Atacado
80104|PEIXE PESCADA AMARELA (MP)|KG|03022900|01|Frutos do mar
80106|PEIXE VERMELHO (MP)|KG|03022900|01|Frutos do mar
80109|PICLES (MP)|G|20019000|01|Atacado
80126|QUEIJO COALHO (MP)|KG|04069020|01|Atacado
80135|SIRI CATADO (MP)|KG|03038990|01|Frutos do mar
80141|SURURU (MP)|KG|03038990|01|Frutos do mar
80142|TOMATE SALADA (MP)|KG|07020000|01|Horti - Frut
80145|VINAGRE ALCOOL (MP)|ML|22090000|01|Atacado
80149|GIN NACIONAL (MP)|ML|22085000|01|Destilados
80157|MAIONESE (MP)|KG|21039019|01|Atacado
80163|VODKA ABSOLUT (MP)|ML|22086000|01|Destilados
80165|VODKA SMIRNOFF (MP)|ML|22086000|01|Destilados
80199|DOCE DE AMBROSIA (MP)|G|20089900|01|Atacado
80203|AZEITONA PRETA (MP)|KG|20057000|01|Atacado
80207|CAMARAO 40/50 ALHO E OLEO 30/40  (MP)|KG|03061790|01|Frutos do mar
80219|FARINHA DE MANDIOCA - FINA (MP)|KG|11029000|01|Feira
80220|FARINHA DE MANDIOCA - GROSSA (MP)|KG|11029000|01|Feira
80222|OREGANO (MP)|KG|12119010|01|Horti - Frut
80225|CAMARAO CONG IQF CRU PPV 61/70 (MP)|KG|03061790|01|Frutos do mar
80226|PAO INTEGRAL (MP)|G|19052090|01|Atacado
80227|ABARÁ (MP)|POR|21069090|01|Feira
80228|COCADA BRANCA (MP)|KG|08011900|01|Feira
80242|CAMARAO SECO (MP)|KG|03038990|01|Frutos do mar
80251|COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)|UN|39241000|01|Embalagem/Descartáveis
80264|COMINHO MOIDO (MP)|KG|21039029|01|Feira
80273|CALDO DE CAMARAO (KG) (MP)|KG|21041019|01|Atacado
80285|LEITE DE COCO (BASE) (MP)|ML|20098990|01|Atacado
80295|EMBALAGEM P/MOLHO 30 ML (MP)|UN|39239090|01|Embalagem/Descartáveis
80303|AZEITE EXTRA VIRG COZINHA ( OLEO MISTO ) (MP)|ML|21039021|01|Atacado
80324|SAL FINO (MP)|KG|25010020|01|Atacado
80331|BOLINHO DE PEIXE (MP)|UN|16042090|01|Feira
80332|FILE DE PESCADA - G (MP)|KG|03022900|01|Frutos do mar
90022|Tonica Antarctica 350 ML|UN|22021000|00|GELADAS SEM ALCOOL
70003|ARROZ BCO (PI)|KG|10063021|03|Produto Intermediário
70010|FEIJAO FRADINHO (PI)|KG|20055900|03|Produto Intermediário
70011|VINAGRETE (PI)|KG|20021000|03|Produto Intermediário
70013|CAMARAO MOQ / ENS 200 g - (PI)|UN|03061790|03|Produto Intermediário
70020|CARNE DO SOL 300 G (PI)|UN|02102000|03|Produto Intermediário
70028|Base p/ VATAPA/CARURU|KG|21069090|03|Produto Intermediário
70032|VATAPA (PI)|KG|19012000|03|Produto Intermediário
70033|FAROFA DE MANTEIGA (PI)|KG|19019090|03|Produto Intermediário
70034|CAMARAO MOQ / ENS 300 g - (PI)|UN|03061790|03|Produto Intermediário
70037|BOLINHO DE CAMARAO 8 UNID (PI)|UN|16042090|03|Produto Intermediário
70038|FAROFA DE DENDE (PI)|KG|19019090|03|Produto Intermediário
70040|Base p/ PIRAO DENDE (PI)|KG|21069090|03|Produto Intermediário
70043|FILE PESCADA 450 g (PI)|UN|03022900|03|Produto Intermediário
70049|PEIXE PESCADA AMARELA 500 g (PI)|UN|03022900|03|Produto Intermediário
70055|PEIXE VERMELHO INTEIRO 1 KG (PI)|UN|03022900|03|Produto Intermediário
70083|CALDO DE CAMARAO (250ml) (PI)|UN|21041029|03|Produto Intermediário
70084|CALDO DE SURURU (250 ml) (PI)|UN|21041029|03|Produto Intermediário
70085|CALDO MISTO (PI)|UN|21041029|03|Produto Intermediário
70090|MOLHO TARTARO (PI)|L|21039099|03|Produto Intermediário
70101|PIRAO DE DENDE (PI)|KG|21069090|03|Produto Intermediário
70102|CASQUINHA DE SIRI (PI)|KG|21069090|03|Produto Intermediário
70108|CAMARAO MOQ / ENSO (PI)|KG|03061790|03|Produto Intermediário
70122|PIRAO ENSOPADO (PI)|KG|21069090|03|Produto Intermediário
70124|TEMPERO LIQUIDO (PI)|L|20021000|03|Produto Intermediário
70128|Base p/ PIRAO ENSOPADO (PI)|KG|21069090|03|Produto Intermediário
70130|CARNE DO SOL LIMPA (PI)|KG|02102000|03|Produto Intermediário
70133|PEIXE PESCADA AMARELA 200 g (PI)|UN|03022900|03|Produto Intermediário"""
# Que a Donana não tem (ODARA vende e a Donana não): criados no mesmo padrão.
NOVOS = """ACARAJE (MP)|UN|21069090|01|Feira
BOLINHO DE QUEIJO (MP)|UN|19059090|01|Feira
APEROL (MP)|ML|22089000|01|Destilados
ESPUMANTE (MP)|ML|22041010|01|Destilados
Preparo Moqueca - porção inteira (PI)|UN|21069090|03|Produto Intermediário
Preparo Moqueca - porção individual (PI)|UN|21069090|03|Produto Intermediário
Preparo Ensopado - porção inteira (PI)|UN|21069090|03|Produto Intermediário
Preparo Ensopado - porção individual (PI)|UN|21069090|03|Produto Intermediário
Porção de Batata Frita (acompanhamento da Carne do Sol) (PI)|UN|20041000|03|Produto Intermediário
Porção de Farofa (acompanhamento da Carne do Sol) (PI)|UN|19019090|03|Produto Intermediário
Acarajé - 8 bolinhos (PI)|UN|21069090|03|Produto Intermediário
Mini Abará - 6 unidades (PI)|UN|21069090|03|Produto Intermediário"""

# ---------------------------------------------------------------- sub-receitas dos PI (Donana, por 1 unidade do PI)
PI = {
 'ARROZ BCO (PI)': [('ARROZ BCO (MP)', .33)],
 'FAROFA DE DENDE (PI)': [('AZEITE DE DENDE 2000 (MP)', .16), ('FARINHA DE MANDIOCA - FINA (MP)', .84), ('SAL FINO (MP)', .008)],
 'FAROFA DE MANTEIGA (PI)': [('OLEO SOJA (MP)', 76.14), ('MARG C/SAL (MP)', 84.6), ('FARINHA DE MANDIOCA - FINA (MP)', .84), ('SAL FINO (MP)', .008)],
 'CAMARAO MOQ / ENSO (PI)': [('CAMARAO CONG S/CAB CRU BLOCO 36/40 (MP)', .666667), ('CAMARAO CONG 41/50 (MP)', .666667)],
 'VINAGRETE (PI)': [('TOMATE SALADA (MP)', .48), ('CEBOLA (MP)', .145278), ('PIMENTAO (MP)', .072639), ('COENTRO (MP)', .072639)],
 'TEMPERO LIQUIDO (PI)': [('SAL FINO (MP)', .3333), ('LIMAO TAHITI (MP)', .6), ('VINAGRE ALCOOL (MP)', 800), ('COMINHO MOIDO (MP)', .005), ('ALHO (MP)', .1)],
 'PIRAO DE DENDE (PI)': [('LEITE DE COCO (MOQ) (MP)', 200), ('FARINHA DE MANDIOCA - GROSSA (MP)', .2), ('Base p/ PIRAO DENDE (PI)', .5), ('AZEITE DE DENDE 2000 (MP)', .02), ('TEMPERO LIQUIDO (PI)', .012)],
 'CAMARAO MOQ / ENS 200 g - (PI)': [('CAMARAO MOQ / ENSO (PI)', .2)],
 'PIRAO ENSOPADO (PI)': [('LEITE DE COCO (MOQ) (MP)', 200), ('FARINHA DE MANDIOCA - GROSSA (MP)', .2), ('Base p/ PIRAO ENSOPADO (PI)', .5), ('EXTRATO DE TOMATE (MP)', .02), ('TEMPERO LIQUIDO (PI)', .012)],
 'PEIXE PESCADA AMARELA 500 g (PI)': [('PEIXE PESCADA AMARELA (MP)', 1.038251)],
 'FILE PESCADA 450 g (PI)': [('FILE DE PESCADA - G (MP)', .63)],
 'CAMARAO MOQ / ENS 300 g - (PI)': [('CAMARAO MOQ / ENSO (PI)', .3)],
 'PEIXE PESCADA AMARELA 200 g (PI)': [('PEIXE PESCADA AMARELA (MP)', .415301)],
 'PEIXE VERMELHO INTEIRO 1 KG (PI)': [('PEIXE VERMELHO (MP)', 1.1)],
 'CALDO MISTO (PI)': [('CAMARAO CONG IQF CRU PPV 61/70 (MP)', .035), ('SURURU (MP)', .035), ('ALHO TRITURADO (MP)', .007), ('LEITE DE COCO (MOQ) (MP)', 35), ('AZEITE DE DENDE 2000 (MP)', .013), ('AMENDOIM TORRADO (MP)', .009), ('TOMATE SALADA (MP)', .03), ('CEBOLA (MP)', .025), ('PIMENTAO (MP)', .005), ('COENTRO (MP)', .005), ('BATATA INGLESA (MP)', .025), ('CAMARAO SECO (MP)', .004)],
 'CALDO DE CAMARAO (250ml) (PI)': [('CAMARAO CONG IQF CRU PPV 61/70 (MP)', .07), ('AMENDOIM TORRADO (MP)', .009), ('ALHO TRITURADO (MP)', .007), ('LEITE DE COCO (MOQ) (MP)', 35), ('AZEITE DE DENDE 2000 (MP)', .013), ('COENTRO (MP)', .006749), ('BATATA INGLESA (MP)', .025), ('SAL FINO (MP)', .001852), ('TEMPERO LIQUIDO (PI)', .002778), ('VINAGRETE (PI)', .024074), ('EXTRATO DE TOMATE (MP)', .002963), ('LIMAO TAHITI (MP)', .00008), ('CEBOLA (MP)', .003497), ('PIMENTAO (MP)', .001749), ('TOMATE SALADA (MP)', .011556), ('CAMARAO SECO (MP)', .007)],
 'CALDO DE SURURU (250 ml) (PI)': [('SURURU (MP)', .031), ('EXTRATO DE TOMATE (MP)', .01), ('ALHO TRITURADO (MP)', .007), ('TOMATE SALADA (MP)', .03), ('CEBOLA (MP)', .025), ('PIMENTAO (MP)', .005), ('COENTRO (MP)', .005), ('BATATA INGLESA (MP)', .025), ('LEITE DE COCO (BASE) (MP)', 35)],
 'MOLHO TARTARO (PI)': [('OVO DE GALINHA (MP)', 1), ('AZEITONA PRETA (MP)', .1185), ('ALHO TRITURADO (MP)', 20), ('OREGANO (MP)', .04), ('PICLES (MP)', 593), ('SALSA (MP)', .06), ('MAIONESE (MP)', .89)],
 'BOLINHO DE CAMARAO 8 UNID (PI)': [('CAMARAO CONG IQF CRU PPV 61/70 (MP)', .2343), ('CEBOLA (MP)', .0109), ('COENTRO (MP)', .0031), ('EXTRATO DE TOMATE (MP)', .0062), ('CALDO DE CAMARAO (KG) (MP)', .004), ('AZEITE EXTRA VIRG COZINHA ( OLEO MISTO ) (MP)', 6), ('MARG C/SAL (MP)', 3.5), ('FARINHA DE TRIGO (MP)', .0625), ('LEITE L.VIDA (MP)', .031), ('TEMPERO LIQUIDO (PI)', .02)],
 'CARNE DO SOL 300 G (PI)': [('CARNE DO SOL LIMPA (PI)', .3)],
 'CASQUINHA DE SIRI (PI)': [('SIRI CATADO (MP)', .64), ('LEITE DE COCO (MOQ) (MP)', 148), ('AZEITE DE DENDE 2000 (MP)', .11), ('EXTRATO DE TOMATE (MP)', .05), ('LIMAO TAHITI (MP)', .09), ('TEMPERO LIQUIDO (PI)', .067), ('VINAGRETE (PI)', .303226)],
 'VATAPA (PI)': [('Base p/ VATAPA/CARURU', .13), ('FARINHA DE TRIGO (MP)', .13), ('CALDO DE CAMARAO (KG) (MP)', .003), ('AZEITE DE DENDE 2000 (MP)', .054), ('SAL FINO (MP)', .007463), ('LEITE DE COCO (MOQ) (MP)', 47.410009)],
 'FEIJAO FRADINHO (PI)': [('FEIJAO FRADINHO (MP)', .519), ('SAL FINO (MP)', .013)],
 'Base p/ PIRAO DENDE (PI)': [('CAMARAO CONG IQF CRU PPV 61/70 (MP)', .33), ('LEITE DE COCO (MOQ) (MP)', 133), ('LEITE DE COCO (BASE) (MP)', 267), ('VINAGRETE (PI)', .05), ('ALHO TRITURADO (MP)', 13.17), ('TEMPERO LIQUIDO (PI)', .03), ('SAL FINO (MP)', .001), ('AZEITE DE DENDE 2000 (MP)', .05)],
 'Base p/ PIRAO ENSOPADO (PI)': [('CAMARAO CONG IQF CRU PPV 61/70 (MP)', .33), ('LEITE DE COCO (MOQ) (MP)', 133), ('LEITE DE COCO (BASE) (MP)', 267), ('VINAGRETE (PI)', .05), ('ALHO TRITURADO (MP)', 13.17), ('TEMPERO LIQUIDO (PI)', .03), ('SAL FINO (MP)', .001), ('EXTRATO DE TOMATE (MP)', .033)],
 'CARNE DO SOL LIMPA (PI)': [('CARNE DO SOL (MP)', 1.3897)],
 'Base p/ VATAPA/CARURU': [('ALHO TRITURADO (MP)', 30), ('AMENDOIM TORRADO (MP)', .016), ('CEBOLA (MP)', .036), ('COENTRO (MP)', .01), ('LEITE DE COCO (BASE) (MP)', 113), ('CAMARAO SECO (MP)', .168)],
}
# Componentes das escolhas (abrem na venda): partes que mudam entre Moqueca e Ensopado na Donana, e os acompanhamentos.
COMP = {
 'Preparo Moqueca - porção inteira (PI)': [('AZEITE DE DENDE 2000 (MP)', .05), ('FAROFA DE DENDE (PI)', .175), ('PIRAO DE DENDE (PI)', .375)],
 'Preparo Moqueca - porção individual (PI)': [('AZEITE DE DENDE 2000 (MP)', .025), ('FAROFA DE DENDE (PI)', .055), ('PIRAO DE DENDE (PI)', .27)],
 'Preparo Ensopado - porção inteira (PI)': [('EXTRATO DE TOMATE (MP)', .13), ('FAROFA DE MANTEIGA (PI)', .2), ('PIRAO ENSOPADO (PI)', .375)],
 'Preparo Ensopado - porção individual (PI)': [('EXTRATO DE TOMATE (MP)', .05), ('FAROFA DE MANTEIGA (PI)', .1), ('PIRAO ENSOPADO (PI)', .27)],
 'Porção de Batata Frita (acompanhamento da Carne do Sol) (PI)': [('BATATA PRE-FRITA (MP)', .2)],
 'Porção de Farofa (acompanhamento da Carne do Sol) (PI)': [('FAROFA DE MANTEIGA (PI)', .15)],
 'Acarajé - 8 bolinhos (PI)': [('ACARAJE (MP)', 8)],
 'Mini Abará - 6 unidades (PI)': [('ABARÁ (MP)', 1)],
}
FEIJAO_ACOMP = ('FEIJAO FRADINHO (PI)', .22)
BIG, IND = 'porção inteira', 'porção individual'
# ---------------------------------------------------------------- fichas dos 90xxx da ODARA (código -> itens, escolhas)
FICHAS = {
 '90027': [('CALDO DE SURURU (250 ml) (PI)', 1)],
 '90028': [('CALDO DE CAMARAO (250ml) (PI)', 1), ('LIMAO TAHITI (MP)', .01), ('PAO INTEGRAL (MP)', 50)],
 '90029': [('CALDO MISTO (PI)', 1), ('LARANJA (MP)', .045), ('PAO INTEGRAL (MP)', 10)],
 '90030': [('BOLINHO DE PEIXE (MP)', 4), ('MOLHO TARTARO (PI)', .01), ('EMBALAGEM P/MOLHO 30 ML (MP)', 1), ('LIMAO TAHITI (MP)', .005), ('ALFACE CRESPA (MP)', .001)],
 '90031': [('BOLINHO DE CAMARAO 8 UNID (PI)', .5), ('MOLHO TARTARO (PI)', .01), ('EMBALAGEM P/MOLHO 30 ML (MP)', 1), ('LIMAO TAHITI (MP)', .005), ('ALFACE CRESPA (MP)', .001)],
 '90032': [('BOLINHO DE QUEIJO (MP)', 4), ('MOLHO TARTARO (PI)', .01), ('EMBALAGEM P/MOLHO 30 ML (MP)', 1), ('LIMAO TAHITI (MP)', .005), ('ALFACE CRESPA (MP)', .001)],
 '90055': [('QUEIJO COALHO (MP)', .2)],
 '90056': [('CASQUINHA DE SIRI (PI)', .14), ('FAROFA DE MANTEIGA (PI)', .04), ('LIMAO TAHITI (MP)', .005)],
 '90020': [('BATATA PRE-FRITA (MP)', .35)],
 '90054': [('TOMATE SALADA (MP)', .1725), ('ALFACE CRESPA (MP)', .015), ('ALHO TRITURADO (MP)', 15), ('FAROFA DE MANTEIGA (PI)', .12375), ('CAMARAO 40/50 ALHO E OLEO 30/40  (MP)', .3)],
 '90033': [('FILE DE PESCADA - G (MP)', .44), ('FARINHA DE TRIGO (MP)', .05), ('OLEO SOJA (MP)', 300), ('LIMAO TAHITI (MP)', .05), ('SAL FINO (MP)', .01), ('TEMPERO LIQUIDO (PI)', .03), ('MOLHO TARTARO (PI)', .02)],
 '90034': [('CARNE DO SOL 300 G (PI)', 1), ('FAROFA DE MANTEIGA (PI)', .15), ('TOMATE SALADA (MP)', .03), ('CEBOLA (MP)', .045), ('PIMENTAO (MP)', .0225), ('COENTRO (MP)', .007), ('FEIJAO FRADINHO (MP)', .125)],
 '90035': [('CARNE DO SOL 300 G (PI)', 1), ('CEBOLA (MP)', .05), ('VINAGRETE (PI)', .04)],
 '90039': [('VATAPA (PI)', .075), ('VINAGRETE (PI)', .04), ('CAMARAO SECO (MP)', .03), ('PIMENTA MALAGUETA (MP)', .005)],
 '90040': [('ARROZ BCO (PI)', .2), ('LEITE DE COCO (MOQ) (MP)', 100), ('CAMARAO MOQ / ENS 200 g - (PI)', 1), ('VINAGRETE (PI)', .02), ('TEMPERO LIQUIDO (PI)', .02)],
 '90041': [('ARROZ BCO (PI)', .26), ('LEITE DE COCO (MOQ) (MP)', 350), ('CAMARAO MOQ / ENSO (PI)', .4), ('VINAGRETE (PI)', .04), ('TEMPERO LIQUIDO (PI)', .04)],
 '90043': [('ARROZ BCO (PI)', .26), ('LEITE DE COCO (BASE) (MP)', 300), ('PEIXE PESCADA AMARELA 500 g (PI)', 1), ('VINAGRETE (PI)', .04), ('TEMPERO LIQUIDO (PI)', .04), FEIJAO_ACOMP],
 '90044': [('ARROZ BCO (PI)', .4), ('LEITE DE COCO (MOQ) (MP)', 100), ('LEITE DE COCO (BASE) (MP)', 200), ('PEIXE PESCADA AMARELA 500 g (PI)', 1), ('CAMARAO MOQ / ENS 300 g - (PI)', 1), ('VINAGRETE (PI)', .04), ('TEMPERO LIQUIDO (PI)', .04), FEIJAO_ACOMP],
 '90045': [('ARROZ BCO (PI)', .26), ('LEITE DE COCO (MOQ) (MP)', 300), ('FILE PESCADA 450 g (PI)', 1), ('VINAGRETE (PI)', .04), ('TEMPERO LIQUIDO (PI)', .04), FEIJAO_ACOMP],
 '90046': [('ARROZ BCO (PI)', .4), ('LEITE DE COCO (MOQ) (MP)', 100), ('LEITE DE COCO (BASE) (MP)', 200), ('FILE PESCADA 450 g (PI)', 1), ('CAMARAO MOQ / ENS 300 g - (PI)', 1), ('VINAGRETE (PI)', .04), ('TEMPERO LIQUIDO (PI)', .04), FEIJAO_ACOMP],
 '90037': [('ARROZ BCO (PI)', .2), ('LEITE DE COCO (MOQ) (MP)', 100), ('PEIXE PESCADA AMARELA 200 g (PI)', 1), ('VINAGRETE (PI)', .02), ('TEMPERO LIQUIDO (PI)', .02)],
 '90047': [('PEIXE PESCADA AMARELA 500 g (PI)', 1), ('FAROFA DE MANTEIGA (PI)', .165), ('VINAGRETE (PI)', .15), ('ALFACE CRESPA (MP)', .02), ('ARROZ BCO (PI)', .28), FEIJAO_ACOMP],
 '90036': [('PEIXE VERMELHO INTEIRO 1 KG (PI)', 1), ('FAROFA DE MANTEIGA (PI)', .165), ('VINAGRETE (PI)', .15), ('LIMAO TAHITI (MP)', .05), ('SAL FINO (MP)', .03), ('TEMPERO LIQUIDO (PI)', .06), ('FARINHA DE TRIGO (MP)', .05), ('OLEO SOJA (MP)', 500), ('ALFACE CRESPA (MP)', .01), ('FEIJAO FRADINHO (PI)', .44)],
 '90038': [('FAROFA DE MANTEIGA (PI)', .2)],
 '90042': [('ARROZ BCO (PI)', .26)],
 '90048': [('FEIJAO FRADINHO (PI)', .44), ('VINAGRETE (PI)', .025)],
 '90049': [('PIRAO DE DENDE (PI)', .375)],
 '90050': [('VINAGRETE (PI)', .12)],
 '90062': [('ACUCAR CRISTAL (MP)', .04), ('CACHAÇA 51 (MP)', 70), ('LIMAO TAHITI (MP)', .2)],
 '90063': [('VODKA SMIRNOFF (MP)', 70), ('ACUCAR CRISTAL (MP)', .04), ('LIMAO TAHITI (MP)', .2)],
 '90064': [('VODKA ABSOLUT (MP)', 70), ('ACUCAR CRISTAL (MP)', .04), ('LIMAO TAHITI (MP)', .2)],
 '90065': [('GIN NACIONAL (MP)', 60), ('Tonica Antarctica 350 ML', 1)],
 '90017': [('APEROL (MP)', 60), ('ESPUMANTE (MP)', 90), ('LARANJA (MP)', .03)],
 '90051': [('DOCE DE AMBROSIA (MP)', 170), ('COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)', 1)],
 '90052': [('COCADA BRANCA (MP)', .15), ('COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)', 1)],
}
# Escolhas do Vendas -> componente (product name no Vendas, grupo, opção, componente)
ESCOLHAS = [('Moqueca ou Ensopado de Camarão (200g)', IND), ('Moqueca ou Ensopado de Pescada Individual', IND),
            ('Moqueca ou Ensopado de Camarão (400g)', BIG), ('Moqueca ou Ensopado de Pescada (500g)', BIG),
            ('Moqueca ou Ensopado de Pescada e Camarão', BIG), ('Moqueca ou Ensopado de Filé de Pescada (500g)', BIG),
            ('Moqueca ou Ensopado de Filé de Pescada e Camarão', BIG)]
OPCOES = [(p, 'Preparo', 'Moqueca', f'Preparo Moqueca - {t} (PI)') for p, t in ESCOLHAS] + \
         [(p, 'Preparo', 'Ensopado', f'Preparo Ensopado - {t} (PI)') for p, t in ESCOLHAS] + [
  ('Carne do Sol (300g)', 'Acompanhamento', 'Batata frita', 'Porção de Batata Frita (acompanhamento da Carne do Sol) (PI)'),
  ('Carne do Sol (300g)', 'Acompanhamento', 'Farofa', 'Porção de Farofa (acompanhamento da Carne do Sol) (PI)'),
  ('Acarajé ou Abará', 'Escolha', '8 bolinhos de acarajé', 'Acarajé - 8 bolinhos (PI)'),
  ('Acarajé ou Abará', 'Escolha', '6 mini abarás', 'Mini Abará - 6 unidades (PI)')]
# Famílias dos 49 vendáveis (nomes da Donana)
FAM_VEND = {'GELADAS COM ALCOOL': '90057 90058 90059 90060 90061', 'GELADAS SEM ALCOOL': '90018 90019 90021 90022 90023 90024 90025 90026',
            'DRINKS': '90062 90063 90064 90065 90017', 'ENTRADA / PETISCOS': '90027 90028 90029 90030 90031 90032 90055 90056 90020 90054 90033 90034 90035 90039',
            'MOQUECAS OU ENSOPADOS': '90040 90041 90043 90045 90037', 'ESPECIAIS C/ CAMARÃO': '90044 90046', 'DO MAR': '90047 90036',
            'GUARNIÇÕES': '90038 90042 90048 90049 90050', 'SOBREMESA': '90051 90052 90053'}
TESTE = ['70001', '70002'] + [f'800{i:02d}' for i in range(1, 17)] + [f'900{i:02d}' for i in range(1, 17)]


def lit(s): return "'" + str(s).replace("'", "''") + "'"


def main():
    o = []
    w = o.append
    w('-- GERADO por scripts/odara/fichas-odara.py (não editar à mão). Estoque, banco postgres. Ver docstring do gerador.')
    w('begin;')
    w("""create function pg_temp.fam(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_familia into v from familias where loja_id = 15 and lower(nome) = lower(p_nome) order by inativo, id limit 1;
  if v is null then
    insert into familias (loja_id, codigo_familia, nome, inativo, origem) values (15, nextval('seq_id_produto_proprio'), p_nome, false, 'local') returning codigo_familia into v;
  else update familias set inativo = false where loja_id = 15 and codigo_familia = v and inativo; end if;
  return v;
end $f$;""")
    w("""create function pg_temp.prod(p_nome text, p_un text, p_ncm text, p_tipo text, p_fam text) returns bigint language plpgsql as $f$
declare v bigint; v_cod text; v_f bigint := pg_temp.fam(p_fam);
begin
  select codigo_produto into v from produtos where loja_id = 15 and descricao = p_nome and not inativo and codigo not like '[%' order by id limit 1;
  if v is null then
    v_cod := proximo_codigo_produto(15, p_tipo); v := novo_id_produto_proprio();
    insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
    values (15, v, v_cod, p_nome, p_un, p_ncm, 0, false, p_tipo, v_f, p_fam, false, now());
  else
    update produtos set codigo_familia = v_f, descricao_familia = p_fam where loja_id = 15 and codigo_produto = v;
  end if;
  return v;
end $f$;""")
    w("""create function pg_temp.cp(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_produto into v from produtos where loja_id = 15 and (descricao = p_nome or codigo = p_nome) and not inativo order by id limit 1;
  if v is null then raise exception 'produto não encontrado: %', p_nome; end if;
  return v;
end $f$;""")
    w("""create function pg_temp.ficha(p_prod text, p_expandir boolean, p_itens jsonb) returns void language plpgsql as $f$
declare v_p bigint := pg_temp.cp(p_prod); v_itens jsonb := '[]'::jsonb; i jsonb;
begin
  if exists (select 1 from fichas_tecnicas where loja_id = 15 and codigo_produto = v_p and ativa and criada_por = 'fichas-odara') then return; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    v_itens := v_itens || jsonb_build_object('codigo_insumo', pg_temp.cp(i ->> 0), 'quantidade_liquida', (i ->> 1)::numeric, 'fator_correcao', 1);
  end loop;
  perform salvar_ficha(15, v_p, 1, v_itens, p_expandir, 'fichas-odara', 'Estrutura baseada na Donana (Omie), adaptada à porção da ODARA');
end $f$;""")

    # 1) limpeza do teste
    w('-- 1) Cardápio/insumos de teste: zera saldo com ajuste, desativa fichas, inativa, marca [Teste]; apaga o que não tem movimento')
    tl = ','.join(lit(c) for c in TESTE)
    w(f"""do $$ declare r record; begin
  for r in select s.codigo_local_estoque, s.codigo_produto, s.saldo from estoque_saldos s join produtos p on p.loja_id = 15 and p.codigo_produto = s.codigo_produto
            where s.loja_id = 15 and s.saldo <> 0 and p.codigo in ({tl}) loop
    perform registrar_movimento(15, r.codigo_local_estoque, r.codigo_produto, 'AJU', 'AJUSTE', 'limpeza-teste-odara-2026-10-07', -r.saldo, null, 'fichas-odara', 'Zera saldo de teste (semente/QA): estoque real começa no primeiro inventário');
  end loop;
  update fichas_tecnicas set ativa = false where loja_id = 15 and ativa and codigo_produto in (select codigo_produto from produtos where loja_id = 15 and codigo in ({tl}));
  for r in select codigo_produto, codigo from produtos where loja_id = 15 and codigo in ({tl}) loop
    if not exists (select 1 from estoque_movimentos m where m.loja_id = 15 and m.codigo_produto = r.codigo_produto)
       and not exists (select 1 from ficha_tecnica_itens fi where fi.loja_id = 15 and fi.codigo_insumo = r.codigo_produto)
       and not exists (select 1 from fichas_tecnicas ft where ft.loja_id = 15 and ft.codigo_produto = r.codigo_produto) then
      begin
        delete from produtos where loja_id = 15 and codigo_produto = r.codigo_produto;
        continue;
      exception when foreign_key_violation then null; end;
    end if;
    update produtos set inativo = true, grupo_id = null, pdv = false,
           descricao = case when descricao like '[Teste]%' then descricao else '[Teste] ' || descricao end
     where loja_id = 15 and codigo_produto = r.codigo_produto;
  end loop;
end $$;""")
    w("update familias set inativo = true where loja_id = 15 and nome in ('Insumos de bar', 'Insumos de cozinha', 'Pratos e petiscos');")
    w("""do $$ begin
  update produtos set grupo_id = null where loja_id = 15 and grupo_id in (select id from grupos_produto where loja_id = 15 and not ativo);
  delete from grupos_produto where loja_id = 15 and not ativo;
exception when others then raise notice 'grupos de teste ficaram inativos: %', sqlerrm; end $$;""")

    # 2) cadastro MP/PI
    w('-- 2) Matérias-primas e produtos em processo (nome/unidade/NCM/tipo/família da Donana)')
    for line in DONANA.splitlines():
        _, nome, un, ncm, tipo, fam = line.split('|')
        w(f'select pg_temp.prod({lit(nome)}, {lit(un)}, {lit(ncm)}, {lit(tipo)}, {lit(fam)});')
    for line in NOVOS.splitlines():
        nome, un, ncm, tipo, fam = line.split('|')
        w(f'select pg_temp.prod({lit(nome)}, {lit(un)}, {lit(ncm)}, {lit(tipo)}, {lit(fam)});')

    # 3) famílias dos vendáveis
    w('-- 3) Família de todos os vendáveis (nomes da Donana)')
    for fam, cods in FAM_VEND.items():
        cl = ','.join(lit(c) for c in cods.split())
        w(f"update produtos set codigo_familia = pg_temp.fam({lit(fam)}), descricao_familia = {lit(fam)} where loja_id = 15 and codigo in ({cl});")

    # 4) fichas
    w('-- 4) Sub-receitas dos PI (saem do estoque do PI; a OP de preparo consome a MP), componentes de escolha (abrem na venda) e pratos')
    for nome, itens in PI.items():
        w(f"select pg_temp.ficha({lit(nome)}, false, {lit(json.dumps(itens, ensure_ascii=False))}::jsonb);")
    for nome, itens in COMP.items():
        w(f"select pg_temp.ficha({lit(nome)}, true, {lit(json.dumps(itens, ensure_ascii=False))}::jsonb);")
    for cod, itens in FICHAS.items():
        w(f"select pg_temp.ficha({lit(cod)}, false, {lit(json.dumps(itens, ensure_ascii=False))}::jsonb);")

    # 5) conferência
    w("""select 'sem família' as k, count(*) from produtos where loja_id = 15 and not inativo and codigo_familia is null
union all select 'ativos', count(*) from produtos where loja_id = 15 and not inativo
union all select 'fichas ativas', count(*) from fichas_tecnicas where loja_id = 15 and ativa
union all select 'saldo de teste', count(*) from estoque_saldos s join produtos p on p.loja_id = 15 and p.codigo_produto = s.codigo_produto where s.loja_id = 15 and s.saldo <> 0 and p.inativo;""")
    print('\n'.join(o))


def vendas_sql():
    o = ['-- GERADO por scripts/odara/fichas-odara.py. Banco ntb_vendas: código do componente em cada escolha + [Teste] no cardápio antigo.', 'begin;']
    for prod, grupo, opcao, comp in OPCOES:
        o.append(f"""update product_options po set omie_codigo = %s
  from product_option_groups g join products p on p.id = g.product_id
 where po.group_id = g.id and p.store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94' and p.available and p.name = {lit(prod)} and g.name = {lit(grupo)} and po.name = {lit(opcao)};""" % ('{COD:' + comp + '}'))
    o.append("update products set name = '[Teste] ' || name where store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94' and not available and name not like '[Teste]%';")
    o.append("""select p.name, g.name, po.name, po.omie_codigo from products p join product_option_groups g on g.product_id = p.id join product_options po on po.group_id = g.id
 where p.store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94' and p.available order by 1, 3;""")
    return '\n'.join(o)


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'vendas':
        print(vendas_sql())
    else:
        main()
