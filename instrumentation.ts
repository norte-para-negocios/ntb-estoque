// instrumentation.ts
// Hook oficial do Next.js (estavel desde v15, sem flag experimental) --
// roda uma vez quando uma nova instancia do servidor sobe, antes de aceitar
// requisicoes. So inicia o monitor no runtime Node (nao no Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { iniciarMonitorDeSaude } = await import('@/lib/failover/health-monitor')
    iniciarMonitorDeSaude()
  }
}
