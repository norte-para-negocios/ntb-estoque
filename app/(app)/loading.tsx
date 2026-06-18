// Skeleton mostrado INSTANTANEAMENTE ao navegar entre telas, enquanto o server
// component da rota carrega. Sem isto o Next mantinha a tela anterior parada ate
// o servidor responder tudo — dava a sensacao de "cliquei e nao aconteceu nada",
// especialmente no mobile. A sidebar (AppShell) permanece; so o conteudo troca.
//
// A6: os blocos usam .u-skeleton (shimmer sutil que varre da esquerda p/ direita)
// em vez do animate-pulse generico. Da a sensacao de "carregando vivo", no tom
// Linear/Vercel. Em prefers-reduced-motion o sweep para e fica so o tom-base.
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Cabecalho: titulo + acoes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="u-skeleton h-7 w-52 rounded-md" />
        <div className="flex gap-2">
          <div className="u-skeleton h-9 w-24 rounded-md" />
          <div className="u-skeleton h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Linha de meta / filtros */}
      <div className="u-skeleton h-4 w-72 rounded" />

      {/* Lista / tabela */}
      <div className="space-y-2.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="u-skeleton h-14 rounded-lg border border-border" />
        ))}
      </div>
    </div>
  )
}
