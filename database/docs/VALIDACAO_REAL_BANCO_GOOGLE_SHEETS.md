# Migração e validação do banco na V2

## Acesso ao Google

O backend usa Application Default Credentials (ADC). Habilite a Google Sheets API no projeto Google Cloud da identidade de execução. Configure a conta de serviço no ambiente do backend. Em execução local, ADC pode carregar o arquivo apontado por `GOOGLE_APPLICATION_CREDENTIALS`, armazenado fora do projeto. O e-mail da conta vem de `client_email` ou da identidade vinculada ao serviço de execução.

| Recurso | Configuração | Permissão da conta de serviço |
| --- | --- | --- |
| Planilha operacional que o Apps Script resolve em `AP_Config_getSpreadsheet_` | `ALMOXA_SPREADSHEET_ID` recebe o valor de `SPREADSHEET_ID` nas propriedades do script. Se estiver vazio, use o ID da planilha vinculada ao script. | Leitor na planilha |
| Planilha exclusiva de teste, com a aba `ALMOXA_TESTE_CONEXAO` | `ALMOXA_TEST_SPREADSHEET_ID` recebe o ID dessa outra planilha. Preencha A1:D1 com `ID`, `CRIADO_EM`, `ORIGEM` e `MENSAGEM`. | Editor na planilha de teste |

`npm run test:google` consulta os metadados operacionais e lê A1 da primeira aba pela Sheets API. O valor da célula fica fora do log. `npm run test:google -- --write` exige que a leitura operacional passe, grava um UUID na planilha de teste, relê os quatro campos, repete a gravação com o mesmo UUID e confirma a existência de uma única linha. A rotina rejeita o ID da planilha operacional como destino de teste.

Um intervalo nomeado com ID determinístico serve como marcador. Sheets aplica o marcador e o append no mesmo lote atômico. Preserve os marcadores enquanto os registros de teste estiverem em uso.

## Execução e publicação

`npm start` sobe o Core Node com o diagnóstico de banco em `GET /health`. O endpoint retorna estado, versão do Core e a revisão configurada em `ALMOXA_REVISION`. O padrão local é `127.0.0.1:3000`. No ambiente de implantação, configure `HOST` e `PORT` conforme o runtime e exponha o endpoint de saúde somente à infraestrutura.

O Actions valida a branch `arquitetura-v2` e empacota os arquivos do backend em `almoxa-backend-<SHA>`. O backend precisa de um serviço Node com acesso HTTPS ao Google, instalação por `npm ci --omit=dev`, comando `npm start`, ADC e a configuração de planilha acima. O artefato tem uma lista explícita de diretórios e arquivos. A configuração de credenciais deve ficar no ambiente de execução.

O frontend da cópia V2 tem o mesmo blob de `index.html` do snapshot local de `origin/main` e usa a URL `/macros/s/…/exec` do Apps Script. O código também aponta para o GitHub Pages do repositório. A origem e o commit efetivamente publicados no Pages precisam de confirmação no GitHub. O workflow existente faz `clasp push`, que sincroniza o código do script. A revisão de um deployment versionado do Web App precisa ser verificada separadamente. As cópias têm a mesma configuração `.clasp.json`, por isso o workflow de sincronização na V2 restringe a execução à `main`.

## Inventário de execução

O catálogo `AP_ENTRADA_MODULOS` em `app/ALMOXA PRO — ENTRADA ÚNICA.js` tem 46 entradas e 45 nomes distintos. Ele registra nomes no Core legado. A presença no catálogo por si só não comprova uma rota ativa nem um deployment.

| Entradas do catálogo | Evidência na V2 |
| --- | --- |
| usuários, auth, permissões | Sessão e autorização têm componentes e testes locais em `core/security` e `tests`. Cadastro, emissão de credenciais e rotas das telas seguem a API legada. |
| itens, fornecedores, config, estoque, reservas, lojinha, epi, ferramentas, nf, compras, ocorrências, projetos, inventário, relatórios, painel, mural, aprovações, categorias, obras, ocr, manutenção, kits, calendário, centros, solicitações, retiradas, saídas, notificações, automação, auditoria, biometria | Entradas restantes do bloco inicial de 34. O catálogo e a API de `app/` apontam para o legado. Nenhum está registrado como motor operacional no runtime Node, e a suíte Node não comprova integração de qualquer um deles. |
| inteligência, backup, doutor, permissões (segunda entrada), nfmotor, loja, imagens, backupauto, documentos, localização, locais, patrimônio | Entradas adicionais do catálogo legado. Nenhuma está registrada como motor operacional no runtime Node ou comprovada pela suíte de integração Node. |
| database | A API legada ainda chama `AP_DB_direto` para `diagnostico`, `teste.gravar` e `teste.ler`, com validação de sessão e acesso por `SpreadsheetApp`. O fluxo administrativo Node agora executa essas operações pela Sheets API. Os testes locais simulam o contrato Google. A validação real permanece condicionada ao acesso descrito acima. |

Na V2, o caminho exercitado é comando de validação ou endpoint de saúde → runtime do Core → diagnóstico de banco e camada de dados → provedor Sheets. As telas operacionais continuam pelo caminho `ALMOXA_CONFIG.API_URL` ou `google.script.run` → API/ponte do Apps Script → motor legado → armazenamento. A troca desse caminho requer a validação da autenticação das telas e do contrato de cada motor.

As planilhas guardam dados tabulares. O código de Document Engine, OCR, patrimônio e backup também usa `DriveApp` para arquivos e pastas, incluindo documentos, imagens e cópias de segurança. A validação de banco usa Sheets API. A migração dos fluxos que operam arquivos exigirá Drive API e os IDs dos recursos correspondentes. O legado ainda hospeda endpoints, sessão operacional, envio de e-mail e rotinas de backup. O inventário em código não confirma quais gatilhos auxiliares estão ativos no projeto implantado.

## Leitura paginada de uma aba

Defina ALMOXA_TEST_READ_SHEET com o nome exato de uma aba autorizada ao executar npm run test:google. O teste administra somente leituras por padrão e valida a primeira linha de cabeçalhos sem imprimir dados. No backend, readSheetPage recebe o nome da aba, startRow (padrão 2) e limit (padrão 50, máximo 100). A paginação segue posições físicas até o fim da grade e pode retornar páginas vazias. nextRow é nulo ao terminar a grade. A enumeração não fornece uma visão transacional de abas editadas durante a leitura.

## Conferência de acesso ao Google Drive

Habilite a Google Drive API no projeto Google Cloud da identidade ADC. Conceda à identidade acesso de leitor a um recurso de teste autorizado e configure seu ID em ALMOXA_TEST_DRIVE_FILE_ID. O comando npm run test:google também confirma que o recurso está ativo, sem imprimir seus metadados. O adaptador usa o escopo drive.metadata.readonly e aceita recursos em unidades compartilhadas. O teste cobre metadados. Download, upload e integração dos motores de documentos e fotos continuam pendentes.

Execute npm run test:google -- --drive para validar apenas o Drive, independentemente da configuração do Sheets. Use npm run test:google para ler Sheets e, se o ID do Drive estiver definido, conferir também o recurso do Drive. Use npm run test:google -- --write para validar a gravação em planilha separada. O comando informa configurações ausentes antes de acessar a API e omite valores de configuração e conteúdo das respostas em caso de falha.
