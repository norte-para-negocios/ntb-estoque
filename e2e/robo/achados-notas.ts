// Achados e ressalvas que estão só nas notas dos tickets (notas-ticketNN-erp.md, na pasta central, fora deste repositório)
// e não em um falhas.md. Escritos à mão a partir das notas, em texto simples. Quando um robô passar a registrar
// o achado no próprio falhas.md, apague a linha daqui para não duplicar.
import type { FalhaRastreada, Ressalva } from './consolidador.ts'

const SEM_PRINT = (t: string) => `sem print (achado nas notas do ticket ${t})`

const extra = (ticket: string, causa: string, gravidade: 1 | 2 | 3, o: Partial<FalhaRastreada>): FalhaRastreada => ({
  gravidade, loja: 'Sertão', cargo: 'dono', tela: '', passo: '', esperado: '', mostrado: '',
  print: SEM_PRINT(ticket), robo: `notas-${ticket}`, ticket, rodada: `notas-ticket${ticket}-erp.md`, pastaSaida: '', causa, ...o,
})

// Etapa de verificação: os achados de F-09, F-10, F-11, F-12, F-15, F-16, F-17 e F-18 saíram daqui porque foram corrigidos e agora os próprios
// robôs (venda, inventário, compras, cozinha, passeio) conferem o comportamento novo. Ficou só F-19 (decisão do dono, nada a corrigir em código).
export const ACHADOS_DAS_NOTAS: FalhaRastreada[] = [
  extra('10', 'permissoes-sem-cargo', 3, {
    loja: 'todas', cargo: 'gerente, estoquista', tela: 'cargo_permissao', passo: 'listar permissões sem nenhum cargo',
    esperado: 'decisão do dono sobre as 4 do Financeiro criadas depois da auditoria', mostrado: '34 de 90 permissões só com Admin (30 de propósito, 4 do Financeiro)',
  }),
]

export const RESSALVAS: Ressalva[] = [
  {
    ticket: '02', titulo: 'passeio por todas as telas', status: 'resolvido',
    naoProvado: [
      '"Conta errada" só é detectada como texto NaN/undefined/Infinity; números contra o Omie ou Excel ficam com os outros robôs.',
      'Texto cortado: só estouro horizontal em 1366x768; corte vertical e telas de celular não são avaliados.',
      'Nenhum botão de gravação foi acionado; telas que dependem de histórico do frio ficaram vazias nesta etapa (o frio foi restaurado depois, no ticket 08).',
    ],
    ressalvas: [
      'Rotas bloqueadas respondem HTTP 200 mostrando a página 404; só o texto da página (ou a marca noindex) denuncia. Monitoramento que olhe só o código não vê o bloqueio.',
      '12 rotas redirecionam para /modulos/pacioli ou /modulos/cozinha quando a loja não tem o módulo (por desenho).',
    ],
  },
  {
    ticket: '03', titulo: 'gabarito do saldo de estoque', status: 'resolvido com ressalva (decisão do Joaquim: seguir e registrar aqui)',
    naoProvado: [
      '99 itens do Sertão têm saldo no Omie mas nenhuma linha no kardex espelhado (sem movimento em 2026): sem saldo inicial não há gabarito. Ficam como "não comparáveis" no itens.csv.',
      'O gabarito do Sertão usa o saldo_apos da 1ª linha do kardex como abertura; erro nessa linha aparece como diferença "Omie".',
      'Compara o saldo total por item, não por local.',
      'O kardex termina em 16/11 e a foto do Omie é de 17/11: movimento entre os dois horários não entra.',
      'A tela "Posição de estoque" (/relatorio-posicao-estoque) não foi usada (corta em 500 linhas e esconde zerados).',
    ],
    ressalvas: [
      'ODARA e Loja 19: soma dos movimentos = tela, item a item (e = estoque_saldos nas 540 linhas). 0 divergência.',
      'Sertão: das 545 divergências, 6 são do ERP (inativos escondidos) e 539 vêm do Omie (ver os itens de saldo desta lista).',
    ],
  },
  {
    ticket: '04', titulo: 'nota de entrada e custo médio', status: 'resolvido com ressalva',
    naoProvado: [
      'Título a pagar só foi conferido na loja 19: a chave fin_cp_da_nota_ativo está desligada na ODARA e no Sertão (o robô espera zero títulos, e é o que o ERP faz). Quando o dono ligar na ODARA, rodar de novo.',
      'A trava NTB_OMIE_BLOQUEADO=1 não foi exercitada pelo caminho do Sertão: na cópia as chaves do Omie estão zeradas e a rota recusa antes de chegar ao Omie.',
      'Conta só para uma nota por produto e notas do dia; sem imposto (ICMS/IPI/ST), sem frete por item, sem CT-e, sem mais de um local, sem "Desfazer entrada" e sem cancelamento.',
      'A tela do produto só mostra o custo em 2 ou mais casas: diferença menor que o último dígito mostrado só aparece na camada do banco.',
    ],
    ressalvas: [
      'Saldo, custo médio e conversão de unidade (KG→G, L→ML, inclusive saldo negativo): 0 divergência nas 4 notas.',
      'Modo Omie (Sertão): o ERP não deixa lançar nota pela tela (só "Atualizar agora"); /nota-fiscal/nova e /importar dão página 404. Por desenho.',
      'Na tela "Importar XML" o "Local deste item" sugerido pode ser diferente do local da nota; não é erro do ERP, só vale saber.',
      'Volta ao estado inicial provada (foto antes/depois igual).',
    ],
  },
  {
    ticket: '05', titulo: 'venda do Vendas, baixa e ordem de produção', status: 'resolvido com ressalva (critério 5 aberto só no Sertão)',
    naoProvado: [
      'Sertão: o Omie respondendo de verdade (conclusão da OP e consumo dos insumos no Omie). A cópia não tem fichas do Sertão e o Omie está bloqueado; a OP só é conferida como payload da fila.',
      'A falha "temporária" da ODARA é provocada por configuração local (local inexistente), não por queda real do ERP.',
      'Perda e fator de correção só estão cobertos pelos testes à mão (as fichas ativas copiadas não têm perda nem fator); rendimento 70 foi coberto ao vivo.',
      'Não cobre venda com nota/cupom, ficha com sub-receita (PI dentro de PI) nem a loja 19. A conta só vale para movimentos de hoje.',
    ],
    ressalvas: [
      'ODARA: 211 conferências, 0 falhas, reenvio sem duplicar, estorno devolve o estoque, reset provado.',
      'O robô grava uma chave Omie FALSA só na cópia (removida no fim e pelo reset) para o cron enxergar a loja; a trava barra antes de qualquer chamada.',
      'Custo médio muda 0,000001 depois do estorno (acarajé 80077: 0,190553 para 0,190554): a reconta arredonda diferente. Achado, não falha.',
      'Estorno de loja Omie sem chave Omie retorna "Loja sem Omie configurada" e não desfaz nem as saídas locais pendentes (só ocorre na cópia, onde as chaves foram zeradas).',
      'A ODARA grava uma foto nova em posicao_estoques (~10 mil linhas) assim que o estoque se mexe; o reset remove.',
    ],
  },
  {
    ticket: '06', titulo: 'inventário e ajuste', status: 'resolvido',
    naoProvado: [
      'Sertão (Omie): diferença, custo e valor do ajuste não têm como ser conferidos, pois dependem do Omie (bloqueado). Só se provou que o envio é barrado e nada local muda.',
      'Não cobre desfazer/editar contagem concluída, contagem cíclica por curva A/B/C, inventário com filtro de família/tipo, data retroativa nem produto com saldo negativo.',
      'O custo médio "antes" é lido do banco (foto de abertura); não foi reconstruído do histórico do ledger.',
      'Excel e PDF do inventário não foram conferidos.',
    ],
    ressalvas: ['Lojas 19 e ODARA: 227 conferências, 0 falhas, 3 resets provados.'],
  },
  {
    ticket: '07', titulo: 'compras: pedido ao recebimento', status: 'resolvido',
    naoProvado: [
      'Sem preço divergente entre pedido e nota, item fora do pedido, nota maior que o pedido, devolução ao fornecedor, reabrir/reprovar pela tela (só as regras puras), frete no pedido, importar planilha nem requisição.',
      'Sem loja Omie com as chaves de escrita ligadas (a cópia não liga). Nota antiga (data de emissão diferente de hoje) não coberta.',
    ],
    ressalvas: [
      'Não existe envio ao fornecedor neste ERP: "enviar" é só registro local (enviar para aprovação, aprovar). Varredura estática não achou e-mail, WhatsApp nem HTTP no caminho.',
      'A tela do pedido só oferece cancelar o pedido recebido se a página estiver velha; a recusa vem do banco (pc_acao). Está certo.',
      'Numa rodada a tela demorou mais de 20 s para mostrar "Aguardando aprovação" logo depois do reset (lentidão da primeira renderização); o robô recarrega e registra.',
      'Nota digitada na loja 19 não gera título: ver o item da nota digitada na lista.',
    ],
  },
  {
    ticket: '08', titulo: 'faturamento e CMV', status: 'resolvido (6 falhas registradas, 3 causas)',
    naoProvado: [
      'Sertão não tem ficha técnica na cópia: o CMV é a estimativa que a própria tela faz (quantidade vendida x custo médio de hoje). O gabarito confere essa conta; não prova que o custo de hoje é o custo certo da época nem compara com o Omie.',
      'O custo de entrada na série do ledger é lido do próprio ledger; a média móvel de todo o histórico não foi refeita do zero.',
      'Loja 19 não tem nenhuma venda: faturamento e CMV zerados batem, mas sem caso com dinheiro. ODARA tem só 2 meses (13/10 a 15/11).',
      'Cupom devolvido: não há nenhum na cópia, então a regra "devolvida" só está provada nos testes à mão.',
      'Fonte "kardex" (loja Omie com espelho completo) e as visões por Tipo, Família, Forma de pagamento e Produto do Faturamento não foram conferidas.',
      'Dias e meses só até a data do dump (17/11).',
    ],
    ressalvas: [
      'A tela CMV mostra no máximo 500 linhas de produto (os cartões somam todas); no Sertão nenhum mês passou disso.',
      'Rótulos com espaço duplo ("1/2   Calabresa G") vêm assim do cadastro; o robô normaliza.',
      'F-04 (corrigido na cópia): o cron sync-fechamentos-frio completou as baixas das vendas 399 e 412 da ODARA (lotes de 50 referências, janela de 30 dias); o buraco de R$ 58,91 fechou. Sobra +R$ 1,13 no CMV de nov/2026 (tela R$ 14.214,66 contra R$ 14.213,53): a baixa tardia é custeada pelo custo médio de hoje, não o da hora da venda (Moqueca de camarão +R$ 1,08).',
      'Para a ODARA a conta ficha x custo médio vigente reproduziu o CMV do ERP em out/2026 (R$ 7.395,92 contra R$ 7.395,91). Foi essencial usar a última revisão de cada movimento (estoque_mov_revisao).',
    ],
  },
  {
    ticket: '09', titulo: 'financeiro', status: 'resolvido com ressalva (decisão do Joaquim)',
    naoProvado: [
      'Os 3 critérios NÃO foram provados com dinheiro real: as tabelas fin_* da cópia estão vazias (0 contra 0 nas lojas 15 e 19).',
      'Sertão: as telas do financeiro dão 404 por desenho e o espelho do Omie é só um retrato de 27/06 dos títulos em aberto; conferido só por coerência interna, sem tela para comparar.',
      'Não está provada localmente a data em que a migration da chave do título foi aplicada: se foi antes do commit de 05/11 19:49, a loja 19 teria 4 títulos esperados e a tela mostra 0 (a rodada de sensibilidade ROBO_SEM_CORTE=1 detectou as 4 falhas, provando o caminho).',
    ],
    ressalvas: [
      'Contas correntes do Sertão com saldos grandes e negativos (Caixinha -R$ 91.794,02; Itaú -R$ 37.195,86) são dado do Omie de 27/06, não conta do ERP.',
      'Pendente: reexecutar `npm run robo:financeiro` depois do ticket 04 se a cópia passar a ter títulos (veja a seção final desta lista).',
    ],
  },
  {
    ticket: '10', titulo: 'permissões por cargo', status: 'resolvido (48 furos de gravidade 1, 2 causas)',
    naoProvado: [
      'Cargo Conferente (8 permissões) e perfil AdminLoja: não há login de teste.',
      'Server actions e POST (/api/sync/*, /api/estoque/kardex-omie, anexos, /api/offline/{acao,linhas,mudancas,sessao}): sem prova em execução. Dá para fazer prova estática depois.',
      'GET /api/offline/tabelas grava (offline_compactar) e não foi chamado. Rotas /api/cron, /api/integracao, /api/webhook e /api/correcoes/ingest autenticam por segredo e não foram chamadas.',
      '/api/relatorio-mensal do dono não foi chamado (é pesado); /api/anexos e nota-fiscal/* só provados por status com id inexistente.',
    ],
    ressalvas: [
      'A matriz é de intenção, lida do código (menu + guardas). Página nova sem linha em permissoes-matriz.ts aparece como "rota sem regra" no cobertura.md.',
      '41 divergências do outro tipo (bloqueado onde a matriz permite) NÃO são furo: quase todas do dono na loja 4 (telas de estoque próprio e financeiro, bloqueadas pelo modo da loja).',
      'A migration 310 (auditoria de novembro) já está aplicada no backup de 17/11.',
      'Sem furo no menu e sem botão de gravação visível sem permissão, nas 35 regras de botão conferidas (só em telas que abrem para o login).',
    ],
  },
  {
    ticket: '11', titulo: 'área /cozinha do ERP', status: 'resolvido (0 falhas do robô)',
    naoProvado: [
      'Cardápios: não há nenhum na cópia (nem na produção restaurada); só a tela vazia foi vista. CMV do cardápio e preço próprio por item não foram conferidos.',
      'Eventos: só 1 evento (loja 19, sem preço por pessoa); reservas, lista de produção/compras, folga e "finalizar/dar baixa" não foram conferidos.',
      'Criação de dados pela tela (insumo, prato, cardápio, evento) não foi feita: o robô só lê. A conversa livre do Pacioli (precisa de ANTHROPIC_API_KEY) não foi chamada.',
      'Só o login de dono foi usado (permissão da /cozinha por cargo ficou com o robô de permissões).',
      'Sertão (Omie): a cópia não tem ficha técnica; só se confere que as telas abrem e que aparece o aviso. O custo do prato no modo Omie não foi provado.',
    ],
    ressalvas: [
      'Loja 19: os 84 pratos têm custo R$ 0,00 na cópia (só 7 produtos com custo médio). Não é conta errada, é a loja laboratório sem custo; só a ODARA tem dado para testar custo de verdade.',
      'O console da cópia acusa "cozinha-fotos: falha ao assinar URLs" (a cópia não tem o serviço de arquivos). É ambiente, não falha do ERP.',
      'GET /cozinha/pratos/<codigo>/foto dá 405 (a rota só aceita POST). Esperado.',
      'O next dev às vezes aborta a navegação em fichas recém-compiladas; o robô repete uma vez. Sem falha nas últimas rodadas.',
      'As funções que faltam frente ao app Norte Cozinha separado (22 itens) estão em e2e/robo/cozinha-faltando.md.',
    ],
  },
  {
    ticket: 'geral', titulo: 'limites da prova (revisão do código da integração)', status: 'ressalvas registradas',
    naoProvado: [
      'Ticket 10 e passeio (02): o login "dono" é super admin (gerar-usuarios.mjs). "Dono com 0 furos" e o passeio como dono NÃO provam o que um dono comum enxerga ou pode fazer; falta um login de dono sem o papel de super admin.',
      'Tickets 08 e 11 (CMV e cozinha): o gabarito usa o custo médio calculado pelo próprio ERP (cmc_apos, estoque_custos). Confere a multiplicação (quantidade x custo) e as somas, não o custo em si.',
      'A trava do Omie barra também leitura. "Compara com o Omie" usa só o espelho local (kardex e tabelas copiadas), nunca o Omie ao vivo.',
      'A chave SSH do Contabo é de root, sem restrição de comando: "só lê o servidor" (ls + scp) é convenção do script local.sh, não uma garantia técnica.',
      'Ticket 04, critério 11 (nota na loja Omie): foi provado pela recusa 400 do próprio ERP, não pela trava do Omie.',
    ],
    ressalvas: [
      '`npm test` agora inclui e2e/**/*.test.ts (os testes à mão do robô rodam junto com os do ERP).',
      'A trava do robô (e2e/robo/trava.ts) confere o .env.local, variáveis exportadas no shell e, por sonda, o servidor que atende a 3107: a URL do Supabase não aparece no código do navegador (o ERP só a usa no servidor), então o robô manda ao /login uma sessão emitida pelo GoTrue local e exige que o servidor a aceite.',
    ],
  },
]
