/* pdf-extract.js — leitura de PDF no próprio navegador.
   Namespace global `PDFX`.

   O que faz: reconstrói as linhas do documento a partir das posições do texto,
   acha os números de cada linha e propõe, para cada métrica do catálogo, os
   valores encontrados ao lado de um rótulo conhecido.

   O que NÃO faz, de propósito: gravar sozinho. A extração propõe; quem lança é
   o analista, depois de ver a linha de onde o número saiu. Num banco, um número
   sem rastro não vale nada. */
(function (global) {
  'use strict';
  var U = global.U;

  /* Um import() dentro de script clássico resolve o caminho contra a URL do
     PRÓPRIO script, não da página — e este arquivo mora em assets/js/, o que
     produziria assets/js/assets/vendor/... Resolver contra document.baseURI dá
     uma URL absoluta e correta tanto na raiz quanto servido de uma subpasta. */
  function caminhoLib() {
    return new URL('assets/vendor/pdfjs/', document.baseURI).href;
  }

  var lib = null;

  /** Carrega o pdf.js embutido sob demanda (são ~1,8 MB). */
  function carregarLib() {
    if (lib) return Promise.resolve(lib);
    var base = caminhoLib();
    return import(base + 'pdf.min.mjs').then(function (mod) {
      mod.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      lib = mod;
      return lib;
    }).catch(function (e) {
      throw new Error('o leitor de PDF não pôde ser carregado de ' + base +
        ' (' + ((e && e.message) || e) + ').');
    });
  }

  function disponivel() {
    return typeof fetch === 'function' && typeof Promise !== 'undefined';
  }

  /* ------------------------- números em pt-BR --------------------------- */

  /* Aceita 1.234.567,89 · 15,80 · (1.234) negativo entre parênteses ·
     sinal antes ou depois · % e R$ colados. Rejeita datas e sequências que
     são claramente identificadores (CNPJ, códigos de conta). */
  var RE_NUMERO = /\(?-?\s?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s?\)?%?/g;

  function interpretar(bruto) {
    var t = String(bruto).trim();
    var negativo = /^\(.*\)$/.test(t) || /^-/.test(t);
    var limpo = t.replace(/[()%\s-]/g, '');
    if (!limpo) return null;
    var n;
    if (/,/.test(limpo)) n = Number(limpo.replace(/\./g, '').replace(',', '.'));
    else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) n = Number(limpo.replace(/\./g, ''));
    else n = Number(limpo);
    if (!isFinite(n)) return null;
    return negativo ? -n : n;
  }

  /* Sequências que têm dígitos mas não são medida. Ficam mascaradas por espaços
     do mesmo tamanho, para que as posições do resto da linha não se desloquem. */
  var RUIDO = [
    /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g,      // CNPJ
    /\d{3}\.\d{3}\.\d{3}-\d{2}/g,               // CPF
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,                // data
    /\b\d{1,2}\s*:\s*\d{2}\b/g,                 // hora
    /\([^)]*[A-Za-zÀ-ÿ][^)]*\)/g                  // "(1 dia, 99%)", "(12 meses)", "(CET1)"
  ];

  /* O último padrão não engole "(4.820.000)": parêntese só com dígitos é a
     notação contábil de negativo, e continua sendo lido como número. */

  function mascararRuido(texto) {
    var t = texto;
    RUIDO.forEach(function (re) {
      t = t.replace(re, function (achado) { return new Array(achado.length + 1).join(' '); });
    });
    return t;
  }

  /** Números de uma linha, com a posição em que aparecem. */
  function numerosDaLinha(textoOriginal) {
    var texto = mascararRuido(textoOriginal);
    var saida = [];
    var m;
    RE_NUMERO.lastIndex = 0;
    while ((m = RE_NUMERO.exec(texto)) !== null) {
      var bruto = m[0].trim();
      if (!/\d/.test(bruto)) continue;
      var v = interpretar(bruto);
      if (v === null) continue;
      // descarta o que quase certamente é identificador, não medida
      var soDigitos = bruto.replace(/\D/g, '');
      if (soDigitos.length >= 11 && !/[,.]/.test(bruto)) continue;
      saida.push({ bruto: bruto, valor: v, inicio: m.index, percentual: /%/.test(bruto) });
    }
    return saida;
  }

  /* ------------------------ leitura do documento ------------------------ */

  /**
   * Abre o PDF e devolve as páginas com as linhas reconstruídas.
   * As linhas vêm do agrupamento dos fragmentos de texto por coordenada
   * vertical: é o que transforma uma tabela em algo pesquisável.
   */
  function lerDocumento(arquivo, onProgresso) {
    return carregarLib().then(function (pdfjs) {
      return arquivo.arrayBuffer().then(function (buf) {
        return pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      });
    }).then(function (doc) {
      var paginas = [];
      function proxima(n) {
        if (n > doc.numPages) return Promise.resolve(paginas);
        if (onProgresso) onProgresso(n, doc.numPages);
        return doc.getPage(n)
          .then(function (pg) { return pg.getTextContent(); })
          .then(function (conteudo) {
            paginas.push({ numero: n, linhas: montarLinhas(conteudo.items) });
            return proxima(n + 1);
          });
      }
      return proxima(1).then(function () {
        return { nome: arquivo.name, paginas: paginas, totalPaginas: doc.numPages };
      });
    });
  }

  function montarLinhas(itens) {
    var porY = new Map();
    itens.forEach(function (it) {
      var s = String(it.str == null ? '' : it.str);
      if (!s.trim()) return;
      var x = it.transform[4], y = it.transform[5];
      var chave = Math.round(y / 3);           // tolerância vertical
      if (!porY.has(chave)) porY.set(chave, []);
      porY.get(chave).push({ str: s, x: x, largura: it.width || 0 });
    });

    var linhas = [];
    Array.from(porY.entries())
      .sort(function (a, b) { return b[0] - a[0]; })   // de cima para baixo
      .forEach(function (par) {
        var pedacos = par[1].sort(function (a, b) { return a.x - b.x; });
        var texto = '', anterior = null;
        pedacos.forEach(function (p) {
          if (anterior && p.x - (anterior.x + anterior.largura) > 1.2) texto += '  ';
          else if (anterior && !/\s$/.test(texto) && !/^\s/.test(p.str)) texto += '';
          texto += p.str;
          anterior = p;
        });
        texto = texto.replace(/\s{3,}/g, '  ').trim();
        if (texto) linhas.push({ y: par[0] * 3, texto: texto });
      });
    return linhas;
  }

  /* --------------------- data-base dentro do texto ---------------------- */

  var MESES = { janeiro: 3, marco: 3, mar: 3, junho: 6, jun: 6,
                setembro: 9, set: 9, dezembro: 12, dez: 12 };

  /** Tenta descobrir a data-base do documento pelo próprio texto. */
  function detectarPeriodo(doc) {
    var amostra = [];
    doc.paginas.slice(0, 4).forEach(function (p) {
      p.linhas.slice(0, 40).forEach(function (l) { amostra.push(U.norm(l.texto)); });
    });
    var texto = amostra.join(' | ');

    var m = texto.match(/(?:30|31)\s+de\s+(marco|junho|setembro|dezembro)\s+de\s+(\d{4})/);
    if (m) return String(m[2]) + String(MESES[m[1]]).padStart(2, '0');

    m = texto.match(/([1-4])\s*t\s*(\d{2,4})/);
    if (m) {
      var ano = m[2].length === 2 ? '20' + m[2] : m[2];
      return ano + String(Number(m[1]) * 3).padStart(2, '0');
    }
    m = texto.match(/(mar|jun|set|dez)[a-z]*\s*\/?\s*(\d{2,4})/);
    if (m) {
      var a = m[2].length === 2 ? '20' + m[2] : m[2];
      return a + String(MESES[m[1]]).padStart(2, '0');
    }
    return null;
  }

  /* --------------------------- candidatos ------------------------------- */

  /**
   * Para cada métrica com rótulo conhecido, procura linhas que o contenham e
   * devolve os números daquela linha como candidatos.
   * `limiteLinha` evita propor a partir de linhas longas demais, que costumam
   * ser texto corrido e não tabela.
   */
  function extrairCandidatos(doc, opcoes) {
    var o = opcoes || {};
    var metricas = global.PUB.metricasProcuraveis();
    var limiteLinha = o.limiteLinha || 220;
    var porMetrica = new Map();

    doc.paginas.forEach(function (pg) {
      pg.linhas.forEach(function (linha) {
        if (linha.texto.length > limiteLinha) return;
        var norm = U.norm(linha.texto);

        /* Rótulos se contêm: "capital principal" casa também com a linha
           "índice de capital principal". Fica só a métrica cujo rótulo casou
           mais longo — o mais específico é o que descreve aquela linha. */
        var casados = [];
        metricas.forEach(function (m) {
          var melhor = null;
          m.rotulos.forEach(function (r) {
            if (norm.indexOf(r) >= 0 && (!melhor || r.length > melhor.length)) melhor = r;
          });
          if (melhor) casados.push({ metrica: m, rotulo: melhor });
        });
        if (!casados.length) return;
        var maior = Math.max.apply(null, casados.map(function (c) { return c.rotulo.length; }));
        casados = casados.filter(function (c) { return c.rotulo.length === maior; });

        var numeros = numerosDaLinha(linha.texto);
        if (!numeros.length) return;

        casados.forEach(function (c) {
          /* Números depois do rótulo vêm primeiro — numa tabela é ali que está
             o valor da linha. Os anteriores entram no fim em vez de sumirem: em
             texto corrido ("2 exceções de backtesting em 250 dias") o número
             certo é justamente o que vem antes. */
          var pos = norm.indexOf(c.rotulo);
          var depois = numeros.filter(function (n) { return n.inicio >= pos; });
          var antes = numeros.filter(function (n) { return n.inicio < pos; });
          if (!porMetrica.has(c.metrica.id)) {
            porMetrica.set(c.metrica.id, { metrica: c.metrica, ocorrencias: [] });
          }
          var alvo = porMetrica.get(c.metrica.id);
          if (alvo.ocorrencias.length < 6) {
            alvo.ocorrencias.push({
              pagina: pg.numero, texto: linha.texto, rotulo: c.rotulo,
              numeros: depois.concat(antes).slice(0, 8)
            });
          }
        });
      });
    });

    var fam = global.PUB.FAMILIAS.map(function (f) { return f.id; });
    return Array.from(porMetrica.values()).sort(function (a, b) {
      return fam.indexOf(a.metrica.familia) - fam.indexOf(b.metrica.familia);
    });
  }

  /** Busca livre: linhas que contenham o termo, com os números que trazem. */
  function procurar(doc, termo) {
    var q = U.norm(termo);
    if (q.length < 3) return [];
    var saida = [];
    doc.paginas.forEach(function (pg) {
      pg.linhas.forEach(function (linha) {
        if (U.norm(linha.texto).indexOf(q) < 0) return;
        saida.push({ pagina: pg.numero, texto: linha.texto, numeros: numerosDaLinha(linha.texto) });
      });
    });
    return saida.slice(0, 60);
  }

  global.PDFX = {
    disponivel: disponivel, carregarLib: carregarLib, lerDocumento: lerDocumento,
    numerosDaLinha: numerosDaLinha, interpretar: interpretar,
    detectarPeriodo: detectarPeriodo, extrairCandidatos: extrairCandidatos, procurar: procurar
  };
})(window);
