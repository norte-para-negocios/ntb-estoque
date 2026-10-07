import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck, ClipboardList, Scale } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnLinhaClass } from '@/components/ui-kit/Button'
import { Indicador, fmtBRL } from '@/components/estoque-proprio/Apresentacao'
import { NovaContagem } from '@/components/inventario-proprio/NovaContagem'
import { LimiteMotivo } from '@/components/inventario-proprio/LimiteMotivo'
import { carregarLocais, contarPorClasse, limiteMotivo, listarInventarios, type ResumoInventario } from './dados'

const STATUS = {
  aberto: { rotulo: 'Em contagem', ponto: 'bg-warn' },
  fechado: { rotulo: 'Fechada', ponto: 'bg-ok' },
  cancelado: { rotulo: 'Cancelada', ponto: 'bg-text-muted/50' },
} as const

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export default async function InventarioProprioPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) notFound()
  const [podeCriar, podeEditar] = await Promise.all([requirePermissao(lojaId, 'Inventarios - Criar'), requirePermissao(lojaId, 'Inventarios - Editar')])

  const [lista, locais, porClasse, limite] = await Promise.all([listarInventarios(lojaId), carregarLocais(lojaId), contarPorClasse(lojaId), limiteMotivo(lojaId)])
  const abertas = lista.filter((i) => i.status === 'aberto')
  const trintaDias = Date.now() - 30 * 24 * 3600 * 1000
  const fechadasMes = lista.filter((i) => i.status === 'fechado' && i.fechadoEm && new Date(i.fechadoEm).getTime() >= trintaDias)
  const ajusteMes = fechadasMes.reduce((a, i) => a + (i.valorAjustes ?? 0), 0)

  const colunas: Coluna<ResumoInventario>[] = [
    {
      label: 'Contagem', primaria: true, flexivel: true,
      render: (i) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-text">{i.descricao || `Contagem #${i.id}`}</span>
          <span className="text-[12px] text-text-muted">{i.local} · {i.tipo === 'ciclica' ? `cíclica, curva ${i.classe}` : 'geral'}</span>
        </div>
      ),
    },
    {
      label: 'Situação',
      render: (i) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text">
          <span className={`size-2 rounded-full ${STATUS[i.status].ponto}`} />{STATUS[i.status].rotulo}
        </span>
      ),
    },
    {
      label: 'Progresso', ocultarMobile: false,
      render: (i) => i.status === 'cancelado' ? <span className="text-text-muted">—</span> : (
        <div className="w-28">
          <span className="num text-[13px]">{i.contados} de {i.totalItens}</span>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${i.totalItens ? Math.min(100, (i.contados / i.totalItens) * 100) : 0}%` }} /></div>
        </div>
      ),
    },
    { label: 'Aberta em', alinhar: 'right', ocultarMobile: true, render: (i) => <span className="num text-[13px]">{data(i.abertoEm)}</span> },
    { label: 'Ajuste', alinhar: 'right', render: (i) => i.valorAjustes == null ? <span className="text-text-muted">—</span> : <span className={`num ${i.valorAjustes < 0 ? 'text-err' : ''}`}>{fmtBRL(i.valorAjustes)}</span> },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Contagens" description="Contagem cega por local: quem conta não vê o saldo do sistema"
          actions={podeCriar ? <NovaContagem locais={locais} porClasse={porClasse} /> : undefined} />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={ClipboardList} rotulo="Em contagem" valor={String(abertas.length)} tom={abertas.length ? 'aviso' : undefined} dica="abertas agora" />
        <Indicador icon={ClipboardCheck} rotulo="Fechadas em 30 dias" valor={String(fechadasMes.length)} />
        <Indicador icon={Scale} rotulo="Ajuste líquido (30 dias)" valor={fmtBRL(ajusteMes)} tom={ajusteMes < 0 ? 'erro' : undefined} dica="a custo médio" />
        <Indicador icon={ClipboardList} rotulo="Curva A" valor={String(porClasse.A)} dica="itens para contar toda semana" />
      </div>

      <LimiteMotivo valor={limite} podeEditar={podeEditar} />

      <Lista
        colunas={colunas} linhas={lista} chaveLinha={(i) => i.id}
        acao={(i) => i.status === 'aberto' ? (
          <span className="flex gap-1.5">
            {podeCriar && <Link href={`/inventario-proprio/${i.id}/contar`} className={btnLinhaClass('outline')}>Contar</Link>}
            {podeEditar && <Link href={`/inventario-proprio/${i.id}/revisar`} className={btnLinhaClass('primary')}>Revisar</Link>}
          </span>
        ) : i.status === 'fechado' && podeEditar ? <Link href={`/inventario-proprio/${i.id}/revisar`} className={btnLinhaClass('outline')}>Ver</Link> : null}
        vazio={<EmptyState icon={ClipboardCheck} title="Nenhuma contagem ainda" hint="Abra uma nova contagem para conferir o estoque de um local, sem ver o saldo do sistema." />}
      />
    </div>
  )
}
