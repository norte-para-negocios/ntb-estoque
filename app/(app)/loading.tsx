// Skeleton mostrado INSTANTANEAMENTE ao navegar entre telas, enquanto o server
// component da rota carrega. Sem isto o Next mantinha a tela anterior parada ate
// o servidor responder tudo — dava a sensacao de "cliquei e nao aconteceu nada",
// especialmente no mobile. A sidebar (AppShell) permanece; so o conteudo troca.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      {/* Cabecalho: titulo + acoes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-7 w-52 rounded-md bg-surface-2" />
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-md bg-surface-2" />
          <div className="h-9 w-28 rounded-md bg-surface-2" />
        </div>
      </div>

      {/* Linha de meta / filtros */}
      <div className="h-4 w-72 rounded bg-surface-2" />

      {/* Lista / tabela */}
      <div className="space-y-2.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </div>
  )
}
