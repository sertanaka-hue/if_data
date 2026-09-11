/* pub-catalog.js — domínio do módulo Publicações do Risk Bench.
   Fontes comparadas, famílias de indicadores e o catálogo de métricas.
   Namespace global `PUB`. */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
     As quatro publicações comparadas, mais o IF.data como linha de base.
     `automatica` marca a única fonte que o sistema consegue buscar sozinho:
     as demais são PDFs e planilhas de RI/CVM/SEC, sem API pública.
     --------------------------------------------------------------------- */
  var FONTES = [
    { id: 'brgaap', curto: 'BR GAAP', serie: 1,
      nome: 'Demonstrações trimestrais BR GAAP e notas explicativas',
      desc: 'Padrão contábil do COSIF, base do reporte ao BCB. Traz resultado, patrimônio, ' +
            'carteira e provisões, e nas notas a abertura por modalidade, faixa de risco e prazo.' },
    { id: 'ifrs', curto: 'IFRS', serie: 2,
      nome: 'Demonstrações trimestrais IFRS e notas explicativas',
      desc: 'Consolidado internacional. Diverge do BR GAAP sobretudo em perda esperada ' +
            '(IFRS 9, três estágios), hierarquia de valor justo e consolidação — por isso ' +
            'patrimônio e resultado raramente batem com o BR GAAP.' },
    { id: 'pilar3', curto: 'Pilar 3', serie: 3,
      nome: 'Relatório de gerenciamento de riscos — Pilar 3',
      desc: 'A fonte mais rica para risco: PR e suas parcelas, RWA aberto por tipo, ' +
            'LCR, NSFR, razão de alavancagem, VaR do trading book e IRRBB.' },
    { id: 'form20f', curto: '20-F', serie: 4,
      nome: 'Form 20-F (SEC)',
      desc: 'Anual, só para bancos com registro nos Estados Unidos. Traz reconciliações, ' +
            'abertura por segmento e exposições que não aparecem no reporte local.' },
    { id: 'ifdata', curto: 'IF.data', serie: 5, automatica: true,
      nome: 'IF.data — Banco Central do Brasil',
      desc: 'Preenchido automaticamente pelo módulo IF.data. Serve de linha de base para ' +
            'checar o que foi transcrito das publicações.' }
  ];

  var FONTE_POR_ID = {};
  FONTES.forEach(function (f) { FONTE_POR_ID[f.id] = f; });

  var FAMILIAS = [
    { id: 'rentabilidade', nome: 'Rentabilidade',
      desc: 'Quanto o balanço rende e a que custo operacional.' },
    { id: 'mercado', nome: 'Risco de mercado',
      desc: 'Exposição da carteira negociada e do banking book a fatores de mercado.' },
    { id: 'liquidez', nome: 'Liquidez',
      desc: 'Capacidade de honrar saídas em estresse e estabilidade do funding.' },
    { id: 'capital', nome: 'Capital',
      desc: 'Colchão regulatório e distância dos requerimentos.' },
    { id: 'rwa', nome: 'RWA',
      desc: 'Consumo de capital por tipo de risco e densidade sobre o ativo.' }
  ];

  /* ---------------------------------------------------------------------
     Catálogo de métricas.
       familia    — agrupamento na interface
       unidade    — '%', '×', 'R$ mil', 'nº', 'dias', 'p.b.'
       melhor     — 'alto' | 'baixo' | null (define a cor do delta)
       fontes     — onde a métrica costuma ser publicada; alimenta a
                    matriz de cobertura (esperado × preenchido)
       ifdata     — id do indicador do módulo IF.data que preenche a
                    coluna automática, quando existe equivalente
       anual      — só faz sentido em base anual (caso do 20-F)
     --------------------------------------------------------------------- */
  var METRICAS = [

    /* ---------------------------- Rentabilidade --------------------------- */
    { id: 'lucro_liquido', familia: 'rentabilidade', nome: 'Lucro líquido', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'form20f', 'ifdata'],
      definicao: 'Resultado do período. Confira se a publicação é do trimestre isolado ou acumulada no ano — é a divergência mais comum entre fontes.' },
    { id: 'lucro_recorrente', familia: 'rentabilidade', nome: 'Lucro líquido recorrente', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['brgaap', 'ifrs'],
      definicao: 'Resultado excluindo eventos extraordinários, conforme critério do próprio banco. Não é padronizado: vale registrar a definição usada.' },
    { id: 'roae', familia: 'rentabilidade', nome: 'ROAE', unidade: '%',
      decimais: 1, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'form20f'], ifdata: 'roe',
      definicao: 'Lucro anualizado sobre o patrimônio líquido médio do período.' },
    { id: 'roaa', familia: 'rentabilidade', nome: 'ROAA', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'form20f'], ifdata: 'roa',
      definicao: 'Lucro anualizado sobre o ativo total médio do período.' },
    { id: 'nim', familia: 'rentabilidade', nome: 'NIM — margem financeira', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'form20f'],
      definicao: 'Margem financeira líquida sobre ativos rentáveis médios.' },
    { id: 'eficiencia', familia: 'rentabilidade', nome: 'Índice de eficiência', unidade: '%',
      decimais: 1, melhor: 'baixo', fontes: ['brgaap', 'ifrs', 'form20f'], ifdata: 'eficiencia',
      definicao: 'Despesas administrativas e de pessoal sobre receitas operacionais. Menor é melhor.' },
    { id: 'receita_servicos', familia: 'rentabilidade', nome: 'Receita de serviços / receita total', unidade: '%',
      decimais: 1, melhor: 'alto', fontes: ['brgaap', 'ifrs'],
      definicao: 'Peso das tarifas e comissões na receita — quanto do resultado não depende de spread.' },
    { id: 'custo_credito', familia: 'rentabilidade', nome: 'Custo do crédito', unidade: '%',
      decimais: 2, melhor: 'baixo', fontes: ['brgaap', 'ifrs', 'pilar3'], ifdata: 'custoCredito',
      definicao: 'Despesa de provisão anualizada sobre a carteira de crédito média.' },

    /* --------------------------- Risco de mercado -------------------------- */
    { id: 'var_1d99', familia: 'mercado', nome: 'VaR 1 dia, 99%', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'ifrs', 'form20f'],
      definicao: 'Perda máxima esperada da carteira negociada em um dia, com 99% de confiança.' },
    { id: 'var_medio', familia: 'mercado', nome: 'VaR médio do trimestre', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'form20f'],
      definicao: 'Média das observações diárias no trimestre. Revela se o número de fechamento é representativo ou um ponto fora da curva.' },
    { id: 'var_maximo', familia: 'mercado', nome: 'VaR máximo do trimestre', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'form20f'],
      definicao: 'Maior observação diária do período — o pico de apetite efetivamente assumido.' },
    { id: 'svar', familia: 'mercado', nome: 'Stressed VaR', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'VaR recalibrado para uma janela histórica de estresse.' },
    { id: 'var_juros', familia: 'mercado', nome: 'VaR — fator juros', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Parcela do VaR atribuída a taxas de juros (pré e cupons).' },
    { id: 'var_cambio', familia: 'mercado', nome: 'VaR — fator câmbio', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Parcela do VaR atribuída a moedas.' },
    { id: 'var_acoes', familia: 'mercado', nome: 'VaR — fator ações', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Parcela do VaR atribuída a renda variável.' },
    { id: 'backtest_excecoes', familia: 'mercado', nome: 'Exceções de backtesting', unidade: 'nº',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Dias em que a perda superou o VaR na janela avaliada. Muitas exceções indicam modelo subestimando risco.' },
    { id: 'delta_eve', familia: 'mercado', nome: 'IRRBB — ΔEVE', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Variação do valor econômico do banking book no pior cenário de choque de juros. Costuma ser avaliada contra o Nível I no teste de outlier.' },
    { id: 'delta_nii', familia: 'mercado', nome: 'IRRBB — ΔNII', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Variação da margem financeira em doze meses no pior cenário de choque de juros.' },
    { id: 'dv01', familia: 'mercado', nome: 'DV01 da carteira', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Sensibilidade a um ponto-base de deslocamento paralelo da curva.' },

    /* ------------------------------ Liquidez ------------------------------- */
    { id: 'lcr', familia: 'liquidez', nome: 'LCR', unidade: '%',
      decimais: 1, melhor: 'alto', fontes: ['pilar3', 'form20f'], referencia: 100,
      definicao: 'Ativos de alta liquidez sobre saídas líquidas em 30 dias de estresse. Requerimento de 100%.' },
    { id: 'hqla', familia: 'liquidez', nome: 'HQLA — estoque de ativos líquidos', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['pilar3'],
      definicao: 'Numerador do LCR, após os descontos regulatórios por nível.' },
    { id: 'saidas_liquidas', familia: 'liquidez', nome: 'Saídas líquidas em 30 dias', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3'],
      definicao: 'Denominador do LCR no cenário de estresse regulatório.' },
    { id: 'nsfr', familia: 'liquidez', nome: 'NSFR', unidade: '%',
      decimais: 1, melhor: 'alto', fontes: ['pilar3'], referencia: 100,
      definicao: 'Funding estável disponível sobre o requerido. Requerimento de 100%.' },
    { id: 'ldr', familia: 'liquidez', nome: 'Crédito / captações (LDR)', unidade: '%',
      decimais: 1, melhor: 'baixo', fontes: ['brgaap', 'ifrs'], ifdata: 'ldr',
      definicao: 'Quanto da carteira está financiado por captações. Acima de 100% indica dependência de funding de mercado.' },
    { id: 'reserva_liquidez', familia: 'liquidez', nome: 'Reserva de liquidez', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'pilar3'],
      definicao: 'Caixa livre e ativos prontamente conversíveis, conforme a definição interna do banco.' },
    { id: 'concentracao_funding', familia: 'liquidez', nome: 'Concentração dos 10 maiores depositantes', unidade: '%',
      decimais: 1, melhor: 'baixo', fontes: ['pilar3', 'brgaap'],
      definicao: 'Participação dos dez maiores no total captado — mede fragilidade a saques concentrados.' },
    { id: 'prazo_captacao', familia: 'liquidez', nome: 'Prazo médio das captações', unidade: 'dias',
      decimais: 0, melhor: 'alto', fontes: ['pilar3', 'brgaap'],
      definicao: 'Prazo médio ponderado do funding. Quanto mais curto, maior o risco de rolagem.' },

    /* ------------------------------- Capital -------------------------------- */
    { id: 'pr', familia: 'capital', nome: 'Patrimônio de Referência (PR)', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['pilar3', 'ifdata'],
      definicao: 'Capital regulatório total: Nível I mais Nível II.' },
    { id: 'capital_principal', familia: 'capital', nome: 'Capital Principal (CET1)', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['pilar3', 'form20f', 'ifdata'],
      definicao: 'Capital de maior qualidade, após as deduções prudenciais.' },
    { id: 'nivel_1', familia: 'capital', nome: 'Nível I', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['pilar3', 'ifdata'],
      definicao: 'Capital Principal mais Capital Complementar.' },
    { id: 'ic_principal', familia: 'capital', nome: 'Índice de Capital Principal', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['pilar3', 'form20f'], ifdata: 'icp', referencia: 4.5,
      definicao: 'Capital Principal sobre RWA. Mínimo de 4,5% antes dos adicionais de conservação e sistêmico.' },
    { id: 'in1', familia: 'capital', nome: 'Índice de Nível I', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['pilar3', 'form20f'], ifdata: 'in1', referencia: 6,
      definicao: 'Nível I sobre RWA. Mínimo de 6%.' },
    { id: 'basileia', familia: 'capital', nome: 'Índice de Basileia', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['pilar3', 'form20f'], ifdata: 'basileia', referencia: 8,
      definicao: 'PR sobre RWA. Mínimo de 8% antes dos adicionais de capital principal.' },
    { id: 'folga_capital', familia: 'capital', nome: 'Folga sobre o requerimento total', unidade: 'p.p.',
      decimais: 2, melhor: 'alto', fontes: ['pilar3'],
      definicao: 'Distância entre o índice apurado e o requerimento mínimo somado aos adicionais. É a leitura que importa para apetite.' },
    { id: 'razao_alavancagem', familia: 'capital', nome: 'Razão de alavancagem', unidade: '%',
      decimais: 2, melhor: 'alto', fontes: ['pilar3'], ifdata: 'razaoAlavancagem', referencia: 3,
      definicao: 'Nível I sobre exposição total, sem ponderação por risco. Mínimo de 3%.' },
    { id: 'pl_contabil', familia: 'capital', nome: 'Patrimônio líquido contábil', unidade: 'R$ mil',
      decimais: 0, melhor: 'alto', fontes: ['brgaap', 'ifrs', 'form20f', 'ifdata'],
      definicao: 'Patrimônio pela contabilidade. A diferença entre BR GAAP e IFRS aqui é o ponto de partida de qualquer conciliação.' },

    /* --------------------------------- RWA ---------------------------------- */
    { id: 'rwa_total', familia: 'rwa', nome: 'RWA total', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'form20f', 'ifdata'],
      definicao: 'Soma dos ativos ponderados pelo risco de crédito, mercado e operacional.' },
    { id: 'rwa_credito', familia: 'rwa', nome: 'RWA de crédito', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'ifdata'],
      definicao: 'Parcela de crédito (RWAcpad ou abordagem interna).' },
    { id: 'rwa_mercado', familia: 'rwa', nome: 'RWA de mercado', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'ifdata'],
      definicao: 'Parcela de mercado (RWAmpad), incluindo as exposições em ouro, moedas e commodities.' },
    { id: 'rwa_operacional', familia: 'rwa', nome: 'RWA operacional', unidade: 'R$ mil',
      decimais: 0, melhor: 'baixo', fontes: ['pilar3', 'ifdata'],
      definicao: 'Parcela operacional (RWAopad).' },
    { id: 'densidade_rwa', familia: 'rwa', nome: 'Densidade de RWA', unidade: '%',
      decimais: 1, melhor: 'baixo', fontes: ['pilar3'], ifdata: 'densidadeRWA',
      definicao: 'RWA sobre ativo total — quanto de risco ponderado cada real de balanço carrega.' },
    { id: 'rwa_interna', familia: 'rwa', nome: 'RWA por abordagem interna', unidade: '%',
      decimais: 1, melhor: null, fontes: ['pilar3'],
      definicao: 'Fatia do RWA apurada por modelo interno autorizado, e não pela padronizada.' }
  ];

  /* ---------------------------------------------------------------------
     Rótulos usados para achar a métrica dentro de um PDF. São comparados
     contra o texto normalizado da linha (sem acento, minúsculo), por isso
     ficam escritos assim aqui. Vários por métrica porque cada banco nomeia a
     linha do seu jeito. Métrica sem rótulo não é procurada automaticamente —
     continua disponível para lançamento manual.
     --------------------------------------------------------------------- */
  var ROTULOS = {
    /* Os rótulos de índice não podem descrever a linha do capital: se um rótulo
       de "Índice de Capital Principal" casar com a linha "Capital Principal
       (CET1)", o índice rouba o valor em reais. Por isso aqui só entram
       expressões que identificam o próprio índice. */
    basileia: ['indice de basileia', 'indice de adequacao de capital',
               'razao de capital total', 'total capital ratio', 'indice de capital total'],
    ic_principal: ['indice de capital principal', 'cet1 ratio',
                   'indice cet1', 'common equity tier 1 ratio'],
    in1: ['indice de nivel i', 'indice de capital nivel i', 'tier 1 ratio', 'nivel i ratio'],
    razao_alavancagem: ['razao de alavancagem', 'indice de alavancagem', 'leverage ratio'],
    pr: ['patrimonio de referencia', 'capital regulamentar total', 'total capital'],
    capital_principal: ['capital principal', 'common equity tier 1', 'cet1'],
    nivel_1: ['nivel i', 'capital de nivel i', 'tier 1 capital'],
    rwa_total: ['ativos ponderados pelo risco', 'total de ativos ponderados', 'rwa total',
                'montante rwa', 'total rwa', 'risk weighted assets'],
    rwa_credito: ['rwa para risco de credito', 'rwacpad', 'risco de credito rwa',
                  'ativos ponderados risco de credito'],
    rwa_mercado: ['rwa para risco de mercado', 'rwampad', 'risco de mercado rwa'],
    rwa_operacional: ['rwa para risco operacional', 'rwaopad', 'risco operacional rwa'],
    densidade_rwa: ['densidade de rwa', 'rwa sobre ativo', 'rwa density'],
    lcr: ['indice de liquidez de curto prazo', 'liquidity coverage ratio', 'lcr'],
    hqla: ['ativos de alta liquidez', 'total de hqla', 'hqla', 'high quality liquid assets'],
    saidas_liquidas: ['saidas de caixa liquidas', 'total de saidas liquidas',
                      'saidas liquidas totais de caixa'],
    nsfr: ['indice de liquidez de longo prazo', 'net stable funding ratio', 'nsfr'],
    var_1d99: ['var total', 'valor em risco', 'var global', 'var da carteira', 'value at risk'],
    var_medio: ['var medio', 'media do var', 'var medio do periodo'],
    var_maximo: ['var maximo', 'maximo do var', 'var maximo do periodo'],
    svar: ['var estressado', 'stressed var', 'svar'],
    var_juros: ['var taxa de juros', 'var juros', 'fator juros'],
    var_cambio: ['var cambio', 'var moedas', 'fator cambial', 'fator cambio'],
    var_acoes: ['var acoes', 'var renda variavel', 'fator acoes'],
    delta_eve: ['delta eve', 'variacao do valor economico', 'eve'],
    delta_nii: ['delta nii', 'variacao da margem financeira', 'nii'],
    lucro_liquido: ['lucro liquido', 'resultado liquido', 'lucro prejuizo liquido', 'net income'],
    lucro_recorrente: ['lucro liquido recorrente', 'resultado recorrente', 'lucro recorrente'],
    pl_contabil: ['patrimonio liquido', 'total do patrimonio liquido', 'shareholders equity'],
    roae: ['retorno sobre o patrimonio liquido medio', 'roae', 'retorno sobre patrimonio'],
    roaa: ['retorno sobre o ativo total medio', 'roaa', 'retorno sobre ativos'],
    nim: ['margem financeira liquida', 'nim', 'net interest margin'],
    eficiencia: ['indice de eficiencia', 'efficiency ratio'],
    custo_credito: ['custo do credito', 'despesa de provisao sobre carteira'],
    ldr: ['carteira sobre captacoes', 'loan to deposit', 'credito sobre depositos'],
    concentracao_funding: ['concentracao dos maiores depositantes', 'maiores depositantes'],
    prazo_captacao: ['prazo medio das captacoes', 'prazo medio de captacao'],
    backtest_excecoes: ['excecoes de backtesting', 'numero de excecoes', 'backtesting excecoes'],
    dv01: ['dv01', 'pv01', 'sensibilidade a um ponto base']
  };

  METRICAS.forEach(function (m) { m.rotulos = ROTULOS[m.id] || []; });

  var METRICA_POR_ID = {};
  METRICAS.forEach(function (m) { METRICA_POR_ID[m.id] = m; });

  /** Métricas que o extrator de PDF sabe procurar. */
  function metricasProcuraveis() {
    return METRICAS.filter(function (m) { return m.rotulos.length; });
  }

  function metricasDaFamilia(familiaId) {
    return METRICAS.filter(function (m) { return m.familia === familiaId; });
  }

  /** Métricas que uma fonte costuma publicar. */
  function metricasDaFonte(fonteId) {
    return METRICAS.filter(function (m) { return m.fontes.indexOf(fonteId) >= 0; });
  }

  /** Pares de fontes que publicam a mesma métrica — base da conciliação. */
  function fontesComparaveis(metricaId) {
    var m = METRICA_POR_ID[metricaId];
    return m ? m.fontes.slice() : [];
  }

  /* ---------------------------------------------------------------------
     Últimos 16 trimestres (4 anos), do mais recente para trás.
     --------------------------------------------------------------------- */
  function periodosDoEscopo(ate) {
    var U = global.U;
    var fim = ate || U.latestLikelyPeriod();
    var lista = [];
    for (var i = 0; i < 16; i++) lista.push(U.shiftPeriod(fim, -i));
    return lista;
  }

  /* ---------------------------------------------------------------------
     Modelo de planilha para importação.
     --------------------------------------------------------------------- */
  var COLUNAS_IMPORT = [
    { key: 'cnpj', label: 'cnpj', hint: 'Raiz do CNPJ com 8 dígitos, como aparece no IF.data' },
    { key: 'banco', label: 'banco', hint: 'Nome da instituição (livre, só para leitura humana)' },
    { key: 'fonte', label: 'fonte', hint: FONTES.map(function (f) { return f.id; }).join(' | ') },
    { key: 'periodo', label: 'periodo', hint: 'AAAAMM do trimestre: 202603, 202606, 202609 ou 202612' },
    { key: 'metrica', label: 'metrica', hint: 'Identificador do catálogo (coluna "id" da aba de métricas)' },
    { key: 'valor', label: 'valor', hint: 'Número. Decimal com vírgula ou ponto; R$ mil para valores' },
    { key: 'referencia', label: 'referencia', hint: 'Onde foi lido: nota explicativa, página, tabela' },
    { key: 'url', label: 'url', hint: 'Endereço do documento (opcional)' }
  ];

  function modeloCSV() {
    var U = global.U;
    var cab = COLUNAS_IMPORT.map(function (c) { return c.label; }).join(';');
    var exemplos = [
      ['60746948', 'BANCO EXEMPLO S.A.', 'pilar3', U.shiftPeriod(U.latestLikelyPeriod(), 0),
       'basileia', '15,80', 'Pilar 3, tabela KM1', ''],
      ['60746948', 'BANCO EXEMPLO S.A.', 'pilar3', U.shiftPeriod(U.latestLikelyPeriod(), 0),
       'lcr', '142,5', 'Pilar 3, tabela LIQ1', ''],
      ['60746948', 'BANCO EXEMPLO S.A.', 'brgaap', U.shiftPeriod(U.latestLikelyPeriod(), 0),
       'pl_contabil', '1234567', 'DFs, nota 20', '']
    ].map(function (l) { return l.join(';'); });
    return '﻿' + [cab].concat(exemplos).join('\r\n');
  }

  /** Catálogo de métricas em CSV, para quem preenche a planilha ter os ids. */
  function catalogoCSV() {
    var cab = ['id', 'familia', 'metrica', 'unidade', 'fontes_esperadas', 'definicao'].join(';');
    var linhas = METRICAS.map(function (m) {
      return [m.id, m.familia, m.nome, m.unidade,
              m.fontes.join(' '), '"' + m.definicao.replace(/"/g, '""') + '"'].join(';');
    });
    return '﻿' + [cab].concat(linhas).join('\r\n');
  }

  global.PUB = {
    FONTES: FONTES, FONTE_POR_ID: FONTE_POR_ID,
    FAMILIAS: FAMILIAS, METRICAS: METRICAS, METRICA_POR_ID: METRICA_POR_ID,
    COLUNAS_IMPORT: COLUNAS_IMPORT,
    metricasDaFamilia: metricasDaFamilia, metricasDaFonte: metricasDaFonte,
    metricasProcuraveis: metricasProcuraveis, ROTULOS: ROTULOS,
    fontesComparaveis: fontesComparaveis, periodosDoEscopo: periodosDoEscopo,
    modeloCSV: modeloCSV, catalogoCSV: catalogoCSV
  };
})(window);
