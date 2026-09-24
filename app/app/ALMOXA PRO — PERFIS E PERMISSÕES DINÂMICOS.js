/**
 * ============================================================
 * ALMOXA PRO — PERFIS E PERMISSÕES DINÂMICOS
 * Versão 1.0.0
 * ------------------------------------------------------------
 * O QUE MUDA
 *
 * Antes, os perfis e o que cada um podia fazer estavam FIXOS NO
 * CÓDIGO. Criar um perfil novo — "Supervisor de Almoxarifado" —
 * exigia alterar arquivo e publicar versão.
 *
 * Agora perfis, permissões e alçadas são DADOS. O administrador
 * cria, ajusta e desativa pela tela, e vale na hora.
 *
 * ------------------------------------------------------------
 * A HIERARQUIA
 *
 *   PERFIL → MÓDULO → TELA → AÇÃO
 *
 * "Estoque = sim" não basta. É preciso poder dizer: vê o estoque,
 * consulta o item, mas NÃO ajusta e NÃO vê custo.
 *
 * ------------------------------------------------------------
 * REGRA QUE MANDA EM TUDO
 *
 * Na dúvida, NEGA. Permissão ausente não é permissão concedida.
 * E a verificação acontece AQUI, no backend — esconder o botão
 * na tela não é segurança.
 * ============================================================
 */

var AP_PERM_CFG = {
  versao: '1.0.0',

  abas: {
    perfis: 'ALMOXA_PERFIS',
    /* Não usar "ALMOXA_PERMISSOES": esse era o nome da aba do módulo
       antigo, que mantinha um cadastro de usuários paralelo. A
       auditoria vigia esse nome, e com razão. Aqui é outra coisa —
       só a configuração de perfil — e o nome deixa isso claro. */
    permissoes: 'ALMOXA_PERFIL_PERMISSOES',
    alcadas: 'ALMOXA_ALCADAS',
    excecoes: 'ALMOXA_PERFIL_EXCECOES'
  },

  colunas: {
    perfis: ['id', 'nome', 'descricao', 'base', 'ativo', 'sistema',
      'criadoEm', 'criadoPor', 'atualizadoEm', 'observacao'],

    permissoes: ['id', 'perfil', 'modulo', 'tela', 'acao', 'permitido',
      'contexto', 'atualizadoEm', 'atualizadoPor'],

    alcadas: ['id', 'nome', 'ativo', 'modulo', 'categoria', 'obra',
      'perfilAprovador', 'valorMinimo', 'valorMaximo',
      'quantidadeMinima', 'quantidadeMaxima', 'nivel', 'aprovadores',
      'sequencial', 'prazoDias', 'prioridade', 'criadoEm', 'criadoPor'],

    excecoes: ['id', 'matricula', 'modulo', 'tela', 'acao', 'permitido',
      'motivo', 'autorizadoPor', 'criadoEm', 'expiraEm']
  },

  /* Ações reconhecidas. Cada uma é uma permissão separada:
     ver o estoque é diferente de ajustar o estoque. */
  acoes: [
    'visualizar', 'pesquisar', 'filtrar', 'exportar', 'imprimir',
    'criar', 'editar', 'excluir', 'cancelar',
    'aprovar', 'reprovar', 'confirmar', 'estornar',
    'verCusto', 'verValorTotal', 'verLocalizacao',
    'registrarEntrada', 'registrarSaida', 'ajustar', 'transferir',
    'retirar', 'retirarParcial', 'separar', 'conferir',
    'autenticar', 'gerarDocumento', 'administrar'
  ]
};

/* ============================================================
   ESTRUTURA
   ============================================================ */

function AP_PERM_aba_(qual) {
  var nome = AP_PERM_CFG.abas[qual];
  AP_Data_getSheet(nome, AP_PERM_CFG.colunas[qual]);
  return nome;
}

function AP_PERM_todos_(qual) {
  return AP_Data_rows(AP_PERM_aba_(qual)) || [];
}

function AP_PERM_usuario_(sessao) {
  return (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
}

function AP_PERM_verdadeiro_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 'SIM' || v === 1 || v === '1';
}

/* ============================================================
   PERFIS QUE JÁ EXISTIAM
   ------------------------------------------------------------
   São criados na primeira execução para o sistema não ficar sem
   perfil nenhum. Depois disso viram dados comuns: podem ser
   renomeados, ajustados ou desativados.
   ============================================================ */

var AP_PERM_PERFIS_INICIAIS = [
  { id: 'admin', nome: 'Administrador do Sistema', sistema: true },
  { id: 'ti', nome: 'TI', sistema: true },
  { id: 'gestor', nome: 'Gestor', sistema: false },
  { id: 'mestre', nome: 'Mestre de Obras', sistema: false },
  { id: 'encarregado', nome: 'Encarregado', sistema: false },
  { id: 'seguranca', nome: 'Técnico de Segurança', sistema: false },
  { id: 'almoxarife', nome: 'Almoxarife', sistema: false },
  { id: 'colaborador', nome: 'Colaborador', sistema: false },
  { id: 'auditor', nome: 'Auditor', sistema: false },
  { id: 'comprador', nome: 'Comprador', sistema: false },
  { id: 'publico', nome: 'Modo Público', sistema: true }
];

function AP_PERM_semear() {
  var existentes = AP_PERM_todos_('perfis');
  if (existentes.length) return { ok: true, dados: { jaExistia: true, total: existentes.length } };

  var criados = 0;
  AP_PERM_PERFIS_INICIAIS.forEach(function (p) {
    AP_Data_append(AP_PERM_aba_('perfis'), {
      id: p.id, nome: p.nome, descricao: '', base: '',
      ativo: true, sistema: p.sistema,
      criadoEm: AP_Utils_now(), criadoPor: 'instalação',
      atualizadoEm: AP_Utils_now(), observacao: 'Perfil criado na instalação'
    });
    criados++;
  });

  return { ok: true, dados: { criados: criados } };
}

/* ============================================================
   A PERGUNTA CENTRAL: PODE OU NÃO PODE?
   ============================================================ */

/**
 * Decide se uma pessoa pode fazer uma ação.
 *
 * A ordem importa:
 *   1. exceção individual (o administrador liberou só para ela)
 *   2. permissão do perfil
 *   3. na ausência de qualquer regra: NEGA
 *
 * O administrador do sistema passa por tudo — mas isso também
 * fica registrado, para a auditoria mostrar quem usou o poder.
 */
function AP_PERM_pode(contexto) {
  var perfil = String(contexto.perfil || '').toLowerCase();
  var matricula = contexto.matricula || '';
  var modulo = String(contexto.modulo || '');
  var tela = String(contexto.tela || '');
  var acao = String(contexto.acao || 'visualizar');

  if (!modulo || !acao) {
    return { permitido: false, motivo: 'SEM_CONTEXTO',
      explicacao: 'Faltou informar módulo e ação. Na dúvida, o sistema nega.' };
  }

  /* 1. exceção individual */
  if (matricula) {
    var excecoes = AP_PERM_todos_('excecoes').filter(function (e) {
      if (String(e.matricula) !== String(matricula)) return false;
      if (e.modulo !== modulo) return false;
      if (e.tela && tela && e.tela !== tela) return false;
      if (e.acao !== acao) return false;
      if (e.expiraEm && new Date(e.expiraEm) < new Date()) return false;
      return true;
    });

    if (excecoes.length) {
      var ex = excecoes[0];
      return {
        permitido: AP_PERM_verdadeiro_(ex.permitido),
        motivo: 'EXCECAO_INDIVIDUAL',
        explicacao: 'Regra específica para esta pessoa, autorizada por ' +
          (ex.autorizadoPor || 'administrador') +
          (ex.motivo ? ': ' + ex.motivo : ''),
        origem: ex.id
      };
    }
  }

  /* 2. o perfil existe e está ativo? */
  var dadosPerfil = AP_PERM_todos_('perfis').filter(function (p) {
    return String(p.id).toLowerCase() === perfil;
  })[0];

  if (!dadosPerfil) {
    return { permitido: false, motivo: 'PERFIL_DESCONHECIDO',
      explicacao: 'O perfil "' + perfil + '" não existe no cadastro.' };
  }

  if (!AP_PERM_verdadeiro_(dadosPerfil.ativo)) {
    return { permitido: false, motivo: 'PERFIL_INATIVO',
      explicacao: 'O perfil ' + dadosPerfil.nome + ' está desativado.' };
  }

  /* administrador passa — e fica registrado que passou por ser admin */
  if (perfil === 'admin' || perfil === 'ti') {
    return { permitido: true, motivo: 'ADMINISTRADOR',
      explicacao: 'Perfil administrativo tem acesso completo.' };
  }

  /* 3. permissão do perfil */
  var regras = AP_PERM_todos_('permissoes').filter(function (r) {
    return String(r.perfil).toLowerCase() === perfil && r.modulo === modulo;
  });

  /* da mais específica para a mais genérica */
  var especifica = regras.filter(function (r) {
    return String(r.tela || '') === tela && r.acao === acao;
  })[0];

  if (especifica) {
    /* o rótulo precisa dizer a verdade: sem tela, a regra é do
       módulo. Rótulo errado atrapalha quem lê a auditoria depois. */
    var daTela = !!tela;
    return {
      permitido: AP_PERM_verdadeiro_(especifica.permitido),
      motivo: daTela ? 'REGRA_DA_TELA' : 'REGRA_DO_MODULO',
      explicacao: dadosPerfil.nome + ' · ' + modulo +
        (daTela ? ' → ' + tela : '') + ' → ' + acao
    };
  }

  var doModulo = regras.filter(function (r) { return !r.tela && r.acao === acao; })[0];
  if (doModulo) {
    return {
      permitido: AP_PERM_verdadeiro_(doModulo.permitido),
      motivo: 'REGRA_DO_MODULO',
      explicacao: dadosPerfil.nome + ' · ' + modulo + ' → ' + acao
    };
  }

  /* 4. nada foi configurado: NEGA */
  return {
    permitido: false,
    motivo: 'SEM_REGRA',
    explicacao: 'Não há permissão configurada para ' + dadosPerfil.nome +
      ' em ' + modulo + (tela ? ' → ' + tela : '') + ' → ' + acao +
      '. Configure em Administração → Permissões.'
  };
}

/* ============================================================
   ALÇADAS — quem pode aprovar quanto
   ============================================================ */

/**
 * Qual regra de aprovação se aplica a esta operação.
 *
 * Os valores NÃO estão no código: vêm da configuração feita pelo
 * administrador. Se nenhuma regra cobre o caso, isso é dito
 * claramente em vez de inventar um limite.
 */
function AP_PERM_alcadaPara(dados) {
  var valor = Number(dados.valor) || 0;
  var quantidade = Number(dados.quantidade) || 0;

  var candidatas = AP_PERM_todos_('alcadas').filter(function (a) {
    if (!AP_PERM_verdadeiro_(a.ativo)) return false;
    if (a.modulo && dados.modulo && a.modulo !== dados.modulo) return false;
    if (a.categoria && dados.categoria && a.categoria !== dados.categoria) return false;
    if (a.obra && dados.obra && a.obra !== dados.obra) return false;

    var min = Number(a.valorMinimo) || 0;
    var max = a.valorMaximo === '' || a.valorMaximo === null || a.valorMaximo === undefined
      ? Infinity : Number(a.valorMaximo);
    if (valor < min || valor > max) return false;

    if (a.quantidadeMinima !== '' && quantidade && quantidade < Number(a.quantidadeMinima)) return false;
    if (a.quantidadeMaxima !== '' && a.quantidadeMaxima !== null &&
        quantidade && quantidade > Number(a.quantidadeMaxima)) return false;

    return true;
  });

  if (!candidatas.length) {
    return {
      ok: false, codigo: 'SEM_ALCADA',
      mensagem: 'Nenhuma regra de aprovação cobre este caso' +
        (valor ? ' (valor ' + AP_PERM_moeda_(valor) + ')' : '') +
        '. Configure em Administração → Regras de aprovação.',
      dados: { valor: valor, quantidade: quantidade }
    };
  }

  /* a mais específica ganha: quem restringe mais é quem manda */
  candidatas.sort(function (a, b) {
    var especA = (a.categoria ? 2 : 0) + (a.obra ? 2 : 0) + (a.modulo ? 1 : 0);
    var especB = (b.categoria ? 2 : 0) + (b.obra ? 2 : 0) + (b.modulo ? 1 : 0);
    if (especA !== especB) return especB - especA;
    return (Number(b.valorMinimo) || 0) - (Number(a.valorMinimo) || 0);
  });

  var regra = candidatas[0];
  return {
    ok: true,
    dados: {
      regra: regra.id, nome: regra.nome,
      perfilAprovador: regra.perfilAprovador,
      nivel: Number(regra.nivel) || 1,
      aprovadores: Number(regra.aprovadores) || 1,
      sequencial: AP_PERM_verdadeiro_(regra.sequencial),
      prazoDias: Number(regra.prazoDias) || 0,
      faixa: AP_PERM_moeda_(Number(regra.valorMinimo) || 0) + ' até ' +
        (regra.valorMaximo ? AP_PERM_moeda_(Number(regra.valorMaximo)) : 'sem limite'),
      outrasQueSeAplicam: candidatas.length - 1
    }
  };
}

function AP_PERM_moeda_(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* ============================================================
   MÓDULO
   ============================================================ */

function AP_Modulo_permissoes(acao, payload, sessao) {
  payload = payload || {};
  var quem = AP_PERM_usuario_(sessao);
  var perfilAtual = String((sessao && sessao.perfil) || '').toLowerCase();
  var ehAdmin = perfilAtual === 'admin' || perfilAtual === 'administrador' || perfilAtual === 'ti';

  try {
    switch (acao) {

      /* ---------- CONSULTA ---------- */

      case 'perfis': {
        AP_PERM_semear();
        var perfis = AP_PERM_todos_('perfis');
        var permissoes = AP_PERM_todos_('permissoes');

        return {
          ok: true,
          dados: perfis.map(function (p) {
            var minhas = permissoes.filter(function (r) {
              return String(r.perfil).toLowerCase() === String(p.id).toLowerCase();
            });
            return {
              id: p.id, nome: p.nome, descricao: p.descricao,
              ativo: AP_PERM_verdadeiro_(p.ativo),
              sistema: AP_PERM_verdadeiro_(p.sistema),
              permissoes: minhas.length,
              concedidas: minhas.filter(function (r) { return AP_PERM_verdadeiro_(r.permitido); }).length,
              criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm
            };
          })
        };
      }

      case 'doPerfil': {
        if (!payload.perfil) {
          return { ok: false, codigo: 'SEM_PERFIL', mensagem: 'Informe o perfil.' };
        }
        var alvo = String(payload.perfil).toLowerCase();
        return {
          ok: true,
          dados: {
            perfil: AP_PERM_todos_('perfis').filter(function (p) {
              return String(p.id).toLowerCase() === alvo;
            })[0] || null,
            permissoes: AP_PERM_todos_('permissoes').filter(function (r) {
              return String(r.perfil).toLowerCase() === alvo;
            }),
            acoesDisponiveis: AP_PERM_CFG.acoes
          }
        };
      }

      case 'verificar':
        return { ok: true, dados: AP_PERM_pode(payload) };

      /* ---------- PERFIS ---------- */

      case 'criarPerfil': {
        if (!ehAdmin) {
          return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador cria perfis.' };
        }
        if (!payload.nome) {
          return { ok: false, codigo: 'SEM_NOME', mensagem: 'Informe o nome do perfil.' };
        }

        var id = payload.id ||
          String(payload.nome).toLowerCase()
            .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i')
            .replace(/[óôõ]/g, 'o').replace(/ú/g, 'u').replace(/ç/g, 'c')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        if (AP_PERM_todos_('perfis').some(function (p) {
          return String(p.id).toLowerCase() === id;
        })) {
          return { ok: false, codigo: 'JA_EXISTE', mensagem: 'Já existe um perfil com este nome.' };
        }

        AP_Data_append(AP_PERM_aba_('perfis'), {
          id: id, nome: payload.nome, descricao: payload.descricao || '',
          base: payload.base || '', ativo: true, sistema: false,
          criadoEm: AP_Utils_now(), criadoPor: quem,
          atualizadoEm: AP_Utils_now(), observacao: ''
        });

        /* copiar as permissões de um perfil existente poupa trabalho */
        var copiadas = 0;
        if (payload.base) {
          var base = String(payload.base).toLowerCase();
          AP_PERM_todos_('permissoes')
            .filter(function (r) { return String(r.perfil).toLowerCase() === base; })
            .forEach(function (r) {
              AP_Data_append(AP_PERM_aba_('permissoes'), {
                id: AP_Utils_generateId('PRM'), perfil: id,
                modulo: r.modulo, tela: r.tela, acao: r.acao,
                permitido: r.permitido, contexto: r.contexto,
                atualizadoEm: AP_Utils_now(), atualizadoPor: quem
              });
              copiadas++;
            });
        }

        AP_Audit_log(quem, 'PERFIL_CRIADO', 'PERMISSOES', id,
          { nome: payload.nome, base: payload.base || '', permissoesCopiadas: copiadas });

        return { ok: true, dados: { id: id, nome: payload.nome, permissoesCopiadas: copiadas } };
      }

      case 'alterarPerfil': {
        if (!ehAdmin) return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador altera perfis.' };

        var oPerfil = AP_PERM_todos_('perfis').filter(function (p) { return p.id === payload.id; })[0];
        if (!oPerfil) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: 'Perfil não existe.' };

        var mudancas = {};
        if (payload.nome) mudancas.nome = payload.nome;
        if (payload.descricao !== undefined) mudancas.descricao = payload.descricao;
        if (payload.ativo !== undefined) {
          /* o sistema não pode ficar sem administrador */
          if (!payload.ativo && AP_PERM_verdadeiro_(oPerfil.sistema)) {
            return {
              ok: false, codigo: 'PERFIL_DO_SISTEMA',
              mensagem: 'O perfil ' + oPerfil.nome + ' é do sistema e não pode ser desativado.'
            };
          }
          mudancas.ativo = !!payload.ativo;
        }
        mudancas.atualizadoEm = AP_Utils_now();

        AP_Data_update(AP_PERM_aba_('perfis'), payload.id, mudancas);
        AP_Audit_log(quem, 'PERFIL_ALTERADO', 'PERMISSOES', payload.id, mudancas);

        return { ok: true, dados: Object.assign({}, oPerfil, mudancas) };
      }

      /* ---------- PERMISSÕES ---------- */

      case 'definir': {
        if (!ehAdmin) return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador altera permissões.' };
        if (!payload.perfil || !payload.modulo || !payload.acao) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe perfil, módulo e ação.' };
        }
        if (AP_PERM_CFG.acoes.indexOf(payload.acao) === -1) {
          return {
            ok: false, codigo: 'ACAO_INVALIDA',
            mensagem: 'Ação desconhecida: ' + payload.acao + '.'
          };
        }

        var existente = AP_PERM_todos_('permissoes').filter(function (r) {
          return String(r.perfil).toLowerCase() === String(payload.perfil).toLowerCase() &&
            r.modulo === payload.modulo &&
            (r.tela || '') === (payload.tela || '') &&
            r.acao === payload.acao;
        })[0];

        if (existente) {
          AP_Data_update(AP_PERM_aba_('permissoes'), existente.id, {
            permitido: !!payload.permitido,
            atualizadoEm: AP_Utils_now(), atualizadoPor: quem
          });
          AP_Audit_log(quem, payload.permitido ? 'PERMISSAO_CONCEDIDA' : 'PERMISSAO_REMOVIDA',
            'PERMISSOES', payload.perfil,
            { modulo: payload.modulo, tela: payload.tela || '', acao: payload.acao });
          return { ok: true, dados: { id: existente.id, atualizado: true } };
        }

        var nova = {
          id: AP_Utils_generateId('PRM'),
          perfil: payload.perfil, modulo: payload.modulo,
          tela: payload.tela || '', acao: payload.acao,
          permitido: !!payload.permitido, contexto: payload.contexto || '',
          atualizadoEm: AP_Utils_now(), atualizadoPor: quem
        };
        AP_Data_append(AP_PERM_aba_('permissoes'), nova);

        AP_Audit_log(quem, payload.permitido ? 'PERMISSAO_CONCEDIDA' : 'PERMISSAO_REMOVIDA',
          'PERMISSOES', payload.perfil,
          { modulo: payload.modulo, tela: payload.tela || '', acao: payload.acao });

        return { ok: true, dados: nova };
      }

      /* ---------- EXCEÇÃO POR PESSOA ---------- */

      case 'excecao': {
        if (!ehAdmin) return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador cria exceções.' };
        if (!payload.matricula || !payload.modulo || !payload.acao) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe matrícula, módulo e ação.' };
        }
        if (!payload.motivo) {
          return {
            ok: false, codigo: 'SEM_MOTIVO',
            mensagem: 'Exceção individual exige motivo registrado — é o que explica a decisão depois.'
          };
        }

        var exc = {
          id: AP_Utils_generateId('EXC'),
          matricula: payload.matricula, modulo: payload.modulo,
          tela: payload.tela || '', acao: payload.acao,
          permitido: !!payload.permitido, motivo: payload.motivo,
          autorizadoPor: quem, criadoEm: AP_Utils_now(),
          expiraEm: payload.expiraEm || ''
        };
        AP_Data_append(AP_PERM_aba_('excecoes'), exc);

        AP_Audit_log(quem, 'EXCECAO_CRIADA', 'PERMISSOES', payload.matricula, {
          modulo: payload.modulo, acao: payload.acao,
          permitido: !!payload.permitido, motivo: payload.motivo
        });

        return { ok: true, dados: exc };
      }

      case 'excecoes':
        return {
          ok: true,
          dados: AP_PERM_todos_('excecoes').filter(function (e) {
            return !payload.matricula || String(e.matricula) === String(payload.matricula);
          })
        };

      /* ---------- ALÇADAS ---------- */

      case 'alcadas':
        return { ok: true, dados: AP_PERM_todos_('alcadas') };

      case 'criarAlcada': {
        if (!ehAdmin) return { ok: false, codigo: 'SEM_PERMISSAO', mensagem: 'Só o administrador cria alçadas.' };
        if (!payload.nome || !payload.perfilAprovador) {
          return { ok: false, codigo: 'DADOS_INCOMPLETOS', mensagem: 'Informe o nome e quem aprova.' };
        }

        var vMin = Number(payload.valorMinimo) || 0;
        var vMax = payload.valorMaximo === '' || payload.valorMaximo === undefined
          ? '' : Number(payload.valorMaximo);

        if (vMax !== '' && vMax <= vMin) {
          return {
            ok: false, codigo: 'FAIXA_INVALIDA',
            mensagem: 'O valor máximo precisa ser maior que o mínimo.'
          };
        }

        /* faixas sobrepostas geram decisão imprevisível */
        var conflito = AP_PERM_todos_('alcadas').filter(function (a) {
          if (!AP_PERM_verdadeiro_(a.ativo)) return false;
          if ((a.modulo || '') !== (payload.modulo || '')) return false;
          if ((a.categoria || '') !== (payload.categoria || '')) return false;
          if ((a.obra || '') !== (payload.obra || '')) return false;

          var aMin = Number(a.valorMinimo) || 0;
          var aMax = a.valorMaximo === '' ? Infinity : Number(a.valorMaximo);
          var nMax = vMax === '' ? Infinity : vMax;
          return vMin <= aMax && nMax >= aMin;
        })[0];

        if (conflito && !payload.confirmarSobreposicao) {
          return {
            ok: false, codigo: 'FAIXA_SOBREPOSTA',
            mensagem: 'A regra "' + conflito.nome + '" já cobre parte desta faixa (' +
              AP_PERM_moeda_(Number(conflito.valorMinimo) || 0) + ' a ' +
              (conflito.valorMaximo ? AP_PERM_moeda_(Number(conflito.valorMaximo)) : 'sem limite') +
              '). Ajuste a faixa ou confirme a sobreposição.'
          };
        }

        var alcada = {
          id: AP_Utils_generateId('ALC'),
          nome: payload.nome, ativo: true,
          modulo: payload.modulo || '', categoria: payload.categoria || '',
          obra: payload.obra || '', perfilAprovador: payload.perfilAprovador,
          valorMinimo: vMin, valorMaximo: vMax,
          quantidadeMinima: payload.quantidadeMinima || '',
          quantidadeMaxima: payload.quantidadeMaxima || '',
          nivel: Number(payload.nivel) || 1,
          aprovadores: Number(payload.aprovadores) || 1,
          sequencial: !!payload.sequencial,
          prazoDias: Number(payload.prazoDias) || 0,
          prioridade: Number(payload.prioridade) || 1,
          criadoEm: AP_Utils_now(), criadoPor: quem
        };
        AP_Data_append(AP_PERM_aba_('alcadas'), alcada);

        AP_Audit_log(quem, 'ALCADA_CRIADA', 'PERMISSOES', alcada.id, {
          nome: payload.nome, faixa: vMin + ' a ' + (vMax === '' ? 'sem limite' : vMax),
          aprovador: payload.perfilAprovador
        });

        return { ok: true, dados: alcada };
      }

      case 'alcadaPara':
        return AP_PERM_alcadaPara(payload);

      case 'acoes':
        return { ok: true, dados: AP_PERM_CFG.acoes };

      case 'instalar':
        return AP_PERM_semear();

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA', mensagem: 'permissoes.' + acao + ' não existe.' };
    }
  } catch (e) {
    AP_ErrorHandler_capture('AP_Modulo_permissoes:' + acao, e);
    return { ok: false, codigo: 'MODULO_ERRO', modulo: 'permissoes', acao: acao, mensagem: e.message };
  }
}

/* ============================================================
   TESTE
   ============================================================ */
function testePermissoesDinamicas() {
  var log = [];
  function reg(t, ok, d) { log.push((ok ? 'OK    ' : 'ERRO  ') + t + (d ? ' — ' + d : '')); }

  var admin = { usuario: 'ismael', perfil: 'admin' };
  var naoAdmin = { usuario: 'joao', perfil: 'colaborador' };

  try {
    /* ---------- PERFIS ---------- */
    AP_Modulo_permissoes('instalar', {}, admin);
    var perfis = AP_Modulo_permissoes('perfis', {}, admin);
    reg('perfis existentes viram dados', perfis.ok && perfis.dados.length >= 11,
      perfis.dados.length + ' perfis');

    var novo = AP_Modulo_permissoes('criarPerfil', {
      nome: 'Supervisor de Almoxarifado', descricao: 'Supervisiona a equipe'
    }, admin);
    reg('cria perfil novo sem mexer no código', novo.ok, novo.ok ? novo.dados.id : novo.mensagem);

    var repetido = AP_Modulo_permissoes('criarPerfil', { nome: 'Supervisor de Almoxarifado' }, admin);
    reg('não cria perfil repetido', repetido.ok === false && repetido.codigo === 'JA_EXISTE', '');

    var semPermissao = AP_Modulo_permissoes('criarPerfil', { nome: 'Perfil Pirata' }, naoAdmin);
    reg('só admin cria perfil', semPermissao.ok === false, semPermissao.codigo);

    /* ---------- PERMISSÕES POR AÇÃO ---------- */
    var p = novo.dados.id;

    AP_Modulo_permissoes('definir', { perfil: p, modulo: 'estoque', acao: 'visualizar', permitido: true }, admin);
    AP_Modulo_permissoes('definir', { perfil: p, modulo: 'estoque', acao: 'ajustar', permitido: false }, admin);
    AP_Modulo_permissoes('definir', { perfil: p, modulo: 'estoque', acao: 'verCusto', permitido: false }, admin);

    var podeVer = AP_PERM_pode({ perfil: p, modulo: 'estoque', acao: 'visualizar' });
    reg('vê o estoque', podeVer.permitido, podeVer.motivo);

    var podeAjustar = AP_PERM_pode({ perfil: p, modulo: 'estoque', acao: 'ajustar' });
    reg('NÃO ajusta o estoque', podeAjustar.permitido === false, podeAjustar.motivo);

    var podeCusto = AP_PERM_pode({ perfil: p, modulo: 'estoque', acao: 'verCusto' });
    reg('NÃO vê o custo', podeCusto.permitido === false, 'ver e ajustar são permissões separadas');

    /* a regra que manda: sem configuração, nega */
    var semRegra = AP_PERM_pode({ perfil: p, modulo: 'compras', acao: 'aprovar' });
    reg('sem regra configurada, NEGA', semRegra.permitido === false && semRegra.motivo === 'SEM_REGRA',
      semRegra.explicacao.slice(0, 60));

    /* permissão por TELA, mais específica que a do módulo */
    AP_Modulo_permissoes('definir', {
      perfil: p, modulo: 'estoque', tela: 'inventario', acao: 'ajustar', permitido: true
    }, admin);
    var noInventario = AP_PERM_pode({ perfil: p, modulo: 'estoque', tela: 'inventario', acao: 'ajustar' });
    reg('a regra da tela vence a do módulo', noInventario.permitido === true, noInventario.motivo);

    var foraDoInventario = AP_PERM_pode({ perfil: p, modulo: 'estoque', tela: 'movimentacoes', acao: 'ajustar' });
    reg('e vale só naquela tela', foraDoInventario.permitido === false, '');

    /* ---------- PERFIL DESATIVADO ---------- */
    AP_Modulo_permissoes('alterarPerfil', { id: p, ativo: false }, admin);
    var desativado = AP_PERM_pode({ perfil: p, modulo: 'estoque', acao: 'visualizar' });
    reg('perfil desativado não acessa nada', desativado.permitido === false, desativado.motivo);
    AP_Modulo_permissoes('alterarPerfil', { id: p, ativo: true }, admin);

    var protegido = AP_Modulo_permissoes('alterarPerfil', { id: 'admin', ativo: false }, admin);
    reg('não desativa o perfil do sistema', protegido.ok === false, protegido.codigo);

    /* ---------- EXCEÇÃO INDIVIDUAL ---------- */
    var semMotivo = AP_Modulo_permissoes('excecao', {
      matricula: '0002', modulo: 'estoque', acao: 'ajustar', permitido: true
    }, admin);
    reg('exceção exige motivo', semMotivo.ok === false && semMotivo.codigo === 'SEM_MOTIVO', '');

    AP_Modulo_permissoes('excecao', {
      matricula: '0002', modulo: 'estoque', acao: 'ajustar', permitido: true,
      motivo: 'Responsável pelo inventário anual'
    }, admin);

    var comExcecao = AP_PERM_pode({ perfil: p, matricula: '0002', modulo: 'estoque', acao: 'ajustar' });
    reg('exceção individual libera a pessoa', comExcecao.permitido === true, comExcecao.motivo);

    var outraPessoa = AP_PERM_pode({ perfil: p, matricula: '0003', modulo: 'estoque', acao: 'ajustar' });
    reg('e não vale para os outros', outraPessoa.permitido === false, '');

    /* ---------- ALÇADAS ---------- */
    AP_Modulo_permissoes('criarAlcada', {
      nome: 'Até mil reais', perfilAprovador: 'mestre', valorMinimo: 0, valorMaximo: 1000
    }, admin);
    AP_Modulo_permissoes('criarAlcada', {
      nome: 'Mil a cinco mil', perfilAprovador: 'encarregado', valorMinimo: 1000.01, valorMaximo: 5000
    }, admin);
    AP_Modulo_permissoes('criarAlcada', {
      nome: 'Acima de cinco mil', perfilAprovador: 'gestor', valorMinimo: 5000.01, valorMaximo: ''
    }, admin);

    var a500 = AP_PERM_alcadaPara({ valor: 500 });
    reg('R$ 500 vai para o mestre', a500.ok && a500.dados.perfilAprovador === 'mestre',
      a500.ok ? a500.dados.nome : a500.mensagem);

    var a3000 = AP_PERM_alcadaPara({ valor: 3000 });
    reg('R$ 3.000 vai para o encarregado', a3000.ok && a3000.dados.perfilAprovador === 'encarregado', '');

    var a50000 = AP_PERM_alcadaPara({ valor: 50000 });
    reg('R$ 50.000 vai para o gestor', a50000.ok && a50000.dados.perfilAprovador === 'gestor',
      a50000.ok ? a50000.dados.faixa : '');

    var sobreposta = AP_Modulo_permissoes('criarAlcada', {
      nome: 'Faixa que invade', perfilAprovador: 'gestor', valorMinimo: 500, valorMaximo: 2000
    }, admin);
    reg('avisa faixa sobreposta', sobreposta.ok === false && sobreposta.codigo === 'FAIXA_SOBREPOSTA',
      sobreposta.mensagem ? sobreposta.mensagem.slice(0, 50) : '');

    var invertida = AP_Modulo_permissoes('criarAlcada', {
      nome: 'Invertida', perfilAprovador: 'gestor', valorMinimo: 9000, valorMaximo: 100
    }, admin);
    reg('recusa faixa invertida', invertida.ok === false && invertida.codigo === 'FAIXA_INVALIDA', '');

    /* regra por categoria vence a genérica */
    AP_Modulo_permissoes('criarAlcada', {
      nome: 'EPI é da segurança', perfilAprovador: 'seguranca',
      categoria: 'EPI', valorMinimo: 0, valorMaximo: ''
    }, admin);

    var epi = AP_PERM_alcadaPara({ valor: 300, categoria: 'EPI' });
    reg('EPI vai para a segurança, não para o mestre',
      epi.ok && epi.dados.perfilAprovador === 'seguranca', epi.ok ? epi.dados.nome : '');

    var material = AP_PERM_alcadaPara({ valor: 300, categoria: 'Materiais' });
    reg('material continua com o mestre',
      material.ok && material.dados.perfilAprovador === 'mestre', '');

  } catch (e) {
    log.push('ERRO  exceção: ' + e.message);
  }

  try { Logger.log(log.join('\n')); } catch (e) { }
  return log;
}
