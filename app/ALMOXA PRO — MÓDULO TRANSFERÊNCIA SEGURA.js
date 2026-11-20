/**
 * ============================================================
 * ALMOXA PRO — MÓDULO TRANSFERÊNCIA SEGURA
 * Movimentação entre endereços com trava contra repetição
 * Versão 1.0.0 · 20/11/2026
 * ------------------------------------------------------------
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *
 * O AP_Modulo_estoque grava movimentação dentro de
 * AP_Core_withLock — e isso está certo: impede duas gravações
 * ao MESMO TEMPO.
 *
 * Mas eu procurei a palavra `opchave` no ALMOXA_PRO_Modulos_
 * Operacao.gs inteiro: ela não aparece nenhuma vez. Ou seja, não
 * há nada que impeça a MESMA gravação de chegar DUAS VEZES.
 *
 * E ela chega. O almoxarife dá a saída, o 4G do galpão engasga, a
 * tela não confirma, ele toca de novo — e o saldo baixa duas
 * vezes. O lock não protege disso: lock é sobre simultaneidade,
 * não sobre repetição.
 *
 * ------------------------------------------------------------
 * POR QUE UM ARQUIVO NOVO E NÃO UMA EDIÇÃO
 *
 * Mexer no AP_Modulo_estoque é mexer no que grava o saldo de
 * todo o almoxarifado. Este módulo fica POR FORA: registra a
 * operação numa aba própria, confere se já foi feita, e só então
 * chama o AP_Modulo_estoque que já existe. Nenhuma linha dele
 * muda. Se este arquivo for removido, tudo volta a ser como era.
 *
 * ------------------------------------------------------------
 * O QUE ELE USA, E NÃO DUPLICA
 *
 *   AP_Modulo_estoque('movimentar'|'item'|'listar')  — o saldo
 *   AP_Data_getSheet / rows / append / update        — Data Layer
 *   AP_Core_withLock                                 — concorrência
 *   AP_Utils_generateId / AP_Utils_now               — Core
 *   AP_Audit_log                                     — auditoria
 *
 * A aba nova é um LIVRO DE OPERAÇÕES, não um segundo estoque.
 * Ela não guarda saldo: guarda que a operação X já foi feita.
 * ============================================================
 */

var AP_TRF_CFG = {
  versao: '1.0.0',
  abaOperacoes: 'ALMOXA_OPERACOES',
  colunas: [
    'opchave',      /* a chave que o cliente manda; é ela que trava */
    'id',           /* o id desta operação */
    'tipo',         /* TRANSFERENCIA, SAIDA_SEGURA, ENTRADA_SEGURA */
    'situacao',     /* EM_CURSO, CONFIRMADA, FALHOU */
    'sku',
    'qtd',
    'origem',
    'destino',
    'documento',
    'obra',
    'responsavel',
    'resultado',    /* o que o estoque respondeu, em texto */
    'movIds',       /* os ids das movimentações geradas */
    'criadoEm',
    'confirmadoEm'
  ],
  /* quanto tempo uma operação pode ficar EM_CURSO antes de eu
     tratá-la como abandonada. Sem isso, uma execução que morreu
     no meio travaria aquela opchave para sempre. */
  minutosParaDestravar: 10
};

function AP_TRF_aba_() {
  return AP_Data_getSheet(AP_TRF_CFG.abaOperacoes, AP_TRF_CFG.colunas);
}

function AP_TRF_achar_(opchave) {
  AP_TRF_aba_();
  var linhas = AP_Data_rows(AP_TRF_CFG.abaOperacoes) || [];
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i].opchave) === String(opchave)) return linhas[i];
  }
  return null;
}

function AP_TRF_minutosDesde_(quando) {
  if (!quando) return 1e9;
  var d = (Object.prototype.toString.call(quando) === '[object Date]')
    ? quando : new Date(String(quando).replace(' ', 'T'));
  if (!d || isNaN(d.getTime())) return 1e9;
  return (Date.now() - d.getTime()) / 60000;
}

/* ============================================================
   A VALIDAÇÃO DO ENDEREÇO
   ------------------------------------------------------------
   "Validar endereço antes de movimentações." Quem sabe de
   endereço é o módulo locais; se ele não existir neste projeto,
   eu digo que não validei em vez de deixar passar calado.
   ============================================================ */
function AP_TRF_validarEndereco_(codigo) {
  var c = String(codigo || '').trim();
  if (!c) return { ok: false, motivo: 'endereço vazio' };
  if (typeof AP_Modulo_locais !== 'function') {
    return { ok: true, validado: false,
             motivo: 'não há módulo locais neste projeto: o endereço "' + c +
                     '" NÃO foi conferido contra o cadastro.' };
  }
  try {
    var r = AP_Modulo_locais('listar', {}, null);
    if (!r || !r.ok) {
      return { ok: true, validado: false,
               motivo: 'o módulo locais não respondeu; endereço não conferido.' };
    }
    var lista = r.dados || r.itens || [];
    for (var i = 0; i < lista.length; i++) {
      var cod = String(lista[i].codigo || lista[i].local || '').trim();
      if (cod.toUpperCase() === c.toUpperCase()) {
        return { ok: true, validado: true, local: lista[i] };
      }
    }
    return { ok: false, validado: true,
             motivo: 'o endereço "' + c + '" não existe no cadastro de localizações.' };
  } catch (e) {
    return { ok: true, validado: false,
             motivo: 'erro ao conferir o endereço: ' + String(e && e.message || e) };
  }
}

/* ============================================================
   O MÓDULO
   ============================================================ */
function AP_Modulo_transferencia(acao, payload, sessao) {
  payload = payload || {};
  try {
    switch (acao) {

      /* ---------- gerar uma chave de operação ---------- */
      case 'novaChave': {
        return { ok: true, dados: {
          opchave: 'OP-' + AP_Utils_generateId('T') + '-' + Date.now(),
          comoUsar: 'mande ESTA MESMA chave em cada nova tentativa da MESMA ' +
                    'operação. É isso que impede gravar duas vezes.'
        } };
      }

      /* ---------- consultar uma operação ---------- */
      case 'situacao': {
        if (!payload.opchave) {
          return { ok: false, codigo: 'SEM_OPCHAVE',
                   mensagem: 'Informe a opchave da operação.' };
        }
        var achada = AP_TRF_achar_(payload.opchave);
        if (!achada) {
          return { ok: true, dados: { existe: false, situacao: 'NUNCA_VISTA',
            mensagem: 'esta operação nunca chegou aqui. Se o seu aplicativo ' +
                      'acha que mandou, a gravação não aconteceu.' } };
        }
        return { ok: true, dados: {
          existe: true, situacao: achada.situacao, id: achada.id,
          movIds: achada.movIds, resultado: achada.resultado,
          criadoEm: achada.criadoEm, confirmadoEm: achada.confirmadoEm
        } };
      }

      /* ---------- A TRANSFERÊNCIA ---------- */
      case 'transferir': {
        var p = payload;
        if (!p.opchave) {
          return { ok: false, codigo: 'SEM_OPCHAVE',
                   mensagem: 'Transferência sem identificador único não passa ' +
                             'por aqui. Peça uma em transferencia.novaChave e ' +
                             'REPITA A MESMA em cada tentativa.' };
        }
        if (!p.sku) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO',
                   mensagem: 'Informe o material.' };
        }
        var qtd = Math.abs(Number(p.qtd) || 0);
        if (!qtd) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO',
                   mensagem: 'Informe uma quantidade maior que zero.' };
        }
        if (!p.origem || !p.destino) {
          return { ok: false, codigo: 'CAMPO_OBRIGATORIO',
                   mensagem: 'Transferência precisa de origem e destino.' };
        }
        if (String(p.origem).trim().toUpperCase() ===
            String(p.destino).trim().toUpperCase()) {
          return { ok: false, codigo: 'ORIGEM_IGUAL_DESTINO',
                   mensagem: 'Origem e destino são o mesmo endereço.' };
        }

        var quem = (sessao && (sessao.usuario || sessao.userId)) || '';
        if (!quem) {
          return { ok: false, codigo: 'SEM_RESPONSAVEL',
                   mensagem: 'Toda movimentação precisa de responsável ' +
                             'identificado. Sem sessão eu não gravo.' };
        }

        /* o endereço é conferido ANTES de encostar no saldo */
        var vO = AP_TRF_validarEndereco_(p.origem);
        if (!vO.ok) {
          return { ok: false, codigo: 'ENDERECO_INVALIDO',
                   mensagem: 'Origem: ' + vO.motivo };
        }
        var vD = AP_TRF_validarEndereco_(p.destino);
        if (!vD.ok) {
          return { ok: false, codigo: 'ENDERECO_INVALIDO',
                   mensagem: 'Destino: ' + vD.motivo };
        }

        return AP_Core_withLock(function () {
          AP_TRF_aba_();

          /* ---------- A TRAVA ---------- */
          var ja = AP_TRF_achar_(p.opchave);
          if (ja) {
            var sit = String(ja.situacao || '').toUpperCase();
            if (sit === 'CONFIRMADA') {
              return { ok: true, repetida: true, dados: {
                id: ja.id, movIds: ja.movIds, situacao: 'CONFIRMADA',
                mensagem: 'Esta transferência JÁ foi feita e confirmada. ' +
                          'Não fiz de novo. O saldo não mudou agora.'
              } };
            }
            if (sit === 'EM_CURSO') {
              var min = AP_TRF_minutosDesde_(ja.criadoEm);
              if (min < AP_TRF_CFG.minutosParaDestravar) {
                return { ok: false, codigo: 'EM_CURSO', repetida: true,
                  mensagem: 'Esta mesma transferência está sendo processada ' +
                            'agora (há ' + Math.round(min) + ' minuto(s)). ' +
                            'Não mandei de novo. Consulte a situação antes ' +
                            'de repetir.' };
              }
              /* abandonada: destravo e sigo, dizendo que destravei */
              AP_Data_update(AP_TRF_CFG.abaOperacoes, ja.id, {
                situacao: 'FALHOU',
                resultado: 'abandonada: ficou EM_CURSO por mais de ' +
                           AP_TRF_CFG.minutosParaDestravar + ' minutos'
              });
            }
            /* FALHOU: deixo tentar de novo, que é o certo */
          }

          /* ---------- registra a INTENÇÃO antes de gravar ---------- */
          var opId = AP_Utils_generateId('TRF');
          AP_Data_append(AP_TRF_CFG.abaOperacoes, {
            opchave: String(p.opchave),
            id: opId,
            tipo: 'TRANSFERENCIA',
            situacao: 'EM_CURSO',
            sku: String(p.sku),
            qtd: qtd,
            origem: String(p.origem),
            destino: String(p.destino),
            documento: String(p.documento || ''),
            obra: String(p.obra || ''),
            responsavel: quem,
            resultado: '',
            movIds: '',
            criadoEm: AP_Utils_now(),
            confirmadoEm: ''
          });

          /* ---------- confere o saldo ANTES ---------- */
          var rItem = AP_Modulo_estoque('item', { sku: p.sku }, sessao);
          if (!rItem || !rItem.ok || !rItem.dados) {
            AP_Data_update(AP_TRF_CFG.abaOperacoes, opId, {
              situacao: 'FALHOU',
              resultado: 'material não encontrado no cadastro'
            });
            return { ok: false, codigo: 'ITEM_NAO_ENCONTRADO',
                     mensagem: 'Material "' + p.sku + '" não está no cadastro.' };
          }
          var saldo = Number(rItem.dados.estoque);
          if (!isFinite(saldo)) saldo = Number(rItem.dados.estoqueAtual) || 0;
          if (qtd > saldo) {
            AP_Data_update(AP_TRF_CFG.abaOperacoes, opId, {
              situacao: 'FALHOU',
              resultado: 'saldo insuficiente: tem ' + saldo + ', pediu ' + qtd
            });
            return { ok: false, codigo: 'SALDO_INSUFICIENTE',
                     mensagem: 'O material tem ' + saldo + ' e a transferência ' +
                               'pede ' + qtd + '.' };
          }

          /* ---------- a movimentação, pelo módulo que já existe ---------- */
          var obs = 'transferência ' + p.origem + ' → ' + p.destino +
                    ' · operação ' + p.opchave;
          var rMov = AP_Modulo_estoque('movimentar', {
            sku: p.sku,
            qtd: qtd,
            tipo: 'TRANSFERENCIA',
            documento: String(p.documento || ''),
            obra: String(p.obra || ''),
            destino: String(p.destino),
            responsavel: quem,
            observacao: obs
          }, sessao);

          if (!rMov || !rMov.ok) {
            AP_Data_update(AP_TRF_CFG.abaOperacoes, opId, {
              situacao: 'FALHOU',
              resultado: String((rMov && rMov.mensagem) || 'o estoque recusou')
            });
            return { ok: false, codigo: (rMov && rMov.codigo) || 'ESTOQUE_RECUSOU',
                     mensagem: (rMov && rMov.mensagem) ||
                               'O módulo de estoque recusou a movimentação.',
                     opchave: p.opchave };
          }

          /* ---------- só AGORA a operação está confirmada ---------- */
          var movId = (rMov.dados && (rMov.dados.id || rMov.dados.movimentacao)) || '';
          AP_Data_update(AP_TRF_CFG.abaOperacoes, opId, {
            situacao: 'CONFIRMADA',
            resultado: 'ok',
            movIds: String(movId),
            confirmadoEm: AP_Utils_now()
          });

          /* ---------- vincula o material ao novo endereço ---------- */
          var vinculo = 'não alterado';
          if (typeof AP_Modulo_locais === 'function') {
            try {
              var rv = AP_Modulo_locais('vincular',
                { sku: p.sku, codigo: p.destino, local: p.destino }, sessao);
              vinculo = (rv && rv.ok) ? 'endereço atualizado para ' + p.destino
                                      : 'o módulo locais recusou: ' +
                                        ((rv && rv.mensagem) || 'sem motivo');
            } catch (e) {
              vinculo = 'erro ao vincular: ' + String(e && e.message || e);
            }
          } else {
            vinculo = 'não há módulo locais neste projeto: o endereço do ' +
                      'material NÃO foi atualizado. O saldo moveu; o cadastro ' +
                      'de localização, não.';
          }

          try {
            AP_Audit_log(quem, 'TRANSFERENCIA',
              p.sku + ' ' + qtd + ' de ' + p.origem + ' para ' + p.destino +
              ' (op ' + p.opchave + ')');
          } catch (e) {}

          return { ok: true, repetida: false, dados: {
            id: opId, opchave: p.opchave, situacao: 'CONFIRMADA',
            sku: p.sku, qtd: qtd, origem: p.origem, destino: p.destino,
            movimentacao: movId,
            saldoAnterior: saldo,
            responsavel: quem,
            vinculoDeEndereco: vinculo,
            enderecoOrigemValidado: vO.validado === true,
            enderecoDestinoValidado: vD.validado === true,
            avisos: [vO.motivo, vD.motivo].filter(function (x) { return !!x; })
          } };
        });
      }

      /* ---------- o histórico das operações ---------- */
      case 'historico': {
        AP_TRF_aba_();
        var todas = AP_Data_rows(AP_TRF_CFG.abaOperacoes) || [];
        if (payload.sku) {
          todas = todas.filter(function (x) {
            return String(x.sku) === String(payload.sku);
          });
        }
        if (payload.situacao) {
          todas = todas.filter(function (x) {
            return String(x.situacao).toUpperCase() ===
                   String(payload.situacao).toUpperCase();
          });
        }
        todas.sort(function (a, b) {
          return String(b.criadoEm).localeCompare(String(a.criadoEm));
        });
        return { ok: true, dados: todas.slice(0, Number(payload.limite) || 200) };
      }

      case 'diagnostico': {
        return { ok: true, dados: {
          modulo: 'transferencia', versao: AP_TRF_CFG.versao,
          abaOperacoes: AP_TRF_CFG.abaOperacoes,
          dependencias: {
            AP_Modulo_estoque: (typeof AP_Modulo_estoque === 'function'),
            AP_Modulo_locais: (typeof AP_Modulo_locais === 'function'),
            AP_Data_rows: (typeof AP_Data_rows === 'function'),
            AP_Core_withLock: (typeof AP_Core_withLock === 'function')
          },
          /* dito por escrito, porque muda o que a transferência faz */
          avisoLocais: (typeof AP_Modulo_locais === 'function')
            ? 'o módulo locais existe: o endereço do material é atualizado.'
            : 'NÃO há módulo locais neste projeto. A transferência move o ' +
              'saldo, mas o endereço do material no cadastro NÃO muda.'
        } };
      }

      default:
        return { ok: false, codigo: 'ACAO_DESCONHECIDA',
                 mensagem: 'O módulo transferencia não conhece "' + acao + '". ' +
                           'Ações: novaChave, transferir, situacao, historico, ' +
                           'diagnostico.' };
    }
  } catch (e) {
    return { ok: false, codigo: 'ERRO_NO_MODULO',
             mensagem: String((e && e.message) || e),
             onde: 'AP_Modulo_transferencia(' + acao + ')' };
  }
}

/* ============================================================
   TESTES EXECUTÁVEIS NO APPS SCRIPT
   ============================================================ */
function AP_TRF_dizer_(titulo, r) {
  Logger.log('--- ' + titulo + ' ---\n' + JSON.stringify(r, null, 2));
  return r;
}

function testeTransferenciaInstalacao() {
  var r = AP_Modulo_transferencia('diagnostico', {}, null);
  if (!r.ok) return AP_TRF_dizer_('FALHA', r);
  var faltam = [];
  for (var k in r.dados.dependencias) {
    if (!r.dados.dependencias[k] && k !== 'AP_Modulo_locais') faltam.push(k);
  }
  return AP_TRF_dizer_('INSTALACAO', {
    ok: faltam.length === 0,
    veredito: faltam.length === 0
      ? 'instalado e enxergando o que precisa. ' + r.dados.avisoLocais
      : 'CONTRATO INCOMPATÍVEL: faltam ' + faltam.join(', '),
    detalhe: r.dados
  });
}

/** prova que a MESMA opchave não grava duas vezes.
    USA UM MATERIAL DE TESTE: troque o sku abaixo pelo seu. */
function testeOperacaoTransferencia() {
  var SKU_DE_TESTE = 'TESTE-001';
  var rItem = AP_Modulo_estoque('item', { sku: SKU_DE_TESTE }, null);
  if (!rItem || !rItem.ok) {
    return AP_TRF_dizer_('TRANSFERENCIA', {
      ok: false,
      veredito: 'DADOS INEXISTENTES: não há material "' + SKU_DE_TESTE +
                '" no cadastro. Crie um item de teste ou troque o SKU no ' +
                'topo desta função. NÃO vou testar gravação em material real.'
    });
  }
  var chave = AP_Modulo_transferencia('novaChave', {}, null).dados.opchave;
  var sessao = { usuario: 'teste-transferencia' };
  var dados = { opchave: chave, sku: SKU_DE_TESTE, qtd: 1,
                origem: 'TESTE-A', destino: 'TESTE-B' };

  var um = AP_Modulo_transferencia('transferir', dados, sessao);
  var dois = AP_Modulo_transferencia('transferir', dados, sessao);

  return AP_TRF_dizer_('TRANSFERENCIA', {
    ok: um.ok === true && dois.ok === true && dois.repetida === true,
    veredito: (dois.repetida === true)
      ? 'A segunda chamada com a MESMA opchave foi reconhecida como repetida ' +
        'e NÃO mexeu no saldo. A trava funciona.'
      : 'PROBLEMA: a segunda chamada não foi reconhecida como repetida.',
    primeira: um, segunda: dois
  });
}

function testeTransferenciaValidacoes() {
  var s = { usuario: 'teste' };
  var casos = {
    semChave: AP_Modulo_transferencia('transferir',
      { sku: 'X', qtd: 1, origem: 'A', destino: 'B' }, s),
    semSessao: AP_Modulo_transferencia('transferir',
      { opchave: 'k1', sku: 'X', qtd: 1, origem: 'A', destino: 'B' }, null),
    mesmoEndereco: AP_Modulo_transferencia('transferir',
      { opchave: 'k2', sku: 'X', qtd: 1, origem: 'A', destino: 'A' }, s),
    qtdZero: AP_Modulo_transferencia('transferir',
      { opchave: 'k3', sku: 'X', qtd: 0, origem: 'A', destino: 'B' }, s)
  };
  var esperado = {
    semChave: 'SEM_OPCHAVE', semSessao: 'SEM_RESPONSAVEL',
    mesmoEndereco: 'ORIGEM_IGUAL_DESTINO', qtdZero: 'CAMPO_OBRIGATORIO'
  };
  var erradas = [];
  for (var k in esperado) {
    if (casos[k].codigo !== esperado[k]) {
      erradas.push(k + ': esperava ' + esperado[k] + ', veio ' + casos[k].codigo);
    }
  }
  return AP_TRF_dizer_('VALIDACOES', {
    ok: erradas.length === 0,
    veredito: erradas.length === 0
      ? 'as quatro recusas acontecem antes de encostar no saldo.'
      : 'PROBLEMA: ' + erradas.join(' | '),
    detalhe: casos
  });
}
