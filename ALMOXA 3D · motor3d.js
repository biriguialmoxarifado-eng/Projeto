/* ============================================================
   ALMOXA 3D · motor3d.js  ·  08/11/2026
   ------------------------------------------------------------
   O MOTOR BABYLON.

   Este arquivo não calcula nada: ele recebe a lista de peças
   pronta do layout3d.js e transforma em malha. Toda a conta de
   onde fica cada montante e cada posição está lá, e é testada
   em Node sem precisar de placa de vídeo.

   Aqui mora só o que é Babylon de verdade: cena, câmera, luz,
   sombra, material, instância e clique.

   DESEMPENHO · seção 15. Um almoxarifado de 5.000 posições são
   5.000 caixas iguais. Criar 5.000 malhas separadas derruba
   celular. Então as posições são INSTÂNCIAS de um mesmo molde,
   uma por cor: a placa de vídeo desenha milhares de cópias num
   lance só. Montante, longarina e prateleira seguem a mesma
   ideia.
   ============================================================ */
(function (raiz) {
  'use strict';

  var M = {
    nome: 'MOTOR3D',
    versao: '08/11',
    engine: null,
    cena: null,
    camera: null,
    moldes: {},
    instancias: [],
    porCodigo: {},
    selecionada: null,
    corDaSelecionada: null,
    aoSelecionar: null,     /* função que a tela registra */
    pronto: false
  };

  function B() {
    if (typeof BABYLON === 'undefined') {
      throw new Error('O Babylon.js não carregou. Confira a conexão e o endereço da biblioteca.');
    }
    return BABYLON;
  }

  function cor3(hex) {
    return B().Color3.FromHexString(hex || '#888888');
  }

  /* ----------------------------------------------------------
     A CENA
     ---------------------------------------------------------- */
  M.iniciar = function (canvas, opcoes) {
    opcoes = opcoes || {};
    var b = B();

    M.engine = new b.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      /* no celular, metade dos pixels é o suficiente e dobra o fôlego */
      adaptToDeviceRatio: true
    });

    var cena = new b.Scene(M.engine);
    cena.clearColor = b.Color4.FromHexString((opcoes.fundo || '#EEF1F5') + 'FF');
    M.cena = cena;

    /* câmera orbital · seção 1 */
    var cam = new b.ArcRotateCamera('cam',
      -Math.PI / 4, Math.PI / 3.2, 28,
      new b.Vector3(0, 1.2, 0), cena);
    cam.attachControl(canvas, true);
    cam.lowerBetaLimit = 0.12;
    cam.upperBetaLimit = Math.PI / 2.05;   /* não deixa passar por baixo do piso */
    cam.lowerRadiusLimit = 3;
    cam.upperRadiusLimit = 220;
    cam.wheelDeltaPercentage = 0.02;
    cam.pinchDeltaPercentage = 0.02;       /* pinça no celular */
    cam.panningSensibility = 80;
    M.camera = cam;

    /* luz: uma geral e uma direcional que lança sombra */
    var ceu = new b.HemisphericLight('ceu', new b.Vector3(0, 1, 0), cena);
    ceu.intensity = 0.78;
    ceu.groundColor = cor3('#B9C0C9');

    var sol = new b.DirectionalLight('sol', new b.Vector3(-0.5, -1, -0.35), cena);
    sol.position = new b.Vector3(40, 60, 40);
    sol.intensity = 0.65;
    M.sol = sol;

    if (opcoes.sombras !== false) {
      M.sombra = new b.ShadowGenerator(1024, sol);
      M.sombra.useBlurExponentialShadowMap = true;
      M.sombra.blurKernel = 16;
    }

    M.engine.runRenderLoop(function () { cena.render(); });
    raiz.addEventListener('resize', function () { M.engine.resize(); });

    cena.onPointerObservable.add(function (info) {
      if (info.type !== b.PointerEventTypes.POINTERPICK) return;
      var m = info.pickInfo && info.pickInfo.pickedMesh;
      M.clicar(m);
    });

    M.pronto = true;
    return M;
  };

  /* ----------------------------------------------------------
     MATERIAIS E MOLDES
     ---------------------------------------------------------- */
  function material(nome, hex, opcoes) {
    opcoes = opcoes || {};
    var b = B();
    var chave = 'mat:' + nome;
    if (M.moldes[chave]) return M.moldes[chave];
    var mat = new b.StandardMaterial(nome, M.cena);
    mat.diffuseColor = cor3(hex);
    mat.specularColor = cor3(opcoes.brilho || '#2A2A2A');
    if (opcoes.emissivo) mat.emissiveColor = cor3(opcoes.emissivo);
    mat.freeze();
    M.moldes[chave] = mat;
    return mat;
  }

  /** um molde por combinação de tamanho+cor; o resto vira instância */
  function molde(peca) {
    var b = B();
    var chave = [peca.tipo, peca.lx.toFixed(3), peca.ly.toFixed(3),
                 peca.lz.toFixed(3), peca.cor].join('|');
    if (M.moldes[chave]) return M.moldes[chave];

    var caixa = b.MeshBuilder.CreateBox('molde_' + peca.tipo, {
      width: peca.lx, height: peca.ly, depth: peca.lz
    }, M.cena);
    caixa.material = material('m_' + peca.tipo + '_' + peca.cor, peca.cor,
      { brilho: peca.tipo === 'piso' ? '#0A0A0A' : '#303030' });
    caixa.isVisible = false;                 /* o molde não aparece */
    caixa.isPickable = false;
    M.moldes[chave] = caixa;
    return caixa;
  }

  /* ----------------------------------------------------------
     DESENHAR o galpão a partir da montagem do layout3d
     ---------------------------------------------------------- */
  M.desenhar = function (montagem) {
    if (!M.cena) throw new Error('A cena não foi iniciada.');
    var b = B();
    M.limpar();

    var pecas = (montagem && montagem.pecas) || [];
    for (var i = 0; i < pecas.length; i++) {
      var p = pecas[i];
      var base = molde(p);
      var inst = base.createInstance('i_' + p.id);
      inst.position = new b.Vector3(p.x, p.y, p.z);
      inst.isPickable = !!p.clicavel;
      inst.metadata = p;

      if (M.sombra && p.tipo !== 'piso') {
        try { M.sombra.addShadowCaster(inst); } catch (e) { }
      }
      if (p.tipo === 'piso') {
        inst.receiveShadows = true;
      }

      M.instancias.push(inst);
      if (p.tipo === 'posicao' && p.codigo) M.porCodigo[p.codigo] = inst;
    }

    /* enquadra o galpão inteiro na primeira vez */
    var g = (montagem && montagem.galpao) || { largura: 20, profundidade: 20, altura: 4 };
    M.camera.setTarget(new b.Vector3(g.largura / 2, g.altura / 3, g.profundidade / 2));
    M.camera.radius = Math.max(g.largura, g.profundidade) * 1.15 + 8;

    return { instancias: M.instancias.length, moldes: Object.keys(M.moldes).length };
  };

  M.limpar = function () {
    for (var i = 0; i < M.instancias.length; i++) {
      try { M.instancias[i].dispose(); } catch (e) { }
    }
    M.instancias = [];
    M.porCodigo = {};
    M.selecionada = null;
    M.corDaSelecionada = null;
  };

  /* ----------------------------------------------------------
     SELEÇÃO · azul, e devolve a cor de antes ao sair
     ---------------------------------------------------------- */
  M.clicar = function (malha) {
    if (M.selecionada) {
      try { M.selecionada.instancedBuffers = M.selecionada.instancedBuffers; } catch (e) { }
      M.destacar(M.selecionada, false);
      M.selecionada = null;
    }
    if (!malha || !malha.metadata || malha.metadata.tipo !== 'posicao') {
      if (typeof M.aoSelecionar === 'function') M.aoSelecionar(null);
      return null;
    }
    M.selecionada = malha;
    M.destacar(malha, true);
    if (typeof M.aoSelecionar === 'function') M.aoSelecionar(malha.metadata);
    return malha.metadata;
  };

  /** o destaque é uma moldura, não troca de cor: assim o verde
      continua verde e o usuário não perde a leitura da ocupação */
  M.destacar = function (malha, ligado) {
    var b = B();
    if (!M.realce) {
      M.realce = new b.HighlightLayer('realce', M.cena, { blurHorizontalSize: 0.6 });
    }
    try {
      if (ligado) M.realce.addMesh(malha.sourceMesh || malha, cor3('#2F7BE8'));
      else M.realce.removeMesh(malha.sourceMesh || malha);
    } catch (e) { }
  };

  M.selecionarPorCodigo = function (codigo) {
    var m = M.porCodigo[codigo];
    if (!m) return null;
    return M.clicar(m);
  };

  /* ----------------------------------------------------------
     AS VISÕES · seção 8
     ---------------------------------------------------------- */
  M.visao = function (qual, galpao) {
    if (!M.camera) return;
    var g = galpao || { largura: 20, profundidade: 20, altura: 4 };
    var longe = Math.max(g.largura, g.profundidade) * 1.15 + 8;
    var a = { superior: [-Math.PI / 2, 0.02], frontal: [-Math.PI / 2, Math.PI / 2.1],
              lateral: [0, Math.PI / 2.1], perspectiva: [-Math.PI / 4, Math.PI / 3.2] };
    var v = a[qual] || a.perspectiva;
    M.camera.alpha = v[0];
    M.camera.beta = v[1];
    M.camera.radius = longe;
  };

  M.foto = function () {
    try { return M.engine && M.cena ? M.cena.getEngine().getRenderingCanvas().toDataURL() : ''; }
    catch (e) { return ''; }
  };

  M.parar = function () {
    try { M.engine && M.engine.stopRenderLoop(); } catch (e) { }
    try { M.cena && M.cena.dispose(); } catch (e) { }
    try { M.engine && M.engine.dispose(); } catch (e) { }
    M.pronto = false;
  };

  raiz.MOTOR3D = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;

})(typeof window !== 'undefined' ? window : globalThis);
