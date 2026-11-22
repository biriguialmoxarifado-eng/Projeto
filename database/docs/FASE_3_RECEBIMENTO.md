# Fase 3 — Requisição, compra e recebimento isolado

O legado usa ALMOXA_COMPRAS para compras e pré-compras, ALMOXA_NOTAS e ALMOXA_NF_ITENS para notas, e ALMOXA_MOVIMENTACOES para movimentos. AP_Modulo_compras, AP_FLUXO_conferirNF e AP_OPER_entradaEmLote são pontos de referência. A associação com o cadastro operacional de requisições ainda exige confirmar suas colunas e o contrato usado pelos clientes.

## Contrato interno de ensaio

Em Node 24, instale as dependências e execute npm test. O teste automatizado usa dados sintéticos. Um chamador local pode criar o runtime com invoiceTestStorage e uma credencial de diagnóstico explícitos, acessando getInvoiceEngine() e getReceivingEngine() sob demanda. Para Google real use OAuth local e um GoogleSheetsProvider com testOnly e o ID de ALMOXA_TESTE_CORE. O teste depende das abas NF_CORE_TESTE e RECEBIMENTO_CORE_TESTE preparadas com EVENTO_JSON em A1. O runtime padrão não abre o motor ou uma rota HTTP.

| Operação interna | Contrato |
| --- | --- |
| requisitar | id, operation, version 0, numero original, solicitante e itens com SKU e quantidade inteira positiva |
| comprar | id da requisição, operation, versão esperada e identificador da compra |
| receber | id da requisição, operation, versão esperada, id e versão da NF, confirmação física explícita e itens conferidos |
| consultar | id da requisição e sessão com permissão de leitura |
| entradas | SKU e sessão com permissão de leitura. Retorna a soma dos movimentos de teste. |

Cada recebimento confirmado persiste em um único evento o vínculo, o movimento, o estado das quantidades, a auditoria e uma intenção de notificação. Marcadores atômicos impedem reutilizar a operação, a versão da requisição ou a mesma NF. A releitura confirma o evento. Nenhuma mensagem é enviada. O ensaio suporta uma NF por recebimento e uma requisição por NF. Recebimentos parciais usam NFs distintas. A NF precisa corresponder à conferência e ao saldo pendente da requisição.

## Evidências

npm test passou, incluindo leitura de entradas zeradas antes da confirmação, recusa de conferência divergente, parcial, total, retentativa e recusa de NF duplicada. No Sheets real, o ensaio RC-SYN-12f105b7 terminou na versão 4, com duas NFs sintéticas, cinco unidades na projeção de entradas e zero pendentes, em 14632 ms. Uma nova instância do runtime confirmou a persistência. Nenhum saldo operacional foi alterado.

## Estágio e retorno

NF está integrada ao armazenamento isolado. Estoque, compras e solicitações têm um fluxo integrado de ensaio, sem paridade com seus motores completos. Autenticação, permissões e auditoria continuam com cobertura parcial em Node. Os demais motores e as 11 extensões seguem no estágio registrado no inventário da Fase 2, pendentes de migração operacional.

Antes de homologar, validar a aba e as colunas originais de requisição, unidades fracionárias, NFs distribuídas entre requisições, cancelamento e estorno, endereços e saldo operacional, contratos HTTP Desktop/Campo, autenticação operacional e entrega idempotente da notificação. O vínculo consulta a versão da NF, mas a leitura e o recebimento gravam em abas distintas. É necessário congelar a revisão conferida ou coordenar a atualização da NF com o recebimento antes da ativação. A projeção atual percorre o histórico de teste.

Para interromper o ensaio, retire o provedor de teste ou reverta o commit de desenvolvimento. Preserve os eventos isolados como evidência. Para uma futura ativação, use somente um executor por operação. Ensaie retorno em cópia e concilie movimentos, vínculos e notificações já persistidos antes de reabrir a escrita legada.
