# ALMOXA PRO — ARQUITETURA V2

## Objetivo
Evoluir o ALMOXA PRO para uma arquitetura modular, independente do limite de tamanho do Google Apps Script.

## Princípios
- Preservar integralmente o sistema legado durante a migração.
- Core central sem regras de negócio.
- Módulos independentes e versionados.
- Banco de dados centralizado.
- API única para todas as interfaces.
- Segurança, autenticação e auditoria centralizadas.
- Testes reais antes de liberar cada módulo.

## Estrutura planejada

- core: autenticação, sessões, permissões e comunicação.
- database: persistência e acesso aos dados.
- api: comunicação entre backend e interfaces.
- modules: motores independentes.
- integrations: Google Apps Script, Protheus e serviços externos.
- frontend/almoxa-campo: interface mobile.
- frontend/almoxa-3d: interface de gestão 3D.
- tests: testes unitários e de integração.
- docs: documentação técnica e migração.

## Ordem de construção

1. Inventário do sistema atual.
2. Segurança e proteção de segredos.
3. Core V2.
4. Data Layer V2.
5. Módulos Operação e Fluxo.
6. Inventário e Auditoria.
7. Integração das interfaces.
8. Migração gradual do legado.

## Regra de segurança

Nenhum motor antigo será removido até que sua substituição esteja implementada, testada e validada.
