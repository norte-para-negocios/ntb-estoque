import type { Metadata } from 'next'
import { CircleAlert } from 'lucide-react'
import { exigirDev } from '@/lib/recursos-dev'
import { createServiceClient } from '@/lib/supabase/server'
import { ESTADOS, MODULOS, type Estado } from '@/lib/plataforma/modulos-puro'
import { ordenarLojas, tabelaAusente } from '@/lib/plataforma/admin-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { MatrizModulos, type Gravada, type LojaLinha } from '@/components/plataforma/MatrizModulos'
import { COR_ESTADO, ROTULO_ESTADO } from '@/components/plataforma/estados'
import { Precos } from '@/components/plataforma/Precos'

// Plataforma Norte (fase 1): o que cada loja tem de cada módulo e o preço de cada plano. Só a equipe da Norte
// (ROTAS_SO_DEV). Lê com service role: a tela mostra todas as lojas ativas, reais primeiro e depois as de teste.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Módulos das lojas' }

const LEGENDA: Record<Estado, string> = {
  ativo: 'Abre para todo mundo da loja, conforme o cargo.',
  teste: 'Só a equipe da Norte vê. Bom para piloto.',
  bloqueado: 'A loja vê a página do módulo, com o que ele faz.',
  suspenso: 'Consulta sim, lançar não. O caixa do Vendas nunca para.',
}

export default async function PlataformaModulosPage() {
  await exigirDev()
  const sb = createServiceClient()
  const [lojasR, assinaturasR, planosR] = await Promise.all([
    sb.from('lojas').select('id, nome, nome_fantasia, is_test').eq('ativo', true),
    sb.from('plataforma_assinaturas').select('erp_loja_id, modulo_id, estado, plano_id, preco_combinado'),
    sb.from('plataforma_planos').select('id, preco_mensal'),
  ])
  const ausente = tabelaAusente(assinaturasR.error) || tabelaAusente(planosR.error)
  const outroErro = !ausente ? (assinaturasR.error ?? planosR.error) : null

  const lojas: LojaLinha[] = ordenarLojas(((lojasR.data ?? []) as { id: number; nome: string; nome_fantasia: string | null; is_test: boolean | null }[])
    .map((l) => ({ id: l.id, nome: l.nome_fantasia || l.nome, is_test: l.is_test === true })))

  const gravadas: Record<string, Gravada> = {}
  for (const a of (assinaturasR.data ?? []) as { erp_loja_id: number; modulo_id: string; estado: string; plano_id: string | null; preco_combinado: number | string | null }[]) {
    const estado = ESTADOS.find((e) => e === a.estado)
    if (!estado || !MODULOS.some((m) => m.id === a.modulo_id)) continue
    gravadas[`${a.erp_loja_id}:${a.modulo_id}`] = {
      estado, plano_id: a.plano_id, preco_combinado: a.preco_combinado == null ? null : Number(a.preco_combinado),
    }
  }
  const precos: Record<string, number | null> = {}
  for (const p of (planosR.data ?? []) as { id: string; preco_mensal: number | string | null }[]) {
    precos[p.id] = p.preco_mensal == null ? null : Number(p.preco_mensal)
  }
  const travado = ausente || !!outroErro

  return (
    <div className="pb-10">
      <PageHeader title="Módulos de cada loja" description="Só a equipe da Norte vê esta tela. Mudou aqui, muda na hora o que a loja enxerga." />

      {ausente && (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-[var(--r-lg)] bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Tabelas da plataforma ainda não aplicadas (migration 475). Todas as lojas seguem no padrão e nada pode ser salvo.
        </p>
      )}
      {outroErro && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[14px] text-err">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Não foi possível ler as assinaturas agora: {outroErro.message}
        </p>
      )}
      {lojasR.error && (
        <p role="alert" className="mb-4 rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[14px] text-err">Não foi possível ler as lojas: {lojasR.error.message}</p>
      )}

      <MatrizModulos lojas={lojas} gravadas={gravadas} desabilitado={travado} />

      <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="O que cada estado faz">
        {ESTADOS.map((e) => (
          <li key={e} className="text-[13px] leading-[1.45] text-text-muted">
            <span className={`mb-1 inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold ${COR_ESTADO[e]}`}>{ROTULO_ESTADO[e]}</span>
            <span className="block">{LEGENDA[e]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-text-muted">“padrão” = a loja não tem nada gravado e segue como sempre foi. No seletor, “Voltar ao padrão” apaga o que foi gravado.</p>

      <section aria-labelledby="precos-titulo" className="mt-14">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="precos-titulo" className="text-[22px] font-bold tracking-[-0.02em] text-text">Preços</h2>
          <p className="text-[13px] text-text-muted">Vazio fica como “definir”. Nada daqui vai para o site nem para o cliente.</p>
        </div>
        <Precos precos={precos} desabilitado={travado} />
      </section>
    </div>
  )
}
