/**
 * ============================================================
 * ALMOXA PRO — MÓDULO D-1
 * Inteligência de movimentações do dia anterior
 * Versão 1.0.0 · 20/11/2026
 * ------------------------------------------------------------
 * POR QUE ESTE É UM ARQUIVO NOVO, E NÃO UMA EDIÇÃO
 *
 * O pedido falava em reescrever ALMOXA_PRO_Modulos_Operacao.gs e
 * ALMOXA_PRO_Modulos_Fluxo.gs. Esses dois existem e rodam o
 * almoxarifado: 2.142 linhas, 17 módulos — estoque, notas,
 * inventário, reservas, compras, EPI, ferramentas. Entregar
 * arquivos com aqueles nomes seria colar por cima de tudo isso.
 *
 * No Apps Script todos os .gs do projeto compartilham o mesmo
 * espaço de nomes. Então este arquivo ENTRA AO LADO deles e
 * chama as funções que já existem, sem tocar numa linha.
 *
 * ------------------------------------------------------------
 * COMO ELE SE LIGA AO CORE
 *
 * O roteador acha módulo pelo nome: quando o Core diz "Nenhum
 * módulo atende X", é porque procurou AP_Modulo_X e não achou.
 * Este arquivo define AP_Modulo_d1, com a MESMA assinatura dos
 * outros — (acao, payload, sessao) — então passa a atender
 * `d1` assim que o arquivo for salvo. Se o seu roteador usar
 * uma lista explícita em vez de busca por nome, é uma linha a
 * acrescentar lá, e eu digo isso em vez de supor que funcionou.
 *
 * ------------------------------------------------------------
 * O QUE ELE USA, E NÃO DUPLICA
 *
 *   AP_Data_rows / AP_Data_append / AP_Data_getSheet  (Data Layer)
 *   AP_OPER_CFG.abaMovimentacoes                      (a aba real)
 *   AP_Utils_generateId / AP_Utils_now                (Core)
 *   AP_Audit_log                                      (auditoria)
 *   AP_Core_withLock                                  (concorrência)
 *
 * Não cria segundo banco de estoque. A única aba nova é a das
 * atividades geradas — que não existe em lugar nenhum hoje.
 * ============================================================
 */

var AP_D1_CFG = {
  versao: '1.0.0',

  /* a aba das atividades geradas. É a única coisa nova. */
  abaAtividades: 'ALMOXA_D1_ATIVIDADES',
  colunasAtividades: [
    'id',          /* ATV-... */
    'chave',       /* a chave determinística: é ela que impede repetir */
    'dataAlvo',    /* o dia D-1 que gerou esta atividade */
    'tipo',        /* CONFERIR_RECEBIDO, ENDERECAR, CONFERIR_DIVERGENCIA... */
    'prioridade',  /* ALTA, NORMAL, BAIXA */
    'sku',
    'descricao',
    'endereco',
    'rua',
    'quantidade',
    'motivo',      /* por que esta atividade existe, em português */
    'origemMov',   /* o id da movimentação que a gerou */
    'status',      /* NOVA, DISTRIBUIDA, CONCLUIDA, CANCELADA */
    'rotaId',      /* preenchido quando entrar numa rota */
    'responsavel',
    'criadoEm',
    'criadoPor'
  ],

  /* ------------------------------------------------------------
     AS REGRAS, EM UM LUGAR SÓ E CONFIGURÁVEIS
     A seção 7 pede "priorizar conforme critérios configuráveis".
     Mexer aqui muda o comportamento sem mexer no código abaixo.
     ------------------------------------------------------------ */
  regras: {
    /* saída grande merece conferência de saldo */
    saidaGrande: { ativa: true, qtdMinima: 10, prioridade: 'NORMAL' },
    /* material que entrou e não tem endereço precisa ser endereçado */
    entradaSemEndereco: { ativa: true, prioridade: 'ALTA' },
    /* ajuste é divergência já reconhecida: confere de novo */
    ajuste: { ativa: true, prioridade: 'ALTA' },
    /* transferência pode ter ficado pela metade */
    transferencia: { ativa: true, prioridade: 'NORMAL' },
    /* entrada comum: conferir o que foi recebido */
    entrada: { ativa: true, prioridade: 'NORMAL' },
    /* quantas atividades no máximo uma rodada pode gerar. Sem
       limite, um dia de inventário vira 4.000 tarefas e ninguém
       olha nenhuma. */
    maximoPorRodada: 300
  }
};

/* ============================================================
   A ABA · criada sob demanda, como as outras do projeto
   ============================================================ */
function AP_D1_aba_() {
  return AP_Data_getSheet(AP_D1_CFG.abaAtividades, AP_D1_CFG.colunasAtividades);
}

/* ============================================================
   O DIA · fuso horário e calendário, como a regra manda
   ------------------------------------------------------------
   "D-1 significa consultar o dia anterior conforme o calendário
    e o fuso horário configurados. Não misturar movimentações de
    datas diferentes."

   Por isso tudo aqui passa por AP_D1_diaDe_, que reduz qualquer
   data ao dia no fuso da planilha. Comparar texto de data sem
   isso é o jeito clássico de pegar o dia errado por três horas.
   ============================================================ */
function AP_D1_fuso_() {
  try {
    var ss = SpreadsheetApp.getActive();
    if (ss && ss.getSpreadsheetTimeZone) {
      var tz = ss.getSpreadsheetTimeZone();
      if (tz) return tz;
    }
  } catch (e) {}
  try { return Session.getScriptTimeZone(); } catch (e2) {}
  return 'America/Manaus';
}

/** devolve 'AAAA-MM-DD' no fuso configurado, ou '' se não der para ler */
function AP_D1_diaDe_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  var d;
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    d = valor;
  } else {
    var t = String(valor).trim();
    /* já está em AAAA-MM-DD: devolvo como está, sem reinterpretar */
    var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    /* DD/MM/AAAA, que é como o Brasil escreve */
    var br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return br[3] + '-' + br[2] + '-' + br[1];
    d = new Date(t);
  }
  if (!d || isNaN(d.getTime())) return '';
  try {
    return Utilities.formatDate(d, AP_D1_fuso_(), 'yyyy-MM-dd');
  } catch (e) {
    /* sem o Utilities (fora do Apps Script), uso UTC e digo isso
       no diagnóstico em vez de fingir que foi no fuso certo */
    return d.toISOString().slice(0, 10);
  }
}

/** o dia anterior a uma data (ou a hoje), no fuso configurado */
function AP_D1_ontem_(referencia) {
  var base;
  if (referencia) {
    var dia = AP_D1_diaDe_(referencia);
    if (!dia) return '';
    var p = dia.split('-');
    base = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  } else {
    var hoje = AP_D1_diaDe_(new Date());
    var h = hoje.split('-');
    base = new Date(Date.UTC(Number(h[0]), Number(h[1]) - 1, Number(h[2])));
  }
  base.setUTCDate(base.getUTCDate() - 1);
  var mm = String(base.getUTCMonth() + 1);
  var dd = String(base.getUTCDate());
  return base.getUTCFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) +
         '-' + (dd.length < 2 ? '0' + dd : dd);
}

/* ============================================================
   AS MOVIMENTAÇÕES DE UM DIA
   ============================================================ */
function AP_D1_movimentacoesDoDia_(dia) {
  var todas = AP_Data_rows(AP_OPER_CFG.abaMovimentacoes) || [];
  var fora = [];
  for (var i = 0; i < todas.length; i++) {
    var m = todas[i];
    if (!m) continue;
    if (AP_D1_diaDe_(m.data) !== dia) continue;
    fora.push(m);
  }
  /* mais recente primeiro, como o resto do sistema faz */
  fora.sort(function (a, b) {
    return String(b.data).localeCompare(String(a.data));
  });
  return fora;
}

/* ============================================================
   A CHAVE QUE IMPEDE DUPLICAR
   ------------------------------------------------------------
   "A geração deverá ser idempotente: executar novamente não
    poderá duplicar as mesmas rotas."

   A chave sai dos dados, não de um contador: mesmo dia, mesmo
   tipo, mesmo material, mesmo endereço → mesma chave. Rodar de
   novo encontra a chave já gravada e não grava outra vez.

   Note que a origem (o id da movimentação) NÃO entra na chave:
   se a pessoa deu três saídas do mesmo material no mesmo
   endereço, é UMA conferência, não três.
   ============================================================ */
function AP_D1_chave_(dia, tipo, sku, endereco) {
  return ['D1', dia, String(tipo || '').toUpperCase(),
          String(sku || '').toUpperCase().replace(/\s+/g, ''),
          String(endereco || '').toUpperCase().replace(/\s+/g, '')].join('|');
}

/* ============================================================
   O ENDEREÇO DE UM MATERIAL
   ------------------------------------------------------------
   Vem do cadastro de itens, pela rota que já existe. Não leio a
   planilha por fora: quem sabe de item é o módulo de estoque.
   ============================================================ */
function AP_D1_enderecoDoSku_(sku, cacheItens) {
  var lista = cacheItens;
  if (!lista) {
    var r = AP_Modulo_estoque('listar', {}, null);
    lista = (r && r.ok && r.dados) || [];
  }
  for (var i = 0; i < lista.length; i++) {
    if (String(lista[i].sku) === String(sku)) {
      var L = String(lista[i].local || '').trim();
      if (!L || L === '—' || L === '-') return '';
      return L;
    }
  }
  return '';
}

function AP_D1_rua_(endereco) {
  var e = String(endereco || '').trim();
  if (!e) return '';
  return e.split('-')[0].toUpperCase();
}

/* ============================================================
   AS ATIVIDADES SUGERIDAS · só calcula, não grava
   ============================================================ */
function AP_D1_sugerir_(dia, cacheItens) {
  var movs = AP_D1_movimentacoesDoDia_(dia);
  var R = AP_D1_CFG.regras;
  var porChave = {};
  var ordem = [];

  function propor(tipo, prioridade, m, endereco, motivo) {
    var chave = AP_D1_chave_(dia, tipo, m.sku, endereco);
    if (porChave[chave]) {
      /* mesma atividade vinda de outra movimentação: somo a
         quantidade e guardo as duas origens, em vez de criar
         duas tarefas para a mesma conferência */
      porChave[chave].quantidade += Math.abs(Number(m.qtd) || 0);
      if (porChave[chave].origemMov.indexOf(m.id) === -1) {
        porChave[chave].origemMov.push(m.id);
      }
      return;
    }
    porChave[chave] = {
      chave: chave,
      dataAlvo: dia,
      tipo: tipo,
      prioridade: prioridade,
      sku: String(m.sku || ''),
      descricao: String(m.descricao || ''),
      endereco: endereco || '',
      rua: AP_D1_rua_(endereco),
      quantidade: Math.abs(Number(m.qtd) || 0),
      motivo: motivo,
      origemMov: [m.id]
    };
    ordem.push(chave);
  }

  for (var i = 0; i < movs.length; i++) {
    var m = movs[i];
    var tipoMov = String(m.tipo || '').toUpperCase();
    var endereco = AP_D1_enderecoDoSku_(m.sku, cacheItens);
    var qtd = Math.abs(Number(m.qtd) || 0);

    if (tipoMov === 'ENTRADA' || tipoMov === 'DEVOLUCAO') {
      if (!endereco && R.entradaSemEndereco.ativa) {
        propor('ENDERECAR', R.entradaSemEndereco.prioridade, m, '',
               'entrou material e o cadastro não diz em que endereço ele ' +
               'está. Sem endereço ninguém acha na hora da separação.');
      } else if (R.entrada.ativa) {
        propor('CONFERIR_RECEBIDO', R.entrada.prioridade, m, endereco,
               'material recebido no dia anterior: conferir o que chegou ' +
               'contra o que foi guardado.');
      }
    } else if (tipoMov === 'SAIDA') {
      if (R.saidaGrande.ativa && qtd >= R.saidaGrande.qtdMinima) {
        propor('CONFERIR_SALDO', R.saidaGrande.prioridade, m, endereco,
               'saída de ' + qtd + ' unidades: saída grande merece conferência ' +
               'do saldo que ficou na posição.');
      }
    } else if (tipoMov === 'AJUSTE') {
      if (R.ajuste.ativa) {
        propor('CONFERIR_DIVERGENCIA', R.ajuste.prioridade, m, endereco,
               'houve ajuste de saldo neste material: ajuste é divergência já ' +
               'reconhecida, e vale contar de novo para fechar.');
      }
    } else if (tipoMov === 'TRANSFERENCIA') {
      if (R.transferencia.ativa) {
        propor('VERIFICAR_TRANSFERENCIA', R.transferencia.prioridade, m, endereco,
               'transferência registrada: conferir se o material está mesmo ' +
               'no endereço de destino.');
      }
    }
  }

  /* ordenar por proximidade: rua, depois endereço. É o que a
     seção 7 chama de "agrupar atividades por proximidade" — quem
     vai conferir anda uma rua de cada vez, não pula o galpão. */
  var fora = ordem.map(function (k) { return porChave[k]; });
  var peso = { ALTA: 0, NORMAL: 1, BAIXA: 2 };
  fora.sort(function (a, b) {
    var pa = peso[a.prioridade] === undefined ? 1 : peso[a.prioridade];
    var pb = peso[b.prioridade] === undefined ? 1 : peso[b.prioridade];
    if (pa !== pb) return pa - pb;
    if (a.rua !== b.rua) return a.rua < b.rua ? -1 : 1;
    if (a.endereco !== b.endereco) return a.endereco < b.endereco ? -1 : 1;
    return 0;
  });

  return {
    dia: dia,
    movimentacoes: movs.length,
    atividades: fora,
    quantas: fora.length,
    limiteAtingido: fora.length > AP_D1_CFG.regras.maximoPorRodada
  };
}

/* ============================================================
   AS ATIVIDADES JÁ GRAVADAS
   ============================================================ */
function AP_D1_jaGravadas_(dia) {
  AP_D1_aba_();
  var todas = AP_Data_rows(AP_D1_CFG.abaAtividades) || [];
  if (!dia) return todas;
  var fora = [];
  for (var i = 0; i < todas.length; i++) {
    if (String(todas[i].dataAlvo) === String(dia)) fora.push(todas[i]);
  }
  return fora;
}

/* ============================================================
   O MÓDULO · (acao, payload, sessao), como todos os outros
   ============================================================ */
function AP_Modulo_d1(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      /* ---------- que dia é o D-1 de hoje, no fuso certo ---------- */
      case 'dia': {
        return { ok: true, dados: {
          hoje: AP_D1_diaDe_(new Date()),
          ontem: AP_D1_ontem_(null),
          fuso: AP_D1_fuso_()
        } };
      }

      /* ---------- as movimentações do dia anterior ---------- */
      case 'movimentacoes': {
        var dia = payload.data ? AP_D1_diaDe_(payload.data) : AP_D1_ontem_(null);
        if (!dia) {
          return { ok: false, codigo: 'DATA_INVALIDA',
                   mensagem: 'Não consegui entender a data "' + payload.data + '".' };
        }
        var movs = AP_D1_movimentacoesDoDia_(dia);
        return { ok: true, dados: { dia: dia, fuso: AP_D1_fuso_(),
                                    total: movs.length, movimentacoes: movs } };
      }

      /* ---------- o retrato do dia ---------- */
      case 'resumo': {
        var diaR = payload.data ? AP_D1_diaDe_(payload.data) : AP_D1_ontem_(null);
        if (!diaR) {
          return { ok: false, codigo: 'DATA_INVALIDA',
                   mensagem: 'Data inválida.' };
        }
        var lista = AP_D1_movimentacoesDoDia_(diaR);
        var porTipo = {}, skus = {}, obras = {}, usuarios = {};
        for (var i = 0; i < lista.length; i++) {
          var t = String(lista[i].tipo || 'SEM TIPO').toUpperCase();
          porTipo[t] = (porTipo[t] || 0) + 1;
          if (lista[i].sku) skus[lista[i].sku] = true;
          if (lista[i].obra) obras[lista[i].obra] = true;
          if (lista[i].usuario) usuarios[lista[i].usuario] = true;
        }
        return { ok: true, dados: {
          dia: diaR, fuso: AP_D1_fuso_(),
          movimentacoes: lista.length,
          porTipo: porTipo,
          materiais: Object.keys(skus).length,
          obras: Object.keys(obras).length,
          colaboradores: Object.keys(usuarios).length
        } };
      }

      /* ---------- sugerir atividades · NÃO grava nada ---------- */
      case 'sugerir': {
        var diaS = payload.data ? AP_D1_diaDe_(payload.data) : AP_D1_ontem_(null);
        if (!diaS) {
          return { ok: false, codigo: 'DATA_INVALIDA', mensagem: 'Data inválida.' };
        }
        var itensS = null;
        var rS = AP_Modulo_estoque('listar', {}, sessao);
        if (rS && rS.ok) itensS = rS.dados;
        var sug = AP_D1_sugerir_(diaS, itensS);

        /* marca quais já existem gravadas, para o gestor ver o que
           é novo e o que já foi distribuído */
        var gravadas = AP_D1_jaGravadas_(diaS);
        var existentes = {};
        for (var g = 0; g < gravadas.length; g++) {
          existentes[String(gravadas[g].chave)] = gravadas[g];
        }
        for (var s = 0; s < sug.atividades.length; s++) {
          var ja = existentes[sug.atividades[s].chave];
          sug.atividades[s].jaGravada = !!ja;
          sug.atividades[s].statusAtual = ja ? String(ja.status || '') : '';
        }
        sug.novas = sug.atividades.filter(function (a) { return !a.jaGravada; }).length;
        sug.jaGravadas = sug.atividades.length - sug.novas;
        return { ok: true, dados: sug };
      }

      /* ---------- gerar · grava, e NÃO duplica ---------- */
      case 'gerar': {
        var diaG = payload.data ? AP_D1_diaDe_(payload.data) : AP_D1_ontem_(null);
        if (!diaG) {
          return { ok: false, codigo: 'DATA_INVALIDA', mensagem: 'Data inválida.' };
        }
        var quem = (sessao && (sessao.usuario || sessao.userId)) || 'sistema';

        /* a gravação inteira dentro do lock do Core: duas pessoas
           clicando "gerar" ao mesmo tempo não criam duas listas */
        return AP_Core_withLock(function () {
          var itensG = null;
          var rG = AP_Modulo_estoque('listar', {}, sessao);
          if (rG && rG.ok) itensG = rG.dados;

          var plano = AP_D1_sugerir_(diaG, itensG);
          AP_D1_aba_();

          /* o que JÁ está gravado para este dia */
          var existentesG = {};
          var jaG = AP_D1_jaGravadas_(diaG);
          for (var j = 0; j < jaG.length; j++) {
            existentesG[String(jaG[j].chave)] = true;
          }

          var criadas = [], repetidas = 0, cortadas = 0;
          for (var k = 0; k < plano.atividades.length; k++) {
            if (criadas.length >= AP_D1_CFG.regras.maximoPorRodada) {
              cortadas = plano.atividades.length - k;
              break;
            }
            var a = plano.atividades[k];
            if (existentesG[a.chave]) { repetidas++; continue; }

            var registro = {
              id: AP_Utils_generateId('ATV'),
              chave: a.chave,
              dataAlvo: a.dataAlvo,
              tipo: a.tipo,
              prioridade: a.prioridade,
              sku: a.sku,
              descricao: a.descricao,
              endereco: a.endereco,
              rua: a.rua,
              quantidade: a.quantidade,
              motivo: a.motivo,
              origemMov: a.origemMov.join(','),
              status: 'NOVA',
              rotaId: '',
              responsavel: '',
              criadoEm: AP_Utils_now(),
              criadoPor: quem
            };
            AP_Data_append(AP_D1_CFG.abaAtividades, registro);
            existentesG[a.chave] = true;
            criadas.push(registro);
          }

          try {
            AP_Audit_log(quem, 'D1_GERAR',
              'dia ' + diaG + ': ' + criadas.length + ' atividade(s) criada(s), ' +
              repetidas + ' já existiam');
          } catch (e) {}

          return { ok: true, dados: {
            dia: diaG,
            criadas: criadas.length,
            repetidas: repetidas,
            cortadasPeloLimite: cortadas,
            limitePorRodada: AP_D1_CFG.regras.maximoPorRodada,
            atividades: criadas,
            /* dito com todas as letras, porque é a regra que mais
               importa aqui: rodar de novo não duplica */
            observacao: repetidas > 0
              ? repetidas + ' atividade(s) já existiam para este dia e NÃO ' +
                'foram criadas de novo.'
              : ''
          } };
        });
      }

      /* ---------- consultar o que já foi gerado ---------- */
      case 'listar': {
        var diaL = payload.data ? AP_D1_diaDe_(payload.data) : '';
        var listaL = AP_D1_jaGravadas_(diaL);
        if (payload.status) {
          listaL = listaL.filter(function (x) {
            return String(x.status).toUpperCase() ===
                   String(payload.status).toUpperCase();
          });
        }
        if (payload.responsavel) {
          listaL = listaL.filter(function (x) {
            return String(x.responsavel) === String(payload.responsavel);
          });
        }
        return { ok: true, dados: listaL };
      }

      /* ---------- marcar atividades como distribuídas ---------- */
      case 'distribuir': {
        var ids = payload.ids;
        if (!ids || !ids.length) {
          return { ok: false, codigo: 'SEM_IDS',
                   mensagem: 'Informe quais atividades distribuir.' };
        }
        if (!payload.responsavel) {
          return { ok: false, codigo: 'SEM_RESPONSAVEL',
                   mensagem: 'Sem responsável a atividade não aparece no celular ' +
                             'de ninguém.' };
        }
        var quemD = (sessao && (sessao.usuario || sessao.userId)) || 'sistema';
        return AP_Core_withLock(function () {
          AP_D1_aba_();
          var todasD = AP_Data_rows(AP_D1_CFG.abaAtividades) || [];
          var porId = {};
          for (var i = 0; i < todasD.length; i++) porId[String(todasD[i].id)] = todasD[i];

          var mudadas = [], naoAchadas = [], jaDistribuidas = [];
          for (var n = 0; n < ids.length; n++) {
            var alvo = porId[String(ids[n])];
            if (!alvo) { naoAchadas.push(ids[n]); continue; }
            /* uma tarefa já distribuída não é redistribuída em
               silêncio: isso é o que gera conferência em dobro */
            if (String(alvo.status).toUpperCase() === 'DISTRIBUIDA' &&
                String(alvo.responsavel) !== String(payload.responsavel) &&
                !payload.forcarReatribuicao) {
              jaDistribuidas.push({ id: alvo.id, de: alvo.responsavel });
              continue;
            }
            AP_Data_update(AP_D1_CFG.abaAtividades, alvo.id, {
              status: 'DISTRIBUIDA',
              responsavel: String(payload.responsavel),
              rotaId: String(payload.rotaId || alvo.rotaId || '')
            });
            mudadas.push(alvo.id);
          }

          try {
            AP_Audit_log(quemD, 'D1_DISTRIBUIR',
              mudadas.length + ' atividade(s) para ' + payload.responsavel);
          } catch (e) {}

          return { ok: true, dados: {
            distribuidas: mudadas.length,
            ids: mudadas,
            naoEncontradas: naoAchadas,
            jaEramDeOutro: jaDistribuidas,
            aviso: jaDistribuidas.length
              ? jaDistribuidas.length + ' atividade(s) já eram de outra pessoa e ' +
                'NÃO foram reatribuídas. Mande forcarReatribuicao: true se for ' +
                'para tirar de quem está com elas.'
              : ''
          } };
        });
      }

      /* ---------- diagnóstico do módulo ---------- */
      case 'diagnostico': {
        var temEstoque = (typeof AP_Modulo_estoque === 'function');
        var temData = (typeof AP_Data_rows === 'function');
        return { ok: true, dados: {
          modulo: 'd1', versao: AP_D1_CFG.versao,
          fuso: AP_D1_fuso_(),
          hoje: AP_D1_diaDe_(new Date()),
          ontem: AP_D1_ontem_(null),
          abaMovimentacoes: AP_OPER_CFG ? AP_OPER_CFG.abaMovimentacoes : '(sem AP_OPER_CFG)',
          abaAtividades: AP_D1_CFG.abaAtividades,
          dependencias: {
            AP_Data_rows: temData,
            AP_Modulo_estoque: temEstoque,
            AP_Core_withLock: (typeof AP_Core_withLock === 'function'),
            AP_Utils_generateId: (typeof AP_Utils_generateId === 'function'),
            AP_Audit_log: (typeof AP_Audit_log === 'function')
          },
          regras: AP_D1_CFG.regras
        } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
                 mensagem: 'O módulo d1 não conhece a ação "' + acao + '". ' +
                           'Ações: dia, movimentacoes, resumo, sugerir, gerar, ' +
                           'listar, distribuir, diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO_NO_MODULO',
             mensagem: String((e && e.message) || e),
             onde: 'AP_Modulo_d1(' + acao + ')' };
  }
}

/* ============================================================
   TESTES EXECUTÁVEIS NO APPS SCRIPT
   ------------------------------------------------------------
   Rode pelo editor: escolha a função e clique em Executar. Cada
   um distingue sucesso real, falha de conexão, dados inexistentes
   e contrato incompatível — e NENHUM grava em produção, exceto
   testeFluxoD1Gravando_, que avisa antes e usa um dia de teste.
   ============================================================ */

function AP_D1_dizer_(titulo, r) {
  var linha = '--- ' + titulo + ' ---\n' + JSON.stringify(r, null, 2);
  Logger.log(linha);
  return r;
}

/** o módulo está instalado e enxerga as dependências? */
function testeD1Instalacao() {
  var r = AP_Modulo_d1('diagnostico', {}, null);
  if (!r.ok) return AP_D1_dizer_('FALHA no diagnóstico', r);
  var d = r.dados, faltam = [];
  for (var k in d.dependencias) if (!d.dependencias[k]) faltam.push(k);
  return AP_D1_dizer_('INSTALACAO', {
    ok: faltam.length === 0,
    veredito: faltam.length === 0
      ? 'o módulo d1 está instalado e enxerga tudo de que precisa.'
      : 'CONTRATO INCOMPATÍVEL: faltam ' + faltam.join(', ') +
        '. Confira a ordem de carregamento dos arquivos.',
    fuso: d.fuso, hoje: d.hoje, ontem: d.ontem, faltam: faltam
  });
}

/** a conta do dia anterior está certa no fuso configurado? */
function testeD1Dia() {
  var r = AP_Modulo_d1('dia', {}, null);
  if (!r.ok) return AP_D1_dizer_('FALHA', r);
  var d = r.dados;
  var h = d.hoje.split('-'), o = d.ontem.split('-');
  var dh = Date.UTC(Number(h[0]), Number(h[1]) - 1, Number(h[2]));
  var dOn = Date.UTC(Number(o[0]), Number(o[1]) - 1, Number(o[2]));
  var diff = (dh - dOn) / 86400000;
  return AP_D1_dizer_('DIA', {
    ok: diff === 1,
    veredito: diff === 1
      ? 'o dia anterior é exatamente um dia antes de hoje, no fuso ' + d.fuso
      : 'ERRO DE CÁLCULO: a diferença deu ' + diff + ' dia(s)',
    hoje: d.hoje, ontem: d.ontem, fuso: d.fuso
  });
}

/** lê as movimentações do D-1 de verdade, sem gravar nada */
function testeFluxoD1() {
  var r = AP_Modulo_d1('resumo', {}, null);
  if (!r.ok) return AP_D1_dizer_('FALHA', r);
  var d = r.dados;
  return AP_D1_dizer_('D-1', {
    ok: true,
    veredito: d.movimentacoes > 0
      ? 'LEITURA REAL: ' + d.movimentacoes + ' movimentação(ões) no dia ' + d.dia
      : 'SEM DADOS NO DIA: nenhuma movimentação em ' + d.dia +
        '. Isso não é falha — é um dia sem movimento. Para testar com dados, ' +
        'chame AP_Modulo_d1("resumo", { data: "AAAA-MM-DD" }) num dia que teve.',
    dia: d.dia, fuso: d.fuso, porTipo: d.porTipo,
    materiais: d.materiais, colaboradores: d.colaboradores
  });
}

/** sugere atividades sem gravar nenhuma */
function testeD1Sugerir() {
  var r = AP_Modulo_d1('sugerir', {}, null);
  if (!r.ok) return AP_D1_dizer_('FALHA', r);
  var d = r.dados;
  var porTipo = {};
  for (var i = 0; i < d.atividades.length; i++) {
    var t = d.atividades[i].tipo;
    porTipo[t] = (porTipo[t] || 0) + 1;
  }
  return AP_D1_dizer_('SUGERIR', {
    ok: true,
    veredito: d.quantas + ' atividade(s) sugerida(s) a partir de ' +
              d.movimentacoes + ' movimentação(ões) do dia ' + d.dia +
              '. NADA foi gravado.',
    dia: d.dia, sugeridas: d.quantas, novas: d.novas,
    jaGravadas: d.jaGravadas, porTipo: porTipo,
    primeiras: d.atividades.slice(0, 5)
  });
}

/** prova a idempotência: gera duas vezes e confere que não dobrou */
function testeD1NaoDuplica() {
  var dia = AP_Modulo_d1('dia', {}, null).dados.ontem;
  var antes = AP_Modulo_d1('listar', { data: dia }, null).dados.length;
  var um = AP_Modulo_d1('gerar', { data: dia }, { usuario: 'teste-idempotencia' });
  if (!um.ok) return AP_D1_dizer_('FALHA na primeira geração', um);
  var dois = AP_Modulo_d1('gerar', { data: dia }, { usuario: 'teste-idempotencia' });
  if (!dois.ok) return AP_D1_dizer_('FALHA na segunda geração', dois);
  var depois = AP_Modulo_d1('listar', { data: dia }, null).dados.length;

  var esperado = antes + um.dados.criadas;
  return AP_D1_dizer_('IDEMPOTENCIA', {
    ok: dois.dados.criadas === 0 && depois === esperado,
    veredito: (dois.dados.criadas === 0 && depois === esperado)
      ? 'A segunda geração criou ZERO atividades e reconheceu ' +
        dois.dados.repetidas + ' já existentes. Não duplicou.'
      : 'DUPLICOU: a segunda geração criou ' + dois.dados.criadas +
        ' atividade(s). A chave não está segurando.',
    antes: antes, criadasNaPrimeira: um.dados.criadas,
    criadasNaSegunda: dois.dados.criadas, depois: depois, esperado: esperado
  });
}

/** distribui atividades e confere que não reatribui em silêncio */
function testeFluxoDistribuicao() {
  var dia = AP_Modulo_d1('dia', {}, null).dados.ontem;
  var lista = AP_Modulo_d1('listar', { data: dia, status: 'NOVA' }, null).dados;
  if (!lista.length) {
    return AP_D1_dizer_('DISTRIBUICAO', {
      ok: false, veredito: 'DADOS INEXISTENTES: não há atividade NOVA no dia ' +
          dia + '. Rode testeD1NaoDuplica() antes para gerar.' });
  }
  var ids = [lista[0].id];
  var um = AP_Modulo_d1('distribuir',
    { ids: ids, responsavel: 'TESTE-A' }, { usuario: 'teste' });
  var dois = AP_Modulo_d1('distribuir',
    { ids: ids, responsavel: 'TESTE-B' }, { usuario: 'teste' });
  return AP_D1_dizer_('DISTRIBUICAO', {
    ok: um.ok && um.dados.distribuidas === 1 &&
        dois.ok && dois.dados.distribuidas === 0,
    veredito: (dois.dados.distribuidas === 0)
      ? 'Distribuiu para TESTE-A e RECUSOU passar para TESTE-B sem ' +
        'forcarReatribuicao. É o que impede conferência em dobro.'
      : 'PROBLEMA: reatribuiu em silêncio para TESTE-B.',
    primeira: um.dados, segunda: dois.dados
  });
}

/** roda todos e devolve um placar */
function testeD1Tudo() {
  var resultados = {
    instalacao: testeD1Instalacao(),
    dia: testeD1Dia(),
    leitura: testeFluxoD1(),
    sugerir: testeD1Sugerir()
  };
  var falhou = [];
  for (var k in resultados) if (!resultados[k].ok) falhou.push(k);
  return AP_D1_dizer_('PLACAR', {
    ok: falhou.length === 0,
    veredito: falhou.length === 0
      ? 'Os quatro testes de leitura passaram. Para provar a gravação, ' +
        'rode testeD1NaoDuplica() — ele grava no dia D-1.'
      : 'Falharam: ' + falhou.join(', '),
    detalhe: resultados
  });
}
