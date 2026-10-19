// Escritor de ZIP mínimo (PKZIP 2.0: deflate, nomes em UTF-8, sem ZIP64) para o pacote do contador. Sem dependência
// nova: só node:zlib (deflateRawSync); o CRC-32 é calculado aqui (o zlib.crc32 só existe do Node 22.2 em diante).
// Limites: < 65.535 arquivos e < 4 GB (o pacote de um mês fica em MB). Teste: node --test lib/contador/zip.test.ts
import { deflateRawSync } from 'node:zlib'

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ArquivoZip = { nome: string; dados: Uint8Array | string; data?: Date }

function dosDataHora(d: Date): { data: number; hora: number } {
  const ano = Math.max(1980, d.getFullYear())
  return {
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  }
}

/** Nome seguro dentro do ZIP: sem barra invertida, sem "..", sem caminho absoluto. */
export function nomeSeguro(nome: string): string {
  const partes = nome.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
  return partes.join('/') || 'arquivo'
}

export function criarZip(arquivos: ArquivoZip[]): Buffer {
  if (arquivos.length >= 0xffff) throw new Error('Arquivos demais para um ZIP sem ZIP64')
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let offset = 0
  const usados = new Set<string>()
  for (const a of arquivos) {
    let nome = nomeSeguro(a.nome)
    for (let k = 2; usados.has(nome); k++) nome = nome.replace(/(\.[^./]*)?$/, (ext) => `-${k}${ext ?? ''}`)
    usados.add(nome)
    const bruto = typeof a.dados === 'string' ? Buffer.from(a.dados, 'utf8') : Buffer.from(a.dados)
    const comp = deflateRawSync(bruto, { level: 6 })
    const usaDeflate = comp.length < bruto.length
    const corpo = usaDeflate ? comp : bruto
    const crc = crc32(bruto) >>> 0
    const nomeBuf = Buffer.from(nome, 'utf8')
    const { data, hora } = dosDataHora(a.data ?? new Date())
    const metodo = usaDeflate ? 8 : 0
    const flags = 0x0800 // nome em UTF-8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(data, 12); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(corpo.length, 18); local.writeUInt32LE(bruto.length, 22); local.writeUInt16LE(nomeBuf.length, 26); local.writeUInt16LE(0, 28)
    locais.push(local, nomeBuf, corpo)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(metodo, 10); central.writeUInt16LE(hora, 12); central.writeUInt16LE(data, 14); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(corpo.length, 20); central.writeUInt32LE(bruto.length, 24); central.writeUInt16LE(nomeBuf.length, 28)
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42)
    centrais.push(central, nomeBuf)

    offset += local.length + nomeBuf.length + corpo.length
    if (offset > 0xffffffff) throw new Error('Pacote grande demais para um ZIP sem ZIP64')
  }
  const tamCentral = centrais.reduce((s, b) => s + b.length, 0)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(0, 4); fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(usados.size, 8); fim.writeUInt16LE(usados.size, 10); fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(offset, 16); fim.writeUInt16LE(0, 20)
  return Buffer.concat([...locais, ...centrais, fim])
}
