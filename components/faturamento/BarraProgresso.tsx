// Barra de progresso horizontal. `pct` pode passar de 100 (a barra enche e o texto mostra o valor real).
// `marcadorPct` (opcional) desenha um traco onde "deveria estar" agora.
export function BarraProgresso({
  pct, marcadorPct, altura = 'h-3', cor = 'bg-brand', rotulo,
}: { pct: number | null; marcadorPct?: number; altura?: string; cor?: string; rotulo: string }) {
  const largura = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div className="relative" role="progressbar" aria-label={rotulo} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(largura)}>
      <div className={`${altura} w-full overflow-hidden rounded-full bg-surface-2`}>
        <div className={`${altura} rounded-full ${cor} u-motion`} style={{ width: `${largura}%` }} />
      </div>
      {marcadorPct != null && (
        <div
          className="absolute -top-1 bottom-[-4px] w-0.5 rounded bg-warn"
          style={{ left: `${Math.max(0, Math.min(100, marcadorPct))}%` }}
          title={`Onde deveria estar hoje: ${marcadorPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
        />
      )}
    </div>
  )
}
