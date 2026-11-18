// F-18: o pedido de compra guarda uma CÓPIA do nome do produto (vinda da busca da tela, que mostra o nome em formato de título e
// com acento posto: "Alho Triturado (MP)"). Na tela da nota o certo é o nome do cadastro, como está lá ("ALHO TRITURADO (MP)").
export function nomeDoCadastro(porCodigo: Map<number, string | null | undefined>, codigo: number | null | undefined, copia: string | null | undefined): string {
  const cad = codigo == null ? null : porCodigo.get(Number(codigo))
  return (cad && cad.trim()) || copia || ''
}
