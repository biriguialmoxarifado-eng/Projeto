# Fase 2 do ALMOXA PRO

## Execução local

Use Node.js 24. Configure `ALMOXA_SQLITE_PATH` com o caminho absoluto de um arquivo SQLite dedicado, em diretório existente e persistente. Para o primeiro teste, use um arquivo de teste. Configure no ambiente `ALMOXA_DIAGNOSTICS_ACTOR`, um identificador do operador, e `ALMOXA_DIAGNOSTICS_TOKEN`, um token aleatório de pelo menos 32 caracteres. O papel opcional `ALMOXA_DIAGNOSTICS_ROLE` aceita `operator` (padrão) ou `reader`. A credencial é exclusiva do diagnóstico. Os mecanismos de login das telas legadas ainda não foram ligados à API.

`npm start` inicia o backend. Com SQLite, acesse `http://127.0.0.1:3000/diagnostics` com o navegador. O cliente usa a mesma origem para enviar o token e as requisições à API. O backend usa `HOST` e `PORT` quando configurados. Se o serviço for exposto fora do loopback, use HTTPS e controle o acesso à rede.

O endpoint `GET /health` verifica o banco do runtime. `GET /api/v2/diagnostics` lista com `page`, `limit` e `origin` opcionais. `GET /api/v2/diagnostics/:id` consulta um registro. `POST /api/v2/diagnostics` aceita `id`, `origin` e `message`. Repetir a mesma criação retorna o registro inicial. Reusar o ID com outro conteúdo dá conflito. `PATCH /api/v2/diagnostics/:id` aceita `message` e a `version` atual. Uma atualização concorrente ou repetida com versão desatualizada retorna conflito.

A auditoria da gravação fica na mesma transação do registro. `npm run backup:diagnostics -- CAMINHO_NOVO` usa o backup online do SQLite e falha se o destino já existir. Guarde o banco e os backups fora do repositório. O armazenamento deve sobreviver à troca de processos e versões do backend. O SQLite com WAL deve permanecer em sistema de arquivos local com suporte ao bloqueio SQLite.

Sem `ALMOXA_SQLITE_PATH`, permanece disponível o diagnóstico anterior, com `/health` baseado em Google Sheets e o comando `npm run test:google` para validar acesso direto aos dados do Google. A API SQLite fica disponível somente quando o caminho SQLite está configurado.

## Inventário do catálogo legado

O bloco inicial de `AP_ENTRADA_MODULOS` é a referência verificável para os 34 nomes. Os arquivos abaixo são evidência de código ou de registro. `Catálogo` significa que o arquivo de entrada registra o nome, sem atribuir a ele uma implementação exclusiva. As colunas de teste se referem à integração Node desta fase. A pasta `app/` também contém rotinas de teste próprias do legado que não foram executadas.

Abreviações de arquivos em `app/`: **Entrada** = `ALMOXA PRO — ENTRADA ÚNICA.js`; **Operação** = `ALMOXA PRO — MÓDULOS DE OPERAÇÃO.js`; **Fluxo** = `ALMOXA PRO — MÓDULOS DE FLUXO.js`; **Complementares** = `ALMOXA PRO — MÓDULOS COMPLEMENTARES.js`; **Cadastro** = `ALMOXA PRO — CADASTRO CENTRAL DE ITENS E FORNECEDORES.js`.

| Motor | Arquivo/evidência | Node | Depende do Google | Integração Node |
| --- | --- | --- | --- | --- |
| usuarios | ALMOXA PRO — MÓDULO USUÁRIOS E AUTENTICAÇÃO.js | Pendente | Legado | Pendente |
| auth | 09 - AUTENTICAÇÃO.js e 10 - SESSÃO.js | Sessão parcial em core/security | Login legado | Testes unitários de sessão |
| permissoes | ALMOXA-PRO — MÓDULO DE PERMISSÕES v2.js | Autorização parcial em core/security | API e perfis legados | Testes unitários e papel do diagnóstico |
| itens | Cadastro | Pendente | Legado | Pendente |
| fornecedores | Cadastro | Pendente | Legado | Pendente |
| config | 01- Cofinfig.js | Pendente | Legado | Pendente |
| estoque | Operação | Pendente | Legado | Pendente |
| reservas | Fluxo | Pendente | Legado | Pendente |
| lojinha | Operação | Pendente | Legado | Pendente |
| epi | Fluxo e ALMOXA PRO — GESTÃO DE EPI (COESA).js | Pendente | Legado | Pendente |
| ferramentas | Fluxo e ALMOXA PRO — FERRAMENTARIA.js | Pendente | Legado | Pendente |
| nf | Fluxo e NOTA FISCAIS.js | Pendente | Legado | Pendente |
| compras | Fluxo | Pendente | Legado | Pendente |
| ocorrencias | Fluxo | Pendente | Legado | Pendente |
| projetos | Fluxo | Pendente | Legado | Pendente |
| inventario | Fluxo e ALMOX-PRO · INVENTÁRIO MÓVEL POR ENDEREÇO | Pendente | Legado | Pendente |
| relatorios | Fluxo | Pendente | Legado | Pendente |
| painel | Operação e Fluxo | Pendente | Legado | Pendente |
| mural | Fluxo | Pendente | Legado | Pendente |
| aprovacoes | Fluxo | Pendente | Legado | Pendente |
| categorias | Entrada, catálogo | Pendente | Roteamento legado | Pendente |
| obras | Entrada, catálogo | Pendente | Roteamento legado | Pendente |
| ocr | ALMOXA PRO — MÓDULO DE OCR.js | Pendente | Legado | Pendente |
| manutencao | ALMOXA PRO — MANUTENÇÃO, VERSÕES E RETORNO.js | Pendente | Legado | Pendente |
| kits | Complementares | Pendente | Legado | Pendente |
| calendario | Complementares | Pendente | Legado | Pendente |
| centros | Complementares | Pendente | Legado | Pendente |
| solicitacoes | Complementares | Pendente | Legado | Pendente |
| retiradas | Complementares | Pendente | Legado | Pendente |
| saidas | Complementares | Pendente | Legado | Pendente |
| notificacoes | Complementares e 17 - NOTIFICAÇÕES.js | Pendente | Legado | Pendente |
| automacao | Complementares | Pendente | Legado | Pendente |
| auditoria | Complementares e 12 - AUDITORIA.js | Parcial no diagnóstico SQLite | Motor legado | Auditoria transacional do diagnóstico |
| biometria | ALMOXA PRO — MÓDULO DE BIOMETRIA.js | Pendente | Legado | Pendente |

O catálogo ainda lista inteligência, backup, doutor, permissões, nfmotor, loja, imagens, backupauto, documentos, localização, locais e patrimônio. A segunda entrada de permissões repete o identificador. Há implementações concorrentes de `AP_PERMISSOES_direto` nos arquivos v1/v2 e duas variantes de Entrada Única. A seleção efetiva dessas variantes no Web App continua fora da verificação Node. A suíte de inicialização carregou as importações do Core independente.

## Classificação das dependências Google

| Referência | Situação |
| --- | --- |
| `AP_DB_direto`, `SpreadsheetApp` no diagnóstico | Substituídos no caminho independente. A versão direta da Sheets API permanece para validar o Google. |
| `SpreadsheetApp`, `DriveApp` nos motores legados | Necessários enquanto os motores usarem abas, documentos e arquivos existentes. |
| `google.script.run` e URLs do Apps Script | As telas Desktop e ALMOX CAMPO ainda usam essas rotas. O diagnóstico já usa HTTP Node de mesma origem. |
| `PropertiesService` | O diagnóstico Node usa variáveis de ambiente. A configuração dos motores legados segue no Apps Script. |
| `UrlFetchApp`, `HtmlService` | Integrações e renderização do legado pendentes. As funções foram preservadas. |
| `ALMOXA PRO —  V2 API ÚNICA.js` | Marcador histórico que encaminha a leitura para o arquivo da API Única. |

O diagnóstico real usa registros isolados em SQLite. Migração dos registros operacionais e integração do login e das telas Desktop/Campo dependem da equivalência dos motores e da comprovação de acesso aos dados legados.
