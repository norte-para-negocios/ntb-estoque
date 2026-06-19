'use client'

import { useState, useEffect, useCallback } from 'react'
import { Printer, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui-kit/Button'
import type { EtiquetaConfig, AlturaPreset } from '@/components/etiqueta/EtiquetaPDF'

// Chave de storage por loja
function storageKey(lojaId: number): string {
  return `ntb-etiqueta-config-${lojaId}`
}

export function loadEtiquetaConfig(lojaId: number): EtiquetaConfig {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey(lojaId))
    if (!raw) return {}
    return JSON.parse(raw) as EtiquetaConfig
  } catch {
    return {}
  }
}

function saveEtiquetaConfig(lojaId: number, config: EtiquetaConfig): void {
  try {
    localStorage.setItem(storageKey(lojaId), JSON.stringify(config))
  } catch {
    // localStorage indisponivel: silencioso
  }
}

// Monta a query string de config para as rotas de impressao
export function buildConfigParams(config: EtiquetaConfig): string {
  const params = new URLSearchParams()
  if (config.alturaPreset && config.alturaPreset !== 'padrao') params.set('altura', config.alturaPreset)
  if (config.offsetX && config.offsetX !== 0) params.set('ox', String(config.offsetX))
  if (config.offsetY && config.offsetY !== 0) params.set('oy', String(config.offsetY))
  if (config.nomeExibido?.trim()) params.set('nome', config.nomeExibido.trim())
  const s = params.toString()
  return s ? `?${s}` : ''
}

interface Props {
  lojaId: number
  nomeLojaDB: string          // nome do banco (nome_fantasia ou nome)
  cnpjLoja: string
  // URL de uma NF ou OP existente para o botao de teste
  testNfId?: number
  testOpId?: number
}

const CAMPOS_VISIVEIS: { key: keyof EtiquetaConfig; label: string }[] = [
  { key: 'mostrarFabricacao', label: 'Fabricação' },
  { key: 'mostrarValidade', label: 'Validade' },
  { key: 'mostrarQtdeNf', label: 'Qtde NF' },
  { key: 'mostrarQtdeEtiqueta', label: 'Qtde Etiqueta' },
  { key: 'mostrarLote', label: 'Lote' },
  { key: 'mostrarRecebido', label: 'Recebido em' },
  { key: 'mostrarFornecedor', label: 'Fornecedor' },
  { key: 'mostrarCnpj', label: 'CNPJ' },
]

const DEFAULT_CONFIG: Required<EtiquetaConfig> = {
  nomeExibido: '',
  alturaPreset: 'padrao',
  offsetX: 0,
  offsetY: 0,
  mostrarFabricacao: true,
  mostrarValidade: true,
  mostrarQtdeNf: true,
  mostrarQtdeEtiqueta: true,
  mostrarLote: true,
  mostrarRecebido: true,
  mostrarFornecedor: true,
  mostrarCnpj: true,
}

export function EtiquetaConfigClient({ lojaId, nomeLojaDB, testNfId, testOpId }: Props) {
  const [config, setConfig] = useState<EtiquetaConfig>(DEFAULT_CONFIG)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    const persisted = loadEtiquetaConfig(lojaId)
    setConfig({ ...DEFAULT_CONFIG, ...persisted })
  }, [lojaId])

  const set = useCallback(<K extends keyof EtiquetaConfig>(k: K, v: EtiquetaConfig[K]) => {
    setConfig((prev) => ({ ...prev, [k]: v }))
    setSalvo(false)
  }, [])

  function salvar() {
    saveEtiquetaConfig(lojaId, config)
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2500)
  }

  function resetar() {
    setConfig(DEFAULT_CONFIG)
    saveEtiquetaConfig(lojaId, DEFAULT_CONFIG)
    setSalvo(false)
  }

  // Monta URL de teste
  function urlTeste(): string {
    const params = buildConfigParams(config)
    if (testNfId) return `/nota-fiscal/${testNfId}/imprimir${params}`
    if (testOpId) return `/ordem-producao/${testOpId}/imprimir${params}`
    return ''
  }

  const nomeMostrado = config.nomeExibido?.trim() || nomeLojaDB || 'NTB NORTE PARA NEGOCIOS'

  return (
    <div className="space-y-6">
      {/* Campos da config */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <h2 className="text-sm font-semibold text-text">Identificação da loja na etiqueta</h2>

        <div className="space-y-1">
          <label className="text-xs text-text-muted font-medium">
            Nome exibido no cabeçalho da etiqueta
          </label>
          <input
            type="text"
            value={config.nomeExibido ?? ''}
            onChange={(e) => set('nomeExibido', e.target.value)}
            placeholder={nomeLojaDB || 'Nome da loja...'}
            className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <p className="text-xs text-text-muted">
            Vazio usa o nome do banco: <span className="font-medium text-text">{nomeLojaDB}</span>
          </p>
        </div>
      </div>

      {/* Layout */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <h2 className="text-sm font-semibold text-text">Layout e tamanho</h2>

        <div className="space-y-1">
          <label className="text-xs text-text-muted font-medium">Altura da etiqueta</label>
          <div className="flex gap-2">
            {(['padrao', 'compacta'] as AlturaPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => set('alturaPreset', preset)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  config.alturaPreset === preset
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-bg text-text-muted hover:bg-surface-2'
                }`}
              >
                {preset === 'padrao' ? 'Padrão (40 mm)' : 'Compacta (32 mm)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Offset de calibração */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <h2 className="text-sm font-semibold text-text">Calibração de alinhamento (offset)</h2>
        <p className="text-xs text-text-muted">
          Use para corrigir o deslocamento da impressão na impressora. Valores em mm. Positivo = direita/baixo.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-text-muted font-medium">Offset horizontal (X) mm</label>
            <input
              type="number"
              step="0.5"
              min="-20"
              max="20"
              value={config.offsetX ?? 0}
              onChange={(e) => set('offsetX', Number(e.target.value))}
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted font-medium">Offset vertical (Y) mm</label>
            <input
              type="number"
              step="0.5"
              min="-20"
              max="20"
              value={config.offsetY ?? 0}
              onChange={(e) => set('offsetY', Number(e.target.value))}
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Se a impressão sai deslocada para a esquerda, use X positivo (ex.: +2).
        </p>
      </div>

      {/* Visibilidade de campos */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text">Campos visíveis na etiqueta</h2>
        <div className="grid grid-cols-2 gap-2">
          {CAMPOS_VISIVEIS.map(({ key, label }) => {
            const checked = (config[key] as boolean | undefined) ?? true
            return (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(key, e.target.checked)}
                  className="size-4 rounded border-border accent-[var(--brand)]"
                />
                <span className="text-sm text-text">{label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Preview visual (renderizado em HTML, nao PDF) */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text">Pré-visualização da etiqueta</h2>
        <p className="text-xs text-text-muted">Representação aproximada do layout — cores/fontes podem diferir do PDF impresso.</p>
        <EtiquetaPreview nomeLoja={nomeMostrado} config={config} />
      </div>

      {/* Acoes */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={salvar} variant="primary">
          <Save className="size-4" />
          {salvo ? 'Salvo!' : 'Salvar configuração'}
        </Button>

        {urlTeste() && (
          <a
            href={urlTeste()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <Printer className="size-4" />
            Imprimir etiqueta de teste
          </a>
        )}

        <button
          type="button"
          onClick={resetar}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-text-muted hover:text-text transition-colors"
        >
          <RotateCcw className="size-3.5" />
          Resetar
        </button>
      </div>

      {!urlTeste() && (
        <p className="text-xs text-text-muted">
          Para o botão de teste funcionar é necessário ter ao menos uma Nota Fiscal ou Ordem de Produção impressa antes.
        </p>
      )}
    </div>
  )
}

// Preview HTML (aproximado) sem react-pdf
function EtiquetaPreview({ nomeLoja, config }: { nomeLoja: string; config: EtiquetaConfig }) {
  const alturaBase = config.alturaPreset === 'compacta' ? 128 : 160
  // Proporcao: 72.56mm x 40.04mm -> escala para 290px de largura
  const scale = 290 / 72.56

  const mostrar = {
    fabricacao:   config.mostrarFabricacao    ?? true,
    validade:     config.mostrarValidade       ?? true,
    qtdeNf:       config.mostrarQtdeNf         ?? true,
    qtdeEtiqueta: config.mostrarQtdeEtiqueta   ?? true,
    lote:         config.mostrarLote           ?? true,
    recebido:     config.mostrarRecebido       ?? true,
    fornecedor:   config.mostrarFornecedor     ?? true,
    cnpj:         config.mostrarCnpj           ?? true,
  }

  return (
    <div
      style={{
        width: 290,
        height: alturaBase,
        border: '1px solid #e2e8f0',
        borderRadius: 4,
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 9,
        background: '#fff',
        color: '#000',
        display: 'flex',
        flexDirection: 'column',
        transform: `scale(${scale / 4})`,
        transformOrigin: 'top left',
      }}
    >
      {/* Cabecalho */}
      <div style={{ borderBottom: '1px solid #ccc', padding: '2px 4px', fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {nomeLoja}
      </div>

      {/* Corpo */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '2px 4px', gap: 4, overflow: 'hidden' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: 9, marginBottom: 2, lineHeight: 1.2 }}>PRODUTO EXEMPLO NOME LONGO</div>
          {(mostrar.fabricacao || mostrar.validade) && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
              {mostrar.fabricacao && <span><span style={{ color: '#777', fontSize: 7 }}>Fab: </span>01/01/25</span>}
              {mostrar.validade && <span><span style={{ color: '#777', fontSize: 7 }}>Val: </span>01/01/26</span>}
            </div>
          )}
          {(mostrar.qtdeNf || mostrar.qtdeEtiqueta) && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
              {mostrar.qtdeNf && <span><span style={{ color: '#777', fontSize: 7 }}>NF: </span>10(KG)</span>}
              {mostrar.qtdeEtiqueta && <span><span style={{ color: '#777', fontSize: 7 }}>Et: </span>5(KG)</span>}
            </div>
          )}
          {mostrar.lote && <div style={{ marginBottom: 1 }}>Lote: OP-001</div>}
          {mostrar.recebido && <div style={{ marginBottom: 1 }}>Recebido: 01/06/25</div>}
          {mostrar.fornecedor && <div>FORNECEDOR EXEMPLO</div>}
        </div>
        <div style={{ width: 44, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, background: '#f0f0f0', border: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: '#999' }}>QR</div>
        </div>
      </div>

      {/* Rodape */}
      <div style={{ borderTop: '1px solid #ccc', padding: '1px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 7 }}>
        {mostrar.cnpj && <span>CNPJ: 00.000.000/0001-00</span>}
        <span style={{ fontWeight: 'bold', fontSize: 8 }}>NTB</span>
      </div>
    </div>
  )
}
