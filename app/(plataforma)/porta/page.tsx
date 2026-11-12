import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { logout } from '@/lib/actions/auth'
import { carregarAcessos } from '@/lib/plataforma/assinaturas'
import { estadoEfetivo, type ModuloId } from '@/lib/plataforma/modulos-puro'
import { IDENTIDADE } from '@/components/plataforma/simbolos'
import { LogoNegocios } from '@/components/plataforma/logo-negocios'
import { carregarResumoPorta, lojasDoUsuario } from './dados'
import { TrocarLoja } from './TrocarLoja'
import { Mascote } from './Mascote'

export const metadata: Metadata = { title: 'Porta da Norte' }

const URL_VENDAS = 'https://nortevendas.norteparanegocios.com.br'
type Card = Exclude<ModuloId, 'dashboard'>
const ORDEM: Card[] = ['vendas', 'erp', 'cozinha', 'pacioli']
const MOD: Record<Card, { nome: string; para: string; href: string; externo?: boolean }> = {
  vendas: { nome: 'Norte Vendas', para: 'Mesas, pedidos, caixa, cozinha e cardápio por QR.', href: URL_VENDAS, externo: true },
  erp: { nome: 'Norte ERP', para: 'Estoque, compras, produção, notas e contas.', href: '/home' },
  cozinha: { nome: 'Norte Cozinha', para: 'Custo de cada prato, CMV, cardápios, eventos e guia de preparo.', href: '/cozinha' },
  pacioli: { nome: 'Pacioli', para: 'O robô que confere e corrige o estoque, e responde as suas perguntas.', href: '/pacioli' },
}

const CARGO: Record<string, string> = { Admin: 'Administrador', AdminLoja: 'Administrador da loja' }

function saudacao(): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bahia', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function dataCurta(iso: string | null): string {
  if (!iso) return 'sem data'
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(d)
}

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

export default async function PortaPage() {
  await exigirDev()
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  const [{ acessos, gravados, lojaId }, lojas] = await Promise.all([carregarAcessos(), lojasDoUsuario(profile.id, isAdmin)])
  const abre = (m: Card) => acessos[m] !== 'vitrine'
  const resumo = await carregarResumoPorta(lojaId, { erp: abre('erp'), cozinha: abre('cozinha') })

  const nomeLoja = profile.loja?.nome_fantasia || profile.loja?.nome || 'Sem loja'
  const primeiroNome = (profile.name || '').trim().split(/\s+/)[0] || 'tudo bem'
  const inicial = (profile.name || '?').trim().charAt(0).toUpperCase()
  const cargo = profile.is_super_admin ? 'Equipe Norte' : (profile.perfil && CARGO[profile.perfil]) || profile.perfil || 'Usuário'

  // Resumo do dia: cada linha só aparece se a consulta respondeu e tem algo a dizer.
  const linhas: { cor: string; conteudo: React.ReactNode }[] = []
  if (resumo.notasPendentes) {
    linhas.push({ cor: IDENTIDADE.erp.cor, conteudo: <>Tem <Link href="/nota-fiscal?status=P">{plural(resumo.notasPendentes, 'nota fiscal', 'notas fiscais')}</Link> <span className="pn-q">deste mês esperando entrar no estoque.</span></> })
  }
  if (resumo.abaixoMinimo) {
    linhas.push({ cor: IDENTIDADE.erp.cor, conteudo: <><Link href="/produto?vista=compras&repor=1">{plural(resumo.abaixoMinimo, 'produto', 'produtos')}</Link> <span className="pn-q">{resumo.abaixoMinimo === 1 ? 'está abaixo' : 'estão abaixo'} do mínimo para repor.</span></> })
  }
  if (resumo.evento) {
    const e = resumo.evento
    linhas.push({ cor: IDENTIDADE.cozinha.cor, conteudo: <><span className="pn-q">Próximo evento:</span> <Link href={`/cozinha/eventos/${e.id}`}>{e.nome}</Link><span className="pn-q">, {dataCurta(e.data)}, {plural(e.convidados, 'convidado', 'convidados')}.</span></> })
  }
  if (!linhas.length) linhas.push({ cor: '#9a9ab2', conteudo: 'Tudo em dia por aqui.' })

  const vivo: Partial<Record<Card, string>> = {
    vendas: 'Abre o Norte Vendas em outra aba',
    ...(resumo.notasPendentes != null ? { erp: resumo.notasPendentes ? plural(resumo.notasPendentes, 'nota para conferir', 'notas para conferir') : 'Notas do mês em dia' } : {}),
    ...(resumo.evento ? { cozinha: `Próximo evento: ${resumo.evento.nome}` } : {}),
  }

  const abertos = ORDEM.filter(abre)
  const travados = ORDEM.filter((m) => !abre(m))
  const classeGrade = abertos.length <= 2 ? 'pn-dois' : abertos.length === 3 ? 'pn-tres' : ''

  return (
    <>
      <header className="pn-barra">
        <div className="pn-esq">
          <LogoNegocios className="pn-logo" />
          <TrocarLoja lojas={lojas} atual={lojaId} nomeAtual={nomeLoja} />
        </div>
        <div className="pn-eu">
          <span className="pn-av" aria-hidden="true">{inicial}</span>
          <div><b>{profile.name}</b><small>{cargo}</small></div>
          <form action={logout}><button type="submit" className="pn-sair">Sair</button></form>
        </div>
      </header>
      <main className="pn-porta">
        <section className="pn-abertura" aria-label="Resumo do dia">
          <Mascote acao={linhas.length > 1 ? '12-falando' : '44-acenando'} />
          <div>
            <h1 className="serif">{saudacao()}, {primeiroNome}.</h1>
            <ul className="pn-resumo">
              {linhas.map((l, i) => (
                <li key={i}><span className="pn-pt" style={{ background: l.cor }} aria-hidden="true" /><span>{l.conteudo}</span></li>
              ))}
            </ul>
          </div>
        </section>

        <div className="pn-titulo"><h2>Seus módulos</h2><span>{nomeLoja}{lojas.length > 1 ? ' · troque de loja no topo' : ''}</span></div>
        <div className={`pn-grade ${classeGrade}`}>
          {abertos.map((m) => {
            const d = MOD[m]
            const { cor, Simbolo } = IDENTIDADE[m]
            const suspenso = acessos[m] === 'consulta'
            const teste = !suspenso && estadoEfetivo(gravados[m], m, lojaId) === 'teste'
            const corpo = (
              <>
                {suspenso ? <span className="pn-selo pn-susp">Suspenso</span> : teste ? <span className="pn-selo">Em teste</span> : null}
                <span className="pn-simb"><Simbolo /></span>
                <h3>{d.nome}{d.externo && <ArrowUpRight aria-label="abre em outra aba" />}</h3>
                <p className="pn-para">{d.para}</p>
                {vivo[m] && <span className="pn-vivo"><span className="pn-pt" aria-hidden="true" />{vivo[m]}</span>}
              </>
            )
            const estilo = { '--c': cor } as React.CSSProperties
            return d.externo
              ? <a key={m} href={d.href} target="_blank" rel="noopener noreferrer" className="pn-app" style={estilo}>{corpo}</a>
              : <Link key={m} href={d.href} className="pn-app" style={estilo}>{corpo}</Link>
          })}
        </div>

        {travados.length > 0 && (
          <>
            <div className="pn-titulo" style={{ marginTop: 44 }}><h2>Para quando precisar</h2><span>Ainda não estão na sua loja</span></div>
            <div className="pn-extras">
              {travados.map((m) => {
                const d = MOD[m]
                const { cor, Simbolo } = IDENTIDADE[m]
                return (
                  <Link key={m} href={`/modulos/${m}`} className="pn-extra" style={{ '--c': cor } as React.CSSProperties}>
                    <span className="pn-simb"><Simbolo /></span>
                    <span>
                      <b>{d.nome}<svg viewBox="0 0 12 12" fill="none" aria-label="não contratado"><rect x="2" y="5.5" width="8" height="5.5" rx="1.5" fill="currentColor" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.4" /></svg></b>
                      <small>{d.para}</small>
                    </span>
                    <span className="pn-ir">Conhecer</span>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </main>
    </>
  )
}
