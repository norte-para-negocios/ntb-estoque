// Skeleton mostrado enquanto EtiquetaConfigPage carrega (busca loja + ultima NF/OP).
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Cabecalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="u-skeleton h-7 w-52 rounded-md" />
      </div>

      {/* Descricao */}
      <div className="u-skeleton h-4 w-80 rounded" />

      {/* Painel de configuracao */}
      <div className="max-w-lg space-y-3 px-4">
        <div className="u-skeleton h-10 w-full rounded-md" />
        <div className="u-skeleton h-10 w-full rounded-md" />
        <div className="u-skeleton h-10 w-full rounded-md" />
        <div className="u-skeleton h-10 w-2/3 rounded-md" />
      </div>
    </div>
  )
}
