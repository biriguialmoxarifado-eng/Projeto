# Fase 3 — Estoque e concorrência em recebimentos

No Sheets real, o primeiro ciclo de estoque encontrou HTTP 429. A repetição isolada com um novo SKU sintético completou sete movimentos e a releitura por outro runtime confirmou saldo 8, reservado 1 e disponível 7 no local A, e saldo zero em B. Tempo total de 14301 ms. O ensaio de estoque e a suíte npm test passaram.

O motor de estoque isolado controla quantidade inteira por SKU e local. Abrange entrada, saída, transferência entre locais do mesmo SKU, reserva, liberação, retirada de reserva, devolução e estorno. A transferência registra os dois lados em um evento. Saldo e reserva usam versões por SKU, autoria, confirmação por releitura e idempotência. A aba de teste é ESTOQUE_CORE_TESTE da planilha ALMOXA_TESTE_CORE. O saldo do novo motor incorpora recebimentos confirmados que informam o local, preservando a projeção histórica sem local. Cadastro real, unidades fracionárias, transferência entre SKUs e reserva por pedido ainda precisam de paridade.

O primeiro ensaio real de edição simultânea com recebimento persistiu ambas as mutações, contrariando a simulação de unicidade dos marcadores do Sheets. Os eventos sintéticos foram preservados. Os motores agora compartilham um lock por planilha no mesmo perfil local e conservam os marcadores para identificar operações. Uma edição ou restauração é recusada depois que existe vínculo de recebimento. Na repetição real, a NF:388041441-95 foi recebida na versão 1 e a edição foi rejeitada com NF_RECEBIDA. Disputa de 3490 ms, duas unidades na projeção isolada. O lock coordena processos locais sob o mesmo perfil. A ativação exige um único executor de escrita ou coordenação distribuída validada. Uma queda abrupta pode deixar o lock em disco. Antes de liberar manualmente, confirmar que o processo encerrou e reconciliar a escrita pelo histórico de operações.

O adaptador interno de NF cobre listar, obter e itens nos envelopes usados pelo Desktop e ALMOX CAMPO. O teste automatizado exercita o contrato e rejeita sessão inválida. A implantação HTTP, o WebView real, as operações de escrita dos clientes e o restante dos filtros do legado continuam pendentes.

Os 34 motores usam o inventário de referência em FASE_2_CORE_INDEPENDENTE.md. Os estágios abaixo se aplicam à V2 isolada.

| Motor | Estágio |
| --- | --- |
| nf | Integrado em teste. Busca e ordenação do legado e campos públicos de itens cobertos. Escrita operacional e recuperação de órfãs pendentes. |
| estoque | Integrado em teste com recebimento por local. Paridade operacional pendente. |
| compras | Pré-compra, reforço, filtros e alteração de status integrados em teste. Emissão de pedido e conversão de pré-compra pendentes. |
| solicitacoes | Criação e listagem com reserva pendente integradas em teste. Aprovação e retirada operacionais pendentes. |
| reservas | Criação pendente pela solicitação integrada em teste. Decisão, alçadas e retirada operacional pendentes. |
| saidas | Testado no estoque isolado. Fluxo operacional legado pendente. |
| auth | Parcial. Sessão Node testada, login operacional pendente. |
| permissoes | Parcial. Escopos de teste aprovados, alçadas operacionais pendentes. |
| auditoria | Parcial. Autoria de eventos testada, trilha operacional pendente. |
| usuarios | Parcial, integrado em teste. Listagem, contagem e consulta com projeção pública; cadastro, permissões por obra e credenciais pendentes. |
| itens | Integrado em teste. Cadastro explícito por SKU e consultas. Geração automática, imagem, exclusão e paridade operacional pendentes. |
| fornecedores | Integrado em teste. Cadastro por CNPJ e consultas. Contrato operacional de escrita e paridade pendentes. |
| config | Parcial, integrado em teste. Chaves comuns leem e gravam; configuração especial SKU e precedência operacional pendentes. |
| lojinha | Pendente. Executor legado preservado. |
| epi | Pendente. Executor legado preservado. |
| ferramentas | Pendente. Executor legado preservado. |
| ocorrencias | Pendente. Executor legado preservado. |
| projetos | Pendente. Executor legado preservado. |
| inventario | Pendente. Executor legado preservado. |
| relatorios | Pendente. Executor legado preservado. |
| painel | Pendente. Executor legado preservado. |
| mural | Pendente. Executor legado preservado. |
| aprovacoes | Pendente. Executor legado preservado. |
| categorias | Integrado em teste. Cadastro, atualização e listagem. Exclusão com validação de itens em uso e paridade operacional pendentes. |
| obras | Parcial, integrado em teste. Cadastro e atualização com IDs estáveis; escopo por obra e interfaces operacionais pendentes. |
| ocr | Pendente. Executor legado preservado. |
| manutencao | Pendente. Executor legado preservado. |
| kits | Pendente. Executor legado preservado. |
| calendario | Pendente. Executor legado preservado. |
| centros | Pendente. Executor legado preservado. |
| retiradas | Pendente. Executor legado preservado. |
| notificacoes | Pendente. Executor legado preservado. |
| automacao | Pendente. Executor legado preservado. |
| biometria | Pendente. Executor legado preservado. |

| Extensão | Estágio |
| --- | --- |
| inteligencia | Pendente de migração operacional. |
| backup | Pendente de migração operacional. |
| doutor | Pendente de migração operacional. |
| nfmotor | Pendente de migração operacional. |
| loja | Pendente de migração operacional. |
| imagens | Pendente de migração operacional. |
| backupauto | Pendente de migração operacional. |
| documentos | Pendente de migração operacional. |
| localizacao | Pendente de migração operacional. |
| locais | Pendente de migração operacional. |
| patrimonio | Pendente de migração operacional. |

Para execução local, use Node 24 e npm test. Os motores são carregados pelo runtime com invoiceTestStorage explícito. O retorno consiste em remover essa configuração do ensaio ou reverter o commit na branch de desenvolvimento. Preserve as abas de teste como evidência. Nenhum executor novo foi ativado em produção.

## Catálogo e cotas do Sheets

O runtime carrega o catálogo quando solicitado no modo isolado. Os nomes originais itens e fornecedores foram preservados. Os cadastros gravam versões por SKU e CNPJ em ITENS_CORE_TESTE e FORNECEDORES_CORE_TESTE. Usuários de teste precisam de catalog:read ou catalog:write. Listar e obter itens e listar e consultar fornecedor por CNPJ têm adaptador interno com envelope legado. Os clientes publicados e seus endpoints continuam intactos.

npm test passou. O ensaio Google real com dados sintéticos gravou, repetiu e atualizou um item até a versão 2, criou um fornecedor na versão 1 e releu ambos por outro runtime. Tempo total 8972 ms. O adaptador repete até duas leituras após HTTP 429 ou 503, com atraso exponencial e aleatoriedade. Respeita Retry-After dentro do limite de espera de dez segundos. Uma escrita limitada continua retornando erro para reconciliação pelo identificador da operação. O teste de cota foi simulado. O limite do Google continua aplicável.

As gravações do catálogo usam o mesmo lock local do estoque e do recebimento. Coordenação distribuída e equivalência ponta a ponta no navegador e Android WebView seguem pendentes. O armazenamento operacional e a publicação continuam no fluxo legado.

## Continuação a partir de a6d1386

O recebimento confirmado com código de local passa a compor o saldo isolado do estoque diretamente do evento de recebimento. A saída e as reservas validam esse saldo composto sob o mesmo lock local. A retentativa usa o mesmo identificador de operação. Eventos antigos de teste sem local continuam na projeção histórica e ficam fora do saldo por endereço. O controle de versão apresentado pelo estoque continua sendo a versão do histórico de movimentos do SKU. Em teste real, NF:107364834-94 e requisição 188468fd-2c7a-4234-bf2a-57e8aee010c1 produziram saldo 0 antes da conferência, 5 depois de confirmar e 1 após saída repetida de quatro unidades (19084 ms). Outro runtime confirmou os saldos nos locais A e B.

Categorias agora reutiliza o catálogo Node e o lock compartilhado. A implementação preserva os padrões de ícone, cor e visibilidade encontrados em AP_Modulo_categorias, além de impedir nome duplicado. No Sheets real, CAT-a9febe5b9fa243d4c1652a40 foi criada, repetida, verificada contra um nome duplicado e atualizada para versão 2, em 6230 ms. A exclusão com verificação dos itens que usam a categoria permanece no legado. npm test passou.

Para retomar, a próxima dependência do inventário é validar o contrato de locais e o vínculo da contagem ao saldo por local. A matriz acima distingue os recortes validados da migração operacional. Nenhum motor tem paridade operacional completa demonstrada.

## Continuação a partir de 211b1ac

A leitura NF usa o contrato de AP_NF_listar e AP_NF_itemPublico_: busca por cabeçalho ou item, ordenação por entrada ou emissão e campos públicos. A regressão automatizada validou busca e envelope básico. O ajuste de estoque define o saldo desejado no local e recusa quantidades que deixariam a reserva descoberta. Movimentações incluem recebimentos confirmados e permitem filtrar saídas negativas.

Ao portar AP_Modulo_compras, a pré-compra mantém um registro aberto por SKU e reforça a quantidade pelo máximo, com histórico e releitura. No Sheets real, #PC-000001 manteve uma linha com quantidade 7 após dois reforços concorrentes, e o estoque sintético confirmou saldo 5 e ajuste -3 (17406 ms). O segundo ensaio confirmou a alteração para EM_COTACAO e retentativa.

AP_Modulo_solicitacoes foi usado como referência para criação e listagem. O ensaio grava solicitação e reserva pendente no mesmo evento. A falta de saldo é informativa e a criação não movimenta estoque. No Sheets real, duas submissões da mesma operação resultaram em #SOL-000001 e #RES-000001, com saldo preservado em 2 (11526 ms, incluindo a alteração de status de compra). npm test passou.

A emissão de pedidos em lote e a conversão da pré-compra requerem persistência coordenada de todas as linhas e do vínculo. A aprovação e a retirada da reserva ainda precisam dos contratos e das regras de alçada. Mantenha a escrita operacional no Apps Script até validar esses fluxos, NF com órfãs, formato completo de movimentos e os clientes publicados.

## Lote de Configuração, Usuários e Obras

Partida em a62aece. O runtime isolado carrega a administração sob demanda. AP_Modulo_config, AP_CONFIG_ler_, AP_CONFIG_gravar_, AP_Modulo_obras e AP_Modulo_usuarios são as referências dos contratos. O Core valida permissões antes de consultar dados ou persistir e usa o armazenamento de eventos e lock local existentes.

npm test passou. A suíte cobriu concorrência e reenvio de criação de obra, versão de configuração, perfis, matrícula com zeros e omissão de credenciais. No Sheets real, as abas CONFIG_CORE_TESTE, OBRAS_CORE_TESTE e USUARIOS_CORE_TESTE foram usadas exclusivamente. O ciclo sintético de 10538 ms confirmou, em outro runtime, a atualização da configuração, avanço 40 em OB01 e consulta do perfil público de uma fixture de usuário. A escrita de usuário na fixture foi feita diretamente no armazenamento para preparar o ensaio. O motor de Usuários oferece apenas consultas. O modo legado e os clientes publicados foram preservados.

Contagem após o lote: 15 parciais e 19 pendentes. Nenhum motor recebeu homologação operacional. Próximo ponto: Inventário, começando por AP_Modulo_inventario em MÓDULOS DE FLUXO.js e AP_INV_registrarContagem no arquivo INVENTÁRIO MÓVEL POR ENDEREÇO. O saldo isolado por SKU e local está no motor de estoque já validado.
