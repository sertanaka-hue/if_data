/* table.js — tabela de dados com ordenação, busca, coluna fixa e exportação.
   Namespace global `TBL`. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI;

  /**
   * @param {HTMLElement} node contêiner
   * @param {Object} cfg
   *   columns: [{key, label, tipo:'num'|'txt', decimais, fmt(v,row), largura, sticky}]
   *   rows:    [{...}]
   *   ordenar: {key, dir}      ordenação inicial
   *   busca:   boolean         mostra campo de busca
   *   maxLinhas: number        corta a exibição (com botão "mostrar todas")
   *   nomeArquivo: string      base do CSV exportado
   *   rodape: string           texto extra no rodapé
   */
  function render(node, cfg) {
    var colunas = cfg.columns || [];
    var linhas = cfg.rows || [];
    var ordem = cfg.ordenar ? { key: cfg.ordenar.key, dir: cfg.ordenar.dir || 'desc' } : null;
    var termo = '';
    var limite = cfg.maxLinhas || 150;
    var expandido = false;

    U.clear(node);
    if (!colunas.length || !linhas.length) {
      node.appendChild(UI.vazio('Sem dados', cfg.vazio || 'Ajuste os filtros e execute a consulta.'));
      return { atualizar: function () {} };
    }

    var cabecalho = U.el('div', { class: 'row', style: 'padding:8px 12px;gap:8px' });
    var buscaInput = null;
    if (cfg.busca !== false) {
      buscaInput = U.el('input', { type: 'search', placeholder: 'Filtrar linhas…',
        'aria-label': 'Filtrar linhas da tabela', style: 'min-width:200px' });
      buscaInput.addEventListener('input', U.debounce(function () {
        termo = U.norm(buscaInput.value); pintar();
      }, 160));
      cabecalho.appendChild(buscaInput);
    }
    var contador = U.el('span', { class: 'small muted' });
    cabecalho.appendChild(contador);
    var espaco = U.el('span', { style: 'flex:1' });
    cabecalho.appendChild(espaco);
    cabecalho.appendChild(U.el('button', {
      class: 'btn btn--sm', text: 'Exportar CSV',
      title: 'Baixa as linhas visíveis, no separador ";" (abre direto no Excel pt-BR)',
      onclick: function () {
        var vis = visiveis();
        U.downloadCSV((cfg.nomeArquivo || 'ifdata') + '.csv', vis.map(function (r) {
          var o = {};
          colunas.forEach(function (c) {
            var v = r[c.key];
            o[c.key] = c.tipo === 'num' && U.isNum(v) ? v : (v == null ? '' : String(v));
          });
          return o;
        }), colunas.map(function (c) { return { key: c.key, label: c.label }; }));
        UI.toast(vis.length + ' linhas exportadas.', 'good');
      }
    }));
    node.appendChild(cabecalho);

    var wrap = U.el('div', { class: 'tablewrap' });
    var tabela = U.el('table', { class: 'dt' });
    var thead = U.el('thead');
    var tbody = U.el('tbody');
    tabela.appendChild(thead); tabela.appendChild(tbody);
    wrap.appendChild(tabela);
    node.appendChild(wrap);
    var rodape = U.el('div', { class: 'dt-foot' });
    node.appendChild(rodape);

    function visiveis() {
      var out = linhas;
      if (termo) {
        out = out.filter(function (r) {
          return colunas.some(function (c) {
            return U.norm(String(r[c.key] == null ? '' : r[c.key])).indexOf(termo) >= 0;
          });
        });
      }
      if (ordem) out = out.slice().sort(U.by(ordem.key, ordem.dir));
      return out;
    }

    function formatar(col, valor, linha) {
      if (col.fmt) return col.fmt(valor, linha);
      if (col.tipo === 'num') return U.isNum(valor) ? U.fmt(valor, col.decimais == null ? 0 : col.decimais) : '–';
      return valor == null || valor === '' ? '–' : String(valor);
    }

    function pintarCabecalho() {
      U.clear(thead);
      var tr = U.el('tr');
      colunas.forEach(function (c) {
        var th = U.el('th', {
          class: (c.tipo === 'num' ? 'num ' : '') + (c.sticky ? 'sticky' : ''),
          title: c.hint || c.label,
          scope: 'col',
          onclick: function () {
            if (ordem && ordem.key === c.key) ordem.dir = ordem.dir === 'desc' ? 'asc' : 'desc';
            else ordem = { key: c.key, dir: c.tipo === 'num' ? 'desc' : 'asc' };
            pintarCabecalho(); pintar();
          }
        }, [
          U.el('span', { text: c.label }),
          ordem && ordem.key === c.key
            ? U.el('span', { class: 'sort', text: ordem.dir === 'desc' ? '▼' : '▲' }) : null
        ]);
        if (c.largura) th.style.minWidth = c.largura + 'px';
        tr.appendChild(th);
      });
      thead.appendChild(tr);
    }

    function pintar() {
      var vis = visiveis();
      var corte = expandido ? vis.length : Math.min(vis.length, limite);
      U.clear(tbody);
      var frag = document.createDocumentFragment();
      for (var i = 0; i < corte; i++) {
        var r = vis[i];
        var tr = U.el('tr');
        colunas.forEach(function (c) {
          var v = r[c.key];
          var negativo = c.tipo === 'num' && U.isNum(v) && v < 0;
          var td = U.el('td', {
            class: (c.tipo === 'num' ? 'num ' : '') + (c.sticky ? 'sticky ' : '') + (negativo ? 'neg' : ''),
            text: formatar(c, v, r),
            title: c.sticky || c.tipo !== 'num' ? String(v == null ? '' : v) : null
          });
          tr.appendChild(td);
        });
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
      contador.textContent = vis.length + ' de ' + linhas.length + ' linhas';

      U.clear(rodape);
      if (vis.length > corte) {
        rodape.appendChild(U.el('span', { text: 'Exibindo ' + corte + ' de ' + vis.length + '.' }));
        rodape.appendChild(U.el('button', {
          class: 'btn btn--sm', text: 'Mostrar todas',
          onclick: function () { expandido = true; pintar(); }
        }));
      } else if (expandido && vis.length > limite) {
        rodape.appendChild(U.el('span', { text: 'Exibindo todas as ' + vis.length + ' linhas.' }));
        rodape.appendChild(U.el('button', {
          class: 'btn btn--sm', text: 'Reduzir',
          onclick: function () { expandido = false; pintar(); }
        }));
      }
      if (cfg.rodape) rodape.appendChild(U.el('span', { text: cfg.rodape }));
    }

    pintarCabecalho();
    pintar();

    return {
      atualizar: function (novasLinhas, novasColunas) {
        linhas = novasLinhas || linhas;
        if (novasColunas) { colunas = novasColunas; pintarCabecalho(); }
        pintar();
      },
      visiveis: visiveis
    };
  }

  /** Monta colunas a partir de uma lista de nomes de coluna do IF.data. */
  function colunasDeDados(nomes, opts) {
    var o = opts || {};
    return (nomes || []).map(function (n) {
      return { key: n, label: n, tipo: 'num', decimais: o.decimais == null ? 0 : o.decimais,
               largura: 120 };
    });
  }

  global.TBL = { render: render, colunasDeDados: colunasDeDados };
})(window);
