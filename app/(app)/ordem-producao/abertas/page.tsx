import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ChevronDown, Clock, Factory, PackageCheck, PackageX } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Filtros } from '@/components/ui-kit/Filtros'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { Indicador } from '@/components/estoque-proprio/Apresentacao'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { idadeDias, itensDaOPGravada, situacaoDaOP, ROTULO_ORIGEM_OP, type SituacaoOP } from '@/lib/estoque/ops-tela-puro'
import { LOJA_BLOQUEADA, saldoNoLocalDaOP } from '@/lib/estoque/escrita-omie-puro'
import { CheckOP, LoteOPsProvider } from '@/components/estoque-proprio/LoteOPs'
import { carregarOPsAbertas } from '../../estoque/dados-ops'
import { carregarEstoqueOmie } from '../../estoque/dados-omie'
import { carregarEstoque } from '../../estoque/dados'
import { fmtDataBR } from '../../estoque/dados-comum'

const POR_PAGINA = 50
const DIAS_VELHA = 7
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const SIT: Record<Exclude<SituacaoOP, null>, { rotulo: string; cor: string; dica: string }> = {
  sobrando: { rotulo: 'Sobrando', cor: 'text-warn', dica: 'OP do PDV e o prato já não está negativo no local da OP' },
  faltando: { rotulo: 'Faltando concluir', cor: 'text-err', dica: 'O prato ainda está negativo no local da OP' },
  ok: { rotulo: 'Em dia', cor: 'text-text-muted', dica: '' },
}

type SP = { q?: string; origem?: string; autor?: string; sit?: string; page?: string }

export default async function OPsAbertasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()
  const modo = await modoDaLoja(lojaId)
  const fonte: 'omie' | 'proprio' = modo === 'proprio' ? 'proprio' : 'omie'
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  // Ações em lote no Omie ("nosso Omie" Fase 4): loja Omie, fora a loja 4, com "OP - Acoes em lote" + a permissão da ação.
  const podeLote = modo === 'omie' && lojaId !== LOJA_BLOQUEADA && (await requirePermissao(lojaId, 'OP - Acoes em lote'))
  const pode = {
    concluir: podeLote && (await requirePermissao(lojaId, 'Ordens de Producao - Concluir')),
    excluir: podeLote && (await requirePermissao(lojaId, 'Ordens de Producao - Excluir')),
    data: podeLote && (await requirePermissao(lojaId, 'Ordens de Producao - Editar')),
  }
  const loteAtivo = pode.concluir || pode.excluir || pode.data

  const [{ ops, completa, erro }, visao] = await Promise.all([
    carregarOPsAbertas(lojaId, fonte),
    modo === 'nenhum' ? Promise.resolve(null) : fonte === 'omie' ? carregarEstoqueOmie(lojaId) : carregarEstoque(lojaId),
  ])
  const prod = new Map((visao?.linhas ?? []).map((l) => [l.codigoProduto, l]))
  const nomeLocal = new Map((visao?.locais ?? []).map((l) => [l.codigoLocal, l.descricao]))

  const linhas = ops.map((o) => {
    const cod = o.identificacao_n_cod_produto == null ? null : Number(o.identificacao_n_cod_produto)
    const p = cod != null ? prod.get(cod) : undefined
    const origem = fonte === 'proprio' ? (o.venda_ref ? 'vendas' : 'app') : o.origem_op
    const autor = (fonte === 'proprio' ? o.criada_por : o.incluido_por_omie) ?? null
    const idade = idadeDias(o.dt_inclusao ?? o.created_at, hoje)
    // Sobrando/faltando pelo saldo do LOCAL da OP (sem local na OP = total do prato).
    const localOP = o.identificacao_codigo_local_estoque ? Number(o.identificacao_codigo_local_estoque) : null
    const saldo = p ? saldoNoLocalDaOP(p.locais, localOP, p.saldo) : null
    return {
      o, cod, p, origem, autor, idade, saldo,
      numero: o.identificacao_c_num_op ?? o.num_ordem ?? String(o.id),
      qtd: Number(o.identificacao_n_qtde ?? o.quantidade ?? 0),
      situacao: situacaoDaOP(origem, saldo),
      itens: itensDaOPGravada(o.full_object),
    }
  })

  const q = semAcento(sp.q?.trim() ?? '')
  const filtradas = linhas.filter((l) =>
    (!q || semAcento(`${l.numero} ${l.p?.descricao ?? ''} ${l.p?.codigo ?? ''}`).includes(q)) &&
    (!sp.origem || l.origem === sp.origem) &&
    (!sp.autor || (l.autor ?? '') === sp.autor) &&
    (!sp.sit || (sp.sit === 'velha' ? (l.idade ?? 0) > DIAS_VELHA : l.situacao === sp.sit)),
  ).sort((a, b) => (b.idade ?? -1) - (a.idade ?? -1) || b.o.id - a.o.id)

  const page = Math.max(1, Number(sp.page) || 1)
  const pagina = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  const nSobrando = linhas.filter((l) => l.situacao === 'sobrando').length
  const nFaltando = linhas.filter((l) => l.situacao === 'faltando').length
  const nVelhas = linhas.filter((l) => (l.idade ?? 0) > DIAS_VELHA).length
  const autores = [...new Set(linhas.map((l) => l.autor).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const origens = [...new Set(linhas.map((l) => l.origem).filter((x): x is string => !!x))]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="OPs abertas" voltarHref="/ordem-producao" description={fonte === 'omie' ? 'Todas as ordens de produção abertas no Omie, com quem abriu, há quanto tempo e a ficha gravada em cada uma' : 'Ordens de produção ainda não concluídas'} />
      </ListaHeader>
      <EstoqueAtalhos atual="ops" />

      {(!completa || erro) && (
        <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-warn">
          {!completa && <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> O espelho completo das OPs não está ligado nesta loja: aparecem só as OPs abertas que a sincronização de sempre já trouxe (pode faltar OP antiga).</p>}
          {erro && <p>Não foi possível ler as OPs: {erro}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={Factory} rotulo="Abertas" valor={String(linhas.length)} />
        <Indicador icon={PackageCheck} rotulo="Sobrando" valor={String(nSobrando)} dica="do PDV, prato já em dia" tom={nSobrando ? 'aviso' : undefined} href={nSobrando ? '/ordem-producao/abertas?sit=sobrando' : undefined} />
        <Indicador icon={PackageX} rotulo="Faltando concluir" valor={String(nFaltando)} dica="prato ainda negativo" tom={nFaltando ? 'erro' : undefined} href={nFaltando ? '/ordem-producao/abertas?sit=faltando' : undefined} />
        <Indicador icon={Clock} rotulo={`Abertas há mais de ${DIAS_VELHA} dias`} valor={String(nVelhas)} tom={nVelhas ? 'aviso' : undefined} href={nVelhas ? '/ordem-producao/abertas?sit=velha' : undefined} />
      </div>

      <Filtros key={JSON.stringify(sp)} basePath="/ordem-producao/abertas"
        defaults={{ q: sp.q ?? '', origem: sp.origem ?? '', autor: sp.autor ?? '', sit: sp.sit ?? '' }}
        campos={[
          { tipo: 'texto', nome: 'q', label: 'Produto ou número' },
          { tipo: 'select', nome: 'origem', label: 'Origem', opcoes: origens.map((o) => ({ value: o, label: ROTULO_ORIGEM_OP[o] ?? o })) },
          { tipo: 'select', nome: 'autor', label: 'Quem abriu', opcoes: autores.map((a) => ({ value: a, label: a })) },
          { tipo: 'select', nome: 'sit', label: 'Situação', opcoes: [{ value: 'sobrando', label: 'Sobrando' }, { value: 'faltando', label: 'Faltando concluir' }, { value: 'velha', label: `Mais de ${DIAS_VELHA} dias` }] },
        ]} />

      {!pagina.length ? (
        <div className="rounded-[var(--r-lg)] bg-surface u-card"><EmptyState icon={Factory} title={linhas.length ? 'Nenhuma OP neste filtro' : 'Nenhuma OP aberta'} hint={linhas.length ? 'Ajuste os filtros.' : undefined} /></div>
      ) : (
        <LoteOPsProvider ativo={loteAtivo} pode={pode} idsPagina={pagina.map((l) => l.o.id)} numeros={Object.fromEntries(pagina.map((l) => [l.o.id, l.numero]))}>
        <ul className="space-y-2">
          {pagina.map((l) => (
            <li key={l.o.id} className="flex items-start rounded-[var(--r-lg)] bg-surface u-card">
              <CheckOP id={l.o.id} numero={l.numero} />
              <details className="group min-w-0 flex-1">
                <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-4 gap-y-1 p-4 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="truncate text-[14px] font-medium text-text">{l.p?.descricao ?? (l.cod != null ? `Produto ${l.cod}` : 'Produto não informado')}</div>
                    <div className="num text-[12px] text-text-muted">OP {l.numero} · {fmtQ(l.qtd)} {l.p?.unidade ?? ''}{l.o.identificacao_codigo_local_estoque ? ` · ${nomeLocal.get(Number(l.o.identificacao_codigo_local_estoque)) ?? l.o.identificacao_codigo_local_estoque}` : ''}</div>
                  </div>
                  <div className="text-[12px] text-text-muted">
                    <div><span className="text-text">{ROTULO_ORIGEM_OP[l.origem ?? ''] ?? 'Origem não lida'}</span>{l.autor ? ` · ${l.autor}` : ''}</div>
                    <div>{l.idade == null ? 'sem data de abertura' : l.idade === 0 ? 'aberta hoje' : `aberta há ${l.idade} dia${l.idade === 1 ? '' : 's'}`}{l.o.identificacao_d_dt_previsao ? ` · previsão ${fmtDataBR(l.o.identificacao_d_dt_previsao)}` : ''}</div>
                  </div>
                  <div className="text-right text-[12px]">
                    {l.situacao && l.situacao !== 'ok' && <div className={`font-semibold ${SIT[l.situacao].cor}`} title={SIT[l.situacao].dica}>{SIT[l.situacao].rotulo}</div>}
                    {l.saldo != null && <div className="num text-text-muted">{l.o.identificacao_codigo_local_estoque ? 'saldo no local' : 'saldo do prato'} {fmtQ(l.saldo)}</div>}
                  </div>
                  <ChevronDown className="size-4 shrink-0 self-center text-text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-[var(--border)] px-4 py-3 text-[13px]">
                  {l.o.obs_omie && <p className="mb-2 text-text-muted">Observação no Omie: {l.o.obs_omie}</p>}
                  <div className="mb-1 text-[12px] font-medium text-text">Ficha gravada na OP</div>
                  {l.itens.length ? (
                    <ul className="divide-y divide-[var(--border)]">
                      {l.itens.map((i) => {
                        const ip = prod.get(i.insumo)
                        return (
                          <li key={`${i.insumo}-${i.local}`} className="flex items-center justify-between gap-3 py-1.5">
                            <Link href={`/estoque/produto/${i.insumo}`} className="min-w-0 truncate hover:underline">{ip?.descricao ?? `Produto ${i.insumo}`}</Link>
                            <span className="num shrink-0 text-text-muted">{fmtQ(i.quantidade)} {ip?.unidade ?? ''}{i.local ? ` · ${nomeLocal.get(i.local) ?? i.local}` : ''}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-text-muted">{fonte === 'omie' ? (l.o.itens_consultados_em ? 'O Omie não devolveu insumos para esta OP.' : 'Ainda não lida do Omie (o robô lê até 30 OPs por vez).') : 'Os insumos aparecem na tela da OP.'}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Link href={`/ordem-producao/${l.o.id}`} className="font-medium text-brand hover:underline">Abrir a OP</Link>
                    {l.cod != null && <Link href={`/estoque/produto/${l.cod}`} className="font-medium text-brand hover:underline">Ver o prato no estoque</Link>}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
        </LoteOPsProvider>
      )}

      <Paginacao basePath="/ordem-producao/abertas" page={page} temProxima={page * POR_PAGINA < filtradas.length} total={filtradas.length} porPagina={POR_PAGINA} />
    </div>
  )
}
