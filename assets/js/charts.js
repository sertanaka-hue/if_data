/* charts.js — motor de gráficos em SVG, sem dependências externas.
   Expõe o namespace global `CH`.

   Convenções de desenho (mantidas em todos os tipos):
     · marcas finas: barras no máximo 24px, linhas 2px, marcadores r>=4
     · ponta de dado arredondada em 4px, base quadrada na linha de zero
     · 2px de respiro na cor da superfície entre barras vizinhas e entre
       segmentos empilhados — separação por espaço, nunca por contorno
     · grade e eixos em fio de 1px sólido, recessivos
     · legenda sempre presente a partir de 2 séries; rótulos diretos são
       seletivos (extremos e pontas), nunca um número em cada ponto
     · um único eixo de valores por gráfico */
(function (global) {
  'use strict';
  var U = global.U;

  /* ------------------------- cores por entidade ------------------------ */

  var MAX_SLOTS = 8;
  var registro = new Map();
  var proximo = 0;

  var Colors = {
    /** Cor fixa da entidade: atribuída na primeira vez que ela aparece e
        mantida daí em diante, para que filtrar séries não repinte as demais. */
    of: function (key) {
      var k = String(key);
      if (!registro.has(k)) {
        registro.set(k, proximo < MAX_SLOTS ? proximo : -1);
        proximo++;
      }
      var slot = registro.get(k);
      return slot >= 0 ? 'var(--series-' + (slot + 1) + ')' : 'var(--text-muted)';
    },
    /** Reserva slots para um conjunto, na ordem dada (usar antes de desenhar). */
    reserve: function (keys) { keys.forEach(function (k) { Colors.of(k); }); },
    reset: function () { registro.clear(); proximo = 0; },
    /** Reinicia a atribuição mantendo só as chaves informadas. */
    rebase: function (keys) {
      registro.clear(); proximo = 0;
      Colors.reserve(keys);
    },
    seq: function (t) {                      // t em [0,1] -> rampa sequencial
      var steps = ['--seq-100', '--seq-200', '--seq-300', '--seq-400',
                   '--seq-500', '--seq-600', '--seq-700'];
      var i = U.clamp(Math.round(t * (steps.length - 1)), 0, steps.length - 1);
      return 'var(' + steps[i] + ')';
    },
    div: function (t) {                      // t em [-1,1] -> divergente
      if (!U.isNum(t)) return 'var(--div-mid)';
      if (Math.abs(t) < 0.06) return 'var(--div-mid)';
      var mag = U.clamp(Math.abs(t), 0, 1);
      var steps = ['--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600'];
      if (t < 0) return 'var(' + steps[U.clamp(Math.round(mag * 4), 0, 4)] + ')';
      var op = 0.25 + mag * 0.75;
      return 'color-mix(in srgb, var(--div-pos) ' + Math.round(op * 100) + '%, var(--div-mid))';
    },
    MAX_SLOTS: MAX_SLOTS
  };

  /* ------------------------------ tooltip ------------------------------ */

  var tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = U.el('div', { class: 'tip', hidden: true, role: 'status' });
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, ev) {
    var t = tip();
    t.innerHTML = html;
    t.hidden = false;
    var r = t.getBoundingClientRect();
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }
  window.addEventListener('scroll', hideTip, true);

  function tipRow(cor, rotulo, valor) {
    return '<div class="tip__row"><span class="tip__key">' +
      (cor ? '<span class="legend__swatch" style="background:' + cor + '"></span>' : '') +
      escapeHTML(rotulo) + '</span><span>' + escapeHTML(valor) + '</span></div>';
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ------------------------------ escalas ------------------------------ */

  function niceTicks(min, max, count) {
    if (!U.isNum(min) || !U.isNum(max)) return { min: 0, max: 1, ticks: [0, 1] };
    if (min === max) { min = min - Math.abs(min || 1) * 0.5; max = max + Math.abs(max || 1) * 0.5; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / (count || 5))));
    var err = (span / (count || 5)) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) {
      ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
    }
    return { min: lo, max: hi, ticks: ticks, step: step };
  }

  function linear(dmin, dmax, rmin, rmax) {
    var d = dmax - dmin || 1;
    return function (v) { return rmin + ((v - dmin) / d) * (rmax - rmin); };
  }

  /* ---------------------- geometria das marcas ------------------------- */

  var CAP = 24;    // espessura máxima da barra
  var GAP = 2;     // respiro na cor da superfície
  var R = 4;       // raio da ponta de dado

  /** Retângulo com cantos arredondados só na ponta indicada. */
  function barPath(x, y, w, h, side) {
    var r = Math.min(R, w / 2, h / 2);
    if (!(r > 0.5)) return 'M' + x + ',' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z';
    if (side === 'top') {
      return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
        'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + (y + h) + 'Z';
    }
    if (side === 'bottom') {
      return 'M' + x + ',' + y + 'V' + (y + h - r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + r +
        'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + (-r) + 'V' + y + 'Z';
    }
    if (side === 'left') {
      return 'M' + (x + w) + ',' + y + 'H' + (x + r) + 'a' + r + ',' + r + ' 0 0 0 ' + (-r) + ',' + r +
        'v' + (h - 2 * r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + r + 'H' + (x + w) + 'Z';
    }
    // right (padrão)
    return 'M' + x + ',' + y + 'H' + (x + w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
      'v' + (h - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + 'H' + x + 'Z';
  }

  /* --------------------------- infraestrutura -------------------------- */

  function medir(node) {
    var w = node.clientWidth || node.getBoundingClientRect().width;
    return Math.max(280, Math.round(w || 640));
  }

  /** Registra o desenhador e redesenha quando o contêiner muda de largura. */
  function montar(node, desenhar) {
    node.classList.add('chart');
    var pendente = null;
    function render() {
      U.clear(node);
      var w = medir(node);
      try { desenhar(node, w); } catch (e) {
        node.appendChild(U.el('div', { class: 'chart__empty', text: 'Não foi possível desenhar: ' + e.message }));
        if (global.console) console.error(e);
      }
    }
    render();
    if (typeof ResizeObserver !== 'undefined') {
      if (node.__ro) node.__ro.disconnect();
      var largura = medir(node);
      node.__ro = new ResizeObserver(function () {
        var nova = medir(node);
        if (Math.abs(nova - largura) < 12) return;
        largura = nova;
        clearTimeout(pendente);
        pendente = setTimeout(render, 90);
      });
      node.__ro.observe(node);
    }
    node.__redraw = render;
    return node;
  }

  function vazio(node, msg) {
    node.classList.add('chart');
    U.clear(node).appendChild(U.el('div', { class: 'chart__empty', text: msg || 'Sem dados para exibir.' }));
    return node;
  }

  function legenda(node, itens, opts) {
    var o = opts || {};
    if (itens.length < 2 && !o.forcar) return null;
    var box = U.el('div', { class: 'legend', role: 'list' });
    itens.forEach(function (it) {
      var item = U.el('div', {
        class: 'legend__item', role: 'listitem', tabindex: o.onToggle ? '0' : null,
        title: it.label
      }, [
        U.el('span', { class: 'legend__swatch' + (o.linha ? ' legend__swatch--line' : ''),
                       style: 'background:' + it.color }),
        U.el('span', { text: U.truncate(it.label, 42) })
      ]);
      if (o.onToggle) {
        var alternar = function () {
          item.classList.toggle('is-off');
          o.onToggle(it.key, !item.classList.contains('is-off'));
        };
        item.addEventListener('click', alternar);
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
        });
      }
      box.appendChild(item);
    });
    node.appendChild(box);
    return box;
  }

  function eixoY(g, escala, ticks, x0, x1, fmtTick) {
    ticks.forEach(function (t) {
      var y = Math.round(escala(t)) + 0.5;
      g.appendChild(U.svg('line', { class: 'gridline', x1: x0, x2: x1, y1: y, y2: y }));
      g.appendChild(U.svg('text', { class: 'tick', x: x0 - 8, y: y + 4,
                                    'text-anchor': 'end', text: fmtTick(t) }));
    });
  }

  /* =====================================================================
     1. Barras horizontais (ranking) — uma série, ordenada
     ===================================================================== */

  function ranking(node, cfg) {
    var dados = (cfg.data || []).filter(function (d) { return U.isNum(d.value); });
    if (!dados.length) return vazio(node, cfg.vazio);

    return montar(node, function (host, W) {
      var linhas = dados.length;
      var rotuloW = Math.min(Math.max(120, Math.round(W * 0.30)), 300);
      var padR = 78, padT = 8, padB = 26;
      var passo = U.clamp(Math.round((cfg.alturaLinha || 30)), 22, 44);
      var H = padT + padB + linhas * passo;
      var x0 = rotuloW, x1 = W - padR;

      var vals = dados.map(function (d) { return d.value; });
      var min = Math.min(0, Math.min.apply(null, vals));
      var max = Math.max(0, Math.max.apply(null, vals));
      var t = niceTicks(min, max, 4);
      var sx = linear(t.min, t.max, x0, x1);
      var zero = sx(0);

      var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                 'aria-label': cfg.aria || 'Gráfico de ranking' });
      var g = U.svg('g');
      svgEl.appendChild(g);

      // grade vertical
      t.ticks.forEach(function (tv) {
        var x = Math.round(sx(tv)) + 0.5;
        g.appendChild(U.svg('line', { class: tv === 0 ? 'baseline' : 'gridline',
                                      x1: x, x2: x, y1: padT, y2: H - padB }));
        g.appendChild(U.svg('text', { class: 'tick', x: x, y: H - padB + 15,
                                      'text-anchor': 'middle',
                                      text: (cfg.fmtEixo || U.compact)(tv) }));
      });

      var espessura = Math.min(CAP - 4, passo * 0.62);
      dados.forEach(function (d, i) {
        var yTopo = padT + i * passo + (passo - espessura) / 2;
        var xv = sx(d.value);
        var largura = Math.abs(xv - zero);
        var xIni = Math.min(zero, xv);
        var cor = d.color || Colors.of(d.key != null ? d.key : d.label);

        g.appendChild(U.svg('text', {
          class: 'mark-label', x: x0 - 10, y: yTopo + espessura / 2 + 4,
          'text-anchor': 'end', text: U.truncate(d.label, Math.floor(rotuloW / 6.6))
        }));

        var caminho = U.svg('path', {
          d: barPath(xIni, yTopo, Math.max(1.5, largura), espessura, d.value < 0 ? 'left' : 'right'),
          style: 'fill:' + cor
        });
        g.appendChild(caminho);

        // rótulo direto na ponta — sempre fora da barra, nunca cortado
        g.appendChild(U.svg('text', {
          class: 'mark-label' + (i === 0 ? ' mark-label--strong' : ''),
          x: (d.value < 0 ? xIni - 8 : xIni + largura + 8),
          y: yTopo + espessura / 2 + 4,
          'text-anchor': d.value < 0 ? 'end' : 'start',
          text: (cfg.fmtValor || U.compact)(d.value)
        }));

        var alvo = U.svg('rect', {
          x: x0 - rotuloW, y: padT + i * passo, width: W - (x0 - rotuloW), height: passo,
          fill: 'transparent', style: 'cursor:default'
        });
        alvo.addEventListener('mousemove', function (ev) {
          showTip('<div class="tip__title">' + escapeHTML(d.label) + '</div>' +
            tipRow(cor, cfg.serieLabel || 'Valor', (cfg.fmtTip || cfg.fmtValor || U.compact)(d.value)) +
            (d.nota ? '<div class="tip__note">' + escapeHTML(d.nota) + '</div>' : ''), ev);
        });
        alvo.addEventListener('mouseleave', hideTip);
        g.appendChild(alvo);
      });

      host.appendChild(svgEl);
    });
  }

  /* =====================================================================
     2. Colunas agrupadas ou empilhadas
     ===================================================================== */

  function colunas(node, cfg) {
    var grupos = cfg.groups || [];          // [{key,label}]
    var series = cfg.series || [];          // [{key,label,values:[]}]
    if (!grupos.length || !series.length) return vazio(node, cfg.vazio);
    var empilhado = cfg.modo === 'empilhado';

    var ocultas = {};
    function ativas() { return series.filter(function (s) { return !ocultas[s.key]; }); }

    return montar(node, function (host, W) {
      var legBox = U.el('div');
      var box = U.el('div');
      host.appendChild(legBox);
      host.appendChild(box);
      legenda(legBox, series.map(function (s) {
        return { key: s.key, label: s.label, color: s.color || Colors.of(s.key) };
      }), {
        onToggle: function (key, on) { ocultas[key] = !on; desenhar(); }
      });
      desenhar();

      function desenhar() {
        U.clear(box);
        var vis = ativas();
        var padL = 62, padR = 16, padT = cfg.tituloEixo ? 26 : 10, padB = 46;
        var H = cfg.altura || 320;
        var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

        var todos = [];
        grupos.forEach(function (_, gi) {
          if (empilhado) {
            var pos = 0, neg = 0;
            vis.forEach(function (s) {
              var v = s.values[gi];
              if (!U.isNum(v)) return;
              if (v >= 0) pos += v; else neg += v;
            });
            todos.push(pos, neg);
          } else {
            vis.forEach(function (s) { if (U.isNum(s.values[gi])) todos.push(s.values[gi]); });
          }
        });
        if (!todos.length) todos = [0, 1];
        var t = niceTicks(Math.min(0, Math.min.apply(null, todos)),
                          Math.max(0, Math.max.apply(null, todos)), 5);
        var sy = linear(t.min, t.max, y1, y0);
        var zero = sy(0);

        var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                   'aria-label': cfg.aria || 'Gráfico de colunas' });
        var g = U.svg('g'); svgEl.appendChild(g);
        eixoY(g, sy, t.ticks, x0, x1, cfg.fmtEixo || U.compact);
        if (cfg.tituloEixo) {
          g.appendChild(U.svg('text', { class: 'axis-title', x: 2, y: y0 - 10,
                                        'text-anchor': 'start', text: cfg.tituloEixo }));
        }

        var banda = (x1 - x0) / grupos.length;
        var interno = Math.min(banda * 0.72, empilhado ? CAP : CAP * Math.max(1, vis.length));
        var espessura = empilhado ? Math.min(CAP, interno)
                                  : Math.min(CAP, (interno - GAP * (vis.length - 1)) / Math.max(1, vis.length));

        grupos.forEach(function (grupo, gi) {
          var centro = x0 + banda * (gi + 0.5);
          var larguraGrupo = empilhado ? espessura : espessura * vis.length + GAP * (vis.length - 1);
          var inicio = centro - larguraGrupo / 2;

          var acumPos = 0, acumNeg = 0;
          vis.forEach(function (s, si) {
            var v = s.values[gi];
            if (!U.isNum(v)) return;
            var cor = s.color || Colors.of(s.key);
            var xb, yb, hb;
            if (empilhado) {
              xb = inicio;
              var base = v >= 0 ? acumPos : acumNeg;
              var topo = base + v;
              yb = Math.min(sy(base), sy(topo));
              hb = Math.abs(sy(topo) - sy(base)) - GAP;
              if (v >= 0) acumPos = topo; else acumNeg = topo;
              if (hb < 0.8) return;
            } else {
              xb = inicio + si * (espessura + GAP);
              yb = Math.min(zero, sy(v));
              hb = Math.max(1.5, Math.abs(sy(v) - zero));
            }
            var lado = v >= 0 ? 'top' : 'bottom';
            var p = U.svg('path', { d: barPath(xb, yb, espessura, hb, empilhado ? 'top' : lado),
                                    style: 'fill:' + cor });
            p.addEventListener('mousemove', function (ev) {
              showTip('<div class="tip__title">' + escapeHTML(grupo.label) + '</div>' +
                tipRow(cor, s.label, (cfg.fmtValor || U.compact)(v)), ev);
            });
            p.addEventListener('mouseleave', hideTip);
            g.appendChild(p);
          });

          var rot = U.truncate(grupo.label, Math.max(6, Math.floor(banda / 7)));
          var txt = U.svg('text', { class: 'tick', x: centro, y: y1 + 16,
                                    'text-anchor': 'middle', text: rot });
          if (grupos.length > 8 || banda < 64) {
            txt.setAttribute('transform', 'rotate(-35 ' + centro + ' ' + (y1 + 16) + ')');
            txt.setAttribute('text-anchor', 'end');
          }
          g.appendChild(txt);
        });

        g.appendChild(U.svg('line', { class: 'baseline', x1: x0, x2: x1,
                                      y1: Math.round(zero) + 0.5, y2: Math.round(zero) + 0.5 }));
        box.appendChild(svgEl);
      }
    });
  }

  /* =====================================================================
     3. Linhas (série temporal) com crosshair e tooltip agregado
     ===================================================================== */

  function linhas(node, cfg) {
    var eixoX = cfg.x || [];                // rótulos de categoria (períodos)
    var series = cfg.series || [];          // [{key,label,values:[]}]
    if (!eixoX.length || !series.length) return vazio(node, cfg.vazio);
    var ocultas = {};

    return montar(node, function (host, W) {
      var legBox = U.el('div');
      var box = U.el('div');
      host.appendChild(legBox);
      host.appendChild(box);
      legenda(legBox, series.map(function (s) {
        return { key: s.key, label: s.label, color: s.color || Colors.of(s.key) };
      }), {
        linha: true,
        onToggle: function (key, on) { ocultas[key] = !on; desenhar(); }
      });
      desenhar();

      function desenhar() {
        U.clear(box);
        var vis = series.filter(function (s) { return !ocultas[s.key]; });
        var padL = 64, padR = cfg.rotularPontas === false ? 18 : 66;
        var padT = cfg.tituloEixo ? 26 : 12, padB = 40;
        var H = cfg.altura || 340;
        var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

        var todos = [];
        vis.forEach(function (s) { s.values.forEach(function (v) { if (U.isNum(v)) todos.push(v); }); });
        if (!todos.length) { box.appendChild(U.el('div', { class: 'chart__empty', text: 'Sem valores no período.' })); return; }
        var min = Math.min.apply(null, todos), max = Math.max.apply(null, todos);
        if (cfg.zeroObrigatorio) min = Math.min(0, min);
        // uma linha de referência só serve se couber no eixo
        if (U.isNum(cfg.referencia)) {
          min = Math.min(min, cfg.referencia);
          max = Math.max(max, cfg.referencia);
        }
        var folga = (max - min || Math.abs(max) || 1) * 0.08;
        var lo = min - folga, hi = max + folga;
        // séries só positivas nunca ganham eixo negativo — é espaço morto que
        // ainda sugere valores que não existem
        if (cfg.zeroObrigatorio && min >= 0) lo = 0;
        if (min >= 0 && lo < 0) lo = 0;
        var t = cfg.limites ? niceTicks(cfg.limites[0], cfg.limites[1], 5)
                            : niceTicks(lo, hi, 5);
        var sy = linear(t.min, t.max, y1, y0);
        var sx = function (i) {
          return eixoX.length === 1 ? (x0 + x1) / 2 : x0 + (i / (eixoX.length - 1)) * (x1 - x0);
        };

        var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                   'aria-label': cfg.aria || 'Série temporal' });
        var g = U.svg('g'); svgEl.appendChild(g);
        eixoY(g, sy, t.ticks, x0, x1, cfg.fmtEixo || U.compact);
        if (cfg.tituloEixo) {
          g.appendChild(U.svg('text', { class: 'axis-title', x: 2, y: y0 - 10,
                                        'text-anchor': 'start', text: cfg.tituloEixo }));
        }
        if (U.isNum(cfg.referencia)) {
          var yr = Math.round(sy(cfg.referencia)) + 0.5;
          g.appendChild(U.svg('line', { x1: x0, x2: x1, y1: yr, y2: yr,
            style: 'stroke:var(--critical);stroke-width:1;opacity:.55' }));
          g.appendChild(U.svg('text', { class: 'mark-label', x: x0 + 4, y: yr - 5,
            text: cfg.referenciaLabel || ('Referência ' + U.fmt(cfg.referencia, 1)) }));
        }

        // rótulos do eixo X — no máximo ~10, sempre incluindo a última
        // no máximo ~10 rótulos, sempre incluindo o último — e sem deixar o
        // penúltimo colar nele
        var passoRot = Math.max(1, Math.ceil(eixoX.length / 9));
        var ultimoIdx = eixoX.length - 1;
        eixoX.forEach(function (rot, i) {
          var ultimo = i === ultimoIdx;
          if (!ultimo && (i % passoRot !== 0 || ultimoIdx - i < passoRot)) return;
          g.appendChild(U.svg('text', { class: 'tick', x: sx(i), y: y1 + 18,
                                        'text-anchor': 'middle', text: rot }));
        });
        g.appendChild(U.svg('line', { class: 'baseline', x1: x0, x2: x1,
                                      y1: Math.round(y1) + 0.5, y2: Math.round(y1) + 0.5 }));

        var superficie = getComputedStyle(document.body).getPropertyValue('--surface-1').trim() || '#fff';
        var pontas = [];

        vis.forEach(function (s) {
          var cor = s.color || Colors.of(s.key);
          var segmento = [], caminhos = [];
          s.values.forEach(function (v, i) {
            if (U.isNum(v)) segmento.push([sx(i), sy(v)]);
            else if (segmento.length) { caminhos.push(segmento); segmento = []; }
          });
          if (segmento.length) caminhos.push(segmento);

          caminhos.forEach(function (pts) {
            if (pts.length === 1) {
              g.appendChild(U.svg('circle', { cx: pts[0][0], cy: pts[0][1], r: 4,
                style: 'fill:' + cor + ';stroke:' + superficie + ';stroke-width:2' }));
              return;
            }
            var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('');
            if (cfg.area && vis.length === 1) {
              g.appendChild(U.svg('path', {
                d: d + 'L' + pts[pts.length - 1][0].toFixed(1) + ',' + y1 + 'L' + pts[0][0].toFixed(1) + ',' + y1 + 'Z',
                style: 'fill:' + cor + ';opacity:.10'
              }));
            }
            g.appendChild(U.svg('path', { d: d, style: 'fill:none;stroke:' + cor +
              ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }));
          });

          // ponta: marcador sempre; o rótulo direto entra depois, se couber
          var ultimo = -1;
          s.values.forEach(function (v, i) { if (U.isNum(v)) ultimo = i; });
          if (ultimo >= 0) {
            g.appendChild(U.svg('circle', { cx: sx(ultimo), cy: sy(s.values[ultimo]), r: 4,
              style: 'fill:' + cor + ';stroke:' + superficie + ';stroke-width:2' }));
            pontas.push({ x: sx(ultimo), y: sy(s.values[ultimo]), valor: s.values[ultimo] });
          }
        });

        /* Rótulo direto na ponta — só o valor (a legenda já carrega o nome).
           Quando as séries convergem no fim, empilhar rótulos os desgruda das
           linhas e vira ruído: nesse caso nenhum é desenhado e a leitura fica
           por conta da legenda, do crosshair e da aba Tabela. */
        if (cfg.rotularPontas !== false && pontas.length) {
          var ys = pontas.map(function (p) { return p.y; }).sort(function (a, b) { return a - b; });
          var colide = ys.some(function (y, i) { return i > 0 && y - ys[i - 1] < 13; });
          if (!colide) {
            pontas.forEach(function (p) {
              g.appendChild(U.svg('text', {
                class: 'mark-label', x: p.x + 10, y: p.y + 4,
                text: (cfg.fmtValor || U.compact)(p.valor)
              }));
            });
          }
        }

        // camada de crosshair
        var cross = U.svg('line', { class: 'gridline', y1: y0, y2: y1, x1: -99, x2: -99,
          style: 'stroke:var(--axis)' });
        g.appendChild(cross);
        var captura = U.svg('rect', { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0),
          fill: 'transparent' });
        captura.addEventListener('mousemove', function (ev) {
          var caixa = svgEl.getBoundingClientRect();
          var escala = W / caixa.width;
          var px = (ev.clientX - caixa.left) * escala;
          var i = eixoX.length === 1 ? 0
            : Math.round(((px - x0) / (x1 - x0)) * (eixoX.length - 1));
          i = U.clamp(i, 0, eixoX.length - 1);
          cross.setAttribute('x1', sx(i)); cross.setAttribute('x2', sx(i));
          var html = '<div class="tip__title">' + escapeHTML(eixoX[i]) + '</div>';
          vis.slice()
            .sort(function (a, b) { return (b.values[i] || -Infinity) - (a.values[i] || -Infinity); })
            .forEach(function (s) {
              html += tipRow(s.color || Colors.of(s.key), s.label,
                (cfg.fmtValor || U.compact)(s.values[i]));
            });
          showTip(html, ev);
        });
        captura.addEventListener('mouseleave', function () {
          hideTip(); cross.setAttribute('x1', -99); cross.setAttribute('x2', -99);
        });
        g.appendChild(captura);

        box.appendChild(svgEl);
      }
    });
  }

  /* =====================================================================
     4. Dispersão (ex.: risco × retorno)
     ===================================================================== */

  function dispersao(node, cfg) {
    var pts = (cfg.points || []).filter(function (p) { return U.isNum(p.x) && U.isNum(p.y); });
    if (!pts.length) return vazio(node, cfg.vazio);

    return montar(node, function (host, W) {
      var padL = 64, padR = 20, padT = cfg.tituloY ? 28 : 14, padB = 48;
      var H = cfg.altura || 380;
      var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

      var tx = niceTicks(Math.min.apply(null, pts.map(function (p) { return p.x; })),
                         Math.max.apply(null, pts.map(function (p) { return p.x; })), 5);
      var ty = niceTicks(Math.min.apply(null, pts.map(function (p) { return p.y; })),
                         Math.max.apply(null, pts.map(function (p) { return p.y; })), 5);
      var sx = linear(tx.min, tx.max, x0, x1);
      var sy = linear(ty.min, ty.max, y1, y0);

      var raios = pts.map(function (p) { return U.isNum(p.size) && p.size > 0 ? p.size : 1; });
      var rMax = Math.max.apply(null, raios);
      function raio(p) {
        if (!cfg.dimensionar) return 5;
        var s = U.isNum(p.size) && p.size > 0 ? p.size : 0;
        return 4 + Math.sqrt(s / rMax) * 12;
      }

      var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                 'aria-label': cfg.aria || 'Gráfico de dispersão' });
      var g = U.svg('g'); svgEl.appendChild(g);
      eixoY(g, sy, ty.ticks, x0, x1, cfg.fmtY || U.compact);
      tx.ticks.forEach(function (tv) {
        var x = Math.round(sx(tv)) + 0.5;
        g.appendChild(U.svg('line', { class: 'gridline', x1: x, x2: x, y1: y0, y2: y1 }));
        g.appendChild(U.svg('text', { class: 'tick', x: x, y: y1 + 17, 'text-anchor': 'middle',
                                      text: (cfg.fmtX || U.compact)(tv) }));
      });
      // medianas como referência de quadrante
      [['x', U.median(pts.map(function (p) { return p.x; }))],
       ['y', U.median(pts.map(function (p) { return p.y; }))]].forEach(function (par) {
        if (!U.isNum(par[1])) return;
        var attrs = par[0] === 'x'
          ? { x1: sx(par[1]), x2: sx(par[1]), y1: y0, y2: y1 }
          : { x1: x0, x2: x1, y1: sy(par[1]), y2: sy(par[1]) };
        attrs.style = 'stroke:var(--axis);stroke-width:1;opacity:.7';
        g.appendChild(U.svg('line', attrs));
      });

      g.appendChild(U.svg('text', { class: 'axis-title', x: (x0 + x1) / 2, y: H - 8,
                                    'text-anchor': 'middle', text: cfg.tituloX || '' }));
      g.appendChild(U.svg('text', { class: 'axis-title', x: 2, y: y0 - 10,
                                    'text-anchor': 'start', text: cfg.tituloY || '' }));

      var superficie = getComputedStyle(document.body).getPropertyValue('--surface-1').trim() || '#fff';
      pts.forEach(function (p) {
        var cor = p.color || Colors.of(p.key != null ? p.key : p.label);
        var c = U.svg('circle', { cx: sx(p.x), cy: sy(p.y), r: raio(p),
          style: 'fill:' + cor + ';stroke:' + superficie + ';stroke-width:2;opacity:.92' });
        function mostrar(ev) {
          showTip('<div class="tip__title">' + escapeHTML(p.label) + '</div>' +
            tipRow(cor, cfg.tituloX || 'X', (cfg.fmtX || U.compact)(p.x)) +
            tipRow(cor, cfg.tituloY || 'Y', (cfg.fmtY || U.compact)(p.y)) +
            (cfg.dimensionar && U.isNum(p.size)
              ? tipRow(null, cfg.tituloTamanho || 'Tamanho', U.compact(p.size)) : ''), ev);
        }
        // área de acerto generosa (>= 24px), separada da marca visível
        var alvo = U.svg('circle', { cx: sx(p.x), cy: sy(p.y), r: Math.max(12, raio(p) + 6),
                                     fill: 'transparent' });
        [c, alvo].forEach(function (n) {
          n.addEventListener('mousemove', mostrar);
          n.addEventListener('mouseleave', hideTip);
        });
        g.appendChild(c); g.appendChild(alvo);
      });

      // rótulos diretos apenas nos extremos
      var destaques = pts.slice()
        .sort(function (a, b) { return (b.size || 0) - (a.size || 0); })
        .slice(0, cfg.rotular || 5);
      destaques.forEach(function (p) {
        g.appendChild(U.svg('text', { class: 'mark-label', x: sx(p.x) + raio(p) + 5,
          y: sy(p.y) + 4, text: U.truncate(p.label, 20) }));
      });

      host.appendChild(svgEl);
    });
  }

  /* =====================================================================
     5. Heatmap (matriz) — rampa sequencial ou divergente
     ===================================================================== */

  function heatmap(node, cfg) {
    var linhasM = cfg.rows || [], colunasM = cfg.cols || [], valores = cfg.values || [];
    if (!linhasM.length || !colunasM.length) return vazio(node, cfg.vazio);

    return montar(node, function (host, W) {
      var rotuloW = Math.min(Math.max(110, Math.round(W * 0.26)), 260);
      var padT = 44, padB = 10, padR = 12;
      var cellH = cfg.alturaCelula || 26;
      var H = padT + padB + linhasM.length * cellH;
      var x0 = rotuloW, x1 = W - padR;
      var cellW = (x1 - x0) / colunasM.length;

      var planos = [];
      valores.forEach(function (lin) { lin.forEach(function (v) { if (U.isNum(v)) planos.push(v); }); });
      var vmin = planos.length ? Math.min.apply(null, planos) : 0;
      var vmax = planos.length ? Math.max.apply(null, planos) : 1;
      var divergente = cfg.escala === 'divergente';
      var lim = Math.max(Math.abs(vmin), Math.abs(vmax)) || 1;

      var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                 'aria-label': cfg.aria || 'Matriz de calor' });
      var g = U.svg('g'); svgEl.appendChild(g);

      colunasM.forEach(function (c, j) {
        var cx = x0 + cellW * (j + 0.5);
        var txt = U.svg('text', { class: 'tick', x: cx, y: padT - 10, 'text-anchor': 'middle',
                                  text: U.truncate(c.label, Math.max(8, Math.floor(cellW / 7))) });
        if (cellW < 62) {
          txt.setAttribute('transform', 'rotate(-40 ' + cx + ' ' + (padT - 10) + ')');
          txt.setAttribute('text-anchor', 'start');
        }
        g.appendChild(txt);
      });

      linhasM.forEach(function (r, i) {
        var y = padT + i * cellH;
        g.appendChild(U.svg('text', { class: 'mark-label', x: x0 - 10, y: y + cellH / 2 + 4,
          'text-anchor': 'end', text: U.truncate(r.label, Math.floor(rotuloW / 6.6)) }));
        colunasM.forEach(function (c, j) {
          var v = (valores[i] || [])[j];
          var x = x0 + j * cellW;
          var cor = !U.isNum(v) ? 'var(--surface-sunk)'
            : divergente ? Colors.div(v / lim)
            : Colors.seq((v - vmin) / ((vmax - vmin) || 1));
          var cell = U.svg('rect', { x: x + 1, y: y + 1, width: Math.max(1, cellW - GAP),
            height: Math.max(1, cellH - GAP), rx: 3, style: 'fill:' + cor });
          cell.addEventListener('mousemove', function (ev) {
            showTip('<div class="tip__title">' + escapeHTML(r.label) + '</div>' +
              tipRow(cor, c.label, U.isNum(v) ? (cfg.fmtValor || U.compact)(v) : 'sem dado'), ev);
          });
          cell.addEventListener('mouseleave', hideTip);
          g.appendChild(cell);

          if (cfg.mostrarValor && cellW > 54 && U.isNum(v)) {
            // numa escala divergente o extremo escuro fica nas DUAS pontas,
            // então a intensidade é o módulo, não a posição no intervalo
            var t = divergente ? Math.abs(v) / lim : (v - vmin) / ((vmax - vmin) || 1);
            g.appendChild(U.svg('text', {
              x: x + cellW / 2, y: y + cellH / 2 + 4, 'text-anchor': 'middle',
              style: 'font-size:10.5px;font-variant-numeric:tabular-nums;fill:' +
                (t > 0.58 ? '#fff' : 'var(--text-primary)'),
              text: (cfg.fmtCelula || cfg.fmtValor || U.compact)(v)
            }));
          }
        });
      });

      host.appendChild(svgEl);
      // legenda de escala
      var esc = U.el('div', { class: 'row small muted', style: 'padding:8px 2px 0' });
      esc.appendChild(U.el('span', { text: (cfg.fmtValor || U.compact)(divergente ? -lim : vmin) }));
      var faixa = U.el('span', { style: 'display:inline-block;height:8px;width:150px;border-radius:4px;background:linear-gradient(90deg,' +
        (divergente ? 'var(--seq-600),var(--div-mid),var(--div-pos)' : 'var(--seq-100),var(--seq-700)') + ')' });
      esc.appendChild(faixa);
      esc.appendChild(U.el('span', { text: (cfg.fmtValor || U.compact)(divergente ? lim : vmax) }));
      host.appendChild(esc);
    });
  }

  /* =====================================================================
     6. Waterfall (contribuição para a variação)
     ===================================================================== */

  function waterfall(node, cfg) {
    var itens = cfg.items || [];
    if (!itens.length) return vazio(node, cfg.vazio);

    return montar(node, function (host, W) {
      var padL = 64, padR = 16, padT = 14, padB = 56;
      var H = cfg.altura || 330;
      var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

      var acum = cfg.base || 0, pontos = [acum];
      itens.forEach(function (it) {
        if (it.total) {
          acum = U.isNum(it.value) && it.value !== 0 ? it.value : acum;
        } else {
          acum += U.isNum(it.value) ? it.value : 0;
        }
        pontos.push(acum);
      });
      var t = niceTicks(Math.min(0, Math.min.apply(null, pontos)),
                        Math.max(0, Math.max.apply(null, pontos)), 5);
      var sy = linear(t.min, t.max, y1, y0);

      var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                                 'aria-label': cfg.aria || 'Decomposição da variação' });
      var g = U.svg('g'); svgEl.appendChild(g);
      eixoY(g, sy, t.ticks, x0, x1, cfg.fmtEixo || U.compact);

      var banda = (x1 - x0) / itens.length;
      var espessura = Math.min(CAP, banda * 0.62);
      var corrente = cfg.base || 0;

      itens.forEach(function (it, i) {
        var centro = x0 + banda * (i + 0.5);
        var xb = centro - espessura / 2;
        var v = U.isNum(it.value) ? it.value : 0;
        var de, para, cor;
        if (it.total) {
          de = 0;
          para = U.isNum(it.value) && it.value !== 0 ? it.value : corrente;
          corrente = para;
          cor = 'var(--text-muted)';
        } else {
          de = corrente; para = corrente + v; corrente = para;
          cor = v >= 0 ? 'var(--seq-500)' : 'var(--div-pos)';
        }
        var yb = Math.min(sy(de), sy(para));
        var hb = Math.max(1.5, Math.abs(sy(para) - sy(de)));
        var p = U.svg('path', { d: barPath(xb, yb, espessura, hb, para >= de ? 'top' : 'bottom'),
                                style: 'fill:' + cor });
        p.addEventListener('mousemove', function (ev) {
          showTip('<div class="tip__title">' + escapeHTML(it.label) + '</div>' +
            tipRow(cor, it.total ? 'Total' : 'Contribuição', (cfg.fmtValor || U.compact)(it.total ? para : v)), ev);
        });
        p.addEventListener('mouseleave', hideTip);
        g.appendChild(p);

        g.appendChild(U.svg('text', { class: 'mark-label', x: centro,
          y: (para >= de ? yb - 6 : yb + hb + 14), 'text-anchor': 'middle',
          text: (cfg.fmtValor || U.compact)(it.total ? para : v) }));

        var rot = U.svg('text', { class: 'tick', x: centro, y: y1 + 16, 'text-anchor': 'middle',
          text: U.truncate(it.label, Math.max(6, Math.floor(banda / 6.5))) });
        if (itens.length > 6 || banda < 70) {
          rot.setAttribute('transform', 'rotate(-35 ' + centro + ' ' + (y1 + 16) + ')');
          rot.setAttribute('text-anchor', 'end');
        }
        g.appendChild(rot);
      });

      g.appendChild(U.svg('line', { class: 'baseline', x1: x0, x2: x1,
        y1: Math.round(sy(0)) + 0.5, y2: Math.round(sy(0)) + 0.5 }));
      host.appendChild(svgEl);
    });
  }

  /* =====================================================================
     7. Sparkline (dentro de stat tiles)
     ===================================================================== */

  function sparkline(node, valores, cor) {
    var v = (valores || []).filter(function (x) { return U.isNum(x); });
    if (v.length < 2) return vazio(node, '');
    return montar(node, function (host, W) {
      var H = 30, pad = 3;
      var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
      var sy = linear(min, max, H - pad, pad);
      var sx = linear(0, v.length - 1, pad, W - pad);
      var d = v.map(function (y, i) { return (i ? 'L' : 'M') + sx(i).toFixed(1) + ',' + sy(y).toFixed(1); }).join('');
      var svgEl = U.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' }, [
        U.svg('path', { d: d, style: 'fill:none;stroke:var(--text-muted);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;opacity:.55' }),
        U.svg('circle', { cx: sx(v.length - 1), cy: sy(v[v.length - 1]), r: 3,
          style: 'fill:' + (cor || 'var(--accent)') })
      ]);
      host.appendChild(svgEl);
    });
  }

  global.CH = {
    Colors: Colors,
    ranking: ranking,
    colunas: colunas,
    linhas: linhas,
    dispersao: dispersao,
    heatmap: heatmap,
    waterfall: waterfall,
    sparkline: sparkline,
    vazio: vazio,
    niceTicks: niceTicks,
    escapeHTML: escapeHTML,
    hideTip: hideTip
  };
})(window);
