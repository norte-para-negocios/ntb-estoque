// Fase H (19/10/2026): quais links a janela do app pode entregar ao sistema (shell.openExternal).
// Só http, https e mailto. Teste: node --test desktop/electron/link-externo.test.js
const PERMITIDOS = new Set(['http:', 'https:', 'mailto:'])

function linkExternoPermitido(url) {
  try {
    return PERMITIDOS.has(new URL(String(url)).protocol)
  } catch {
    return false
  }
}

module.exports = { linkExternoPermitido }
