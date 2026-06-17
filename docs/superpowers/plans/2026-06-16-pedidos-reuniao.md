# Pedidos da reunião 16/06/2026 (Joaquim + Ramon, teste ao vivo, 1h05)

> Gravação + transcrição em `Videos/Reunioes Joaquim - NTB/2026-06-16/`
> (`2026-06-16 reuniao-ntb.mp4`, `transcricao-completa.txt` com timestamps, `transcricao-bruta.txt`).
> Transcrição automática (faster-whisper) — alguns nomes/termos saíram aproximados; o sentido foi conferido frase a frase.

## ✅ Validado / funcionando na reunião
- **Etiqueta de NF pendente**: o sistema NÃO deixa imprimir etiqueta de nota pendente (comportamento correto). Questão de quantidade decimal na etiqueta (3,9 → arredondou 4) ficou de observação.
- **Conclusão de OP retroativa**: testou OP de 10/06 e concluiu na data 10/06 (não na de hoje) — ok no Omie. (Mas ainda há caso concluindo na data de hoje — ver Bugs.)
- **Criar OP no layout de transferência** (busca em cima, produtos descendo, mais recente no topo, validade por item, recorrência) — funcionando; criou 8 OPs recorrentes e bateu no Omie (14/07, etc).
- **Transferência** (busca, contagem, finalizar, imprimir) — funcionou. PEPS testado.
- **Inventário permite zero; transferência não** — correto.
- **Estoque mínimo do Omie** aparecendo na tela de Compras; **"Só repor"** mostrando só os abaixo do mínimo.
- **Cadastro de produto novo** criou e **sincronizou** no Omie (apareceu de volta).
- **Layout geral** — bastante elogiado ("muito melhor", mobile melhorando).
- **Histórico no Omie**: transferências, OPs e inventários estão todos lá.

## 🔴 Bugs a corrigir
1. **Validade na recorrência da OP** (IMPORTANTE): todas as OPs recorrentes herdam a MESMA data de validade da 1ª. Deveria ser **data de cada ocorrência + X dias** (1ª 23/06 +30d; 2ª 30/06 +30d; etc.).
2. **Concluir OP na data de hoje** (alguns casos): conclui na data de hoje em vez da data prevista, e **não dá opção de escolher a data**. Pedido: sempre concluir na data prevista + permitir escolher a data.
3. **Faltam produtos na lista de criar OP**: ao buscar os 70mil (produção), não aparecem todos. A busca dentro da tela de OP pode estar truncando — investigar.
4. **Código colado na descrição**: numa das telas o código vem junto do nome; deveria ser **coluna de código separada** da descrição.
5. **Editar estoque mínimo não salva/envia**: "tentei editar, não edita". Editar o mínimo no NTB deve refletir no Omie — verificar o input e o envio.
6. **Erro "não será possível gerar movimento de estoque"** ao concluir OP: ocorre quando falta saldo do insumo no local (ex.: água de coco no bar). É regra do Omie — o sistema deve **tratar e mostrar claro qual insumo faltou**.
7. **Conclusão em lote x tempo do Omie**: o Omie não deixa concluir outra OP enquanto processa a anterior. Qualquer ação em lote tem que respeitar o intervalo (fila).

## 🟠 Ajustes / UX
- **"Buscar na lista"** nas telas de criar OP/transferência: além da busca geral (que varre o sistema), ter busca dentro da própria lista (por código) e uma **lista para selecionar produtos** (por família / pegar a lista toda).
- **Coluna de validade muito larga** na lista da OP — afinar.
- **Validade em "X dias"** em vez de data específica (input de dias que calcula a data) — pedido repetido, vale para OP.
- **Reverter conclusão** da OP (botão "reverter" = cancela a conclusão e volta o status) + **excluir** OPs abertas (com permissão).
- **Permissão de excluir** no perfil/cadastro (produção e produto) — verificar/adicionar.
- **Relatório/conferência da transferência**: tirar os números/códigos, deixar só o nome do local.
- **Observação da transferência**: preencher automaticamente **quem fez** (usuário logado).
- **Filtro de validade**: mais opções.
- **Margem salva no perfil**: a margem-alvo que o usuário define fica salva por perfil.
- **Exportar em Excel (.xlsx)** direto (hoje CSV traz valor com ponto e não calcula); melhorar a densidade/visual da planilha; **imprimir PDF** da sugestão de compra ("imprimir/exportar" com mais opções).
- **Status "prevista"** poderia ir abaixo do produto (baixa prioridade — espaço atual está ok).

## 🆕 Pedidos novos (features)
- **Leitura do QR code / recolhe trazer mais que o código**: nome do produto, informações e até **foto** (revenda = foto online; produto acabado/prato = foto do prato).
- **Alerta de estoque mínimo em 2 níveis**: (1) **chegou** no mínimo = 1º alerta; (2) **baixou** do mínimo = alerta de compra. Hoje só considera abaixo.
- **Alertas por e-mail e WhatsApp** para o gestor quando atingir/baixar do mínimo. Joaquim sugeriu **Evolution API** (free tier ~US$5/mês) para o WhatsApp.
- **Dashboard / Home**: bloco "stocks prestes a ruptura" (próximos da ruptura, zerados, negativos — principais + "ver mais"); últimas notas carregadas; **acessos rápidos** (inventários/transferências abertas — bom no celular); produtos vencendo.
- **Concluir várias OPs atrasadas de uma vez** (lote com filtro), respeitando o tempo do Omie (fila com intervalo).
- **Entrada de produção/produto por WhatsApp com IA** (falar e o sistema lança) — FUTURO, quando houver IA rodando no sistema.

## 🔵 Cadastro de produto — expansão GRANDE
- Hoje falta muita coisa. Campos pedidos: **família** (obrigatório — deu erro), **NCM** (obrigatório — trazer uma **lista de NCM** para escolher), **origem da mercadoria**, **tipo do produto**, **"vendido por loja ou não"** e demais campos fiscais.
- **Botão excluir produto** (não existe ainda).
- Observado: o **código aceita letras**.

## 📊 Relatórios / ambiente BETA
- **Relatórios**: Joaquim começa **hoje à noite** (planilhas do Ramon já em mãos).
- **Link/aba BETA** ("ver beta"): área separada com relatórios + certificado + features novas para as lojas testarem; quando estiver ok, integra no principal.
- Dashboard puxando várias informações.

## 🔌 Certificado, integrações e infra
- **Certificado**: 1 loja já está completa; **Donana Praia do Forte** e **Donana Brotas** não puxaram (são as 2 bloqueadas no Omie). O certificado bloqueia a API; só vieram as informações, não o certificado. **Ramon vai fornecer um certificado** para subir manualmente; depois, puxar as NFs direto via certificado. → confirma quais são as "lojas 5/6".
- **Norte Vendas** (feito pelo André): integrar com o NTB Stock **via API**, mantidos **separados** (objetivos diferentes). Joaquim quer trazer o Vendas para **GitHub + Supabase + Vercel** (sair do servidor Contabo). Alinhar com o André.
- **Acesso ao banco deles** (token): o André vai gerar o token para puxar dados.

## 📅 Rollout / marketing / próximos passos
- **Reunião com o André: quinta-feira à noite** (18/06) — alinhar integração do Vendas, infra (Contabo x Supabase/Vercel), token e domínio.
- **Reunião com as lojas a partir de quinta**; começar por **Brotas e Sertão** (as que mais trabalham). Virar pelo menos 2 lojas nesta semana.
- **Hoje/amanhã**: deixar rodando perfeito; Joaquim dá mais uma rodada amanhã (17/06).
- **Vídeo de apresentação** das atualizações para o Instagram (NTB Stock / Norte Stock + integrações).

---

### Prioridades sugeridas (do que JÁ dá para atacar sem o Ramon/André)
1. **Bug da validade na recorrência** (#1) — claro e impactante.
2. **Validade em "X dias"** na OP (calcula a data por ocorrência) — resolve junto com o #1.
3. **Concluir OP sempre na data prevista + escolher data** (#2).
4. **Busca de produtos na criação de OP** trazendo todos (#3) + "buscar na lista".
5. **Editar estoque mínimo salvando/enviando** (#5).
6. **Reverter conclusão + excluir OP** (com permissão).
7. **Exportar Excel + PDF** da sugestão de compra; observação automática na transferência.
8. **Cadastro de produto completo** (família, NCM com lista, origem, tipo, vendido por loja) + excluir.
9. **Dashboard/Home** com rupturas, acessos rápidos e vencimentos.
10. **Relatórios** (Joaquim já vai começar) + ambiente **beta**.

> Depende de terceiros: certificado das 2 lojas + NFs via Sefaz (Ramon); integração Norte Vendas, token e migração de infra (André, quinta 18/06); alertas WhatsApp dependem de subir a Evolution API num servidor.
