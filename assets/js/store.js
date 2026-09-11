/* store.js — estado da aplicação e persistência dos conjuntos de bancos.
   Namespace global `ST`. */
(function (global) {
  'use strict';
  var U = global.U;

  var CHAVE_GRUPOS = 'ifdata.grupos.v1';
  var CHAVE_PREFS = 'ifdata.prefs.v1';

  var estado = {
    anoMes: U.latestLikelyPeriod(),
    tipo: 1,
    relatorio: '1',
    anualizar: true,
    escopoS1S2: true,             // Risk Bench trabalha com S1 e S2
    modulo: 'ifdata',             // ifdata | publicacoes
    escala: 1,
    modo: 'auto',                 // auto | live | demo
    base: null,                   // URL alternativa da API
    overridesCampos: {},          // campoCanonico -> nome de coluna
    dataset: null,                // último resultado normalizado
    relatorios: [],
    grupoAtivo: null,
    grupos: []
  };

  var ouvintes = [];
  function on(fn) { ouvintes.push(fn); return function () { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); }; }
  function emit(evento) { ouvintes.forEach(function (fn) { try { fn(evento, estado); } catch (e) { console.error(e); } }); }

  function set(patch, evento) {
    Object.assign(estado, patch);
    emit(evento || 'estado');
  }

  /* ------------------------------ prefs -------------------------------- */

  function salvarPrefs() {
    try {
      localStorage.setItem(CHAVE_PREFS, JSON.stringify({
        anoMes: estado.anoMes, tipo: estado.tipo, relatorio: estado.relatorio,
        anualizar: estado.anualizar, modo: estado.modo, base: estado.base,
        escopoS1S2: estado.escopoS1S2, modulo: estado.modulo, escala: estado.escala
      }));
    } catch (e) {}
  }
  function carregarPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(CHAVE_PREFS) || 'null');
      if (!p) return null;
      if (p.anoMes) estado.anoMes = p.anoMes;
      if (p.tipo) estado.tipo = Number(p.tipo);
      if (p.relatorio) estado.relatorio = String(p.relatorio);
      if (typeof p.anualizar === 'boolean') estado.anualizar = p.anualizar;
      if (p.modo) estado.modo = p.modo;
      if (p.base) estado.base = p.base;
      if (typeof p.escopoS1S2 === 'boolean') estado.escopoS1S2 = p.escopoS1S2;
      if (p.modulo) estado.modulo = p.modulo;
      if (p.escala) estado.escala = Number(p.escala);
      return p;
    } catch (e) { return null; }
  }

  /* ------------------------------ grupos -------------------------------- */

  function carregarGrupos() {
    try {
      var g = JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || '[]');
      estado.grupos = Array.isArray(g) ? g : [];
    } catch (e) { estado.grupos = []; }
    return estado.grupos;
  }

  function salvarGrupos() {
    try { localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(estado.grupos)); }
    catch (e) { global.UI && global.UI.toast('Não foi possível salvar os grupos neste navegador.', 'bad'); }
    emit('grupos');
  }

  function criarGrupo(nome, membros, descricao) {
    var g = {
      id: U.uid('grp'),
      nome: nome || 'Novo conjunto',
      descricao: descricao || '',
      membros: (membros || []).map(function (m) {
        return typeof m === 'string' ? { id: m, nome: m } : { id: String(m.id), nome: m.nome || String(m.id) };
      }),
      criadoEm: new Date().toISOString()
    };
    estado.grupos.push(g);
    salvarGrupos();
    return g;
  }

  function atualizarGrupo(id, patch) {
    var g = estado.grupos.find(function (x) { return x.id === id; });
    if (!g) return null;
    Object.assign(g, patch);
    g.atualizadoEm = new Date().toISOString();
    salvarGrupos();
    return g;
  }

  function removerGrupo(id) {
    estado.grupos = estado.grupos.filter(function (g) { return g.id !== id; });
    if (estado.grupoAtivo === id) estado.grupoAtivo = null;
    salvarGrupos();
  }

  function grupo(id) { return estado.grupos.find(function (g) { return g.id === id; }) || null; }

  function duplicarGrupo(id) {
    var g = grupo(id);
    if (!g) return null;
    return criarGrupo(g.nome + ' (cópia)', g.membros.slice(), g.descricao);
  }

  function exportarGrupos() {
    return JSON.stringify({ versao: 1, exportadoEm: new Date().toISOString(),
                            grupos: estado.grupos }, null, 2);
  }

  function importarGrupos(texto, substituir) {
    var obj = JSON.parse(texto);
    var lista = Array.isArray(obj) ? obj : (obj && obj.grupos) || [];
    if (!Array.isArray(lista)) throw new Error('Formato não reconhecido.');
    var limpos = lista.map(function (g) {
      return {
        id: U.uid('grp'),
        nome: String(g.nome || 'Conjunto importado'),
        descricao: String(g.descricao || ''),
        membros: (g.membros || []).map(function (m) {
          return typeof m === 'string' ? { id: m, nome: m } : { id: String(m.id), nome: String(m.nome || m.id) };
        }),
        criadoEm: new Date().toISOString()
      };
    }).filter(function (g) { return g.membros.length; });
    estado.grupos = substituir ? limpos : estado.grupos.concat(limpos);
    salvarGrupos();
    return limpos.length;
  }

  /** Conjuntos sugeridos, montados a partir do dataset em tela (por tamanho). */
  function sugerirGrupos(rows, campoAtivo) {
    if (!rows || !rows.length || !campoAtivo) return [];
    var ordenado = rows.slice().sort(function (a, b) {
      return (U.toNumber(b[campoAtivo]) || 0) - (U.toNumber(a[campoAtivo]) || 0);
    });
    function fatia(ini, fim) {
      return ordenado.slice(ini, fim).map(function (r) { return { id: r.__id, nome: r.__nome }; });
    }
    return [
      { nome: 'Top 5 por ativo', membros: fatia(0, 5),
        descricao: 'Cinco maiores instituições do recorte atual.' },
      { nome: 'Top 10 por ativo', membros: fatia(0, 10),
        descricao: 'Dez maiores instituições do recorte atual.' },
      { nome: '6º ao 20º por ativo', membros: fatia(5, 20),
        descricao: 'Faixa de médio porte — peers típicos fora do bloco dos cinco maiores.' },
      { nome: 'Cauda (fora do top 20)', membros: fatia(20, 60),
        descricao: 'Instituições menores do recorte atual.' }
    ].filter(function (g) { return g.membros.length >= 2; });
  }

  global.ST = {
    estado: estado, on: on, set: set, emit: emit,
    salvarPrefs: salvarPrefs, carregarPrefs: carregarPrefs,
    carregarGrupos: carregarGrupos, salvarGrupos: salvarGrupos,
    criarGrupo: criarGrupo, atualizarGrupo: atualizarGrupo, removerGrupo: removerGrupo,
    grupo: grupo, duplicarGrupo: duplicarGrupo,
    exportarGrupos: exportarGrupos, importarGrupos: importarGrupos,
    sugerirGrupos: sugerirGrupos
  };
})(window);
