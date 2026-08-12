import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FlaskConical } from 'lucide-react'

// Sertão Teste (2026-08-12) -- tela admin-only pra visualizar as OPs
// gravadas por app/api/integracao/ordem-producao-teste/route.ts, que
// NUNCA fala com a Omie. Isolada de propósito: sem link em nenhum menu
// nem em app/(app)/ordem-producao/page.tsx -- só acessível digitando a
// URL /ordem-producao/teste direto. Ver .superpowers/sdd/
// 2026-08-12-sertao-teste-estoque/task-3-brief.md.

const LIMITE = 200

type OrdemProducaoTeste = {
  id: number
  loja_id: number
  codigo_produto: number | null
  codigo_produto_texto: string
  quantidade: number
  pedido_ref: string | null
  criado_em: string
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function OrdemProducaoTestePage() {
  // Admin global apenas -- mesmo padrão de app/(app)/log/page.tsx (isAdmin()
  // + notFound() pra quem não é admin).
  const admin = await isAdmin()
  if (!admin) notFound()

  const supabase = await createClient()

  const { data: opsData } = await supabase
    .from('ordens_producao_teste')
    .select('id, loja_id, codigo_produto, codigo_produto_texto, quantidade, pedido_ref, criado_em')
    .order('criado_em', { ascending: false })
    .limit(LIMITE)

  const ops = (opsData ?? []) as OrdemProducaoTeste[]

  // Resolve loja_id -> nome numa segunda query simples (volume baixíssimo,
  // sem necessidade de join no banco).
  const lojaIds = [...new Set(ops.map((op) => op.loja_id))]
  const { data: lojasData } = lojaIds.length
    ? await supabase.from('lojas').select('id, nome, nome_fantasia').in('id', lojaIds)
    : { data: null }
  const nomePorLoja = new Map((lojasData ?? []).map((l) => [l.id, l.nome_fantasia || l.nome]))

  return (
    <div className="space-y-5">
      <ListaHeader>
        <PageHeader
          title="Ordens de Produção · Teste"
          icon={FlaskConical}
          description="Sertão Teste -- OPs recebidas pela rota de integração isolada, sem envio à Omie"
        />
      </ListaHeader>

      <Lista
        linhas={ops}
        chaveLinha={(op) => op.id}
        colunas={[
          {
            label: 'Loja',
            primaria: true,
            render: (op) => nomePorLoja.get(op.loja_id) ?? `Loja ${op.loja_id}`,
          },
          {
            label: 'Código',
            render: (op) => op.codigo_produto_texto,
          },
          {
            label: 'Quantidade',
            alinhar: 'right',
            render: (op) => <span className="num">{op.quantidade}</span>,
          },
          {
            label: 'Pedido Ref',
            render: (op) => op.pedido_ref ?? '-',
          },
          {
            label: 'Criado em',
            render: (op) => (
              <span className="whitespace-nowrap text-text-muted">{formatarData(op.criado_em)}</span>
            ),
          },
        ]}
        vazio={
          <EmptyState
            icon={FlaskConical}
            title="Nenhuma OP de teste"
            hint="As OPs recebidas pela integração de teste (Sertão) aparecerão aqui."
          />
        }
      />
    </div>
  )
}
