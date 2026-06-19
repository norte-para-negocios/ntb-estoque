// Skeleton mostrado enquanto ValidadePage carrega (busca OPs + produtos + familias).
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Cabecalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="u-skeleton h-7 w-36 rounded-md" />
        <div className="u-skeleton h-9 w-24 rounded-md" />
      </div>

      {/* Descricao */}
      <div className="u-skeleton h-4 w-72 rounded" />

      {/* Chips de resumo */}
      <div className="flex flex-wrap gap-3">
        <div className="u-skeleton h-7 w-28 rounded-full" />
        <div className="u-skeleton h-7 w-44 rounded-full" />
        <div className="u-skeleton h-7 w-36 rounded-full" />
      </div>

      {/* Secoes */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="u-skeleton h-4 w-40 rounded" />
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="u-skeleton h-14 rounded-lg border border-border" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
