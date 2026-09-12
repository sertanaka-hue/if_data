# -*- coding: utf-8 -*-
"""Catálogo regulatório de FPR (RWACPAD) e RW (RWADRC).

Toda regra carrega a resolução e o artigo que a originou, de modo que o
relatório exportado seja auditável linha a linha.

Fontes (conforme normativos anexados ao projeto, em docs/):
    Resolução BCB nº 229, de 12/5/2022  - RWACPAD (abordagem padronizada de crédito)
    Resolução BCB nº 313, de 11/4/2023  - RWADRC  (risco de crédito da carteira de negociação)
    Resolução BCB nº 291, de 16/2/2023  - RWACVA  (ajuste de variação do valor do derivativo)
    Resolução BCB nº 202, de 11/3/2022  - RWASP   (risco operacional)
    Circular nº 3.809, de 25/8/2016     - mitigadores do risco de crédito
"""

from dataclasses import dataclass, field
from typing import List, Optional

# ---------------------------------------------------------------------------
# Parâmetros prudenciais
# ---------------------------------------------------------------------------

#: Fator "F" de requerimento mínimo de PR. Res. BCB 313, art. 3º, I (8% desde 1º/1/2025)
#: e Res. CMN 4.958/2021, art. 4º.
FATOR_F = 0.08

#: Multiplicador (1/F) aplicado ao requerimento DRC para obter a parcela RWADRC.
MULTIPLICADOR_DRC = 1.0 / FATOR_F  # 12,5

#: Res. BCB 229, art. 17, § 7º - majoração de 120% quando a informação utilizada
#: para identificar/mensurar as exposições do fundo não é de domínio público nem
#: disponibilizada pelo administrador e mantida à disposição do BCB.
MAJORACAO_INFO_NAO_PUBLICA = 1.20

#: Res. BCB 229, art. 59, § 3º - teto do valor ponderado da exposição a fundo.
FPR_TETO_FUNDO = 12.50

#: Res. BCB 229, art. 17, § 2º - defasagem máxima das informações da carteira.
DEFASAGEM_MAX_DIAS = 30
#: Res. BCB 229, art. 17, § 3º - defasagem estendida (carteira com sigilo CVM).
DEFASAGEM_MAX_DIAS_SIGILO = 90
#: Res. BCB 229, art. 22, § 4º - informações de domínio público para fins de FPR.
DEFASAGEM_MAX_DIAS_PUBLICA = 120

RES_229 = "Resolução BCB nº 229/2022"
RES_313 = "Resolução BCB nº 313/2023"
RES_291 = "Resolução BCB nº 291/2023"
RES_202 = "Resolução BCB nº 202/2022"
CIRC_3809 = "Circular nº 3.809/2016"


# ---------------------------------------------------------------------------
# Regras de FPR - carteira bancária (RWACPAD)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RegraFPR:
    """Uma regra de ponderação com a respectiva base normativa."""

    id: str
    fpr: float                      # fator de ponderação (1.00 = 100%)
    resolucao: str
    artigo: str
    descricao: str
    #: campos de dados indispensáveis para confirmar o enquadramento
    requer: tuple = ()
    #: True quando a regra é um fallback conservador por ausência de dado
    conservadora: bool = False

    @property
    def fpr_pct(self) -> str:
        return f"{self.fpr * 100:.6g}%"

    @property
    def base_legal(self) -> str:
        return f"{self.resolucao}, {self.artigo}"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "fpr": self.fpr,
            "fpr_pct": self.fpr_pct,
            "resolucao": self.resolucao,
            "artigo": self.artigo,
            "base_legal": self.base_legal,
            "descricao": self.descricao,
            "conservadora": self.conservadora,
        }


def _r(id, fpr, artigo, descricao, requer=(), res=RES_229, conservadora=False):
    return RegraFPR(id=id, fpr=fpr, resolucao=res, artigo=artigo,
                    descricao=descricao, requer=tuple(requer),
                    conservadora=conservadora)


#: Catálogo de regras do RWACPAD efetivamente alcançáveis por ativos de carteira
#: de fundo. A chave é usada pelo motor de classificação (taxonomy.py).
REGRAS_FPR = {
    # --- Soberano e caixa (Cap. II) ---------------------------------------
    "SOBERANO_BR": _r(
        "SOBERANO_BR", 0.00, "Art. 23, inciso I",
        "Exposições à União e ao Banco Central do Brasil (títulos públicos federais)."),
    "CAIXA_BRL": _r(
        "CAIXA_BRL", 0.00, "Art. 23, inciso II",
        "Valores mantidos em espécie, em reais."),
    "CAIXA_NAO_CUSTODIA_PROPRIA": _r(
        "CAIXA_NAO_CUSTODIA_PROPRIA", 0.20, "Art. 26",
        "Valores em espécie que não se encontram na posse direta da instituição: "
        "piso de FPR de 20%.",
        requer=("posse_direta",)),
    "SOBERANO_EXT_AA": _r(
        "SOBERANO_EXT_AA", 0.00, "Art. 25, inciso I",
        "Governo central estrangeiro e respectivo banco central com classificação "
        "igual ou superior a AA-.",
        requer=("rating_soberano",)),
    "SOBERANO_EXT_A": _r(
        "SOBERANO_EXT_A", 0.20, "Art. 25, inciso II",
        "Soberano estrangeiro com classificação igual ou superior a A- e inferior a AA-.",
        requer=("rating_soberano",)),
    "SOBERANO_EXT_BBB": _r(
        "SOBERANO_EXT_BBB", 0.50, "Art. 25, inciso III",
        "Soberano estrangeiro com classificação igual ou superior a BBB- e inferior a A-.",
        requer=("rating_soberano",)),
    "SOBERANO_EXT_B": _r(
        "SOBERANO_EXT_B", 1.00, "Art. 25, inciso IV",
        "Soberano estrangeiro com classificação igual ou superior a B- e inferior a "
        "BBB-, ou sem classificação.",
        requer=("rating_soberano",)),
    "SOBERANO_EXT_SUBB": _r(
        "SOBERANO_EXT_SUBB", 1.50, "Art. 25, inciso V",
        "Soberano estrangeiro com classificação inferior a B-.",
        requer=("rating_soberano",)),

    # --- Organismos multilaterais (Cap. III) ------------------------------
    "MULTILATERAL_0": _r(
        "MULTILATERAL_0", 0.00, "Art. 27",
        "Organismos multilaterais e Entidades Multilaterais de Desenvolvimento "
        "listados (BIRD, BID, BIS, FMI, CAF/AIIB e demais)."),

    # --- Instituições financeiras (Cap. V) --------------------------------
    "IF_CAT_A_CURTO": _r(
        "IF_CAT_A_CURTO", 0.20, "Art. 33, inciso I, alínea 'a'",
        "Instituição financeira na categoria de risco A, operação com vencimento "
        "original de até 90 dias corridos.",
        requer=("categoria_risco_if", "prazo_original")),
    "IF_CAT_A_LONGO": _r(
        "IF_CAT_A_LONGO", 0.40, "Art. 33, inciso I, alínea 'b'",
        "Instituição financeira na categoria de risco A, demais prazos "
        "(30% se Capital Principal >= 14% e RA >= 5%, art. 33, § 1º).",
        requer=("categoria_risco_if", "prazo_original")),
    "IF_CAT_A_LONGO_REDUZIDO": _r(
        "IF_CAT_A_LONGO_REDUZIDO", 0.30, "Art. 33, § 1º",
        "Instituição na categoria A com índice de Capital Principal >= 14% e "
        "Razão de Alavancagem >= 5%.",
        requer=("categoria_risco_if", "indice_capital_principal", "razao_alavancagem")),
    "IF_CAT_B_CURTO": _r(
        "IF_CAT_B_CURTO", 0.50, "Art. 33, inciso II, alínea 'a'",
        "Instituição financeira na categoria de risco B, vencimento original de até 90 dias.",
        requer=("categoria_risco_if", "prazo_original")),
    "IF_CAT_B_LONGO": _r(
        "IF_CAT_B_LONGO", 0.75, "Art. 33, inciso II, alínea 'b'",
        "Instituição financeira na categoria de risco B, demais prazos.",
        requer=("categoria_risco_if", "prazo_original")),
    "IF_CAT_C": _r(
        "IF_CAT_C", 1.50, "Art. 33, inciso III",
        "Instituição financeira na categoria de risco C.",
        requer=("categoria_risco_if",)),

    # --- Pessoas jurídicas não financeiras (Cap. VI) ----------------------
    "PJ_GRANDE_BAIXO_RISCO": _r(
        "PJ_GRANDE_BAIXO_RISCO", 0.65, "Art. 35",
        "Pessoa jurídica não financeira de grande porte com baixo risco de crédito "
        "(demonstrações auditadas, ativo > R$240 mi ou receita > R$300 mi, não "
        "caracterizada como ativo problemático).",
        requer=("porte_emissor", "demonstracoes_auditadas", "ativo_problematico")),
    "PJ_PEQUENO_MEDIO": _r(
        "PJ_PEQUENO_MEDIO", 0.85, "Art. 36",
        "Pessoa jurídica não financeira de pequeno ou médio porte (ativo total < "
        "R$240 mi e receita bruta anual < R$300 mi).",
        requer=("porte_emissor",)),
    "FIN_ESPECIALIZADO_OBJETO": _r(
        "FIN_ESPECIALIZADO_OBJETO", 1.00, "Art. 37",
        "Financiamento especializado de objeto específico ou de commodities.",
        requer=("tipo_financiamento_especializado",)),
    "FIN_PROJETO": _r(
        "FIN_PROJETO", 1.30, "Art. 38",
        "Financiamento especializado classificado como financiamento de projeto.",
        requer=("tipo_financiamento_especializado", "fase_projeto")),
    "FIN_PROJETO_OPERACIONAL": _r(
        "FIN_PROJETO_OPERACIONAL", 1.00, "Art. 39",
        "Financiamento de projeto em fase operacional.",
        requer=("fase_projeto",)),
    "FIN_PROJETO_ALTA_QUALIDADE": _r(
        "FIN_PROJETO_ALTA_QUALIDADE", 0.80, "Art. 40",
        "Financiamento de projeto de alta qualidade em fase operacional.",
        requer=("fase_projeto", "qualidade_projeto")),
    "PJ_DEMAIS": _r(
        "PJ_DEMAIS", 1.00, "Art. 41",
        "Pessoa jurídica de direito privado não financeira sem FPR específico."),

    # --- Participações societárias e dívida subordinada (Cap. VII) --------
    "PARTIC_SIGNIFICATIVA": _r(
        "PARTIC_SIGNIFICATIVA", 2.50, "Art. 42",
        "Investimento significativo em participação societária não deduzido do PR.",
        requer=("participacao_significativa",)),
    "ACAO_NAO_LISTADA": _r(
        "ACAO_NAO_LISTADA", 4.00, "Art. 43, inciso I",
        "Participação societária, ou título nela conversível, em entidade não "
        "listada em bolsa e não integrada operacionalmente à instituição.",
        requer=("listada_em_bolsa",)),
    "ACAO_LISTADA": _r(
        "ACAO_LISTADA", 2.50, "Art. 43, inciso III",
        "Demais participações societárias (inclusive ações listadas em bolsa)."),
    "DIVIDA_SUBORDINADA": _r(
        "DIVIDA_SUBORDINADA", 1.50, "Art. 44",
        "Instrumento de dívida subordinada."),
    "PARTIC_EXCEDENTE": _r(
        "PARTIC_EXCEDENTE", 12.50, "Art. 45",
        "Parcela de participação societária significativa em PJ não financeira que "
        "excede 15% do PR individualmente ou 60% de forma agregada.",
        requer=("participacao_significativa", "pr_instituicao")),

    # --- Varejo e pessoa natural (Cap. VIII) ------------------------------
    "VAREJO": _r(
        "VAREJO", 0.75, "Art. 46",
        "Exposição de varejo (pessoa natural ou PJ de pequeno porte, limite de "
        "R$5 mi por contraparte e < 0,2% da carteira de varejo).",
        requer=("contraparte_varejo", "limite_varejo")),
    "VAREJO_TRANSACIONADOR": _r(
        "VAREJO_TRANSACIONADOR", 0.45, "Art. 47",
        "Exposição de varejo relativa a instrumento de pagamento pós-pago ou limite "
        "de crédito sem utilização nos últimos 360 dias.",
        requer=("contraparte_varejo", "historico_utilizacao")),
    "PESSOA_NATURAL_DEMAIS": _r(
        "PESSOA_NATURAL_DEMAIS", 1.00, "Art. 48",
        "Exposição a pessoa natural não garantida por imóvel e fora dos arts. 46 e 47."),

    # --- Imóveis (Cap. IX) -------------------------------------------------
    "IMOVEL_RESIDENCIAL": _r(
        "IMOVEL_RESIDENCIAL", 0.50, "Arts. 50 a 53",
        "Exposição garantida por imóvel residencial; o FPR efetivo depende da razão "
        "entre o valor da exposição e o valor do imóvel (LTV).",
        requer=("ltv", "tipo_imovel", "dependencia_fluxo_imovel")),
    "IMOVEL_DEPENDENTE_FLUXO": _r(
        "IMOVEL_DEPENDENTE_FLUXO", 1.50, "Art. 54",
        "Exposição vinculada a imóvel com dependência do fluxo de caixa gerado pelo "
        "próprio imóvel, fora das hipóteses de FPR específico.",
        requer=("ltv", "dependencia_fluxo_imovel")),

    # --- Contraparte central (Cap. X) -------------------------------------
    "QCCP_NEGOCIACAO": _r(
        "QCCP_NEGOCIACAO", 0.02, "Art. 69",
        "Exposição de negociação com contraparte central qualificada (QCCP)."),
    "QCCP_GARANTIA": _r(
        "QCCP_GARANTIA", 0.02, "Art. 73",
        "Exposição relativa a margem de garantia depositada em QCCP."),

    # --- Fundos de investimento (Cap. XII) --------------------------------
    "FUNDO_LOOKTHROUGH": _r(
        "FUNDO_LOOKTHROUGH", 0.00, "Art. 59, inciso I",
        "Cota de fundo com exposições identificadas (art. 17) ou inferidas (art. 18): "
        "aplica-se o FPR da respectiva contraparte. O FPR efetivo é o da carteira "
        "olhada por transparência."),
    "FUNDO_NAO_IDENTIFICADO": _r(
        "FUNDO_NAO_IDENTIFICADO", 12.50, "Art. 59, inciso II",
        "Cota de fundo cujo valor corresponde ao valor contábil por impossibilidade "
        "de identificação (art. 16, parágrafo único; art. 17, § 8º; art. 18, §§ 4º e 6º).",
        conservadora=True),
    "FUNDO_CREDITO_DESCONHECIDO_150": _r(
        "FUNDO_CREDITO_DESCONHECIDO_150", 1.50, "Art. 59, § 1º",
        "Faculdade de FPR de 150% para operações de crédito do fundo cuja "
        "caracterização como ativo problemático é desconhecida, quando somam menos "
        "de 5% do valor nominal da carteira.",
        requer=("ativo_problematico",)),
    "FUNDO_INFERIDO_150_S2S4": _r(
        "FUNDO_INFERIDO_150_S2S4", 1.50, "Art. 59, § 2º",
        "Faculdade de FPR de 150% para exposição inferida pelo art. 18, para "
        "instituição do S2, S3 ou S4, quando não cabível FPR superior a 150%.",
        requer=("segmento_instituicao",)),
    "FUNDO_DEMAIS": _r(
        "FUNDO_DEMAIS", 1.00, "Art. 60",
        "Exposições a fundo de investimento não enquadradas no art. 59."),

    # --- Securitização (Cap. XIII) ----------------------------------------
    "SECURITIZACAO_SEM_DADOS": _r(
        "SECURITIZACAO_SEM_DADOS", 12.50, "Art. 62 c/c art. 66",
        "Título de securitização (CRI, CRA, cotas de FIDC subordinadas/mezanino). "
        "O FPR depende dos pontos de encaixe (A) e desencaixe (D), da razão de "
        "inadimplência (W) e do capital hipotético (K), não disponíveis na CDA/CVM.",
        requer=("ponto_encaixe_A", "ponto_desencaixe_D", "razao_inadimplencia_W",
                "capital_hipotetico_K"),
        conservadora=True),
    "SECURITIZACAO_SENIOR_COMO_FUNDO": _r(
        "SECURITIZACAO_SENIOR_COMO_FUNDO", 1.00, "Art. 19, § 2º",
        "Faculdade de apurar exposição a título de securitização de classe sênior "
        "como exposição a fundo de investimento.",
        requer=("classe_priorizacao",)),
    "CLASSE_UNICA_COMO_FUNDO": _r(
        "CLASSE_UNICA_COMO_FUNDO", 1.00, "Art. 19, § 1º",
        "Processo estruturado em apenas uma classe de priorização de pagamento: "
        "apura-se como exposição a fundo de investimento."),

    # --- Derivativos / risco de crédito de contraparte ---------------------
    "DERIVATIVO_CCR": _r(
        "DERIVATIVO_CCR", 1.00, "Art. 11 c/c art. 17, §§ 4º a 6º",
        "Instrumento financeiro derivativo da carteira do fundo: exposição apurada "
        "pelo SA-CCR (Anexo I) ou CEM (Anexo II). Na impossibilidade de apurar o "
        "valor de reposição, usa-se o nocional; o ganho potencial futuro usa fator "
        "de 15%.",
        requer=("valor_nocional", "valor_reposicao", "conjunto_compensacao",
                "contraparte_derivativo"),
        conservadora=True),

    # --- Fallback ----------------------------------------------------------
    "NAO_CLASSIFICADO": _r(
        "NAO_CLASSIFICADO", 12.50, "Art. 59, inciso II",
        "Ativo sem informação suficiente para determinação do FPR adequado "
        "(art. 17, § 1º). Tratado como fração não identificada da carteira.",
        conservadora=True),
}


# ---------------------------------------------------------------------------
# Regras de RW - carteira de negociação (RWADRC, Res. BCB 313)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RegraDRC:
    """Ponderador de risco (RW) e Fator de Perda (FP) do RWADRC."""

    id: str
    rw: float
    fp: float
    resolucao: str
    artigo: str
    artigo_fp: str
    descricao: str
    categoria: str            # categoria do art. 8º
    requer: tuple = ()
    conservadora: bool = False

    @property
    def rw_pct(self) -> str:
        return f"{self.rw * 100:.6g}%"

    @property
    def base_legal(self) -> str:
        return f"{self.resolucao}, {self.artigo}"

    def to_dict(self) -> dict:
        return {
            "id": self.id, "rw": self.rw, "rw_pct": self.rw_pct, "fp": self.fp,
            "resolucao": self.resolucao, "artigo": self.artigo,
            "artigo_fp": self.artigo_fp, "base_legal": self.base_legal,
            "descricao": self.descricao, "categoria": self.categoria,
            "conservadora": self.conservadora,
        }


def _d(id, rw, fp, artigo, artigo_fp, categoria, descricao, requer=(), conservadora=False):
    return RegraDRC(id=id, rw=rw, fp=fp, resolucao=RES_313, artigo=artigo,
                    artigo_fp=artigo_fp, categoria=categoria, descricao=descricao,
                    requer=tuple(requer), conservadora=conservadora)


CAT_PJ = "Pessoa jurídica de direito privado (art. 8º, I)"
CAT_SOB = "Governos centrais, bancos centrais, organismos multilaterais e EMD (art. 8º, II)"
CAT_REG = "Governos regionais e autoridades locais (art. 8º, III)"

#: Fator de Perda por natureza do instrumento (art. 6º).
FP_ACAO = 1.00                 # art. 6º, I, 'a'
FP_DIVIDA_SUBORDINADA = 1.00   # art. 6º, I, 'b'
FP_EVENTO_CREDITO = 1.00       # art. 6º, I, 'c'
FP_DIVIDA_NAO_SUBORDINADA = 0.75   # art. 6º, II
FP_COVERED_BOND = 0.25         # art. 6º, III
FP_DERIVATIVO_DISSOLUCAO = 0.00    # art. 6º, IV

REGRAS_DRC = {
    # --- Soberano (arts. 11 e 12) -----------------------------------------
    "DRC_SOBERANO_BR": _d(
        "DRC_SOBERANO_BR", 0.00, FP_DIVIDA_NAO_SUBORDINADA, "Art. 12, inciso I",
        "Art. 6º, inciso II", CAT_SOB,
        "Referência DRC é a União ou o Banco Central do Brasil: RW de 0%."),
    "DRC_MULTILATERAL": _d(
        "DRC_MULTILATERAL", 0.00, FP_DIVIDA_NAO_SUBORDINADA, "Art. 12, inciso III",
        "Art. 6º, inciso II", CAT_SOB,
        "Organismos multilaterais e EMD do art. 27 da Res. BCB 229/2022."),
    "DRC_SOBERANO_AAA": _d("DRC_SOBERANO_AAA", 0.005, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso I", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação AAA.", requer=("rating_soberano",)),
    "DRC_SOBERANO_AA": _d("DRC_SOBERANO_AA", 0.02, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso II", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação AA.", requer=("rating_soberano",)),
    "DRC_SOBERANO_A": _d("DRC_SOBERANO_A", 0.03, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso III", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação A.", requer=("rating_soberano",)),
    "DRC_SOBERANO_BBB": _d("DRC_SOBERANO_BBB", 0.06, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso IV", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação BBB.", requer=("rating_soberano",)),
    "DRC_SOBERANO_BB": _d("DRC_SOBERANO_BB", 0.15, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso V", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação BB.", requer=("rating_soberano",)),
    "DRC_SOBERANO_B": _d("DRC_SOBERANO_B", 0.30, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso VI", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação B.", requer=("rating_soberano",)),
    "DRC_SOBERANO_CCC": _d("DRC_SOBERANO_CCC", 0.50, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 11, inciso VII", "Art. 6º, inciso II", CAT_SOB,
        "Soberano estrangeiro com classificação CCC.", requer=("rating_soberano",)),
    "DRC_SOBERANO_SEM_RATING": _d("DRC_SOBERANO_SEM_RATING", 0.15,
        FP_DIVIDA_NAO_SUBORDINADA, "Art. 11, inciso VIII", "Art. 6º, inciso II",
        CAT_SOB, "Soberano estrangeiro sem classificação externa: RW de 15%."),

    # --- Governos regionais (art. 13) --------------------------------------
    "DRC_GOV_REGIONAL": _d("DRC_GOV_REGIONAL", 0.30, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 13", "Art. 6º, inciso II", CAT_REG,
        "Governos regionais e autoridades locais: RW de 30%."),

    # --- Pessoa jurídica de direito privado (art. 10) ----------------------
    "DRC_IF_A": _d("DRC_IF_A", 0.03, FP_DIVIDA_NAO_SUBORDINADA, "Art. 10, inciso I",
        "Art. 6º, inciso II", CAT_PJ,
        "Instituição classificada na categoria de risco A (art. 30 da Res. BCB 229/2022).",
        requer=("categoria_risco_if",)),
    "DRC_IF_B": _d("DRC_IF_B", 0.06, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 10, inciso II, alínea 'a'", "Art. 6º, inciso II", CAT_PJ,
        "Instituição classificada na categoria de risco B (art. 31 da Res. BCB 229/2022).",
        requer=("categoria_risco_if",)),
    "DRC_CORP_IG": _d("DRC_CORP_IG", 0.06, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 10, inciso II, alíneas 'b' e 'c'", "Art. 6º, inciso II", CAT_PJ,
        "PJ não financeira de grande porte que atende ao art. 35 da Res. BCB 229/2022, "
        "ou equivalente investment grade corporate.",
        requer=("porte_emissor", "investment_grade")),
    "DRC_CORP_GRANDE_15": _d("DRC_CORP_GRANDE_15", 0.15, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 10, inciso III", "Art. 6º, inciso II", CAT_PJ,
        "PJ não financeira de grande porte sem capacidade adequada comprovada de "
        "cumprir obrigações (não investment grade).",
        requer=("porte_emissor", "investment_grade")),
    "DRC_DEMAIS_30": _d("DRC_DEMAIS_30", 0.30, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 10, inciso IV", "Art. 6º, inciso II", CAT_PJ,
        "Referência DRC que não atende às condições dos incisos I a III: RW de 30%."),
    "DRC_EVENTO_CREDITO": _d("DRC_EVENTO_CREDITO", 1.00, FP_EVENTO_CREDITO,
        "Art. 10, inciso V", "Art. 6º, inciso I, alínea 'c'", CAT_PJ,
        "Referência DRC sobre a qual incidiu evento de crédito: RW de 100%.",
        requer=("evento_credito",)),
    "DRC_S3_SIMPLIFICADO": _d("DRC_S3_SIMPLIFICADO", 0.15, FP_DIVIDA_NAO_SUBORDINADA,
        "Art. 10, parágrafo único", "Art. 6º, inciso II", CAT_PJ,
        "Faculdade do S3: RW de 15% sem evento de crédito e 100% com evento de crédito.",
        requer=("segmento_instituicao",)),

    # --- Ações e cotas de fundos (arts. 4º, § 7º, e 14) --------------------
    "DRC_ACAO": _d("DRC_ACAO", 0.30, FP_ACAO, "Art. 10, inciso IV",
        "Art. 6º, inciso I, alínea 'a'", CAT_PJ,
        "Ação: Fator de Perda de 100% e RW conforme a Referência DRC do emissor."),
    "DRC_ACAO_IG": _d("DRC_ACAO_IG", 0.06, FP_ACAO,
        "Art. 10, inciso II, alínea 'c'", "Art. 6º, inciso I, alínea 'a'", CAT_PJ,
        "Ação de emissor de grande porte investment grade: FP de 100% e RW de 6%.",
        requer=("porte_emissor", "investment_grade")),
    "DRC_FUNDO_CLASSE_UNICA": _d("DRC_FUNDO_CLASSE_UNICA", 0.15, FP_ACAO,
        "Art. 14", "Art. 4º, § 7º", CAT_PJ,
        "Fundo de investimento estruturado com apenas uma classe de priorização de "
        "pagamento: Referência DRC específica com RW de 15%; a cota é tratada como ação."),
    "DRC_FUNDO_EMISSORES_INADIMPLENTES": _d(
        "DRC_FUNDO_EMISSORES_INADIMPLENTES", 1.00, FP_ACAO, "Art. 14, parágrafo único",
        "Art. 4º, § 7º", CAT_PJ,
        "Fundo cujo regulamento determina investimento majoritário em instrumentos de "
        "emissores com evento de crédito: RW de 100%.",
        requer=("politica_investimento",)),
    "DRC_SUBORDINADA": _d("DRC_SUBORDINADA", 0.30, FP_DIVIDA_SUBORDINADA,
        "Art. 10, inciso IV", "Art. 6º, inciso I, alínea 'b'", CAT_PJ,
        "Título de dívida subordinada: Fator de Perda de 100%."),

    # --- Securitização (arts. 17 a 22) -------------------------------------
    "DRC_SECURITIZACAO": _d("DRC_SECURITIZACAO", 0.30, FP_DIVIDA_NAO_SUBORDINADA,
        "Arts. 17 a 22 (DRCSEC)", "Art. 6º, inciso II", "Securitização (DRCSEC)",
        "Instrumento resultante de processo de securitização: apuração pelo DRCSEC, "
        "com classificação por região de origem e modalidade de lastro.",
        requer=("regiao_origem", "modalidade_lastro", "classe_priorizacao"),
        conservadora=True),

    # --- Fallback ----------------------------------------------------------
    "DRC_NAO_CLASSIFICADO": _d("DRC_NAO_CLASSIFICADO", 0.30, FP_ACAO,
        "Art. 10, inciso IV", "Art. 6º, inciso I, alínea 'a'", CAT_PJ,
        "Instrumento sem informação suficiente para enquadramento: aplicado o RW "
        "residual de 30% com Fator de Perda de 100%.",
        conservadora=True),
}


# ---------------------------------------------------------------------------
# Glossário de campos exigidos, para a seção de pendências de dados
# ---------------------------------------------------------------------------

DESCRICAO_CAMPOS = {
    "rating_soberano": "Classificação externa de risco do ente soberano emissor",
    "categoria_risco_if": "Categoria de risco A/B/C da instituição financeira "
                          "(arts. 30 a 32 da Res. BCB 229/2022)",
    "prazo_original": "Prazo de vencimento original da operação (corte em 90 dias)",
    "indice_capital_principal": "Índice de Capital Principal da contraparte financeira",
    "razao_alavancagem": "Razão de Alavancagem (RA) da contraparte financeira",
    "porte_emissor": "Ativo total e receita bruta anual do emissor (cortes de "
                     "R$240 mi e R$300 mi)",
    "demonstracoes_auditadas": "Demonstrações contábeis auditadas por auditor "
                               "registrado na CVM",
    "ativo_problematico": "Caracterização como ativo problemático (art. 24 da "
                          "Res. 4.557/2017)",
    "investment_grade": "Avaliação de capacidade adequada de pagamento "
                        "(investment grade corporate)",
    "listada_em_bolsa": "Indicação de negociação em bolsa sujeita a regulação "
                        "e supervisão governamental",
    "participacao_significativa": "Percentual do capital social detido (corte de 10%)",
    "pr_instituicao": "Patrimônio de Referência da instituição investidora",
    "contraparte_varejo": "Natureza da contraparte (pessoa natural ou PJ de pequeno porte)",
    "limite_varejo": "Somatório das exposições com a contraparte e total da "
                     "carteira de varejo",
    "historico_utilizacao": "Histórico de atraso, parcelamento ou saque nos "
                            "últimos 360 dias",
    "ltv": "Razão entre o valor da exposição e o valor do imóvel em garantia",
    "tipo_imovel": "Finalidade de uso do imóvel (residencial ou comercial)",
    "dependencia_fluxo_imovel": "Dependência do fluxo de caixa gerado pelo imóvel",
    "tipo_financiamento_especializado": "Enquadramento como objeto específico, "
                                        "commodities ou projeto",
    "fase_projeto": "Fase do projeto (pré-operacional ou operacional)",
    "qualidade_projeto": "Atendimento aos requisitos de projeto de alta qualidade",
    "ponto_encaixe_A": "Ponto de encaixe (A) da classe de priorização",
    "ponto_desencaixe_D": "Ponto de desencaixe (D) da classe de priorização",
    "razao_inadimplencia_W": "Razão de inadimplência (W) dos ativos subjacentes",
    "capital_hipotetico_K": "Capital hipotético (K) da carteira de ativos subjacentes",
    "classe_priorizacao": "Classe de priorização de pagamento (sênior, mezanino, "
                          "subordinada)",
    "regiao_origem": "Região de origem dos ativos subjacentes da securitização",
    "modalidade_lastro": "Modalidade do lastro da securitização",
    "valor_nocional": "Valor nocional (valor de referência) do derivativo",
    "prazo_derivativo": "Prazo efetivo de vencimento do derivativo, em anos "
                        "(M0 do art. 2º, inciso II, da Resolução BCB nº 291/2023)",
    "liquidacao_ccp": "Indicação de liquidação em câmara com interposição de "
                      "contraparte central",
    "valor_reposicao": "Valor de reposição (marcação a mercado) do derivativo",
    "conjunto_compensacao": "Conjunto de compensação aplicável (netting set)",
    "contraparte_derivativo": "Identificação e FPR da contraparte do derivativo",
    "posse_direta": "Confirmação de posse direta dos valores em espécie",
    "segmento_instituicao": "Segmento prudencial da instituição (S1 a S5)",
    "evento_credito": "Ocorrência de evento de crédito sobre a Referência DRC",
    "politica_investimento": "Política de investimento prevista no regulamento do fundo",
    "patrimonio_liquido_fundo": "Patrimônio líquido do fundo na data-base",
    "limite_alavancagem": "Limite máximo de alavancagem previsto no regulamento",
}


def descrever_campo(campo: str) -> str:
    return DESCRICAO_CAMPOS.get(campo, campo)


def regra_fpr(chave: str) -> RegraFPR:
    return REGRAS_FPR.get(chave, REGRAS_FPR["NAO_CLASSIFICADO"])


def regra_drc(chave: str) -> RegraDRC:
    return REGRAS_DRC.get(chave, REGRAS_DRC["DRC_NAO_CLASSIFICADO"])
