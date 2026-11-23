# ALMOXA PRO 433

A branch parte do `main` em `1d713ca`. Mantém o frontend 431 no GitHub Pages e a Parte 11 em `app/11 - PERMISSOES.js`. O HTML principal publicado respondeu HTTP 200 e correspondeu ao conteúdo de `index.html` do commit-base após normalização das quebras de linha.

## Core

- `doGet` atende status da API, LinkFlow, crachá, biometria, aprovação, mapa e QR de patrimônio. A entrada oficial tenta o HTML local e oferece o link para o Pages quando esse HTML está ausente.
- `doPost` entrega envelopes `ponte: ALMOXA` ao mesmo processamento usado por `almoxaApiWeb` e preserva o formato legado `bio_*`. A rotina da ponte antiga continua disponível no código. `APIX_atender_` recebe o objeto já validado, resolve a identidade pela sessão e aplica os encaminhamentos específicos. `almoxaApi` recebe o JSON de módulo, ação, payload e sessão e mantém o despacho e as permissões da ponte do Core. O módulo 3D passou a usar uma função pública de RPC do Apps Script com o mesmo contrato HTTP.
- A cópia de `ENTRADA ÚNICA DO WEB APP.js` tinha as mesmas 22 funções da versão ativa. O arquivo arquivado é idêntico à cópia retirada de `app/`. As demais colisões, incluindo variantes de permissões com contratos diferentes, continuam no relatório do teste.
- `AP_Core_withLock` compartilha uma trava do script com as atualizações do Data Layer e a reutiliza nas chamadas aninhadas da mesma execução. A operação externa libera a trava após o flush, inclusive em falhas. `AP_Core_boot` verifica dependências e resolve a mesma planilha configurada pelo Core.
- O manifesto do Campo abre o caminho já publicado. O service worker guarda a página e os recursos estáticos listados explicitamente, sempre tenta a rede primeiro e oferece a cópia offline quando a rede falha.

## Homologação

O fluxo existente em `.github/workflows/apps-script-sync.yml` é manual. Usa `CLASPRC_JSON`, sincroniza `app/` com `clasp push --force` e publica no ID fixo da implantação existente. O push do Git atualiza apenas o repositório. A rotina atual serve à produção. A disponibilidade do segredo e as credenciais Google permanecem sem validação neste ambiente.

Para homologar, use um projeto Apps Script separado, uma conta com permissão de edição nele, um deployment separado e dados de teste autorizados. Revise `SPREADSHEET_ID` e os módulos legados que abrem IDs embutidos antes de executar o código. Restrinja o acesso desse projeto, especialmente à central de biometria e suas ações legadas. O responsável pelo Google deve fornecer o destino ou conceder acesso de edição a ele.

1. Faça `npm ci` e `npm test` numa cópia descartável da branch. Confirme o conjunto de arquivos com `npx clasp status`.
2. Configure o `.clasp.json` dessa cópia com o ID de homologação e `rootDir: app`. Use a implantação de homologação e confirme o ID antes da sincronização. Mantenha a configuração oficial do repositório.
3. Compare o inventário de arquivos e propriedades do projeto de destino com o conteúdo do Git antes de sincronizar. O push do clasp substitui o código do destino. Use o projeto isolado para testar a nova revisão e servir o endpoint de homologação.
4. Com o HTML da branch apontado ao endpoint isolado, valide login, sessão expirada e perfis, fotos de cadastro e produtos, assinaturas, loja e carrinho, estoque e movimentações, notas, inventários e relatórios, ferramentaria e cautelas, Campo online/offline, mapa 3D, crachá, QR e biometria. Para estoque, transferências e D-1, confira duas operações simultâneas, repetição da mesma solicitação e o estado persistido após falha. Confirme também as permissões efetivas dos handlers que têm versões concorrentes.
5. Depois do aceite de homologação e da autorização de produção, publique Pages e Apps Script em conjunto. Registre o commit, a versão implantada no Apps Script e a revisão anterior para reversão.

## Arquitetura da versão 460

Monólito modular em Node.js com TypeScript, gateway de API e PostgreSQL. Migração gradual por módulo, com Google Apps Script como integração legada temporária. O mapa 3D carrega suas dependências apenas quando aberto. A biometria fica isolada, com acesso e dados protegidos. Operações de estoque e transferências migram para transações e travas no PostgreSQL.
