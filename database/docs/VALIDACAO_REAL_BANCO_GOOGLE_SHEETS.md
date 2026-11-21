
# ALMOXA PRO V2 — VALIDAÇÃO REAL DO GOOGLE SHEETS

## Objetivo
Confirmar comunicação real entre o backend V2 e a planilha Google utilizada pelo ALMOXA PRO.

## Segurança
- Não alterar dados de produção.
- Não gravar nas abas operacionais.
- Utilizar exclusivamente a aba ALMOXA_TESTE_CONEXAO.
- Exigir sessão autenticada e chave da API.
- Não registrar tokens ou chaves nos logs.

## Etapas
1. Confirmar conexão com a API ÚNICA.
2. Consultar a planilha configurada no Apps Script.
3. Criar ou reutilizar a aba ALMOXA_TESTE_CONEXAO.
4. Gravar um registro de teste identificado por UUID.
5. Ler novamente o registro pelo UUID.
6. Comparar os dados enviados com os dados recebidos.
7. Registrar o resultado do teste.

## Critério de aprovação
A conexão só será considerada validada quando:
- A API responder corretamente.
- A planilha configurada for identificada.
- A gravação retornar confirmação.
- A leitura posterior localizar o mesmo UUID.
- Os dados forem equivalentes.

## Limite desta validação
O teste confirma a comunicação com Google Sheets. Não significa que todos os motores do ALMOXA PRO já estejam integrados.
