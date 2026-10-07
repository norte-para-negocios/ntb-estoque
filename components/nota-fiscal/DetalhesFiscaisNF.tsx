// components/nota-fiscal/DetalhesFiscaisNF.tsx
// Superficie o que ja vem no full_object da Omie (ConsultarRecebimento) mas
// nunca foi mostrado na tela de detalhe -- pedido real do usuario 2026-07-31
// ("clicar numa nota e ver tudo sobre ela"). So exibe secoes com dado
// presente; full_object varia (nem toda nota tem transporte/parcelas
// preenchidos).
type InfoCadastro = {
  cRecebido?: string
  dRec?: string
  hRec?: string
  cUsuarioRec?: string
  cFaturado?: string
  dFat?: string
  hFat?: string
  cUsuarioFat?: string
  cCancelada?: string
  cDevolvido?: string
  cBloqueado?: string
  cOperacao?: string
}

type Transporte = {
  cNomeTransp?: string
  cCnpjCpfTransp?: string
  cTipoFrete?: string
  nPesoBruto?: number
  nPesoLiquido?: number
  nQtdeVolume?: string | number
  cEspecieVolume?: string
}

type ParcelaItem = { nSequencia: number; dVencimento: string; vParcela: number; pParcela: number }
type Parcelas = { parcelasLista?: ParcelaItem[] }

type Totais = {
  vTotalProdutos?: number
  vAproxTributos?: number
  nValIBS?: number
  nValCbs?: number
}

type InfoAdicionais = { cCategCompra?: string; dRegistro?: string }

type Cabec = { cCNPJ_CPF?: string; cInscricao?: string; cNaturezaOperacao?: string }

export type FullObjectNF = {
  cabec?: Cabec
  infoCadastro?: InfoCadastro
  transporte?: Transporte
  parcelas?: Parcelas
  totais?: Totais
  infoAdicionais?: InfoAdicionais
}

const FRETE_LABEL: Record<string, string> = {
  '0': 'Por conta do emitente (CIF)',
  '1': 'Por conta do destinatário (FOB)',
  '2': 'Por conta de terceiros',
  '9': 'Sem transporte',
}

const fmtMoeda = (n: number | undefined) =>
  n == null ? null : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDataHora = (d?: string, h?: string) => (d ? `${d}${h ? ` às ${h}` : ''}` : null)

function SimNao({ v }: { v: string | undefined }) {
  if (v == null) return <span className="text-text-muted">—</span>
  const sim = v === 'S'
  return <span className={sim ? 'text-ok' : 'text-text-muted'}>{sim ? 'Sim' : 'Não'}</span>
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className="text-[15px] text-text">{children}</dd>
    </div>
  )
}

export function DetalhesFiscaisNF({ fullObject, semOmie = false }: { fullObject: unknown; semOmie?: boolean }) {
  const fo = (fullObject ?? {}) as FullObjectNF
  const { cabec, infoCadastro: ic, transporte, parcelas, totais, infoAdicionais } = fo

  const temAlgumaSecao = !!(cabec?.cCNPJ_CPF || ic || transporte?.cNomeTransp || parcelas?.parcelasLista?.length || totais || infoAdicionais)
  if (!temAlgumaSecao) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(cabec?.cCNPJ_CPF || cabec?.cNaturezaOperacao) && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">Fornecedor / operação</h3>
          <dl className="space-y-2.5">
            {cabec?.cCNPJ_CPF && <Campo label="CNPJ/CPF"><span className="num">{cabec.cCNPJ_CPF}</span></Campo>}
            {cabec?.cInscricao && <Campo label="Inscrição estadual"><span className="num">{cabec.cInscricao}</span></Campo>}
            {cabec?.cNaturezaOperacao && <Campo label="Natureza da operação">{cabec.cNaturezaOperacao}</Campo>}
          </dl>
        </div>
      )}

      {ic && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">{semOmie ? 'Situação' : 'Situação no Omie'}</h3>
          <dl className="space-y-2.5">
            <Campo label="Recebido">
              <SimNao v={ic.cRecebido} />
              {ic.cRecebido === 'S' && fmtDataHora(ic.dRec, ic.hRec) && (
                <span className="num text-text-muted"> · {fmtDataHora(ic.dRec, ic.hRec)}</span>
              )}
            </Campo>
            <Campo label="Faturado">
              <SimNao v={ic.cFaturado} />
              {ic.cFaturado === 'S' && fmtDataHora(ic.dFat, ic.hFat) && (
                <span className="num text-text-muted"> · {fmtDataHora(ic.dFat, ic.hFat)}</span>
              )}
            </Campo>
            <Campo label="Cancelada"><SimNao v={ic.cCancelada} /></Campo>
            <Campo label="Devolvida"><SimNao v={ic.cDevolvido} /></Campo>
            <Campo label="Bloqueada"><SimNao v={ic.cBloqueado} /></Campo>
          </dl>
        </div>
      )}

      {transporte?.cNomeTransp && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">Transporte</h3>
          <dl className="space-y-2.5">
            <Campo label="Transportadora">{transporte.cNomeTransp}</Campo>
            {transporte.cTipoFrete && (
              <Campo label="Frete">{FRETE_LABEL[transporte.cTipoFrete] ?? transporte.cTipoFrete}</Campo>
            )}
            {(transporte.nPesoBruto != null || transporte.nPesoLiquido != null) && (
              <Campo label="Peso">
                <span className="num">
                  {transporte.nPesoBruto != null ? `${transporte.nPesoBruto}kg bruto` : ''}
                  {transporte.nPesoLiquido != null ? ` · ${transporte.nPesoLiquido}kg líquido` : ''}
                </span>
              </Campo>
            )}
            {transporte.nQtdeVolume != null && (
              <Campo label="Volumes"><span className="num">{transporte.nQtdeVolume} {transporte.cEspecieVolume ?? ''}</span></Campo>
            )}
          </dl>
        </div>
      )}

      {!!parcelas?.parcelasLista?.length && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">Parcelas</h3>
          <ul className="divide-y divide-border/60 text-[15px]">
            {parcelas.parcelasLista.map((p) => (
              <li key={p.nSequencia} className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="text-text-muted"><span className="num">{p.nSequencia}ª</span> · vence <span className="num">{p.dVencimento}</span></span>
                <span className="num font-medium">{fmtMoeda(p.vParcela)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totais && (totais.vAproxTributos != null || totais.nValIBS != null) && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">Impostos (aproximados)</h3>
          <dl className="space-y-2.5">
            {totais.vAproxTributos != null && (
              <Campo label="Total aproximado de tributos"><span className="num">{fmtMoeda(totais.vAproxTributos)}</span></Campo>
            )}
            {totais.nValIBS != null && totais.nValIBS > 0 && (
              <Campo label="IBS"><span className="num">{fmtMoeda(totais.nValIBS)}</span></Campo>
            )}
            {totais.nValCbs != null && totais.nValCbs > 0 && (
              <Campo label="CBS"><span className="num">{fmtMoeda(totais.nValCbs)}</span></Campo>
            )}
          </dl>
        </div>
      )}

      {infoAdicionais?.cCategCompra && (
        <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
          <h3 className="mb-3 text-[17px] font-semibold text-text">Informações adicionais</h3>
          <dl className="space-y-2.5">
            <Campo label="Categoria de compra"><span className="num">{infoAdicionais.cCategCompra}</span></Campo>
            {infoAdicionais.dRegistro && <Campo label="Data de registro"><span className="num">{infoAdicionais.dRegistro}</span></Campo>}
          </dl>
        </div>
      )}
    </div>
  )
}
