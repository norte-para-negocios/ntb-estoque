# Pedidos novos — 15/06/2026 (durante reunião)

> Anotações de pedidos feitos pelo fundador. A gravação desta reunião será enviada
> para transcrição/análise completa. Não implementar antes de assistir a reunião.

## 1. Certificado digital por loja
- No **cadastro de uma loja/empresa**, poder **anexar o certificado digital** da loja (arquivo A1 `.pfx` + senha).
- Poder **editar/trocar** o certificado depois.
- Cada loja tem o seu certificado (já dito na reunião de 11/06: "cada loja tem certificado digital, trocado a cada 1 ou 3 anos").
- Provável objetivo: emitir/buscar notas direto no Sefaz quando a loja NÃO tem integração Omie ("trabalhar fora do Omie"), ou para a emissão no Norte Vendas.
- **Importante:** certificado é dado MUITO sensível (chave privada que assina NFe). Armazenar criptografado / com cuidado de segurança. NÃO commitar nunca.
- Lembrete técnico: o certificado **não vem da API do Omie** (confirmado — endpoint não existe). Tem que ser enviado pela loja (upload manual).

## 2. Puxar o máximo de informações de cada loja/empresa
- No cadastro da loja, **trazer o máximo de dados** que a API do Omie expõe da empresa.
- Fonte: `v1/geral/empresas` / `ListarEmpresas` / `ConsultarEmpresa` — campos disponíveis (confirmados):
  cnpj, razao_social, nome_fantasia, inscricao_estadual, inscricao_municipal,
  inscricao_suframa, regime_tributario, optante_simples_nacional, cnae, cnae_municipal,
  endereco completo (logradouro, numero, bairro, cidade, estado, cep), email, telefones,
  website, gera_nfse, csc_producao / csc_id_producao (token NFC-e), dados SPED/contador.
- Ou seja: ao cadastrar/editar a loja, puxar e exibir esses dados automaticamente do Omie.

## Status
- AGUARDANDO a gravação da reunião de 15/06 para transcrever e entender o escopo completo.
- Não iniciar implementação antes disso.
