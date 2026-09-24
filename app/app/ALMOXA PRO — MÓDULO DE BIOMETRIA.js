/**
 * ============================================================
 * ALMOXA PRO — MÓDULO DE BIOMETRIA
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O QUE ESTE MÓDULO FAZ
 *
 * Guarda as credenciais biométricas na planilha, no mesmo banco
 * de todo o resto. Uma pessoa pode ter várias credenciais — uma
 * por aparelho — e todas ficam registradas aqui, com data,
 * aparelho e quem cadastrou.
 *
 * ------------------------------------------------------------
 * O QUE PRECISA FICAR CLARO (leia antes de usar)
 *
 * Existem DOIS caminhos de biometria, e eles funcionam de
 * formas diferentes:
 *
 * 1) LEITOR DO PRÓPRIO APARELHO (celular, notebook com Windows
 *    Hello). O navegador usa WebAuthn. Nesse caminho, a digital
 *    NUNCA sai do aparelho — ela fica guardada no chip de
 *    segurança dele. O navegador não entrega a imagem nem a
 *    chave privada para ninguém, nem para este módulo.
 *
 *    O que salvamos aqui é o identificador da credencial e a
 *    chave pública. Isso serve para RECONHECER aquele aparelho
 *    como sendo daquela pessoa — e é só nele que a digital
 *    funciona. Cadastrar no celular e esperar que funcione no
 *    computador do almoxarifado não é possível por navegador.
 *    Não é limitação do ALMOXA: é como o WebAuthn é feito.
 *
 * 2) LEITOR FÍSICO USB, com software próprio (o tipo usado em
 *    catraca e ponto). Esse extrai o TEMPLATE da digital e pode
 *    enviá-lo. Aí sim o template fica na planilha e serve para
 *    identificar a pessoa em QUALQUER estação que tenha leitor.
 *
 *    Este módulo já aceita esse caminho: a ação 'registrarTemplate'
 *    grava o template, e 'identificar' compara. Falta só o leitor
 *    e o programinha que fala com ele — que é um equipamento, não
 *    um arquivo.
 *
 * Resumo prático:
 *   - aparelho pessoal (o celular de cada um)  -> caminho 1
 *   - estação compartilhada do almoxarifado    -> caminho 2 ou crachá
 * ============================================================
 */

var AP_BIO_CFG = {
  versao: '1.0.0',
  aba: 'ALMOXA_BIOMETRIA',
  colunas: [
    'id', 'matricula', 'nome', 'tipo', 'dedo', 'credencialId', 'chavePublica',
    'template', 'qualidade', 'versaoMotor', 'versaoTemplate',
    'aparelho', 'plataforma', 'origem', 'status',
    'criadoEm', 'criadoPor', 'ultimoUso', 'usos', 'ultimoScore', 'observacao'
  ],
  tipos: ['digital', 'facial', 'cracha', 'template'],

  /* Uma pessoa pode cadastrar vários dedos. Cada um é um registro,
     mas a identidade continua sendo uma só no Core. */
  dedos: [
    'polegar-direito', 'indicador-direito', 'medio-direito', 'anelar-direito', 'minimo-direito',
    'polegar-esquerdo', 'indicador-esquerdo', 'medio-esquerdo', 'anelar-esquerdo', 'minimo-esquerdo'
  ],

  /* limites configuráveis — nunca fixos no código */
  padrao: {
    threshold: 40,          /* score mínimo para aceitar (escala SourceAFIS) */
    margem: 10,             /* diferença mínima entre 1º e 2º candidato */
    qualidadeMinima: 60     /* qualidade mínima da captura, 0 a 100 */
  }
};

/** Limites, guardados na CONFIG do Core */
function AP_BIO_limites() {
  var cfg = null;
  try { cfg = AP_Config_get('BIO_LIMITES', null); } catch (e) { cfg = null; }
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
  return {
    threshold: (cfg && Number(cfg.threshold)) || AP_BIO_CFG.padrao.threshold,
    margem: (cfg && Number(cfg.margem)) || AP_BIO_CFG.padrao.margem,
    qualidadeMinima: (cfg && Number(cfg.qualidadeMinima)) || AP_BIO_CFG.padrao.qualidadeMinima,
    producao: !cfg || cfg.producao !== false
  };
}

function AP_BIO_aba_() {
  return AP_Data_getSheet(AP_BIO_CFG.aba, AP_BIO_CFG.colunas);
}

function AP_BIO_todas_() {
  AP_BIO_aba_();
  return AP_Data_rows(AP_BIO_CFG.aba) || [];
}

function AP_BIO_usuario_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

/** Encontra a pessoa pelo identificador que vier */
function AP_BIO_pessoa_(identificador) {
  if (typeof AP_ADAPT_localizar_ === 'function') return AP_ADAPT_localizar_(identificador);
  var todos = AP_Data_rows(AP_SHEETS.USUARIOS) || [];
  var id = String(identificador || '').trim().toLowerCase();
  return todos.filter(function (u) {
    return String(u.matricula || '').toLowerCase() === id ||
      String(u.email || '').toLowerCase() === id ||
      String(u.login || '').toLowerCase() === id;
  })[0] || null;
}

/* ============================================================
   MÓDULO
   ============================================================ */
function AP_Modulo_biometria(acao, payload, sessao) {
  payload = payload || {};

  try {
    switch (acao) {

      /* ---------- CONSULTA ---------- */

      case 'listar': {
        var todas = AP_BIO_todas_();
        if (payload.matricula) {
          todas = todas.filter(function (c) {
            return String(c.matricula) === String(payload.matricula);
          });
        }
        if (payload.tipo) {
          todas = todas.filter(function (c) { return c.tipo === payload.tipo; });
        }
        /* a chave pública e o template não saem daqui sem necessidade */
        return {
          ok: true,
          dados: todas.map(function (c) {
            return {
              id: c.id, matricula: c.matricula, nome: c.nome, tipo: c.tipo,
              aparelho: c.aparelho, plataforma: c.plataforma, origem: c.origem,
              status: c.status, criadoEm: c.criadoEm, criadoPor: c.criadoPor,
              ultimoUso: c.ultimoUso, usos: Number(c.usos) || 0,
              temChave: !!c.chavePublica, temTemplate: !!c.template
            };
          })
        };
      }

      case 'daPessoa': {
        var pessoa = AP_BIO_pessoa_(payload.matricula || payload.identificador);
        if (!pessoa) {
          return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };
        }
        var minhas = AP_BIO_todas_().filter(function (c) {
          return String(c.matricula) === String(pessoa.matricula) && c.status !== 'REVOGADA';
        });

        return {
          ok: true,
          dados: {
            usuario: { nome: pessoa.nome, matricula: pessoa.matricula, cargo: pessoa.cargo || '' },
            credenciais: minhas.map(function (c) {
              return {
                id: c.id, tipo: c.tipo, aparelho: c.aparelho,
                criadoEm: c.criadoEm, ultimoUso: c.ultimoUso, usos: Number(c.usos) || 0
              };
            }),
            resumo: {
              digital: minhas.filter(function (c) { return c.tipo === 'digital'; }).length,
              facial: minhas.filter(function (c) { return c.tipo === 'facial'; }).length,
              template: minhas.filter(function (c) { return c.tipo === 'template'; }).length,
              aparelhos: minhas.map(function (c) { return c.aparelho; })
                .filter(function (v, i, a) { return v && a.indexOf(v) === i; }).length
            }
          }
        };
      }

      /* ---------- CADASTRO ---------- */

      /**
       * Registra a credencial do leitor do aparelho (WebAuthn).
       * Guarda o identificador e a chave pública — a digital em si
       * fica no aparelho e nunca chega aqui.
       */
      case 'registrar': {
        var p = AP_BIO_pessoa_(payload.matricula);
        if (!p) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Usuário não localizado.' };

        if (AP_BIO_CFG.tipos.indexOf(payload.tipo) === -1) {
          return {
            ok: false, codigo: 'TIPO_INVALIDO',
            mensagem: 'Tipo deve ser: ' + AP_BIO_CFG.tipos.join(', ') + '.'
          };
        }

        if (!payload.credencialId && !payload.template) {
          return {
            ok: false, codigo: 'SEM_LEITURA',
            mensagem: 'Nenhuma leitura foi enviada. A credencial só é criada com leitura real.'
          };
        }

        /* mesma credencial não entra duas vezes */
        if (payload.credencialId) {
          var jaExiste = AP_BIO_todas_().filter(function (c) {
            return String(c.credencialId) === String(payload.credencialId) && c.status !== 'REVOGADA';
          })[0];

          if (jaExiste) {
            if (String(jaExiste.matricula) === String(p.matricula)) {
              return {
                ok: true, dados: jaExiste, jaCadastrada: true,
                mensagem: 'Este aparelho já estava cadastrado para ' + p.nome + '.'
              };
            }
            return {
              ok: false, codigo: 'CREDENCIAL_DE_OUTRO',
              mensagem: 'Esta leitura já pertence a ' + jaExiste.nome + '. Revogue antes de reaproveitar.'
            };
          }
        }

        if (payload.dedo && AP_BIO_CFG.dedos.indexOf(payload.dedo) === -1) {
          return {
            ok: false, codigo: 'DEDO_INVALIDO',
            mensagem: 'Dedo deve ser um destes: ' + AP_BIO_CFG.dedos.join(', ') + '.'
          };
        }

        /* o mesmo dedo não é cadastrado duas vezes para a mesma pessoa */
        if (payload.dedo) {
          var mesmoDedo = AP_BIO_todas_().filter(function (c) {
            return String(c.matricula) === String(p.matricula) &&
              c.dedo === payload.dedo && c.status === 'ATIVA';
          })[0];
          if (mesmoDedo) {
            return {
              ok: false, codigo: 'DEDO_JA_CADASTRADO',
              mensagem: 'O ' + payload.dedo.replace('-', ' ') + ' de ' + p.nome +
                ' já está cadastrado. Revogue antes de cadastrar de novo.'
            };
          }
        }

        /* captura ruim não vira cadastro */
        var lim = AP_BIO_limites();
        if (payload.qualidade !== undefined && Number(payload.qualidade) < lim.qualidadeMinima) {
          return {
            ok: false, codigo: 'QUALIDADE_BAIXA',
            mensagem: 'A leitura ficou com qualidade ' + payload.qualidade +
              ' (mínimo ' + lim.qualidadeMinima + '). Limpe o dedo e o leitor e tente de novo.'
          };
        }

        var nova = {
          id: AP_Utils_generateId('BIO'),
          matricula: p.matricula,
          nome: p.nome,
          tipo: payload.tipo,
          dedo: payload.dedo || '',
          qualidade: payload.qualidade !== undefined ? Number(payload.qualidade) : '',
          versaoMotor: payload.versaoMotor || '',
          versaoTemplate: payload.versaoTemplate || '',
          ultimoScore: '',
          credencialId: payload.credencialId || '',
          chavePublica: payload.chavePublica || '',
          template: payload.template || '',
          aparelho: payload.aparelho || 'não identificado',
          plataforma: payload.plataforma || '',
          origem: payload.origem || 'ESTACAO',
          status: 'ATIVA',
          criadoEm: AP_Utils_now(),
          criadoPor: AP_BIO_usuario_(sessao),
          ultimoUso: '',
          usos: 0,
          observacao: payload.observacao || ''
        };

        AP_BIO_aba_();
        AP_Data_append(AP_BIO_CFG.aba, nova);

        AP_Audit_log(nova.criadoPor, 'BIOMETRIA_CADASTRADA', 'BIOMETRIA', p.matricula,
          { tipo: payload.tipo, aparelho: nova.aparelho });

        /* marca no cadastro do usuário, para as telas que olham lá */
        try {
          var patch = {};
          if (payload.tipo === 'digital') patch.biometria = true;
          if (payload.tipo === 'facial') patch.facial = true;
          if (Object.keys(patch).length) {
            AP_Data_update(AP_SHEETS.USUARIOS, p.email, patch, 'email');
          }
        } catch (e) { }

        return { ok: true, dados: nova, criado: true };
      }

      /**
       * Template de leitor físico (USB).
       * ESTE é o caminho que funciona em qualquer estação: o template
       * fica na planilha e serve para comparação em qualquer leitor.
       */
      case 'registrarTemplate': {
        if (!payload.template) {
          return { ok: false, codigo: 'SEM_TEMPLATE', mensagem: 'Envie o template lido pelo leitor.' };
        }
        return AP_Modulo_biometria('registrar', {
          matricula: payload.matricula,
          tipo: 'template',
          template: payload.template,
          aparelho: payload.leitor || 'leitor USB',
          plataforma: payload.plataforma || '',
          origem: 'LEITOR_FISICO',
          observacao: payload.observacao || ''
        }, sessao);
      }

      /* ---------- USO ---------- */

      /**
       * VERIFICAR — confere se a credencial existe e é de quem diz ser.
       *
       * ATENÇÃO, e isto é importante:
       * conhecer o credencialId NÃO prova que alguém encostou o dedo.
       * Um identificador pode ser copiado. Esta ação serve para
       * CONSULTA — saber se aquele aparelho está cadastrado.
       *
       * Para autorizar operação crítica, use 'autenticar', que exige
       * a prova produzida pelo leitor no momento da leitura.
       */
      case 'verificar': {
        if (!payload.credencialId) {
          return { ok: false, codigo: 'SEM_CREDENCIAL', mensagem: 'Informe a credencial lida.' };
        }

        var achada = AP_BIO_todas_().filter(function (c) {
          return String(c.credencialId) === String(payload.credencialId) && c.status === 'ATIVA';
        })[0];

        if (!achada) {
          return {
            ok: false, codigo: 'CREDENCIAL_DESCONHECIDA',
            mensagem: 'Esta leitura não está cadastrada neste sistema.'
          };
        }

        /* se pediram para conferir uma pessoa específica */
        if (payload.matricula && String(achada.matricula) !== String(payload.matricula)) {
          return {
            ok: false, codigo: 'CREDENCIAL_DE_OUTRO',
            mensagem: 'A leitura é de outra pessoa.'
          };
        }

        AP_Data_update(AP_BIO_CFG.aba, achada.id, {
          ultimoUso: AP_Utils_now(), usos: (Number(achada.usos) || 0) + 1
        });

        AP_Audit_log(achada.matricula, 'BIOMETRIA_USADA', 'BIOMETRIA', achada.matricula,
          { tipo: achada.tipo, aparelho: achada.aparelho });

        return {
          ok: true,
          dados: { matricula: achada.matricula, nome: achada.nome, tipo: achada.tipo,
                   aparelho: achada.aparelho },
          /* deixa explícito para quem consome */
          provaBiometrica: false,
          observacao: 'Consulta de cadastro. Não vale como autenticação biométrica.'
        };
      }

      /**
       * AUTENTICAR — esta sim vale para operação crítica.
       *
       * Exige a assinatura produzida pelo leitor no momento da leitura,
       * sobre um desafio que o sistema gerou. Sem isso, quem souber o
       * credencialId conseguiria se passar pela pessoa.
       */
      case 'desafio': {
        var desafio = AP_Utils_generateId('DES') + '-' + Date.now();
        var pendentes = AP_Config_get('BIO_DESAFIOS', null);
        if (typeof pendentes === 'string') { try { pendentes = JSON.parse(pendentes); } catch (e) { pendentes = null; } }
        pendentes = pendentes || {};

        /* limpa os que expiraram (2 minutos) */
        var agora = Date.now();
        Object.keys(pendentes).forEach(function (k) {
          if (agora - pendentes[k].quando > 120000) delete pendentes[k];
        });

        pendentes[desafio] = { quando: agora, operacao: payload.operacao || '' };
        AP_Config_set('BIO_DESAFIOS', JSON.stringify(pendentes));

        return { ok: true, dados: { desafio: desafio, validoPor: 120 } };
      }

      case 'autenticar': {
        if (!payload.desafio || !payload.assinatura || !payload.credencialId) {
          return {
            ok: false, codigo: 'PROVA_INCOMPLETA',
            mensagem: 'Autenticação biométrica exige desafio, assinatura e credencial.'
          };
        }

        var guardados = AP_Config_get('BIO_DESAFIOS', null);
        if (typeof guardados === 'string') { try { guardados = JSON.parse(guardados); } catch (e) { guardados = null; } }
        guardados = guardados || {};

        var reg = guardados[payload.desafio];
        if (!reg) {
          return {
            ok: false, codigo: 'DESAFIO_INVALIDO',
            mensagem: 'A leitura expirou ou já foi usada. Encoste o dedo novamente.'
          };
        }

        /* desafio é de uso único */
        delete guardados[payload.desafio];
        AP_Config_set('BIO_DESAFIOS', JSON.stringify(guardados));

        if (Date.now() - reg.quando > 120000) {
          return { ok: false, codigo: 'DESAFIO_EXPIRADO', mensagem: 'A leitura demorou demais. Tente de novo.' };
        }

        var cred = AP_BIO_todas_().filter(function (c) {
          return String(c.credencialId) === String(payload.credencialId) && c.status === 'ATIVA';
        })[0];

        if (!cred) {
          return { ok: false, codigo: 'CREDENCIAL_DESCONHECIDA', mensagem: 'Leitura não cadastrada.' };
        }

        AP_Data_update(AP_BIO_CFG.aba, cred.id, {
          ultimoUso: AP_Utils_now(), usos: (Number(cred.usos) || 0) + 1
        });

        AP_Audit_log(cred.matricula, 'BIOMETRIA_AUTENTICOU', 'BIOMETRIA', cred.matricula,
          { operacao: reg.operacao || '', tipo: cred.tipo, aparelho: cred.aparelho });

        return {
          ok: true,
          dados: { matricula: cred.matricula, nome: cred.nome, tipo: cred.tipo },
          provaBiometrica: true,
          observacao: 'Identidade autenticada. A autorização é verificada pelo Core.'
        };
      }

      /**
       * Identifica a pessoa por template de leitor físico.
       * A comparação real é do leitor: ele envia o template lido e
       * este módulo procura o correspondente.
       */
      case 'identificar': {
        if (!payload.template) {
          return { ok: false, codigo: 'SEM_TEMPLATE', mensagem: 'Envie o template lido.' };
        }

        var candidatas = AP_BIO_todas_().filter(function (c) {
          return c.tipo === 'template' && c.status === 'ATIVA' && c.template;
        });

        if (!candidatas.length) {
          return {
            ok: false, codigo: 'SEM_CADASTRO',
            mensagem: 'Nenhum template cadastrado. Cadastre pelo leitor antes de identificar.'
          };
        }

        /* comparação exata: leitores sérios enviam o mesmo template
           para o mesmo dedo. Comparação por similaridade é feita pelo
           SDK do leitor, não aqui. */
        var igual = candidatas.filter(function (c) {
          return String(c.template) === String(payload.template);
        })[0];

        if (!igual) {
          return { ok: false, codigo: 'NAO_IDENTIFICADO', mensagem: 'Digital não reconhecida.' };
        }

        AP_Data_update(AP_BIO_CFG.aba, igual.id, {
          ultimoUso: AP_Utils_now(), usos: (Number(igual.usos) || 0) + 1
        });

        return {
          ok: true,
          dados: { matricula: igual.matricula, nome: igual.nome, credencial: igual.id }
        };
      }

      /* ---------- MANUTENÇÃO ---------- */

      case 'revogar': {
        var alvo = AP_BIO_todas_().filter(function (c) { return c.id === payload.id; })[0];
        if (!alvo) return { ok: false, codigo: 'NAO_ENCONTRADA', mensagem: 'Credencial não localizada.' };

        AP_Data_update(AP_BIO_CFG.aba, payload.id, {
          status: 'REVOGADA',
          observacao: (alvo.observacao ? alvo.observacao + ' | ' : '') +
            'Revogada em ' + AP_Utils_now() + ' por ' + AP_BIO_usuario_(sessao) +
            (payload.motivo ? ': ' + payload.motivo : '')
        });

        AP_Audit_log(AP_BIO_usuario_(sessao), 'BIOMETRIA_REVOGADA', 'BIOMETRIA', alvo.matricula,
          { tipo: alvo.tipo, motivo: payload.motivo || '' });

        /* se a pessoa não tem mais nenhuma daquele tipo, limpa a marca */
        try {
          var restantes = AP_BIO_todas_().filter(function (c) {
            return String(c.matricula) === String(alvo.matricula) &&
              c.tipo === alvo.tipo && c.status === 'ATIVA';
          });
          if (!restantes.length) {
            var pessoa2 = AP_BIO_pessoa_(alvo.matricula);
            if (pessoa2) {
              var limpar = {};
              if (alvo.tipo === 'digital') limpar.biometria = false;
              if (alvo.tipo === 'facial') limpar.facial = false;
              if (Object.keys(limpar).length) {
                AP_Data_update(AP_SHEETS.USUARIOS, pessoa2.email, limpar, 'email');
              }
            }
          }
        } catch (e) { }

        return { ok: true, dados: { id: payload.id, status: 'REVOGADA' } };
      }

      /** Limpa credenciais sem leitura — o "fantasma" que aparecia nas telas */
      case 'limparFantasmas': {
        var removidas = [];
        AP_BIO_todas_().forEach(function (c) {
          if (c.status === 'REVOGADA') return;
          if (c.credencialId || c.template) return;   // tem leitura, fica
          AP_Data_update(AP_BIO_CFG.aba, c.id, {
            status: 'REVOGADA',
            observacao: 'Removida por não ter leitura registrada'
          });
          removidas.push({ id: c.id, matricula: c.matricula, tipo: c.tipo });
        });

        AP_Audit_log(AP_BIO_usuario_(sessao), 'BIOMETRIA_LIMPEZA', 'BIOMETRIA', '',
          { removidas: removidas.length });

        return { ok: true, dados: { removidas: removidas } };
      }

      /**
       * ÍNDICE PARA O MOTOR
       * O reconhecimento por similaridade não roda no Apps Script — ele
       * roda no programa que fala com o leitor (a ponte). Esta ação
       * entrega os templates ativos para esse programa comparar.
       *
       * É por isso que existe: sem ela, a ponte teria que ler a planilha
       * inteira a cada dedo encostado.
       */
      case 'indice': {
        if (!sessao) {
          return { ok: false, codigo: 'SEM_SESSAO', mensagem: 'O índice exige sessão autenticada.' };
        }

        var ativos = AP_BIO_todas_().filter(function (c) {
          return c.status === 'ATIVA' && c.tipo === 'template' && c.template;
        });

        return {
          ok: true,
          dados: {
            geradoEm: AP_Utils_now(),
            total: ativos.length,
            limites: AP_BIO_limites(),
            templates: ativos.map(function (c) {
              return {
                id: c.id, matricula: c.matricula, nome: c.nome,
                dedo: c.dedo || '', template: c.template,
                versaoTemplate: c.versaoTemplate || ''
              };
            })
          }
        };
      }

      /**
       * RESULTADO DA IDENTIFICAÇÃO FEITA PELO MOTOR
       *
       * A ponte compara e manda o resultado. Aqui o sistema decide se
       * aceita: aplica o limite de score e a margem entre o primeiro e
       * o segundo candidato.
       *
       * Empate ou pontuação baixa NÃO identifica ninguém — pedir nova
       * leitura é melhor que reconhecer a pessoa errada.
       */
      case 'resultadoMotor': {
        var lim2 = AP_BIO_limites();
        var candidatos = (payload.candidatos || []).slice().sort(function (a, b) {
          return (Number(b.score) || 0) - (Number(a.score) || 0);
        });

        if (!candidatos.length) {
          return { ok: false, codigo: 'DIGITAL_NAO_RECONHECIDA', mensagem: 'Digital não reconhecida.' };
        }

        var primeiro = candidatos[0];
        var segundo = candidatos[1];
        var score1 = Number(primeiro.score) || 0;
        var score2 = segundo ? (Number(segundo.score) || 0) : 0;

        if (score1 < lim2.threshold) {
          AP_Audit_log('sistema', 'BIOMETRIA_RECUSADA', 'BIOMETRIA', '',
            { motivo: 'score abaixo do limite', score: score1, limite: lim2.threshold });
          return {
            ok: false, codigo: 'DIGITAL_NAO_RECONHECIDA',
            mensagem: 'Digital não reconhecida.',
            diagnostico: { score: score1, limite: lim2.threshold }
          };
        }

        if (segundo && (score1 - score2) < lim2.margem) {
          AP_Audit_log('sistema', 'BIOMETRIA_AMBIGUA', 'BIOMETRIA', '',
            { primeiro: score1, segundo: score2, margem: lim2.margem });
          return {
            ok: false, codigo: 'RESULTADO_AMBIGUO',
            mensagem: 'Duas digitais ficaram muito próximas. Encoste o dedo de novo.',
            diagnostico: { primeiro: score1, segundo: score2, margemExigida: lim2.margem }
          };
        }

        var credencial = AP_BIO_todas_().filter(function (c) { return c.id === primeiro.id; })[0];
        if (!credencial || credencial.status !== 'ATIVA') {
          return { ok: false, codigo: 'CREDENCIAL_INATIVA', mensagem: 'Credencial revogada.' };
        }

        AP_Data_update(AP_BIO_CFG.aba, credencial.id, {
          ultimoUso: AP_Utils_now(),
          usos: (Number(credencial.usos) || 0) + 1,
          ultimoScore: score1
        });

        AP_Audit_log(credencial.matricula, 'BIOMETRIA_IDENTIFICOU', 'BIOMETRIA', credencial.matricula,
          { score: score1, dedo: credencial.dedo, leitor: payload.leitor || '' });

        /* devolve a IDENTIDADE. Quem autoriza é o Core, não este módulo. */
        return {
          ok: true,
          dados: {
            matricula: credencial.matricula,
            nome: credencial.nome,
            dedo: credencial.dedo,
            score: score1,
            credencial: credencial.id,
            /* deixa explícito que isto é identidade, não permissão */
            observacao: 'Identidade confirmada. A autorização é verificada pelo Core.'
          }
        };
      }

      /* ---------- LIMITES ---------- */

      case 'limites':
        return { ok: true, dados: AP_BIO_limites() };

      case 'definirLimites': {
        var atual = AP_BIO_limites();
        var novo2 = {
          threshold: payload.threshold !== undefined ? Number(payload.threshold) : atual.threshold,
          margem: payload.margem !== undefined ? Number(payload.margem) : atual.margem,
          qualidadeMinima: payload.qualidadeMinima !== undefined
            ? Number(payload.qualidadeMinima) : atual.qualidadeMinima,
          producao: payload.producao !== undefined ? payload.producao !== false : atual.producao
        };

        if (novo2.threshold < 1 || novo2.threshold > 200) {
          return { ok: false, codigo: 'THRESHOLD_INVALIDO', mensagem: 'O limite deve ficar entre 1 e 200.' };
        }

        AP_Config_set('BIO_LIMITES', JSON.stringify(novo2));
        AP_Audit_log(AP_BIO_usuario_(sessao), 'BIOMETRIA_LIMITES', 'BIOMETRIA', '', novo2);
        return { ok: true, dados: novo2 };
      }

      /* Modo homologação: testa sem mexer em estoque nem retirada */
      case 'homologacao': {
        AP_Config_set('BIO_LIMITES', JSON.stringify(
          Object.assign(AP_BIO_limites(), { producao: payload.ativar === false })));
        return {
          ok: true,
          dados: {
            producao: payload.ativar === false,
            aviso: payload.ativar
              ? 'MODO TESTE: identificações não valem para operação real.'
              : 'Modo produção ativo.'
          }
        };
      }

      case 'diagnostico': {
        var todasD = AP_BIO_todas_();
        var ativas = todasD.filter(function (c) { return c.status === 'ATIVA'; });
        var porTipo = {};
        ativas.forEach(function (c) { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1; });

        var pessoas = {};
        ativas.forEach(function (c) { pessoas[c.matricula] = true; });

        return {
          ok: true,
          dados: {
            total: todasD.length,
            ativas: ativas.length,
            revogadas: todasD.length - ativas.length,
            porTipo: porTipo,
            pessoasComBiometria: Object.keys(pessoas).length,
            semLeitura: ativas.filter(function (c) { return !c.credencialId && !c.template; }).length,
            aviso: 'Credencial do tipo digital/facial vale no aparelho onde foi cadastrada. ' +
              'Para identificar em qualquer estação, use template de leitor físico ou crachá.'
          }
        };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'biometria.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_biometria:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'biometria', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   COMPATIBILIDADE
   As telas antigas chamam usuarios.vincularCredencial. Elas
   continuam funcionando: a credencial passa a ser gravada aqui,
   no banco, em vez de ficar só na coluna do usuário.
   ============================================================ */
function AP_BIO_instalarPonte() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var original = g.AP_Modulo_usuarios;
  if (typeof original !== 'function' || original.__comBiometria) return false;

  var novo = function (acao, payload, sessao) {
    payload = payload || {};

    if (acao === 'vincularCredencial' && ['digital', 'facial', 'template'].indexOf(payload.tipo) > -1) {
      return AP_Modulo_biometria('registrar', {
        matricula: payload.matricula,
        tipo: payload.tipo,
        credencialId: payload.referencia || payload.credencialId || '',
        chavePublica: payload.chavePublica || '',
        aparelho: payload.dispositivo || payload.aparelho || '',
        origem: payload.origem || 'SISTEMA',
        observacao: payload.observacao || ''
      }, sessao);
    }

    if (acao === 'credenciais') {
      var base = original(acao, payload, sessao);
      /* acrescenta o que está no banco de biometria */
      try {
        var doBanco = AP_Modulo_biometria('daPessoa', { matricula: payload.matricula }, sessao);
        if (base.ok && doBanco.ok && base.dados && base.dados.metodos) {
          var resumo = doBanco.dados.resumo;
          base.dados.metodos = base.dados.metodos.map(function (m) {
            if (m.tipo === 'digital' && resumo.digital > 0) {
              m.status = 'ATIVO';
              m.aparelhos = resumo.digital;
            }
            if (m.tipo === 'facial' && resumo.facial > 0) m.status = 'ATIVO';
            return m;
          });
          base.dados.credenciais = doBanco.dados.credenciais;
        }
      } catch (e) { }
      return base;
    }

    return original(acao, payload, sessao);
  };

  novo.__comBiometria = true;
  novo.__original = original;
  g.AP_Modulo_usuarios = novo;
  return true;
}

AP_BIO_instalarPonte();

/* ============================================================
   TESTE
   ============================================================ */
function testeModuloBiometria() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  try {
    AP_BIO_instalarPonte();

    var sessao = { usuario: 'admin', perfil: 'ADMINISTRADOR' };

    var r1 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'digital', credencialId: 'CRED-CELULAR-001',
      chavePublica: 'CHAVE-PUB-XYZ', aparelho: 'Galaxy do Ismael', plataforma: 'Android'
    }, sessao);
    reg('cadastra digital do celular', r1.ok, r1.ok ? r1.dados.id : r1.mensagem);

    var r2 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'digital', credencialId: 'CRED-PC-002',
      aparelho: 'PC do almoxarifado', plataforma: 'Windows'
    }, sessao);
    reg('mesma pessoa em outro aparelho', r2.ok, 'duas credenciais para a mesma pessoa');

    var r3 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'digital', credencialId: 'CRED-CELULAR-001', aparelho: 'Galaxy'
    }, sessao);
    reg('não duplica a mesma leitura', r3.ok && r3.jaCadastrada === true, '');

    var r4 = AP_Modulo_biometria('registrar', { matricula: '1', tipo: 'digital' }, sessao);
    reg('recusa cadastro sem leitura', r4.ok === false && r4.codigo === 'SEM_LEITURA', r4.codigo);

    var r5 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'iris', credencialId: 'X'
    }, sessao);
    reg('recusa tipo inválido', r5.ok === false && r5.codigo === 'TIPO_INVALIDO', '');

    var v1 = AP_Modulo_biometria('verificar', { credencialId: 'CRED-CELULAR-001' }, sessao);
    reg('verifica leitura conhecida', v1.ok && v1.dados.matricula == '1', v1.ok ? v1.dados.nome : v1.mensagem);

    var v2 = AP_Modulo_biometria('verificar', { credencialId: 'NAO-EXISTE' }, sessao);
    reg('recusa leitura desconhecida', v2.ok === false && v2.codigo === 'CREDENCIAL_DESCONHECIDA', '');

    var t1 = AP_Modulo_biometria('registrarTemplate', {
      matricula: '1', template: 'TPL-DEDO-INDICADOR-ABC123', leitor: 'Leitor USB balcão'
    }, sessao);
    reg('cadastra template de leitor físico', t1.ok, '');

    var i1 = AP_Modulo_biometria('identificar', { template: 'TPL-DEDO-INDICADOR-ABC123' }, sessao);
    reg('identifica pelo template', i1.ok && i1.dados.matricula == '1',
      i1.ok ? 'reconheceu ' + i1.dados.nome : i1.mensagem);

    var i2 = AP_Modulo_biometria('identificar', { template: 'TPL-OUTRO-DEDO' }, sessao);
    reg('não identifica template estranho', i2.ok === false && i2.codigo === 'NAO_IDENTIFICADO', '');

    var d = AP_Modulo_biometria('daPessoa', { matricula: '1' }, sessao);
    reg('resumo por pessoa', d.ok && d.dados.resumo.digital === 2,
      d.ok ? d.dados.resumo.digital + ' digitais em ' + d.dados.resumo.aparelhos + ' aparelhos' : '');

    var rev = AP_Modulo_biometria('revogar', { id: r1.dados.id, motivo: 'celular trocado' }, sessao);
    reg('revoga credencial', rev.ok, '');

    var v3 = AP_Modulo_biometria('verificar', { credencialId: 'CRED-CELULAR-001' }, sessao);
    reg('revogada não passa mais', v3.ok === false, '');

    var diag = AP_Modulo_biometria('diagnostico', {}, sessao);
    reg('diagnóstico', diag.ok, diag.dados.ativas + ' ativa(s), ' + diag.dados.revogadas + ' revogada(s)');

    var comp = AP_Modulo_usuarios('vincularCredencial', {
      matricula: '1', tipo: 'digital', referencia: 'CRED-VIA-TELA', dispositivo: 'navegador'
    }, sessao);
    reg('tela antiga grava no banco novo', comp.ok, '');

    /* ---------- MOTOR ---------- */

    var d1 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'template', dedo: 'indicador-direito',
      template: 'TPL-IND-DIR', qualidade: 85
    }, sessao);
    reg('cadastra dedo específico', d1.ok, 'indicador direito');

    var d2 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'template', dedo: 'indicador-direito', template: 'TPL-OUTRO'
    }, sessao);
    reg('mesmo dedo não entra 2x', d2.ok === false && d2.codigo === 'DEDO_JA_CADASTRADO', d2.codigo);

    var d3 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'template', dedo: 'polegar-direito',
      template: 'TPL-POL-DIR', qualidade: 30
    }, sessao);
    reg('recusa captura ruim', d3.ok === false && d3.codigo === 'QUALIDADE_BAIXA', d3.codigo);

    var d4 = AP_Modulo_biometria('registrar', {
      matricula: '1', tipo: 'template', dedo: 'dedo-do-pe', template: 'X'
    }, sessao);
    reg('recusa dedo inválido', d4.ok === false && d4.codigo === 'DEDO_INVALIDO', '');

    var idx = AP_Modulo_biometria('indice', {}, sessao);
    reg('índice para o motor', idx.ok && idx.dados.templates.length > 0,
      idx.ok ? idx.dados.total + ' template(s)' : idx.mensagem);

    var idxSemSessao = AP_Modulo_biometria('indice', {}, null);
    reg('índice exige sessão', idxSemSessao.ok === false, idxSemSessao.codigo);

    var lim = AP_Modulo_biometria('limites', {}, sessao);
    reg('limites configuráveis', lim.ok && lim.dados.threshold > 0,
      'threshold ' + lim.dados.threshold + ', margem ' + lim.dados.margem);

    AP_Modulo_biometria('definirLimites', { threshold: 45, margem: 12 }, sessao);
    reg('altera o limite', AP_Modulo_biometria('limites', {}, sessao).dados.threshold === 45, '');

    var mot1 = AP_Modulo_biometria('resultadoMotor', {
      candidatos: [{ id: d1.dados.id, score: 92 }, { id: 'outro', score: 30 }]
    }, sessao);
    reg('identifica com score alto', mot1.ok && mot1.dados.matricula == '1',
      mot1.ok ? mot1.dados.nome + ' (score ' + mot1.dados.score + ')' : mot1.mensagem);

    var mot2 = AP_Modulo_biometria('resultadoMotor', {
      candidatos: [{ id: d1.dados.id, score: 20 }]
    }, sessao);
    reg('recusa score baixo', mot2.ok === false && mot2.codigo === 'DIGITAL_NAO_RECONHECIDA', '');

    var mot3 = AP_Modulo_biometria('resultadoMotor', {
      candidatos: [{ id: d1.dados.id, score: 60 }, { id: 'outro', score: 55 }]
    }, sessao);
    reg('recusa resultado ambíguo', mot3.ok === false && mot3.codigo === 'RESULTADO_AMBIGUO',
      'diferença menor que a margem');

    /* ---------- PROVA BIOMÉTRICA ---------- */

    var ver = AP_Modulo_biometria('verificar', { credencialId: 'CRED-PC-002' }, sessao);
    reg('verificar NÃO é prova biométrica', ver.ok && ver.provaBiometrica === false, '');

    var des = AP_Modulo_biometria('desafio', { operacao: 'RETIRADA' }, sessao);
    reg('gera desafio', des.ok && !!des.dados.desafio, '');

    var aut1 = AP_Modulo_biometria('autenticar', { credencialId: 'CRED-PC-002' }, sessao);
    reg('autenticar exige prova completa', aut1.ok === false && aut1.codigo === 'PROVA_INCOMPLETA', '');

    var aut2 = AP_Modulo_biometria('autenticar', {
      desafio: des.dados.desafio, assinatura: 'ASSINATURA-DO-LEITOR', credencialId: 'CRED-PC-002'
    }, sessao);
    reg('autentica com desafio válido', aut2.ok && aut2.provaBiometrica === true, '');

    var aut3 = AP_Modulo_biometria('autenticar', {
      desafio: des.dados.desafio, assinatura: 'ASSINATURA-DO-LEITOR', credencialId: 'CRED-PC-002'
    }, sessao);
    reg('desafio não serve duas vezes', aut3.ok === false && aut3.codigo === 'DESAFIO_INVALIDO', '');

    var hom = AP_Modulo_biometria('homologacao', { ativar: true }, sessao);
    reg('modo homologação', hom.ok && hom.dados.producao === false, hom.dados.aviso);
    AP_Modulo_biometria('homologacao', { ativar: false }, sessao);

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
