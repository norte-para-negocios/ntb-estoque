# Referência completa da API da Omie

Levantamento exaustivo de todos os serviços/métodos/campos da API da Omie
(`developer.omie.com.br/service-list`), feito em 2026-08-01 a pedido do
usuário. Cobre TODOS os ~80 serviços listados no portal do desenvolvedor,
não só os já usados neste projeto.

**Como foi gerado:** WebFetch em cada URL de serviço (WSDL), pedindo lista
exaustiva de métodos + parâmetros de entrada/saída. Onde a Omie marca um
método como deprecated na própria documentação, isso foi preservado aqui.

**Uso deste documento:** referência bruta, não filtrada por relevância pro
projeto. Pra ver o que já usamos de fato, ver `lib/omie/*.ts`. Pra achado
específico sobre notas fiscais/manifestação, ver a seção "NF-e" e a nota
no rodapé sobre manifestação do destinatário.

---

## Geral e Cadastros Auxiliares (Geral)

### Clientes/Fornecedores/Transportadoras — `https://app.omie.com.br/api/v1/geral/clientes/`

**IncluirCliente**
- Entrada: clientes_cadastro (Object, obrigatório) — registro completo do cliente (ver estrutura abaixo)
- Saída: clientes_status (Object) — codigo_cliente_omie (integer), codigo_cliente_integracao (string60), codigo_status (string4), descricao_status (text)

**AlterarCliente**
- Entrada: clientes_cadastro (Object, obrigatório) — registro completo do cliente
- Saída: clientes_status (Object) — mesmos campos acima

**ExcluirCliente**
- Entrada: clientes_cadastro_chave (Object) — codigo_cliente_omie (integer), codigo_cliente_integracao (string60)
- Saída: clientes_status (Object)

**ConsultarCliente**
- Entrada: clientes_cadastro_chave (Object) — codigo_cliente_omie (integer), codigo_cliente_integracao (string60)
- Saída: clientes_cadastro (Object completo, ver campos abaixo)

**AssociarCodIntCliente**
- Entrada: clientes_cadastro_chave (Object) — codigo_cliente_omie (integer), codigo_cliente_integracao (string60)
- Saída: clientes_status (Object)

**UpsertCliente**
- Entrada: clientes_cadastro (Object, obrigatório)
- Saída: clientes_status (Object)

**UpsertClienteCpfCnpj**
- Entrada: clientes_cadastro (Object, obrigatório, deve incluir cnpj_cpf)
- Saída: clientes_status (Object)

**ListarClientes**
- Entrada: clientes_list_request (Object) — pagina (integer), registros_por_pagina (integer), apenas_importado_api (string1), filtrar_por_data_de/ate (string dd/mm/aaaa), filtrar_por_hora_de/ate (string hh:mm:ss), filtrar_apenas_inclusao (string1), filtrar_apenas_alteracao (string1), clientesFiltro (Object), clientesPorCodigo (Array), exibir_caracteristicas (string1), exibir_obs (string1)
- Saída: clientes_listfull_response — pagina, total_de_paginas, registros, total_de_registros (integer), clientes_cadastro (Array de objetos completos)

**ListarClientesResumido**
- Entrada: clientes_list_request (Object) — igual ao ListarClientes
- Saída: clientes_list_response — pagina, total_de_paginas, registros, total_de_registros (integer), clientes_cadastro_resumido (Array reduzido)

**IncluirClientesPorLote** [DEPRECATED, máx 50 registros]
- Entrada: clientes_lote_request — lote (integer), clientes_cadastro (Array)
- Saída: clientes_lote_response — lote (integer), codigo_status (string4), descricao_status (text)

**UpsertClientesPorLote** [DEPRECATED, máx 50 registros]
- Entrada: clientes_lote_request — lote (integer), clientes_cadastro (Array)
- Saída: clientes_lote_response

Estrutura `clientes_cadastro` (campos principais): codigo_cliente_omie (integer), codigo_cliente_integracao (string60), razao_social (string60, obrig.), cnpj_cpf (string20, obrig. p/ NF-e/NFS-e), nome_fantasia (string100), telefone1_ddd/numero (string5/15), telefone2_ddd/numero, fax_ddd/numero, contato (string100), endereco (string60), endereco_numero (string60), complemento (string60), bairro (string60), cidade (string40), cidade_ibge (string7), estado (string2), cep (string10), codigo_pais (string4), email (string500), homepage (string100), inscricao_estadual/municipal/suframa (string20), optante_simples_nacional (string1 S/N), contribuinte (string1 S/N), tipo_atividade (string1), cnae (string7), produtor_rural (string1 S/N), observacao/obs_detalhadas (text), recomendacao_atraso (string2), pesquisar_cep (string1), separar_endereco (string1), exterior (string1), nif (string100), documento_exterior (string20), pessoa_fisica (auto, read-only), importado_api (auto, read-only), inativo (string1 S/N), valor_limite_credito (decimal), bloquear_faturamento (string1), enviar_anexos (string1), bloquear_exclusao (string1), tags (Array), caracteristicas (Array: campo string30 obrig., conteudo string60), recomendacoes (Object: numero_parcelas, codigo_vendedor, email_fatura, gerar_boletos, codigo_transportadora, tipo_assinante), dadosBancarios (Object: codigo_banco string3, agencia string10, conta_corrente string25, doc_titular string20, nome_titular string60, transf_padrao string1, cChavePix string60), enderecoEntrega (Object: entRazaoSocial, entCnpjCpf, entEndereco, entNumero, entComplemento, entBairro, entCEP, entEstado, entCidade, entSepararEndereco, entTelefone, entIE), info (read-only: dInc, hInc, uInc, dAlt, hAlt, uAlt, cImpAPI).

### Clientes - Características — `https://app.omie.com.br/api/v1/geral/clientescaract/`

**IncluirCaractCliente** — Entrada: codigo_cliente_omie (integer); codigo_cliente_integracao (string60); campo (string30, obrigatório); conteudo (string60, obrigatório na criação). Saída: codigo_cliente_omie, codigo_cliente_integracao, codigo_status (string4), descricao_status (text)

**AlterarCaractCliente** — Entrada: idem + conteudo vazio exclui a característica. Saída: idem

**ConsultarCaractCliente** — Entrada: codigo_cliente_omie; codigo_cliente_integracao. Saída: caracteristicas (Array: campo, conteudo)

**ExcluirCaractCliente** — Entrada: + campo (string30, obrigatório). Saída: status

**ExcluirTodasCaractCliente** — Entrada: codigo_cliente_omie; codigo_cliente_integracao. Saída: status

### Tags — `https://app.omie.com.br/api/v1/geral/clientetag/`

**IncluirTags** — Entrada: nCodCliente (integer); cCodIntCliente (string60); tags (Array: tag text). Saída: cCodStatus, cDesStatus, tagsLista (Array: tag, nCodTag)

**ListarTags** — Entrada: nCodCliente; cCodIntCliente. Saída: tagsLista

**ExcluirTags** — Entrada: + tags (Array). Saída: status

**ExcluirTodas** — Entrada: nCodCliente; cCodIntCliente. Saída: status

### Projetos — `https://app.omie.com.br/api/v1/geral/projetos/`

**IncluirProjeto** — Entrada: codInt (string20, obrig.); nome (string70, obrig.); inativo (string1 S/N). Saída: codigo, codInt, status, descricao

**AlterarProjeto / ExcluirProjeto / UpsertProjeto** — mesmos campos chave (codigo/codInt) + nome/inativo

**ConsultarProjeto** — Saída: codigo, codInt, nome, inativo, info (data/hora/user inc e alt)

**ListarProjetos** — Entrada: pagina, registros_por_pagina, apenas_importado_api, ordenar_por, ordem_descrescente, filtros de data/inclusão/alteração, nome_projeto. Saída: paginação + cadastro (Array)

### Empresas — `https://app.omie.com.br/api/v1/geral/empresas/`

**ConsultarEmpresa** — Entrada: codigo_empresa (integer, obrig.). Saída: empresas_cadastro — objeto MUITO extenso (100+ campos): codigo_empresa, codigo_empresa_integracao, cnpj, razao_social, nome_fantasia, endereço completo, telefone1, email, website, cnae, inscricao_estadual/municipal, regime_tributario, inativa, optante_simples_nacional, gera_nfe/nfse/nfce_sn (S/N), dtabertura, datas de inclusão/alteração, mais 80+ campos de certificado digital e configuração SPED/EFD/parâmetros de faturamento (não individualmente listados pela doc consultada — merece fetch dedicado se precisar do detalhamento completo).

**ListarEmpresas** — Entrada: pagina, registros_por_pagina (obrig., máx 100), apenas_importado_api (deprecated). Saída: paginação + empresas_cadastro (Array de objetos completos)

### Departamentos — `https://app.omie.com.br/api/v1/geral/departamentos/`

**IncluirDepartamento / AlterarDepartamento** — Entrada: codigo (string40, obrig.); descricao (string50, obrig.). Saída: codigo, descricao, cCodStatus, cDesStatus

**ExcluirDepartamento** — Entrada: codigo. Saída: status

**ConsultarDepartamento** — Saída: codigo, descricao, estrutura (string40, modo diagrama), inativo, nivel_totalizador

**ListarDepartamentos** (e alias deprecated **ListarDepatartamentos**) — Entrada: pagina, registros_por_pagina (obrig.) + filtros deprecated. Saída: paginação + departamentos (Array)

### Categorias — `https://app.omie.com.br/api/v1/geral/categorias/`

**IncluirCategoria** — Entrada: categoria_superior (text, obrig. — código totalizador 4 dígitos); descricao (string50, obrig.); natureza; tipo_categoria; codigo_dre. Saída: codigo_status, descricao_status, codigo

**AlterarCategoria** — + conta_inativa (string1)

**ConsultarCategoria** — Saída: codigo, descricao, descricao_padrao, tipo_categoria, conta_inativa, definida_pelo_usuario, id_conta_contabil, tag_conta_contabil, conta_despesa/receita (S/N), nao_exibir, natureza, totalizadora, transferencia, codigo_dre, categoria_superior, dadosDRE (Object)

**IncluirGrupoCategoria / AlterarGrupoCategoria** — Entrada: descricao; tipo_grupo (R/D); natureza. Saída: codigo_status, descricao_status, codigo

**ListarCategorias** — Entrada: pagina, registros_por_pagina (obrig.), descricao, filtrar_apenas_ativo, filtrar_por_tipo (R/D). Saída: paginação + categoria_cadastro (Array completo)

### Parcelas — `https://app.omie.com.br/api/v1/geral/parcelas/`

**IncluirParcela** — Entrada: cParcela (text, obrig.) — formatos: "10/20/30/40" (dias), "A Vista/40/60", "Para 93 dias", "50" (quantidade). Saída: cCodStatus, cDesStatus, cCodParcela (string3 gerado), cDesParcela

**ListarParcelas** — Entrada: pagina, registros_por_pagina, apenas_importado_api, ordenar_por, ordem_decrescente. Saída: paginação + cadastros (Array: nCodigo string3, cDescricao string30, nParcelas integer)

### Tipos de Atividade da Empresa — `https://app.omie.com.br/api/v1/geral/tpativ/`

**ListarTipoAtiv** — Entrada: filtrar_por_codigo, filtrar_por_descricao. Saída: lista_tipos_atividade (Array: cCodigo string1, cDescricao string30)

### CNAE — `https://app.omie.com.br/api/v1/produtos/cnae/`

**ListarCNAE** — Entrada: pagina, registros_por_pagina, ordenar_por, ordem_decrescente. Saída: paginação + cadastros (Array: nCodigo string7, cDescricao string200, cEstrutura string10)

### Cidades — `https://app.omie.com.br/api/v1/geral/cidades/`

**PesquisarCidades** — Entrada: pagina, registros_por_pagina, apenas_importado_api, ordenar_por, ordem_descrescente, filtros de data/inclusão/alteração, filtrar_cidade_contendo (string40 — nome+estado), filtrar_por_uf, filtrar_por_cidade (código ou IBGE). Saída: paginação + lista_cidades (Array: cCod string40, cNome string40, cUF string2, nCodIBGE string7, nCodSIAFI integer)

### Países — `https://app.omie.com.br/api/v1/geral/paises/`

**ListarPaises** — Entrada: filtrar_por_codigo (IBGE), filtrar_por_descricao, filtrar_por_codigo_iso (string2). Saída: lista_paisesArray (Array: cCodigo string4, cDescricao string30, cCodigoISO string2)

### Tipos de Anexos — `https://app.omie.com.br/api/v1/geral/tiposanexo/`

**ListarTiposAnexos** — Entrada: codigo (string10, opcional). Saída: listaTipoAnexo (Array: codigo string10, descricao string100)

### Documentos Anexos — `https://app.omie.com.br/api/v1/geral/anexo/`

**IncluirAnexo** — Entrada: cCodIntAnexo; cTabela (string100 — cliente/produto/servico/pedido-venda/remessa-produto/ordem-servico/contrato-servico/pedido-compra/nota-entrada/ordem-producao/conta-pagar/conta-receber/conta-corrente/conta-corrente-lancamento/crm-contas/crm-contatos/crm-oportunidades/com-recebimento); nId (integer, obrig.); cNomeArquivo; cTipoArquivo; cArquivo (text, obrig. — arquivo zipado em base64); cMd5 (hash MD5). Saída: nIdAnexo (auto), cCodStatus, cDesStatus

**ConsultarAnexo** — Entrada: cCodIntAnexo/cTabela/nId (obrig.)/nIdAnexo/cNomeArquivo. Saída: dados + info

**ExcluirAnexo** — mesma chave. Saída: status

**ListarAnexo** — Entrada: paginação + cOrdenarPor (ARQUIVO), filtros de data, nId (obrig.), cTabela. Saída: paginação + listaAnexos

**ObterAnexo** — Saída: cLinkDownload (string500, URL), dDtExpiracao

Estrutura `info` comum a vários serviços: dInc/hInc/uInc, dAlt/hAlt/uAlt, cImpAPI (S/N).

### Tipo de Entrega — `https://app.omie.com.br/api/v1/geral/tiposentrega/`

**IncluirTipoEntrega** — Entrada: nCodTransp (integer — transportadora); cCodIntEntrega (string40); cDescricao (string80); cInativo (S/N). Saída: nCodEntrega (integer), status

**AlterarTipoEntrega / ExcluirTipoEntrega / ConsultarTipoEntrega** — mesma chave (nCodEntrega/cCodIntEntrega)

**ListarTipoEntrega** — Entrada: paginação, dDtAltDe/Ate, nCodTransp. Saída: CadTiposEntrega (Array)

### Tipo de Assinante — `https://app.omie.com.br/api/v1/geral/tipoassinante/`

**ListarTipoAssinante** — Entrada: pagina, registros_por_pagina, ordenar_por, ordem_decrescente. Saída: cadastros (Array: cCodigo string1, cDescricao string50)

### Tarefas — `https://app.omie.com.br/api/v1/geral/tarefas/`

**IncluirTarefa** — Entrada: cCodIntTarefa; cOrigem (string20, obrig. — oportunidade/geral/cliente/produto/servico/pedido-venda/pedido-compra/pedido-importacao/contas-pagar/contas-receber/ordem-producao/ordem-servico/contrato-servico); nCodDoc; cDescricao; dData; hHora; cImportante/cUrgente (S/N); cSituacao (default pendente); nCodAtividade; nCodNotif; nCodUserAtb (integer, obrig.). Saída: nCodTarefa, status

**AlterarTarefa** — + cSituacao (pendente/em-execucao/realizada)

**ExcluirTarefa / ConsultarTarefa** — chave nCodTarefa/cCodIntTarefa

**ListarTarefas** — Entrada: paginação, cOrigem, cImportante/cUrgente, cSituacao, cIntervalo (hoje/semana-atual/proxima-semana/mes), dDataInicial/Final, cCriadasPorMim/cAtribuidasAMim (S/N), nCodDoc, ordenação. Saída: listaTarefas

**ObterCalendarioTarefas** — Saída: calendario (Array por dia: nPendentes/nEmExecucao/nConcluidas)

**ObterResumoTarefas** — Saída: resumo (nHoje, nSemanaAtual, nProximaSemana, nMesAtual)

**ObterTotalTarefas** — Saída: nTarefas (integer)

Estrutura `tarefa` completa: nCodTarefa, cCodIntTarefa, cOrigem, nCodDoc, cDescDoc, cDescricao, dData, hHora, cImportante, cUrgente, nCodSituacao/cSituacao, nCodTipoTarefa/cDescTipoTarefa, nCodNotif/cDescNotif, nCodUserAtb/cNomeUserAtb, cDescOrigem.

---

## CRM

### Contas — `https://app.omie.com.br/api/v1/crm/contas/`

**IncluirConta / AlterarConta / UpsertConta** — Entrada: cadastros (objeto complexo, ver estrutura abaixo). Saída: nCod, cCodInt, cCodStatus, cDesStatus

**ConsultarConta** — Entrada: nCod ou cCodInt. Saída: cadastros (array completo)

**ExcluirConta** — Entrada: nCod ou cCodInt. Saída: status

**ListarContas** — Entrada: pagina, registros_por_pagina, apenas_importado_api, ordenar_por, ordem_decrescente, cDoc (CNPJ/CPF). Saída: paginação + cadastros

**VerificarConta** — Entrada: cNome, cEmail, cDoc. Saída: status (usado pra checar duplicidade antes de incluir)

Estrutura `cadastros` (Conta CRM): identificacao (nCod, cCodInt, cNome, cNomeFantasia, cDoc, nCodVend, nCodVert, nCodTelemkt, dDtReg, dDtValid, cObs); endereco completo; telefone_email; informacoesAdicionais (nNumFunc, nFaixaFat, cCnae, cRegTrib); tags (Array); caracteristicas (Array: campo, conteudo); contatos (Array rico, ver serviço Contatos).

### Contas - Características — `https://app.omie.com.br/api/v1/crm/contascaract/`

Mesmo padrão de "Clientes - Características" (Incluir/Alterar/Consultar/Excluir/ExcluirTodas), chave nCod/cCodInt + campo/conteudo.

### Contatos — `https://app.omie.com.br/api/v1/crm/contatos/`

**IncluirContato/AlterarContato/UpsertContato** — Entrada: cadastros (identificacao: cCodInt, cNome, cSobrenome, cCargo, dDtNasc, nCodVend, nCodConta; endereco; telefone_email incl. 2 celulares; cObs). Saída: nCod, cCodInt, status

**ConsultarContato** — Saída: cadastros (array)

**ExcluirContato** — Saída: status

**ListarContatos** — Entrada: paginação obrig., apenas_importado_api, ordenar_por, ordem_decrescente, exibir_obs, filtrar_por_conta. Saída: paginação + cadastros

**VerificarContato** — Entrada: cNome, cEmail (obrig.). Saída: status

### Oportunidades — `https://app.omie.com.br/api/v1/crm/oportunidades/`

**IncluirOportunidade/AlterarOportunidade/UpsertOportunidade** — Entrada rica: identificacao (cCodIntOp, cDesOp obrig., nCodConta, nCodContato, nCodOrigem, nCodSolucao, nCodVendedor); fasesStatus (nCodFase, nCodStatus, nCodMotivo, datas de cada fase: dNovoLead/dQualificacao/dTreinamento/dShowRoom/dProjeto/dConclusao); ticket (nProdutos, nServicos, nRecorrencia, nMeses, nTicket auto); previsaoTemp (nTemperatura, nMesPrev, nAnoPrev); observacoes; outrasInf (nCodTipo, cEmailOp); envolvidos (nCodFinder, nCodParceiro, nCodPrevenda); concorrentes (Array: nCodConc, cObservacao). Saída: nCodOp, cCodIntOp, status

**ConsultarOportunidade** — Saída: todos os campos acima + cNumOp

**ExcluirOportunidade** — Saída: status

**ListarOportunidades** — Entrada extensa: paginação, filtros de vendedor/período/fase/motivo/status (A/C/P/S/V), exibir_detalhes, filtrar_por_conta, exibir_obs. Saída: cadastros (com tarefas, lista_papeis, lista_tickets aninhados)

### Oportunidades - Resumo — `https://app.omie.com.br/api/v1/crm/oportunidades-resumo/`

**ObterListaOp** — Entrada: cMesAno, cTemperatura (em-processo/boas-chances/comprometido/conquistado). Saída: listaDetalhesOp (com cIcone/cCor pra UI)

**ObterResumoOp** — Entrada: nIdVendedor, nIdParceiro, cMesAno. Saída: funilOportunidades (mesAtual/proximoMes/mesesSeguintes) + saudePipeline (vMeta, vConquistado, nIndicador 0-300, cStatus CRÍTICO/ACEITÁVEL/EXCELENTE)

### Tarefas (CRM) — `https://app.omie.com.br/api/v1/crm/tarefas/`

Vinculadas a oportunidades (nCodOp obrigatório na inclusão), diferente das "Tarefas" gerais. Métodos: IncluirTarefa, AlterarTarefa, ExcluirTarefa, ConsultarTarefa, ListarTarefas, ListarEmailsTarefas, UpsertTarefa, CalendarioTarefas (retorna .ics). Campos: nCodAtividade (1=Ligar,2=Reunião,3=Tarefa,4=E-mail,5=Almoço,6=Prazo Final,7=Nota), nCodNotif (99999=sem/15/30/60/120/180 min/1001-1003 dias/2001-2002 semanas), cImportante/cUrgente/cEmExecucao/cRealizada (S/N).

### Tarefas - Resumo — `https://app.omie.com.br/api/v1/crm/tarefas-resumo/`

**ObterDetalhesTarefa**, **ObterListaTarefas** (lista rica com dados de oportunidade/contato/vendedor/conta associados), **ObterResumoTarefas** (agrupado por dia: Todos/Futuras/Hoje/Execução/Realizadas).

### Cadastros auxiliares de CRM (todos padrão `Listar<Nome>` com paginação simples, cadastros = código+descrição+observação)

- **Soluções** — `crm/solucoes/` — ListarSolucoes (+ cInativo)
- **Fases** — `crm/fases/` — ListarFases (cDescrPadrao, cDescrUsuario, nOrdem)
- **Usuários** — `crm/usuarios/` — ListarUsuarios (+ ObterUsuarios: nCodigo, cNome, cEmail, nMeta, telefones)
- **Status** — `crm/status/` — ListarStatus
- **Motivos** — `crm/motivos/` — ListarMotivos
- **Tipos** — `crm/tipos/` — ListarTipos (tipos de oportunidade)
- **Parceiros** — `crm/parceiros/` — ListarParceiros (+ cEmail, cInativo)
- **Finders** — `crm/finders/` — ListarFinders (+ cNome, cEmail, cInativo)
- **Origens** — `crm/origens/` — ListarOrigens
- **Concorrentes** — `crm/concorrentes/` — ListarConcorrentes
- **Verticais** — `crm/verticais/` — ListarVerticais
- **Tipos de Tarefas** — `crm/tipostarefa/` — Incluir/Alterar/Consultar/Excluir/ListarTiposTarefa (nMinutos duração padrão, cSyncCalend S/N sincroniza calendário)

---

## Finanças

### Contas Correntes — `https://app.omie.com.br/api/v1/geral/contacorrente/`

**IncluirContaCorrente/AlterarContaCorrente/UpsertContaCorrente** — Entrada muito extensa: tipo_conta_corrente (AC/AD/CA/CC/CE/CG/CN/CP/CR/CV/CX/MT/PG), codigo_banco, descricao, agência/conta, saldo_inicial+data, valor_limite, config de cobrança (juros/multa/instruções boleto), config PIX, config PDV/TEF (taxa loja/adm, bandeira, número parcelas), endereço, inativo. Saída: nCodCC, status

**ExcluirContaCorrente / ConsultarContaCorrente** — chave nCodCC/cCodCCInt

**ListarContasCorrentes / ListarResumoContasCorrentes / PesquisarContaCorrente(deprecated)** — paginação + filtros de data/status/descrição

**UpsertContaCorrentePorLote** — lote de contas correntes

### Contas Correntes - Lançamentos — `https://app.omie.com.br/api/v1/financas/contacorrentelancamentos/`

**IncluirLancCC/AlterarLancCC/ExcluirLancCC/ConsultaLancCC/ListarLancCC** — cabecalho (conta, data, valor); detalhes (categoria + rateio, cTipo doc ADI/BOL/CRT/CHQ/CON/CRE/DRF/DAS/DEB/DIN/DOC/GUIA/PROT/REC/RPA/TED/TRA/99999, nCodCliente, nCodProjeto, cObs); transferencia (conta destino); departamentos (rateio). Saída inclui `diversos`: cOrigem (DEVP/DEVR/EXTP/EXTR/IMPP/MANP/MANR/NFEP/NFER/OFXP/OFXR/RPTP/RPTR/TRAP/TRAR/VENR/XMLP/XMLR — origem do lançamento), dados de conciliação.

### Contas a Pagar - Lançamentos — `https://app.omie.com.br/api/v1/financas/contapagar/`

**Incluir/Alterar/Excluir/Consultar/Upsert/IncluirPorLote/UpsertPorLote ContaPagar** — campos: cliente/fornecedor, vencimento, valor, categoria, tributos retidos (PIS/COFINS/CSLL/IR/ISS/INSS, valor+flag retém), chave NFe, código de barras, distribuição por departamento, `cnab_integracao_bancaria` (forma pagamento TRA/BOL/PIX, dados bancários, PIX QR code), `servico_tomado` (NF de serviço tomado com tributos)

**LancarPagamento / CancelarPagamento** — baixa de título: conta corrente, valor, desconto/juros/multa, data, conciliação

**ListarContasPagar** — filtro cStatus: CANCELADO/PAGO/LIQUIDADO/EMABERTO/PAGTO_PARCIAL/VENCEHOJE/AVENCER/ATRASADO

### Contas a Receber - Lançamentos — `https://app.omie.com.br/api/v1/financas/contareceber/`

Espelha Contas a Pagar (mesmos campos), mais: **LancarRecebimento/CancelarRecebimento**, **ConciliarRecebimento/DesconciliarRecebimento**, **IncluirDistribuicaoDepartamento/AlterarDistribuicaoDepartamento/ExcluirDistribuicaoDepartamento**, **CancelarContaReceber**.

### Contas a Receber - Boletos — `https://app.omie.com.br/api/v1/financas/contareceberboleto/`

**GerarBoleto/ObterBoleto/ProrrogarBoleto/CancelarBoleto** — cLinkBoleto, código de barras, juros/multa, até 3 níveis de desconto condicional por data. Nota: boletos já enviados ao banco têm tarifação pra emitir/cancelar/prorrogar.

### Contas a Receber - PIX — `https://app.omie.com.br/api/v1/financas/pix/`

**GerarPix/GerarQrCodePix/CancelarPix/ObterPix/ObterStatusPix/ListarPix/ListarStatusPix** — cUrlPix, cQrCode, cCopiaCola, cStatus (LIQUIDADO/CANCELADO/REGISTRADO).

### Extrato de Conta Corrente — `https://app.omie.com.br/api/v1/financas/extrato/`

**ListarExtrato** — saldo anterior/atual/conciliado/provisório/disponível + listaMovimentos detalhado (documento, categoria, cliente, situação, data de conciliação).

### Orçamento de Caixa — `https://app.omie.com.br/api/v1/financas/caixa/`

**ListarOrcamentos** — por ano/mês: valor previsto vs. realizado por categoria.

### Pesquisar Títulos — `https://app.omie.com.br/api/v1/financas/pesquisartitulos/`

**PesquisarLancamentos** — busca mais rica de títulos (CP+CR), com `lancamentos` (baixas) e `resumo` (liquidado/aberto) aninhados por título. **PesquisarExcluidos**(deprecated), **ObterURLBoleto**(deprecated).

### Movimentos Financeiros — `https://app.omie.com.br/api/v1/financas/mf/`

**ListarMovimentos** — visão unificada CP/CR/baixa/conta-corrente (`cTpLancamento`: CP/CR/CPCR/BX/BXCP/BXCR/CC/CCE/CCS/CCT/PV/POS/PPV), com rateio por categoria e departamento.

### Resumo (Finanças) — `https://app.omie.com.br/api/v1/financas/resumo/`

**ObterDetalhesLancamento, ObterListaEmAberto, ObterListaFinancas, ObterResumoFinancas** — usado pelo dashboard financeiro da Omie: saldo em conta, contas a pagar/receber (total + atraso), fluxo de caixa projetado. **Este é o mesmo endpoint que `lib/omie/financeiro-resumo.ts` já usa neste projeto** (card financeiro "hoje" da home).

### Cadastros auxiliares de Finanças

- **Bancos** — `geral/bancos/` — Consultar/ListarBancos (inclui flags de quais integrações o banco suporta: obank_pix, cnab_pag, etc.)
- **Tipos de Documento** — `geral/tiposdoc/` — Consultar/PesquisarTipoDocumento
- **Tipos de Contas Correntes** — `geral/tipocc/` — ListarTiposCC
- **Contas do DRE** — `geral/dre/` — ListarCadastroDRE (hierarquia com nível e sinal)
- **Finalidade de Transferência** — `geral/finaltransf/` — Consultar/ListarFinalTransf
- **Origem do títulos** — `geral/origemlancamento/` — ListarOrigem
- **Bandeiras de Cartão** — `geral/bandeiracartao/` — ListarBandeiras

---

## NF-e e Recebimento de Compras

Levantado ANTES da rodada de agentes, direto nesta sessão (testado ao vivo
com notas fiscais reais, não só documentação) — motivo: a pergunta original
do usuário era especificamente sobre manifestação do destinatário.

### Recebimento de Nota Fiscal — `https://app.omie.com.br/api/v1/produtos/recebimentonfe/`

O principal — cobre o fluxo de recebimento de mercadoria (Kanban Pendente→Recebido). 8 métodos: **ConsultarRecebimento** (testado ao vivo com 2 notas reais — resposta completa: cabec, itensRecebimento com todos os impostos por item, infoAdicionais, transporte, totais, parcelas, infoCadastro [cRecebido/cFaturado/cCancelada/cDevolvido/cBloqueado + datas/usuários], observacoes), **ListarRecebimentos**, **AlterarEtapaRecebimento**, **AlterarRecebimento**, **AlterarRecebimentoConcluido**, **ConcluirRecebimento**, **ExcluirRecebimento**, **ReverterRecebimento**. Nenhum campo de manifestação em nenhum método.

### Nota de Entrada — `https://app.omie.com.br/api/v1/produtos/notaentrada/`

Nota de entrada MANUAL (criada dentro do Omie, distinta de receber um NF-e de fornecedor via XML). 6 métodos: Incluir/Alterar/Excluir/Consultar/ListarNotaEnt + **StatusNotaEnt** (retorna `ListaNfe`: cStatusNFe, cChaveNFe, nProtocolo, mensagens — status de AUTORIZAÇÃO da NF-e junto à SEFAZ, não de manifestação).

### Nota de Entrada - Faturamento — `https://app.omie.com.br/api/v1/produtos/notaentradafat/`

4 métodos de workflow: CancelarNotaEnt, ConcluirNotaEnt, ConferirNotaEnt, DuplicarNotaEnt.

### Resumo de Compras — `https://app.omie.com.br/api/v1/produtos/compras-resumo/`

**ObterResumoCompras** — dashboard: painelNfeCompra (faturadas/canceladas/pendentes/**rejeitadas**), painelCteCompra, requisicaoCompra, pedidoCompra, faturamentoResumo, ordemProducao. "Rejeitada" aqui é sobre NF-e rejeitada pela SEFAZ (erro de schema/validação na emissão do fornecedor), não manifestação.

### Obter Documentos (DFe) — `https://app.omie.com.br/api/v1/produtos/dfedocs/`

5 métodos, todos de RECUPERAÇÃO DE ARQUIVO (não status): ObterCTe, ObterCupom, ObterDanfeSimp, ObterNfe, ObterPedVenda — cada um retorna link de XML/PDF + status_code/description simples (0=sucesso). Nada de manifestação.

### NF-e Consultas — `https://app.omie.com.br/api/v1/produtos/nfconsultar/`

**ConsultarNF/ListarNF** — sobre NF-e EMITIDAS pela própria empresa (tpNF 0=entrada/1=saída, ambiente H/P), não sobre manifestar recebimento de terceiros.

### NF-e Utilitários — `https://app.omie.com.br/api/v1/produtos/notafiscalutil/`

3 métodos, só URLs: GetUrlDanfe, GetUrlLogo, GetUrlNotaFiscal.

### NF-e Importar — `https://app.omie.com.br/api/v1/produtos/nfe/`

4 métodos de IMPORTAÇÃO de XML pra dentro do Omie (o inverso de consultar): ImportarNFe, ImportarCancNFe, ExcluirNFe, ListarNFe.

### Painel do Contador - Documentos Fiscais — `https://app.omie.com.br/api/v1/contador/xml/`

**ListarDocumentos** — retorna XML de qualquer documento fiscal (cupom/NF/CT-e/OS/pedido/recebimento) com `cStatus`: 00=Autorizado, 10=Cancelado, 20=Denegado, 30=Devolvido, 40=Pendente. De novo, status de AUTORIZAÇÃO junto à SEFAZ, campo diferente de manifestação.

---

## Compras, Estoque e Produção (+ Impostos)

### Produtos — `https://app.omie.com.br/api/v1/geral/produtos/`

**IncluirProduto** — Entrada obrigatória: codigo_produto_integracao, descricao, unidade, ncm, valor_unitario. Opcionais: codigo (SKU), ean, peso_liq/bruto, altura/largura/profundidade, marca, modelo, dias_garantia/crossdocking, descr_detalhada, obs_internas, campos especializados (medicamento/ANVISA, combustivel/ANP, veiculo/RENAVAM, armamento), e dados fiscais completos (cst_icms, csosn_icms, aliquota_icms, cst_pis/cofins, cfop, origem_imposto). Saída: produto_servico_status (codigo_produto gerado, status)

**AlterarProduto/UpsertProduto/ExcluirProduto/ConsultarProduto/AssociarCodIntProduto** — mesma chave/estrutura

**ListarProdutos/ListarProdutosResumido** — Entrada: paginação + filtros ricos (data, família, tipo, descrição, marketplace, PDV, NCM, EAN, inativo) + flags de exibição (características, tabelas de preço, obs, kit, variações). Saída: produto_servico_cadastro completo (array)

**IncluirProdutosPorLote/UpsertProdutosPorLote** [DEPRECATED]

### Produtos - Características — `https://app.omie.com.br/api/v1/geral/prodcaract/`

Padrão Incluir/Alterar/Consultar/Excluir/ListarCaractProduto — campo (cNomeCaract) + conteudo, com flags cExibirItemNF/cExibirItemPedido/cExibirOrdemProd.

### Produtos - Estrutura — `https://app.omie.com.br/api/v1/geral/malha/`

**Incluir/Alterar/Excluir/Consultar/ListarEstrutura(s)** — malha de componentes (BOM) de um produto: itemMalha (idProdMalha, quantProdMalha, percPerdaProdMalha, obsProdMalha, codigo_local_estoque), custoProducao (vMOD mão de obra direta, vGGF gastos gerais de fabricação).

### Produtos - Kit — `https://app.omie.com.br/api/v1/geral/produtoskit/`

**AlterarComponentesKit** — único método: acao_componente (I/A/E incluir/alterar/excluir) por componente, aplicado a um produto tipo "KT - Kit".

### Produtos - Variação — `https://app.omie.com.br/api/v1/produtos/variacao/`

**Consultar/Incluir/ListarVariacoes** — até 2 características por produto (ex.: cor+tamanho), cada variação vira um produto associado (nCodProdAssoc).

### Produtos - Lote — `https://api.omie.com.br/api/v1/produtos/produtoslote/`

**Consultar/ListarLotes** — por produto+local de estoque: nCodAgregado, dDataFabricacao/Validade, quantidade disponível/entrada/saída/reservada.

### Requisições de Compra — `https://app.omie.com.br/api/v1/produtos/requisicaocompra/`

**Alterar/Consultar/Excluir/Incluir/Pesquisar/UpsertReq** — pedido interno de compra (antes de virar Pedido de Compra formal): codCateg, codProj, dtSugestao, ItensReqCompra (codProd, qtde, precoUnit, obsItem).

### Pedidos de Compra — `https://app.omie.com.br/api/v1/produtos/pedidocompra/`

**AlteraPedCompra/ConsultarPedCompra/ExcluirPedCompra/IncluirPedCompra/PesquisarPedCompra/UpsertPedCompra** — cabeçalho (fornecedor, previsão, condição pagamento, aprovador), produtos (com markup, categoria, local de estoque, valores de ICMS/ST/IPI/PIS/COFINS previstos), frete, departamentos (rateio), parcelas. **PesquisarPedCompra** tem filtros específicos de pipeline: lExibirPedidosPendentes/Faturados/Recebidos/Cancelados/Encerrados/RecParciais/FatParciais.

### Ordens de Produção — `https://app.omie.com.br/api/v1/produtos/op/`

**Alterar/Concluir/Consultar/Excluir/Incluir/Listar/Reverter/UpsertOrdemProducao** — já usado neste projeto (`lib/omie/ordem-producao.ts`). ConcluirOrdemProducao (dDtConclusao, nQtdeProduzida, cObsConclusao), ReverterOrdemProducao (desfaz conclusão). ListarOrdemProducao aceita cConcluida (filtro) e lExibirItens.

### Cadastros auxiliares de Compras/Estoque

- **Familias de Produto** — `geral/familias/` — Alterar/Consultar/Excluir/Incluir/Pesquisar/UpsertFamilia (codFamilia, nomeFamilia, inativo)
- **Unidades** — `geral/unidade/` — ListarUnidades (codigo string6, descricao)
- **Compradores** — `estoque/comprador/` — ListarCompradores
- **Produto x Fornecedor** — `estoque/produtofornecedor/` — ListarProdutoFornecedor (código do produto NO FORNECEDOR, útil pra cross-referência com XML de NF-e)
- **Formas de Pagamento (compras)** — `produtos/formaspagcompras/` — ListarFormasPagCompras (cListaParc dias de vencimento, nDiasParc offset)
- **NCM** — `produtos/ncm/` — Consultar/ListarNCM
- **Cenário de Impostos** — `geral/cenarios/` — ListarCenarios + **ListarImpostosCenario** (MUITO rico: ICMS/IPI/PIS/COFINS completos + campos de Reforma Tributária IBS/CBS — cst_ibs_cbs, aliquota_ibs_uf/mu, aliquota_cbs, class_trib)

### Impostos (tabelas de referência, todas padrão `Listar*` com paginação simples)

- **CFOP** — `produtos/cfop/` — ListarCFOP (nCodigo, cDescricao, cTipo E/S)
- **ICMS - CST** — `produtos/icmscst/` — ListarCST
- **ICMS - CSOSN** — `produtos/icmscsosn/` — ListarCSOSN
- **ICMS - Origem da Mercadoria** — `produtos/icmsorigem/` — ListarOrigMerc
- **PIS - CST** — `produtos/piscst/` — ListarCstPis
- **COFINS - CST** — `produtos/cofinscst/` — ListarCstCofins
- **IPI - CST** — `produtos/ipicst/` — ListarCstIpi
- **IPI - Enquadramento** — `produtos/ipienq/` — ListarEnqIpi
- **Tipo de Cálculo** — `produtos/tpcalc/` — ListarTpCalc
- **CEST** — `produtos/cest/` — ListarCEST

---

## Estoque

### Ajustes de Estoque — `https://app.omie.com.br/api/v1/estoque/ajuste/`

**IncluirAjusteEstoque** — já usado neste projeto (`lib/omie/sync-ajustes.ts`). Campos: codigo_local_estoque, id_prod/cod_int, data, tipo (ENT/SAI/SLD/TRF), quan, valor, obs, origem (AJU manual/PDV), motivo (INV/OPE/PDV/INI/PER/OPS/CMC/TPQ/TRF), codigo_local_estoque_destino (obrig. se TRF), lote_validade

**ExcluirAjusteEstoque / ListarAjusteEstoque** — ListarAjusteEstoque filtra por tipo/origem/motivo/período, retorna id_ajuste + id_movest separados (achado relevante: confirma que cada ajuste pode ter mais de um movimento de estoque associado)

**AlterarEstoqueMinimo** — id_prod + quan_min

### Consulta Estoque — `https://app.omie.com.br/api/v1/estoque/consulta/`

**ListarMovimentoEstoque** — histórico completo por produto/período: origem, documento, pedido, operação, flags cancelamento/devolução, IDs cruzados (ajuste/NF/pedido/cupom/CT-e/recibo), CMC, quantidade, valor, saldo

**ListarPosEstoque** — posição consolidada: saldo, CMC, saldo pendente em pedidos abertos, estoque mínimo, quantidade reservada vs. física — por local de estoque

**ListarSaldoPendente** — só quantidades pendentes de entrada/saída, por produto+local

**MovimentoEstoque** — breakdown por período: saldo anterior, entradas, saídas, saldo atual

**PosicaoEstoque** — snapshot pontual numa data: saldo, cmc, pendente, estoque_minimo, reservado, fisico (mesma distinção física vs. reservado)

### Movimento Estoque — `https://app.omie.com.br/api/v1/estoque/movestoque/`

**ConsultarPrevisao** — quantidade prevista em estoque (nQtdePrevista) por produto/local/período

**ListarMovimentos** — agregado diário de entradas/saídas por produto (nQtdeEntradas/nQtdeSaidas por dDataMovimento)

### Locais de Estoque — `https://app.omie.com.br/api/v1/estoque/local/`

**Incluir/AlterarLocalEstoque** — tipo (1=empresa, 2=empresa em poder de terceiros, 3=terceiros em poder da empresa), flags de disponibilidade: dispOrdemProducao, dispConsumoOP, dispRemessa, dispVenda, consiSugeCompra

**ListarLocaisEstoque** — inclui campo `padrao` (S/N) identificando o local default

### Resumo do Estoque — `https://app.omie.com.br/api/v1/estoque/resumo/`

**ObterEstoqueProduto** — busca por EAN, ID, código OU busca textual livre (xCodigo, retorna múltiplos em listaProduto). Retorna, por local: físico, reservado, previsão saída/entrada, disponível, CMC, preço unitário, preço última compra + data, estoque mínimo, ícone/cor (pra dashboard) + listaImagens (URLs)

---

## Vendas e NF-e — Pedidos de Venda

> Já documentados antes: Obter Documentos/dfedocs, NF-e Consultas/nfconsultar, NF-e Utilitários/notafiscalutil, NF-e Importar/nfe.

### Pedidos de Venda - Resumido — `https://app.omie.com.br/api/v1/produtos/pedidovenda/`

**AdicionarPedido** — cabeçalho simplificado (cliente, data_previsao, etapa 10/20/30/40/50, parcela, categoria, conta corrente, consumidor_final, emails de notificação) + **IncluirItemPedido/AlterarItemPedido/ExcluirItemPedido(ns)/TotalizarPedido**.

### Pedidos de Venda — `https://app.omie.com.br/api/v1/produtos/pedido/`

Versão completa (objeto `pedido_venda_produto`, muito extenso: cabecalho, det/itens, frete, informacoes_adicionais, lista_parcelas, observacoes, market_place, total_pedido, infoCadastro, lancamentos, agropecuario, departamentos, exportacao). Métodos: Incluir/Alterar/Excluir/ConsultarPedido, **DevolverPedido** (devolução parcial ou total), **SimularImpostos** (calcula impostos sem gravar), **StatusPedido**, **TrocarEtapaPedido**, **AlterarPedFaturado** (código de rastreio, previsão de entrega pós-faturamento), **ListarPedidos**.

### Pedidos de Venda - Faturamento — `https://app.omie.com.br/api/v1/produtos/pedidovendafat/`

**FaturarPedidoVenda / CancelarPedidoVenda / DuplicarPedidoVenda / ValidarPedidoVenda / AssociarCodIntPedidoVenda / ObterPedidosVenda** (lista IDs+números por etapa cEtapa).

### Pedidos de Venda - Etapas — `https://app.omie.com.br/api/v1/produtos/pedidoetapas/`

**ListarEtapasPedido** — histórico de mudança de etapa por pedido, com sub-objetos ricos: `faturamento` (cFaturado, cAutorizado, cDenegado, cDANFE, cAmbiente H/P, cChaveNFE, cNumNFE/cSerieNFE), `cancelamento` (cCancelado + data/hora/usuário), `devolucao` (cDevolvido + data/hora/usuário). **Achado relevante:** este é o endpoint mais próximo de rastrear o CICLO DE VIDA completo de uma NF-e de venda emitida (autorizada/denegada/cancelada) — mas é sobre NOSSAS NF-e emitidas (saída), não sobre manifestação de NF-e recebidas de fornecedor.

### CT-e / CT-e OS — `https://app.omie.com.br/api/v1/produtos/cte/`

Import/gestão de Conhecimento de Transporte eletrônico: ImportarCTe, AverbacaoCTe, CancelarCTe, CartaCorrecaoCTe, FaturarCTe/FaturarLoteCTe, ListarNFeTransp, StatusFatura. Não relacionado a manifestação de NF-e de compra.

### Remessa de Produtos (+ Faturamento) — `https://app.omie.com.br/api/v1/produtos/remessa/` e `remessafat/`

Remessas (consignação, demonstração, industrialização) com devolução parcial/total (`DevolverRemessa`). Faturamento: Cancelar/Concluir/Conferir/DuplicarRemessa.

### Resumo (vendas) — `https://app.omie.com.br/api/v1/produtos/vendas-resumo/`

**ObterResumoProdutos** — dashboard: painelNfeVenda, painelCteVenda, painelCfeSat, painelNfce, painelCupom, propostaVenda, pedidoVenda, faturamentoResumo — todos agregados por período.

---

## Cupom Fiscal

### Adicionar Cupom Fiscal — `https://app.omie.com.br/api/v1/produtos/cupomfiscalincluir/`

**FecharCaixa** — fecha caixa (seqCaixa) com dados de abertura/fechamento (valores+datas+horas)

**IncluirCfeSat** — registra CFe-SAT: sat (satSerie, satModelo, satSessao, satProt, satXml, satMd5), satCanc (cancelamento), caixa, cfeSat (nCFe, chCFe 44 chars, tpAmb, det itens, total), formasPag (TEF/POS/PIX)

**IncluirCupom** — cupom via impressora fiscal ECF: ecf (série/modelo), cupom (nCOO, nCCF, det itens com prod+prodIdent+imposto ICMS), formasPag

**IncluirNfce** — registra NFC-e: nfce (protocolo/XML/MD5), NFe (nNF, serie, chNFe, tpEmis 1/9), formasPag, servicos

**IncluirRps** — registra RPS de serviço: servicos (nCodServ, valores, cMunFG), rps (numero, serie, totalRps)

**InutilizarNfce** — inutiliza lote de numeração de NFC-e

*Tipos reutilizados: TEF (NSU, TID, cBandeiraTef), POS (NSU, cRedePos), PIX (nIdPix), Cheque, ICMS (CST, vBC, pICMS, vICMS)*

### Cancelar/Excluir Cupom Fiscal — `https://app.omie.com.br/api/v1/produtos/cupomfiscal/`

**CancelarCupom / CancelarNFCE / CancelarSAT** — cancelamento específico por tipo de documento, com protocolo/XML/data de cancelamento

**DevolverCupom** — devolução total ou por item (nIdMotivDevol, itens array)

**ExcluirCupom / ExcluirCuponsPorNumero / ExcluirLote** — exclusão em diferentes granularidades

**ListarCupons** — filtros ricos: cAcao (ADD/TMP/CAN/CTG/INU/EXC), cModelo (00=ECF/59=SAT/65=NFC-e), cProcessado/cCaixaFechado/cCancelado/cErro

**ObterProximoLote** — próximo número de lote disponível

### Consultar Cupom Fiscal — `https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/`

**CuponsFiscais** — cabeçalho + itens + pagamentos completos por cupom (mesmo padrão rico de nota fiscal: alíquotas ICMS/PIS/COFINS por item)

**CuponsItens** — nível item, incluindo idMovEstoque/idAjusteEstoque/idLocalEstoque (rastreabilidade até o movimento de estoque gerado)

**CuponsPagamentos** — nível pagamento: cTpIntegra (TEF/POS), cIndPag (à vista/parcelado), cMeioPag (01-17, inclui 17=PIX), NSU/TID, dados bancários completos

### Importar NFC-e / Importar CFe-Sat — `.../nfce/` e `.../sat/`

**ImportarNFCe / ImportarCfeSat** — mesmo padrão de import por XML+MD5 (igual ImportarNFe), com cAcaoCliente (CONSUMIDOR/ERRO/INCLUIR) pra tratar o destinatário

---

## Cadastros Auxiliares (Vendas e NF-e)

- **Vendedores** — `geral/vendedores/` — CRUD completo (fatura_pedido, visualiza_pedido, comissao)
- **Formas de Pagamento (vendas)** — `produtos/formaspagvendas/` — ListarFormasPagVendas
- **Tabela de Preços** — `produtos/tabelaprecos/` — CRUD completo + Ativar/SuspenderTabelaPreco, AlterarPrecoItem (item a item), AtualizarProdutos (reajuste em massa por %)
- **Características de produtos** — `geral/caracteristicas/` — CRUD (conteudosPermitidos array — define valores válidos pra uma característica, base das Variações)
- **Etapas de Faturamento** — `produtos/etapafat/` — ListarEtapasFaturamento (por tipo de operação, cCodOperacao)
- **Meios de Pagamento** — `geral/meiospagamento/` — ListarMeiosPagamento
- **Origem do Pedido** — `geral/origempedido/` — ListarOrigem
- **Motivos de Devolução** — `geral/motivodevolucao/` — ListarMotivosDevol

---

## Serviços e NFS-e

### Serviços — `https://app.omie.com.br/api/v1/servicos/servico/`

CRUD completo (Incluir/Alterar/Excluir/Consultar/Upsert/AssociarCodInt) de serviços cadastrados: cabecalho (código, LC116, NBS, categoria), impostos completos (ISS/PIS/COFINS/CSLL/IR/INSS + campos IBS/CBS da Reforma Tributária), viaUnica (modelo NF 21/22).

### Ordens de Serviço — `https://app.omie.com.br/api/v1/servicos/os/`

Estrutura muito rica, equivalente ao Pedido de Venda mas pra serviços: Cabecalho, InformacoesAdicionais, Departamentos, ServicosPrestados (com impostos completos), Parcelas, despesasReembolsaveis, produtosUtilizados, Tarefas (somente leitura). **StatusOS** retorna `ListaRpsNfse` com protocolo/status por RPS/NFS-e gerada — o equivalente, pro lado de serviços, do que "Etapas de Faturamento de Pedidos" é pra produtos.

### Ordens de Serviço - Faturamento / Fat. em Lote

Mesmo padrão de Pedidos de Venda: Validar/Faturar/Cancelar/Reenviar/Duplicar/AssociarCodInt + faturamento em lote com acompanhamento assíncrono (StatusLoteOS: RUNNING/DONE/ERROR).

### Contratos de Serviço (+ Faturamento + Fat. em Lote)

Contratos recorrentes: cabecalho (vigência, dia de fechamento, tipo de faturamento), itensContrato, vencTextos (regra de vencimento). Ciclo de vida: Ativar/Suspender/Reativar/Cancelar/FaturarContrato (gera uma OS a cada faturamento).

### Resumo (serviços) — `servicos/resumo/`

Dashboard: OS/Contrato/Proposta com emAberto, faturarHoje, faturadas, canceladas, **rejeitadas** (mesmo campo "rejeitada" visto no resumo de compras — parece ser padrão da Omie pra "documento fiscal rejeitado pela prefeitura/SEFAZ na emissão", não relacionado a manifestação de destinatário).

### Obter Documentos (serviços) — `servicos/osdocs/`

ObterOS/ObterRecibo/ObterRPS/ObterNFSe/ObterDemonst/ObterViaUnica — mesma família de "Obter Documentos" que dfedocs (produtos), retorna links de PDF/XML.

---

## NFS-e

### NFS-e Consultas — `https://app.omie.com.br/api/v1/servicos/nfse/`

**ListarNFSEs** — o mais completo de todo o levantamento em termos de detalhamento fiscal de UM documento: Cabecalho, OrdemServico, RPS, Servicos (com todas as alíquotas/retenções), Valores, **IBPT** (índice de transparência tributária: alíquota federal/estadual/municipal aproximada, por chave de versão), Inclusao/Alteracao/Emissao/Cancelamento (data/hora/usuário/motivo cada um). Isso é NFS-e (serviço), não tem relação com manifestação de NF-e de compra de mercadoria.

---

## Cadastros Auxiliares (Serviços e NFS-e)

Todos padrão `Listar*` simples: Serviços no Município (`listaservico`), Tipos de Tributação (`tipotrib`), LC 116 (`lc116`), NBS (`nbs`), IBPT (`ibpt` — produtos E serviços), Tipo de Faturamento de Contrato (`contratotpfat`), Tipo de utilização (`tipoutilizacao`), Classificação do Serviço (`classificacaoservico`).

---

## Painel do Contador

### Painel do Contador - Resumo — `https://app.omie.com.br/api/v1/contador/resumo/`

**ObterResumoContador** — status de fechamento contábil (semanal/mensal/quinzenal) por período, se foi enviado por email, se está bloqueado.

(Ver seção "NF-e e Recebimento de Compras" no início do documento pra "Documentos Fiscais" / `contador/xml`, já documentado antes desta rodada.)

---

## Achado sobre manifestação do destinatário

Pergunta original que motivou este levantamento inteiro: dá pra puxar da
API da Omie a manifestação do destinatário (Ciência da Operação /
Confirmação da Operação / Operação Não Realizada / Desconhecimento —
evento oficial junto à SEFAZ)?

**Resposta, depois de checar TODOS os ~80 serviços da API (não só os de
NF-e): não.**

O que existe de fato:
- `full_object.infoCadastro.cRecebido` (S/N) — flag PRÓPRIA do Omie pro
  fluxo interno de recebimento de mercadoria (Kanban Pendente/Recebido),
  não é a manifestação oficial. Confirmado no dado real: `c_etapa='40'`
  sempre tem `cRecebido='N'` (231 notas), `c_etapa='60'` quase sempre tem
  `cRecebido='S'` (10.487 de 10.491) — os dois são quase a mesma coisa mas
  não exatamente, e nenhum dos dois é "manifestação".
- `cStatus`/`cStatusNFe` (em vários serviços: `notaentrada`, `contador/xml`)
  — status de AUTORIZAÇÃO da NF-e junto à SEFAZ (Autorizada/Cancelada/
  Denegada/Devolvida/Pendente) — evento diferente, acontece na EMISSÃO,
  não na manifestação do recebimento.
- "Rejeitada" (em `compras-resumo` e `servicos/resumo`) — NF-e/NFS-e
  rejeitada por erro de validação/schema, também não é manifestação.

O que a documentação de ajuda da Omie confirma (`ajuda.omie.com.br`,
artigo "Manifestação de Destinatário da NF-e"): a funcionalidade existe
na INTERFACE web (3 ações manuais: Confirmada/Não Realizada/Desconhecida,
acessível no Kanban de Compras), mas "não emite documento oficial... é
consultada diretamente no site da SEFAZ" — ou seja, o próprio Omie parece
não guardar isso como um campo persistente e exposto pela API; ele manda
o pedido pra SEFAZ na hora e mostra o resultado ao vivo na tela.

**Conclusão prática:** se o objetivo é ver se uma nota já foi manifestada,
o campo mais próximo disponível hoje é `cRecebido` (via
`ConsultarRecebimento`/`ListarRecebimentos`, endpoint `recebimentonfe`),
mas ele reflete o fluxo INTERNO do Omie, não a manifestação fiscal formal
junto à Receita. Pra manifestação de verdade, a única forma seria integrar
direto com o webservice da SEFAZ (fora do escopo da API da Omie), ou
confirmar com o suporte da Omie se existe algum endpoint não documentado
publicamente.
