# Estratégia de economia de espaço — Supabase free (17/06/2026)

## Limites (free tier)
- **Banco (Postgres): 500 MB** — é o limite apertado.
- **Storage (arquivos): 1 GB** — SEPARADO do banco. É aqui que vai o arquivo morto.
- **Omie**: fonte infinita (8 anos), sempre disponível para re-puxar.

## Ganhos já aplicados (banco: 293 → 240 MB)
1. **Logs** (`integration_attempts`): 53 → 7 MB; cron prune agora poda sucesso > 2d, erro > 30d.
2. **posicao_estoques**: corrigido o acúmulo (upsert tinha `data_posicao` na chave → 1 foto/dia,
   288k linhas). Agora o sync **apaga as fotos antigas da loja** ao gravar a do dia. 60 → 21 MB.
3. **ordens_producao**: apagadas 1.520 OPs < 2026 (lixo do backfill por conclusão). → 97 MB.

## A forma funcional (3 camadas) — DECISÃO: arquivo morto no Supabase Storage
1. **Quente (Postgres):** operacional + janela recente (proposto: ano corrente / últimos 12 meses).
2. **Frio (Supabase Storage):** histórico antigo exportado em `.json.gz` no bucket `arquivo-morto`,
   e **apagado do Postgres**. O Storage (1 GB) não conta nos 500 MB do banco.
3. **Restore on demand:** ao consultar período arquivado, baixa o `.json.gz`, carrega numa tabela
   `*_temp`, mostra, e um TTL limpa depois. (Fallback: re-puxar do Omie, que também tem tudo.)

## Mecanismo de offload (a implementar — próxima leva)
- **Bucket** `arquivo-morto` (privado) no Supabase Storage.
- **Endpoint/cron mensal** `/api/cron/arquivar`: para cada tabela de histórico (movimentos_historico,
  ordens_producao, notas_fiscais), pega o mês que saiu da janela quente, exporta as linhas em
  `tabela/AAAA-MM.json.gz`, faz upload no Storage e `delete` do Postgres.
- **Naming:** `movimentos_historico/2026-01.json.gz`, `ordens_producao/2026-01.json.gz`, etc.
- **Marca d'água:** uma tabela `arquivos_mortos(tabela, periodo, path, linhas, criado_em)` registra o
  que está arquivado, para a UI saber oferecer "carregar do arquivo".
- **Restore** `/api/cron/restaurar?tabela=&periodo=`: baixa o `.json.gz`, descomprime, insere em
  `tabela_temp` (ou na própria, marcado), com TTL de limpeza.

## Janela quente sugerida
- Movimentos/OP/NF: manter **2026 inteiro** enquanto couber (banco ~240 MB, sobra folga). Quando
  apertar (~400 MB), arquivar os meses mais antigos automaticamente. Cron mensal cuida disso.

## Próximos passos
1. (feito) limpeza pontual + correção do acúmulo de posição.
2. Criar bucket `arquivo-morto` + tabela `arquivos_mortos`.
3. Endpoint `/api/cron/arquivar` (export → Storage → delete) + agendar mensal.
4. Endpoint `/api/cron/restaurar` + botão "carregar do arquivo" nas telas de histórico.
