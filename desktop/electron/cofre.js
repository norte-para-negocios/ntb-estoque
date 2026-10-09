// Segredos do app (senhas do banco local, segredo do JWT local, sessão real do usuário, verificador
// da senha para login offline). Cifrado com safeStorage (DPAPI no Windows, Keychain no Mac) num
// arquivo do userData. Fora do Electron (testes) fica só em memória.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function criarCofre({ arquivo, safeStorage } = {}) {
  let dados = {}
  const persistente = Boolean(arquivo && safeStorage?.isEncryptionAvailable?.())

  if (persistente && fs.existsSync(arquivo)) {
    try {
      dados = JSON.parse(safeStorage.decryptString(fs.readFileSync(arquivo)))
    } catch {
      dados = {}
    }
  }

  function salvar() {
    if (!persistente) return
    const tmp = `${arquivo}.tmp`
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(dados)), { mode: 0o600 })
    fs.renameSync(tmp, arquivo)
  }

  function garantir(chave, gerar) {
    if (dados[chave] === undefined) {
      dados[chave] = gerar()
      salvar()
    }
    return dados[chave]
  }

  return {
    persistente,
    ler: (chave) => dados[chave],
    gravar(chave, valor) {
      if (valor === undefined) delete dados[chave]
      else dados[chave] = valor
      salvar()
    },
    garantir,
    segredosBase() {
      return {
        senhaAdmin: garantir('senhaAdmin', () => crypto.randomBytes(24).toString('base64url')),
        senhaAuthenticator: garantir('senhaAuthenticator', () => crypto.randomBytes(24).toString('base64url')),
        jwtSecret: garantir('jwtSecret', () => crypto.randomBytes(48).toString('base64url')),
        frioApiKey: garantir('frioApiKey', () => crypto.randomBytes(24).toString('base64url')),
      }
    },
    apagarUsuario() {
      for (const k of ['sessaoRemota', 'usuario', 'refreshLocal']) delete dados[k]
      salvar()
    },
  }
}

module.exports = { criarCofre, caminhoPadrao: (userData) => path.join(userData, 'cofre.bin') }
