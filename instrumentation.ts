// instrumentation.ts
// Hook oficial do Next.js (estavel desde v15, sem flag experimental) --
// roda uma vez quando uma nova instancia do servidor sobe, antes de aceitar
// requisicoes.
//
// Ficou vazio em 2026-08-01: a unica coisa que rodava aqui era o monitor de
// saude do failover (lib/failover/health-monitor.ts), removido junto com o
// resto do mecanismo quando o Contabo virou o primario definitivo. O arquivo
// foi mantido (em vez de deletado) porque o Next.js so chama `register` se ele
// existir -- e o proximo hook de bootstrap que precisarmos entra aqui.
export async function register() {
  // sem inicializacao pendente
}
