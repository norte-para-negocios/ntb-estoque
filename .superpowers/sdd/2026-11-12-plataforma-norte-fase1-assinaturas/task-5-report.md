# Task 5 report
- RED: acoes-modulo.test.ts sem o módulo falhou (import); GREEN: 2/2 após implementar. `node --test lib/plataforma/*.test.ts`: 8 pass.
- Script inserir-guarda-modulo.mjs: 244 guardas em 57 arquivos (+57 imports); 2ª execução: 0. inserir-via-desktop: 0 inseridas, 269 ações (registro inalterado).
- exigirDevAcao removido (com import) de cozinha-cardapios, cozinha-receitas, cozinha-eventos, custo-cardapio.
- tsc limpo, eslint limpo, npm test 1438/1438.
- Desvio: `auth` também é livre (login roda sem sessão; guardaModulo chamaria getProfile e quebraria o login). O script pula arquivos livres.
- Concerns: convite (admin) fica em erp por ordem do brief; central/central-numeros também erp. exigirDevAcao segue em outras actions (financeiro, nfe-saida, devolucao-fornecedor...), fora do escopo.
- Guarda vem depois do viaDesktop: no app desktop (offline) a guarda não roda.

## Fix round 1
- 1: 4 retry* de cron (ordem-producao, inventario, movimentacoes, transferencia) sem guarda; lista SEM_GUARDA (nome completo) no script, que agora sincroniza (remove guardas antigas/indevidas e reinsere).
- 2: LEITURAS_EXTRA em acoes-modulo.ts (7 nomes); `barraAcao(acesso, politica, nome)`; politica.ts intocado. Teste "leitura extra passa em suspenso".
- 3: livres += convite, onboarding-loja, integracao-ntb-vendas, sync-status, central, central-numeros (guardas removidas pelo script); teste estendido.
- 4: guardaModulo -> Promise<{error}|null> (nunca lança por bloqueio; fail-open mantido); linha: `const __g = await guardaModulo('<nome>'); if (__g) return __g as never`.
- Resultado: 226 guardas; script 1ª rodada alterou 57 arquivos, 2ª = 0; inserir-via-desktop 0 / 269 ações; node --test plataforma 9 pass; tsc limpo; eslint limpo; npm test 1439/1439.

## Fix round 2
- notificacoes e busca-global agora livres (guardas removidas pelo script: 2 arquivos).
- barraAcao(acesso, politica|null, nome): vitrine barra tudo; abre nada; consulta barra só política local/fila/depende ou 1ª palavra camelCase da ação na lista de verbos de escrita (LEITURAS_EXTRA continua passando). Resto passa (fail open).
- Testes: 15 pass em lib/plataforma (casos do controller + salvarTudo/daqui). Script: 1ª rodada 2 arquivos, 2ª = 0; guardas 222; inserir-via-desktop 0 inseridas (registro git inalterado; 271 ações lidas); tsc e eslint limpos; npm test 1445/1445.
