/* views-publicacoes.js — módulo Publicações do Risk Bench.
   Conciliação entre BR GAAP, IFRS, Pilar 3, 20-F e a linha de base do IF.data. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, CH = global.CH, API = global.API,
      TBL = global.TBL, CAT = global.CAT, VW = global.VW, PUB = global.PUB, PST = global.PST;

  /* ======================== apoio comum ao módulo ======================== */

  function corDaFonte(id) {
    var f = PUB.FONTE_POR_ID[id];
    return f ? 'var(--series-' + f.serie + ')' : 'var(--text-muted)';
  }

  function periodos() { return PUB.periodosDoEscopo(ST.estado.anoMes); }

  /** Bancos do escopo: S1/S2 do IF.data, mais qualquer um que já tenha lançamento. */
  function bancosDoEscopo() {
    return VW.carregar({ naoGuardar: true }).then(function (ds) {
      var lista = ds.rows.map(function (r) {
        return { cnpj: PST.normalizarCnpj(r.__id), nome: r.__nome,
                 segmento: r.__segmento || null, doIFData: true, row: r };
      });
      return juntarComLancados(lista);
    }).catch(function () { return juntarComLancados([]); });
  }

  function juntarComLancados(lista) {
    var vistos = {};
    lista.forEach(function (b) { vistos[b.cnpj] = true; });
    PST.bancosComDados().forEach(function (b) {
      if (!vistos[b.cnpj]) lista.push({ cnpj: b.cnpj, nome: b.nome, segmento: null, doIFData: false });
    });
    return lista.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
  }

  function avisoFontes() {
    return UI.nota([
      U.el('div', {}, [
        U.el('strong', { text: 'De onde vêm os números. ' }),
        U.el('span', { text: 'O IF.data é preenchido automaticamente. BR GAAP, IFRS, Pilar 3 e 20-F ' +
          'são PDFs e planilhas publicados pelos bancos, pela CVM e pela SEC — não há API que os ' +
          'sirva, então entram por importação de planilha ou lançamento manual. O formato de ' +
          'importação é o contrato: um extrator automático, no futuro, só precisa gerar esse CSV.' })
      ])
    ]);
  }

  function seletorBanco(bancos, atual, onChange) {
    return UI.seletor(bancos.map(function (b) {
      return { value: b.cnpj, label: b.nome + (b.segmento ? '  (' + b.segmento + ')' : '') };
    }), atual, onChange, { style: 'min-width:260px;max-width:420px' });
  }

  function seletorMetrica(atual, onChange) {
    var opcoes = [];
    PUB.FAMILIAS.forEach(function (f) {
      PUB.metricasDaFamilia(f.id).forEach(function (m) {
        opcoes.push({ value: m.id, label: f.nome + ' · ' + m.nome });
      });
    });
    return UI.seletor(opcoes, atual, onChange, { style: 'min-width:280px;max-width:440px' });
  }

  function fmtMetrica(m) {
    return function (v) {
      if (!U.isNum(v)) return '–';
      if (m.unidade === 'R$ mil') return U.compact(v, 1);
      return U.fmt(v, m.decimais) + (m.unidade === 'nº' ? '' : ' ' + m.unidade);
    };
  }

  /* ===================================================================
     Tela 1 — Cobertura
     =================================================================== */

  VW.registrar({
    id: 'pub-cobertura', modulo: 'publicacoes', titulo: 'Cobertura',
    descricao: 'O que já foi levantado de cada fonte, por banco.',
    montar: function (node) {
      var local = { familia: '', carregando: false };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Montando o escopo S1/S2…');
        bancosDoEscopo().then(function (bancos) { if (atual()) pintar(bancos); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(bancos) {
        U.clear(node);
        node.appendChild(avisoFontes());

        var ps = periodos();
        var metricas = (local.familia ? PUB.metricasDaFamilia(local.familia) : PUB.METRICAS)
          .map(function (m) { return m.id; });

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Família de indicadores', UI.seletor(
          [{ value: '', label: 'Todas as famílias' }].concat(PUB.FAMILIAS.map(function (f) {
            return { value: f.id, label: f.nome };
          })), local.familia, function (v) { local.familia = v; pintar(bancos); })));
        barra.appendChild(UI.campo('Janela', U.el('div', { class: 'small muted',
          text: U.periodLabel(ps[ps.length - 1]) + ' a ' + U.periodLabel(ps[0]) + ' · 16 trimestres' })));
        barra.appendChild(U.el('div', { class: 'filterbar__actions' }, [
          U.el('button', { class: 'btn btn--primary', text: 'Espelhar IF.data no trimestre atual',
            title: 'Preenche a coluna IF.data com os indicadores equivalentes já calculados',
            onclick: function () { espelhar(bancos); } })
        ]));
        node.appendChild(barra);

        var todos = PST.todos();
        var noEscopo = todos.filter(function (l) { return metricas.indexOf(l.metrica) >= 0; });
        var manuais = noEscopo.filter(function (l) { return l.fonte !== 'ifdata'; });
        var cob = PST.cobertura(bancos, ps, metricas);
        var alvoTotal = 0, feitoTotal = 0;
        cob.forEach(function (linha) {
          linha.celulas.forEach(function (c) {
            if (c.fonte === 'ifdata') return;
            alvoTotal += c.alvo; feitoTotal += c.preenchidas;
          });
        });

        node.appendChild(VW.faixaStats([
          { label: 'Bancos no escopo', valor: U.fmt(bancos.length, 0),
            nota: 'S1 e S2 do IF.data, mais os já lançados' },
          { label: 'Lançamentos das publicações', valor: U.fmt(manuais.length, 0),
            nota: 'fora o espelho automático do IF.data' },
          { label: 'Cobertura das quatro fontes', valor: U.pct(alvoTotal ? (feitoTotal / alvoTotal) * 100 : 0, 1),
            nota: U.fmt(feitoTotal, 0) + ' de ' + U.fmt(alvoTotal, 0) + ' células esperadas' },
          { label: 'Espelho do IF.data', valor: U.fmt(noEscopo.length - manuais.length, 0),
            nota: 'preenchido automaticamente' }
        ]));

        var cartao = UI.card({ titulo: 'Matriz de cobertura',
          sub: 'Quantas das células esperadas (métrica × trimestre) já têm número, por fonte.' });
        var matriz = U.el('div', { class: 'matriz' });
        var tab = U.el('table');
        var thead = U.el('thead');
        var trh = U.el('tr', {}, [U.el('th', { class: 'banco', text: 'Instituição', scope: 'col' })]);
        PUB.FONTES.forEach(function (f) {
          trh.appendChild(U.el('th', { text: f.curto, title: f.nome, scope: 'col' }));
        });
        thead.appendChild(trh);
        var tbody = U.el('tbody');
        cob.forEach(function (linha) {
          var tr = U.el('tr', {}, [U.el('td', { class: 'banco' }, [
            U.el('span', { text: U.truncate(linha.banco.nome, 34), title: linha.banco.nome }),
            linha.banco.segmento
              ? U.el('span', { class: 'familia-chip', style: 'margin-left:6px', text: linha.banco.segmento })
              : null
          ])]);
          linha.celulas.forEach(function (c) {
            var classe = !c.alvo ? 'cob--vazia'
              : c.preenchidas === 0 ? 'cob--vazia'
              : c.preenchidas >= c.alvo ? 'cob--cheia' : 'cob--parcial';
            tr.appendChild(U.el('td', { class: 'celula' }, [
              U.el('span', { class: 'cob ' + classe,
                title: c.preenchidas + ' de ' + c.alvo + ' células',
                text: c.alvo ? c.preenchidas + '/' + c.alvo : '—' })
            ]));
          });
          tbody.appendChild(tr);
        });
        tab.appendChild(thead); tab.appendChild(tbody);
        matriz.appendChild(tab);
        cartao.corpo.appendChild(matriz);
        node.appendChild(cartao.node);

        var legenda = UI.card({ titulo: 'O que cada fonte costuma trazer' });
        var lista = U.el('div', { class: 'stack' });
        PUB.FONTES.forEach(function (f) {
          lista.appendChild(U.el('div', { class: 'div-item' }, [
            U.el('div', {}, [
              U.el('div', { class: 'div-item__metrica' }, [
                U.el('span', { class: 'legend__swatch', style: 'background:' + corDaFonte(f.id) +
                  ';display:inline-block;margin-right:7px' }),
                U.el('span', { text: f.nome })
              ]),
              U.el('div', { class: 'div-item__contexto', text: f.desc })
            ]),
            U.el('div', { class: 'div-item__valor' }, [
              U.el('div', { text: PUB.metricasDaFonte(f.id).length + ' métricas' }),
              U.el('div', { class: 'small muted', text: f.automatica ? 'automática' : 'importação' })
            ])
          ]));
        });
        legenda.corpo.appendChild(lista);
        node.appendChild(legenda.node);
      }

      function espelhar(bancos) {
        VW.carregar().then(function (ds) {
          var ctxCalc = { anoMes: ds.anoMes, anualizar: ST.estado.anualizar };
          var porId = VW.linhasPorId(ds);
          var n = PST.sincronizarIFData(bancos, ds.anoMes, function (banco, indicadorId) {
            var linha = porId.get(banco.cnpj) || (banco.row || null);
            if (!linha) return null;
            var ind = CAT.calcIndicadores(linha, ds.campos, ctxCalc);
            if (U.isNum(ind[indicadorId])) return ind[indicadorId];
            var campo = ds.campos[indicadorId];
            return campo ? VW.valor(linha, campo) : null;
          });
          UI.toast(n + ' valores espelhados do IF.data em ' + U.periodLabel(ds.anoMes) + '.',
                   n ? 'good' : 'warn');
          render();
        }).catch(function (e) {
          UI.toast('Não foi possível ler o IF.data: ' + e.message, 'bad');
        });
      }

      render();
      return { atualizar: render };
    }
  });

  /* ===================================================================
     Tela 2 — Comparativo entre fontes
     =================================================================== */

  VW.registrar({
    id: 'pub-comparativo', modulo: 'publicacoes', titulo: 'Comparativo',
    descricao: 'Uma métrica, um banco, as cinco fontes lado a lado ao longo de 16 trimestres.',
    montar: function (node) {
      var local = { cnpj: null, metrica: 'basileia' };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Montando o escopo S1/S2…');
        bancosDoEscopo().then(function (bancos) { if (atual()) pintar(bancos); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(bancos) {
        U.clear(node);
        if (!bancos.length) {
          node.appendChild(UI.vazio('Nenhum banco no escopo',
            'Carregue um período no módulo IF.data ou lance dados na tela Lançamentos.'));
          return;
        }
        if (!local.cnpj || !bancos.some(function (b) { return b.cnpj === local.cnpj; })) {
          local.cnpj = bancos[0].cnpj;
        }
        var banco = bancos.find(function (b) { return b.cnpj === local.cnpj; });
        var m = PUB.METRICA_POR_ID[local.metrica];
        var ps = periodos().slice().reverse();          // cronológico
        var fmt = fmtMetrica(m);

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Instituição',
          seletorBanco(bancos, local.cnpj, function (v) { local.cnpj = v; pintar(bancos); }), 'grow'));
        barra.appendChild(UI.campo('Métrica',
          seletorMetrica(local.metrica, function (v) { local.metrica = v; pintar(bancos); }), 'grow'));
        node.appendChild(barra);

        node.appendChild(UI.nota(m.definicao + '  Fontes que costumam publicar: ' +
          m.fontes.map(function (f) { return PUB.FONTE_POR_ID[f].curto; }).join(', ') + '.'));

        var series = PUB.FONTES.map(function (f) {
          return {
            key: f.id, label: f.curto, color: corDaFonte(f.id),
            values: ps.map(function (p) { return PST.valor(banco.cnpj, f.id, p, m.id); })
          };
        }).filter(function (s) { return s.values.some(U.isNum); });

        if (!series.length) {
          node.appendChild(UI.vazio('Sem números para esta combinação',
            'Lance ou importe os valores de ' + m.nome + ' para ' + banco.nome + '.'));
          node.appendChild(U.el('div', { class: 'row', style: 'justify-content:center' }, [
            U.el('button', { class: 'btn btn--primary', text: 'Ir para Lançamentos',
              onclick: function () { global.APP.irPara('pub-dados'); } })
          ]));
          return;
        }

        /* --- painel do trimestre mais recente com dado --- */
        var ultimo = null;
        for (var i = ps.length - 1; i >= 0 && !ultimo; i--) {
          if (series.some(function (s) { return U.isNum(s.values[i]); })) ultimo = i;
        }
        var comp = PST.compararCelula(banco.cnpj, ps[ultimo], m.id);
        node.appendChild(VW.faixaStats([
          { label: 'Fontes com número', valor: U.fmt(series.length, 0),
            nota: U.periodLabel(ps[ultimo]) },
          comp && comp.comparavel
            ? { label: 'Maior divergência', valor: U.fmt(comp.medida, 2) + ' ' + comp.unidadeGap,
                nota: PUB.FONTE_POR_ID[comp.maiorEm].curto + ' acima de ' +
                      PUB.FONTE_POR_ID[comp.menorEm].curto, melhor: 'baixo' }
            : { label: 'Divergência', valor: '–', nota: 'é preciso ao menos duas fontes' },
          { label: 'Trimestres cobertos',
            valor: U.fmt(ps.filter(function (p) {
              return PUB.FONTES.some(function (f) { return U.isNum(PST.valor(banco.cnpj, f.id, p, m.id)); });
            }).length, 0), nota: 'de 16 na janela' },
          m.referencia
            ? { label: 'Referência regulatória', valor: U.fmt(m.referencia, 2) + ' ' + m.unidade,
                nota: 'mínimo aplicável' }
            : null
        ]));

        /* --- série por fonte --- */
        var g = UI.grafico({ titulo: m.nome + ' — ' + banco.nome,
          sub: 'Uma linha por fonte. Onde elas se separam, as publicações estão contando histórias diferentes.' });
        CH.linhas(g.grafico, {
          x: ps.map(U.periodLabel), series: series, altura: 360,
          fmtEixo: function (v) { return m.unidade === 'R$ mil' ? U.compact(v, 0) : U.fmt(v, 1); },
          fmtValor: fmt, tituloEixo: m.unidade,
          referencia: U.isNum(m.referencia) ? m.referencia : null,
          referenciaLabel: 'Mínimo ' + m.referencia + m.unidade,
          aria: 'Comparação de fontes para ' + m.nome
        });
        TBL.render(g.tabela, {
          columns: [{ key: 'periodo', label: 'Trimestre', sticky: true, largura: 110 }]
            .concat(series.map(function (s) {
              return { key: s.key, label: s.label, tipo: 'num', fmt: fmt };
            }))
            .concat([{ key: 'gap', label: 'Divergência', tipo: 'num', decimais: 2 }]),
          rows: ps.map(function (p, i) {
            var o = { periodo: U.periodLabel(p) };
            series.forEach(function (s) { o[s.key] = s.values[i]; });
            var c = PST.compararCelula(banco.cnpj, p, m.id);
            o.gap = c && c.comparavel ? c.medida : null;
            return o;
          }),
          busca: false, maxLinhas: 20,
          nomeArquivo: 'comparativo-' + m.id + '-' + banco.cnpj,
          rodape: 'Divergência em ' + (comp ? comp.unidadeGap : 'p.p./%') + ' entre a maior e a menor fonte.'
        });
        node.appendChild(g.node);

        /* --- detalhe do trimestre: de onde saiu cada número --- */
        var cDet = UI.card({ titulo: 'Rastro do último trimestre com dado',
          sub: U.periodLong(ps[ultimo]) + ' — onde cada número foi lido', flush: true });
        var alvoDet = U.el('div'); cDet.corpo.appendChild(alvoDet);
        TBL.render(alvoDet, {
          columns: [
            { key: 'fonte', label: 'Fonte', sticky: true, largura: 150 },
            { key: 'valor', label: m.nome, tipo: 'num', fmt: fmt },
            { key: 'referencia', label: 'Onde foi lido', largura: 280 },
            { key: 'url', label: 'Documento', largura: 220 }
          ],
          rows: PUB.FONTES.map(function (f) {
            var l = PST.lancamento(banco.cnpj, f.id, ps[ultimo], m.id);
            return l ? { fonte: f.nome, valor: l.valor, referencia: l.referencia || '–', url: l.url || '–' } : null;
          }).filter(Boolean),
          busca: false, nomeArquivo: 'rastro-' + m.id
        });
        node.appendChild(cDet.node);
      }

      render();
      return { atualizar: render };
    }
  });

  /* ===================================================================
     Tela 3 — Divergências
     =================================================================== */

  VW.registrar({
    id: 'pub-divergencias', modulo: 'publicacoes', titulo: 'Divergências',
    descricao: 'Onde as fontes não batem — ordenado pelo tamanho da diferença.',
    montar: function (node) {
      var local = { familia: '', severidade: 'media' };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Conciliando fontes…');
        bancosDoEscopo().then(function (bancos) { if (atual()) pintar(bancos); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(bancos) {
        U.clear(node);
        var ps = periodos();
        var metricas = (local.familia ? PUB.metricasDaFamilia(local.familia) : PUB.METRICAS)
          .map(function (m) { return m.id; });

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Família', UI.seletor(
          [{ value: '', label: 'Todas' }].concat(PUB.FAMILIAS.map(function (f) {
            return { value: f.id, label: f.nome };
          })), local.familia, function (v) { local.familia = v; pintar(bancos); })));
        barra.appendChild(UI.campo('Severidade mínima', UI.segmentado([
          { label: 'Todas', value: 'baixa' },
          { label: 'Média', value: 'media' },
          { label: 'Só alta', value: 'alta' }
        ], local.severidade, function (v) { local.severidade = v; pintar(bancos); })));
        node.appendChild(barra);

        var divs = PST.divergencias(bancos, ps, metricas, local.severidade);
        var todas = PST.divergencias(bancos, ps, metricas, 'baixa');
        var altas = todas.filter(function (d) { return d.comparacao.severidade === 'alta'; });

        node.appendChild(VW.faixaStats([
          { label: 'Células comparáveis', valor: U.fmt(todas.length, 0),
            nota: 'com duas ou mais fontes' },
          { label: 'Divergências altas', valor: U.fmt(altas.length, 0), melhor: 'baixo',
            nota: 'acima de 1 p.p. em índices ou 5% em saldos' },
          { label: 'Bancos afetados',
            valor: U.fmt(U.unique(altas.map(function (d) { return d.cnpj; })).length, 0),
            nota: 'com ao menos uma divergência alta' },
          { label: 'Métricas afetadas',
            valor: U.fmt(U.unique(altas.map(function (d) { return d.metrica; })).length, 0),
            nota: 'de ' + metricas.length + ' no recorte' }
        ]));

        if (!todas.length) {
          node.appendChild(UI.vazio('Nada a conciliar ainda',
            'A conciliação precisa da mesma métrica publicada por pelo menos duas fontes, ' +
            'no mesmo banco e trimestre. Importe as publicações na tela Lançamentos.'));
          return;
        }

        /* --- mapa de calor: banco × métrica, pela maior divergência --- */
        var comAlta = U.unique(todas.map(function (d) { return d.cnpj; }));
        var bancosMapa = bancos.filter(function (b) { return comAlta.indexOf(b.cnpj) >= 0; }).slice(0, 20);
        var metricasMapa = U.unique(todas.map(function (d) { return d.metrica; })).slice(0, 14);
        if (bancosMapa.length && metricasMapa.length) {
          var gh = UI.grafico({ titulo: 'Onde estão as diferenças',
            sub: 'Maior divergência observada na janela, por banco e métrica. Quanto mais escuro, maior.' });
          CH.heatmap(gh.grafico, {
            rows: bancosMapa.map(function (b) { return { key: b.cnpj, label: b.nome }; }),
            cols: metricasMapa.map(function (mid) {
              return { key: mid, label: PUB.METRICA_POR_ID[mid].nome };
            }),
            values: bancosMapa.map(function (b) {
              return metricasMapa.map(function (mid) {
                var max = null;
                ps.forEach(function (p) {
                  var c = PST.compararCelula(b.cnpj, p, mid);
                  if (c && c.comparavel && (max === null || c.medida > max)) max = c.medida;
                });
                return max;
              });
            }),
            mostrarValor: true, alturaCelula: 28,
            fmtValor: function (v) { return U.isNum(v) ? U.fmt(v, 2) : '–'; },
            aria: 'Mapa de divergências por banco e métrica'
          });
          TBL.render(gh.tabela, {
            columns: [{ key: 'banco', label: 'Instituição', sticky: true, largura: 220 }]
              .concat(metricasMapa.map(function (mid) {
                return { key: mid, label: PUB.METRICA_POR_ID[mid].nome, tipo: 'num', decimais: 2 };
              })),
            rows: bancosMapa.map(function (b) {
              var o = { banco: b.nome };
              metricasMapa.forEach(function (mid) {
                var max = null;
                ps.forEach(function (p) {
                  var c = PST.compararCelula(b.cnpj, p, mid);
                  if (c && c.comparavel && (max === null || c.medida > max)) max = c.medida;
                });
                o[mid] = max;
              });
              return o;
            }),
            busca: false, nomeArquivo: 'mapa-divergencias'
          });
          node.appendChild(gh.node);
        }

        /* --- lista detalhada --- */
        var cartao = UI.card({ titulo: 'Apontamentos',
          sub: divs.length + ' células com divergência ' +
               (local.severidade === 'alta' ? 'alta' : local.severidade === 'media' ? 'média ou alta' : 'de qualquer tamanho') });
        var lista = U.el('div', { class: 'div-lista' });
        divs.slice(0, 120).forEach(function (d) {
          var c = d.comparacao;
          var m = PUB.METRICA_POR_ID[d.metrica];
          var fmt = fmtMetrica(m);
          lista.appendChild(U.el('div', { class: 'div-item div-item--' + c.severidade }, [
            U.el('div', {}, [
              U.el('div', { class: 'div-item__metrica', text: m.nome }),
              U.el('div', { class: 'small muted', text: d.banco + ' · ' + U.periodLabel(d.periodo) })
            ]),
            U.el('div', { class: 'div-item__valor' }, [
              U.el('div', { class: 'div-item__gap',
                text: U.fmt(c.medida, 2) + ' ' + c.unidadeGap }),
              U.el('div', { class: 'small muted', text: c.severidade === 'alta' ? 'alta' :
                c.severidade === 'media' ? 'média' : 'baixa' })
            ]),
            U.el('div', { class: 'div-item__contexto' },
              c.fontes.map(function (a) {
                return U.el('span', { style: 'margin-right:14px' }, [
                  U.el('span', { class: 'legend__swatch',
                    style: 'background:' + corDaFonte(a.fonte) + ';display:inline-block;margin-right:5px' }),
                  U.el('span', { text: PUB.FONTE_POR_ID[a.fonte].curto + ': ' + fmt(a.valor) })
                ]);
              }))
          ]));
        });
        cartao.corpo.appendChild(lista);
        if (divs.length > 120) {
          cartao.corpo.appendChild(U.el('div', { class: 'small muted', style: 'padding-top:10px',
            text: 'Exibindo as 120 maiores de ' + divs.length + '. Use a exportação para a lista completa.' }));
        }
        cartao.tools.appendChild(U.el('button', {
          class: 'btn btn--sm', text: 'Exportar CSV',
          onclick: function () {
            U.downloadCSV('divergencias.csv', divs.map(function (d) {
              var c = d.comparacao;
              var o = { banco: d.banco, cnpj: d.cnpj, periodo: d.periodo,
                        metrica: PUB.METRICA_POR_ID[d.metrica].nome, familia: d.familia,
                        divergencia: c.medida, unidade: c.unidadeGap, severidade: c.severidade };
              PUB.FONTES.forEach(function (f) {
                var a = c.fontes.find(function (x) { return x.fonte === f.id; });
                o[f.id] = a ? a.valor : null;
              });
              return o;
            }), [{ key: 'banco', label: 'banco' }, { key: 'cnpj', label: 'cnpj' },
                 { key: 'periodo', label: 'periodo' }, { key: 'metrica', label: 'metrica' },
                 { key: 'familia', label: 'familia' }, { key: 'divergencia', label: 'divergencia' },
                 { key: 'unidade', label: 'unidade' }, { key: 'severidade', label: 'severidade' }]
              .concat(PUB.FONTES.map(function (f) { return { key: f.id, label: f.id }; })));
          }
        }));
        node.appendChild(cartao.node);
      }

      render();
      return { atualizar: render };
    }
  });

  /* ===================================================================
     Tela 4 — Lançamentos
     =================================================================== */

  VW.registrar({
    id: 'pub-dados', modulo: 'publicacoes', titulo: 'Lançamentos',
    descricao: 'Importar planilha, lançar à mão e conferir o que está guardado.',
    montar: function (node) {
      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Carregando…');
        bancosDoEscopo().then(function (bancos) { if (atual()) pintar(bancos); })
          .catch(function () { if (atual()) pintar([]); });
      }

      function pintar(bancos) {
        U.clear(node);
        node.appendChild(avisoFontes());

        /* --- importação --- */
        var cImp = UI.card({ titulo: 'Importar planilha',
          sub: 'CSV com as colunas do modelo. Relançar o mesmo banco, fonte, trimestre e métrica sobrescreve o valor anterior.' });
        var arquivo = U.el('input', { type: 'file', accept: '.csv,text/csv' });
        var saida = U.el('div');
        arquivo.addEventListener('change', function () {
          var f = arquivo.files && arquivo.files[0];
          if (!f) return;
          var fr = new FileReader();
          fr.onload = function () {
            var r = PST.importarCSV(String(fr.result));
            U.clear(saida);
            saida.appendChild(UI.nota(
              r.inseridos + ' lançamentos novos, ' + r.substituidos + ' atualizados' +
              (r.erros.length ? ', ' + r.erros.length + ' linhas recusadas.' : '.'),
              r.erros.length ? 'warn' : 'good'));
            if (r.erros.length) saida.appendChild(U.el('div', { class: 'pre', text: r.erros.join('\n') }));
            arquivo.value = '';
            setTimeout(render, 400);
          };
          fr.readAsText(f, 'utf-8');
        });
        cImp.corpo.appendChild(U.el('div', { class: 'stack' }, [
          arquivo,
          U.el('div', { class: 'row' }, [
            U.el('button', { class: 'btn', text: 'Baixar modelo de planilha',
              onclick: function () { U.download('modelo-publicacoes.csv', PUB.modeloCSV(), 'text/csv;charset=utf-8'); } }),
            U.el('button', { class: 'btn', text: 'Baixar catálogo de métricas',
              title: 'A lista de identificadores para preencher a coluna "metrica"',
              onclick: function () { U.download('catalogo-metricas.csv', PUB.catalogoCSV(), 'text/csv;charset=utf-8'); } }),
            U.el('button', { class: 'btn', text: 'Exportar tudo',
              onclick: function () { U.download('publicacoes.csv', PST.exportarCSV(), 'text/csv;charset=utf-8'); } })
          ]),
          U.el('div', { class: 'small muted', text: 'Colunas: ' +
            PUB.COLUNAS_IMPORT.map(function (c) { return c.label; }).join(', ') +
            '. Obrigatórias: cnpj, fonte, periodo, metrica, valor.' }),
          saida
        ]));
        node.appendChild(cImp.node);

        /* --- lançamento manual --- */
        var cMan = UI.card({ titulo: 'Lançar um valor',
          sub: 'Para quando é mais rápido digitar do que montar planilha.' });
        var campos = {};
        var grade = U.el('div', { class: 'form-grid' });
        function campo(rotulo, controle, chave) {
          campos[chave] = controle;
          grade.appendChild(U.el('label', {}, [
            U.el('span', { class: 'field-label', text: rotulo }), controle
          ]));
        }
        campo('Instituição', bancos.length
          ? seletorBanco(bancos, bancos[0].cnpj, function () {})
          : U.el('input', { type: 'text', placeholder: 'CNPJ base, 8 dígitos' }), 'cnpj');
        campo('Fonte', UI.seletor(PUB.FONTES.filter(function (f) { return !f.automatica; })
          .map(function (f) { return { value: f.id, label: f.nome }; }), 'pilar3', function () {}), 'fonte');
        campo('Trimestre', UI.seletor(periodos().map(function (p) {
          return { value: p, label: U.periodLabel(p) };
        }), periodos()[0], function () {}), 'periodo');
        campo('Métrica', seletorMetrica('basileia', function () {}), 'metrica');
        campo('Valor', U.el('input', { type: 'text', placeholder: 'ex.: 15,80' }), 'valor');
        campo('Onde foi lido', U.el('input', { type: 'text', placeholder: 'ex.: Pilar 3, tabela KM1' }), 'referencia');
        campo('Documento (opcional)', U.el('input', { type: 'text', placeholder: 'https://…' }), 'url');
        cMan.corpo.appendChild(grade);
        cMan.corpo.appendChild(U.el('div', { class: 'row', style: 'margin-top:12px' }, [
          U.el('button', { class: 'btn btn--primary', text: 'Lançar', onclick: function () {
            var banco = bancos.find(function (b) { return b.cnpj === campos.cnpj.value; });
            var r = PST.registrar({
              cnpj: campos.cnpj.value, banco: banco ? banco.nome : '',
              fonte: campos.fonte.value, periodo: campos.periodo.value,
              metrica: campos.metrica.value, valor: campos.valor.value,
              referencia: campos.referencia.value, url: campos.url.value
            });
            if (!r.ok) return UI.toast('Não lançado: ' + r.motivo, 'bad');
            UI.toast(r.substituiu ? 'Valor atualizado.' : 'Lançamento registrado.', 'good');
            campos.valor.value = '';
            render();
          } })
        ]));
        node.appendChild(cMan.node);

        /* --- o que está guardado --- */
        var todos = PST.todos();
        var cTab = UI.card({ titulo: 'Lançamentos guardados',
          sub: todos.length + ' no total, guardados neste navegador', flush: true });
        cTab.tools.appendChild(U.el('button', {
          class: 'btn btn--sm btn--danger', text: 'Apagar tudo', onclick: function () {
            UI.confirmar('Apagar lançamentos',
              'Remover os ' + todos.length + ' lançamentos deste navegador? Exporte antes se quiser guardar.',
              function () { PST.limpar(); UI.toast('Lançamentos apagados.', 'good'); render(); });
          }
        }));
        var alvo = U.el('div'); cTab.corpo.appendChild(alvo);
        TBL.render(alvo, {
          columns: [
            { key: 'banco', label: 'Instituição', sticky: true, largura: 220 },
            { key: 'fonteNome', label: 'Fonte', largura: 110 },
            { key: 'periodoLabel', label: 'Trimestre', largura: 90 },
            { key: 'metricaNome', label: 'Métrica', largura: 220 },
            { key: 'valor', label: 'Valor', tipo: 'num', decimais: 2 },
            { key: 'unidade', label: 'Unidade', largura: 80 },
            { key: 'referencia', label: 'Onde foi lido', largura: 240 }
          ],
          rows: todos.map(function (l) {
            var m = PUB.METRICA_POR_ID[l.metrica];
            return {
              banco: l.banco || l.cnpj,
              fonteNome: (PUB.FONTE_POR_ID[l.fonte] || {}).curto || l.fonte,
              periodoLabel: U.periodLabel(l.periodo),
              metricaNome: m ? m.nome : l.metrica,
              valor: l.valor, unidade: m ? m.unidade : '',
              referencia: l.referencia || (l.auto ? 'automático' : '–')
            };
          }),
          ordenar: { key: 'periodoLabel', dir: 'desc' }, maxLinhas: 100,
          nomeArquivo: 'lancamentos'
        });
        node.appendChild(cTab.node);
      }

      render();
      return { atualizar: render };
    }
  });

  /* ===================================================================
     Tela 5 — Onde buscar
     =================================================================== */

  VW.registrar({
    id: 'pub-fontes', modulo: 'publicacoes', titulo: 'Onde buscar',
    descricao: 'Atalhos de busca para as publicações de cada banco do escopo.',
    montar: function (node) {
      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Montando o escopo S1/S2…');
        bancosDoEscopo().then(function (bancos) { if (atual()) pintar(bancos); })
          .catch(function (e) { if (atual()) VW.blocoErro(node, e); });
      }

      function pintar(bancos) {
        U.clear(node);
        node.appendChild(UI.nota('Cada banco publica num endereço próprio, e esses endereços mudam. ' +
          'Em vez de inventar links diretos que quebram, os botões abaixo abrem uma busca já ' +
          'preparada para o documento certo daquela instituição. Ao encontrar o PDF, guarde o ' +
          'endereço no campo "url" da planilha de importação: assim o rastro fica registrado.'));

        if (!bancos.length) {
          node.appendChild(UI.vazio('Nenhum banco no escopo',
            'Carregue um período no módulo IF.data para montar a lista de S1 e S2.'));
          return;
        }

        var busca = U.el('input', { type: 'search', placeholder: 'Filtrar instituição…',
          style: 'min-width:240px' });
        var grade = U.el('div', { class: 'fontes' });
        function pintarGrade() {
          U.clear(grade);
          var q = U.norm(busca.value);
          bancos.filter(function (b) { return !q || U.norm(b.nome).indexOf(q) >= 0; })
            .slice(0, 120).forEach(function (b) {
              grade.appendChild(fichaBanco(b));
            });
          if (!grade.children.length) {
            grade.appendChild(UI.vazio('Nenhuma instituição encontrada', ''));
          }
        }
        busca.addEventListener('input', U.debounce(pintarGrade, 160));

        var cartao = UI.card({ titulo: 'Instituições do escopo',
          sub: bancos.length + ' bancos S1 e S2' });
        cartao.tools.appendChild(busca);
        cartao.corpo.appendChild(grade);
        pintarGrade();
        node.appendChild(cartao.node);
      }

      function fichaBanco(b) {
        var nome = b.nome;
        function buscaWeb(termo) {
          return 'https://duckduckgo.com/?q=' + encodeURIComponent(termo);
        }
        var links = [
          { rotulo: 'BR GAAP / IFRS (RI)', url: buscaWeb(nome + ' relações com investidores demonstrações financeiras trimestrais') },
          { rotulo: 'Pilar 3', url: buscaWeb(nome + ' relatório gerenciamento de riscos Pilar 3 pdf') },
          { rotulo: '20-F', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=20-F&dateb=&owner=include&count=40&company=' + encodeURIComponent(nome.split(' ').slice(0, 2).join(' ')) },
          { rotulo: 'CVM', url: buscaWeb(nome + ' site:rad.cvm.gov.br informações trimestrais') }
        ];
        return U.el('div', { class: 'fonte-card' }, [
          U.el('div', { class: 'fonte-card__nome' }, [
            U.el('span', { text: nome }),
            b.segmento ? U.el('span', { class: 'familia-chip', style: 'margin-left:8px', text: b.segmento }) : null
          ]),
          U.el('div', { class: 'small muted', text: 'CNPJ base ' + b.cnpj }),
          U.el('div', { class: 'fonte-card__links' }, links.map(function (l) {
            return U.el('a', { class: 'fonte-link', href: l.url, target: '_blank',
                               rel: 'noopener noreferrer', text: l.rotulo });
          }))
        ]);
      }

      render();
      return { atualizar: render };
    }
  });
})(window);
