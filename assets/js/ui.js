/* ui.js — componentes de interface reutilizáveis. Namespace global `UI`. */
(function (global) {
  'use strict';
  var U = global.U;

  /* ------------------------------ toasts ------------------------------- */

  var toasts = null;
  function toast(msg, tipo, ms) {
    if (!toasts) {
      toasts = U.el('div', { class: 'toasts', 'aria-live': 'polite' });
      document.body.appendChild(toasts);
    }
    var t = U.el('div', { class: 'toast' + (tipo ? ' toast--' + tipo : ''), text: msg });
    toasts.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, ms || 4200);
    return t;
  }

  /* ------------------------------- modal -------------------------------- */

  function modal(opts) {
    var box = U.el('div', { class: 'modal__box', role: 'dialog', 'aria-modal': 'true',
                            'aria-label': opts.titulo || 'Diálogo' });
    var scrim = U.el('div', { class: 'modal__scrim' });
    var raiz = U.el('div', { class: 'modal' }, [scrim, box]);
    if (opts.titulo) box.appendChild(U.el('h2', { class: 'modal__title', text: opts.titulo }));
    if (opts.sub) box.appendChild(U.el('p', { class: 'small muted', text: opts.sub }));
    if (opts.corpo) box.appendChild(opts.corpo);

    function fechar() {
      document.removeEventListener('keydown', onKey);
      if (raiz.parentNode) raiz.parentNode.removeChild(raiz);
    }
    function onKey(e) { if (e.key === 'Escape') fechar(); }

    var pe = U.el('div', { class: 'modal__foot' });
    (opts.acoes || [{ label: 'Fechar' }]).forEach(function (a) {
      pe.appendChild(U.el('button', {
        class: 'btn' + (a.primaria ? ' btn--primary' : '') + (a.perigo ? ' btn--danger' : ''),
        text: a.label,
        onclick: function () { if (!a.onClick || a.onClick() !== false) fechar(); }
      }));
    });
    box.appendChild(pe);
    scrim.addEventListener('click', fechar);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(raiz);
    var foco = box.querySelector('input, select, textarea, button');
    if (foco) foco.focus();
    return { fechar: fechar, box: box };
  }

  function confirmar(titulo, texto, onSim) {
    return modal({
      titulo: titulo,
      corpo: U.el('p', { text: texto }),
      acoes: [
        { label: 'Cancelar' },
        { label: 'Confirmar', primaria: true, onClick: onSim }
      ]
    });
  }

  /* --------------------------- multiselect ------------------------------ */

  /**
   * Seletor múltiplo com busca, chips e ações em massa.
   * opts: { opcoes:[{value,label,sub}], selecionados:[], onChange(vals),
   *         placeholder, max, corPorValor:boolean }
   */
  function multiselect(opts) {
    var selecionados = (opts.selecionados || []).slice();
    var opcoes = opts.opcoes || [];
    var raiz = U.el('div', { class: 'ms' });
    var controle = U.el('div', { class: 'ms__control' });
    var input = U.el('input', { class: 'ms__input', type: 'text',
      placeholder: opts.placeholder || 'Buscar…', 'aria-label': opts.placeholder || 'Buscar' });
    var painel = U.el('div', { class: 'ms__panel', hidden: true, role: 'listbox' });
    raiz.appendChild(controle); raiz.appendChild(painel);

    function emitir() { if (opts.onChange) opts.onChange(selecionados.slice()); }

    function rotulo(v) {
      var o = opcoes.find(function (x) { return String(x.value) === String(v); });
      return o ? o.label : String(v);
    }

    function pintarChips() {
      U.clear(controle);
      selecionados.forEach(function (v) {
        controle.appendChild(U.el('span', { class: 'chip', title: rotulo(v) }, [
          opts.corPorValor
            ? U.el('span', { class: 'chip__dot', style: 'background:' + global.CH.Colors.of(v) })
            : null,
          U.el('span', { class: 'chip__text', text: U.truncate(rotulo(v), 26) }),
          U.el('button', { class: 'chip__x', 'aria-label': 'Remover ' + rotulo(v), text: '×',
            onclick: function (e) {
              e.stopPropagation();
              selecionados = selecionados.filter(function (x) { return x !== v; });
              pintarChips(); pintarOpcoes(); emitir();
            } })
        ]));
      });
      controle.appendChild(input);
    }

    function filtradas() {
      var q = U.norm(input.value);
      if (!q) return opcoes;
      return opcoes.filter(function (o) {
        return U.norm(o.label).indexOf(q) >= 0 || U.norm(o.sub || '').indexOf(q) >= 0 ||
               String(o.value).toLowerCase().indexOf(q) >= 0;
      });
    }

    function pintarOpcoes() {
      U.clear(painel);
      var lista = filtradas();
      if (!lista.length) {
        painel.appendChild(U.el('div', { class: 'ms__empty', text: 'Nenhum resultado.' }));
      }
      lista.slice(0, 400).forEach(function (o) {
        var sel = selecionados.indexOf(o.value) >= 0;
        painel.appendChild(U.el('div', {
          class: 'ms__opt', role: 'option', 'aria-selected': sel ? 'true' : 'false',
          onclick: function () {
            if (sel) selecionados = selecionados.filter(function (x) { return x !== o.value; });
            else {
              if (opts.max && selecionados.length >= opts.max) {
                toast('Limite de ' + opts.max + ' seleções — remova alguma antes de incluir outra.', 'warn');
                return;
              }
              selecionados.push(o.value);
            }
            input.value = '';
            pintarChips(); pintarOpcoes(); emitir();
          }
        }, [
          U.el('span', { text: sel ? '✓' : '', style: 'width:12px;flex:0 0 auto;color:var(--accent)' }),
          U.el('span', {}, [
            U.el('span', { text: o.label }),
            o.sub ? U.el('small', { text: '  ' + o.sub }) : null
          ])
        ]));
      });
      if (lista.length > 400) {
        painel.appendChild(U.el('div', { class: 'ms__empty',
          text: lista.length + ' resultados — refine a busca para ver todos.' }));
      }
      var massa = U.el('div', { class: 'ms__bulk' }, [
        U.el('button', { class: 'btn btn--sm', text: 'Selecionar visíveis', onclick: function () {
          var alvo = filtradas().map(function (o) { return o.value; });
          var lim = opts.max || 999;
          alvo.forEach(function (v) {
            if (selecionados.indexOf(v) < 0 && selecionados.length < lim) selecionados.push(v);
          });
          pintarChips(); pintarOpcoes(); emitir();
        } }),
        U.el('button', { class: 'btn btn--sm', text: 'Limpar', onclick: function () {
          selecionados = []; pintarChips(); pintarOpcoes(); emitir();
        } })
      ]);
      painel.appendChild(massa);
    }

    controle.addEventListener('click', function () { input.focus(); painel.hidden = false; pintarOpcoes(); });
    input.addEventListener('focus', function () { painel.hidden = false; pintarOpcoes(); });
    input.addEventListener('input', pintarOpcoes);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { painel.hidden = true; }
      if (e.key === 'Backspace' && !input.value && selecionados.length) {
        selecionados.pop(); pintarChips(); pintarOpcoes(); emitir();
      }
      if (e.key === 'Enter') {
        var primeira = filtradas()[0];
        if (primeira && selecionados.indexOf(primeira.value) < 0) {
          if (!opts.max || selecionados.length < opts.max) {
            selecionados.push(primeira.value);
            input.value = ''; pintarChips(); pintarOpcoes(); emitir();
          }
        }
        e.preventDefault();
      }
    });
    document.addEventListener('click', function (e) {
      if (!raiz.contains(e.target)) painel.hidden = true;
    });

    pintarChips();

    return {
      node: raiz,
      valores: function () { return selecionados.slice(); },
      definir: function (vals) { selecionados = (vals || []).slice(); pintarChips(); pintarOpcoes(); },
      atualizarOpcoes: function (novas, manterSelecao) {
        opcoes = novas || [];
        if (!manterSelecao) selecionados = [];
        else {
          var validos = {};
          opcoes.forEach(function (o) { validos[o.value] = true; });
          selecionados = selecionados.filter(function (v) { return validos[v]; });
        }
        pintarChips(); pintarOpcoes();
      }
    };
  }

  /* ------------------------------ campos -------------------------------- */

  function campo(label, controle, hint) {
    return U.el('div', { class: 'filterbar__group' + (hint === 'grow' ? ' filterbar__group--grow' : '') }, [
      U.el('label', { class: 'field-label', text: label }),
      controle
    ]);
  }

  function seletor(opcoes, valor, onChange, attrs) {
    var s = U.el('select', Object.assign({ onchange: function () { onChange(s.value); } }, attrs || {}));
    (opcoes || []).forEach(function (o) {
      s.appendChild(U.el('option', { value: o.value, text: o.label,
        selected: String(o.value) === String(valor) }));
    });
    s.value = valor;
    return s;
  }

  function segmentado(opcoes, valor, onChange) {
    var box = U.el('div', { class: 'seg', role: 'group' });
    opcoes.forEach(function (o) {
      box.appendChild(U.el('button', {
        type: 'button', text: o.label, 'aria-pressed': String(o.value) === String(valor) ? 'true' : 'false',
        title: o.hint || o.label,
        onclick: function () {
          U.$$('button', box).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          this.setAttribute('aria-pressed', 'true');
          onChange(o.value);
        }
      }));
    });
    return box;
  }

  function alternador(label, marcado, onChange, hint) {
    var input = U.el('input', { type: 'checkbox', checked: marcado,
      onchange: function () { onChange(input.checked); } });
    return U.el('label', { class: 'switch', title: hint || label }, [input, U.el('span', { text: label })]);
  }

  /* ------------------------------- cards -------------------------------- */

  /**
   * Card com cabeçalho, ferramentas e corpo. Todo card de gráfico ganha por
   * padrão o alternador "Tabela" (todo valor precisa estar acessível sem hover)
   * e os botões de exportação.
   */
  function card(opts) {
    var corpo = U.el('div', { class: 'card__body' + (opts.flush ? ' card__body--flush' : '') });
    var tools = U.el('div', { class: 'card__tools' });
    var cabecalho = U.el('div', { class: 'card__head' }, [
      U.el('div', {}, [
        U.el('h3', { class: 'card__title', text: opts.titulo }),
        opts.sub ? U.el('div', { class: 'card__sub', text: opts.sub }) : null
      ]),
      tools
    ]);
    var raiz = U.el('div', { class: 'card' }, [cabecalho, corpo]);
    return { node: raiz, corpo: corpo, tools: tools, cabecalho: cabecalho };
  }

  /** Par gráfico + tabela com alternância — garante leitura sem depender de cor. */
  function grafico(opts) {
    var c = card(opts);
    var areaGrafico = U.el('div');
    var areaTabela = U.el('div', { hidden: true });
    c.corpo.appendChild(areaGrafico);
    c.corpo.appendChild(areaTabela);

    var modo = 'grafico';
    c.tools.appendChild(segmentado(
      [{ label: 'Gráfico', value: 'grafico' }, { label: 'Tabela', value: 'tabela' }],
      'grafico',
      function (v) {
        modo = v;
        areaGrafico.hidden = v !== 'grafico';
        areaTabela.hidden = v !== 'tabela';
        if (v === 'grafico') {
          var alvo = areaGrafico.querySelector('.chart');
          if (alvo && alvo.__redraw) alvo.__redraw();
        }
      }));

    if (opts.exportar !== false) {
      c.tools.appendChild(U.el('button', {
        class: 'btn btn--sm btn--ghost', text: 'PNG', title: 'Baixar imagem do gráfico',
        onclick: function () {
          var svg = areaGrafico.querySelector('svg');
          if (!svg) return toast('Nada para exportar.', 'warn');
          U.downloadPNG((U.slug(opts.titulo) || 'grafico') + '.png', svg, 2);
        }
      }));
      c.tools.appendChild(U.el('button', {
        class: 'btn btn--sm btn--ghost', text: 'SVG', title: 'Baixar vetor do gráfico',
        onclick: function () {
          var svg = areaGrafico.querySelector('svg');
          if (!svg) return toast('Nada para exportar.', 'warn');
          U.downloadSVG((U.slug(opts.titulo) || 'grafico') + '.svg', svg);
        }
      }));
    }

    return { node: c.node, grafico: areaGrafico, tabela: areaTabela, tools: c.tools,
             modo: function () { return modo; } };
  }

  function nota(texto, tipo, icone) {
    return U.el('div', { class: 'note' + (tipo ? ' note--' + tipo : '') }, [
      U.el('span', { class: 'note__icon', text: icone || (tipo === 'bad' ? '!' : tipo === 'warn' ? '!' : 'i') }),
      U.el('div', typeof texto === 'string' ? { text: texto } : {}, typeof texto === 'string' ? null : texto)
    ]);
  }

  function vazio(titulo, texto) {
    return U.el('div', { class: 'empty' }, [
      U.el('h3', { text: titulo }),
      U.el('div', { class: 'small', text: texto || '' })
    ]);
  }

  function carregando(texto) {
    return U.el('div', { class: 'loading' }, [
      U.el('div', { class: 'spinner' }),
      U.el('span', { text: texto || 'Carregando dados do Banco Central…' })
    ]);
  }

  /** Stat tile: rótulo, valor, variação opcional e sparkline opcional. */
  function stat(opts) {
    var box = U.el('div', { class: 'stat' });
    box.appendChild(U.el('div', { class: 'stat__label', text: opts.label }));
    box.appendChild(U.el('div', { class: 'stat__value', text: opts.valor }));
    if (opts.delta !== undefined && opts.delta !== null && U.isNum(opts.delta)) {
      var dir = opts.delta > 0.05 ? 'up' : opts.delta < -0.05 ? 'down' : 'flat';
      var bom = opts.melhor === 'baixo' ? (dir === 'down') : (dir === 'up');
      var classe = dir === 'flat' ? 'flat' : (bom ? 'up' : 'down');
      box.appendChild(U.el('div', { class: 'stat__delta stat__delta--' + classe }, [
        U.el('span', { text: dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■' }),
        U.el('span', { text: U.signed(opts.delta, opts.deltaDecimais == null ? 1 : opts.deltaDecimais) +
          (opts.deltaUnidade || ' p.p.') + (opts.deltaRef ? ' vs ' + opts.deltaRef : '') })
      ]));
    }
    if (opts.nota) box.appendChild(U.el('div', { class: 'stat__note', text: opts.nota }));
    if (opts.serie && opts.serie.length > 1) {
      var sp = U.el('div', { class: 'stat__spark' });
      box.appendChild(sp);
      setTimeout(function () { global.CH.sparkline(sp, opts.serie, 'var(--accent)'); }, 0);
    }
    return box;
  }

  global.UI = {
    toast: toast, modal: modal, confirmar: confirmar, multiselect: multiselect,
    campo: campo, seletor: seletor, segmentado: segmentado, alternador: alternador,
    card: card, grafico: grafico, nota: nota, vazio: vazio, carregando: carregando, stat: stat
  };
})(window);
