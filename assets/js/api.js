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
    ultimoDiagnostico: null
  };

  var memCache = new Map();
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
    podarCache(); podarCache();
    emit({ tipo: 'cache-limpo' });
  }

  /* ------------------------------ HTTP -------------------------------- */

  function comFormato(url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + '$format=json';
  }

  function getJSON(url, tentativa) {
    var t = tentativa || 0;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, state.timeoutMs) : null;
    return fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit',
                        signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status + ' ' + r.statusText);
          err.status = r.status;
          throw err;
        }
        return r.json();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        // 5xx e timeouts merecem várias tentativas; falha de rede/CORS quase
        // nunca melhora ao repetir, então só uma retentativa curta.
        var maxTentativas = (e.status >= 500 || e.name === 'AbortError') ? 3 : 1;
        if (t < maxTentativas) {
          var espera = Math.pow(2, t) * 700;
          return new Promise(function (res) { setTimeout(res, espera); })
            .then(function () { return getJSON(url, t + 1); });
        }
        e.url = url;
        throw e;
      });
  }

  /** Busca paginada de um recurso OData, concatenando `value`. */
  function getTodos(url) {
    var acumulado = [];
    function pagina(skip, p) {
      var u = url + (url.indexOf('?') >= 0 ? '&' : '?') +
              '$top=' + PAGE + '&$skip=' + skip + '&$format=json';
      return getJSON(u).then(function (json) {
        var v = (json && json.value) || [];
        acumulado = acumulado.concat(v);
        if (v.length === PAGE && p + 1 < MAX_PAGES) return pagina(skip + PAGE, p + 1);
        return acumulado;
      });
    }
    return pagina(0, 0);
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
  function urlCadastro(anoMes, tipo) {
    return state.base +
      "/IfDataCadastro(AnoMes=@AnoMes,TipoInstituicao=@TipoInstituicao)" +
      "?@AnoMes=" + encodeURIComponent(anoMes) +
      "&@TipoInstituicao=" + encodeURIComponent(tipo);
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

  /** Cadastro (instituições) de um período. */
  function cadastro(anoMes, tipo) {
    var chave = 'cad.' + anoMes + '.' + tipo;
    if (memCache.has(chave)) return Promise.resolve(memCache.get(chave));
    if (state.demoAtivo) {
      var d = global.DEMO.cadastro(anoMes, tipo);
      memCache.set(chave, d);
      return Promise.resolve(d);
    }
    return getTodos(urlCadastro(anoMes, tipo)).then(function (v) {
      memCache.set(chave, v);
      return v;
    });
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
      memCache.set(chave, dados);
      return Promise.resolve(dados);
    }

    emit({ tipo: 'buscando', chave: chave });
    return getTodos(urlValores(anoMes, tipo, relatorio))
      .then(function (brutas) {
        var dados = normalizar(brutas, ctx);
        dados.url = urlValores(anoMes, tipo, relatorio);
        dados.nBrutas = brutas.length;
        state.ultimoDiagnostico = {
          url: dados.url, forma: dados.forma, linhas: dados.rows.length,
          colunas: dados.columns.length, amostra: dados.bruto, quando: new Date().toISOString()
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
    memCache.clear();
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
    normalizar: normalizar,
    urlValores: urlValores,
    urlCadastro: urlCadastro,
    on: on
  };
})(window);
