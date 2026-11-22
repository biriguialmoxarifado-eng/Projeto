# Arquivados

Arquivos que saíram da pasta `app/` e, por isso, **não são mais enviados
ao Apps Script** pelo `clasp`. Ficam aqui no histórico para consulta e
para poderem voltar, se precisar.

Nada foi apagado.

---

## ALMOXA PRO — ENTRADA ÚNICA DO WEB APP.js.txt

**Saiu em:** 22/11/2026
**Motivo:** era uma segunda cópia do `ALMOXA PRO — ENTRADA ÚNICA.js`.

Os dois arquivos definiam **as mesmas 22 funções**, entre elas
`AP_ENTRADA_servir`. No Apps Script, duas funções com o mesmo nome não
convivem: a última carregada apaga a anterior, e a ordem depende da
posição dos arquivos no projeto. Ou seja, metade desse código já estava
sendo descartada — só não dava para saber qual metade.

A versão que ficou (`ALMOXA PRO — ENTRADA ÚNICA.js`, 1639 linhas) é a
mais completa: tem o CSS da faixa da empresa e do título da ficha, que
faltam nesta cópia (1561 linhas). A diferença entre as duas é de 133
linhas, quase toda em estilo visual.

**Se a tela mudar de aparência depois dessa troca**, a correção é
trazer de volta o pedaço de CSS que faltar — não o arquivo inteiro,
senão o conflito das 22 funções volta junto.
