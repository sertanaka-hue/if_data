/* catalog.js — catálogos de domínio do IF.data e motor de indicadores.
   Expõe o namespace global `CAT`. */
(function (global) {
  'use strict';
  var U = global.U;

  /* ---------------------------------------------------------------------
     Tipos de instituição (parâmetro TipoInstituicao da API)
     --------------------------------------------------------------------- */
  var TIPOS_INSTITUICAO = [
    { id: 1, nome: 'Conglomerados Prudenciais e Instituições Independentes',
      curto: 'Prudencial', hint: 'Visão de supervisão prudencial — base para Basileia e RWA.' },
    { id: 2, nome: 'Conglomerados Financeiros e Instituições Independentes',
      curto: 'Financeiro', hint: 'Visão contábil por conglomerado financeiro.' },
    { id: 3, nome: 'Instituições Individuais',
      curto: 'Individual', hint: 'Cada CNPJ isoladamente, sem consolidação.' },
    { id: 4, nome: 'Conglomerados Prudenciais (somente)',
      curto: 'Prudencial (só congl.)', hint: 'Disponibilidade varia por período.' }
  ];

  /* ---------------------------------------------------------------------
     Relatórios — fallback. A lista viva vem de ListaDeRelatorio na API e
     substitui esta assim que a descoberta funciona (ver api.js).
     --------------------------------------------------------------------- */
  var RELATORIOS_FALLBACK = [
    { id: '1',  nome: 'Resumo' },
    { id: '2',  nome: 'Ativo' },
    { id: '3',  nome: 'Passivo' },
    { id: '4',  nome: 'Demonstração de Resultado' },
    { id: '5',  nome: 'Informações de Capital' },
    { id: '6',  nome: 'Segmentação' },
    { id: '7',  nome: 'Carteira de crédito ativa Pessoa Física – por modalidade e prazo' },
    { id: '8',  nome: 'Carteira de crédito ativa Pessoa Jurídica – por modalidade e prazo' },
    { id: '9',  nome: 'Carteira de crédito ativa Pessoa Jurídica – por porte do tomador' },
    { id: '10', nome: 'Carteira de crédito ativa Pessoa Jurídica – por atividade econômica (CNAE)' },
    { id: '11', nome: 'Carteira de crédito ativa – por nível de risco da operação' },
    { id: '12', nome: 'Carteira de crédito ativa – quantidade de clientes e de operações' },
    { id: '13', nome: 'Carteira de crédito ativa Pessoa Física – por indexador' },
    { id: '14', nome: 'Carteira de crédito ativa Pessoa Jurídica – por indexador' },
    { id: '15', nome: 'Carteira de crédito ativa – por região geográfica' },
    { id: '16', nome: 'Carteira de crédito ativa – por porte do tomador' },
    { id: '17', nome: 'Carteira de crédito ativa – por origem dos recursos' }
  ];

  /* ---------------------------------------------------------------------
     Campos canônicos: cada um traz padrões de nome (já normalizados) que
     são casados contra as colunas realmente devolvidas pela API. Isso deixa
     os indicadores imunes a mudanças de rótulo entre períodos/relatórios.
     `exact` casa nome idêntico; `starts` casa prefixo; `has` exige todos os
     termos presentes; `not` descarta.
     --------------------------------------------------------------------- */
  var CAMPOS = {
    ativoTotal: {
      label: 'Ativo total',
      exact: ['ativo total', 'ativo'],
      starts: ['ativo total'],
      has: [['ativo', 'total']],
      not: ['ponderado', 'permanente', 'realizavel', 'circulante']
    },
    carteiraCredito: {
      label: 'Carteira de crédito',
      exact: ['carteira de credito classificada', 'carteira de credito', 'operacoes de credito'],
      starts: ['carteira de credito classificada', 'carteira de credito'],
      has: [['carteira', 'credito']],
      not: ['pessoa fisica', 'pessoa juridica', 'liquida']
    },
    passivoTotal: {
      label: 'Passivo total',
      exact: ['passivo total', 'passivo circulante e exigivel a longo prazo', 'passivo'],
      has: [['passivo', 'total']], not: ['ponderado']
    },
    captacoes: {
      label: 'Captações',
      exact: ['captacoes', 'captacoes totais', 'total de captacoes'],
      starts: ['captacoes'], has: [['captac']]
    },
    depositos: {
      label: 'Depósitos',
      exact: ['depositos', 'depositos totais', 'total de depositos'],
      starts: ['depositos'], has: [['deposito']], not: ['compulsorio', 'interfinanceiro']
    },
    patrimonioLiquido: {
      label: 'Patrimônio líquido',
      exact: ['patrimonio liquido', 'patrimonio liquido ajustado'],
      starts: ['patrimonio liquido'], has: [['patrimonio', 'liquido']], not: ['referencia']
    },
    lucroLiquido: {
      label: 'Lucro líquido',
      exact: ['lucro liquido', 'lucro prejuizo liquido', 'resultado liquido'],
      starts: ['lucro liquido', 'lucro prejuizo'], has: [['lucro', 'liquido']]
    },
    basileia: {
      label: 'Índice de Basileia',
      exact: ['indice de basileia', 'indice de basileia ib'],
      starts: ['indice de basileia'], has: [['basileia']], ratio: true
    },
    indiceCapitalPrincipal: {
      label: 'Índice de Capital Principal',
      exact: ['indice de capital principal'], has: [['indice', 'capital', 'principal']], ratio: true
    },
    indiceNivelI: {
      label: 'Índice de Capital Nível I',
      exact: ['indice de capital nivel i', 'indice de nivel i'],
      has: [['indice', 'nivel']], ratio: true
    },
    razaoAlavancagem: {
      label: 'Razão de alavancagem',
      exact: ['razao de alavancagem', 'razao de alavancagem ra'],
      has: [['razao', 'alavancagem']], ratio: true
    },
    indiceImobilizacao: {
      label: 'Índice de imobilização',
      exact: ['indice de imobilizacao'], has: [['indice', 'imobiliza']], ratio: true
    },
    patrimonioReferencia: {
      label: 'Patrimônio de Referência',
      exact: ['patrimonio de referencia', 'patrimonio de referencia pr'],
      has: [['patrimonio', 'referencia']]
    },
    capitalPrincipal: {
      label: 'Capital Principal',
      exact: ['capital principal'], has: [['capital', 'principal']], not: ['indice']
    },
    capitalNivelI: {
      label: 'Capital Nível I',
      exact: ['nivel i', 'capital de nivel i', 'capital nivel i'],
      has: [['nivel', 'i']], not: ['indice', 'nivel ii']
    },
    rwa: {
      label: 'RWA (ativos ponderados pelo risco)',
      exact: ['ativos ponderados pelo risco rwa', 'rwa', 'ativos ponderados pelo risco',
              'montante rwa', 'exposicao total'],
      has: [['ponderados', 'risco']], not: ['credito', 'mercado', 'operacional']
    },
    rwaCredito: { label: 'RWA de crédito', has: [['rwa', 'credito']], exact: ['rwacpad'] },
    rwaMercado: { label: 'RWA de mercado', has: [['rwa', 'mercado']], exact: ['rwampad'] },
    rwaOperacional: { label: 'RWA operacional', has: [['rwa', 'operacional']], exact: ['rwaopad'] },
    provisao: {
      label: 'Provisão para créditos de liquidação duvidosa',
      exact: ['provisao sobre carteira de credito classificada', 'provisao', 'provisoes'],
      has: [['provis']], not: ['despesa', 'receita']
    },
    despesaProvisao: {
      label: 'Despesa de provisão',
      has: [['despesa', 'provis']], exact: ['despesas de provisao']
    },
    resultadoIntermediacao: {
      label: 'Resultado de intermediação financeira',
      exact: ['resultado de intermediacao financeira'], has: [['resultado', 'intermediacao']]
    },
    receitaIntermediacao: {
      label: 'Receitas de intermediação financeira',
      exact: ['receitas de intermediacao financeira'], has: [['receita', 'intermediacao']]
    },
    rendasServicos: {
      label: 'Rendas de prestação de serviços',
      exact: ['rendas de prestacao de servicos', 'receitas de prestacao de servicos'],
      has: [['prestacao', 'servicos']]
    },
    despesaPessoal: {
      label: 'Despesas de pessoal',
      exact: ['despesas de pessoal'], has: [['despesa', 'pessoal']]
    },
    despesaAdministrativa: {
      label: 'Despesas administrativas',
      exact: ['despesas administrativas', 'outras despesas administrativas'],
      has: [['despesa', 'administrativ']]
    },
    numeroAgencias: {
      label: 'Número de agências',
      exact: ['numero de agencias'], has: [['agencia']]
    },
    numeroPostos: {
      label: 'Postos de atendimento',
      exact: ['numero de postos de atendimento'], has: [['posto', 'atendimento']]
    }
  };

  /* --------------------------- resolução de campos -------------------- */

  function scoreColumn(colName, spec) {
    var n = U.norm(colName);
    if (!n) return 0;
    if (spec.not && spec.not.some(function (t) { return n.indexOf(U.norm(t)) >= 0; })) return 0;
    var i;
    if (spec.exact) {
      for (i = 0; i < spec.exact.length; i++) {
        if (n === U.norm(spec.exact[i])) return 1000 - i;
      }
    }
    if (spec.starts) {
      for (i = 0; i < spec.starts.length; i++) {
        if (n.indexOf(U.norm(spec.starts[i])) === 0) return 700 - i - Math.min(60, n.length);
      }
    }
    if (spec.has) {
      for (i = 0; i < spec.has.length; i++) {
        var terms = spec.has[i];
        var all = terms.every(function (t) { return n.indexOf(U.norm(t)) >= 0; });
        if (all) return 400 - i - Math.min(60, n.length);
      }
    }
    return 0;
  }

  /**
   * Casa colunas reais do dataset com os campos canônicos.
   * @param {string[]} columns nomes de coluna como vieram da API
   * @param {Object} [overrides] mapa campoCanonico -> nome de coluna forçado pelo usuário
   * @returns {{map: Object, score: Object, unmatched: string[]}}
   */
  function resolveFields(columns, overrides) {
    var map = {}, score = {};
    Object.keys(CAMPOS).forEach(function (canon) {
      var spec = CAMPOS[canon], best = null, bestScore = 0;
      columns.forEach(function (col) {
        var s = scoreColumn(col, spec);
        if (s > bestScore) { bestScore = s; best = col; }
      });
      if (best) { map[canon] = best; score[canon] = bestScore; }
    });
    if (overrides) {
      Object.keys(overrides).forEach(function (canon) {
        var v = overrides[canon];
        if (v === '__none__') { delete map[canon]; score[canon] = 0; }
        else if (v) { map[canon] = v; score[canon] = 9999; }
      });
    }
    var used = {};
    Object.keys(map).forEach(function (k) { used[map[k]] = true; });
    return {
      map: map, score: score,
      unmatched: columns.filter(function (c) { return !used[c]; })
    };
  }

  /* ---------------------------------------------------------------------
     Indicadores derivados.
     `f(campo)` devolve o valor numérico do campo canônico (ou null).
     `ctx` traz { anoMes, anualizar } — a DRE do IF.data é acumulada no ano,
     então resultados são multiplicados por 12/mês quando `anualizar`.
     --------------------------------------------------------------------- */

  function annualFactor(ctx) {
    if (!ctx || !ctx.anualizar || !ctx.anoMes) return 1;
    var mes = Number(String(ctx.anoMes).slice(4));
    return mes > 0 ? 12 / mes : 1;
  }
  function div(a, b, mult) {
    if (!U.isNum(a) || !U.isNum(b) || b === 0) return null;
    return (a / b) * (mult == null ? 1 : mult);
  }

  var INDICADORES = [
    { id: 'roe', label: 'ROE', unidade: '%', decimais: 1, melhor: 'alto',
      grupo: 'Rentabilidade', requer: ['lucroLiquido', 'patrimonioLiquido'],
      desc: 'Lucro líquido ÷ patrimônio líquido. Anualizado quando o resultado é acumulado no ano.',
      calc: function (f, ctx) { return div(f('lucroLiquido') * annualFactor(ctx), f('patrimonioLiquido'), 100); } },

    { id: 'roa', label: 'ROA', unidade: '%', decimais: 2, melhor: 'alto',
      grupo: 'Rentabilidade', requer: ['lucroLiquido', 'ativoTotal'],
      desc: 'Lucro líquido ÷ ativo total.',
      calc: function (f, ctx) { return div(f('lucroLiquido') * annualFactor(ctx), f('ativoTotal'), 100); } },

    { id: 'margemLiquida', label: 'Margem líquida', unidade: '%', decimais: 1, melhor: 'alto',
      grupo: 'Rentabilidade', requer: ['lucroLiquido', 'receitaIntermediacao'],
      desc: 'Lucro líquido ÷ receitas de intermediação financeira.',
      calc: function (f) { return div(f('lucroLiquido'), f('receitaIntermediacao'), 100); } },

    { id: 'eficiencia', label: 'Índice de eficiência', unidade: '%', decimais: 1, melhor: 'baixo',
      grupo: 'Rentabilidade',
      requer: ['despesaPessoal', 'despesaAdministrativa', 'resultadoIntermediacao'],
      desc: '(Despesas de pessoal + administrativas) ÷ (resultado de intermediação + rendas de serviços). Menor é melhor.',
      calc: function (f) {
        var desp = Math.abs(f('despesaPessoal') || 0) + Math.abs(f('despesaAdministrativa') || 0);
        var rec = (f('resultadoIntermediacao') || 0) + (f('rendasServicos') || 0);
        return desp && rec ? div(desp, rec, 100) : null;
      } },

    { id: 'basileia', label: 'Índice de Basileia', unidade: '%', decimais: 2, melhor: 'alto',
      grupo: 'Capital', requer: ['basileia'], direto: 'basileia',
      desc: 'Patrimônio de Referência ÷ RWA. Reportado pela instituição; mínimo regulatório 8% + adicionais.',
      calc: function (f) {
        var v = f('basileia');
        if (U.isNum(v)) return v;
        return div(f('patrimonioReferencia'), f('rwa'), 100);
      } },

    { id: 'icp', label: 'Índice de Capital Principal', unidade: '%', decimais: 2, melhor: 'alto',
      grupo: 'Capital', requer: ['indiceCapitalPrincipal'], direto: 'indiceCapitalPrincipal',
      desc: 'Capital Principal ÷ RWA (mínimo 4,5% + ACP).',
      calc: function (f) {
        var v = f('indiceCapitalPrincipal');
        if (U.isNum(v)) return v;
        return div(f('capitalPrincipal'), f('rwa'), 100);
      } },

    { id: 'in1', label: 'Índice de Nível I', unidade: '%', decimais: 2, melhor: 'alto',
      grupo: 'Capital', requer: ['indiceNivelI'], direto: 'indiceNivelI',
      desc: 'Capital de Nível I ÷ RWA (mínimo 6%).',
      calc: function (f) {
        var v = f('indiceNivelI');
        if (U.isNum(v)) return v;
        return div(f('capitalNivelI'), f('rwa'), 100);
      } },

    { id: 'razaoAlavancagem', label: 'Razão de alavancagem (RA)', unidade: '%', decimais: 2,
      melhor: 'alto', grupo: 'Capital', requer: ['razaoAlavancagem'], direto: 'razaoAlavancagem',
      desc: 'Capital de Nível I ÷ exposição total (mínimo 3%).',
      calc: function (f) { return f('razaoAlavancagem'); } },

    { id: 'alavancagemContabil', label: 'Alavancagem contábil', unidade: '×', decimais: 1,
      melhor: 'baixo', grupo: 'Capital', requer: ['ativoTotal', 'patrimonioLiquido'],
      desc: 'Ativo total ÷ patrimônio líquido.',
      calc: function (f) { return div(f('ativoTotal'), f('patrimonioLiquido')); } },

    { id: 'plAtivo', label: 'PL / Ativo', unidade: '%', decimais: 2, melhor: 'alto',
      grupo: 'Capital', requer: ['patrimonioLiquido', 'ativoTotal'],
      desc: 'Colchão de capital contábil sobre o ativo.',
      calc: function (f) { return div(f('patrimonioLiquido'), f('ativoTotal'), 100); } },

    { id: 'densidadeRWA', label: 'Densidade de RWA', unidade: '%', decimais: 1, melhor: 'baixo',
      grupo: 'Capital', requer: ['rwa', 'ativoTotal'],
      desc: 'RWA ÷ ativo total — quanto de risco ponderado cada real de ativo carrega.',
      calc: function (f) { return div(f('rwa'), f('ativoTotal'), 100); } },

    { id: 'creditoAtivo', label: 'Crédito / Ativo', unidade: '%', decimais: 1, melhor: null,
      grupo: 'Crédito & Liquidez', requer: ['carteiraCredito', 'ativoTotal'],
      desc: 'Peso da carteira de crédito no balanço.',
      calc: function (f) { return div(f('carteiraCredito'), f('ativoTotal'), 100); } },

    { id: 'ldr', label: 'Crédito / Captações (LDR)', unidade: '%', decimais: 1, melhor: 'baixo',
      grupo: 'Crédito & Liquidez', requer: ['carteiraCredito', 'captacoes'],
      desc: 'Proxy de liquidez estrutural: quanto da carteira está financiado por captações. Acima de 100% indica dependência de funding de mercado.',
      calc: function (f) {
        var cap = f('captacoes');
        if (!U.isNum(cap)) cap = f('depositos');
        return div(f('carteiraCredito'), cap, 100);
      } },

    { id: 'cobertura', label: 'Provisão / Carteira', unidade: '%', decimais: 2, melhor: null,
      grupo: 'Crédito & Liquidez', requer: ['provisao', 'carteiraCredito'],
      desc: 'Cobertura de provisão sobre a carteira classificada.',
      calc: function (f) { return div(Math.abs(f('provisao')), f('carteiraCredito'), 100); } },

    { id: 'custoCredito', label: 'Custo do crédito', unidade: '%', decimais: 2, melhor: 'baixo',
      grupo: 'Crédito & Liquidez', requer: ['despesaProvisao', 'carteiraCredito'],
      desc: 'Despesa de provisão anualizada ÷ carteira de crédito.',
      calc: function (f, ctx) {
        return div(Math.abs(f('despesaProvisao')) * annualFactor(ctx), f('carteiraCredito'), 100);
      } },

    { id: 'imobilizacao', label: 'Índice de imobilização', unidade: '%', decimais: 2, melhor: 'baixo',
      grupo: 'Capital', requer: ['indiceImobilizacao'], direto: 'indiceImobilizacao',
      desc: 'Limite regulatório de 50% do PR.',
      calc: function (f) { return f('indiceImobilizacao'); } }
  ];

  var INDICADOR_POR_ID = {};
  INDICADORES.forEach(function (m) { INDICADOR_POR_ID[m.id] = m; });

  /** Indicadores calculáveis dado o mapa de campos resolvidos. */
  function indicadoresDisponiveis(fieldMap) {
    return INDICADORES.filter(function (m) {
      if (m.direto && fieldMap[m.direto]) return true;
      return m.requer.every(function (c) { return !!fieldMap[c]; });
    });
  }

  /**
   * Calcula todos os indicadores para uma linha (registro de instituição).
   * @param {Object} row  linha larga { coluna: valor }
   * @param {Object} fieldMap  campoCanonico -> nome de coluna
   * @param {Object} ctx  { anoMes, anualizar }
   */
  function calcIndicadores(row, fieldMap, ctx) {
    function f(canon) {
      var col = fieldMap[canon];
      if (!col) return null;
      return U.toNumber(row[col]);
    }
    var out = {};
    INDICADORES.forEach(function (m) {
      var v = null;
      try { v = m.calc(f, ctx); } catch (e) { v = null; }
      out[m.id] = U.isNum(v) ? v : null;
    });
    return out;
  }

  /* ---------------------------------------------------------------------
     Agregação de grupos.
     Regra de ouro: estoques e fluxos somam; índices NUNCA são somados nem
     tirados por média simples — são recalculados a partir dos componentes
     agregados. Quando o componente não existe no relatório, cai para média
     ponderada pelo ativo e o resultado é marcado como aproximado.
     --------------------------------------------------------------------- */

  function agregarLinhas(rows, fieldMap, ctx) {
    var soma = {}, aviso = [];
    Object.keys(CAMPOS).forEach(function (canon) {
      var col = fieldMap[canon];
      if (!col) return;
      if (CAMPOS[canon].ratio) return;              // índices não somam
      var vals = rows.map(function (r) { return U.toNumber(r[col]); }).filter(U.isNum);
      soma[canon] = vals.length ? U.sum(vals) : null;
    });

    // índices reportados: média ponderada pelo ativo (aproximação explícita)
    var pesos = rows.map(function (r) {
      var col = fieldMap.ativoTotal;
      var v = col ? U.toNumber(r[col]) : null;
      return U.isNum(v) && v > 0 ? v : 0;
    });
    var pesoTotal = U.sum(pesos);
    Object.keys(CAMPOS).forEach(function (canon) {
      if (!CAMPOS[canon].ratio) return;
      var col = fieldMap[canon];
      if (!col) return;
      var num = 0, den = 0;
      rows.forEach(function (r, i) {
        var v = U.toNumber(r[col]);
        if (U.isNum(v) && pesos[i] > 0) { num += v * pesos[i]; den += pesos[i]; }
      });
      soma[canon] = den ? num / den : null;
      if (den) aviso.push(CAMPOS[canon].label);
    });

    function f(canon) { return U.isNum(soma[canon]) ? soma[canon] : null; }

    // recalcula índices a partir dos componentes sempre que possível
    if (U.isNum(soma.patrimonioReferencia) && U.isNum(soma.rwa) && soma.rwa) {
      soma.basileia = (soma.patrimonioReferencia / soma.rwa) * 100;
      aviso = aviso.filter(function (a) { return a !== CAMPOS.basileia.label; });
    }
    if (U.isNum(soma.capitalPrincipal) && U.isNum(soma.rwa) && soma.rwa) {
      soma.indiceCapitalPrincipal = (soma.capitalPrincipal / soma.rwa) * 100;
      aviso = aviso.filter(function (a) { return a !== CAMPOS.indiceCapitalPrincipal.label; });
    }
    if (U.isNum(soma.capitalNivelI) && U.isNum(soma.rwa) && soma.rwa) {
      soma.indiceNivelI = (soma.capitalNivelI / soma.rwa) * 100;
      aviso = aviso.filter(function (a) { return a !== CAMPOS.indiceNivelI.label; });
    }

    var ind = {};
    INDICADORES.forEach(function (m) {
      var v = null;
      try { v = m.calc(f, ctx); } catch (e) { v = null; }
      ind[m.id] = U.isNum(v) ? v : null;
    });

    return {
      campos: soma,
      indicadores: ind,
      n: rows.length,
      pesoTotal: pesoTotal,
      aproximados: U.unique(aviso)
    };
  }

  global.CAT = {
    TIPOS_INSTITUICAO: TIPOS_INSTITUICAO,
    RELATORIOS_FALLBACK: RELATORIOS_FALLBACK,
    CAMPOS: CAMPOS,
    INDICADORES: INDICADORES,
    INDICADOR_POR_ID: INDICADOR_POR_ID,
    resolveFields: resolveFields,
    indicadoresDisponiveis: indicadoresDisponiveis,
    calcIndicadores: calcIndicadores,
    agregarLinhas: agregarLinhas,
    annualFactor: annualFactor
  };
})(window);
