# -*- coding: utf-8 -*-
"""Carteira sintética para validação do motor sem acesso às fontes públicas.

Reproduz uma estrutura master-feeder de três níveis, incluindo um fundo sem
composição publicada, para exercitar as travas dos arts. 17, § 8º, 18, § 5º e
59, II da Resolução BCB nº 229/2022.
"""

from datetime import date

COMPETENCIA_DEMO = "202608"
DATA_BASE_DEMO = "2026-08-31"

FUNDOS = [
    # (cnpj, denominação, classe, situação, gestor, administrador, PL)
    ("11111111000191", "RISK DATA DEMO MULTIMERCADO FIC FIM",
     "Multimercado Livre", "EM FUNCIONAMENTO NORMAL",
     "XP GESTAO DE RECURSOS LTDA", "BNY MELLON SERVICOS FINANCEIROS DTVM",
     1_000_000_000.00),
    ("22222222000172", "RISK DATA DEMO CREDITO PRIVADO MASTER FI RF",
     "Renda Fixa Crédito Livre", "EM FUNCIONAMENTO NORMAL",
     "XP GESTAO DE RECURSOS LTDA", "BNY MELLON SERVICOS FINANCEIROS DTVM",
     600_000_000.00),
    ("33333333000153", "RISK DATA DEMO ACOES SELECT MASTER FIA",
     "Ações Livre", "EM FUNCIONAMENTO NORMAL",
     "XP GESTAO DE RECURSOS LTDA", "ITAU UNIBANCO SA", 250_000_000.00),
    ("44444444000134", "RISK DATA DEMO FIDC MULTISETORIAL SENIOR",
     "FIDC", "EM FUNCIONAMENTO NORMAL",
     "GESTORA INDEPENDENTE LTDA", "OLIVEIRA TRUST DTVM", 180_000_000.00),
]

#: (cnpj_fundo, bloco, tp_aplic, tp_ativo, cd_ativo, ds_ativo, emissor,
#:  cnpj_emissor, valor, quantidade, cnpj_fundo_cota, nome_fundo_cota)
CARTEIRAS = [
    # ---- Nível 0: fundo de cotas ---------------------------------------
    ("11111111000191", "BLC_2", "Cotas de Fundos", "Cotas de FI", "", "",
     "", "", 600_000_000.00, 500_000.0, "22222222000172",
     "RISK DATA DEMO CREDITO PRIVADO MASTER FI RF"),
    ("11111111000191", "BLC_2", "Cotas de Fundos", "Cotas de FI", "", "",
     "", "", 250_000_000.00, 200_000.0, "33333333000153",
     "RISK DATA DEMO ACOES SELECT MASTER FIA"),
    ("11111111000191", "BLC_1", "Títulos Públicos", "LFT", "LFT-20290301",
     "LETRA FINANCEIRA DO TESOURO 01/03/2029", "TESOURO NACIONAL", "",
     140_000_000.00, 9_500.0, "", ""),
    ("11111111000191", "BLC_8", "Disponibilidades", "Conta corrente", "",
     "SALDO EM CONTA CORRENTE", "", "", 10_000_000.00, 0.0, "", ""),

    # ---- Nível 1: crédito privado --------------------------------------
    ("22222222000172", "BLC_1", "Títulos Públicos", "NTN-B", "NTNB-20350515",
     "NOTA DO TESOURO NACIONAL SERIE B 15/05/2035", "TESOURO NACIONAL", "",
     150_000_000.00, 30_000.0, "", ""),
    ("22222222000172", "BLC_4", "Debêntures", "DEB", "VALE28",
     "DEBENTURE VALE S.A. 2028", "VALE S.A.", "33592510000154",
     120_000_000.00, 120_000.0, "", ""),
    ("22222222000172", "BLC_4", "Debêntures", "DEB", "LREN31",
     "DEBENTURE LOJAS RENNER 2031", "LOJAS RENNER S.A.", "92754738000162",
     60_000_000.00, 60_000.0, "", ""),
    ("22222222000172", "BLC_5", "Depósitos a prazo e outros títulos de IF",
     "CDB", "CDB-ITAU-2027", "CERTIFICADO DE DEPOSITO BANCARIO ITAU",
     "ITAU UNIBANCO S.A.", "60701190000104", 80_000_000.00, 80_000.0, "", ""),
    ("22222222000172", "BLC_5", "Depósitos a prazo e outros títulos de IF",
     "LFSN", "LFSN-BTG-2032", "LETRA FINANCEIRA SUBORDINADA BTG PACTUAL",
     "BANCO BTG PACTUAL S.A.", "30306294000145", 40_000_000.00, 40_000.0, "", ""),
    ("22222222000172", "BLC_6", "Títulos Agrícolas, do Setor Imobiliário e outros",
     "CRI", "CRI-HABITASEC-2033", "CERTIFICADO DE RECEBIVEIS IMOBILIARIOS",
     "HABITASEC SECURITIZADORA", "09304427000158", 45_000_000.00, 45_000.0, "", ""),
    # Cota de FIDC: nível 2, sem composição publicada -> art. 59, II
    ("22222222000172", "BLC_2", "Cotas de Fundos", "Cotas de FIDC", "", "",
     "", "", 90_000_000.00, 90_000.0, "44444444000134",
     "RISK DATA DEMO FIDC MULTISETORIAL SENIOR"),
    ("22222222000172", "BLC_3", "Swap", "Swap", "SWAP-DI-PRE",
     "DIFERENCIAL DE SWAP A RECEBER DI X PRE", "B3 S.A.", "",
     5_000_000.00, 0.0, "", ""),
    ("22222222000172", "BLC_8", "Disponibilidades", "Conta corrente", "",
     "SALDO EM CONTA CORRENTE", "", "", 10_000_000.00, 0.0, "", ""),

    # ---- Nível 1: ações --------------------------------------------------
    ("33333333000153", "BLC_4", "Ações", "Ações", "PETR4",
     "PETROBRAS PN ACOES PREFERENCIAIS", "PETROLEO BRASILEIRO S.A.",
     "33000167000101", 90_000_000.00, 2_400_000.0, "", ""),
    ("33333333000153", "BLC_4", "Ações", "Ações", "VALE3",
     "VALE ON ACOES ORDINARIAS", "VALE S.A.", "33592510000154",
     80_000_000.00, 1_300_000.0, "", ""),
    ("33333333000153", "BLC_4", "Ações", "Ações", "ITUB4",
     "ITAU UNIBANCO PN ACOES PREFERENCIAIS", "ITAU UNIBANCO HOLDING S.A.",
     "60872504000123", 60_000_000.00, 1_800_000.0, "", ""),
    ("33333333000153", "BLC_1", "Títulos Públicos", "LFT", "LFT-20270901",
     "LETRA FINANCEIRA DO TESOURO 01/09/2027", "TESOURO NACIONAL", "",
     15_000_000.00, 1_000.0, "", ""),
    ("33333333000153", "BLC_8", "Disponibilidades", "Conta corrente", "",
     "SALDO EM CONTA CORRENTE", "", "", 5_000_000.00, 0.0, "", ""),
    # O FIDC (44444444000134) não tem carteira publicada de propósito.
]


def semear(repositorio, competencia: str = COMPETENCIA_DEMO,
           data_base: str = DATA_BASE_DEMO) -> dict:
    """Popula o repositório com a carteira de demonstração."""
    con = repositorio.con
    cnpjs = tuple(f[0] for f in FUNDOS)

    con.execute(f"DELETE FROM fundos WHERE cnpj IN ({','.join('?' * len(cnpjs))})",
                cnpjs)
    con.executemany(
        "INSERT OR REPLACE INTO fundos (cnpj, denominacao, classe, situacao, gestor, "
        "administrador, cnpj_admin, data_inicio, patrimonio_liquido, data_pl, "
        "publico_alvo, condominio) VALUES (?,?,?,?,?,?,'','',?,?,'Investidores em "
        "geral','Aberto')",
        [(c, d, cl, s, g, a, pl, data_base) for c, d, cl, s, g, a, pl in FUNDOS])

    con.execute("DELETE FROM carteira WHERE competencia = ? AND cnpj_fundo IN "
                f"({','.join('?' * len(cnpjs))})", (competencia,) + cnpjs)
    con.executemany(
        "INSERT INTO carteira (competencia, cnpj_fundo, data_competencia, bloco, "
        "tipo_aplicacao, tipo_ativo, codigo_ativo, descricao_ativo, emissor, "
        "cnpj_emissor, valor_mercado, valor_custo, quantidade, cnpj_fundo_cota, "
        "nome_fundo_cota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(competencia, cnpj, data_base, bloco, tp_aplic, tp_ativo, cd, ds, em,
          cnpj_em, valor, valor, qtd, cnpj_cota, nm_cota)
         for (cnpj, bloco, tp_aplic, tp_ativo, cd, ds, em, cnpj_em, valor, qtd,
              cnpj_cota, nm_cota) in CARTEIRAS])

    con.execute("DELETE FROM patrimonio WHERE competencia = ? AND cnpj_fundo IN "
                f"({','.join('?' * len(cnpjs))})", (competencia,) + cnpjs)
    con.executemany(
        "INSERT OR REPLACE INTO patrimonio (competencia, cnpj_fundo, "
        "data_competencia, patrimonio_liquido, valor_cota, captacao, resgate) "
        "VALUES (?,?,?,?,0,0,0)",
        [(competencia, c, data_base, pl) for c, _, _, _, _, _, pl in FUNDOS])

    con.execute(
        "INSERT OR REPLACE INTO controle (chave, valor, atualizado_em) "
        "VALUES (?, 'ok', ?)", (f"demo:{competencia}", data_base))
    con.commit()
    return {"fundos": len(FUNDOS), "posicoes": len(CARTEIRAS),
            "competencia": competencia, "data_base": data_base,
            "cnpj_raiz": FUNDOS[0][0]}
