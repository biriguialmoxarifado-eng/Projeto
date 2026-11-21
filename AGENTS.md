# ALMOXA PRO — regras permanentes do projeto

## Repositório único

O repositório canônico do projeto almox-pro é https://github.com/biriguialmoxarifado-eng/Projeto. Antes de editar, confirme a raiz Git, a URL do remoto, a branch de trabalho, o estado da árvore e a revisão remota. Abra a raiz do checkout correto no VS Code. Preserve o histórico e as alterações locais quando precisar ajustar a integração.

Mantenha no mesmo repositório, na estrutura existente, o ALMOXA PRO Desktop, o ALMOX CAMPO para celular e tablet, o Core Node.js, o backend, as APIs, o banco, as migrações, os motores operacionais, o mapa 3D, a autenticação, a biometria, a ferramentaria, o estoque, os inventários, as notas fiscais, os relatórios, os dashboards e as integrações e extensões. Integre novos módulos à arquitetura existente. Evite pastas duplicadas e projetos independentes.

Desktop e Campo devem consumir o mesmo Core e as mesmas APIs, com interfaces e permissões adequadas a cada ambiente. Aplique as regras de negócio compartilhadas aos dois clientes quando pertinente. Reutilize motores e armazenamento quando atendam aos requisitos.

## Trabalho e sincronização

1. Use o VS Code e o Codex para alterar os arquivos do checkout canônico e salvar as mudanças.
2. Preserve funcionalidades, alterações não publicadas e versões recentes. Compare diferenças antes de integrar e mantenha um ponto de recuperação.
3. Execute os testes correspondentes com dados isolados. Registre as alterações verificadas em commits identificáveis.
4. Envie os commits ao repositório e à branch corretos. Compare o SHA local com o SHA anunciado pelo remoto e registre caminho, URL, branch, SHAs e resultado dos testes.
5. Trate a publicação como etapa controlada, com testes e possibilidade de reversão. Salvar localmente não equivale a sincronizar, e sincronizar uma branch de desenvolvimento é uma operação distinta da publicação em produção.

Mantenha backups, histórico e rastreabilidade. Guarde bancos operacionais, backups com dados reais, credenciais, senhas e informações pessoais fora do Git. Revise os arquivos incluídos antes de cada commit e push. Valide a migração e a equivalência funcional antes de desativar qualquer armazenamento legado.
