// Molas do redesign estilo Apple (mesmos valores do NTB Vendas, 2026-09-26).
// SPRING_UI: padrão da interface, sem quique. SPRING_TAP: feedback de toque.
// SPRING_SHEET: folhas/gavetas, quique leve como o drawer do iOS.
export const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.35 }
export const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 }
export const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 }
