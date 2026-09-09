/* views-dados.js — telas Consulta, Comparação e Série temporal. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, CH = global.CH,
      TBL = global.TBL, CAT = global.CAT, VW = global.VW;

  /* =====================================================================
     Tela 1 — Consulta e tabelas
     ===================================================================== */

  VW.registrar({
    id: 'consulta',
    titulo: 'Consulta',
    descricao: 'Escolha período, tipo de instituição e relatório; veja o ranking e a tabela completa.',
    montar: function (node) {
      var local = { coluna: null, topN: 20, uf: '', segmento: '' };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Consultando o IF.data…');
        VW.carregar()
          .then(function (ds) { if (atual()) pintar(ds); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(ds) {
        U.clear(node);
        var aviso = VW.avisoDemo(ds); if (aviso) node.appendChild(aviso);

        if (!ds.rows.length) {
          node.appendChild(UI.vazio('Nenhum registro neste recorte',
            'O período ' + U.periodLong(ds.anoMes) + ' pode não estar publicado para este relatório. ' +
            'Tente um trimestre anterior ou use "Detectar períodos" em Diagnóstico.'));
          return;
        }

        var numericas = VW.colunasNumericas(ds);
        if (!local.coluna || numericas.indexOf(local.coluna) < 0) local.coluna = VW.campoPrincipal(ds);

        /* --- controles da tela ------------------------------------------ */
        var ufs = U.unique(ds.rows.map(function (r) { return r.UF; }).filter(Boolean)).sort();
        var segs = U.unique(ds.rows.map(function (r) { return r.SR || r.Segmento; }).filter(Boolean)).sort();

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Coluna analisada', UI.seletor(
          numericas.map(function (c) { return { value: c, label: c }; }),
          local.coluna, function (v) { local.coluna = v; pintar(ds); }, { style: 'min-width:260px' })));
        barra.appendChild(UI.campo('Top N', UI.seletor(
          [5, 10, 15, 20, 30, 50].map(function (n) { return { value: String(n), label: String(n) }; }),
          String(local.topN), function (v) { local.topN = Number(v); pintar(ds); })));
        if (ufs.length > 1) {
          barra.appendChild(UI.campo('UF', UI.seletor(
            [{ value: '', label: 'Todas' }].concat(ufs.map(function (u) { return { value: u, label: u }; })),
            local.uf, function (v) { local.uf = v; pintar(ds); })));
        }
        if (segs.length > 1) {
          barra.appendChild(UI.campo('Segmento', UI.seletor(
            [{ value: '', label: 'Todos' }].concat(segs.map(function (s) { return { value: s, label: s }; })),
            local.segmento, function (v) { local.segmento = v; pintar(ds); })));
        }
        barra.appendChild(U.el('div', { class: 'filterbar__actions' }, [
          U.el('button', { class: 'btn btn--sm', text: 'Criar conjunto com o Top ' + local.topN,
            title: 'Salva as instituições exibidas como um conjunto reutilizável',
            onclick: function () { criarConjuntoDoTop(); } })
        ]));
        node.appendChild(barra);

        /* --- filtro aplicado -------------------------------------------- */
        var linhas = ds.rows.filter(function (r) {
          if (local.uf && r.UF !== local.uf) return false;
          if (local.segmento && (r.SR || r.Segmento) !== local.segmento) return false;
          return true;
        });

        var valores = linhas.map(function (r) { return VW.valor(r, local.coluna); });
        var validos = valores.filter(U.isNum);
        var total = U.sum(validos);
        var ordenadas = linhas.slice().sort(function (a, b) {
          return (VW.valor(b, local.coluna) || -Infinity) - (VW.valor(a, local.coluna) || -Infinity);
        });
        var top = ordenadas.slice(0, local.topN);
        var razao = VW.ehRazao(local.coluna);
        var fmt = VW.fmtColuna(local.coluna);

        /* --- stat tiles -------------------------------------------------- */
        var top5 = U.sum(ordenadas.slice(0, 5).map(function (r) { return VW.valor(r, local.coluna); }).filter(U.isNum));
        var indice = razao ? null : U.hhi(validos);
        node.appendChild(VW.faixaStats([
          { label: 'Instituições no recorte', valor: U.fmt(linhas.length, 0),
            nota: U.periodLong(ds.anoMes) },
          razao
            ? { label: 'Mediana de ' + U.truncate(local.coluna, 26), valor: fmt(U.median(validos)),
                nota: 'Média ' + fmt(U.mean(validos)) }
            : { label: 'Total do sistema', valor: fmt(total),
                nota: local.coluna + ' · ' + VW.unidadeColuna(local.coluna) },
          razao
            ? { label: 'Dispersão (desvio-padrão)', valor: fmt(U.stdev(validos)),
                nota: 'p10 ' + fmt(U.quantile(validos, .1)) + ' · p90 ' + fmt(U.quantile(validos, .9)) }
            : { label: 'Concentração top 5', valor: U.pct(total ? (top5 / total) * 100 : null, 1),
                nota: 'Participação das cinco maiores' },
          indice
            ? { label: 'HHI', valor: U.fmt(indice, 0),
                nota: indice > 2500 ? 'Mercado concentrado (>2.500)'
                     : indice > 1500 ? 'Moderadamente concentrado' : 'Pouco concentrado (<1.500)' }
            : { label: 'Cobertura do dado', valor: U.pct(linhas.length ? (validos.length / linhas.length) * 100 : null, 0),
                nota: validos.length + ' de ' + linhas.length + ' instituições informaram' }
        ]));

        /* --- ranking ------------------------------------------------------ */
        var gr = UI.grafico({
          titulo: 'Top ' + Math.min(local.topN, top.length) + ' — ' + local.coluna,
          sub: U.periodLong(ds.anoMes) + ' · ' + VW.unidadeColuna(local.coluna) +
               (local.uf ? ' · UF ' + local.uf : '') + (local.segmento ? ' · ' + local.segmento : '')
        });
        CH.Colors.rebase(top.slice(0, 8).map(function (r) { return r.__id; }));
        CH.ranking(gr.grafico, {
          data: top.map(function (r) {
            var v = VW.valor(r, local.coluna);
            return {
              key: r.__id, label: r.__nome, value: v,
              color: 'var(--series-1)',
              nota: !razao && total ? 'Participação: ' + U.pct((v / total) * 100, 2) : null
            };
          }),
          serieLabel: local.coluna,
          fmtValor: fmt, fmtEixo: fmt,
          aria: 'Ranking das maiores instituições por ' + local.coluna
        });
        TBL.render(gr.tabela, {
          columns: [
            { key: 'pos', label: '#', tipo: 'num', decimais: 0 },
            { key: 'nome', label: 'Instituição', sticky: true, largura: 240 },
            { key: 'valor', label: local.coluna, tipo: 'num', decimais: VW.decimaisColuna(local.coluna) },
            { key: 'share', label: 'Part. %', tipo: 'num', decimais: 2 }
          ],
          rows: top.map(function (r, i) {
            var v = VW.valor(r, local.coluna);
            return { pos: i + 1, nome: r.__nome, valor: v,
                     share: !razao && total && U.isNum(v) ? (v / total) * 100 : null };
          }),
          ordenar: { key: 'pos', dir: 'asc' },
          nomeArquivo: 'ifdata-top-' + U.slug(local.coluna) + '-' + ds.anoMes
        });
        node.appendChild(gr.node);

        /* --- tabela completa ---------------------------------------------- */
        var cartao = UI.card({
          titulo: 'Tabela completa do relatório',
          sub: ds.columns.length + ' colunas · ' + linhas.length + ' instituições · forma do retorno: ' + ds.forma,
          flush: true
        });
        var colunasVisiveis = numericas.slice(0, 12);
        var seletorColunas = UI.multiselect({
          opcoes: numericas.map(function (c) { return { value: c, label: c }; }),
          selecionados: colunasVisiveis,
          placeholder: 'Colunas exibidas…',
          onChange: function (vals) { colunasVisiveis = vals.length ? vals : numericas.slice(0, 12); montarTabela(); }
        });
        seletorColunas.node.style.minWidth = '320px';
        seletorColunas.node.style.maxWidth = '520px';
        seletorColunas.node.querySelector('.ms__control').style.maxHeight = '82px';
        seletorColunas.node.querySelector('.ms__control').style.overflowY = 'auto';
        cartao.tools.appendChild(seletorColunas.node);
        var alvoTabela = U.el('div');
        cartao.corpo.appendChild(alvoTabela);

        function montarTabela() {
          TBL.render(alvoTabela, {
            columns: [{ key: '__nome', label: 'Instituição', sticky: true, largura: 240 }]
              .concat(ds.metaColumns.filter(function (m) { return ['UF', 'Cidade', 'SR', 'Segmento'].indexOf(m) >= 0; })
                .map(function (m) { return { key: m, label: m, largura: 80 }; }))
              .concat(colunasVisiveis.map(function (c) {
                return { key: c, label: c, tipo: 'num', decimais: VW.decimaisColuna(c),
                         fmt: function (v) { return VW.fmtColuna(c)(v); } };
              })),
            rows: linhas.map(function (r) {
              var o = { __nome: r.__nome };
              ds.metaColumns.forEach(function (m) { o[m] = r[m]; });
              colunasVisiveis.forEach(function (c) { o[c] = VW.valor(r, c); });
              return o;
            }),
            ordenar: colunasVisiveis.length ? { key: colunasVisiveis[0], dir: 'desc' } : null,
            maxLinhas: 120,
            nomeArquivo: 'ifdata-' + ds.anoMes + '-rel' + ds.relatorio
          });
        }
        montarTabela();
        node.appendChild(cartao.node);

        function criarConjuntoDoTop() {
          var nome = 'Top ' + local.topN + ' por ' + U.truncate(local.coluna, 24) + ' (' + U.periodLabel(ds.anoMes) + ')';
          var g = ST.criarGrupo(nome, top.map(function (r) { return { id: r.__id, nome: r.__nome }; }),
            'Criado a partir da tela de Consulta em ' + U.periodLong(ds.anoMes) + '.');
          UI.toast('Conjunto "' + g.nome + '" criado com ' + g.membros.length + ' instituições.', 'good');
        }
      }

      render();
      return { atualizar: render };
    }
  });

  /* =====================================================================
     Tela 2 — Comparação entre instituições
     ===================================================================== */

  VW.registrar({
    id: 'comparar',
    titulo: 'Comparar',
    descricao: 'Confronte até oito instituições em várias colunas e indicadores ao mesmo tempo.',
    montar: function (node) {
      var local = { ifs: [], colunas: [], normalizar: 'nivel' };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Consultando o IF.data…');
        VW.carregar()
          .then(function (ds) { if (atual()) pintar(ds); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(ds) {
        U.clear(node);
        var aviso = VW.avisoDemo(ds); if (aviso) node.appendChild(aviso);
        if (!ds.rows.length) {
          node.appendChild(UI.vazio('Sem dados neste período', 'Escolha outro trimestre na barra superior.'));
          return;
        }
        var numericas = VW.colunasNumericas(ds);
        var principal = VW.campoPrincipal(ds);
        var idx = VW.linhasPorId(ds);

        if (!local.ifs.length) {
          local.ifs = ds.rows.slice()
            .sort(function (a, b) { return (VW.valor(b, principal) || 0) - (VW.valor(a, principal) || 0); })
            .slice(0, 5).map(function (r) { return r.__id; });
        }
        local.ifs = local.ifs.filter(function (id) { return idx.has(id); });
        if (!local.colunas.length) local.colunas = numericas.slice(0, 4);
        local.colunas = local.colunas.filter(function (c) { return numericas.indexOf(c) >= 0; });

        /* --- controles ---------------------------------------------------- */
        var barra = U.el('div', { class: 'filterbar' });
        var msIFs = UI.multiselect({
          opcoes: VW.opcoesInstituicoes(ds, principal),
          selecionados: local.ifs, max: CH.Colors.MAX_SLOTS, corPorValor: true,
          placeholder: 'Buscar instituição…',
          onChange: function (v) { local.ifs = v; pintar(ds); }
        });
        barra.appendChild(UI.campo('Instituições (até ' + CH.Colors.MAX_SLOTS + ')', msIFs.node, 'grow'));

        var msCols = UI.multiselect({
          opcoes: numericas.map(function (c) { return { value: c, label: c }; }),
          selecionados: local.colunas, max: 8, placeholder: 'Buscar coluna…',
          onChange: function (v) { local.colunas = v; pintar(ds); }
        });
        barra.appendChild(UI.campo('Colunas comparadas (até 8)', msCols.node, 'grow'));

        barra.appendChild(UI.campo('Escala', UI.segmentado([
          { label: 'Nível', value: 'nivel', hint: 'Valores absolutos, um gráfico por coluna' },
          { label: 'Índice (maior = 100)', value: 'indice', hint: 'Tudo num só eixo, comparável entre colunas' }
        ], local.normalizar, function (v) { local.normalizar = v; pintar(ds); })));
        node.appendChild(barra);

        var selecionadas = local.ifs.map(function (id) { return idx.get(id); }).filter(Boolean);
        if (!selecionadas.length) {
          node.appendChild(UI.vazio('Escolha ao menos uma instituição', 'Use o campo de busca acima.'));
          return;
        }
        CH.Colors.rebase(selecionadas.map(function (r) { return r.__id; }));

        /* --- gráfico principal --------------------------------------------- */
        if (local.normalizar === 'indice') {
          var gr = UI.grafico({
            titulo: 'Comparação indexada — maior valor de cada coluna = 100',
            sub: U.periodLong(ds.anoMes) + ' · normalização por coluna permite ler grandezas diferentes num único eixo'
          });
          CH.colunas(gr.grafico, {
            groups: local.colunas.map(function (c) { return { key: c, label: c }; }),
            series: selecionadas.map(function (r) {
              return {
                key: r.__id, label: r.__nome, color: CH.Colors.of(r.__id),
                values: local.colunas.map(function (c) {
                  var vals = selecionadas.map(function (x) { return VW.valor(x, c); }).filter(U.isNum);
                  var max = vals.length ? Math.max.apply(null, vals.map(Math.abs)) : 0;
                  var v = VW.valor(r, c);
                  return max && U.isNum(v) ? (v / max) * 100 : null;
                })
              };
            }),
            modo: 'agrupado', altura: 360,
            fmtEixo: function (v) { return U.fmt(v, 0); },
            fmtValor: function (v) { return U.fmt(v, 1) + ' (base 100)'; },
            tituloEixo: 'Índice',
            aria: 'Comparação indexada entre instituições'
          });
          tabelaComparativa(gr.tabela, ds, selecionadas, local.colunas);
          node.appendChild(gr.node);
        } else {
          var grade = U.el('div', { class: 'grid grid--2' });
          local.colunas.forEach(function (c) {
            var g = UI.grafico({ titulo: c, sub: VW.unidadeColuna(c) + ' · ' + U.periodLabel(ds.anoMes) });
            var dados = selecionadas.map(function (r) {
              return { key: r.__id, label: r.__nome, value: VW.valor(r, c), color: CH.Colors.of(r.__id) };
            }).sort(function (a, b) { return (b.value || -Infinity) - (a.value || -Infinity); });
            CH.ranking(g.grafico, {
              data: dados, serieLabel: c, alturaLinha: 28,
              fmtValor: VW.fmtColuna(c), fmtEixo: VW.fmtColuna(c),
              aria: 'Comparação de ' + c
            });
            TBL.render(g.tabela, {
              columns: [{ key: 'nome', label: 'Instituição', sticky: true, largura: 200 },
                        { key: 'valor', label: c, tipo: 'num', decimais: VW.decimaisColuna(c) }],
              rows: dados.map(function (d) { return { nome: d.label, valor: d.value }; }),
              busca: false, nomeArquivo: 'comparar-' + U.slug(c)
            });
            grade.appendChild(g.node);
          });
          node.appendChild(grade);
        }

        /* --- heatmap de indicadores ---------------------------------------- */
        var disponiveis = CAT.indicadoresDisponiveis(ds.campos);
        if (disponiveis.length >= 2) {
          var ctxCalc = { anoMes: ds.anoMes, anualizar: ST.estado.anualizar };
          var matriz = selecionadas.map(function (r) { return CAT.calcIndicadores(r, ds.campos, ctxCalc); });
          var porIndicador = {};
          disponiveis.forEach(function (m) {
            porIndicador[m.id] = VW.zscores(matriz.map(function (linha) { return linha[m.id]; }));
          });
          var gh = UI.grafico({
            titulo: 'Posição relativa por indicador',
            sub: 'Escore-z dentro do grupo selecionado — azul abaixo da média do grupo, vermelho acima. ' +
                 'Use a aba Tabela para os valores absolutos.'
          });
          CH.heatmap(gh.grafico, {
            rows: selecionadas.map(function (r) { return { key: r.__id, label: r.__nome }; }),
            cols: disponiveis.map(function (m) { return { key: m.id, label: m.label }; }),
            values: selecionadas.map(function (_, i) {
              return disponiveis.map(function (m) { return porIndicador[m.id][i]; });
            }),
            escala: 'divergente', mostrarValor: true, alturaCelula: 30,
            fmtValor: function (v) { return U.isNum(v) ? U.signed(v, 1) + ' σ' : '–'; },
            aria: 'Matriz de posição relativa por indicador'
          });
          TBL.render(gh.tabela, {
            columns: [{ key: 'nome', label: 'Instituição', sticky: true, largura: 220 }]
              .concat(disponiveis.map(function (m) {
                return { key: m.id, label: m.label + ' (' + m.unidade + ')', tipo: 'num', decimais: m.decimais,
                         hint: m.desc };
              })),
            rows: selecionadas.map(function (r, i) {
              var o = { nome: r.__nome };
              disponiveis.forEach(function (m) { o[m.id] = matriz[i][m.id]; });
              return o;
            }),
            busca: false, nomeArquivo: 'comparar-indicadores-' + ds.anoMes
          });
          node.appendChild(gh.node);
        } else {
          var av = VW.avisoCampos(ds); if (av) node.appendChild(av);
        }

        /* --- tabela consolidada -------------------------------------------- */
        var cartao = UI.card({ titulo: 'Tabela comparativa', sub: 'Todas as colunas selecionadas', flush: true });
        var alvo = U.el('div'); cartao.corpo.appendChild(alvo);
        tabelaComparativa(alvo, ds, selecionadas, local.colunas);
        node.appendChild(cartao.node);
      }

      function tabelaComparativa(alvo, ds, linhas, colunas) {
        TBL.render(alvo, {
          columns: [{ key: 'nome', label: 'Instituição', sticky: true, largura: 240 }]
            .concat(colunas.map(function (c) {
              return { key: c, label: c, tipo: 'num', decimais: VW.decimaisColuna(c),
                       fmt: function (v) { return VW.fmtColuna(c)(v); } };
            })),
          rows: linhas.map(function (r) {
            var o = { nome: r.__nome };
            colunas.forEach(function (c) { o[c] = VW.valor(r, c); });
            return o;
          }),
          busca: false, nomeArquivo: 'ifdata-comparativo-' + ds.anoMes
        });
      }

      render();
      return { atualizar: render };
    }
  });

  /* =====================================================================
     Tela 3 — Série temporal
     ===================================================================== */

  VW.registrar({
    id: 'serie',
    titulo: 'Série temporal',
    descricao: 'Evolução trimestral de uma coluna ou indicador para as instituições escolhidas.',
    montar: function (node) {
      var local = {
        de: U.shiftPeriod(ST.estado.anoMes, -11),
        ate: ST.estado.anoMes,
        ifs: [], metrica: null, tipoMetrica: 'coluna', visao: 'nivel',
        serie: null, carregando: false
      };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Consultando o IF.data…');
        VW.carregar()
          .then(function (ds) { if (atual()) pintar(ds); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(ds) {
        U.clear(node);
        var aviso = VW.avisoDemo(ds); if (aviso) node.appendChild(aviso);
        if (!ds.rows.length) {
          node.appendChild(UI.vazio('Sem dados neste período', 'Escolha outro trimestre na barra superior.'));
          return;
        }
        var numericas = VW.colunasNumericas(ds);
        var principal = VW.campoPrincipal(ds);
        var indicadores = CAT.indicadoresDisponiveis(ds.campos);
        var idx = VW.linhasPorId(ds);

        if (!local.ifs.length) {
          local.ifs = ds.rows.slice()
            .sort(function (a, b) { return (VW.valor(b, principal) || 0) - (VW.valor(a, principal) || 0); })
            .slice(0, 4).map(function (r) { return r.__id; });
        }
        if (!local.metrica) local.metrica = principal;

        var periodos = U.periodRange(local.de, local.ate);
        var todosPeriodos = U.allPeriods(2000);

        /* --- controles ------------------------------------------------------ */
        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('De', UI.seletor(
          todosPeriodos.map(function (p) { return { value: p, label: U.periodLabel(p) }; }),
          local.de, function (v) { local.de = v; local.serie = null; pintar(ds); })));
        barra.appendChild(UI.campo('Até', UI.seletor(
          todosPeriodos.map(function (p) { return { value: p, label: U.periodLabel(p) }; }),
          local.ate, function (v) { local.ate = v; local.serie = null; pintar(ds); })));

        var opcoesMetrica = numericas.map(function (c) { return { value: 'col:' + c, label: c }; })
          .concat(indicadores.map(function (m) { return { value: 'ind:' + m.id, label: 'Indicador · ' + m.label }; }));
        var atual = (local.tipoMetrica === 'indicador' ? 'ind:' : 'col:') + local.metrica;
        barra.appendChild(UI.campo('Métrica', UI.seletor(opcoesMetrica, atual, function (v) {
          local.tipoMetrica = v.indexOf('ind:') === 0 ? 'indicador' : 'coluna';
          local.metrica = v.slice(4);
          pintar(ds);
        }, { style: 'min-width:280px' })));

        var msIFs = UI.multiselect({
          opcoes: VW.opcoesInstituicoes(ds, principal),
          selecionados: local.ifs, max: CH.Colors.MAX_SLOTS, corPorValor: true,
          placeholder: 'Buscar instituição…',
          onChange: function (v) { local.ifs = v; pintar(ds); }
        });
        barra.appendChild(UI.campo('Instituições (até ' + CH.Colors.MAX_SLOTS + ')', msIFs.node, 'grow'));

        barra.appendChild(U.el('div', { class: 'filterbar__actions' }, [
          U.el('button', {
            class: 'btn btn--primary', text: 'Carregar ' + periodos.length + ' trimestres',
            title: 'Cada trimestre é uma chamada à API; o resultado fica em cache local.',
            onclick: function () { carregarSerie(ds, periodos); }
          })
        ]));
        node.appendChild(barra);

        if (periodos.length > 24) {
          node.appendChild(UI.nota('Você selecionou ' + periodos.length + ' trimestres. ' +
            'Cada um é uma requisição separada ao BCB — a primeira carga pode levar alguns minutos.', 'warn'));
        }

        if (local.carregando) { node.appendChild(UI.carregando(local.progresso || 'Carregando série…')); return; }
        if (!local.serie) {
          node.appendChild(UI.vazio('Série ainda não carregada',
            'Ajuste o intervalo e as instituições e clique em "Carregar ' + periodos.length + ' trimestres".'));
          return;
        }

        desenharSerie(ds);
      }

      function carregarSerie(ds, periodos) {
        local.carregando = true;
        local.progresso = 'Carregando trimestre 1 de ' + periodos.length + '…';
        pintar(ds);
        VW.carregarSerie(periodos, function (i, n, p) {
          local.progresso = 'Carregando ' + U.periodLabel(p) + ' (' + i + ' de ' + n + ')…';
          var carregandoEl = node.querySelector('.loading span');
          if (carregandoEl) carregandoEl.textContent = local.progresso;
        }).then(function (lista) {
          local.serie = lista;
          local.carregando = false;
          var comDados = lista.filter(function (p) { return p.rows.length; }).length;
          UI.toast(comDados + ' de ' + lista.length + ' trimestres retornaram dados.',
                   comDados ? 'good' : 'warn');
          pintar(ds);
        }).catch(function (e) {
          local.carregando = false;
          VW.blocoErro(node, e);
        });
      }

      function desenharSerie(ds) {
        var lista = local.serie.filter(function (p) { return p.rows.length; });
        if (!lista.length) {
          node.appendChild(UI.vazio('Nenhum trimestre retornou dados',
            'Verifique o intervalo escolhido — a cobertura do IF.data varia por relatório.'));
          return;
        }
        var idxAtual = VW.linhasPorId(ds);
        var nomes = {};
        local.ifs.forEach(function (id) {
          var r = idxAtual.get(id);
          nomes[id] = r ? r.__nome : id;
        });
        CH.Colors.rebase(local.ifs);

        var indicador = local.tipoMetrica === 'indicador' ? CAT.INDICADOR_POR_ID[local.metrica] : null;
        var rotulo = indicador ? indicador.label : local.metrica;
        var unidade = indicador ? indicador.unidade : VW.unidadeColuna(local.metrica);
        var fmt = indicador
          ? function (v) { return U.isNum(v) ? U.fmt(v, indicador.decimais) + ' ' + indicador.unidade : '–'; }
          : VW.fmtColuna(local.metrica);

        function valorEm(periodo, id) {
          var linha = null;
          for (var i = 0; i < periodo.rows.length; i++) {
            if (periodo.rows[i].__id === id) { linha = periodo.rows[i]; break; }
          }
          if (!linha) {
            var alvo = U.norm(nomes[id]);
            linha = periodo.rows.find(function (r) { return U.norm(r.__nome) === alvo; }) || null;
          }
          if (!linha) return null;
          if (indicador) {
            var vals = CAT.calcIndicadores(linha, periodo.campos,
              { anoMes: periodo.anoMes, anualizar: ST.estado.anualizar });
            return vals[indicador.id];
          }
          return VW.valor(linha, local.metrica);
        }

        var eixoX = lista.map(function (p) { return U.periodLabel(p.anoMes); });
        var series = local.ifs.map(function (id) {
          return {
            key: id, label: nomes[id], color: CH.Colors.of(id),
            values: lista.map(function (p) { return valorEm(p, id); })
          };
        });

        /* --- estatísticas da série ------------------------------------------ */
        var stats = series.map(function (s) {
          var v = s.values.filter(U.isNum);
          var primeiro = null, ultimo = null, iPrim = -1, iUlt = -1;
          s.values.forEach(function (x, i) {
            if (U.isNum(x)) { if (iPrim < 0) { iPrim = i; primeiro = x; } iUlt = i; ultimo = x; }
          });
          return {
            key: s.key, nome: s.label,
            primeiro: primeiro, ultimo: ultimo,
            variacao: U.growth(primeiro, ultimo),
            cagr: indicador ? null : U.cagr(primeiro, ultimo, 4, Math.max(1, iUlt - iPrim)),
            volatilidade: U.stdev(v),
            minimo: v.length ? Math.min.apply(null, v) : null,
            maximo: v.length ? Math.max.apply(null, v) : null,
            serie: s.values
          };
        });

        node.appendChild(VW.faixaStats(stats.slice(0, 4).map(function (s) {
          return {
            label: U.truncate(s.nome, 24),
            valor: fmt(s.ultimo),
            delta: s.variacao, deltaUnidade: '%', deltaDecimais: 1,
            deltaRef: U.periodLabel(lista[0].anoMes),
            nota: (indicador ? 'σ ' + U.fmt(s.volatilidade, 2) : 'CAGR ' + U.pct(s.cagr, 1) + ' a.a.'),
            serie: s.serie.filter(U.isNum)
          };
        })));

        /* --- gráfico de nível ------------------------------------------------ */
        var g1 = UI.grafico({
          titulo: rotulo + ' — evolução trimestral',
          sub: U.periodLabel(lista[0].anoMes) + ' a ' + U.periodLabel(lista[lista.length - 1].anoMes) +
               ' · ' + unidade
        });
        CH.linhas(g1.grafico, {
          x: eixoX, series: series, altura: 360,
          fmtEixo: indicador ? function (v) { return U.fmt(v, indicador.decimais === 0 ? 0 : 1); } : fmt,
          fmtValor: fmt, tituloEixo: unidade,
          referencia: indicador && indicador.id === 'basileia' ? 8 : null,
          referenciaLabel: 'Mínimo regulatório 8%',
          zeroObrigatorio: !indicador,
          aria: 'Evolução de ' + rotulo
        });
        tabelaSerie(g1.tabela, eixoX, series, fmt);
        node.appendChild(g1.node);

        /* --- indexado + variação --------------------------------------------- */
        var grade = U.el('div', { class: 'grid grid--2' });

        if (!indicador) {
          var g2 = UI.grafico({
            titulo: 'Evolução indexada (primeiro trimestre = 100)',
            sub: 'Neutraliza a diferença de tamanho e mostra só o ritmo de crescimento'
          });
          var seriesIdx = series.map(function (s) {
            var base = s.values.find(U.isNum);
            return {
              key: s.key, label: s.label, color: s.color,
              values: s.values.map(function (v) { return U.isNum(v) && base ? (v / base) * 100 : null; })
            };
          });
          CH.linhas(g2.grafico, {
            x: eixoX, series: seriesIdx, altura: 320,
            fmtEixo: function (v) { return U.fmt(v, 0); },
            fmtValor: function (v) { return U.fmt(v, 1); },
            tituloEixo: 'Base 100', referencia: 100, referenciaLabel: 'Base',
            aria: 'Evolução indexada'
          });
          tabelaSerie(g2.tabela, eixoX, seriesIdx, function (v) { return U.fmt(v, 1); });
          grade.appendChild(g2.node);
        }

        var g3 = UI.grafico({
          titulo: indicador ? 'Variação em pontos percentuais (a.a.)' : 'Variação em 12 meses (%)',
          sub: 'Compara cada trimestre com o mesmo trimestre do ano anterior'
        });
        var seriesYoY = series.map(function (s) {
          return {
            key: s.key, label: s.label, color: s.color,
            values: s.values.map(function (v, i) {
              var ant = s.values[i - 4];
              if (!U.isNum(v) || !U.isNum(ant)) return null;
              return indicador ? v - ant : U.growth(ant, v);
            })
          };
        });
        CH.linhas(g3.grafico, {
          x: eixoX, series: seriesYoY, altura: 320,
          fmtEixo: function (v) { return U.fmt(v, 0); },
          fmtValor: function (v) { return U.signed(v, 1) + (indicador ? ' p.p.' : '%'); },
          tituloEixo: indicador ? 'p.p.' : '%', referencia: 0, referenciaLabel: 'Estável',
          aria: 'Variação em doze meses'
        });
        tabelaSerie(g3.tabela, eixoX, seriesYoY, function (v) { return U.signed(v, 1); });
        grade.appendChild(g3.node);
        node.appendChild(grade);

        /* --- tabela de estatísticas ------------------------------------------- */
        var cartao = UI.card({ titulo: 'Estatísticas da série', flush: true });
        var alvo = U.el('div'); cartao.corpo.appendChild(alvo);
        TBL.render(alvo, {
          columns: [
            { key: 'nome', label: 'Instituição', sticky: true, largura: 220 },
            { key: 'primeiro', label: 'Início', tipo: 'num', fmt: fmt },
            { key: 'ultimo', label: 'Fim', tipo: 'num', fmt: fmt },
            { key: 'variacao', label: 'Variação %', tipo: 'num', decimais: 1 },
            { key: 'cagr', label: 'CAGR % a.a.', tipo: 'num', decimais: 1 },
            { key: 'minimo', label: 'Mínimo', tipo: 'num', fmt: fmt },
            { key: 'maximo', label: 'Máximo', tipo: 'num', fmt: fmt },
            { key: 'volatilidade', label: 'Desvio-padrão', tipo: 'num', fmt: fmt }
          ],
          rows: stats, busca: false,
          nomeArquivo: 'serie-' + U.slug(rotulo),
          rodape: 'Desvio-padrão calculado sobre os trimestres carregados.'
        });
        node.appendChild(cartao.node);
      }

      function tabelaSerie(alvo, eixoX, series, fmt) {
        TBL.render(alvo, {
          columns: [{ key: 'periodo', label: 'Trimestre', sticky: true, largura: 110 }]
            .concat(series.map(function (s) {
              return { key: s.key, label: s.label, tipo: 'num', fmt: fmt };
            })),
          rows: eixoX.map(function (p, i) {
            var o = { periodo: p };
            series.forEach(function (s) { o[s.key] = s.values[i]; });
            return o;
          }),
          busca: false, maxLinhas: 60, nomeArquivo: 'serie-temporal'
        });
      }

      render();
      return { atualizar: function () { local.serie = null; render(); } };
    }
  });
})(window);
