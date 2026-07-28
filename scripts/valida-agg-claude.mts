import fs from 'node:fs'
import pg from 'pg'
import { buscarItensNFFrio, filtrarItensCompras, agregarComprasTotal } from '@/lib/relatorio-frio-nf'

const env: Record<string,string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
process.env.NTB_FRIO_API_URL = env.NTB_FRIO_API_URL
process.env.NTB_FRIO_API_KEY = env.NTB_FRIO_API_KEY

const LOJA = 2, INI = '2026-01-01', FIM = '2026-04-10'

// Lado JS (meu modulo, via endpoint) — restringe aos itens COM full_object
const itens = (await buscarItensNFFrio({ lojaId: LOJA, dataInicio: INI, dataFinal: FIM }))
  .filter(it => it.full_object && Object.keys(it.full_object).length > 0)
const semFiltro = filtrarItensCompras(itens, { familias: [], tipos: [], fornecedor: null, cfops: [], produto: null, local: null }, new Map())
const js = agregarComprasTotal(semFiltro)
console.log(`JS : valor=${js.valor.toFixed(2)} nNotas=${js.nNotas} (sobre ${itens.length} itens c/ full_object, ${semFiltro.length} apos exclusao 910/908)`)

// Lado SQL (direto no Contabo, mesma janela, mesmos itens c/ full_object, mesma exclusao)
const url = env.NTB_FRIO_API_URL // so pra ter algo; conexao real via tunel
const frio = new pg.Client({ connectionString: process.env.CONTABO_DB_URL })
await frio.connect()
const r = await frio.query(`
  select coalesce(sum(coalesce(i.n_qtde_nfe,0)*coalesce(i.n_preco_unit,0)),0)::numeric as valor,
         count(distinct nf.id) as n_notas
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  where i.loja_id = $1 and nf.d_emissao_nfe >= $2 and nf.d_emissao_nfe <= $3
    and (i.full_object is not null and i.full_object::text not in ('{}','null'))
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada',''),'\\D','','g'),3) not in ('910','908')
`, [LOJA, INI, FIM])
console.log(`SQL: valor=${Number(r.rows[0].valor).toFixed(2)} nNotas=${r.rows[0].n_notas}`)
await frio.end()
