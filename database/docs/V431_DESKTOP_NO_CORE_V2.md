# V431 — o Desktop falando com o Core V2

A V430 roda assim:

```
GitHub Pages  ──POST──►  Apps Script /exec  ──►  Planilha
  (index.html)              (o Core antigo)
```

A V431 roda assim:

```
Core V2 em Node  ──serve──►  Desktop  ──POST──►  /api/v2/preview/dispatch
  127.0.0.1:3000                                        │
                                                        ▼
                                              SQLite  ou  Sheets
```

O Apps Script sai do caminho. Nada mais passa por `script.google.com`.

---

## Isso já existe

Nada precisa ser construído para experimentar. O que faz a ligação já
está no repositório:

| Peça | Onde | O que faz |
|---|---|---|
| `backend/preview-api.js` | rota `/homologacao/desktop` | serve o `index.html` |
| `backend/preview-client.js` | injetado na página | desvia as chamadas para o Core V2 |
| `/api/v2/preview/dispatch` | backend | recebe `{modulo, acao, payload}` |

O cliente cobre **34 módulos**: nf, nfed, compras, estoque, itens,
fornecedores, categorias, obras, usuarios, config, auditoria,
ocorrencias, notificacoes, kits, calendario, centros, projetos,
relatorios, mural, painel, dashboard, automacao, ferramentas, epi,
manutencao, aprovacoes, retiradas, biometria, ocr, lojinha, inventario.

---

## Como subir

### 1. Configurar

```
copy .env.example .env
```

Preencha no `.env`:

```
ALMOXA_SQLITE_PATH=C:\ALMOXA\dados\almoxa.db
ALMOXA_DIAGNOSTICS_TOKEN=<32 caracteres ou mais, sem espaço>
ALMOXA_DIAGNOSTICS_ACTOR=seu.nome
ALMOXA_DIAGNOSTICS_ROLE=operator
ALMOXA_PREVIEW_SHEET_ID=<id da planilha de TESTE>
HOST=127.0.0.1
PORT=3000
```

`ALMOXA_PREVIEW_SHEET_ID` precisa ser uma planilha **de teste**, nunca a
de produção. É dela que a homologação lê.

A primeira vez pede a credencial do Google:

```
npm run auth:google
```

### 2. Subir

```
npm run start:local
```

### 3. Abrir

```
http://127.0.0.1:3000/homologacao/desktop
```

O ALMOX CAMPO fica em `/homologacao/campo`.

---

## O que esperar

A página é a mesma de sempre — mesmo visual, mesmo menu. A diferença
está em quem responde: as chamadas vão para `127.0.0.1:3000`, não para
`script.google.com`.

Para conferir, abra o console do navegador (F12 → Rede) e veja o destino
dos pedidos.

**Por padrão a homologação é só leitura.** Para liberar escrita:

```
ALMOXA_PREVIEW_WRITE=1
```

Faça isso apenas com a planilha de teste configurada. O servidor recusa
subir com escrita liberada fora de `127.0.0.1`.

---

## Apontar o Desktop publicado para outro Core

O `index.html` lê o parâmetro `core` do endereço antes de usar o valor
fixo em `ALMOXA_CONFIG.API_URL`:

```js
PONTE.url = (par("core") || ALMOXA_CONFIG.API_URL || guardado(...)).trim();
```

Então dá para testar sem reimplantar nada:

```
almoxarifado-eng.github.io/Projeto/#/dashboard?core=http://127.0.0.1:3000
```

Com a ressalva de que o navegador bloqueia uma página `https` chamando
`http` local. Enquanto o Core V2 não tiver certificado, servir o Desktop
pelo próprio Core (`/homologacao/desktop`) evita esse problema.

---

## Quando a V431 substitui a V430 de vez

Trocar a linha 1844 do `index.html`:

```js
API_URL: "https://script.google.com/macros/s/.../exec",
```

pelo endereço do Core V2. A partir daí o Desktop publicado no GitHub
Pages não fala mais com o Apps Script.

Antes disso, confira na tabela da FASE_3 quais motores ainda estão
PARCIAL: o que não tiver paridade vai parar de funcionar na troca.
