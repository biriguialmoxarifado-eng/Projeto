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
| lojinha | Parcial, integrado em homologação local. Catálogo, busca, detalhe e saldo por local. Fotos, status e fluxo de pedidos pendentes. |
| epi | Pendente. Executor legado preservado. |
| ferramentas | Pendente. Executor legado preservado. |
| ocorrencias | Parcial, integrado no Desktop local. Criar, atualizar e consultar; exclusão, alçadas operacionais e formulários publicados pendentes. |
| projetos | Parcial, integrado em teste. Cadastro, progresso, consulta e exclusão lógica. Integração de abastecimento e clientes pendentes. |
| inventario | Parcial, integrado em teste. Abertura, contagem, divergência e encerramento. QR, rotas, escopo de equipe e ajuste de saldo pendentes. |
| relatorios | Parcial, integrado em teste. Registro e consulta de metadados e parâmetros. Geração e entrega de arquivos pendentes. |
| painel | Parcial, integrado em teste. Carregar e salvar PAINEL_CONFIG. Agregados e homologação visual pendentes. |
| mural | Parcial, integrado em teste. Publicações e referências de fotos com exclusão lógica. Acesso a conteúdo e paridade do cliente pendentes. |
| aprovacoes | Pendente. Executor legado preservado. |
| categorias | Integrado em teste. Cadastro, atualização e listagem. Exclusão com validação de itens em uso e paridade operacional pendentes. |
| obras | Parcial, integrado em teste. Cadastro e atualização com IDs estáveis; escopo por obra e interfaces operacionais pendentes. |
| ocr | Pendente. Executor legado preservado. |
| manutencao | Pendente. Executor legado preservado. |
| kits | Parcial, integrado em teste. Cadastro, perfil, consultas e exclusão lógica. Validação com a Lojinha e os consumidores reais pendente. |
| calendario | Parcial, integrado em teste. Criação, listagem e exclusão lógica. Paridade com os consumidores operacionais pendente. |
| centros | Parcial, integrado em teste. Criação, edição, listagem e exclusão lógica. Vínculos e consumidores operacionais pendentes. |
| retiradas | Pendente. Executor legado preservado. |
| notificacoes | Parcial, integrado em teste. Criar, listar e marcar lida; integração com eventos e contratos de perfis reais pendentes. |
| automacao | Parcial, integrado em teste. Listar, cadastrar e alternar regras. Executor de eventos e efeitos permanecem no legado. |
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

## Lote de Inventário

A partir de a93a254, o runtime isolado carrega Inventário sob demanda. AP_Modulo_inventario e AP_INV_registrarContagem foram as referências. A abertura registra uma leitura de saldo por SKU e local. A contagem usa operacaoId e versão esperada, e o responsável pode encerrar após contar todos os SKUs. O fechamento registra divergências sem alterar estoque. As leituras da abertura são individuais e não formam um snapshot transacional de todos os SKUs.

npm test passou, incluindo reenvio por duas instâncias, recusa de fechamento antecipado e bloqueio de contagem após confirmação. No Sheets real, INV-0001 recebeu uma única contagem apesar do reenvio, confirmou divergência -2 e preservou o saldo 5. Outro runtime releu o estado. Tempo total 13871 ms em INVENTARIO_CORE_TESTE e ESTOQUE_CORE_TESTE com dados sintéticos.

Contagem após o lote: 16 parciais, 18 pendentes e nenhum motor homologado. Próximo motor: Lojinha, em AP_Modulo_lojinha no arquivo MÓDULOS DE OPERAÇÃO.js. Reaproveitar catálogo, saldo por local e solicitação com reserva pendente. Para Retiradas, mapear AP_Modulo_retiradas e AP_Modulo_reservas retirar, incluindo aprovação, entrega parcial e coordenação entre reserva e baixa por SKU. Manter rotas operacionais legadas.

## Ponte local dos HTMLs e Lojinha

Partida em 1b05439. Desktop usa index.html e API.call, enquanto Campo usa ALMOXA_CAMPO.html.html e api. Com ALMOXA_PREVIEW_SHEET_ID, ALMOXA_GOOGLE_AUTH=oauth e as variáveis ALMOXA_DIAGNOSTICS_TOKEN e ALMOXA_DIAGNOSTICS_ACTOR, inicie npm start em 127.0.0.1. Abra /homologacao/desktop ou /homologacao/campo na mesma origem. Informe somente a credencial de teste no painel. O modo consulta exclusivamente a planilha ALMOXA_TESTE_CORE. As rotas de produção continuam seguindo o código legado quando o script de homologação não é carregado.

A ponte usa HTTP loopback de mesma origem, sem CORS, credencial em memória, timeout, reaproveitamento de leituras simultâneas e resposta clara para operações bloqueadas. Service workers estão desabilitados nas páginas do ensaio. Para a Lojinha, o contrato isolado exige local explícito. O motor aplica os filtros de AP_Modulo_lojinha e consulta saldos em lote, carregando movimentos e recebimentos uma vez. O ensaio Edge headless abriu os dois HTMLs reais, consultou seis NFs sintéticas e dois itens via Core e Sheets, bloqueou nf.salvar e recusou leitura após encerrar a sessão. npm test passou com os testes de Lojinha e HTTP.

A configuração de branch e diretório da publicação do GitHub Pages ainda precisa ser confirmada no painel do repositório. O backend testado foi local e não houve publicação. Antes da Fase 4, faltam login operacional, Android WebView, HTTPS e CORS do ambiente compartilhado, escrita autorizada dos clientes em homologação, arquivos do Drive e paridade dos motores. A matriz registra 17 parciais e 17 pendentes. Próximo motor: Retiradas, pela aprovação, entrega parcial e baixa única em AP_Modulo_reservas e AP_Modulo_retiradas. Para retirar a ponte, encerre o processo de homologação ou inicie sem ALMOXA_PREVIEW_SHEET_ID.

## Desktop com gravação isolada, Ocorrências e Notificações

Partida em aa5ad6a. O Core implementa criação, atualização e consultas de Ocorrências a partir de AP_Modulo_ocorrencias e AP_FLUXO_crud_, e criação, listagem e confirmação de leitura a partir de AP_Modulo_notificacoes. Versão, reenvio, auditoria e persistência usam a camada isolada existente. Notificação registra estado no Sheets de teste, sem envio externo. A filtragem verifica destinatário e correspondência exata de perfil. A marcação de leitura segue um campo compartilhado no registro, como no legado, e depende de permissão de escrita no ensaio.

Para verificar no Desktop, inicie o Core local com as variáveis do modo de homologação, ALMOXA_DIAGNOSTICS_ROLE=operator e ALMOXA_PREVIEW_WRITE=1. Em /homologacao/desktop, informe a credencial de teste, teste a leitura de NF e pressione Registrar ocorrência sintética. O painel usa API.call, confirma por releitura e conserva a chave da operação nas tentativas sem confirmação. O backend permite escrita somente para as ações de Ocorrências declaradas no modo local. O login operacional do Desktop permanece no legado.

npm test passou. No Edge com os HTMLs reais, o Desktop leu seis NFs, gravou e releu a ocorrência #OC-000001 no Sheets de teste, bloqueou escrita de NF e encerrou a sessão de homologação. A API também comprovou criação, retentativa e marcação como lida de uma notificação sintética. Foram usadas somente as abas OCORRENCIAS_CORE_TESTE e NOTIFICACOES_CORE_TESTE para escrita. Nenhuma mensagem externa foi emitida.

Matriz após o lote: 19 parciais, 15 pendentes e nenhum motor homologado. Próximo ponto: Retiradas e Aprovações, pela regra de alçada em AP_Modulo_aprovacoes e pela entrega parcial em AP_Modulo_reservas retirar. Para o Desktop, validar a autenticação do usuário e migrar o primeiro formulário operacional com um piloto isolado, usando o transporte central e um esquema de sessão que não dependa da credencial compartilhada de ensaio.

## Kits, Calendário e Centros de Custo

Partida em d2ebdab. O lote reutiliza armazenamento de eventos, lock local, autor e releitura. As ações de consulta são permitidas no Desktop de homologação. As mutações continuam disponíveis somente pelo Core isolado. Exclusões lógicas preservam o histórico sintético. Nenhum módulo mudou de executor operacional.

npm test passou. No Sheets ALMOXA_TESTE_CORE, a retentativa concorrente gerou um único KIT-001, a consulta de perfil retornou o kit, a exclusão de calendário foi relida sem o evento na lista e outro runtime confirmou a versão 2 do centro. Tempo de 12066 ms. Somente as abas KITS_CORE_TESTE, CALENDARIO_CORE_TESTE e CENTROS_CORE_TESTE receberam gravações. Matriz: 22 parciais, 12 pendentes e nenhum homologado. Próximos motores independentes: Projetos, Relatórios e Mural, pelos contratos de AP_Modulo_projetos, AP_Modulo_relatorios e AP_Modulo_mural e pela função AP_FLUXO_crud_.

## Projetos, Relatórios e Mural

A partir de ccaa35f, o segundo lote implementa criar, consultar, atualizar e excluir logicamente, com os aliases detalhe, registrar e gerados dos módulos de Fluxo. A escrita usa sessão, permissão, versão, auditoria, reenvio e releitura. A homologação Desktop recebe somente as consultas. O registro de relatório não gera arquivos. Mural preserva referências de fotos, sem acesso a conteúdo no Drive. Projetos ainda não abastece estoque.

npm test passou. No Sheets ALMOXA_TESTE_CORE, PRJ-001 foi criado, repetido, atualizado e relido com progresso 30; REL00001 foi registrado e apareceu em gerados; Mural exibiu referência sintética de foto e confirmou exclusão lógica. Tempo total de 11252 ms. Somente as abas PROJETOS_CORE_TESTE, RELATORIOS_CORE_TESTE e MURAL_CORE_TESTE foram gravadas. A matriz passa a 25 parciais, 9 pendentes e nenhum homologado.

Próxima retomada: Painel, pelos contratos carregar/salvar de AP_Modulo_painel e pelos agregados de AP_Modulo_dashboard. Reaproveitar a configuração PAINEL_CONFIG, as obras e a projeção de estoque. Outros pendentes são EPI, Ferramentaria, Aprovações, OCR, Manutenção, Retiradas, Automação e Biometria. Manter Biometria por último e o Apps Script como executor operacional.

## Painel e Automação

Partida em 30f7aff. Painel preserva a chave PAINEL_CONFIG e os contratos carregar/salvar. Automação implementa regras, salvar e alternar com histórico de autoria, versão e reenvio. Consultas disponíveis no Desktop local de homologação. Gravações permanecem no Core isolado. Gatilhos operacionais continuam no executor legado.

npm test passou. O ensaio OAuth em ALMOXA_TESTE_CORE usou CONFIG_CORE_TESTE e AUTOMACAO_CORE_TESTE, confirmou Painel versão 1 por releitura e alternância concorrente com somente dois eventos de auditoria na regra: AUT-f7c8d163d4a01184763c0258. Tempo de 8385 ms. Nenhuma regra foi disparada. Matriz: 27 parciais, 7 pendentes e nenhum homologado. Próximo ponto: fichas de EPI e Ferramentaria, começando pelos contratos AP_Modulo_epi, AP_Modulo_ferramentas e AP_FER_retirar_ para preservar entrega, custódia e saldo.
