import { Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'

// Cabeçalho e rodapé compartilhados dos relatórios PDF (NF, OP, transferência).
// O rodapé é `fixed` (repete em toda página) e numera as páginas, e o cabeçalho
// padroniza logo + título. Ver docs/.../plans/2026-06-17-redesign-visual-frontend.md (V8).
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottom: 1,
    borderColor: '#e5e7eb',
    paddingBottom: 10,
  },
  logo: { width: 72, height: 24, objectFit: 'contain' },
  headerRight: { textAlign: 'right' },
  titulo: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#111' },
  sub: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: '#6b7280',
  },
})

export function PdfCabecalho({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <View style={s.header}>
      <Image src={NTB_LOGO_DATA_URL} style={s.logo} />
      <View style={s.headerRight}>
        <Text style={s.titulo}>{titulo}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
    </View>
  )
}

export function PdfRodape({ texto = 'NTB Estoque' }: { texto?: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{texto}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  )
}
