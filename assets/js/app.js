/* app.js — inicialização, barra de filtros global e navegação entre telas. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, API = global.API,
      CAT = global.CAT, VW = global.VW, CH = global.CH;

  var instancias = {};
  var telaAtual = null;
  var refs = {};

  /* ------------------------------- módulos --------------------------------- */

  var MODULOS = [
    { id: 'ifdata', nome: 'IF.data',
      sub: 'Dados do Banco Central · bancos S1 e S2' },
    { id: 'publicacoes', nome: 'Publicações',
      sub: 'BR GAAP · IFRS · Pilar 3 · 20-F — conciliação entre fontes' }
  ];

  function moduloAtual() { return ST.estado.modulo || 'ifdata'; }

  function redesenharGraficos() {
    U.$$('.chart').forEach(function (c) { if (c.__redraw) c.__redraw(); });
  }

  /* ------------------------------ barra superior --------------------------- */

  function montarTopo() {
    var topo = U.$('#topbar');
    U.clear(topo);
    refs.brandSub = U.el('span', { class: 'brand__sub', text: '' });
    topo.appendChild(U.el('div', { class: 'brand' }, [
      U.el('span', { class: 'brand__mark', text: 'Risk Bench' }),
      refs.brandSub
    ]));
    topo.appendChild(U.el('div', { class: 'topbar__spacer' }));

    var ferramentas = U.el('div', { class: 'topbar__tools' });
    ferramentas.appendChild(UI.segmentado(
      MODULOS.map(function (m) { return { label: m.nome, value: m.id, hint: m.sub }; }),
      moduloAtual(), trocarModulo));

    refs.badge = U.el('span', { class: 'badge', text: '—' });
    ferramentas.appendChild(refs.badge);
    if (!global.IFDATA_FORCAR_DEMO) {
      ferramentas.appendChild(UI.segmentado([
        { label: 'API do BCB', value: 'live', hint: 'Consulta olinda.bcb.gov.br em tempo real' },
        { label: 'Demonstração', value: 'demo', hint: 'Dados sintéticos, sem rede' }
      ], ST.estado.modo === 'demo' ? 'demo' : 'live', definirModo));
    }
    topo.appendChild(ferramentas);
    atualizarBadge();
    atualizarSubtitulo();
  }

  function atualizarSubtitulo() {
    if (!refs.brandSub) return;
    var m = MODULOS.find(function (x) { return x.id === moduloAtual(); });
    refs.brandSub.textContent = m ? m.sub : '';
  }

  function trocarModulo(id) {
    if (id === moduloAtual()) return;
    ST.set({ modulo: id });
    ST.salvarPrefs();
    atualizarSubtitulo();
    montarFiltros();
    montarAbas();
    irPara((VW.todas(id)[0] || {}).id);
  }

  function atualizarBadge() {
    if (!refs.badge) return;
    var demo = ST.estado.modo === 'demo';
    refs.badge.className = 'badge ' + (demo ? 'badge--demo' : 'badge--live');
    refs.badge.textContent = demo ? 'dados sintéticos' : 'dados do BCB';
  }

  function definirModo(modo) {
    ST.set({ modo: modo });
    API.configurar({ modo: modo });
    ST.salvarPrefs();
    atualizarBadge();
    recarregar();                       // a tela não espera a descoberta da lista
    carregarRelatorios().then(function (trocou) { if (trocou) recarregar(); });
  }

  /* ------------------------------ filtros globais --------------------------- */

  function montarFiltros() {
    var barra = U.$('#filtros');
    U.clear(barra);

    // O módulo de publicações tem seus próprios recortes, dentro de cada tela.
    barra.hidden = moduloAtual() !== 'ifdata';
    if (barra.hidden) return;

    refs.selPeriodo = UI.seletor(
      U.allPeriods(2000).map(function (p) { return { value: p, label: U.periodLabel(p) }; }),
      ST.estado.anoMes,
      function (v) { ST.set({ anoMes: v }); ST.salvarPrefs(); recarregar(); });
    barra.appendChild(UI.campo('Data-base', refs.selPeriodo));

    refs.selTipo = UI.seletor(
      CAT.TIPOS_INSTITUICAO.map(function (t) { return { value: String(t.id), label: t.curto + ' — ' + t.nome }; }),
      String(ST.estado.tipo),
      function (v) {
        ST.set({ tipo: Number(v) });
        ST.salvarPrefs();
        recarregar();
        carregarRelatorios().then(function (trocou) { if (trocou) recarregar(); });
      }, { style: 'max-width:340px' });
    barra.appendChild(UI.campo('Tipo de instituição', refs.selTipo));

    refs.selRelatorio = UI.seletor([{ value: ST.estado.relatorio, label: 'Carregando…' }],
      ST.estado.relatorio,
      function (v) { ST.set({ relatorio: v }); ST.salvarPrefs(); recarregar(); },
      { style: 'min-width:280px;max-width:420px' });
    barra.appendChild(UI.campo('Relatório', refs.selRelatorio, 'grow'));

    refs.selEscala = UI.seletor(VW.ESCALAS, String(ST.estado.escala || 1), function (v) {
      ST.set({ escala: Number(v) }); recarregar();
    }, { style: 'max-width:200px' });
    barra.appendChild(UI.campo('Escala dos valores', refs.selEscala));

    barra.appendChild(U.el('div', { class: 'filterbar__actions' }, [
      UI.alternador('Escopo S1/S2', ST.estado.escopoS1S2 !== false, function (v) {
        ST.set({ escopoS1S2: v }); ST.salvarPrefs(); recarregar();
      }, 'Restringe a análise aos segmentos prudenciais S1 e S2, conforme a Segmentação do BCB.'),
      UI.alternador('Anualizar resultados', ST.estado.anualizar, function (v) {
        ST.set({ anualizar: v }); ST.salvarPrefs(); recarregar();
      }, 'A DRE do IF.data é acumulada no ano: marque para converter o resultado em base anual (×12/mês).'),
      U.el('button', { class: 'btn', text: 'Atualizar', title: 'Refaz a consulta ignorando o cache',
        onclick: function () { API.limparCache(); VW.reiniciarSegmentos(); recarregar(); } })
    ]));
  }

  /** Descobre a lista de relatórios em segundo plano.
      Resolve com `true` quando a descoberta trocou o relatório selecionado —
      só nesse caso vale recarregar a tela. */
  function carregarRelatorios() {
    return API.listaRelatorios(ST.estado.anoMes, ST.estado.tipo).then(function (lista) {
      ST.set({ relatorios: lista });
      if (!refs.selRelatorio) return false;
      var atual = ST.estado.relatorio;
      var existe = lista.some(function (r) { return String(r.id) === String(atual); });
      var trocou = false;
      if (!existe && lista.length) {
        atual = lista[0].id;
        ST.set({ relatorio: atual });
        trocou = true;
      }
      var novo = UI.seletor(
        lista.map(function (r) { return { value: String(r.id), label: r.id + ' · ' + r.nome }; }),
        String(atual),
        function (v) { ST.set({ relatorio: v }); ST.salvarPrefs(); recarregar(); },
        { style: 'min-width:280px;max-width:420px' });
      refs.selRelatorio.parentNode.replaceChild(novo, refs.selRelatorio);
      refs.selRelatorio = novo;
      if (lista[0] && lista[0].origem === 'fallback') {
        refs.selRelatorio.title = 'Lista do catálogo interno — a API não devolveu ListaDeRelatorio.';
      }
      return trocou;
    }).catch(function () { return false; });
  }

  /* --------------------------------- abas ---------------------------------- */

  function montarAbas() {
    var abas = U.$('#abas');
    U.clear(abas);
    VW.todas(moduloAtual()).forEach(function (v) {
      abas.appendChild(U.el('button', {
        class: 'tab', role: 'tab', id: 'tab-' + v.id, title: v.descricao,
        'aria-selected': 'false', 'aria-controls': 'view-' + v.id,
        text: v.titulo,
        onclick: function () { irPara(v.id); }
      }));
    });

    var main = U.$('#telas');
    U.clear(main);
    instancias = {};
    VW.todas(moduloAtual()).forEach(function (v) {
      main.appendChild(U.el('section', {
        class: 'view', id: 'view-' + v.id, role: 'tabpanel',
        'aria-labelledby': 'tab-' + v.id, hidden: true
      }));
    });
  }

  function irPara(id) {
    var doModulo = VW.todas(moduloAtual());
    var alvo = doModulo.find(function (v) { return v.id === id; }) || doModulo[0];
    if (!alvo) return;
    telaAtual = alvo.id;
    if (location.hash !== '#/' + alvo.id) history.replaceState(null, '', '#/' + alvo.id);

    doModulo.forEach(function (v) {
      var aba = U.$('#tab-' + v.id);
      var secao = U.$('#view-' + v.id);
      var ativo = v.id === alvo.id;
      if (aba) aba.setAttribute('aria-selected', ativo ? 'true' : 'false');
      if (secao) secao.hidden = !ativo;
    });

    var secao = U.$('#view-' + alvo.id);
    if (!instancias[alvo.id]) instancias[alvo.id] = alvo.montar(secao) || {};
    else if (instancias[alvo.id].atualizar && secao.dataset.sujo === '1') {
      secao.dataset.sujo = '0';
      instancias[alvo.id].atualizar();
    }
    redesenharGraficos();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /** Marca todas as telas como desatualizadas e recarrega a que está visível. */
  function recarregar() {
    CH.hideTip();
    VW.todas(moduloAtual()).forEach(function (v) {
      var secao = U.$('#view-' + v.id);
      if (secao) secao.dataset.sujo = '1';
    });
    if (telaAtual && instancias[telaAtual] && instancias[telaAtual].atualizar) {
      var secao = U.$('#view-' + telaAtual);
      if (secao) secao.dataset.sujo = '0';
      instancias[telaAtual].atualizar();
    }
  }

  /* ------------------------------- inicialização ---------------------------- */

  function iniciar() {
    var prefs = ST.carregarPrefs();
    ST.carregarGrupos();
    if (!ST.estado.escala) ST.estado.escala = 1;
    if (ST.estado.escopoS1S2 === undefined) ST.estado.escopoS1S2 = true;
    if (!ST.estado.modulo) ST.estado.modulo = 'ifdata';
    global.PST.carregar();
    // Alguns ambientes de publicação bloqueiam qualquer chamada a domínio
    // externo. Quem hospeda a página nesse tipo de ambiente define esta
    // variável antes dos scripts: a interface trava no modo demonstração em
    // vez de oferecer um botão "API do BCB" que só falharia.
    if (global.IFDATA_FORCAR_DEMO) ST.estado.modo = 'demo';
    API.configurar({
      base: ST.estado.base || API.BASE_PADRAO,
      modo: ST.estado.modo === 'demo' ? 'demo' : 'live'
    });

    montarTopo();
    montarFiltros();
    montarAbas();

    API.on(function (ev) {
      if (ev.tipo === 'aviso') UI.toast(ev.msg, 'warn', 6000);
    });

    window.addEventListener('hashchange', function () {
      var id = (location.hash || '').replace('#/', '');
      if (id && id !== telaAtual) irPara(id);
    });

    // Monta a tela imediatamente: a descoberta da lista de relatórios corre em
    // paralelo e só força um recarregamento se trocar o relatório selecionado.
    var inicial = (location.hash || '').replace('#/', '') || 'consulta';
    irPara(inicial);
    carregarRelatorios().then(function (trocou) { if (trocou) recarregar(); });

  }

  global.APP = {
    iniciar: iniciar, irPara: irPara, recarregar: recarregar, trocarModulo: trocarModulo,
    definirModo: definirModo, redesenharGraficos: redesenharGraficos, MODULOS: MODULOS
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
