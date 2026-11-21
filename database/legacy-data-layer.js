
{
  "name": "almoxa-pro-v2",
  "version": "2.1.0",
  "description": "ALMOXA PRO V2 - Arquitetura modular",
  "main": "core/index.js",
  "scripts": {
    "test": "node tests/core.test.js && node tests/session-manager.test.js && node tests/authorization-manager.test.js && node tests/database.test.js"
  },
  "keywords": [
    "almoxa-pro",
    "logistica",
    "almoxarifado"
  ],
  "license": "ISC",
  "type": "commonjs",
  "devDependencies": {
    "@google/clasp": "^3.4.1",
    "@types/google-apps-script": "^2.0.13"
  }
}
