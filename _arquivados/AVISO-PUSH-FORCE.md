# Atenção antes de rodar o workflow de sincronização

O workflow `apps-script-sync.yml` termina com:

```
npx clasp push --force
```

O `--force` não acrescenta: ele **espelha**. Tudo que está em `app/` vai
para o Apps Script, e **tudo que está no Apps Script e não está em `app/`
é apagado**.

## Por que isso importa agora

Até 22/11/2026 o frontend do sistema (`index.html`, 5,3 MB) estava na raiz
do repositório, fora de `app/`. O `clasp` nunca o enviou. Se existir hoje,
no Apps Script, um arquivo de tela que não esteja em `app/`, o primeiro
`push --force` o apaga.

## O que fazer antes do primeiro sync

1. No editor do Apps Script, veja a lista de arquivos.
2. Qualquer arquivo que esteja lá e **não** esteja em `app/` deve ser
   copiado para `app/` antes do push — ou será perdido.
3. Com dúvida, rode `npx clasp pull` numa pasta vazia primeiro: ele traz
   o que está publicado hoje, e aí dá para comparar sem arriscar nada.

## Alternativa mais segura

Trocar `--force` por um push normal enquanto o repositório e o Apps Script
não estiverem iguais. O push comum falha quando há divergência, em vez de
apagar em silêncio.
