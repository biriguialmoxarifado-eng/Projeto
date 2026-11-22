# Fase 3 — Estoque e concorrência em recebimentos

No Sheets real, o primeiro ciclo de estoque encontrou HTTP 429. A repetição isolada com um novo SKU sintético completou sete movimentos e a releitura por outro runtime confirmou saldo 8, reservado 1 e disponível 7 no local A, e saldo zero em B. Tempo total de 14301 ms. O ensaio de estoque e a suíte npm test passaram.

O motor de estoque isolado controla quantidade inteira por SKU e local. Abrange entrada, saída, transferência entre locais do mesmo SKU, reserva, liberação, retirada de reserva, devolução e estorno. A transferência registra os dois lados em um evento. Saldo e reserva usam versões por SKU, autoria, confirmação por releitura e idempotência. A aba de teste é ESTOQUE_CORE_TESTE da planilha ALMOXA_TESTE_CORE. O saldo do novo motor segue separado da projeção de entradas por NF. Cadastro real, unidades fracionárias, transferência entre SKUs e reserva por pedido ainda precisam de paridade.

O primeiro ensaio real de edição simultânea com recebimento persistiu ambas as mutações, contrariando a simulação de unicidade dos marcadores do Sheets. Os eventos sintéticos foram preservados. Os motores agora compartilham um lock por planilha no mesmo perfil local e conservam os marcadores para identificar operações. Uma edição ou restauração é recusada depois que existe vínculo de recebimento. Na repetição real, a NF:388041441-95 foi recebida na versão 1 e a edição foi rejeitada com NF_RECEBIDA. Disputa de 3490 ms, duas unidades na projeção isolada. O lock coordena processos locais sob o mesmo perfil. A ativação exige um único executor de escrita ou coordenação distribuída validada. Uma queda abrupta pode deixar o lock em disco. Antes de liberar manualmente, confirmar que o processo encerrou e reconciliar a escrita pelo histórico de operações.

O adaptador interno de NF cobre listar, obter e itens nos envelopes usados pelo Desktop e ALMOX CAMPO. O teste automatizado exercita o contrato e rejeita sessão inválida. A implantação HTTP, o WebView real, as operações de escrita dos clientes e o restante dos filtros do legado continuam pendentes.

Os 34 motores usam o inventário de referência em FASE_2_CORE_INDEPENDENTE.md. Os estágios abaixo se aplicam à V2 isolada.

| Motor | Estágio |
| --- | --- |
| nf | Integrado em teste. Compatibilidade de leitura parcial. |
| estoque | Integrado em teste. Falta unir o saldo ao recebimento e fazer paridade operacional. |
| compras | Integrado em teste no vínculo de recebimento. Contrato completo pendente. |
| solicitacoes | Integrado em teste no vínculo de recebimento. Contrato completo pendente. |
| reservas | Testado no estoque isolado. Alçadas e fluxo de reserva legado pendentes. |
| saidas | Testado no estoque isolado. Fluxo operacional legado pendente. |
| auth | Parcial. Sessão Node testada, login operacional pendente. |
| permissoes | Parcial. Escopos de teste aprovados, alçadas operacionais pendentes. |
| auditoria | Parcial. Autoria de eventos testada, trilha operacional pendente. |
| usuarios | Pendente. Executor legado preservado. |
| itens | Integrado em teste. Cadastro explícito por SKU e consultas. Geração automática, imagem, exclusão e paridade operacional pendentes. |
| fornecedores | Integrado em teste. Cadastro por CNPJ e consultas. Contrato operacional de escrita e paridade pendentes. |
| config | Pendente. Executor legado preservado. |
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
| categorias | Pendente. Executor legado preservado. |
| obras | Pendente. Executor legado preservado. |
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
