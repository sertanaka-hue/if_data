/* views-analise.js — telas Conjuntos, Análise de conjunto, Mercado e Diagnóstico. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, CH = global.CH, API = global.API,
      TBL = global.TBL, CAT = global.CAT, VW = global.VW;

  /* =====================================================================
     Tela 4 — Conjuntos de bancos
     ===================================================================== */

  VW.registrar({
    id: 'grupos',
    titulo: 'Conjuntos',
    descricao: 'Monte carteiras de instituições e reutilize-as em todas as análises.',
    montar: function (node) {
      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Carregando instituições do período…');
        VW.carregar()
          .then(function (ds) { if (atual()) pintar(ds); })
          .catch(function () { if (atual()) pintar(null); });
      }

      function pintar(ds) {
        U.clear(node);
        ST.carregarGrupos();

        node.appendChild(UI.nota(
          'Um conjunto é uma lista de instituições salva neste navegador. Ele alimenta a tela ' +
          '"Análise de conjunto", onde os saldos são somados e os índices recalculados a partir ' +
          'dos componentes — nunca por média simples de percentuais.'));

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(U.el('div', { class: 'row' }, [
          U.el('button', { class: 'btn btn--primary', text: '+ Novo conjunto',
            onclick: function () { editor(null, ds); } }),
          U.el('button', { class: 'btn', text: 'Sugestões automáticas',
            title: 'Cria conjuntos por faixa de tamanho a partir do período em tela',
            onclick: function () { sugerir(ds); } }),
          U.el('button', { class: 'btn', text: 'Exportar JSON',
            onclick: function () {
              if (!ST.estado.grupos.length) return UI.toast('Nenhum conjunto para exportar.', 'warn');
              U.download('ifdata-conjuntos.json', ST.exportarGrupos(), 'application/json');
            } }),
          U.el('button', { class: 'btn', text: 'Importar JSON', onclick: importar })
        ]));
        node.appendChild(barra);

        if (!ST.estado.grupos.length) {
          node.appendChild(UI.vazio('Nenhum conjunto ainda',
            'Crie um do zero, use as sugestões automáticas, ou monte um Top N na tela de Consulta.'));
          return;
        }

        var grade = U.el('div', { class: 'grouplist' });
        ST.estado.grupos.forEach(function (g) {
          var presentes = ds ? VW.linhasDoGrupo(ds, g).length : null;
          grade.appendChild(U.el('div', {
            class: 'groupcard' + (ST.estado.grupoAtivo === g.id ? ' is-active' : '')
          }, [
            U.el('div', { class: 'groupcard__title' }, [
              U.el('span', { text: g.nome }),
              U.el('span', { class: 'badge', text: g.membros.length + ' IFs' })
            ]),
            g.descricao ? U.el('div', { class: 'small muted', text: g.descricao }) : null,
            U.el('div', { class: 'groupcard__members',
              text: g.membros.map(function (m) { return m.nome; }).join(' · ') }),
            presentes !== null && presentes < g.membros.length
              ? U.el('div', { class: 'small', style: 'color:var(--warning)',
                  text: presentes + ' de ' + g.membros.length + ' encontradas no período em tela' })
              : null,
            U.el('div', { class: 'groupcard__foot' }, [
              U.el('button', { class: 'btn btn--sm btn--primary', text: 'Analisar',
                onclick: function () {
                  ST.set({ grupoAtivo: g.id });
                  global.APP.irPara('analise');
                } }),
              U.el('button', { class: 'btn btn--sm', text: 'Editar',
                onclick: function () { editor(g, ds); } }),
              U.el('button', { class: 'btn btn--sm', text: 'Duplicar',
                onclick: function () { ST.duplicarGrupo(g.id); pintar(ds); } }),
              U.el('button', { class: 'btn btn--sm btn--danger', text: 'Excluir',
                onclick: function () {
                  UI.confirmar('Excluir conjunto', 'Remover "' + g.nome + '" definitivamente?', function () {
                    ST.removerGrupo(g.id); pintar(ds);
                  });
                } })
            ])
          ]));
        });
        node.appendChild(grade);

        function sugerir(ds) {
          if (!ds) return UI.toast('Carregue um período primeiro.', 'warn');
          var campo = VW.campoPrincipal(ds);
          var sugestoes = ST.sugerirGrupos(ds.rows, campo);
          if (!sugestoes.length) return UI.toast('Não há dados suficientes para sugerir conjuntos.', 'warn');
          sugestoes.forEach(function (s) { ST.criarGrupo(s.nome, s.membros, s.descricao); });
          UI.toast(sugestoes.length + ' conjuntos criados a partir de ' + campo + '.', 'good');
          pintar(ds);
        }

        function importar() {
          var area = U.el('textarea', { rows: 10, style: 'width:100%',
            placeholder: 'Cole aqui o JSON exportado…' });
          var arquivo = U.el('input', { type: 'file', accept: '.json,application/json' });
          arquivo.addEventListener('change', function () {
            var f = arquivo.files && arquivo.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () { area.value = String(fr.result); };
            fr.readAsText(f);
          });
          var substituir = U.el('input', { type: 'checkbox' });
          UI.modal({
            titulo: 'Importar conjuntos',
            sub: 'Aceita o arquivo gerado por "Exportar JSON".',
            corpo: U.el('div', { class: 'stack' }, [
              arquivo, area,
              U.el('label', { class: 'switch' }, [substituir,
                U.el('span', { text: 'Substituir os conjuntos existentes' })])
            ]),
            acoes: [
              { label: 'Cancelar' },
              { label: 'Importar', primaria: true, onClick: function () {
                try {
                  var n = ST.importarGrupos(area.value, substituir.checked);
                  UI.toast(n + ' conjuntos importados.', 'good');
                  pintar(ds);
                } catch (e) {
                  UI.toast('JSON inválido: ' + e.message, 'bad');
                  return false;
                }
              } }
            ]
          });
        }
      }

      function editor(g, ds) {
        var nome = U.el('input', { type: 'text', value: g ? g.nome : '',
          placeholder: 'Ex.: Peers de varejo digital', style: 'width:100%' });
        var desc = U.el('input', { type: 'text', value: g ? g.descricao : '',
          placeholder: 'Descrição (opcional)', style: 'width:100%' });
        var opcoes = ds ? VW.opcoesInstituicoes(ds) : [];
        if (g) {
          // mantém membros que não estão no período em tela
          var conhecidos = {};
          opcoes.forEach(function (o) { conhecidos[o.value] = true; });
          g.membros.forEach(function (m) {
            if (!conhecidos[m.id]) opcoes.push({ value: m.id, label: m.nome, sub: 'fora do período atual' });
          });
        }
        var ms = UI.multiselect({
          opcoes: opcoes,
          selecionados: g ? g.membros.map(function (m) { return m.id; }) : [],
          placeholder: 'Buscar instituição…'
        });
        UI.modal({
          titulo: g ? 'Editar conjunto' : 'Novo conjunto',
          sub: ds ? 'Instituições listadas conforme ' + U.periodLong(ds.anoMes)
                  : 'Nenhum período carregado — a busca ficará vazia.',
          corpo: U.el('div', { class: 'stack' }, [
            U.el('label', { class: 'field-label', text: 'Nome' }), nome,
            U.el('label', { class: 'field-label', text: 'Descrição' }), desc,
            U.el('label', { class: 'field-label', text: 'Instituições' }), ms.node
          ]),
          acoes: [
            { label: 'Cancelar' },
            { label: 'Salvar', primaria: true, onClick: function () {
              var ids = ms.valores();
              if (!nome.value.trim()) { UI.toast('Dê um nome ao conjunto.', 'warn'); return false; }
              if (!ids.length) { UI.toast('Escolha ao menos uma instituição.', 'warn'); return false; }
              var membros = ids.map(function (id) {
                var o = opcoes.find(function (x) { return x.value === id; });
                return { id: id, nome: o ? o.label : id };
              });
              if (g) ST.atualizarGrupo(g.id, { nome: nome.value.trim(), descricao: desc.value.trim(), membros: membros });
              else ST.criarGrupo(nome.value.trim(), membros, desc.value.trim());
              UI.toast('Conjunto salvo.', 'good');
              pintar(ds);
            } }
          ]
        });
      }

      render();
      return { atualizar: render };
    }
  });

  /* =====================================================================
     Tela 5 — Análise de conjunto
     ===================================================================== */

  VW.registrar({
    id: 'analise',
    titulo: 'Análise de conjunto',
    descricao: 'Agrega os saldos do conjunto, recalcula os índices e compara conjuntos entre si.',
    montar: function (node) {
      var local = {
        selecionados: null,
        incluirSistema: true,
        eixoX: 'basileia', eixoY: 'roe',
        refAnoMes: null, refDados: null, carregandoRef: false
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
        ST.carregarGrupos();
        var aviso = VW.avisoDemo(ds); if (aviso) node.appendChild(aviso);

        if (!ST.estado.grupos.length) {
          node.appendChild(UI.vazio('Nenhum conjunto criado',
            'Vá em "Conjuntos" para montar sua primeira carteira de instituições.'));
          node.appendChild(U.el('div', { class: 'row', style: 'justify-content:center' }, [
            U.el('button', { class: 'btn btn--primary', text: 'Ir para Conjuntos',
              onclick: function () { global.APP.irPara('grupos'); } })
          ]));
          return;
        }
        if (!ds.rows.length) {
          node.appendChild(UI.vazio('Sem dados neste período', 'Escolha outro trimestre na barra superior.'));
          return;
        }

        if (!local.selecionados) {
          local.selecionados = ST.estado.grupoAtivo
            ? [ST.estado.grupoAtivo]
            : [ST.estado.grupos[0].id];
        }
        local.selecionados = local.selecionados.filter(function (id) { return !!ST.grupo(id); });
        if (!local.selecionados.length) local.selecionados = [ST.estado.grupos[0].id];
        if (!local.refAnoMes) local.refAnoMes = U.shiftPeriod(ds.anoMes, -4);

        var ctxCalc = { anoMes: ds.anoMes, anualizar: ST.estado.anualizar };
        var principal = VW.campoPrincipal(ds);
        var numericas = VW.colunasNumericas(ds);
        var indicadores = CAT.indicadoresDisponiveis(ds.campos);

        /* --- controles ------------------------------------------------------ */
        var barra = U.el('div', { class: 'filterbar' });
        var msG = UI.multiselect({
          opcoes: ST.estado.grupos.map(function (g) {
            return { value: g.id, label: g.nome, sub: g.membros.length + ' IFs' };
          }),
          selecionados: local.selecionados, max: 6, corPorValor: true,
          placeholder: 'Escolher conjuntos…',
          onChange: function (v) { local.selecionados = v; pintar(ds); }
        });
        barra.appendChild(UI.campo('Conjuntos comparados', msG.node, 'grow'));
        barra.appendChild(UI.campo('Referência para variação', UI.seletor(
          U.allPeriods(2000).map(function (p) { return { value: p, label: U.periodLabel(p) }; }),
          local.refAnoMes, function (v) { local.refAnoMes = v; local.refDados = null; pintar(ds); })));
        barra.appendChild(U.el('div', { class: 'filterbar__actions' }, [
          UI.alternador('Comparar com o sistema', local.incluirSistema, function (v) {
            local.incluirSistema = v; pintar(ds);
          }, 'Inclui o total de todas as instituições do recorte como linha de referência')
        ]));
        node.appendChild(barra);

        /* --- agregações ----------------------------------------------------- */
        var blocos = local.selecionados.map(function (id) {
          var g = ST.grupo(id);
          var linhas = VW.linhasDoGrupo(ds, g);
          return { id: id, nome: g.nome, grupo: g, linhas: linhas,
                   agg: CAT.agregarLinhas(linhas, ds.campos, ctxCalc) };
        });
        var sistema = CAT.agregarLinhas(ds.rows, ds.campos, ctxCalc);
        if (local.incluirSistema) {
          blocos.push({ id: '__sistema', nome: 'Sistema (todas as IFs)', grupo: null,
                        linhas: ds.rows, agg: sistema });
        }
        CH.Colors.rebase(blocos.map(function (b) { return b.id; }));

        var principalBloco = blocos[0];
        var faltantes = principalBloco.grupo
          ? principalBloco.grupo.membros.length - principalBloco.linhas.length : 0;
        if (faltantes > 0) {
          node.appendChild(UI.nota(faltantes + ' de ' + principalBloco.grupo.membros.length +
            ' instituições do conjunto "' + principalBloco.nome + '" não aparecem em ' +
            U.periodLong(ds.anoMes) + ' — os agregados abaixo consideram apenas as ' +
            principalBloco.linhas.length + ' encontradas.', 'warn'));
        }
        if (principalBloco.agg.aproximados.length) {
          node.appendChild(UI.nota('Sem os componentes no relatório atual, estes índices foram ' +
            'agregados por média ponderada pelo ativo (aproximação): ' +
            principalBloco.agg.aproximados.join(', ') + '. Carregue "Informações de Capital" para ' +
            'o cálculo exato a partir de PR e RWA.', 'warn'));
        }

        /* --- painel do conjunto principal ------------------------------------ */
        var ativoGrupo = principalBloco.agg.campos.ativoTotal;
        var ativoSistema = sistema.campos.ativoTotal;
        var share = U.isNum(ativoGrupo) && U.isNum(ativoSistema) && ativoSistema
          ? (ativoGrupo / ativoSistema) * 100 : null;
        var esc = VW.escala();

        var hero = U.el('div', { class: 'card' }, [
          U.el('div', { class: 'card__body', style: 'padding:16px' }, [
            U.el('div', { class: 'hero' }, [
              U.el('div', { class: 'hero__label',
                text: 'Ativo total agregado — ' + principalBloco.nome }),
              U.el('div', { class: 'hero__value',
                text: U.isNum(ativoGrupo) ? U.compact(ativoGrupo * esc, 2) : '–' }),
              U.el('div', { class: 'small muted',
                text: VW.unidadeColuna('Ativo Total') + ' · ' + U.periodLong(ds.anoMes) +
                      (U.isNum(share) ? ' · ' + U.pct(share, 2) + ' do sistema' : '') })
            ])
          ])
        ]);
        node.appendChild(hero);

        node.appendChild(VW.faixaStats([
          { label: 'Instituições no conjunto', valor: U.fmt(principalBloco.linhas.length, 0),
            nota: principalBloco.grupo ? 'de ' + principalBloco.grupo.membros.length + ' cadastradas' : 'todo o recorte' },
          { label: 'Participação de mercado', valor: U.pct(share, 2),
            nota: 'por ativo total' },
          { label: 'ROE agregado', valor: U.pct(principalBloco.agg.indicadores.roe, 1),
            melhor: 'alto', nota: ST.estado.anualizar ? 'resultado anualizado' : 'resultado acumulado no ano' },
          { label: 'Índice de Basileia', valor: U.pct(principalBloco.agg.indicadores.basileia, 2),
            melhor: 'alto', nota: 'mínimo regulatório 8% + adicionais' },
          { label: 'Concentração interna (HHI)',
            valor: U.fmt(U.hhi(principalBloco.linhas.map(function (r) { return VW.valor(r, principal); })), 0),
            nota: 'dentro do próprio conjunto' }
        ]));

        /* --- comparação entre conjuntos --------------------------------------- */
        if (indicadores.length) {
          var grade = U.el('div', { class: 'grid grid--2' });
          indicadores.slice(0, 6).forEach(function (m) {
            var g = UI.grafico({ titulo: m.label, sub: m.desc });
            var dados = blocos.map(function (b) {
              return { key: b.id, label: b.nome, value: b.agg.indicadores[m.id],
                       color: CH.Colors.of(b.id) };
            }).filter(function (d) { return U.isNum(d.value); })
              .sort(function (a, b) { return b.value - a.value; });
            if (!dados.length) { CH.vazio(g.grafico, 'Indicador indisponível neste relatório.'); }
            else {
              CH.ranking(g.grafico, {
                data: dados, serieLabel: m.label, alturaLinha: 30,
                fmtValor: function (v) { return U.fmt(v, m.decimais) + ' ' + m.unidade; },
                fmtEixo: function (v) { return U.fmt(v, m.decimais === 0 ? 0 : 1); },
                aria: m.label + ' por conjunto'
              });
            }
            TBL.render(g.tabela, {
              columns: [{ key: 'nome', label: 'Conjunto', sticky: true, largura: 200 },
                        { key: 'valor', label: m.label + ' (' + m.unidade + ')', tipo: 'num', decimais: m.decimais }],
              rows: dados.map(function (d) { return { nome: d.label, valor: d.value }; }),
              busca: false, nomeArquivo: 'conjuntos-' + m.id
            });
            grade.appendChild(g.node);
          });
          node.appendChild(grade);
        }

        /* --- composição interna ------------------------------------------------ */
        var gComp = UI.grafico({
          titulo: 'Composição de "' + principalBloco.nome + '" por ' + principal,
          sub: 'Participação de cada membro dentro do conjunto · ' + VW.unidadeColuna(principal)
        });
        var membros = principalBloco.linhas.slice().sort(function (a, b) {
          return (VW.valor(b, principal) || 0) - (VW.valor(a, principal) || 0);
        });
        var totalGrupo = U.sum(membros.map(function (r) { return VW.valor(r, principal); }).filter(U.isNum));
        CH.ranking(gComp.grafico, {
          data: membros.slice(0, 25).map(function (r) {
            var v = VW.valor(r, principal);
            return { key: r.__id, label: r.__nome, value: v, color: 'var(--series-1)',
                     nota: totalGrupo ? U.pct((v / totalGrupo) * 100, 2) + ' do conjunto' : null };
          }),
          serieLabel: principal, fmtValor: VW.fmtColuna(principal), fmtEixo: VW.fmtColuna(principal),
          aria: 'Composição do conjunto'
        });
        TBL.render(gComp.tabela, {
          columns: [
            { key: 'nome', label: 'Instituição', sticky: true, largura: 240 },
            { key: 'valor', label: principal, tipo: 'num', fmt: VW.fmtColuna(principal) },
            { key: 'share', label: '% do conjunto', tipo: 'num', decimais: 2 }
          ].concat(indicadores.slice(0, 5).map(function (m) {
            return { key: m.id, label: m.label, tipo: 'num', decimais: m.decimais };
          })),
          rows: membros.map(function (r) {
            var v = VW.valor(r, principal);
            var ind = CAT.calcIndicadores(r, ds.campos, ctxCalc);
            var o = { nome: r.__nome, valor: v, share: totalGrupo && U.isNum(v) ? (v / totalGrupo) * 100 : null };
            indicadores.slice(0, 5).forEach(function (m) { o[m.id] = ind[m.id]; });
            return o;
          }),
          nomeArquivo: 'conjunto-' + U.slug(principalBloco.nome) + '-' + ds.anoMes,
          rodape: 'Agregado do conjunto: ' + VW.fmtColuna(principal)(principalBloco.agg.campos.ativoTotal || totalGrupo)
        });
        node.appendChild(gComp.node);

        /* --- dispersão risco × retorno ------------------------------------------ */
        if (indicadores.length >= 2) {
          var gDisp = UI.grafico({
            titulo: 'Dispersão dos membros',
            sub: 'Cada bolha é uma instituição; o tamanho acompanha ' + principal +
                 '. As linhas cinzas marcam as medianas do conjunto.'
          });
          var selX = UI.seletor(indicadores.map(function (m) { return { value: m.id, label: m.label }; }),
            indicadores.some(function (m) { return m.id === local.eixoX; }) ? local.eixoX : indicadores[0].id,
            function (v) { local.eixoX = v; pintar(ds); });
          var selY = UI.seletor(indicadores.map(function (m) { return { value: m.id, label: m.label }; }),
            indicadores.some(function (m) { return m.id === local.eixoY; }) ? local.eixoY : indicadores[1].id,
            function (v) { local.eixoY = v; pintar(ds); });
          gDisp.tools.insertBefore(U.el('div', { class: 'row row--tight small' }, [
            U.el('span', { class: 'muted', text: 'X' }), selX,
            U.el('span', { class: 'muted', text: 'Y' }), selY
          ]), gDisp.tools.firstChild);

          var mX = CAT.INDICADOR_POR_ID[selX.value], mY = CAT.INDICADOR_POR_ID[selY.value];
          var pontos = membros.map(function (r) {
            var ind = CAT.calcIndicadores(r, ds.campos, ctxCalc);
            return { key: r.__id, label: r.__nome, x: ind[mX.id], y: ind[mY.id],
                     size: VW.valor(r, principal), color: 'var(--series-1)' };
          });
          CH.dispersao(gDisp.grafico, {
            points: pontos, dimensionar: true, rotular: 6, altura: 400,
            tituloX: mX.label + ' (' + mX.unidade + ')',
            tituloY: mY.label + ' (' + mY.unidade + ')',
            tituloTamanho: principal,
            fmtX: function (v) { return U.fmt(v, mX.decimais); },
            fmtY: function (v) { return U.fmt(v, mY.decimais); },
            aria: 'Dispersão dos membros do conjunto'
          });
          TBL.render(gDisp.tabela, {
            columns: [{ key: 'nome', label: 'Instituição', sticky: true, largura: 240 },
                      { key: 'x', label: mX.label, tipo: 'num', decimais: mX.decimais },
                      { key: 'y', label: mY.label, tipo: 'num', decimais: mY.decimais },
                      { key: 'size', label: principal, tipo: 'num', fmt: VW.fmtColuna(principal) }],
            rows: pontos.map(function (p) { return { nome: p.label, x: p.x, y: p.y, size: p.size }; }),
            busca: false, nomeArquivo: 'dispersao-conjunto'
          });
          node.appendChild(gDisp.node);
        }

        /* --- contribuição para a variação ---------------------------------------- */
        var cartaoVar = UI.card({
          titulo: 'Contribuição para a variação de ' + principal,
          sub: 'Quanto cada membro somou ou tirou do conjunto entre ' + U.periodLabel(local.refAnoMes) +
               ' e ' + U.periodLabel(ds.anoMes)
        });
        var alvoVar = U.el('div');
        cartaoVar.corpo.appendChild(alvoVar);
        node.appendChild(cartaoVar.node);

        if (local.refDados && local.refDados.anoMes === local.refAnoMes) {
          desenharWaterfall(alvoVar, ds, principalBloco, principal, local.refDados);
        } else if (local.carregandoRef) {
          alvoVar.appendChild(UI.carregando('Carregando ' + U.periodLabel(local.refAnoMes) + '…'));
        } else {
          alvoVar.appendChild(U.el('div', { class: 'row', style: 'padding:8px 0' }, [
            U.el('button', {
              class: 'btn btn--primary',
              text: 'Carregar ' + U.periodLabel(local.refAnoMes) + ' e decompor',
              onclick: function () {
                local.carregandoRef = true; pintar(ds);
                API.valores(local.refAnoMes, ds.tipo, ds.relatorio).then(function (d) {
                  local.refDados = { anoMes: local.refAnoMes, rows: d.rows, columns: d.columns };
                  local.carregandoRef = false; pintar(ds);
                }).catch(function (e) {
                  local.carregandoRef = false;
                  UI.toast('Não foi possível carregar ' + U.periodLabel(local.refAnoMes) + ': ' + e.message, 'bad');
                  pintar(ds);
                });
              }
            }),
            U.el('span', { class: 'small muted',
              text: 'Uma chamada adicional à API para o trimestre de referência.' })
          ]));
        }
      }

      function desenharWaterfall(alvo, ds, bloco, coluna, ref) {
        U.clear(alvo);
        var antes = new Map();
        ref.rows.forEach(function (r) { antes.set(r.__id, r); });
        var porNome = new Map();
        ref.rows.forEach(function (r) { porNome.set(U.norm(r.__nome), r); });

        var contribs = bloco.linhas.map(function (r) {
          var a = antes.get(r.__id) || porNome.get(U.norm(r.__nome));
          var v0 = a ? VW.valor(a, coluna) : null;
          var v1 = VW.valor(r, coluna);
          return { key: r.__id, label: r.__nome, de: v0, para: v1,
                   delta: U.isNum(v0) && U.isNum(v1) ? v1 - v0 : null };
        }).filter(function (c) { return U.isNum(c.delta); })
          .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });

        if (!contribs.length) {
          alvo.appendChild(UI.vazio('Sem base comparável',
            'Nenhum membro do conjunto aparece nos dois trimestres.'));
          return;
        }

        var base = U.sum(contribs.map(function (c) { return c.de; }));
        var fim = U.sum(contribs.map(function (c) { return c.para; }));
        var principais = contribs.slice(0, 9);
        var resto = contribs.slice(9);

        /* A ponte parte de zero e mede só a VARIAÇÃO: se começasse no saldo do
           trimestre-base, as contribuições virariam frestas ao lado de duas
           colunas gigantes. Os níveis absolutos ficam no resumo e na tabela. */
        var itens = principais.map(function (c) {
          return { label: U.truncate(c.label, 18), value: c.delta };
        });
        if (resto.length) {
          itens.push({ label: 'Outros (' + resto.length + ')',
                       value: U.sum(resto.map(function (c) { return c.delta; })) });
        }
        itens.push({ label: 'Variação total', total: true });

        var fmtC = VW.fmtColuna(coluna);
        alvo.appendChild(U.el('div', { class: 'small muted', style: 'padding:2px 0 10px' , text:
          U.periodLabel(ref.anoMes) + ': ' + fmtC(base) + '  →  ' +
          U.periodLabel(ds.anoMes) + ': ' + fmtC(fim) +
          '   (variação de ' + fmtC(fim - base) + ', ' + U.pct(U.growth(base, fim), 1) + ')' }));

        var chart = U.el('div');
        alvo.appendChild(chart);
        CH.waterfall(chart, {
          items: itens, base: 0, altura: 340,
          fmtValor: VW.fmtColuna(coluna), fmtEixo: VW.fmtColuna(coluna),
          aria: 'Decomposição da variação do conjunto'
        });

        var tab = U.el('div');
        alvo.appendChild(tab);
        TBL.render(tab, {
          columns: [
            { key: 'nome', label: 'Instituição', sticky: true, largura: 240 },
            { key: 'de', label: U.periodLabel(ref.anoMes), tipo: 'num', fmt: VW.fmtColuna(coluna) },
            { key: 'para', label: U.periodLabel(ds.anoMes), tipo: 'num', fmt: VW.fmtColuna(coluna) },
            { key: 'delta', label: 'Variação', tipo: 'num', fmt: VW.fmtColuna(coluna) },
            { key: 'pct', label: 'Variação %', tipo: 'num', decimais: 1 },
            { key: 'contrib', label: '% da variação do conjunto', tipo: 'num', decimais: 1 }
          ],
          rows: (function () {
            var totalDelta = U.sum(contribs.map(function (c) { return c.delta; }));
            return contribs.map(function (c) {
              return { nome: c.label, de: c.de, para: c.para, delta: c.delta,
                       pct: U.growth(c.de, c.para),
                       contrib: totalDelta ? (c.delta / totalDelta) * 100 : null };
            });
          })(),
          busca: false, nomeArquivo: 'contribuicao-variacao'
        });
      }

      render();
      return { atualizar: function () { local.refDados = null; render(); } };
    }
  });

  /* =====================================================================
     Tela 6 — Mercado e concentração
     ===================================================================== */

  VW.registrar({
    id: 'mercado',
    titulo: 'Mercado & concentração',
    descricao: 'Participação de mercado, HHI, razões de concentração e curva acumulada.',
    montar: function (node) {
      var local = { coluna: null, topN: 20 };

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

        var numericas = VW.colunasNumericas(ds).filter(function (c) { return !VW.ehRazao(c); });
        if (!numericas.length) {
          node.appendChild(UI.vazio('Este relatório não tem colunas de saldo',
            'A concentração só faz sentido sobre estoques ou fluxos. Use "Resumo" ou "Ativo".'));
          return;
        }
        if (!local.coluna || numericas.indexOf(local.coluna) < 0) local.coluna = VW.campoPrincipal(ds) || numericas[0];

        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Mercado analisado', UI.seletor(
          numericas.map(function (c) { return { value: c, label: c }; }),
          local.coluna, function (v) { local.coluna = v; pintar(ds); }, { style: 'min-width:280px' })));
        barra.appendChild(UI.campo('Top N no ranking', UI.seletor(
          [10, 15, 20, 30, 50].map(function (n) { return { value: String(n), label: String(n) }; }),
          String(local.topN), function (v) { local.topN = Number(v); pintar(ds); })));
        node.appendChild(barra);

        var comValor = ds.rows.map(function (r) {
          return { nome: r.__nome, id: r.__id, valor: VW.valor(r, local.coluna) };
        }).filter(function (x) { return U.isNum(x.valor) && x.valor > 0; })
          .sort(function (a, b) { return b.valor - a.valor; });

        if (!comValor.length) {
          node.appendChild(UI.vazio('Coluna sem valores positivos', 'Escolha outra coluna.'));
          return;
        }

        var total = U.sum(comValor.map(function (x) { return x.valor; }));
        var shares = comValor.map(function (x) { return (x.valor / total) * 100; });
        var indice = U.hhi(comValor.map(function (x) { return x.valor; }));
        function cr(n) { return U.sum(shares.slice(0, n)); }

        node.appendChild(VW.faixaStats([
          { label: 'HHI', valor: U.fmt(indice, 0),
            nota: indice > 2500 ? 'Concentrado (>2.500)' : indice > 1500 ? 'Moderado (1.500–2.500)' : 'Desconcentrado (<1.500)' },
          { label: 'CR5', valor: U.pct(cr(5), 1), nota: 'Cinco maiores' },
          { label: 'CR10', valor: U.pct(cr(10), 1), nota: 'Dez maiores' },
          { label: 'Índice de Gini', valor: U.fmt(U.gini(comValor.map(function (x) { return x.valor; })), 3),
            nota: '0 = distribuição igual, 1 = máxima desigualdade' },
          { label: 'Instituições com saldo', valor: U.fmt(comValor.length, 0),
            nota: 'de ' + ds.rows.length + ' no recorte' }
        ]));

        /* --- ranking de participação ----------------------------------------- */
        var g1 = UI.grafico({
          titulo: 'Participação de mercado — ' + local.coluna,
          sub: U.periodLong(ds.anoMes) + ' · total do sistema: ' + VW.fmtColuna(local.coluna)(total)
        });
        CH.ranking(g1.grafico, {
          data: comValor.slice(0, local.topN).map(function (x, i) {
            return { key: x.id, label: x.nome, value: shares[i], color: 'var(--series-1)',
                     nota: VW.fmtColuna(local.coluna)(x.valor) };
          }),
          serieLabel: 'Participação',
          fmtValor: function (v) { return U.pct(v, 2); },
          fmtEixo: function (v) { return U.fmt(v, 0) + '%'; },
          aria: 'Participação de mercado por instituição'
        });
        TBL.render(g1.tabela, {
          columns: [
            { key: 'pos', label: '#', tipo: 'num', decimais: 0 },
            { key: 'nome', label: 'Instituição', sticky: true, largura: 240 },
            { key: 'valor', label: local.coluna, tipo: 'num', fmt: VW.fmtColuna(local.coluna) },
            { key: 'share', label: 'Participação %', tipo: 'num', decimais: 3 },
            { key: 'acum', label: 'Acumulado %', tipo: 'num', decimais: 2 }
          ],
          rows: (function () {
            var acc = 0;
            return comValor.map(function (x, i) {
              acc += shares[i];
              return { pos: i + 1, nome: x.nome, valor: x.valor, share: shares[i], acum: acc };
            });
          })(),
          ordenar: { key: 'pos', dir: 'asc' },
          nomeArquivo: 'market-share-' + U.slug(local.coluna) + '-' + ds.anoMes
        });
        node.appendChild(g1.node);

        var grade = U.el('div', { class: 'grid grid--2' });

        /* --- curva de concentração ------------------------------------------- */
        var g2 = UI.grafico({
          titulo: 'Curva de concentração acumulada',
          sub: 'Participação acumulada das N maiores instituições'
        });
        var acumulado = [], acc = 0;
        shares.forEach(function (s) { acc += s; acumulado.push(acc); });
        var corte = Math.min(acumulado.length, 60);
        CH.linhas(g2.grafico, {
          x: acumulado.slice(0, corte).map(function (_, i) { return String(i + 1); }),
          series: [{ key: 'acum', label: 'Acumulado', color: 'var(--series-1)',
                     values: acumulado.slice(0, corte) }],
          altura: 300, area: true, rotularPontas: false, limites: [0, 100],
          fmtEixo: function (v) { return U.fmt(v, 0) + '%'; },
          fmtValor: function (v) { return U.pct(v, 1); },
          tituloEixo: '% acumulado', referencia: 80, referenciaLabel: '80% do mercado',
          zeroObrigatorio: true,
          aria: 'Curva de concentração acumulada'
        });
        TBL.render(g2.tabela, {
          columns: [{ key: 'n', label: 'N maiores', tipo: 'num', decimais: 0, sticky: true },
                    { key: 'acum', label: 'Participação acumulada %', tipo: 'num', decimais: 2 }],
          rows: acumulado.slice(0, corte).map(function (v, i) { return { n: i + 1, acum: v }; }),
          busca: false, nomeArquivo: 'curva-concentracao'
        });
        grade.appendChild(g2.node);

        /* --- HHI por mercado --------------------------------------------------- */
        var g3 = UI.grafico({
          titulo: 'HHI comparado entre mercados',
          sub: 'Mesma unidade (pontos HHI) para todas as colunas de saldo do relatório'
        });
        var porMercado = numericas.slice(0, 14).map(function (c) {
          var vals = ds.rows.map(function (r) { return VW.valor(r, c); })
            .filter(function (v) { return U.isNum(v) && v > 0; });
          return { key: c, label: c, value: U.hhi(vals), n: vals.length };
        }).filter(function (x) { return U.isNum(x.value); })
          .sort(function (a, b) { return b.value - a.value; });
        CH.ranking(g3.grafico, {
          data: porMercado.map(function (x) {
            return { key: x.key, label: x.label, value: x.value, color: 'var(--series-1)',
                     nota: x.n + ' instituições com saldo' };
          }),
          serieLabel: 'HHI', alturaLinha: 28,
          fmtValor: function (v) { return U.fmt(v, 0); },
          fmtEixo: function (v) { return U.fmt(v, 0); },
          aria: 'HHI por mercado'
        });
        TBL.render(g3.tabela, {
          columns: [{ key: 'label', label: 'Mercado', sticky: true, largura: 260 },
                    { key: 'value', label: 'HHI', tipo: 'num', decimais: 0 },
                    { key: 'n', label: 'IFs com saldo', tipo: 'num', decimais: 0 }],
          rows: porMercado, busca: false, nomeArquivo: 'hhi-por-mercado',
          rodape: 'Referência do CADE: abaixo de 1.500 desconcentrado, acima de 2.500 concentrado.'
        });
        grade.appendChild(g3.node);
        node.appendChild(grade);
      }

      render();
      return { atualizar: render };
    }
  });

  /* =====================================================================
     Tela 7 — Diagnóstico
     ===================================================================== */

  VW.registrar({
    id: 'diagnostico',
    titulo: 'Diagnóstico',
    descricao: 'Conexão com a API, forma do retorno e mapeamento de campos.',
    montar: function (node) {
      function render() {
        U.clear(node);
        var ds = ST.estado.dataset;

        /* --- conexão -------------------------------------------------------- */
        var cCon = UI.card({ titulo: 'Conexão com a API do Banco Central',
          sub: 'Endpoint OData do IF.data (portal de dados abertos do BCB)' });
        var baseInput = U.el('input', { type: 'text', value: API.state.base,
          style: 'width:100%;font-family:var(--mono);font-size:12px' });
        var resultado = U.el('div');
        cCon.corpo.appendChild(U.el('div', { class: 'stack' }, [
          U.el('label', { class: 'field-label', text: 'Base da API' }),
          baseInput,
          U.el('div', { class: 'small muted', text:
            'Altere apenas se sua rede expõe um espelho interno do endpoint. ' +
            'Padrão: ' + API.BASE_PADRAO }),
          U.el('div', { class: 'row' }, [
            U.el('button', { class: 'btn btn--primary', text: 'Testar conexão', onclick: function () {
              API.configurar({ base: baseInput.value.trim() || API.BASE_PADRAO });
              ST.set({ base: baseInput.value.trim() });
              ST.salvarPrefs();
              U.clear(resultado).appendChild(UI.carregando('Testando…'));
              var c = VW.ctx();
              API.testar(c.anoMes, c.tipo, c.relatorio).then(function (r) {
                U.clear(resultado);
                resultado.appendChild(UI.nota(
                  r.ok ? 'Conexão bem-sucedida em ' + r.ms + ' ms — ' + r.registros + ' registro(s) de amostra.'
                       : 'Falhou em ' + r.ms + ' ms: ' + r.erro,
                  r.ok ? 'good' : 'bad'));
                resultado.appendChild(U.el('div', { class: 'pre', text: r.url }));
                if (r.amostra) {
                  resultado.appendChild(U.el('div', { class: 'field-label', text: 'Primeiro registro devolvido' }));
                  resultado.appendChild(U.el('div', { class: 'pre', text: JSON.stringify(r.amostra, null, 2) }));
                }
              });
            } }),
            U.el('button', { class: 'btn', text: 'Restaurar padrão', onclick: function () {
              baseInput.value = API.BASE_PADRAO;
              API.configurar({ base: API.BASE_PADRAO });
              ST.set({ base: null }); ST.salvarPrefs();
              UI.toast('Base restaurada.', 'good');
            } }),
            U.el('button', { class: 'btn', text: 'Limpar cache local', onclick: function () {
              API.limparCache();
              UI.toast('Cache limpo — a próxima consulta busca tudo de novo.', 'good');
            } })
          ]),
          resultado
        ]));
        node.appendChild(cCon.node);

        /* --- períodos ---------------------------------------------------------- */
        var cPer = UI.card({ titulo: 'Períodos disponíveis',
          sub: 'Sonda a API trimestre a trimestre, do mais recente para trás' });
        var saidaPer = U.el('div');
        cPer.corpo.appendChild(U.el('div', { class: 'stack' }, [
          U.el('div', { class: 'row' }, [
            U.el('button', { class: 'btn', text: 'Detectar últimos 24 trimestres', onclick: function () {
              var c = VW.ctx();
              U.clear(saidaPer).appendChild(UI.carregando('Sondando…'));
              API.periodosDisponiveis(c.tipo, c.relatorio, 24, function (i, n, p) {
                var s = saidaPer.querySelector('.loading span');
                if (s) s.textContent = 'Testando ' + U.periodLabel(p) + ' (' + i + '/' + n + ')…';
              }).then(function (ok) {
                U.clear(saidaPer);
                if (!ok.length) {
                  saidaPer.appendChild(UI.nota('Nenhum trimestre respondeu com dados para este relatório e tipo.', 'bad'));
                  return;
                }
                saidaPer.appendChild(UI.nota(ok.length + ' trimestres com dados: ' +
                  ok.map(U.periodLabel).join(', '), 'good'));
              });
            } }),
            U.el('span', { class: 'small muted',
              text: 'Usa o tipo de instituição e o relatório escolhidos na barra superior.' })
          ]),
          saidaPer
        ]));
        node.appendChild(cPer.node);

        /* --- forma do retorno --------------------------------------------------- */
        if (ds) {
          var cForma = UI.card({ titulo: 'Retorno do relatório em tela',
            sub: U.periodLong(ds.anoMes) + ' · tipo ' + ds.tipo + ' · relatório ' + ds.relatorio });
          cForma.corpo.appendChild(U.el('dl', { class: 'kv' }, [
            U.el('dt', { text: 'Forma detectada' }), U.el('dd', { text: ds.forma }),
            U.el('dt', { text: 'Instituições' }), U.el('dd', { text: U.fmt(ds.rows.length, 0) }),
            U.el('dt', { text: 'Colunas de dado' }), U.el('dd', { text: U.fmt(ds.columns.length, 0) }),
            U.el('dt', { text: 'Colunas de identificação' }), U.el('dd', { text: ds.metaColumns.join(', ') || '–' }),
            U.el('dt', { text: 'Origem' }), U.el('dd', { text: ds.demo ? 'dados sintéticos (demonstração)' : 'API do BCB' })
          ]));
          if (ds.url) {
            cForma.corpo.appendChild(U.el('div', { class: 'field-label', style: 'margin-top:10px', text: 'URL consultada' }));
            cForma.corpo.appendChild(U.el('div', { class: 'pre', text: ds.url }));
          }
          if (ds.bruto) {
            cForma.corpo.appendChild(U.el('div', { class: 'field-label', style: 'margin-top:10px', text: 'Primeiro registro bruto' }));
            cForma.corpo.appendChild(U.el('div', { class: 'pre', text: JSON.stringify(ds.bruto, null, 2) }));
          }
          node.appendChild(cForma.node);

          /* --- mapeamento de campos ------------------------------------------- */
          var cMap = UI.card({ titulo: 'Mapeamento de campos',
            sub: 'Os indicadores são calculados a partir destes campos. Ajuste se a detecção automática errar.' });
          var tabela = U.el('div');
          cMap.corpo.appendChild(tabela);
          function pintarMapa() {
            U.clear(tabela);
            var grade = U.el('div', { class: 'grid grid--3' });
            Object.keys(CAT.CAMPOS).forEach(function (canon) {
              var atual = ds.campos[canon] || '__none__';
              var score = ds.scoreCampos[canon] || 0;
              var confianca = score >= 900 ? 'exato' : score >= 600 ? 'prefixo' : score > 0 ? 'aproximado' : 'não encontrado';
              var sel = UI.seletor(
                [{ value: '__none__', label: '— não usar —' }]
                  .concat(ds.columns.map(function (c) { return { value: c, label: c }; })),
                atual,
                function (v) {
                  var ov = Object.assign({}, ST.estado.overridesCampos);
                  ov[canon] = v;
                  ST.set({ overridesCampos: ov });
                  UI.toast('Mapeamento ajustado — recarregando as telas.', 'good');
                  global.APP.recarregar();
                }, { style: 'width:100%' });
              grade.appendChild(U.el('div', {}, [
                U.el('div', { class: 'field-label', text: CAT.CAMPOS[canon].label }),
                sel,
                U.el('div', { class: 'small muted', text: 'detecção: ' + confianca })
              ]));
            });
            tabela.appendChild(grade);
            tabela.appendChild(U.el('div', { class: 'row', style: 'margin-top:12px' }, [
              U.el('button', { class: 'btn btn--sm', text: 'Restaurar detecção automática', onclick: function () {
                ST.set({ overridesCampos: {} });
                global.APP.recarregar();
              } })
            ]));
            if (ds.semUso.length) {
              tabela.appendChild(U.el('div', { class: 'field-label', style: 'margin-top:14px',
                text: 'Colunas do relatório sem campo canônico associado (' + ds.semUso.length + ')' }));
              tabela.appendChild(U.el('div', { class: 'small muted', text: ds.semUso.join(' · ') }));
            }
          }
          pintarMapa();
          node.appendChild(cMap.node);

          /* --- indicadores disponíveis ----------------------------------------- */
          var disponiveis = CAT.indicadoresDisponiveis(ds.campos);
          var cInd = UI.card({ titulo: 'Indicadores calculáveis neste relatório',
            sub: disponiveis.length + ' de ' + CAT.INDICADORES.length, flush: true });
          var alvoInd = U.el('div'); cInd.corpo.appendChild(alvoInd);
          TBL.render(alvoInd, {
            columns: [
              { key: 'label', label: 'Indicador', sticky: true, largura: 220 },
              { key: 'grupo', label: 'Grupo', largura: 150 },
              { key: 'status', label: 'Situação', largura: 120 },
              { key: 'desc', label: 'Definição', largura: 460 }
            ],
            rows: CAT.INDICADORES.map(function (m) {
              var ok = disponiveis.indexOf(m) >= 0;
              return { label: m.label, grupo: m.grupo, status: ok ? 'disponível' : 'indisponível', desc: m.desc };
            }),
            ordenar: { key: 'status', dir: 'asc' }, maxLinhas: 40,
            nomeArquivo: 'indicadores-disponiveis'
          });
          node.appendChild(cInd.node);
        } else {
          node.appendChild(UI.vazio('Nenhum relatório carregado',
            'Volte à tela de Consulta para carregar um período.'));
        }
      }

      render();
      return { atualizar: render };
    }
  });
})(window);
