// Fase 6: clientes e transportadoras do estoque próprio (migration 450). Regras puras, sem banco (node --test).
// O validador de CNPJ/CPF vem por parâmetro (é o validarCnpjCpf de lib/importacao/planilha-puro): módulo puro não importa valor de outro
// com extensão .ts (quebra o tsc) e sem extensão o node --test não acha.
export type ValidarDoc = (s: string | null | undefined) => { ok: true; valor: string | null; pessoaFisica: boolean } | { ok: false; erro: string }

export type Papel = 'cliente' | 'transportadora' | 'ambos'
export const PAPEIS: Papel[] = ['cliente', 'transportadora', 'ambos']
export const ROTULO_PAPEL: Record<Papel, string> = { cliente: 'Cliente', transportadora: 'Transportadora', ambos: 'Cliente e transportadora' }

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Junta o papel que já existe com o novo (cliente + transportadora = ambos). */
export function juntarPapel(atual: Papel, novo: Papel): Papel {
  if (atual === novo) return atual
  return 'ambos'
}

/** O filtro da lista: transportadora mostra 'transportadora' e 'ambos'; cliente mostra 'cliente' e 'ambos'. */
export function papeisDoFiltro(filtro: string | undefined): Papel[] | null {
  if (filtro === 'transportadora') return ['transportadora', 'ambos']
  if (filtro === 'cliente') return ['cliente', 'ambos']
  return null
}

export type ClienteInput = {
  papel: Papel; razao_social: string; nome_fantasia: string; cnpj_cpf: string; inscricao_estadual: string; email: string; telefone: string
  cep: string; uf: string; cidade: string; bairro: string; logradouro: string; numero: string; complemento: string; rntrc: string; inativo: boolean
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const nulo = (s: string) => (s.trim() === '' ? null : s.trim())

/** Valida e normaliza o formulário. Documento sempre só com dígitos; CPF marca pessoa física. */
export function validarCliente(d: ClienteInput, validarCnpjCpf: ValidarDoc): { ok: true; linha: Record<string, string | boolean | null> } | { ok: false; erro: string } {
  if (!PAPEIS.includes(d.papel)) return { ok: false, erro: 'Escolha cliente, transportadora ou os dois' }
  const razao = d.razao_social.trim()
  if (!razao) return { ok: false, erro: 'Informe a razão social (ou o nome)' }
  if (razao.length > 150) return { ok: false, erro: 'Razão social com mais de 150 caracteres' }
  const doc = validarCnpjCpf(d.cnpj_cpf)
  if (!doc.ok) return { ok: false, erro: doc.erro }
  const uf = d.uf.trim().toUpperCase()
  if (uf && !UFS.includes(uf)) return { ok: false, erro: `UF "${d.uf}" inválida` }
  const cep = soDigitos(d.cep)
  if (cep && cep.length !== 8) return { ok: false, erro: 'CEP deve ter 8 dígitos' }
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return { ok: false, erro: 'E-mail inválido' }
  return {
    ok: true,
    linha: {
      papel: d.papel, razao_social: razao, nome_fantasia: nulo(d.nome_fantasia), cnpj_cpf: doc.valor, pessoa_fisica: doc.ok && doc.pessoaFisica,
      inscricao_estadual: nulo(d.inscricao_estadual), email: nulo(d.email), telefone: nulo(d.telefone), cep: cep || null, uf: uf || null,
      cidade: nulo(d.cidade), bairro: nulo(d.bairro), logradouro: nulo(d.logradouro), numero: nulo(d.numero), complemento: nulo(d.complemento),
      rntrc: nulo(d.rntrc), inativo: d.inativo,
    },
  }
}

// ----------------------------------------------------------------------------------------- transportadoras das notas
export type TransporteNota = { cNomeTransp?: string | null; cCnpjCpfTransp?: string | null; cInscricaoTransp?: string | null; cUFTransp?: string | null; cRNTRC?: string | null }
export type Existente = { id: number; cnpj: string; papel: Papel }

/** Nomes que não são transportadora de verdade (o próprio emitente ou o cliente buscando). */
const NAO_E_TRANSPORTADORA = /^(cliente retira|proprio|próprio|o mesmo|remetente|destinat[aá]rio)$/i

/**
 * Transportadoras citadas nas notas de entrada que ainda não estão no cadastro. Só entra quem tem CNPJ/CPF válido
 * (sem documento não dá para saber se é a mesma empresa). Já cadastrada como cliente = vira 'ambos'.
 */
export function planoTransportadoras(transportes: TransporteNota[], existentes: Existente[], validarCnpjCpf: ValidarDoc): {
  inserir: { razao_social: string; cnpj_cpf: string; pessoa_fisica: boolean; inscricao_estadual: string | null; uf: string | null; rntrc: string | null }[]
  virarAmbos: number[]
} {
  const porDoc = new Map(existentes.map((e) => [e.cnpj, e]))
  const inserir = new Map<string, ReturnType<typeof planoTransportadoras>['inserir'][number]>()
  const virarAmbos = new Set<number>()
  for (const t of transportes) {
    const nome = (t.cNomeTransp ?? '').trim()
    if (!nome || NAO_E_TRANSPORTADORA.test(nome)) continue
    const doc = validarCnpjCpf(t.cCnpjCpfTransp ?? '')
    if (!doc.ok || !doc.valor) continue
    const ja = porDoc.get(doc.valor)
    if (ja) { if (ja.papel === 'cliente') virarAmbos.add(ja.id); continue }
    if (inserir.has(doc.valor)) continue
    const uf = (t.cUFTransp ?? '').trim().toUpperCase()
    inserir.set(doc.valor, {
      razao_social: nome.slice(0, 150), cnpj_cpf: doc.valor, pessoa_fisica: doc.pessoaFisica,
      inscricao_estadual: (t.cInscricaoTransp ?? '').trim() || null, uf: UFS.includes(uf) ? uf : null, rntrc: (t.cRNTRC ?? '').trim() || null,
    })
  }
  return { inserir: [...inserir.values()], virarAmbos: [...virarAmbos] }
}
