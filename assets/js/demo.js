/* demo.js — gerador de dados sintéticos.
   Serve para (a) explorar a interface sem rede e (b) validar layout e cálculos.
   NÃO são dados do Banco Central: os números são fictícios e o modo é sempre
   sinalizado na interface. Expõe o namespace global `DEMO`. */
(function (global) {
  'use strict';
  var U = global.U;

  /* PRNG determinístico (mulberry32) — mesmo período gera sempre o mesmo número */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var IFS = [
    ['C0000001', 'BANCO ALFA S.A.',              1, 'SP', 'São Paulo',      2_950_000, 'S1'],
    ['C0000002', 'BANCO BETA S.A.',              1, 'SP', 'São Paulo',      2_310_000, 'S1'],
    ['C0000003', 'BANCO GAMA',                   1, 'DF', 'Brasília',       2_180_000, 'S1'],
    ['C0000004', 'BANCO DELTA S.A.',             1, 'RJ', 'Rio de Janeiro', 1_640_000, 'S1'],
    ['C0000005', 'BANCO EPSILON',                1, 'SP', 'Osasco',         1_120_000, 'S1'],
    ['C0000006', 'BANCO ZETA S.A.',              2, 'RS', 'Porto Alegre',     580_000, 'S2'],
    ['C0000007', 'BANCO ETA INVESTIMENTOS',      2, 'SP', 'São Paulo',        410_000, 'S2'],
    ['C0000008', 'BANCO THETA',                  2, 'MG', 'Belo Horizonte',   295_000, 'S2'],
    ['C0000009', 'BANCO IOTA DIGITAL',           2, 'SP', 'São Paulo',        268_000, 'S2'],
    ['C0000010', 'BANCO KAPPA',                  2, 'SP', 'São Paulo',        212_000, 'S2'],
    ['C0000011', 'BANCO LAMBDA S.A.',            2, 'PR', 'Curitiba',         168_000, 'S3'],
    ['C0000012', 'BANCO MI CRÉDITO',             2, 'SP', 'Campinas',         141_000, 'S3'],
    ['C0000013', 'BANCO NU FINANCEIRA',          2, 'SP', 'São Paulo',        128_000, 'S3'],
    ['C0000014', 'BANCO XI CORRETORA',           3, 'SP', 'São Paulo',         96_000, 'S3'],
    ['C0000015', 'BANCO OMICRON',                3, 'BA', 'Salvador',          82_000, 'S3'],
    ['C0000016', 'BANCO PI COOPERATIVO',         3, 'SC', 'Florianópolis',     71_000, 'S3'],
    ['C0000017', 'BANCO RHO',                    3, 'SP', 'Barueri',           58_000, 'S4'],
    ['C0000018', 'BANCO SIGMA CONSIGNADO',       3, 'GO', 'Goiânia',           47_000, 'S4'],
    ['C0000019', 'BANCO TAU',                    3, 'PE', 'Recife',            39_000, 'S4'],
    ['C0000020', 'BANCO UPSILON',                3, 'SP', 'São Paulo',         33_000, 'S4'],
    ['C0000021', 'BANCO PHI AGRO',               3, 'MT', 'Cuiabá',            28_000, 'S4'],
    ['C0000022', 'BANCO CHI',                    3, 'CE', 'Fortaleza',         23_000, 'S4'],
    ['C0000023', 'BANCO PSI VEÍCULOS',           3, 'SP', 'São Bernardo',      19_500, 'S4'],
    ['C0000024', 'BANCO OMEGA',                  3, 'RJ', 'Niterói',           16_200, 'S4'],
    ['C0000025', 'FINANCEIRA AURORA',            3, 'SP', 'São Paulo',         12_800, 'S5'],
    ['C0000026', 'BANCO BOREAL',                 3, 'AM', 'Manaus',            10_400, 'S5'],
    ['C0000027', 'BANCO CENTAURO',               3, 'SP', 'Santos',             8_600, 'S5'],
    ['C0000028', 'BANCO DÓRICO',                 3, 'RS', 'Caxias do Sul',      6_900, 'S5'],
    ['C0000029', 'BANCO ESTELAR',                3, 'MG', 'Uberlândia',         5_400, 'S5'],
    ['C0000030', 'BANCO FÊNIX PAGAMENTOS',       3, 'SP', 'São Paulo',          4_100, 'S5'],
    ['C0000031', 'BANCO GAIVOTA',                3, 'SC', 'Joinville',          3_300, 'S5'],
    ['C0000032', 'BANCO HÓRUS',                  3, 'PB', 'João Pessoa',        2_600, 'S5'],
    ['C0000033', 'BANCO ÍRIS',                   3, 'ES', 'Vitória',            2_050, 'S5'],
    ['C0000034', 'BANCO JADE',                   3, 'SP', 'Ribeirão Preto',     1_600, 'S5'],
    ['C0000035', 'BANCO KRONOS',                 3, 'RJ', 'Rio de Janeiro',     1_250, 'S5'],
    ['C0000036', 'BANCO LÍRIO',                  3, 'PR', 'Londrina',             980, 'S5'],
    ['C0000037', 'BANCO MERIDIANO',              3, 'MS', 'Campo Grande',         760, 'S5'],
    ['C0000038', 'BANCO NORTE VERDE',            3, 'PA', 'Belém',                590, 'S5'],
    ['C0000039', 'BANCO ÔNIX',                   3, 'SP', 'Sorocaba',             450, 'S5'],
    ['C0000040', 'BANCO PRISMA',                 3, 'RN', 'Natal',                340, 'S5']
  ];

  var RELATORIOS = [
    { id: '1', nome: 'Resumo', origem: 'demo' },
    { id: '4', nome: 'Demonstração de Resultado', origem: 'demo' },
    { id: '5', nome: 'Informações de Capital', origem: 'demo' },
    { id: '11', nome: 'Carteira de crédito ativa – por nível de risco da operação', origem: 'demo' }
  ];

  function relatorios() { return RELATORIOS.slice(); }

  function fatorPeriodo(anoMes) {
    var idx = U.periodToIndex(String(anoMes));
    var base = U.periodToIndex('201803');
    return Math.pow(1.021, idx - base);   // crescimento nominal de ~8,7% a.a.
  }

  /* tipo 1 exclui as menores; tipos 2 e 3 trazem todo o universo sintético */
  function recorte(tipo) {
    return Number(tipo) === 1 ? IFS.slice(0, 32) : IFS;
  }

  function cadastro(anoMes, tipo) {
    return recorte(tipo)
      .map(function (r) {
        return { CodInst: r[0], NomeInstituicao: r[1], UF: r[3], Cidade: r[4],
                 SR: r[6], AnoMes: String(anoMes) };
      });
  }

  function valores(anoMes, tipo, relatorio) {
    var f = fatorPeriodo(anoMes);
    var mes = Number(String(anoMes).slice(4));
    var acum = mes / 12;                                  // DRE acumulada no ano
    var rel = String(relatorio);

    return recorte(tipo)
      .map(function (r, i) {
        var rnd = rng(U.hash(r[0] + anoMes));
        var jitter = function (amp) { return 1 + (rnd() - 0.5) * amp; };

        var ativo = r[5] * 1e3 * f * jitter(0.05);   // saldos em R$ mil, como no IF.data
        var pl = ativo * (0.075 + rnd() * 0.075);
        var credito = ativo * (0.28 + rnd() * 0.34);
        var captacoes = ativo * (0.52 + rnd() * 0.26);
        var roaAlvo = 0.004 + rnd() * 0.020;
        var lucro = ativo * roaAlvo * acum * jitter(0.30);
        var rwa = ativo * (0.42 + rnd() * 0.33);
        var pr = pl * (1.02 + rnd() * 0.35);
        var cp = pr * (0.78 + rnd() * 0.18);
        var n1 = pr * (0.86 + rnd() * 0.12);
        var provisao = credito * (0.028 + rnd() * 0.045);

        var base = {
          CodInst: r[0], NomeInstituicao: r[1], UF: r[3], Cidade: r[4],
          SR: r[6], AnoMes: String(anoMes), NomeRelatorio: rel
        };

        if (rel === '5') {
          base['Capital Principal'] = cp;
          base['Nível I'] = n1;
          base['Patrimônio de Referência'] = pr;
          base['Ativos Ponderados pelo Risco (RWA)'] = rwa;
          base['RWA para risco de crédito'] = rwa * 0.78;
          base['RWA para risco de mercado'] = rwa * 0.07;
          base['RWA para risco operacional'] = rwa * 0.15;
          base['Índice de Capital Principal'] = (cp / rwa) * 100;
          base['Índice de Capital Nível I'] = (n1 / rwa) * 100;
          base['Índice de Basileia'] = (pr / rwa) * 100;
          base['Razão de Alavancagem'] = (n1 / (ativo * 1.06)) * 100;
          return base;
        }

        if (rel === '4') {
          var receita = credito * (0.055 + rnd() * 0.055) * acum;
          var despIntermed = receita * (0.45 + rnd() * 0.22);
          base['Receitas de Intermediação Financeira'] = receita;
          base['Despesas de Intermediação Financeira'] = -despIntermed;
          base['Despesas de Provisão'] = -credito * (0.012 + rnd() * 0.028) * acum;
          base['Resultado de Intermediação Financeira'] = receita - despIntermed;
          base['Rendas de Prestação de Serviços'] = receita * (0.12 + rnd() * 0.30);
          base['Despesas de Pessoal'] = -(receita * (0.10 + rnd() * 0.16));
          base['Despesas Administrativas'] = -(receita * (0.12 + rnd() * 0.20));
          base['Lucro Líquido'] = lucro;
          return base;
        }

        if (rel === '11') {
          var restante = credito;
          ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(function (nivel, k) {
            var peso = [0.24, 0.31, 0.17, 0.11, 0.05, 0.032, 0.025, 0.020, 0.043][k] * jitter(0.25);
            var v = credito * peso;
            base['Nível ' + nivel] = v;
            restante -= v;
          });
          base['Carteira de Crédito Classificada'] = credito;
          return base;
        }

        base['Ativo Total'] = ativo;
        base['Carteira de Crédito Classificada'] = credito;
        base['Passivo Circulante e Exigível a Longo Prazo'] = ativo - pl;
        base['Captações'] = captacoes;
        base['Patrimônio Líquido'] = pl;
        base['Lucro Líquido'] = lucro;
        base['Índice de Basileia'] = (pr / rwa) * 100;
        base['Índice de Imobilização'] = 8 + rnd() * 26;
        base['Provisão sobre Carteira de Crédito Classificada'] = -provisao;
        base['Número de Agências'] = Math.round(Math.pow(r[5], 0.55) * (0.6 + rnd() * 0.9));
        base['Número de Postos de Atendimento'] = Math.round(Math.pow(r[5], 0.5) * (0.4 + rnd()));
        return base;
      });
  }

  global.DEMO = { relatorios: relatorios, cadastro: cadastro, valores: valores, IFS: IFS };
})(window);
