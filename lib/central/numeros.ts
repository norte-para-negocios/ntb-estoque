// Números do dia nas telas do menu novo (opção B, 23/10/2026): cada tela pode mostrar uma contagem
// ("2 em contagem", "5 vencem em 7 dias"). Sem imports @/, testável via `node --test lib/central/numeros.test.ts`.

/** Um número de uma tela. `alerta` = algo para resolver (fica laranja com um ponto). */
export type Numero = { valor: number; rotulo: string; alerta?: boolean }
/** Números por href da tela. Tela sem número não aparece aqui. */
export type Numeros = Record<string, Numero>

/** Contagens cruas lidas do banco; `null` = não deu para ler (a tela mostra a descrição, nunca um zero falso). */
export type Contagens = {
  produtosAtivos: number | null
  inventariosAbertos: number | null
  transferenciasAbertas: number | null
  lotesVencendo: number | null
  notasEsperando: number | null
  opsAbertas: number | null
  opsConcluidasHoje: number | null
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios)

/** Monta os números de cada tela. Zero em fila de pendência não vira alerta; contagem que falhou some. */
export function montarNumeros(c: Contagens): Numeros {
  const r: Numeros = {}
  const por = (href: string, v: number | null, n: (v: number) => Omit<Numero, 'valor'>) => {
    if (v == null || !Number.isFinite(v) || v < 0) return
    r[href] = { valor: v, ...n(v) }
  }
  por('/estoque', c.produtosAtivos, (v) => ({ rotulo: plural(v, 'produto ativo', 'produtos ativos') }))
  por('/inventario', c.inventariosAbertos, () => ({ rotulo: 'em contagem' }))
  por('/transferencia', c.transferenciasAbertas, () => ({ rotulo: 'em aberto' }))
  por('/validade', c.lotesVencendo, (v) => ({ rotulo: plural(v, 'lote vence em 7 dias', 'lotes vencem em 7 dias'), alerta: v > 0 }))
  por('/nota-fiscal', c.notasEsperando, (v) => ({ rotulo: plural(v, 'nota esperando entrada', 'notas esperando entrada'), alerta: v > 0 }))
  por('/ordem-producao/abertas', c.opsAbertas, () => ({ rotulo: 'abertas' }))
  por('/ordem-producao', c.opsConcluidasHoje, (v) => ({ rotulo: plural(v, 'concluída hoje', 'concluídas hoje') }))
  return r
}

/** "1.284" — número com separador de milhar, como no resto do sistema. */
export function formatarValor(v: number): string {
  return Math.round(v).toLocaleString('pt-BR')
}

/** Até `max` números das telas de um módulo, alertas primeiro (para o cartão da Visão geral). */
export function destaquesDoModulo(hrefs: string[], numeros: Numeros, max = 2): (Numero & { href: string })[] {
  const lista = hrefs.filter((h) => numeros[h]).map((h) => ({ href: h, ...numeros[h] }))
  return lista.sort((a, b) => Number(!!b.alerta) - Number(!!a.alerta)).slice(0, max)
}
