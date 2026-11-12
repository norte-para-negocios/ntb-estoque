import type { Metadata } from 'next'
import { LogoNegocios } from '@/components/plataforma/logo-negocios'
import { IDENTIDADE } from '@/components/plataforma/simbolos'
import type { ModuloId } from '@/lib/plataforma/modulos-puro'
import { FormEntrar } from './FormEntrar'

export const metadata: Metadata = { title: 'Entrar · Norte' }

const FAMILIA: { id: ModuloId; nome: string }[] = [
  { id: 'vendas', nome: 'Vendas' },
  { id: 'erp', nome: 'ERP' },
  { id: 'cozinha', nome: 'Cozinha' },
  { id: 'pacioli', nome: 'Pacioli' },
]
const ROTA = 'M180 -20 C 260 120, 520 90, 560 230 S 430 420, 600 500 S 760 560, 720 640'

export default function EntrarPage() {
  return (
    <main className="pn-login">
      <section className="pn-lado" aria-label="Norte para Negócios">
        <svg className="pn-rota" viewBox="0 0 700 900" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d={ROTA} />
          <path className="pn-tinta" d={ROTA} />
        </svg>
        <LogoNegocios className="pn-logo" />
        <div className="pn-frase">
          <h1 className="serif">Bom te ver de novo.</h1>
          <p>Uma conta para vender, controlar o estoque, saber o custo de cada prato e ter o Pacioli do seu lado.</p>
          <ul className="pn-familia" aria-label="Módulos da Norte">
            {FAMILIA.map(({ id, nome }) => {
              const { cor, Simbolo } = IDENTIDADE[id]
              return (
                <li key={id}>
                  <i style={{ background: cor }}><Simbolo /></i>
                  {nome}
                </li>
              )
            })}
          </ul>
        </div>
      </section>
      <section className="pn-form">
        <FormEntrar />
      </section>
    </main>
  )
}
