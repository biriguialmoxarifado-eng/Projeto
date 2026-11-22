# Fase 3 — Estoque e concorrência em recebimentos

No Sheets real, o primeiro ciclo de estoque encontrou HTTP 429. A repetição isolada com um novo SKU sintético completou sete movimentos e a releitura por outro runtime confirmou saldo 8, reservado 1 e disponível 7 no local A, e saldo zero em B. Tempo total de 14301 ms. O ensaio de estoque e a suíte npm test passaram.

O motor de estoque isolado controla quantidade inteira por SKU e local. Abrange entrada, saída, transferência entre locais do mesmo SKU, reserva, liberação, retirada de reserva, devolução e estorno. A transferência registra os dois lados em um evento. Saldo e reserva usam versões por SKU, autoria, confirmação por releitura e idempotência. A aba de teste é ESTOQUE_CORE_TESTE da planilha ALMOXA_TESTE_CORE. O saldo do novo motor incorpora recebimentos confirmados que informam o local, preservando a projeção histórica sem local. Cadastro real, unidades fracionárias, transferência entre SKUs e reserva por pedido ainda precisam de paridade.

O primeiro ensaio real de edição simultânea com recebimento persistiu ambas as mutações, contrariando a simulação de unicidade dos marcadores do Sheets. Os eventos sintéticos foram preservados. Os motores agora compartilham um lock por planilha no mesmo perfil local e conservam os marcadores para identificar operações. Uma edição ou restauração é recusada depois que existe vínculo de recebimento. Na repetição real, a NF:388041441-95 foi recebida na versão 1 e a edição foi rejeitada com NF_RECEBIDA. Disputa de 3490 ms, duas unidades na projeção isolada. O lock coordena processos locais sob o mesmo perfil. A ativação exige um único executor de escrita ou coordenação distribuída validada. Uma queda abrupta pode deixar o lock em disco. Antes de liberar manualmente, confirmar que o processo encerrou e reconciliar a escrita pelo histórico de operações.

O adaptador interno de NF cobre listar, obter e itens nos envelopes usados pelo Desktop e ALMOX CAMPO. O teste automatizado exercita o contrato e rejeita sessão inválida. A implantação HTTP, o WebView real, as operações de escrita dos clientes e o restante dos filtros do legado continuam pendentes.

Os 34 motores usam o inventário de referência em FASE_2_CORE_INDEPENDENTE.md. Os estágios abaixo se aplicam à V2 isolada.

| Nº | Motor | Implementação Node | Paridade legado | Testes | Integração Desktop | Homologação | Pendências | Evidencia versionada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | nf | Parcial | Recorte comparado | HTTP e Sheets isolado | Leitura e escrita sintetica via transporte no Edge | PARCIAL | Formularios legados, recuperacao de orfas e escrita operacional pendentes. | `4b47ca4` |
| 2 | estoque | Parcial | Recorte comparado | HTTP e Sheets isolado | Historico e modal de ajuste no Edge, com releitura apos recarga | PARCIAL | Entrada e saida pelos formularios, permissoes por obra e paridade historica pendentes. | `cfa592a` |
| 3 | compras | Parcial | Recorte comparado | Suite HTTP e Sheets real isolado | Consultas listar, precompras e pedidos no Edge | PARCIAL | Emissao, conversao e alteracao de status pela interface ainda exigem teste de paridade. | `a2a1d59` |
| 4 | solicitacoes | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Criação e listagem com reserva pendente integradas em teste. Aprovação e retirada operacionais pendentes. | `a62aece` |
| 5 | reservas | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Criação pendente pela solicitação integrada em teste. Decisão, alçadas e retirada operacional pendentes. | `a62aece` |
| 6 | saidas | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Testado no estoque isolado. Fluxo operacional legado pendente. | `a62aece` |
| 7 | auth | Parcial | Recorte comparado | Suíte e diagnóstico | Sessão no Edge | PARCIAL | Parcial. Sessão Node testada, login operacional pendente. | `74f7316` |
| 8 | permissoes | Parcial | Recorte comparado | Suíte e diagnóstico | Bloqueios verificados no Edge e na API | PARCIAL | Parcial. Escopos de teste aprovados, alçadas operacionais pendentes. | `74f7316` |
| 9 | auditoria | Parcial | Pendente | Suíte e armazenamento isolado | Consulta de Obras no Edge | PARCIAL | Parcial. Autoria de eventos testada, trilha operacional pendente. | `74f7316` |
| 10 | usuarios | Parcial | Recorte comparado | Suíte e armazenamento isolado | Contagem no Edge | PARCIAL | Parcial, integrado em teste. Listagem, contagem e consulta com projeção pública; cadastro, permissões por obra e credenciais pendentes. | `a93a254` |
| 11 | itens | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge | PARCIAL | Integrado em teste. Cadastro explícito por SKU e consultas. Geração automática, imagem, exclusão e paridade operacional pendentes. | `a62aece` |
| 12 | fornecedores | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge | PARCIAL | Integrado em teste. Cadastro por CNPJ e consultas. Contrato operacional de escrita e paridade pendentes. | `74f7316` |
| 13 | config | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge | PARCIAL | Parcial, integrado em teste. Chaves comuns leem e gravam; configuração especial SKU e precedência operacional pendentes. | `a93a254` |
| 14 | lojinha | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge em lote anterior | PARCIAL | Parcial, integrado em homologação local. Catálogo, busca, detalhe e saldo por local. Fotos, status e fluxo de pedidos pendentes. | `aa5ad6a` |
| 15 | epi | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Cadastro, edição e consulta de fichas. Assinatura, entrega operacional e saldo pendentes. | `e973559` |
| 16 | ferramentas | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Cadastro, custódia, devolução com avaria e retorno da manutenção. Transferência e identificação operacional pendentes. | `2b6fa34` |
| 17 | ocorrencias | Parcial | Recorte comparado | Suíte e armazenamento isolado | Escrita sintética no Edge em lote anterior | PARCIAL | Parcial, integrado no Desktop local. Criar, atualizar e consultar; exclusão, alçadas operacionais e formulários publicados pendentes. | `d2ebdab` |
| 18 | projetos | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Cadastro, progresso, consulta e exclusão lógica. Integração de abastecimento e clientes pendentes. | `30f7aff` |
| 19 | inventario | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Abertura, contagem, divergência e encerramento. QR, rotas, escopo de equipe e ajuste de saldo pendentes. | `1b05439` |
| 20 | relatorios | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Registro e consulta de metadados e parâmetros. Geração e entrega de arquivos pendentes. | `30f7aff` |
| 21 | painel | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Carregar e salvar PAINEL_CONFIG. Agregados e homologação visual pendentes. | `da3d398` |
| 22 | mural | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Publicações e referências de fotos com exclusão lógica. Acesso a conteúdo e paridade do cliente pendentes. | `30f7aff` |
| 23 | aprovacoes | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Alçada por item e decisão de reserva. Pré-compra e links legados pendentes. | `3b0c965` |
| 24 | categorias | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge | PARCIAL | Integrado em teste. Cadastro, atualização e listagem. Exclusão com validação de itens em uso e paridade operacional pendentes. | `74f7316` |
| 25 | obras | Parcial | Recorte comparado | Suíte e armazenamento isolado | Leitura no Edge | PARCIAL | Parcial, integrado em teste. Cadastro e atualização com IDs estáveis; escopo por obra e interfaces operacionais pendentes. | `a93a254` |
| 26 | ocr | Parcial | Recorte comparado | Suíte e armazenamento isolado | Disponibilidade no Edge | PARCIAL | Parcial, integrado em teste. OCR real de PNG/JPEG no Windows, interpretação DANFE e histórico. PDF, Drive e paridade Desktop pendentes. | `2661e14` |
| 27 | manutencao | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Estado, versões e snapshot lógico limitado. Cópia Drive e restauração pendentes. | `3b0c965` |
| 28 | kits | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Cadastro, perfil, consultas e exclusão lógica. Validação com a Lojinha e os consumidores reais pendente. | `ccaa35f` |
| 29 | calendario | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Criação, listagem e exclusão lógica. Paridade com os consumidores operacionais pendente. | `ccaa35f` |
| 30 | centros | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Criação, edição, listagem e exclusão lógica. Vínculos e consumidores operacionais pendentes. | `ccaa35f` |
| 31 | retiradas | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Entrega parcial por SKU e baixa única. Assinaturas, lote e paridade do cliente pendentes. | `3b0c965` |
| 32 | notificacoes | Parcial | Recorte comparado | Suíte e Sheets real isolado | Pendente no cliente | PARCIAL | Aviso por recebimento confirmado, visibilidade por solicitante e leitura idempotente. Sessão, interface operacional e regras legadas pendentes. | `77b3a85` |
| 33 | automacao | Parcial | Recorte comparado | Suíte e armazenamento isolado | Pendente no cliente | PARCIAL | Parcial, integrado em teste. Listar, cadastrar e alternar regras. Executor de eventos e efeitos permanecem no legado. | `0b5a388` |
| 34 | biometria | Parcial | Pendente | Suíte e armazenamento isolado | Pendente no cliente | BLOQUEADO | Parcial, estrutura de teste. Identidade única e referência opaca auditada. Autenticação biométrica e leitor físico ficam para depois. | `3b0c965` |

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

## Ferramentaria: custódia isolada

A partir de 0b5a388, Ferramentaria passou a registrar cadastro por patrimônio, retirada, devolução, avaria e retorno da manutenção, com consultas de estado e histórico. Na retirada, a identidade da sessão vira o responsável. A devolução por terceiro e a avaria sem descrição são recusadas. Não aceitamos uma declaração do cliente como prova de identidade. Os contratos de autenticação operacional, transferência, cautelas e os campos de patrimônio ainda exigem homologação.

npm test passou. No Sheets ALMOXA_TESTE_CORE, o patrimônio sintético SYN-c073f9a9-b6f8-48e0-988f-2df1802972fd teve quatro eventos em FERRAMENTAS_CORE_TESTE e terminou DISPONIVEL. Reenvios concorrentes da retirada devolveram o mesmo evento. Outra instância confirmou histórico e estado. Tempo de 10110 ms. Matriz: 28 parciais, 6 pendentes, nenhum homologado. Próximo ponto: fichas EPI em AP_Modulo_epi e AP_Modulo_epigestao, com autenticação individual e comprovante associado à operação. Ainda pendentes Aprovações, OCR, Manutenção, Retiradas e Biometria, mantida por último.

## Fichas de EPI

A partir de 2b6fa34, o Core implementa criar, salvar, listar, fichas e obter conforme os envelopes de AP_Modulo_epi. A ficha preserva identidade por ID, matrícula, SKU, quantidade e autoria. As consultas foram registradas no Desktop isolado. O ensaio rejeita assinatura e não movimenta saldo. AP_Modulo_epigestao, catálogo operacional, comprovantes, estornos e integração com estoque continuam no legado.

npm test passou. Em EPI_CORE_TESTE de ALMOXA_TESTE_CORE, duas requisições concorrentes criaram apenas EPI00001; outra instância confirmou a edição, o autor e a validade em 5926 ms. Somente dados sintéticos. Matriz: 29 parciais, 5 pendentes e nenhum homologado.

Retomar pela alçada por item de AP_Modulo_aprovacoes e a entrega parcial em AP_Modulo_reservas retirar. A decisão tem de ser persistida e auditada junto do vínculo com a reserva. A retirada deve reconciliar a baixa antes de confirmar. OCR exige leitura de conteúdo de arquivo isolado; Manutenção exige snapshot e restauração em cópia; contratos de Biometria vêm por último, sem captura física.

## Aprovações, Retiradas, Manutenção e estrutura de Biometria

Partida em e973559. O recorte de Aprovações usa as alçadas por categoria do legado e deriva o perfil da sessão de teste. A decisão por SKU atualiza o mesmo histórico da reserva. A retirada de um SKU por operação grava, em um único evento, a mudança da reserva e a saída projetada no saldo de estoque. O Core exige reserva aprovada, local, saldo disponível e versão esperada sob lock local. Versões de movimentos manuais do estoque têm sua própria sequência. Reservas sintéticas antigas sem local não são baixadas. Pré-compra, links, assinaturas e entrega em lote ainda precisam de paridade.

Manutenção registra estado e versões de ensaio. O snapshot lógico copia apenas CONFIG_CORE_TESTE e OBRAS_CORE_TESTE para MANUTENCAO_CORE_TESTE, limitado a 20000 caracteres. Retorna metadados e mantém o conteúdo fora das consultas HTTP. O estado do ensaio não bloqueia a aplicação operacional. Cópia no Drive e restauração seguem pendentes. Biometria registra uma referência opaca por identidade ativa sintética, com versão e autoria. Nenhuma imagem, digital ou prova biométrica foi coletada. A API não autentica via leitor.

npm test passou com 40 testes no executor Node e sem falhas. Uma regressão inicial em Obras e Ocorrências foi corrigida. O primeiro ensaio real atingiu HTTP 429. A repetição respeitou a janela de cota usando a mesma chave da operação e confirmou #RES-000003 como RETIRADA, saldo 2 após duas baixas e snapshot SNP-f54f8073280b6a0d45ea4eac com cinco eventos copiados (90205 ms). A validação de vínculo biométrico sintético confirmou um único evento auditado, relido por segunda instância (4812 ms).

Matriz: 33 parciais, 1 pendente e nenhum homologado. Próximo ponto: OCR. O OAuth atual tem drive.metadata.readonly e o adaptador não baixa nem converte conteúdo. O legado usa conversão OCR via Drive. Para retomar, definir o acesso mínimo a um arquivo de teste, autorizar a leitura e a conversão isoladas para a identidade apropriada, e validar o conteúdo sintético extraído. Não iniciar a revisão geral de paridade enquanto OCR estiver pendente.

## OCR: implementação inicial

Partida em 3b0c965. O motor preserva as ações disponivel e ler e o envelope do legado. Windows OCR em pt-BR lê PNG e JPEG locais, o Core extrai campos da DANFE e grava o resultado auditado em OCR_CORE_TESTE para releitura e idempotência. A rota de upload só existe em modo local de homologação com escrita optativa e exige autorização. Os arquivos temporários são removidos. PDF, arquivamento e conversão no Drive continuam no executor legado. A configuração OAuth existente não foi ampliada.

npm test passou. Um PNG sintético criado para o ensaio foi processado pelo OCR real do Windows. Reconheceu número 000000127, total 1234,50 e cinco campos. Nova instância retornou a mesma resposta e confirmou somente um evento auditado no Google Sheets de teste em 5105 ms. Matriz: 34 com implementação inicial parcial, zero pendentes e zero homologados. A homologação começa pelo lote Base.

## Início da homologação: lote Base

A partir de 2661e14, o Desktop de homologação troca a credencial de ensaio por uma sessão randômica de 15 minutos, mantida no servidor. O encerramento revoga a sessão e cancela requisições pendentes. O teste HTTP verificou que a credencial de abertura sozinha não despacha operações e que a sessão revogada recebe 401.

No Edge, o HTML Desktop abriu e consultou, pelo Core e pelo Sheets isolado, Configuração, Usuários, Auditoria de Obras, Itens, Fornecedores, Categorias, Obras e seis notas de teste. O navegador também verificou disponibilidade OCR, bloqueio de escrita de NF e encerramento da sessão. A auditoria da Base expõe metadados autorizados, sem o conteúdo dos eventos. npm test passou. Isso valida o transporte e a sessão de homologação, sem homologar o login individual do legado nem a paridade das escritas.

Retomada: completar a Base com sessões individuais e a comparação de escrita e efeitos do Apps Script em cópia. Em seguida, executar Operação, Gestão e Integrações especiais. No OCR faltam PDF, processamento de arquivo de teste no Drive e o formulário operacional. A integração física do leitor biométrico continua pendente. A matriz registra zero motores sem implementação inicial, 34 parciais e zero homologados.

### Ensaio fiscal no Desktop de homologacao

Em 2026-11-22, Edge e Core local, com OAuth e ALMOXA_TESTE_CORE: criacao em 1.633 ms, edicao em 3.214 ms, reenvio retornou versao 2, edicao com versao antiga retornou conflito e a releitura confirmou versao 2 e a observacao. Exclusao ficou bloqueada e o logout encerrou o acesso. O teste usou o transporte do Desktop, sem preencher os formularios legados. A escrita requer opt-in explicito. Drive e paridade operacional permanecem pendentes neste lote.

### Recebimento e aviso ao solicitante

O index.html declara internamente sistema 430. O ensaio OAuth em ALMOXA_TESTE_CORE passou em 15.334 ms: criou NF, vinculou requisicao e compra, confirmou recebimento e reenvio, abriu outro runtime, verificou saldo 3 no local A e marcou o unico aviso como lido. O aviso e derivado do proprio evento de recebimento, evitando uma segunda gravacao para publica-lo. A confirmacao de leitura usa a trilha de notificacoes. A suite verificou recebimentos parciais, isolamento por destinatario e reenvio. O teste independente do Drive confirmou metadados do arquivo de teste. Conteudo e anexos continuam pendentes. Matriz: 34 parciais, 0 sem implementacao inicial e 0 integralmente homologados.

### Central de Identidade Digital

Usar o ID permanente do colaborador como vinculo para matriculas, foto, cracha, assinatura e credenciais revogaveis. Manter foto com acesso restrito e referencias no Core. Preferir autenticadores WebAuthn em terminais compativeis. Para leitor legado, identificar fabricante, modelo, Windows suportado, licenca e SDK, e validar em dois terminais um adaptador local autenticado, com revogacao por terminal. Manter imagens e modelos de digitais fora de Sheets.

O Core deve emitir um desafio descartavel com validade curta, vinculado ao colaborador, terminal e resumo da operacao de EPI ou ferramenta. Confirmar permissao, verificar resposta e consumir o desafio uma vez. Vincular a evidencia de autenticacao ao evento auditado. Gerar uma cautela por operacao confirmada com identificador idempotente. A assinatura eletronica e sua evidencia exigem fluxo proprio e validacao da finalidade, base legal, acesso e retencao antes de coletar biometria. O sinal de verificacao do WebAuthn pode corresponder a PIN ou biometria.

Referencias: https://www.w3.org/TR/webauthn-2/ e https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes

### Consultas de compras no Desktop V430

A V430 em homologacao usa os contratos de consulta do Core para compras.listar, compras.precompras e compras.pedidos. O cache legado do HTML e ignorado apenas no modo de homologacao, que continua deduplicando chamadas simultaneas identicas no transporte proprio. No Edge, apos abrir sessao, as tres consultas retornaram listas via Sheets de teste em 1.749 ms no total. Escrita fiscal permaneceu bloqueada nesse ensaio de leitura e logout encerrou o acesso. A suite npm test passou com 42 casos no executor node --test. A matriz permanece em 34 parciais, 0 sem implementacao inicial e 0 homologados.

### Movimentacoes no Desktop V430

Edge com OAuth e ALMOXA_TESTE_CORE: estoque.movimentacoes retornou 26 movimentos; a rotina de renderizacao da tela Movimentacoes incluiu o SKU real da primeira linha sintetica. Consulta e renderizacao em 2.868 ms. O HTTP recusou limite invalido com 400 e manteve escrita desativada nesse ensaio. Suite npm test: 42 casos no executor node --test, zero falhas. Sem mudanca nos totais da matriz.

### Continuidade da Fase 3: escrita de estoque

Base d961505. O commit que introduz esta secao integra estoque.saldo e estoque.movimentar ao transporte da V430 de homologacao. Escrita opt-in limitada a SKUs SYN-, com chave de operacao e versao explicitas. No Edge e ALMOXA_TESTE_CORE, entrada 5, reenvio e saida 2 produziram saldo 3, versao 2 e duas linhas de historico em 9.168 ms. npm test passou com 42 casos no executor node --test, incluindo conflito de versao e reenvio no HTTP.

Proxima acao: localizar o emissor efetivo de escrita de estoque na V430 e ligar seu formulario ao adaptador de SKU, local, chave de operacao e versao lida. Repetir entrada, saida e ajuste pelo formulario e recarregar o saldo. Depois retomar os formularios de NF, Itens, Compras e Solicitacoes. Matriz: 0 homologados, 34 parciais, 0 sem implementacao inicial.

### Continuidade: formulario de ajuste de estoque

Base b0d4a93. O modalAjuste da V430 agora consulta saldo e versao para SKU sintetico e obra selecionada, envia ajuste com a mesma chave em caso de reenvio e grava motivo no historico. O backend conserva a assinatura de idempotencia dos movimentos antigos sem motivo. npm test: 42 casos no executor node --test, zero falhas. HTTP verificou ajuste de 3 para 4, historico com motivo e conflito ao alterar o motivo mantendo a chave.

No Edge a sessao de homologacao abriu, mas chamar estoque.mount e estoque-item.mount com um acionador sintetico nao abriu #ajNovo. O ajuste pelo formulario nao foi comprovado. Retomar pela navegacao real e verificar qual botao da tela ativa chama modalAjuste, e se o ambiente apresenta obra selecionada. Biometria conserva estrutura parcial e homologacao bloqueada: validar WebAuthn com identidade individual, HTTPS, dispositivo Windows Hello e pelo menos dois terminais, antes de ligar EPI, ferramentas e recebimentos. Nesta rodada nenhuma imagem foi coletada.

### Aceitacao do modal de ajuste V430

Base 7cd5044. O Edge identificou ReferenceError no modal: STATE pertence ao APP. Corrigido o acesso para APP.STATE. Com obra sintetica A e acionador ligado pelo mount original de Estoque, o modal gravou saldo 4 e uma linha de historico com motivo em ALMOXA_TESTE_CORE. Tempo do segundo ensaio: 6.635 ms. Apos recarregar e reabrir a sessao de homologacao, a consulta voltou a indicar 4. O acionador de ensaio foi inserido no DOM para acionar o manipulador original. Proxima acao: validar a abertura pela lista de itens e os formularios de entrada e saida, escopo por obra e paridade historica.

Contagem reconciliada nesta revisao: 0 HOMOLOGADO, 33 PARCIAL, 1 BLOQUEADO (biometria). As contagens de outras rodadas no historico acima se referem as revisoes em que foram registradas.

### Correcao urgente do painel V430

Base cfa592a. Edge reproduziu a mensagem do painel com OPERACAO_FORA_DA_HOMOLOGACAO para dashboard.mural. A rota de leitura agora usa painel:read e reaproveita PAINEL_CONFIG no Google Sheets de teste. No Edge, a sessao de homologacao abriu e as rotinas reais de painel, Movimentacoes e EPI renderizaram; as consultas de fichas e movimentos retornaram sucesso. Logs do Core registraram HTTP 401 sem sessao e HTTP 200 nas consultas autorizadas. npm test passou com 42 casos no executor node --test. A publicacao GitHub Pages retornou V430 sem o cliente da homologacao e segue pelo caminho legado. O teste local nao comprova a recuperacao do ambiente publicado.

## ALMOXA PRO — ENCERRAMENTO DA FASE 3

Decisao: FASE 3 NAO CONCLUIDA. Contagem versionada antes e depois: 0 homologados, 33 parciais e 1 bloqueado. A contagem 9/23/2 nao tem revisao ou evidencias nominais nas referencias recuperadas; a matriz preserva as evidencias de cada motor.

A partir de eee21bc, o health check em homologacao verificava a configuracao da planilha operacional por engano. Nesta revisao valida o destino isolado e a aba fiscal pelo mesmo guard do motor. No Edge, ALMOXA_TESTE_CORE respondeu HTTP 200 na saude. As rotinas de Painel, Movimentacoes e EPI renderizaram. NF foi consultada durante abertura da sessao. Colaboradores retornou 403 com leitor e sucesso com operador. npm test: 42 aprovados e 0 falhas no executor node --test. Nenhum motor foi homologado nesta rodada.

Acoes por motor: validar na V430 os requisitos da ultima coluna de pendencias com os escopos corretos e releitura no armazenamento isolado. Bloqueio externo: Biometria requer autenticador compativel e sessao assistida no terminal. Uso publicado depende de endpoint HTTPS do Core e login individual com escopo por obra. A validacao de anexos exige recurso Drive sintetico e permissao para o conteudo. Retomada: formularios de NF e Estoque e credenciais individuais em homologacao.
