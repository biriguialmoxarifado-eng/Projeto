# Fase 4 — Desktop conectado ao Core V2

A Fase 4 parte do `index.html` existente e do [marco técnico da Fase 3](FASE_3_ESTOQUE.md#marco-de-encerramento-técnico-da-fase-3). A primeira integração usa o serviço Node e o armazenamento SQLite que já existem no repositório. A planilha operacional e o fluxo publicado de Notas Fiscais continuam nos modos anteriores.

## Abrir o Desktop local

Use Node 24 e um arquivo SQLite exclusivo deste ambiente. Configure o processo com as opções abaixo e execute `npm start`. O Desktop abre em `http://127.0.0.1:3000/` com a tela de entrada existente.

| Opção | Valor |
| --- | --- |
| `HOST` e `PORT` | `127.0.0.1` e `3000` |
| `ALMOXA_SQLITE_PATH` | Caminho do arquivo SQLite reservado para o Desktop local |
| `ALMOXA_PREVIEW_SQLITE` | `1` |
| `ALMOXA_DESKTOP_LOCAL` | Código fixo de local de estoque, por exemplo `A` |
| `ALMOXA_PREVIEW_WRITE` | `1` para liberar gravação ao operador |
| `ALMOXA_DIAGNOSTICS_ACTOR` | Identidade digitada na tela de entrada |
| `ALMOXA_DIAGNOSTICS_TOKEN` | Credencial privada com pelo menos 32 caracteres sem espaços |
| `ALMOXA_DIAGNOSTICS_ROLE` | `operator` para teste de escrita e `reader` para conferir restrições |

Deixe `ALMOXA_PREVIEW_SHEET_ID`, `ALMOXA_PREVIEW_ORIGIN` e `ALMOXA_OPERATIONAL_READ` desativadas nessa configuração. O servidor atribui o local à sessão e limita as consultas e gravações de estoque e o histórico de EPI a esse local. A credencial abre uma sessão opaca em memória. Após recarregar, entre novamente para reler os registros do SQLite. O cadastro de colaboradores abastece a identificação do EPI. A criação de credenciais individuais e de permissões por obra permanece como trabalho operacional da Fase 4.

## Telas e contratos

| Tela | Motor Core V2 | Comportamento |
| --- | --- | --- |
| Entrada | Sessão e autorização | Credencial validada pelo Node. Sessão descartável e logout no servidor. |
| Usuários e perfis | Usuários | Listagem, cadastro e edição de nome, cargo e setor. Matrícula com zeros preservada, duplicidade bloqueada e versão exigida para edição. |
| Estoque Geral | Catálogo e Estoque | Cadastro de item com SKU `SYN-` neste ambiente, saldo no local da sessão e ajuste versionado. |
| Movimentações | Estoque | Entrada, saída e listagem do histórico gravado pelo Core. |
| Fichas de EPI | EPI e Estoque | Entrega a colaborador cadastrado, devolução integral e histórico com autoria. Cada operação registra a ficha e o efeito no saldo no mesmo evento. |

## Evidência no Edge

O ensaio abriu o `index.html` servido pelo Node, recusou uma credencial inválida e efetuou a entrada pelo formulário. Cadastrou e editou um colaborador, cadastrou um material e registrou entrada de cinco unidades. A entrega de duas reduziu o saldo a três. Após recarregar, a ficha continuou disponível e a devolução integral restituiu as duas unidades. Uma saída manual e um ajuste deixaram o saldo final em seis. Depois de nova recarga e autenticação, a tela apresentou a edição do colaborador, as duas linhas de EPI, o saldo seis e as cinco movimentações. Também exibiu uma nota de teste pela lista fiscal existente no Desktop.

O teste HTTP confirmou a revogação da sessão no logout, a rejeição de local divergente, a restrição de escrita e a releitura de um cadastro e de seu saldo após reiniciar o Node. Para o modo Desktop local, `#/nf` usa a lista fiscal existente conectada ao Core. A rota publicada continua com a integração externa que já utilizava.

As gravações locais usam o identificador da operação e o controle de versão do Core. O navegador envia os formulários da Fase 4 pelo transporte Node da própria sessão. A validação por crachá, biometria e assinatura segue pendente antes da ativação operacional destes formulários. Também faltam perfis individuais, alçadas por obra, paridade dos registros legados e execução com base operacional autorizada. A matriz permanece em 0 homologados, 33 parciais e 1 bloqueado.

Para repetir o teste pelo navegador, defina `ALMOXA_TEST_BROWSER` com o caminho do executável do Edge ou Chromium e execute `node --test --test-name-pattern "Desktop no navegador" tests/sqlite-diagnostics.test.js`. O teste cria um perfil de navegador e um SQLite temporários.
