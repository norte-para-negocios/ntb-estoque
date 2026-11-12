import type { ModuloId } from '@/lib/plataforma/modulos-puro'
import { IDENTIDADE } from './simbolos'
import { MascoteVitrine } from './MascoteVitrine'

// Vitrine de um módulo que a loja não tem (protótipo aprovado, tela "vitrine", no ritmo das páginas de produto da
// apple.com): um bloco na cor do módulo com o símbolo grande, uma frase curta, o que ele faz em três itens e a faixa
// azul-noite com o contato da Norte. Textos do protótipo (plataforma-norte-prototipo/index.html e lp/index.html).

const WHATSAPP_NORTE = '5571986660666'

type Conteudo = { nome: string; titulo: string; frase: string; faz: readonly (readonly [string, string])[] }

export const VITRINE: Record<ModuloId, Conteudo> = {
  dashboard: {
    nome: 'Início',
    titulo: 'O dia da loja numa tela só.',
    frase: 'Vendas, compras e o que precisa de você, assim que abre o sistema.',
    faz: [
      ['O dia de hoje', 'Faturamento, meta e o que mudou desde ontem.'],
      ['O que falta fazer', 'Notas para lançar, contagens e pendências.'],
      ['Atalhos', 'As telas que você mais usa, a um clique.'],
    ],
  },
  vendas: {
    nome: 'Norte Vendas',
    titulo: 'Da mesa ao caixa, sem papel.',
    frase: 'O pedido sai do celular do garçom ou do QR na mesa e cai na cozinha. A conta se divide e a nota sai no caixa.',
    faz: [
      ['Pedido pelo celular', 'O cliente pede pelo QR e a cozinha recebe na hora.'],
      ['Mesas e comanda', 'O garçom anota no celular e a conta se divide sozinha.'],
      ['Caixa e nota', 'Fecha a conta e emite a nota no mesmo lugar.'],
    ],
  },
  erp: {
    nome: 'Norte ERP',
    titulo: 'A nota chega antes do caminhão.',
    frase: 'As compras entram sozinhas da SEFAZ e viram estoque e custo. Produção, fiscal e contas no mesmo lugar.',
    faz: [
      ['Estoque certo', 'Saldo por local, contagem e ajustes num lugar só.'],
      ['Compras que entram sozinhas', 'As notas chegam da SEFAZ e já viram custo.'],
      ['Produção', 'Fichas e ordens de produção com baixa automática.'],
    ],
  },
  cozinha: {
    nome: 'Norte Cozinha',
    titulo: 'Cada prato com o preço certo.',
    frase: 'O custo vem da ficha com o preço da última compra. O CMV aparece contra a sua meta, no salão e no delivery.',
    faz: [
      ['Custo de cada prato', 'Pela ficha, com o preço real das compras.'],
      ['Preço que bate a meta', 'No salão e no delivery, já com as taxas.'],
      ['Eventos', 'Custo por convidado, produção e lista de compras.'],
    ],
  },
  pacioli: {
    nome: 'Pacioli',
    titulo: 'O estoque conferido toda noite.',
    frase: 'Ele acha o saldo que não bate, corrige sozinho e guarda a prova. E responde o que você perguntar.',
    faz: [
      ['Corrige sozinho', 'Acha o erro no estoque e conserta, com prova.'],
      ['Responde', 'Pergunte o CMV de um prato ou o que subiu no mês.'],
      ['Avisa antes', 'Diz o que precisa de você antes de virar problema.'],
    ],
  },
}

export function linkWhatsapp(nomeModulo: string, loja: string): string {
  return `https://wa.me/${WHATSAPP_NORTE}?text=${encodeURIComponent(`Quero liberar o ${nomeModulo} na ${loja}`)}`
}

export function Vitrine({ modulo, loja }: { modulo: ModuloId; loja: string }) {
  const c = VITRINE[modulo]
  const { cor, corTexto, Simbolo } = IDENTIDADE[modulo]
  const nomeLoja = loja || 'sua loja'

  return (
    <article aria-labelledby="vitrine-titulo" className="pb-8">
      {/* Bloco do módulo: no celular encosta nas bordas da tela; no desktop é um painel grande e arredondado. */}
      <section
        className="-mx-4 -mt-6 overflow-hidden px-6 pb-16 pt-14 text-center text-white sm:mx-0 sm:mt-0 sm:rounded-[28px] sm:px-12 sm:pb-24 sm:pt-20"
        style={{ background: cor }}
      >
        <span
          className="mx-auto grid size-[84px] place-items-center rounded-[24px] bg-white sm:size-[104px] sm:rounded-[28px]"
          style={{ color: cor }}
          aria-hidden="true"
        >
          <Simbolo className="size-[62%]" />
        </span>
        <p className="mt-6 text-[19px] font-semibold tracking-[-0.015em] sm:text-[21px]">{c.nome}</p>
        <h1
          id="vitrine-titulo"
          className="mx-auto mt-2 max-w-[13ch] text-[44px] font-bold leading-[1.02] tracking-[-0.04em] [text-wrap:balance] sm:text-[64px] lg:text-[80px]"
        >
          {c.titulo}
        </h1>
        <p className="mx-auto mt-5 max-w-[36ch] text-[17px] leading-[1.45] text-white [text-wrap:pretty] sm:text-[21px]">{c.frase}</p>
        {modulo === 'pacioli' && <MascoteVitrine fundo="#ffffff" />}
      </section>

      <ul className="mx-auto mt-14 grid max-w-4xl gap-10 px-2 text-center sm:mt-20 sm:grid-cols-3 sm:gap-8">
        {c.faz.map(([t, d]) => (
          <li key={t}>
            <span className="mx-auto mb-4 block h-1 w-8 rounded-full" style={{ background: corTexto }} aria-hidden="true" />
            <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-text">{t}</h2>
            <p className="mx-auto mt-1.5 max-w-[26ch] text-[15px] leading-[1.45] text-text-muted">{d}</p>
          </li>
        ))}
      </ul>

      <section className="mt-14 flex flex-col items-start gap-5 rounded-[var(--r-lg)] bg-[#14163A] p-6 text-white sm:mt-20 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        <p className="flex-1 text-[15px] leading-[1.5] text-[#c3c5e6] sm:text-[16px]">
          <b className="mb-0.5 block text-[19px] font-semibold tracking-[-0.015em] text-white">Ainda não está na {nomeLoja}.</b>
          Os seus dados já estão aqui: quando liberar, ele abre pronto.
        </p>
        <a
          href={linkWhatsapp(c.nome, nomeLoja)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 w-full shrink-0 items-center justify-center rounded-full bg-white px-6 text-[16px] font-semibold text-[#14163A] u-motion u-press hover:bg-[#ECECF6] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-white sm:w-auto"
        >
          Falar com a Norte
        </a>
      </section>
    </article>
  )
}
