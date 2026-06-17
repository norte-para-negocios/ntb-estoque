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

### ✅ Ordem de Produção (`IncluirOrdemProducao`) — VARRIDO no Omie real
Envia: `identificacao{ cCodIntOP, nCodProduto, dDtPrevisao, nQtde, codigo_local_estoque }`,
`infAdicionais{ dDtInicio, dDtConclusao }`, `observacoes{ cObs }`.
**Confirmado por teste:**
- `lote_validade` e `cEtapa` **NÃO existem** na criação de OP (Omie rejeita: "não faz parte de copIncluirRequest").
  → a **validade fica só no nosso banco mesmo** (não há onde enviar) — decisão atual correta.
- A OP só cria para produtos **com estrutura/malha preenchida**; o Omie monta a malha da ficha técnica →
  **não precisamos enviar `itensDetalhes`** (confirmado pela mensagem do Omie). Nosso approach está certo.
- **Falta:** a `cObs` carimbar o usuário (T1).
Conclusão (`ConcluirOrdemProducao`): `nCodOP`, `dDtConclusao`, `nQtdeProduzida`, `cObsConclusao`.

### ✅ Transferência + Inventário (`IncluirAjusteEstoque`) — VARRIDO (criado+excluído no Omie)
Envia: `codigo_local_estoque`, `id_prod`, `cod_int_ajuste`, `data` (DD/MM/AAAA, **não pode ser futura**), `quan`,
`valor`, `obs`, `origem: 'AJU'`, `tipo` (ENT/SAI/TRF...), `motivo` (TRF/TPQ/INV), `codigo_local_estoque_destino`.
**Completo.** Só falta a `obs` carimbar o usuário (T1) — hoje fixa "NTB - Estoque". Excluir ajuste só funciona
depois que o Omie processa (assíncrono).

### 🐛→✅ Local de estoque (`IncluirLocalEstoque`) — BUG achado e corrigido
O campo **`tipo` é obrigatório** e o nosso código NÃO enviava (9.2 nunca tinha sido testado no Omie) → falhava
"tag [tipo] obrigatória". **Corrigido:** envia `tipo: '1'` (próprio). Achados extras: o Omie **não tem
`ExcluirLocalEstoque`** nem aceita inativar via `AlterarLocalEstoque` (tag `inativo` não existe lá) — local criado
por engano só some excluindo **no painel do Omie**. Campos do local: codigo, descricao, tipo, padrao, inativo,
dispVenda/dispOrdemProducao/dispConsumoOP/dispRemessa.

> **Pendência de limpeza:** a varredura deixou 2 locais de teste no Omie (sem como excluir por API):
> `4834375616` e `4834375658` ("ZZ VARREDURA EXCLUIR"). **Excluir manualmente** no painel do Omie (Estoque → Locais).

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
