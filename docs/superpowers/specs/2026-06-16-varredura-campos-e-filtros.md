# Varredura do sistema — campos de escrita no Omie + filtros (16/06/2026)

Lista pedida pelo fundador: o que cada operação ENVIA ao Omie hoje (vs o que pode), e o estado de TODOS os filtros.

---

## PARTE 1 — Campos enviados ao Omie por operação

### ✅ Produto (`IncluirProduto`) — COMPLETO (validado por teste real criar+consultar+excluir)
Envia: `codigo`, `codigo_produto_integracao`, `descricao`, `unidade`, `ncm`, `valor_unitario`, `tipoItem`,
`codigo_familia`, `ean`, `descr_detalhada`, `obs_internas`, `marca`, `modelo`, `peso_liq`, `peso_bruto`,
`altura`, `largura`, `profundidade`, `recomendacoes_fiscais{ origem_mercadoria, id_cest }`.
Fora (provado que não serve no cadastro): `cfop` (ignorado, é da NF), `caracteristicas` (formato diferente, vem null),
estoque mínimo (vem da posição), IBPT/alíquotas (contador/regime).
Excluir (`ExcluirProduto` por `codigo_produto`) — validado.

### 🟠 Ordem de Produção (`IncluirOrdemProducao`)
Envia hoje: `identificacao{ cCodIntOP, nCodProduto, dDtPrevisao, nQtde, codigo_local_estoque }`,
`infAdicionais{ dDtInicio, dDtConclusao }`, `observacoes{ cObs }` (as 3 datas iguais).
**Falta / a confirmar:**
- **Validade real no Omie** via `lote_validade.dDataVal` (hoje a validade fica só no nosso banco).
- **Etapa** (`cEtapa` 10/40/60) não é enviada.
- **Observação com o usuário** (T1) — a `cObs` não carimba quem fez.
- **Malha (`itensDetalhes`)** não é enviada — apostamos na ficha técnica do produto; **confirmar com o Ramon** que monta certo.
Conclusão (`ConcluirOrdemProducao`): `nCodOP`, `dDtConclusao`, `nQtdeProduzida`, `cObsConclusao`. Falta: obs com usuário.

### 🟠 Transferência (`IncluirAjusteEstoque`, tipo TRF/TPQ)
Envia: `id_prod`, `codigo_local_estoque` (origem), `codigo_local_estoque_destino`, `tipo` (TRF/TPQ),
`origem: 'AJU'`, `motivo`, `quan`, data. **Falta:** observação com o usuário (T1).

### 🟠 Inventário (`IncluirAjusteEstoque`)
Envia: `id_prod`, `codigo_local_estoque`, `quan`, data, `tipo`. **Falta:** observação com o usuário (T1).

### Local de estoque (`IncluirLocalEstoque`) — a varrer com o mesmo método (criar+excluir).

> **Método para fechar os 🟠:** criar uma OP / ajuste de teste, `ConsultarOrdemProducao`/consultar, e excluir/reverter — igual fiz no produto. Confirma campo a campo o que o Omie aceita, sem deixar lixo.

---

## PARTE 2 — Filtros por tela

| Tela | Filtros | Estado |
|---|---|---|
| Produto | q, família, tipo, situação (+ vista preços/compras, margem, só repor) | OK. Possível: ordenação por preço/margem |
| Ordem de Produção | data, OP, produto, tipo, **status**, ordenação | ✅ completo |
| Nota Fiscal | data, nº, fornecedor, status, tipo, produto | ✅ completo |
| **Transferência** | data, família, tipo, **+status, +motivo (TRF/TPQ)** | ✅ melhorado 16/06 |
| **Inventário** | data, família, tipo, **+status (finalizado/aberto)** | ✅ melhorado 16/06 |
| **Local de estoque** | busca, **+situação (ativos/inativos/todos)** | ✅ melhorado 16/06 |
| Validade | tipo, períodos (3/7/15/30/60), vencidos | Falta: **família** |
| Impressões | data, origem | OK |
| Log de integração | data, loja, model, HTTP code, status | ✅ completo |
| Saúde da integração | período, model | OK |
| Lojas / Usuários | busca | OK (volume pequeno) |

**Ainda a fazer nos filtros:** Validade → família; Produto → ordenação por preço/margem (opcional).
