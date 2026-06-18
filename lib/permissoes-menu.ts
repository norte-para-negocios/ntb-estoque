import { NAV_ITEMS } from '@/components/shell/NavItems'
import { MENU_PERMISSAO } from '@/lib/permissoes-catalogo'

// A partir do conjunto de NOMES de permissao do usuario, devolve o conjunto de
// rotas (hrefs) do menu que ele PODE ver (4.2). Rotas sem permissao mapeada em
// MENU_PERMISSAO sao sempre visiveis (ex.: /home, /movimentacoes). Rotas com
// `admin: true` no NavItems sao tratadas pelo flag de admin no shell, nao aqui
// (o helper so e chamado para nao-admin). Se o usuario tiver '*' (admin), o
// chamador deve nem usar este filtro; ainda assim tratamos '*' como tudo liberado.
export function rotasPermitidas(permissoesNomes: Set<string>): Set<string> {
  const tudo = permissoesNomes.has('*')
  const visiveis = new Set<string>()
  for (const item of NAV_ITEMS) {
    const exigida = MENU_PERMISSAO[item.href]
    // Sem permissao exigida -> sempre visivel (admin flag filtra a parte).
    if (!exigida) {
      visiveis.add(item.href)
      continue
    }
    if (tudo || permissoesNomes.has(exigida)) visiveis.add(item.href)
  }
  return visiveis
}
