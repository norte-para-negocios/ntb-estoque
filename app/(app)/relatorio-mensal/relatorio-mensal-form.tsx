'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { SincronizarEstruturaBotao } from './sincronizar-estrutura-botao'

// Formulário da tela do relatório mensal. Virou client component por um
// motivo só: o mês selecionado precisa ser COMPARTILHADO entre o download do
// relatório e o botão de sincronizar ficha técnica. Antes, o `<select>` era um
// form GET puro (server-rendered) e o botão de sync recebia `dataIni`/`dataFim`
// fixos em `opcoes[0]` (o mês fechado mais recente) -- trocar o mês no dropdown
// não mudava NADA pro sync, então "Nada pendente" podia aparecer enquanto o mês
// realmente pedido seguia sem nenhuma ficha técnica em cache.
//
// O download continua sendo exatamente o mesmo GET que o `<form method="get"
// action="/api/relatorio-mensal">` produzia (`?mesAno=<ano>-<mes>`), agora via
// <a href>.

export type OpcaoMes = { ano: number; mes: number; label: string }

// Duplicado de ultimoDiaMes (lib/relatorio-mensal.ts) -- este é client
// component e não pode importar de um arquivo que usa next/server.
function ultimoDiaMes(ano: number, mes: number): string {
  const dia = new Date(ano, mes, 0).getDate()
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function chaveMes(o: OpcaoMes): string {
  return `${o.ano}-${o.mes}`
}

export function RelatorioMensalForm({
  opcoes,
  podeSincronizarEstrutura,
}: {
  opcoes: OpcaoMes[]
  podeSincronizarEstrutura: boolean
}) {
  const [mesAno, setMesAno] = useState(chaveMes(opcoes[0]))
  const selecionado = opcoes.find((o) => chaveMes(o) === mesAno) ?? opcoes[0]

  return (
    <>
      <div className="space-y-4">
        <div>
          <label htmlFor="mes-ano" className="mb-1 block text-[13px] font-medium text-text">
            Mês do relatório
          </label>
          <select
            id="mes-ano"
            name="mesAno"
            value={mesAno}
            onChange={(e) => setMesAno(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {opcoes.map((o) => (
              <option key={chaveMes(o)} value={chaveMes(o)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <a href={`/api/relatorio-mensal?mesAno=${encodeURIComponent(mesAno)}`} className={btnClass('primary')}>
          <Download className="size-4" />
          Gerar relatório do mês
        </a>
      </div>
      {podeSincronizarEstrutura && (
        <div className="mt-4 border-t border-border pt-4">
          <SincronizarEstruturaBotao
            dataIni={`${selecionado.ano}-${String(selecionado.mes).padStart(2, '0')}-01`}
            dataFim={ultimoDiaMes(selecionado.ano, selecionado.mes)}
          />
          <p className="mt-2 text-xs text-text-muted">
            Sincroniza a ficha técnica de {selecionado.label} (o mês selecionado acima).
          </p>
        </div>
      )}
    </>
  )
}
