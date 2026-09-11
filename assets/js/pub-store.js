/* pub-store.js — lançamentos do módulo Publicações e motor de conciliação.
   Namespace global `PST`.

   Um lançamento é uma observação única:
     { cnpj, banco, fonte, periodo, metrica, valor, referencia, url }
   A chave natural é (cnpj, fonte, periodo, metrica) — relançar sobrescreve. */
(function (global) {
  'use strict';
  var U = global.U, PUB = global.PUB;

  var CHAVE = 'riskbench.publicacoes.v1';
  var dados = [];
  var indice = new Map();

  function chaveDe(l) {
    return [l.cnpj, l.fonte, l.periodo, l.metrica].join('|');
  }

  function reindexar() {
    indice = new Map();
    dados.forEach(function (l) { indice.set(chaveDe(l), l); });
  }

  function carregar() {
    try {
      var bruto = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      dados = Array.isArray(bruto) ? bruto : [];
    } catch (e) { dados = []; }
    reindexar();
    return dados;
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); return true; }
    catch (e) {
      global.UI && global.UI.toast('Não foi possível salvar: o armazenamento do navegador está cheio.', 'bad');
      return false;
    }
  }

  /* ----------------------------- escrita ------------------------------- */

  function normalizarCnpj(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    if (!d) return '';
    return d.length > 8 ? d.slice(0, 8) : d.padStart(8, '0');
  }

  function registrar(l, naoSalvar) {
    var limpo = {
      cnpj: normalizarCnpj(l.cnpj),
      banco: String(l.banco || '').trim(),
      fonte: String(l.fonte || '').trim(),
      periodo: String(l.periodo || '').trim(),
      metrica: String(l.metrica || '').trim(),
      valor: U.toNumber(l.valor),
      referencia: String(l.referencia || '').trim(),
      url: String(l.url || '').trim(),
      auto: !!l.auto,
      em: l.em || new Date().toISOString()
    };
    if (!limpo.cnpj || !limpo.fonte || !limpo.periodo || !limpo.metrica) {
      return { ok: false, motivo: 'faltam cnpj, fonte, período ou métrica' };
    }
    if (!PUB.FONTE_POR_ID[limpo.fonte]) {
      return { ok: false, motivo: 'fonte desconhecida: ' + limpo.fonte };
    }
    if (!PUB.METRICA_POR_ID[limpo.metrica]) {
      return { ok: false, motivo: 'métrica fora do catálogo: ' + limpo.metrica };
    }
    if (!/^\d{4}(03|06|09|12)$/.test(limpo.periodo)) {
      return { ok: false, motivo: 'período deve ser AAAAMM de fim de trimestre: ' + limpo.periodo };
    }
    if (!U.isNum(limpo.valor)) {
      return { ok: false, motivo: 'valor não numérico: ' + l.valor };
    }
    var k = chaveDe(limpo);
    var existente = indice.get(k);
    if (existente) {
      Object.assign(existente, limpo);
    } else {
      dados.push(limpo);
      indice.set(k, limpo);
    }
    if (!naoSalvar) salvar();
    return { ok: true, substituiu: !!existente };
  }

  function remover(l) {
    var k = typeof l === 'string' ? l : chaveDe(l);
    dados = dados.filter(function (x) { return chaveDe(x) !== k; });
    reindexar(); salvar();
  }

  function limpar(filtro) {
    if (!filtro) { dados = []; }
    else {
      dados = dados.filter(function (l) {
        return !Object.keys(filtro).every(function (k) { return l[k] === filtro[k]; });
      });
    }
    reindexar(); salvar();
  }

  /* ----------------------------- leitura -------------------------------- */

  function valor(cnpj, fonte, periodo, metrica) {
    var l = indice.get([normalizarCnpj(cnpj), fonte, periodo, metrica].join('|'));
    return l && U.isNum(l.valor) ? l.valor : null;
  }
  function lancamento(cnpj, fonte, periodo, metrica) {
    return indice.get([normalizarCnpj(cnpj), fonte, periodo, metrica].join('|')) || null;
  }
  function todos() { return dados.slice(); }

  function bancosComDados() {
    var m = new Map();
    dados.forEach(function (l) { if (!m.has(l.cnpj)) m.set(l.cnpj, l.banco || l.cnpj); });
    return Array.from(m, function (e) { return { cnpj: e[0], nome: e[1] }; });
  }

  /* --------------------- espelho automático do IF.data ------------------- */

  /**
   * Copia para a fonte "ifdata" as métricas do catálogo que têm equivalente
   * calculado no módulo IF.data. É o que dá uma linha de base para conferir o
   * que foi transcrito das publicações.
   */
  function sincronizarIFData(bancos, periodo, valorDoIndicador) {
    limpar({ fonte: 'ifdata', periodo: String(periodo) });
    var n = 0;
    var comEspelho = PUB.METRICAS.filter(function (m) { return m.ifdata; });
    bancos.forEach(function (b) {
      comEspelho.forEach(function (m) {
        var v = valorDoIndicador(b, m.ifdata);
        if (!U.isNum(v)) return;
        var r = registrar({ cnpj: b.cnpj, banco: b.nome, fonte: 'ifdata', periodo: periodo,
                            metrica: m.id, valor: v, referencia: 'IF.data (automático)', auto: true }, true);
        if (r.ok) n++;
      });
    });
    salvar();
    return n;
  }

  /* --------------------------- conciliação ------------------------------- */

  /** Lê como percentual as unidades que já são percentuais. */
  function ehPercentual(metrica) {
    var m = PUB.METRICA_POR_ID[metrica];
    return !!m && (m.unidade === '%' || m.unidade === 'p.p.');
  }

  /**
   * Compara as fontes de uma célula (banco × período × métrica).
   * Devolve null quando menos de duas fontes publicaram o número — sem duas
   * observações não há divergência, e inventar uma seria ruído.
   */
  function compararCelula(cnpj, periodo, metrica) {
    var achados = [];
    PUB.FONTES.forEach(function (f) {
      var v = valor(cnpj, f.id, periodo, metrica);
      if (U.isNum(v)) achados.push({ fonte: f.id, valor: v });
    });
    if (achados.length < 2) {
      return achados.length ? { fontes: achados, comparavel: false } : null;
    }
    var vals = achados.map(function (a) { return a.valor; });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var escala = Math.max.apply(null, vals.map(Math.abs)) || 1;
    var gapAbs = max - min;
    var gapRel = (gapAbs / escala) * 100;

    // Índices comparam-se em pontos percentuais; saldos, em variação relativa.
    var pp = ehPercentual(metrica);
    var medida = pp ? gapAbs : gapRel;
    var severidade = pp
      ? (gapAbs > 1 ? 'alta' : gapAbs > 0.25 ? 'media' : 'baixa')
      : (gapRel > 5 ? 'alta' : gapRel > 1 ? 'media' : 'baixa');

    return {
      fontes: achados, comparavel: true,
      max: max, min: min, gapAbs: gapAbs, gapRel: gapRel,
      medida: medida, unidadeGap: pp ? 'p.p.' : '%',
      severidade: severidade,
      maiorEm: achados.filter(function (a) { return a.valor === max; })[0].fonte,
      menorEm: achados.filter(function (a) { return a.valor === min; })[0].fonte
    };
  }

  /** Varre o escopo e devolve as divergências, da maior para a menor. */
  function divergencias(bancos, periodos, metricas, minimaSeveridade) {
    var ordem = { alta: 3, media: 2, baixa: 1 };
    var corte = ordem[minimaSeveridade || 'media'];
    var saida = [];
    bancos.forEach(function (b) {
      periodos.forEach(function (p) {
        metricas.forEach(function (mid) {
          var c = compararCelula(b.cnpj, p, mid);
          if (!c || !c.comparavel) return;
          if (ordem[c.severidade] < corte) return;
          saida.push({
            cnpj: b.cnpj, banco: b.nome, periodo: p, metrica: mid,
            nomeMetrica: PUB.METRICA_POR_ID[mid].nome,
            familia: PUB.METRICA_POR_ID[mid].familia,
            comparacao: c
          });
        });
      });
    });
    return saida.sort(function (a, b) {
      var d = (ordem[b.comparacao.severidade] - ordem[a.comparacao.severidade]);
      return d !== 0 ? d : b.comparacao.medida - a.comparacao.medida;
    });
  }

  /** Matriz banco × fonte: quantas métricas esperadas já foram preenchidas. */
  function cobertura(bancos, periodos, metricas) {
    return bancos.map(function (b) {
      var celulas = PUB.FONTES.map(function (f) {
        var esperadas = metricas.filter(function (mid) {
          return PUB.METRICA_POR_ID[mid].fontes.indexOf(f.id) >= 0;
        });
        var alvo = esperadas.length * periodos.length;
        var preenchidas = 0;
        esperadas.forEach(function (mid) {
          periodos.forEach(function (p) {
            if (U.isNum(valor(b.cnpj, f.id, p, mid))) preenchidas++;
          });
        });
        return { fonte: f.id, alvo: alvo, preenchidas: preenchidas,
                 pct: alvo ? (preenchidas / alvo) * 100 : null };
      });
      return { banco: b, celulas: celulas };
    });
  }

  /* --------------------------- importar / exportar ------------------------ */

  /** Lê o CSV do modelo. Aceita ';' ou ',' como separador. */
  function importarCSV(texto) {
    var limpo = String(texto || '').replace(/^﻿/, '').trim();
    if (!limpo) return { inseridos: 0, substituidos: 0, erros: ['arquivo vazio'] };
    var linhas = limpo.split(/\r?\n/);
    var sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';

    function campos(linha) {
      var out = [], atual = '', aspas = false;
      for (var i = 0; i < linha.length; i++) {
        var c = linha[i];
        if (c === '"') {
          if (aspas && linha[i + 1] === '"') { atual += '"'; i++; }
          else aspas = !aspas;
        } else if (c === sep && !aspas) { out.push(atual); atual = ''; }
        else atual += c;
      }
      out.push(atual);
      return out.map(function (x) { return x.trim(); });
    }

    var cab = campos(linhas[0]).map(function (h) { return U.norm(h).replace(/ /g, ''); });
    var pos = {};
    PUB.COLUNAS_IMPORT.forEach(function (c) {
      pos[c.key] = cab.indexOf(U.norm(c.label).replace(/ /g, ''));
    });
    var faltando = ['cnpj', 'fonte', 'periodo', 'metrica', 'valor']
      .filter(function (k) { return pos[k] < 0; });
    if (faltando.length) {
      return { inseridos: 0, substituidos: 0,
               erros: ['faltam as colunas obrigatórias: ' + faltando.join(', ')] };
    }

    var inseridos = 0, substituidos = 0, erros = [];
    for (var i = 1; i < linhas.length; i++) {
      if (!linhas[i].trim()) continue;
      var f = campos(linhas[i]);
      var r = registrar({
        cnpj: f[pos.cnpj], banco: pos.banco >= 0 ? f[pos.banco] : '',
        fonte: f[pos.fonte], periodo: f[pos.periodo], metrica: f[pos.metrica],
        valor: f[pos.valor],
        referencia: pos.referencia >= 0 ? f[pos.referencia] : '',
        url: pos.url >= 0 ? f[pos.url] : ''
      }, true);
      if (!r.ok) { if (erros.length < 12) erros.push('linha ' + (i + 1) + ': ' + r.motivo); }
      else if (r.substituiu) substituidos++;
      else inseridos++;
    }
    salvar();
    return { inseridos: inseridos, substituidos: substituidos, erros: erros };
  }

  function exportarCSV() {
    var cab = PUB.COLUNAS_IMPORT.map(function (c) { return c.label; }).join(';');
    var linhas = dados.map(function (l) {
      return [l.cnpj, l.banco, l.fonte, l.periodo, l.metrica,
              String(l.valor).replace('.', ','), l.referencia, l.url]
        .map(function (v) {
          var t = String(v == null ? '' : v);
          return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        }).join(';');
    });
    return '﻿' + [cab].concat(linhas).join('\r\n');
  }

  global.PST = {
    carregar: carregar, salvar: salvar, registrar: registrar, remover: remover, limpar: limpar,
    valor: valor, lancamento: lancamento, todos: todos, bancosComDados: bancosComDados,
    normalizarCnpj: normalizarCnpj, sincronizarIFData: sincronizarIFData,
    compararCelula: compararCelula, divergencias: divergencias, cobertura: cobertura,
    importarCSV: importarCSV, exportarCSV: exportarCSV
  };
})(window);
