import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { TabelaDinamica } from '@/components/relatorios/TabelaDinamica'
import { CUBOS, PRESETS, presetPorSlug, type IdCubo } from '@/lib/relatorios/catalogo'

type Sp = { preset?: string; ini?: string; fim?: string; mes?: string }

export default async function RelatorioDinamicoPage({ params, searchParams }: { params: Promise<{ cubo: string }>; searchParams: Promise<Sp> }) {
  await exigirDev()
  const { cubo } = await params
  if (!(cubo in CUBOS)) notFound()
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const sp = await searchParams
  const def = CUBOS[cubo as IdCubo]
  const preset = presetPorSlug(sp.preset ?? '') ?? PRESETS.find((p) => p.cubo === cubo)
  if (!preset || preset.cubo !== cubo) notFound()

  const hoje = hojeBahiaISO()
  const p = lerPeriodo(sp, hoje, 3660)

  return (
    <div className="space-y-4">
      <PageHeader title={preset.titulo} description={preset.pergunta} voltarHref="/relatorios" />
      <PeriodoBar basePath={`/relatorios/dinamico/${cubo}`} params={{ preset: preset.slugOmie }} ini={p.ini} fim={p.fim} hoje={hoje} />
      <TabelaDinamica key={preset.slugOmie} cubo={cubo} slug={preset.slugOmie} campos={def.campos} layoutInicial={preset.layout} ini={p.ini} fim={p.fim} />
    </div>
  )
}
