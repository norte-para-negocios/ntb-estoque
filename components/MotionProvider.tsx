'use client'

import { MotionConfig } from 'motion/react'

// Todo movimento do motion/react respeita "reduzir movimento" do sistema:
// com a preferência ligada, as molas viram troca instantânea/fade.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
