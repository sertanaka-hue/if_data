/* api.js — cliente da API Olinda/OData do IF.data (Banco Central do Brasil).
   Expõe o namespace global `API`.

   Endpoints usados (v1):
     ListaDeRelatorio
     IfDataCadastro(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao)
     IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)

   O formato de `IfDataValores` varia entre relatórios/períodos: às vezes vem
   "largo" (uma linha por instituição, uma coluna por conta) e às vezes vem
   "longo" (uma linha por conta). O cliente detecta a forma e normaliza para
   largo — todo o resto do sistema consome só o formato largo. */
(function (global) {
  'use strict';
  var U = global.U;

  var BASE_PADRAO = 'https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata';
  var PAGE = 5000;
  var MAX_PAGES = 12;

  var state = {
    base: BASE_PADRAO,
    modo: 'auto',            // 'auto' | 'live' | 'demo'
    demoAtivo: false,
    timeoutMs: 45000,
    modoLeitura: null,             // 'unico' | 'paginado' — descoberto na 1ª leitura
    erroLeituraUnica: null,
    assinaturaCadastro: null,      // índice da assinatura do cadastro que funcionou
    cadastroIndisponivel: false,   // desistência registrada, para não insistir
    erroCadastro: null,
    ultimoDiagnostico: null
  };

  var memCache = new Map();
  /* Promessas em voo. Sem isto, duas telas que carregam ao mesmo tempo sondam o
     cadastro em paralelo — nenhuma vê a desistência da outra e o número de
     requisições dobra a cada tela aberta. */
  var pendentes = new Map();
  var listeners = [];

  function on(fn) { listeners.push(fn); }
  function emit(ev) { listeners.forEach(function (fn) { try { fn(ev); } catch (e) {} }); }

  /* ------------------------- persistência leve ----------------------- */

  var LS_PREFIX = 'ifdata.cache.';
  function lsGet(key) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.t || Date.now() - obj.t > 1000 * 60 * 60 * 24 * 14) return null;
      return obj.v;
    } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); }
    catch (e) { podarCache(); }
  }
  function podarCache() {
    try {
      var chaves = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) chaves.push(k);
      }
      chaves.slice(0, Math.ceil(chaves.length / 2)).forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  function limparCache() {
    memCache.clear();
    pendentes.clear();
    state.cadastroIndisponivel = false;
    state.erroCadastro = null;
    state.assinaturaCadastro = null;
    state.modoLeitura = null;
    podarCache(); podarCache();
    emit({ tipo: 'cache-limpo' });
  }

  /* ------------------------------ HTTP -------------------------------- */

  function comFormato(url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + '$format=json';
  }

  function getJSON(url, tentativa, timeoutMs, semRetentativa) {
    var t = tentativa || 0;
    var limite = timeoutMs || state.timeoutMs;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, limite) : null;
    return fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit',
                        signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) {
          // O Olinda explica no corpo da resposta o que recusou ("parâmetro
          // inválido", "obrigatório"...). Descartar isso é jogar fora a única
          // pista útil de um 400.
          return r.text().catch(function () { return ''; }).then(function (corpo) {
            var err = new Error('HTTP ' + r.status + ' ' + r.statusText +
              (corpo ? ' — ' + String(corpo).replace(/\s+/g, ' ').trim().slice(0, 300) : ''));
            err.status = r.status;
            err.corpo = corpo;
            throw err;
          });
        }
        return r.json();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        // 5xx e timeouts merecem várias tentativas. Um 4xx é recusa do
        // servidor ao próprio pedido: repetir só gasta tempo. Falha de rede ou
        // CORS raramente melhora, mas ganha uma segunda chance curta.
        var maxTentativas = semRetentativa ? 0
                          : (e.status >= 500 || e.name === 'AbortError') ? 3
                          : (e.status >= 400 && e.status < 500) ? 0 : 1;
        if (t < maxTentativas) {
          var espera = Math.pow(2, t) * 700;
          return new Promise(function (res) { setTimeout(res, espera); })
            .then(function () { return getJSON(url, t + 1, timeoutMs, semRetentativa); });
        }
        e.url = url;
        throw e;
      });
  }

  /**
   * Lê um recurso OData inteiro.
   *
   * A paginação por $skip é o parâmetro que serviços do Olinda mais recusam —
   * e recusam com 500, não com uma mensagem clara. Por isso a leitura tenta
   * primeiro um pedido único com $top alto e SEM $skip; só se isso falhar (ou
   * se vier cheio, sinal de que há mais páginas) é que entra a paginação.
   * O modo que funcionou fica guardado na sessão.
   */
  var TETO = 10000;

  function urlCom(url, params) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + params;
  }

  function paginar(url, inicio, acumulado, p) {
    var u = urlCom(url, '$top=' + PAGE + '&$skip=' + inicio + '&$format=json');
    return getJSON(u).then(function (json) {
      var v = (json && json.value) || [];
      var total = acumulado.concat(v);
      if (v.length === PAGE && p + 1 < MAX_PAGES) return paginar(url, inicio + PAGE, total, p + 1);
      return total;
    });
  }

  function getTodos(url) {
    if (state.modoLeitura === 'paginado') return paginar(url, 0, [], 0);

    return getJSON(urlCom(url, '$top=' + TETO + '&$format=json'))
      .then(function (json) {
        var v = (json && json.value) || [];
        state.modoLeitura = 'unico';
        // veio no teto: pode haver mais, então completa paginando a partir daí
        if (v.length >= TETO) return paginar(url, v.length, v, 1);
        return v;
      })
      .catch(function (e) {
        // o serviço recusou o pedido único; a partir daqui a sessão usa paginação
        state.modoLeitura = 'paginado';
        state.erroLeituraUnica = (e && e.message) || String(e);
        return paginar(url, 0, [], 0);
      });
  }

  /* -------------------- normalização do retorno ----------------------- */

  /* chaves que identificam a instituição / o contexto — não são "dados" */
  var META_KEYS = [
    'codinst', 'cnpj', 'nomeinstituicao', 'instituicao', 'nome', 'nomerelatorio',
    'anomes', 'data', 'datadoc', 'tipoinstituicao', 'relatorio',
    'tcb', 'tc', 'td', 'ti', 'tp', 'sr', 'segmento', 'cidade', 'uf', 'municipio',
    'conglomerado', 'situacao', 'consolidado', 'verbete', 'codigo'
  ];
  function isMeta(key) { return META_KEYS.indexOf(U.norm(key).replace(/ /g, '')) >= 0; }

  function acharChave(obj, candidatos) {
    var chaves = Object.keys(obj);
    for (var i = 0; i < candidatos.length; i++) {
      var alvo = U.norm(candidatos[i]);
      for (var j = 0; j < chaves.length; j++) {
        if (U.norm(chaves[j]) === alvo) return chaves[j];
      }
    }
    return null;
  }

  /** "C0000001", "60746948", "" — texto sem nada que pareça um nome. */
  function pareceCodigo(v) {
    var t = String(v == null ? '' : v).trim();
    return !t || /^[A-Za-z]{0,3}[\d.\-\/\s]+$/.test(t);
  }

  /** Detecta se o retorno é "longo" (uma linha por conta) e devolve as chaves. */
  function detectarFormaLonga(amostra) {
    var kCol = acharChave(amostra, ['NomeColunaTraduzido', 'NomeColuna', 'Coluna', 'Conta',
                                    'NomeConta', 'Descricao', 'Rubrica']);
    var kVal = acharChave(amostra, ['Saldo', 'Valor', 'Montante', 'Vlr', 'SaldoAtual']);
    return kCol && kVal ? { coluna: kCol, valor: kVal } : null;
  }

  function chaveInstituicao(amostra) {
    return acharChave(amostra, ['CodInst', 'Codigo', 'Cnpj', 'CNPJ', 'NomeInstituicao', 'Instituicao'])
        || Object.keys(amostra)[0];
  }
  function chaveNome(amostra) {
    return acharChave(amostra, ['NomeInstituicao', 'Instituicao', 'Nome', 'NomeConglomerado']);
  }

  /** Converte o retorno bruto em { rows, columns, meta }. */
  function normalizar(brutas, ctx) {
    if (!brutas || !brutas.length) {
      return { rows: [], columns: [], metaColumns: [], forma: 'vazio', bruto: null };
    }
    var amostra = brutas[0];
    var longa = detectarFormaLonga(amostra);
    var kInst = chaveInstituicao(amostra);
    var kNome = chaveNome(amostra);
    var rows, columns;

    if (longa) {
      var porInst = new Map();
      var ordemCol = [];
      var vistas = {};
      brutas.forEach(function (b) {
        var id = String(b[kInst] == null ? '' : b[kInst]);
        if (!porInst.has(id)) {
          var base = {};
          Object.keys(b).forEach(function (k) {
            if (k !== longa.coluna && k !== longa.valor && isMeta(k)) base[k] = b[k];
          });
          porInst.set(id, base);
        }
        var alvo = porInst.get(id);
        var nomeCol = String(b[longa.coluna]);
        if (!vistas[nomeCol]) { vistas[nomeCol] = true; ordemCol.push(nomeCol); }
        var v = U.toNumber(b[longa.valor]);
        alvo[nomeCol] = v === null ? b[longa.valor] : v;
      });
      rows = Array.from(porInst.values());
      columns = ordemCol;
    } else {
      rows = brutas.map(function (b) {
        var r = {};
        Object.keys(b).forEach(function (k) {
          if (k.charAt(0) === '@') return;
          var v = b[k];
          if (isMeta(k)) { r[k] = v; return; }
          var n = U.toNumber(v);
          r[k] = n === null ? v : n;
        });
        return r;
      });
      columns = Object.keys(rows[0] || {}).filter(function (k) { return !isMeta(k); });
      // mantém apenas colunas com ao menos um número — o resto vira metadado
      var numericas = columns.filter(function (c) {
        return rows.some(function (r) { return U.isNum(r[c]); });
      });
      if (numericas.length) columns = numericas;
    }

    var metaColumns = Object.keys(rows[0] || {}).filter(function (k) {
      return columns.indexOf(k) < 0;
    });

    rows.forEach(function (r, i) {
      r.__id = String(r[kInst] != null ? r[kInst] : (kNome && r[kNome]) || ('lin' + i));
      r.__nome = String((kNome && r[kNome]) || r[kInst] || ('Instituição ' + (i + 1)));
      r.__anoMes = ctx.anoMes;
      r.__tipo = ctx.tipo;
    });

    return {
      rows: rows, columns: columns, metaColumns: metaColumns,
      forma: longa ? 'longa→larga' : 'larga',
      chaveInst: kInst, chaveNome: kNome,
      bruto: amostra
    };
  }

  /* ---------------------------- endpoints ------------------------------ */

  function urlValores(anoMes, tipo, relatorio) {
    return state.base +
      "/IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)" +
      "?@AnoMes=" + encodeURIComponent(anoMes) +
      "&@TipoInstituicao=" + encodeURIComponent(tipo) +
      "&@Relatorio=" + encodeURIComponent("'" + relatorio + "'");
  }
  function urlCadastro(anoMes, tipo, tipoComAspas) {
    var valorTipo = tipoComAspas ? "'" + tipo + "'" : String(tipo);
    return state.base +
      "/IfDataCadastro(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao)" +
      "?@AnoMes=" + encodeURIComponent(anoMes) +
      "&@TipoInstituicao=" + encodeURIComponent(valorTipo);
  }

  /** Lista de relatórios: tenta as formas conhecidas do endpoint. */
  function listaRelatorios(anoMes, tipo) {
    var chave = 'rel.' + anoMes + '.' + tipo;
    if (memCache.has(chave)) return Promise.resolve(memCache.get(chave));
    var doLs = lsGet(chave);
    if (doLs) { memCache.set(chave, doLs); return Promise.resolve(doLs); }

    if (state.demoAtivo) {
      var d = global.DEMO.relatorios();
      memCache.set(chave, d);
      return Promise.resolve(d);
    }

    var tentativas = [
      state.base + '/ListaDeRelatorio(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao)' +
        '?@AnoMes=' + anoMes + '&@TipoInstituicao=' + tipo,
      state.base + '/ListaDeRelatorio',
      state.base + '/ListaDeRelatorios'
    ];

    function tentar(i) {
      if (i >= tentativas.length) {
        var fb = global.CAT.RELATORIOS_FALLBACK.map(function (r) {
          return { id: r.id, nome: r.nome, origem: 'fallback' };
        });
        emit({ tipo: 'aviso', msg: 'Lista de relatórios não pôde ser descoberta na API; usando catálogo interno.' });
        return Promise.resolve(fb);
      }
      var alvo = tentativas[i];
      var sep = alvo.indexOf('?') >= 0 ? '&' : '?';
      return getJSON(comFormato(alvo + sep + '$top=500'))
        .catch(function () { return getJSON(comFormato(alvo)); })
        .then(function (json) {
          var v = (json && json.value) || [];
          if (!v.length) throw new Error('vazio');
          var kId = acharChave(v[0], ['Relatorio', 'CodigoRelatorio', 'Codigo', 'Id', 'NumeroRelatorio']);
          var kNome = acharChave(v[0], ['NomeRelatorio', 'Nome', 'Descricao', 'Titulo']);
          var out = v.map(function (r) {
            return {
              id: String(r[kId] != null ? r[kId] : r[kNome]),
              nome: String(r[kNome] != null ? r[kNome] : r[kId]),
              origem: 'api'
            };
          }).filter(function (r) { return r.id && r.id !== 'undefined'; });
          if (!out.length) throw new Error('sem id');
          return out;
        })
        .catch(function () { return tentar(i + 1); });
    }

    return tentar(0).then(function (out) {
      memCache.set(chave, out);
      if (out[0] && out[0].origem === 'api') lsSet(chave, out);
      return out;
    });
  }

  /**
   * O IfDataCadastro recusou (HTTP 400) a assinatura documentada, e sem acesso
   * à API não dá para saber qual variante ele aceita. Em vez de apostar numa,
   * enumeramos as plausíveis e usamos a primeira que responder com dados — a
   * escolha fica guardada na sessão para não repetir a busca a cada período.
   */
  function candidatosCadastro(anoMes, tipo) {
    var raiz = state.base + '/IfDataCadastro';
    var aspas = function (v) { return "'" + v + "'"; };
    var lista = [];

    // A documentação do BCB exemplifica o cadastro SÓ com AnoMes — essa vem primeiro.
    lista.push({ rotulo: 'somente AnoMes',
      url: raiz + '(AnoMes=@AnoMes)?@AnoMes=' + encodeURIComponent(anoMes) });
    lista.push({ rotulo: "somente AnoMes entre aspas",
      url: raiz + '(AnoMes=@AnoMes)?@AnoMes=' + encodeURIComponent(aspas(anoMes)) });

    var assinatura = '(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao)';
    [[String(anoMes), String(tipo)],
     [String(anoMes), aspas(tipo)],
     [aspas(anoMes), String(tipo)],
     [aspas(anoMes), aspas(tipo)]].forEach(function (par) {
      lista.push({
        rotulo: 'AnoMes=' + par[0] + ', TipoInstituicao=' + par[1],
        url: raiz + assinatura + '?@AnoMes=' + encodeURIComponent(par[0]) +
             '&@TipoInstituicao=' + encodeURIComponent(par[1])
      });
    });

    lista.push({ rotulo: 'sem parâmetros', url: raiz });
    return lista;
  }

  /* Cada assinatura é tentada em três modos de leitura, do mais simples ao mais
     exigente: serviços do Olinda às vezes aceitam a consulta mas recusam $skip,
     e pedir paginação de saída transformava uma assinatura boa em erro 400. */
  function lerCadastro(url) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var simples = url + sep + '$format=json';
    var comTop = url + sep + '$top=10000&$format=json';
    function valores(json) { return (json && json.value) || []; }
    return getJSON(simples, 0, 25000).then(valores)
      .catch(function () { return getJSON(comTop, 0, 25000).then(valores); })
      .catch(function () { return getTodos(url); });
  }

  /**
   * Testa formatos de consulta ao IfDataValores e devolve o que o servidor
   * respondeu a cada um. É o que transforma "erro desconhecido" em diagnóstico.
   */
  function sondarValores(anoMes, tipo, relatorio) {
    var raiz = state.base + '/IfDataValores(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao,Relatorio=@Relatorio)';
    function alvo(rel, ano) {
      return raiz + '?@AnoMes=' + encodeURIComponent(ano) +
             '&@TipoInstituicao=' + encodeURIComponent(tipo) +
             '&@Relatorio=' + encodeURIComponent(rel);
    }
    var comAspas = "'" + relatorio + "'";
    var base = alvo(comAspas, anoMes);
    var candidatos = [
      { rotulo: 'sem paginação', url: urlCom(base, '$top=1&$format=json') },
      { rotulo: 'com $top apenas', url: urlCom(base, '$top=100&$format=json') },
      { rotulo: 'com $top e $skip (paginado)', url: urlCom(base, '$top=100&$skip=0&$format=json') },
      { rotulo: 'sem nenhum parâmetro de leitura', url: urlCom(base, '$format=json') },
      { rotulo: 'Relatorio sem aspas', url: urlCom(alvo(relatorio, anoMes), '$top=1&$format=json') },
      { rotulo: 'AnoMes entre aspas', url: urlCom(alvo(comAspas, "'" + anoMes + "'"), '$top=1&$format=json') }
    ];

    var resultados = [];
    function passo(i) {
      if (i >= candidatos.length) return Promise.resolve(resultados);
      var c = candidatos[i];
      return getJSON(c.url, 0, 20000, true).then(function (json) {
        var v = (json && json.value) || [];
        resultados.push({ rotulo: c.rotulo, url: c.url, ok: true, registros: v.length,
                          chaves: v[0] ? Object.keys(v[0]) : [] });
      }).catch(function (e) {
        resultados.push({ rotulo: c.rotulo, url: c.url, ok: false,
                          erro: (e && e.message) || String(e) });
      }).then(function () { return passo(i + 1); });
    }
    return passo(0);
  }

  /** Testa cada assinatura com $top=1 e devolve o que cada uma respondeu. */
  function sondarCadastro(anoMes, tipo) {
    var candidatos = candidatosCadastro(anoMes, tipo);
    var resultados = [];
    function passo(i) {
      if (i >= candidatos.length) return Promise.resolve(resultados);
      var c = candidatos[i];
      var url = c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + '$format=json';
      return getJSON(url, 0, 20000).then(function (json) {
        var v = (json && json.value) || [];
        resultados.push({ rotulo: c.rotulo, url: url, ok: true, registros: v.length,
                          chaves: v[0] ? Object.keys(v[0]) : [], exemplo: v[0] || null });
      }).catch(function (e) {
        resultados.push({ rotulo: c.rotulo, url: url, ok: false,
                          erro: (e && e.message) || String(e) });
      }).then(function () { return passo(i + 1); });
    }
    return passo(0);
  }

  /** Cadastro (instituições) de um período.
      O parâmetro TipoInstituicao aparece ora numérico, ora entre aspas, conforme
      o serviço — em vez de apostar numa forma, tentamos as duas. */
  function cadastro(anoMes, tipo) {
    var chave = 'cad.' + anoMes + '.' + tipo;
    if (memCache.has(chave)) return Promise.resolve(memCache.get(chave));
    if (pendentes.has(chave)) return pendentes.get(chave);
    if (state.demoAtivo) {
      var d = global.DEMO.cadastro(anoMes, tipo);
      memCache.set(chave, d);
      return Promise.resolve(d);
    }

    /* Desistir é parte do contrato. Quando nenhuma assinatura respondeu, repetir
       a sondagem a cada período transforma uma série de doze trimestres em
       centenas de requisições — e um serviço que já estava recusando passa a
       devolver 500 por excesso. Uma vez que não deu, não insiste até que o
       usuário peça "Atualizar" (que limpa o cache e estas marcas). */
    if (state.cadastroIndisponivel) {
      return Promise.reject(new Error('IfDataCadastro indisponível nesta sessão' +
        (state.erroCadastro ? ': ' + state.erroCadastro : '')));
    }

    var todos = candidatosCadastro(anoMes, tipo);
    // assinatura já descoberta: vai direto nela, sem sondar de novo
    var candidatos = U.isNum(state.assinaturaCadastro)
      ? [todos[state.assinaturaCadastro]]
      : todos;

    function tentar(i, ultimoErro) {
      if (i >= candidatos.length) {
        if (!U.isNum(state.assinaturaCadastro)) {
          state.cadastroIndisponivel = true;
          state.erroCadastro = (ultimoErro && ultimoErro.message) || 'nenhuma assinatura respondeu';
        }
        throw (ultimoErro || new Error('nenhuma assinatura do IfDataCadastro respondeu'));
      }
      var c = candidatos[i];
      /* Um pedido só por assinatura, sem paginação e sem retentativa: a
         paginação é justamente o que vários recursos do Olinda recusam, e
         repetir um 500 durante a sondagem só multiplica a carga. */
      var url = c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + '$format=json';
      return getJSON(url, 0, 25000, true)
        .then(function (json) {
          var v = (json && json.value) || [];
          if (!v.length) throw new Error('resposta vazia');
          memCache.set(chave, v);
          state.urlCadastroUsada = c.url;
          state.assinaturaCadastro = todos.findIndex(function (x) { return x.rotulo === c.rotulo; });
          state.cadastroIndisponivel = false;
          state.erroCadastro = null;
          return v;
        })
        .catch(function (e) { return tentar(i + 1, e); });
    }

    var promessa = Promise.resolve().then(function () { return tentar(0, null); });
    pendentes.set(chave, promessa);
    promessa.catch(function () {}).then(function () { pendentes.delete(chave); });
    return promessa;
  }

  /**
   * Valores de um relatório, já normalizados para o formato largo.
   * @returns Promise<{rows, columns, metaColumns, forma, ...}>
   */
  function valores(anoMes, tipo, relatorio) {
    var chave = 'val.' + anoMes + '.' + tipo + '.' + relatorio;
    if (memCache.has(chave)) return Promise.resolve(memCache.get(chave));

    var ctx = { anoMes: String(anoMes), tipo: tipo, relatorio: relatorio };

    if (state.demoAtivo) {
      var dados = normalizar(global.DEMO.valores(anoMes, tipo, relatorio), ctx);
      dados.demo = true;
      return enriquecerComCadastro(dados, anoMes, tipo).then(function (d) {
        memCache.set(chave, d);
        return d;
      });
    }

    emit({ tipo: 'buscando', chave: chave });
    return getTodos(urlValores(anoMes, tipo, relatorio))
      .then(function (brutas) {
        var dados = normalizar(brutas, ctx);
        dados.url = urlValores(anoMes, tipo, relatorio);
        dados.nBrutas = brutas.length;
        return enriquecerComCadastro(dados, anoMes, tipo);
      })
      .then(function (dados) {
        state.ultimoDiagnostico = {
          url: dados.url, forma: dados.forma, linhas: dados.rows.length,
          colunas: dados.columns.length, amostra: dados.bruto,
          cadastro: dados.cadastro || null, quando: new Date().toISOString()
        };
        memCache.set(chave, dados);
        emit({ tipo: 'ok', chave: chave, dados: dados });
        return dados;
      })
      .catch(function (e) {
        emit({ tipo: 'erro', chave: chave, erro: e });
        throw e;
      });
  }

  /* Campos de identificação que o cadastro pode completar quando o relatório de
     valores só traz o código da instituição. */
  var CAMPOS_CADASTRO = ['NomeInstituicao', 'Instituicao', 'Nome', 'NomeConglomerado',
                         'RazaoSocial', 'Cnpj', 'UF', 'Cidade', 'Municipio',
                         'SR', 'Segmento', 'TCB', 'TC', 'TD'];

  /**
   * O IfDataValores identifica a instituição só pelo código; os nomes (e a UF, a
   * cidade e o segmento) moram no IfDataCadastro. Esta função cruza os dois pelo
   * código e completa o que falta — silenciosamente, se o cadastro não responder.
   */
  function enriquecerComCadastro(dados, anoMes, tipo) {
    if (!dados.rows.length) return Promise.resolve(dados);
    var url = urlCadastro(anoMes, tipo);

    /* O cruzamento roda SEMPRE que há linhas: o cadastro é a fonte oficial do
       nome da instituição, então ele vence o que porventura tenha vindo no
       relatório de valores. E o resultado é sempre registrado em dados.cadastro
       — inclusive quando falha — para que o Diagnóstico diga a verdade em vez
       de sugerir que estava tudo bem. */
    // Promise.resolve() garante que até uma exceção síncrona caia no .catch
    // abaixo, em vez de derrubar a consulta inteira de valores.
    return Promise.resolve().then(function () {
      return cadastro(anoMes, tipo);
    }).then(function (lista) {
      if (!lista || !lista.length) {
        dados.cadastro = { status: 'vazio', url: url,
          detalhe: 'O IfDataCadastro respondeu sem nenhuma instituição para este período e tipo.' };
        return dados;
      }
      var amostra = lista[0];
      var kId = acharChave(amostra, ['CodInst', 'Codigo', 'Cnpj', 'CNPJ']);
      var kNome = acharChave(amostra, ['NomeInstituicao', 'Instituicao', 'Nome',
                                       'NomeConglomerado', 'RazaoSocial']);
      if (!kId || !kNome) {
        dados.cadastro = { status: 'sem-chave', url: url, chaves: Object.keys(amostra),
          detalhe: 'O cadastro respondeu, mas não foi possível identificar nele ' +
                   (!kId ? 'a coluna de código' : 'a coluna de nome') + '.' };
        return dados;
      }

      var porId = new Map();
      lista.forEach(function (c) {
        var id = String(c[kId] == null ? '' : c[kId]).trim();
        if (id) porId.set(id, c);
      });

      /* Rede de segurança: se cada endpoint identificar a instituição por uma
         chave diferente (código de um lado, CNPJ do outro), o casamento pela
         chave principal dá zero — então tentamos também pelo CNPJ, comparando
         apenas os dígitos. */
      var kCnpjCad = acharChave(amostra, ['Cnpj', 'CNPJ']);
      var kCnpjVal = acharChave(dados.rows[0], ['Cnpj', 'CNPJ']);
      var porCnpj = new Map();
      if (kCnpjCad && kCnpjVal) {
        lista.forEach(function (c) {
          var d = String(c[kCnpjCad] == null ? '' : c[kCnpjCad]).replace(/\D/g, '');
          if (d) porCnpj.set(d, c);
        });
      }
      function achar(r) {
        var c = porId.get(String(r.__id).trim());
        if (c) return c;
        if (kCnpjVal && porCnpj.size) {
          var d = String(r[kCnpjVal] == null ? '' : r[kCnpjVal]).replace(/\D/g, '');
          if (d) return porCnpj.get(d) || null;
        }
        return null;
      }

      var casados = 0, nomeados = 0;
      dados.rows.forEach(function (r) {
        var c = achar(r);
        if (!c) return;
        casados++;
        var nome = String(c[kNome] == null ? '' : c[kNome]).trim();
        if (nome && nome !== r.__nome) { r.__nome = nome; nomeados++; }
        CAMPOS_CADASTRO.forEach(function (campo) {
          var chave = acharChave(c, [campo]);
          if (!chave) return;
          var atual = r[campo];
          if (atual === undefined || atual === null || atual === '') r[campo] = c[chave];
        });
      });

      dados.cadastro = {
        status: casados ? 'ok' : 'sem-casamento',
        url: state.urlCadastroUsada || url, total: lista.length, casados: casados, nomeados: nomeados,
        chaveId: kId, chaveNome: kNome,
        chavesCadastro: Object.keys(amostra),
        exemploCadastro: amostra,
        detalhe: casados
          ? null
          : 'Nenhum código do relatório de valores foi encontrado no cadastro — ' +
            'os dois endpoints parecem identificar a instituição de formas diferentes.'
      };
      dados.metaColumns = Object.keys(dados.rows[0] || {}).filter(function (k) {
        return dados.columns.indexOf(k) < 0 && k.slice(0, 2) !== '__';
      });
      return dados;
    }).catch(function (e) {
      dados.cadastro = { status: 'falhou', url: url, erro: (e && e.message) || String(e),
        detalhe: 'A consulta ao IfDataCadastro não completou, então os nomes não puderam ser buscados.' };
      return dados;
    });
  }

  /** Carrega o mesmo relatório em vários períodos (para séries temporais). */
  function serie(periodos, tipo, relatorio, onProgress) {
    var out = [], i = 0;
    function passo() {
      if (i >= periodos.length) return Promise.resolve(out);
      var p = periodos[i++];
      if (onProgress) onProgress(i, periodos.length, p);
      return valores(p, tipo, relatorio)
        .then(function (d) { out.push({ anoMes: p, dados: d }); })
        .catch(function (e) { out.push({ anoMes: p, erro: e, dados: { rows: [], columns: [] } }); })
        .then(passo);
    }
    return passo();
  }

  /** Testa a conectividade com a API e devolve um diagnóstico legível. */
  function testar(anoMes, tipo, relatorio) {
    var url = comFormato(urlValores(anoMes, tipo, relatorio) + '&$top=1');
    var t0 = performance.now();
    return getJSON(url).then(function (json) {
      var v = (json && json.value) || [];
      return {
        ok: true, ms: Math.round(performance.now() - t0), url: url,
        registros: v.length, amostra: v[0] || null,
        chaves: v[0] ? Object.keys(v[0]) : []
      };
    }).catch(function (e) {
      return { ok: false, ms: Math.round(performance.now() - t0), url: url,
               erro: e.message || String(e) };
    });
  }

  /** Descobre quais trimestres respondem com dados, do mais recente para trás. */
  function periodosDisponiveis(tipo, relatorio, maxTrimestres, onProgress) {
    var lista = U.allPeriods(2000).slice(0, maxTrimestres || 40);
    var ok = [], i = 0, falhasSeguidas = 0;
    function passo() {
      if (i >= lista.length || falhasSeguidas >= 4) return Promise.resolve(ok);
      var p = lista[i++];
      if (onProgress) onProgress(i, lista.length, p);
      return getJSON(comFormato(urlValores(p, tipo, relatorio) + '&$top=1'))
        .then(function (json) {
          var tem = json && json.value && json.value.length;
          if (tem) { ok.push(p); falhasSeguidas = 0; } else { falhasSeguidas++; }
        })
        .catch(function () { falhasSeguidas++; })
        .then(passo);
    }
    return passo();
  }

  function configurar(opts) {
    if (opts.base) state.base = String(opts.base).replace(/\/+$/, '');
    if (opts.modo) {
      state.modo = opts.modo;
      state.demoAtivo = opts.modo === 'demo';
    }
    if (opts.timeoutMs) state.timeoutMs = opts.timeoutMs;
    state.cadastroIndisponivel = false;
    state.erroCadastro = null;
    state.assinaturaCadastro = null;
    state.modoLeitura = null;
    memCache.clear();
    pendentes.clear();
    emit({ tipo: 'config', state: state });
  }

  global.API = {
    state: state,
    BASE_PADRAO: BASE_PADRAO,
    configurar: configurar,
    listaRelatorios: listaRelatorios,
    cadastro: cadastro,
    valores: valores,
    serie: serie,
    testar: testar,
    periodosDisponiveis: periodosDisponiveis,
    limparCache: limparCache,
    normalizar: normalizar, pareceCodigo: pareceCodigo, sondarCadastro: sondarCadastro,
    sondarValores: sondarValores,
    urlValores: urlValores,
    urlCadastro: urlCadastro,
    on: on
  };
})(window);
