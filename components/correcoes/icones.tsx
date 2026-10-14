// Ícones da Central de correções (traço, os mesmos do protótipo aprovado).
import s from './central.module.css'

const P: Record<string, React.ReactNode> = {
  chev: <path d="m9 18 6-6-6-6" />,
  voltar: <path d="m15 18-6-6 6-6" />,
  fechar: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  eyeoff: <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.1 6.1A17 17 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4.2-1" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  op: <><path d="M4 20V10l5 3V10l5 3V6h6v14Z" /><path d="M8 17h1M12 17h1M16 17h1" /></>,
  nota: <><path d="M6 3h9l4 4v14H6Z" /><path d="M14 3v5h5M9 12h7M9 16h7" /></>,
  cupom: <><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z" /><path d="M10 6v12" strokeDasharray="2 2" /></>,
  ajuste: <><path d="M9 4h6v3H9z" /><path d="M8 5H6v16h12V5h-2" /><path d="m9 14 2 2 4-4" /></>,
  alert: <><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  externo: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>,
  robo: <><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6" /></>,
}

export function Ic({ n, sm, className }: { n: keyof typeof P | string; sm?: boolean; className?: string }) {
  return (
    <svg className={`${s.i} ${sm ? s.sm : ''} ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">{P[n] ?? null}</svg>
  )
}

export const ICONE_ALVO: Record<string, string> = { produto: 'box', op: 'op', nota: 'nota', cupom: 'cupom', ajuste: 'ajuste' }
