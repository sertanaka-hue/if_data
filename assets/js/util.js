/* util.js — helpers de formatação, DOM, estatística e exportação.
   Script clássico: expõe o namespace global `U`. */
(function (global) {
  'use strict';

  /* ---------- DOM ---------------------------------------------------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : children != null ? [children] : [])
      .forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c)) : c);
      });
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') { node.textContent = v; return; }
        if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v); return;
        }
        node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : children != null ? [children] : [])
      .forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- texto / normalização ------------------------------------ */

  /** minúsculas, sem acentos, sem pontuação — base para casar nomes de colunas. */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function slug(s) { return norm(s).replace(/ /g, '-'); }

  /** hash estável (djb2) — usado para dar cor fixa por entidade. */
  function hash(s) {
    var h = 5381, str = String(s);
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
  }

  /* ---------- números --------------------------------------------------- */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Converte valores da API (número, "1.234,56" ou "1234.56") em Number. */
  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s || /^(n\/?d|n\/?a|-{1,2})$/i.test(s)) return null;
    s = s.replace(/\s|R\$|%/g, '');
    // "1.234.567,89" -> vírgula decimal;  "1,234,567.89" -> ponto decimal
    if (/,\d{1,4}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/,/.test(s) && !/\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  var nf = function (min, max) {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
  };
  var F0 = nf(0, 0), F1 = nf(1, 1), F2 = nf(2, 2);

  function fmt(v, decimals) {
    if (!isNum(v)) return '–';
    var d = decimals == null ? 2 : decimals;
    return nf(d, d).format(v);
  }

  /** Formato compacto para eixos e tiles: 1,2 mil / 3,4 mi / 5,6 bi / 7,8 tri. */
  function compact(v, decimals) {
    if (!isNum(v)) return '–';
    var d = decimals == null ? 1 : decimals;
    var a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e12) return sign + nf(0, d).format(a / 1e12) + ' tri';
    if (a >= 1e9)  return sign + nf(0, d).format(a / 1e9)  + ' bi';
    if (a >= 1e6)  return sign + nf(0, d).format(a / 1e6)  + ' mi';
    if (a >= 1e3)  return sign + nf(0, d).format(a / 1e3)  + ' mil';
    if (a === 0)   return '0';
    if (a < 1)     return sign + nf(0, 2).format(a);
    return sign + nf(0, d).format(a);
  }

  function pct(v, decimals) { return isNum(v) ? fmt(v, decimals == null ? 1 : decimals) + '%' : '–'; }
  function signed(v, decimals) {
    if (!isNum(v)) return '–';
    return (v > 0 ? '+' : '') + fmt(v, decimals == null ? 1 : decimals);
  }

  /* ---------- períodos (AAAAMM trimestral) ------------------------------ */

  var MESES = { '03': '1T', '06': '2T', '09': '3T', '12': '4T' };

  function periodLabel(anoMes) {
    var s = String(anoMes);
    if (s.length !== 6) return s;
    var ano = s.slice(0, 4), mes = s.slice(4);
    return (MESES[mes] || mes + '/') + ano;
  }
  function periodLong(anoMes) {
    var s = String(anoMes);
    if (s.length !== 6) return s;
    return periodLabel(s) + ' (' + s.slice(4) + '/' + s.slice(0, 4) + ')';
  }
  function periodToIndex(anoMes) {
    var s = String(anoMes);
    return Number(s.slice(0, 4)) * 4 + (Number(s.slice(4)) / 3 - 1);
  }
  function indexToPeriod(idx) {
    var ano = Math.floor(idx / 4), q = idx % 4;
    return String(ano) + String((q + 1) * 3).padStart(2, '0');
  }
  function periodRange(from, to) {
    var a = periodToIndex(from), b = periodToIndex(to), out = [];
    if (a > b) { var t = a; a = b; b = t; }
    for (var i = a; i <= b; i++) out.push(indexToPeriod(i));
    return out;
  }
  function shiftPeriod(anoMes, quarters) { return indexToPeriod(periodToIndex(anoMes) + quarters); }

  /** Último trimestre provavelmente publicado (lag: 60d p/ mar/jun/set, 90d p/ dez). */
  function latestLikelyPeriod(today) {
    var now = today || new Date();
    var idx = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
    for (var back = 0; back < 8; back++) {
      var p = indexToPeriod(idx - back);
      var ano = Number(p.slice(0, 4)), mes = Number(p.slice(4));
      var lagDays = mes === 12 ? 90 : 60;
      var close = new Date(Date.UTC(ano, mes, 0));
      if (now.getTime() - close.getTime() >= lagDays * 864e5) return p;
    }
    return indexToPeriod(idx - 2);
  }

  function allPeriods(firstYear) {
    var start = periodToIndex(String(firstYear || 2000) + '03');
    var end = periodToIndex(latestLikelyPeriod());
    var out = [];
    for (var i = end; i >= start; i--) out.push(indexToPeriod(i));
    return out; // mais recente primeiro
  }

  /* ---------- estatística ------------------------------------------------ */

  function sum(arr) { return arr.reduce(function (a, b) { return a + (isNum(b) ? b : 0); }, 0); }
  function mean(arr) { var v = arr.filter(isNum); return v.length ? sum(v) / v.length : null; }
  function median(arr) {
    var v = arr.filter(isNum).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function quantile(arr, q) {
    var v = arr.filter(isNum).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var pos = (v.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return v[base + 1] !== undefined ? v[base] + rest * (v[base + 1] - v[base]) : v[base];
  }
  function stdev(arr, sample) {
    var v = arr.filter(isNum);
    if (v.length < 2) return null;
    var m = mean(v);
    var ss = v.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0);
    return Math.sqrt(ss / (sample === false ? v.length : v.length - 1));
  }
  function correl(xs, ys) {
    var pairs = [];
    for (var i = 0; i < Math.min(xs.length, ys.length); i++) {
      if (isNum(xs[i]) && isNum(ys[i])) pairs.push([xs[i], ys[i]]);
    }
    if (pairs.length < 3) return null;
    var mx = mean(pairs.map(function (p) { return p[0]; }));
    var my = mean(pairs.map(function (p) { return p[1]; }));
    var num = 0, dx = 0, dy = 0;
    pairs.forEach(function (p) {
      var a = p[0] - mx, b = p[1] - my;
      num += a * b; dx += a * a; dy += b * b;
    });
    return dx && dy ? num / Math.sqrt(dx * dy) : null;
  }
  /** Herfindahl-Hirschman em pontos (shares em %, 0–10.000). */
  function hhi(values) {
    var total = sum(values.filter(function (v) { return isNum(v) && v > 0; }));
    if (!total) return null;
    return values.reduce(function (a, v) {
      if (!isNum(v) || v <= 0) return a;
      var s = (v / total) * 100;
      return a + s * s;
    }, 0);
  }
  /** Índice de Gini sobre valores não negativos. */
  function gini(values) {
    var v = values.filter(function (x) { return isNum(x) && x >= 0; }).sort(function (a, b) { return a - b; });
    var n = v.length, tot = sum(v);
    if (n < 2 || !tot) return null;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
    return acc / (n * tot);
  }
  function cagr(first, last, periodsPerYear, nPeriods) {
    if (!isNum(first) || !isNum(last) || first <= 0 || nPeriods <= 0) return null;
    var years = nPeriods / periodsPerYear;
    return (Math.pow(last / first, 1 / years) - 1) * 100;
  }
  function growth(from, to) {
    if (!isNum(from) || !isNum(to) || from === 0) return null;
    return ((to - from) / Math.abs(from)) * 100;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- exportação -------------------------------------------------- */

  function toCSV(rows, headers, opts) {
    var o = opts || {};
    var sep = o.sep || ';';                       // ';' abre direto no Excel pt-BR
    var decimal = o.decimal === undefined ? ',' : o.decimal;
    function cell(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') {
        var s = String(v);
        return decimal === ',' ? s.replace('.', ',') : s;
      }
      var t = String(v);
      return /["\n\r;\t,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }
    var head = headers.map(function (h) { return cell(h.label != null ? h.label : h.key); }).join(sep);
    var body = rows.map(function (r) {
      return headers.map(function (h) { return cell(r[h.key]); }).join(sep);
    });
    return '﻿' + [head].concat(body).join('\r\n');
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function downloadCSV(filename, rows, headers, opts) {
    download(filename, toCSV(rows, headers, opts), 'text/csv;charset=utf-8');
  }

  /** Serializa um <svg> ao vivo, resolvendo variáveis CSS em valores literais
      (necessário porque o arquivo exportado não herda a folha de estilo). */
  var PROPS_SVG = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-dasharray', 'opacity', 'font-family', 'font-size',
    'font-weight', 'text-anchor', 'font-variant-numeric', 'transform'];

  function inlineStyles(origem, destino) {
    var cs = getComputedStyle(origem);
    var decl = [];
    PROPS_SVG.forEach(function (prop) {
      var v = cs.getPropertyValue(prop);
      if (v && v !== 'none' || prop === 'fill' || prop === 'stroke') {
        if (v) decl.push(prop + ':' + v.trim());
      }
    });
    destino.setAttribute('style', decl.join(';'));
    var o = origem.children, d = destino.children;
    for (var i = 0; i < o.length && i < d.length; i++) inlineStyles(o[i], d[i]);
  }

  function svgToString(svgNode) {
    var clone = svgNode.cloneNode(true);
    var box = svgNode.getBoundingClientRect();
    var w = Math.round(box.width) || 900, h = Math.round(box.height) || 460;
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    try { inlineStyles(svgNode, clone); } catch (e) {}
    var fundo = getComputedStyle(document.body).getPropertyValue('--surface-1').trim() || '#ffffff';
    var rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%');
    rect.setAttribute('fill', fundo);
    clone.insertBefore(rect, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  function downloadSVG(filename, svgNode) {
    download(filename, svgToString(svgNode), 'image/svg+xml;charset=utf-8');
  }

  function downloadPNG(filename, svgNode, scale) {
    var s = scale || 2;
    var box = svgNode.getBoundingClientRect();
    var w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
    var img = new Image();
    var blob = new Blob([svgToString(svgNode)], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = w * s; c.height = h * s;
      var ctx = c.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--surface-1').trim() || '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (b) download(filename, b); }, 'image/png');
    };
    img.onerror = function () { URL.revokeObjectURL(url); downloadSVG(filename.replace(/\.png$/, '.svg'), svgNode); };
    img.src = url;
  }

  /* ---------- misc --------------------------------------------------------- */

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
    };
  }
  function uid(prefix) { return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9); }
  function unique(arr) { return Array.from(new Set(arr)); }
  function by(key, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return function (a, b) {
      var x = a[key], y = b[key];
      var xn = isNum(x), yn = isNum(y);
      if (xn && yn) return (x - y) * d;
      if (x == null && y == null) return 0;
      if (x == null) return 1;   // nulos sempre por último
      if (y == null) return -1;
      return String(x).localeCompare(String(y), 'pt-BR') * d;
    };
  }

  global.U = {
    el: el, svg: svg, clear: clear, $: $, $$: $$, SVG_NS: SVG_NS,
    norm: norm, slug: slug, hash: hash, truncate: truncate,
    isNum: isNum, toNumber: toNumber, fmt: fmt, compact: compact, pct: pct, signed: signed,
    periodLabel: periodLabel, periodLong: periodLong, periodToIndex: periodToIndex,
    indexToPeriod: indexToPeriod, periodRange: periodRange, shiftPeriod: shiftPeriod,
    latestLikelyPeriod: latestLikelyPeriod, allPeriods: allPeriods,
    sum: sum, mean: mean, median: median, quantile: quantile, stdev: stdev, correl: correl,
    hhi: hhi, gini: gini, cagr: cagr, growth: growth, clamp: clamp,
    toCSV: toCSV, download: download, downloadCSV: downloadCSV,
    svgToString: svgToString, downloadSVG: downloadSVG, downloadPNG: downloadPNG,
    debounce: debounce, uid: uid, unique: unique, by: by
  };
})(window);
