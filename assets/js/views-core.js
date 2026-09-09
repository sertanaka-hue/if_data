/* views-core.js — infraestrutura compartilhada pelas telas. Namespace `VW`. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, API = global.API, CAT = global.CAT;

  var registradas = [];
  function registrar(v) { registradas.push(v); return v; }
  function todas() { return registradas; }

  /* --------------------------- guarda de render -------------------------- */

  /** Cada render de uma tela recebe uma geração; respostas de uma consulta
      anterior que cheguem atrasadas são descartadas em vez de sobrescrever a
      tela atual (a API faz retentativas e pode demorar dezenas de segundos). */
  function novaGeracao(node) {
    node.__gen = (node.__gen || 0) + 1;
    var minha = node.__gen;
    return function () { return node.__gen === minha; };
  }

  /* --------------------------- contexto atual --------------------------- */

  function ctx() {
    return {
      anoMes: ST.estado.anoMes,
      tipo: ST.estado.tipo,
      relatorio: ST.estado.relatorio,
      anualizar: ST.estado.anualizar
    };
  }

  /* ------------------------ carga do dataset ---------------------------- */

  /** Carrega o relatório do contexto e resolve os campos canônicos. */
  function carregar(opts) {
    var o = opts || {};
    var c = ctx();
    return API.valores(c.anoMes, c.tipo, c.relatorio).then(function (d) {
      var res = CAT.resolveFields(d.columns, ST.estado.overridesCampos);
      var dataset = {
        anoMes: c.anoMes, tipo: c.tipo, relatorio: c.relatorio,
        rows: d.rows, columns: d.columns, metaColumns: d.metaColumns,
        forma: d.forma, demo: !!d.demo, url: d.url, bruto: d.bruto,
        campos: res.map, scoreCampos: res.score, semUso: res.unmatched
      };
      if (!o.naoGuardar) ST.set({ dataset: dataset }, 'dataset');
      return dataset;
    });
  }

  /** Carrega o mesmo relatório em vários períodos. */
  function carregarSerie(periodos, onProgress) {
    var c = ctx();
    return API.serie(periodos, c.tipo, c.relatorio, onProgress).then(function (lista) {
      return lista.map(function (p) {
        var res = CAT.resolveFields(p.dados.columns || [], ST.estado.overridesCampos);
        return { anoMes: p.anoMes, erro: p.erro, rows: p.dados.rows || [],
                 columns: p.dados.columns || [], campos: res.map };
      });
    });
  }

  /* ------------------------ escala e formatação -------------------------- */

  var ESCALAS = [
    { value: '1', label: 'Como vem da API', hint: 'O IF.data publica os saldos em R$ mil.' },
    { value: '1000', label: '× 1.000 (para R$)', hint: 'Converte R$ mil em reais.' },
    { value: '0.001', label: '÷ 1.000 (para R$ milhões)', hint: 'Converte R$ mil em R$ milhões.' }
  ];

  var PAD_RAZAO = /(indice|razao|percentual|taxa|ratio|%|quantidade|numero|qtd)/;

  /** Colunas que são índices/contagens não devem ser reescaladas nem somadas. */
  function ehRazao(coluna) {
    var n = U.norm(coluna);
    if (/^(indice|razao)/.test(n)) return true;
    return PAD_RAZAO.test(n) && !/saldo|valor|carteira|ativo total/.test(n);
  }
  function ehContagem(coluna) {
    return /^(numero|quantidade|qtd)/.test(U.norm(coluna));
  }

  function escala() { return Number(ST.estado.escala || 1); }

  /** Acessor único de valor: aplica a escala apenas onde faz sentido. */
  function valor(linha, coluna) {
    if (!linha || !coluna) return null;
    var v = U.toNumber(linha[coluna]);
    if (!U.isNum(v)) return null;
    if (ehRazao(coluna) || ehContagem(coluna)) return v;
    return v * escala();
  }

  /** Formatador adequado ao tipo inferido da coluna. */
  function fmtColuna(coluna) {
    if (ehRazao(coluna) && !ehContagem(coluna)) {
      return function (v) { return U.isNum(v) ? U.fmt(v, 2) : '–'; };
    }
    if (ehContagem(coluna)) return function (v) { return U.isNum(v) ? U.fmt(v, 0) : '–'; };
    return function (v) { return U.compact(v, 1); };
  }
  function decimaisColuna(coluna) {
    if (ehContagem(coluna)) return 0;
    if (ehRazao(coluna)) return 2;
    return 0;
  }
  function unidadeColuna(coluna) {
    if (ehContagem(coluna)) return 'unidades';
    if (ehRazao(coluna)) return '%';
    return escala() === 1000 ? 'R$' : escala() === 0.001 ? 'R$ milhões' : 'R$ mil';
  }

  /* ----------------------------- utilidades ------------------------------ */

  function colunasNumericas(dataset) {
    if (!dataset) return [];
    return dataset.columns.filter(function (c) {
      return dataset.rows.some(function (r) { return U.isNum(U.toNumber(r[c])); });
    });
  }

  /** Coluna "principal" do relatório: ativo total quando existe, senão a de maior soma. */
  function campoPrincipal(dataset) {
    if (!dataset) return null;
    if (dataset.campos && dataset.campos.ativoTotal) return dataset.campos.ativoTotal;
    var cols = colunasNumericas(dataset).filter(function (c) { return !ehRazao(c); });
    if (!cols.length) return colunasNumericas(dataset)[0] || null;
    var melhor = null, maior = -Infinity;
    cols.forEach(function (c) {
      var s = U.sum(dataset.rows.map(function (r) { return U.toNumber(r[c]); }).filter(U.isNum));
      if (s > maior) { maior = s; melhor = c; }
    });
    return melhor;
  }

  function linhasPorId(dataset) {
    var m = new Map();
    (dataset.rows || []).forEach(function (r) { m.set(r.__id, r); });
    return m;
  }

  function linhasDoGrupo(dataset, grupo) {
    if (!dataset || !grupo) return [];
    var idx = linhasPorId(dataset);
    var porNome = new Map();
    (dataset.rows || []).forEach(function (r) { porNome.set(U.norm(r.__nome), r); });
    return grupo.membros.map(function (m) {
      return idx.get(String(m.id)) || porNome.get(U.norm(m.nome)) || null;
    }).filter(Boolean);
  }

  /** Padroniza uma lista de valores em escore-z (para heatmaps comparáveis). */
  function zscores(valores) {
    var v = valores.filter(U.isNum);
    var m = U.mean(v), s = U.stdev(v);
    if (!U.isNum(m) || !U.isNum(s) || s === 0) return valores.map(function () { return null; });
    return valores.map(function (x) { return U.isNum(x) ? (x - m) / s : null; });
  }

  /** Participação de cada valor no total (%). */
  function shares(valores) {
    var total = U.sum(valores.filter(function (v) { return U.isNum(v) && v > 0; }));
    return valores.map(function (v) { return U.isNum(v) && total ? (v / total) * 100 : null; });
  }

  /** Opções de instituição para os multiselects. */
  function opcoesInstituicoes(dataset, campoOrdem) {
    if (!dataset) return [];
    var campo = campoOrdem || campoPrincipal(dataset);
    return dataset.rows.slice()
      .sort(function (a, b) { return (valor(b, campo) || 0) - (valor(a, campo) || 0); })
      .map(function (r) {
        var v = valor(r, campo);
        return {
          value: r.__id,
          label: r.__nome,
          sub: (r.UF ? r.UF + ' · ' : '') + (campo ? fmtColuna(campo)(v) : '')
        };
      });
  }

  /* ---------------------------- blocos prontos ---------------------------- */

  function avisoDemo(dataset) {
    if (!dataset || !dataset.demo) return null;
    var comoSair = global.IFDATA_FORCAR_DEMO
      ? 'Esta cópia não tem como consultar o Banco Central: para dados reais, abra o sistema pelo endereço onde ele está hospedado.'
      : 'Troque para "API do BCB" na barra superior para consultar dados reais.';
    return UI.nota('Modo demonstração: os números são sintéticos e servem apenas para explorar a interface. ' +
      comoSair, 'warn');
  }

  function avisoCampos(dataset) {
    if (!dataset) return null;
    var faltando = ['ativoTotal', 'patrimonioLiquido', 'lucroLiquido'].filter(function (c) {
      return !dataset.campos[c];
    });
    if (!faltando.length) return null;
    return UI.nota('Este relatório não expõe ' +
      faltando.map(function (c) { return CAT.CAMPOS[c].label.toLowerCase(); }).join(', ') +
      '. Alguns indicadores ficam indisponíveis — use "Resumo" ou "Informações de Capital", ' +
      'ou ajuste o mapeamento em Diagnóstico.', 'warn');
  }

  function blocoCarregando(node, texto) {
    U.clear(node).appendChild(UI.carregando(texto));
  }

  function blocoErro(node, erro) {
    U.clear(node);
    var msg = (erro && erro.message) || String(erro);
    var provavelCORS = /Failed to fetch|NetworkError|load failed/i.test(msg);
    node.appendChild(UI.nota([
      U.el('div', {}, [
        U.el('strong', { text: 'Não foi possível carregar os dados. ' }),
        U.el('span', { text: msg })
      ]),
      provavelCORS ? U.el('div', { class: 'small', style: 'margin-top:6px' , text:
        'Causas comuns: rede corporativa bloqueando olinda.bcb.gov.br, proxy sem acesso externo, ' +
        'ou a página aberta como arquivo local com bloqueio de origem. Sirva a pasta por HTTP ' +
        '(python3 serve.py) ou aponte outra base em Diagnóstico.' }) : null,
      U.el('div', { class: 'row', style: 'margin-top:8px' }, [
        U.el('button', { class: 'btn btn--sm', text: 'Ver diagnóstico',
          onclick: function () { global.APP.irPara('diagnostico'); } }),
        U.el('button', { class: 'btn btn--sm', text: 'Usar modo demonstração',
          onclick: function () { global.APP.definirModo('demo'); } })
      ])
    ], 'bad'));
  }

  /** Linha de estatísticas resumidas no topo de uma tela. */
  function faixaStats(itens) {
    var box = U.el('div', { class: 'grid grid--stats', style: 'margin-bottom:16px' });
    itens.filter(Boolean).forEach(function (it) { box.appendChild(UI.stat(it)); });
    return box;
  }

  global.VW = {
    registrar: registrar, todas: todas, ctx: ctx, novaGeracao: novaGeracao,
    carregar: carregar, carregarSerie: carregarSerie,
    ESCALAS: ESCALAS, escala: escala, valor: valor, ehRazao: ehRazao, ehContagem: ehContagem,
    fmtColuna: fmtColuna, decimaisColuna: decimaisColuna, unidadeColuna: unidadeColuna,
    colunasNumericas: colunasNumericas, campoPrincipal: campoPrincipal,
    linhasPorId: linhasPorId, linhasDoGrupo: linhasDoGrupo,
    zscores: zscores, shares: shares, opcoesInstituicoes: opcoesInstituicoes,
    avisoDemo: avisoDemo, avisoCampos: avisoCampos,
    blocoCarregando: blocoCarregando, blocoErro: blocoErro, faixaStats: faixaStats
  };
})(window);
