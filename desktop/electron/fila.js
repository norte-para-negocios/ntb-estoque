// Fila de ações feitas sem internet + mapa de ids provisórios -> reais. Arquivo JSON no userData,
// gravado de forma atômica (escreve .tmp e renomeia) a cada mudança: queda de energia não perde
// nem corrompe a fila. Fica fora do banco de propósito: recriar o banco não apaga a fila.
const fs = require('fs')

function criarFila(arquivo) {
  let estado = { itens: [], mapa: {} }
  if (arquivo && fs.existsSync(arquivo)) {
    try {
      estado = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    } catch {
      fs.copyFileSync(arquivo, `${arquivo}.corrompido-${Date.now()}`)
    }
  }

  function salvar() {
    if (!arquivo) return
    const tmp = `${arquivo}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(estado))
    fs.renameSync(tmp, arquivo)
  }

  return {
    itens: () => estado.itens,
    achar: (id) => estado.itens.find((i) => i.intentId === id),
    incluir(item) {
      estado.itens.push({ criadoEm: new Date().toISOString(), tentativas: 0, ...item })
      salvar()
    },
    atualizar(id, mudancas) {
      const it = estado.itens.find((i) => i.intentId === id)
      if (it) Object.assign(it, mudancas)
      salvar()
      return it
    },
    remover(id) {
      estado.itens = estado.itens.filter((i) => i.intentId !== id)
      salvar()
    },
    mapa: () => new Map(Object.entries(estado.mapa).map(([k, v]) => [Number(k), v])),
    somarMapa(m) {
      for (const [k, v] of m) estado.mapa[String(k)] = v
      salvar()
    },
    limpar() {
      estado = { itens: [], mapa: {} }
      salvar()
    },
  }
}

module.exports = { criarFila }
