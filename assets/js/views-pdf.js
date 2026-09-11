/* views-pdf.js — tela "Importar PDF" do módulo Publicações.
   A extração propõe; o analista confirma. Nenhum número entra na base sem que
   alguém tenha visto a linha de onde ele saiu. */
(function (global) {
  'use strict';
  var U = global.U, UI = global.UI, ST = global.ST, VW = global.VW,
      PUB = global.PUB, PST = global.PST, PDFX = global.PDFX, TBL = global.TBL;

  VW.registrar({
    id: 'pub-pdf', modulo: 'publicacoes', titulo: 'Importar PDF',
    descricao: 'Abra o Pilar 3, as demonstrações ou o 20-F e extraia os números direto do documento.',
    montar: function (node) {
      var local = {
        cnpj: null, fonte: 'pilar3', periodo: null,
        doc: null, candidatos: null, selecao: {}, carregando: false, progresso: '',
        termoBusca: ''
      };

      function render() {
        var atual = VW.novaGeracao(node);
        VW.blocoCarregando(node, 'Montando o escopo S1/S2…');
        bancos().then(function (lista) { if (atual()) pintar(lista); })
          .catch(function () { if (atual()) pintar([]); });
      }

      function bancos() {
        return VW.carregar({ naoGuardar: true }).then(function (ds) {
          return ds.rows.map(function (r) {
            return { cnpj: PST.normalizarCnpj(r.__id), nome: r.__nome, segmento: r.__segmento };
          });
        }).catch(function () {
          return PST.bancosComDados().map(function (b) {
            return { cnpj: b.cnpj, nome: b.nome, segmento: null };
          });
        });
      }

      function pintar(lista) {
        U.clear(node);

        node.appendChild(UI.nota('A leitura acontece inteiramente no seu navegador: o arquivo não ' +
          'sai do aparelho e não passa por servidor nenhum. O sistema reconstrói as linhas do PDF, ' +
          'acha os rótulos do catálogo e propõe os números daquela linha — você confere e lança. ' +
          'Documentos digitalizados como imagem não têm texto para ler e não funcionam aqui.'));

        if (!lista.length) {
          node.appendChild(UI.vazio('Nenhum banco no escopo',
            'Carregue um período no módulo IF.data para montar a lista de S1 e S2.'));
          return;
        }
        if (!local.cnpj || !lista.some(function (b) { return b.cnpj === local.cnpj; })) {
          local.cnpj = lista[0].cnpj;
        }
        if (!local.periodo) local.periodo = PUB.periodosDoEscopo(ST.estado.anoMes)[0];

        /* ---------------------- contexto do lançamento -------------------- */
        var barra = U.el('div', { class: 'filterbar' });
        barra.appendChild(UI.campo('Instituição', UI.seletor(
          lista.map(function (b) {
            return { value: b.cnpj, label: b.nome + (b.segmento ? '  (' + b.segmento + ')' : '') };
          }), local.cnpj, function (v) { local.cnpj = v; }, { style: 'min-width:250px;max-width:400px' }), 'grow'));
        barra.appendChild(UI.campo('Fonte', UI.seletor(
          PUB.FONTES.filter(function (f) { return !f.automatica; })
            .map(function (f) { return { value: f.id, label: f.nome }; }),
          local.fonte, function (v) { local.fonte = v; }, { style: 'max-width:320px' })));
        barra.appendChild(UI.campo('Trimestre', UI.seletor(
          PUB.periodosDoEscopo(ST.estado.anoMes).map(function (p) {
            return { value: p, label: U.periodLabel(p) };
          }), local.periodo, function (v) { local.periodo = v; })));
        node.appendChild(barra);

        /* --------------------------- o arquivo ---------------------------- */
        var entrada = U.el('input', { type: 'file', accept: '.pdf,application/pdf' });
        entrada.addEventListener('change', function () {
          var f = entrada.files && entrada.files[0];
          if (f) processar(f, lista);
        });

        var zona = U.el('div', {
          style: 'border:1px dashed var(--border-strong);border-radius:var(--r-md);' +
                 'padding:26px;text-align:center;color:var(--text-secondary);cursor:pointer',
          onclick: function () { entrada.click(); }
        }, [
          U.el('div', { style: 'font-size:14px;font-weight:600;color:var(--text-primary)',
                        text: 'Arraste o PDF aqui, ou toque para escolher' }),
          U.el('div', { class: 'small muted', style: 'margin-top:4px',
                        text: 'Pilar 3, demonstrações trimestrais ou 20-F' })
        ]);
        ['dragenter', 'dragover'].forEach(function (ev) {
          zona.addEventListener(ev, function (e) {
            e.preventDefault(); zona.style.borderColor = 'var(--accent)';
          });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
          zona.addEventListener(ev, function (e) {
            e.preventDefault(); zona.style.borderColor = 'var(--border-strong)';
          });
        });
        zona.addEventListener('drop', function (e) {
          var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) processar(f, lista);
        });

        var cArq = UI.card({ titulo: 'Documento',
          sub: local.doc ? local.doc.nome + ' · ' + local.doc.totalPaginas + ' páginas' : 'Nenhum aberto' });
        cArq.corpo.appendChild(U.el('div', { class: 'stack' }, [zona, entrada]));
        entrada.style.display = 'none';
        node.appendChild(cArq.node);

        if (local.carregando) {
          node.appendChild(UI.carregando(local.progresso || 'Lendo o documento…'));
          return;
        }
        if (local.erro) {
          node.appendChild(UI.nota('Não foi possível ler o PDF: ' + local.erro +
            ' Se o documento for digitalizado (imagem), não há texto para extrair — ' +
            'nesse caso o lançamento tem de ser manual.', 'bad'));
        }
        if (!local.candidatos) return;

        /* ------------------------- o que foi achado ------------------------ */
        var achados = local.candidatos;
        var selecionados = Object.keys(local.selecao).length;

        node.appendChild(VW.faixaStats([
          { label: 'Métricas reconhecidas', valor: U.fmt(achados.length, 0),
            nota: 'de ' + PUB.metricasProcuraveis().length + ' que o extrator procura' },
          { label: 'Selecionadas para lançar', valor: U.fmt(selecionados, 0),
            nota: 'confira cada uma antes de gravar' },
          { label: 'Páginas lidas', valor: U.fmt(local.doc.totalPaginas, 0), nota: local.doc.nome },
          local.periodoDetectado
            ? { label: 'Data-base detectada', valor: U.periodLabel(local.periodoDetectado),
                nota: local.periodoDetectado === local.periodo ? 'confere com o trimestre escolhido'
                                                              : 'diferente do trimestre escolhido' }
            : { label: 'Data-base', valor: '–', nota: 'não identificada no texto' }
        ]));

        if (!achados.length) {
          node.appendChild(UI.vazio('Nenhum rótulo do catálogo foi encontrado',
            'Use a busca livre abaixo para localizar o número pelo nome que este banco usa.'));
        }

        var cAch = UI.card({ titulo: 'Valores propostos',
          sub: 'Cada bloco mostra a linha de onde o número saiu. Toque no número correto — ' +
               'tabelas trazem vários trimestres na mesma linha.' });
        cAch.tools.appendChild(U.el('button', {
          class: 'btn btn--primary', text: 'Lançar ' + selecionados + ' selecionados',
          disabled: !selecionados, onclick: function () { lancar(lista); }
        }));

        achados.forEach(function (a) {
          var m = a.metrica;
          var escolha = local.selecao[m.id];
          var bloco = U.el('div', { class: 'div-item' + (escolha ? ' div-item--media' : ' div-item--baixa'),
                                    style: 'grid-template-columns:1fr' });
          bloco.appendChild(U.el('div', { class: 'row', style: 'justify-content:space-between' }, [
            U.el('div', {}, [
              U.el('span', { class: 'div-item__metrica', text: m.nome }),
              U.el('span', { class: 'familia-chip', style: 'margin-left:8px',
                text: (PUB.FAMILIAS.find(function (f) { return f.id === m.familia; }) || {}).nome })
            ]),
            escolha
              ? U.el('span', { class: 'div-item__valor' }, [
                  U.el('span', { class: 'div-item__gap',
                    text: U.fmt(escolha.valor, m.decimais) + ' ' + m.unidade }),
                  U.el('button', { class: 'btn btn--sm btn--ghost', text: 'limpar',
                    onclick: function () { delete local.selecao[m.id]; pintar(lista); } })
                ])
              : U.el('span', { class: 'small muted', text: 'nada escolhido' })
          ]));

          a.ocorrencias.forEach(function (oc) {
            var linha = U.el('div', { style: 'margin-top:8px' });
            linha.appendChild(U.el('div', { class: 'small muted',
              text: 'pág. ' + oc.pagina + ' · ' + U.truncate(oc.texto, 150) }));
            var chips = U.el('div', { class: 'row row--tight', style: 'margin-top:4px' });
            oc.numeros.forEach(function (n) {
              var ativo = escolha && escolha.valor === n.valor && escolha.pagina === oc.pagina;
              chips.appendChild(U.el('button', {
                class: 'btn btn--sm' + (ativo ? ' btn--primary' : ''),
                text: n.bruto,
                onclick: function () {
                  local.selecao[m.id] = { valor: n.valor, pagina: oc.pagina, texto: oc.texto };
                  pintar(lista);
                }
              }));
            });
            linha.appendChild(chips);
            bloco.appendChild(linha);
          });
          cAch.corpo.appendChild(bloco);
        });
        node.appendChild(cAch.node);

        /* --------------------------- busca livre --------------------------- */
        var cBusca = UI.card({ titulo: 'Busca livre no documento',
          sub: 'Para achar o número pelo nome que este banco usa, quando o rótulo não está no catálogo.' });
        var campo = U.el('input', { type: 'search', value: local.termoBusca,
          placeholder: 'ex.: razão de alavancagem', style: 'min-width:260px' });
        var saida = U.el('div', { style: 'margin-top:10px' });
        function buscar() {
          local.termoBusca = campo.value;
          U.clear(saida);
          var res = PDFX.procurar(local.doc, campo.value);
          if (!campo.value.trim()) return;
          if (!res.length) {
            saida.appendChild(U.el('div', { class: 'small muted', text: 'Nenhuma linha com esse termo.' }));
            return;
          }
          TBL.render(saida, {
            columns: [
              { key: 'pagina', label: 'Pág.', tipo: 'num', decimais: 0, largura: 60 },
              { key: 'texto', label: 'Linha', sticky: true, largura: 520 },
              { key: 'numeros', label: 'Números encontrados', largura: 240 }
            ],
            rows: res.map(function (r) {
              return { pagina: r.pagina, texto: r.texto,
                       numeros: r.numeros.map(function (n) { return n.bruto; }).join('   ') };
            }),
            busca: false, maxLinhas: 30, nomeArquivo: 'busca-pdf'
          });
        }
        campo.addEventListener('input', U.debounce(buscar, 220));
        cBusca.corpo.appendChild(U.el('div', { class: 'stack' }, [campo, saida]));
        if (local.termoBusca) buscar();
        node.appendChild(cBusca.node);
      }

      function processar(arquivo, lista) {
        local.carregando = true; local.erro = null;
        local.candidatos = null; local.selecao = {};
        local.progresso = 'Abrindo ' + arquivo.name + '…';
        pintar(lista);

        PDFX.lerDocumento(arquivo, function (n, total) {
          local.progresso = 'Lendo página ' + n + ' de ' + total + '…';
          var alvo = node.querySelector('.loading span');
          if (alvo) alvo.textContent = local.progresso;
        }).then(function (doc) {
          local.doc = doc;
          local.candidatos = PDFX.extrairCandidatos(doc);
          local.periodoDetectado = PDFX.detectarPeriodo(doc);
          if (local.periodoDetectado) local.periodo = local.periodoDetectado;
          local.carregando = false;
          pintar(lista);
          UI.toast(local.candidatos.length + ' métricas reconhecidas em ' + doc.totalPaginas + ' páginas.',
                   local.candidatos.length ? 'good' : 'warn');
        }).catch(function (e) {
          local.carregando = false;
          local.erro = (e && e.message) || String(e);
          pintar(lista);
        });
      }

      function lancar(lista) {
        var banco = lista.find(function (b) { return b.cnpj === local.cnpj; });
        var ok = 0, falhas = [];
        Object.keys(local.selecao).forEach(function (metricaId) {
          var esc = local.selecao[metricaId];
          var r = PST.registrar({
            cnpj: local.cnpj, banco: banco ? banco.nome : '',
            fonte: local.fonte, periodo: local.periodo, metrica: metricaId,
            valor: esc.valor,
            referencia: (local.doc ? local.doc.nome + ', ' : '') + 'pág. ' + esc.pagina
          });
          if (r.ok) ok++; else falhas.push(metricaId + ': ' + r.motivo);
        });
        UI.toast(ok + ' valores lançados' + (falhas.length ? ', ' + falhas.length + ' recusados.' : '.'),
                 falhas.length ? 'warn' : 'good');
        if (falhas.length) console.warn(falhas.join('\n'));
        local.selecao = {};
        pintar(lista);
      }

      render();
      return { atualizar: render };
    }
  });
})(window);
