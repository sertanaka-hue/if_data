# -*- coding: utf-8 -*-
"""Classificação dos ativos da carteira (CDA/CVM) em regras de FPR e RW.

O classificador é deliberadamente declarativo: cada regra é um predicado sobre
os campos normalizados do ativo. Quando o dado discriminante não existe na CDA,
a regra registra o campo faltante em vez de arbitrar um enquadramento.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional

from . import regulation as reg


# ---------------------------------------------------------------------------
# Utilitários de texto
# ---------------------------------------------------------------------------

def normalizar(texto) -> str:
    """Minúsculas, sem acentos e sem pontuação redundante."""
    if texto is None:
        return ""
    s = str(texto).strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+", " ", s)
    return s


def so_digitos(texto) -> str:
    return re.sub(r"\D", "", str(texto or ""))


def formatar_cnpj(cnpj) -> str:
    d = so_digitos(cnpj).zfill(14) if so_digitos(cnpj) else ""
    if len(d) != 14:
        return str(cnpj or "")
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"


# ---------------------------------------------------------------------------
# Natureza do instrumento (define o Fator de Perda do RWADRC, art. 6º)
# ---------------------------------------------------------------------------

NAT_ACAO = "acao"
NAT_DIVIDA = "divida_nao_subordinada"
NAT_SUBORDINADA = "divida_subordinada"
NAT_COVERED = "covered_bond"
NAT_COTA_FUNDO = "cota_fundo"
NAT_CAIXA = "caixa"
NAT_DERIVATIVO = "derivativo"
NAT_SECURITIZACAO = "securitizacao"


@dataclass
class Ativo:
    """Um ativo normalizado da carteira de um fundo."""

    descricao: str = ""
    tipo_aplicacao: str = ""          # TP_APLIC da CDA
    tipo_ativo: str = ""              # TP_ATIVO / TP_TITPUB
    codigo: str = ""                  # CD_ATIVO / código ISIN ou negociação
    emissor: str = ""                 # DS_ATIVO / EMISSOR / NM_EMISSOR
    cnpj_emissor: str = ""
    valor: float = 0.0                # VL_MERC_POSI_FINAL
    quantidade: float = 0.0
    #: preenchido quando o ativo é cota de outro fundo
    cnpj_fundo_investido: str = ""
    nome_fundo_investido: str = ""
    #: metadados opcionais que o usuário pode enriquecer (rating, porte, etc.)
    atributos: dict = field(default_factory=dict)
    bloco: str = ""                   # bloco de origem na CDA (BLC_1..BLC_8)
    origem: str = "CVM/CDA"

    @property
    def eh_cota_de_fundo(self) -> bool:
        return bool(so_digitos(self.cnpj_fundo_investido)) or \
            self.natureza == NAT_COTA_FUNDO

    @property
    def natureza(self) -> str:
        return classificar_natureza(self)

    def texto_busca(self) -> str:
        return normalizar(" ".join([
            self.tipo_aplicacao, self.tipo_ativo, self.descricao,
            self.emissor, self.codigo,
        ]))


# ---------------------------------------------------------------------------
# Dicionários de reconhecimento
# ---------------------------------------------------------------------------

TITULOS_PUBLICOS_FEDERAIS = (
    "ltn", "lft", "ntn-b", "ntn-c", "ntn-f", "ntnb", "ntnc", "ntnf",
    "tesouro selic", "tesouro prefixado", "tesouro ipca", "tesouro nacional",
    "titulo publico", "titulos publicos", "btn", "bbc",
)

TITULOS_IF = (
    "cdb", "rdb", "dpge", "letra financeira", "lf ", "lfs", "deposito a prazo",
    "depositos a prazo", "lci", "lca", "letra de credito imobiliario",
    "letra de credito do agronegocio", "dpc", "cdi ", "recibo de deposito bancario",
)

SUBORDINADOS = (
    "subordinad", "lfsn", "lfsc", "perpetu", "tier 1", "tier ii", "tier 2",
    "nivel i", "nivel ii", "at1", "hibrido de capital",
)

SECURITIZACAO = (
    "cri", "cra", "certificado de recebiveis", "fidc", "fiagro",
    "cotas de fidc", "direitos creditorios", "cdca", "cra ", "cri ",
)

ACOES = (
    "acao", "acoes", "acoes ordinarias", "acoes preferenciais", "on ", "pn ",
    "unit", "bdr", "etf", "recibo de subscricao", "bonus de subscricao",
    "certificado de deposito de acoes", "participacao societaria", "spe",
)

DERIVATIVOS = (
    "swap", "futuro", "opcao", "opcoes", "termo", "ndf", "derivativo",
    "mercado futuro", "diferencial de swap", "posicoes compradas",
    "posicoes vendidas", "posicoes titulares", "posicoes lancadas",
)

CAIXA = (
    "disponibilidade", "disponibilidades", "caixa", "conta corrente",
    "valores a receber", "valores a pagar", "saldo em conta",
)

COMPROMISSADAS = (
    "operacoes compromissadas", "compromissada", "operacao compromissada",
)

MULTILATERAIS = (
    "bird", "banco mundial", "bid", "iadb", "bis", "fmi", "imf", "ifc",
    "corporacao financeira internacional", "miga", "ida", "bei", "eib",
    "aiib", "caf", "banco africano", "banco asiatico", "berd", "ebrd",
    "banco nordico", "banco de desenvolvimento do caribe", "esm", "efsf",
)

EXTERIOR = (
    "investimento no exterior", "exterior", "offshore", "treasury",
    "t-bill", "t-note", "us treasury", "bond", "global",
)

DEBENTURES = ("debenture", "debentures", "deb ", "nota promissoria", "commercial paper")


_CACHE_PADROES = {}


def _padrao(termo: str):
    """Compila o termo com fronteira de palavra, evitando falsos positivos
    como 'cri' dentro de 'escritura' ou 'lf' dentro de 'golf'."""
    pat = _CACHE_PADROES.get(termo)
    if pat is None:
        alvo = termo.strip()
        pat = re.compile(r"(?<![0-9a-z])" + re.escape(alvo).replace(r"\ ", r"\s+") +
                         r"(?![0-9a-z])")
        _CACHE_PADROES[termo] = pat
    return pat


def _contem(texto: str, termos) -> bool:
    return any(_padrao(t).search(texto) for t in termos)


def classificar_natureza(ativo: "Ativo") -> str:
    """Natureza do instrumento, usada para o Fator de Perda do RWADRC."""
    t = normalizar(" ".join([ativo.tipo_aplicacao, ativo.tipo_ativo,
                             ativo.descricao, ativo.emissor, ativo.codigo]))
    if so_digitos(ativo.cnpj_fundo_investido) or "cotas de fundo" in t or \
            "cota de fundo" in t:
        return NAT_COTA_FUNDO
    if _contem(t, DERIVATIVOS):
        return NAT_DERIVATIVO
    if _contem(t, CAIXA):
        return NAT_CAIXA
    if _contem(t, SUBORDINADOS):
        return NAT_SUBORDINADA
    if _contem(t, SECURITIZACAO):
        return NAT_SECURITIZACAO
    if _contem(t, ACOES):
        return NAT_ACAO
    if "lci" in t or "lca" in t or "covered bond" in t or "letra imobiliaria garantida" in t:
        return NAT_COVERED
    return NAT_DIVIDA


# ---------------------------------------------------------------------------
# Resultado de uma classificação
# ---------------------------------------------------------------------------

@dataclass
class Enquadramento:
    """Regra aplicada a um ativo, com pendências e premissas explícitas."""

    regra_id: str
    faltantes: List[str] = field(default_factory=list)
    premissas: List[str] = field(default_factory=list)

    def registrar_faltante(self, campo: str):
        if campo not in self.faltantes:
            self.faltantes.append(campo)


# ---------------------------------------------------------------------------
# Classificação para a carteira bancária (RWACPAD, Res. BCB 229/2022)
# ---------------------------------------------------------------------------

def classificar_fpr(ativo: Ativo) -> Enquadramento:
    """Determina a regra de FPR aplicável ao ativo e as pendências de dados."""
    t = ativo.texto_busca()
    attr = ativo.atributos or {}
    enq = Enquadramento(regra_id="NAO_CLASSIFICADO")

    # Cotas de fundos: tratadas pelo motor de look-through (arts. 16 a 18).
    if ativo.eh_cota_de_fundo:
        enq.regra_id = "FUNDO_LOOKTHROUGH"
        return enq

    # Disponibilidades e caixa (art. 23, II; art. 26).
    if _contem(t, CAIXA):
        if attr.get("posse_direta") is False:
            enq.regra_id = "CAIXA_NAO_CUSTODIA_PROPRIA"
        else:
            enq.regra_id = "CAIXA_BRL"
            if "posse_direta" not in attr:
                enq.premissas.append(
                    "Assumida posse direta dos valores em espécie; caso contrário "
                    "aplica-se piso de 20% (art. 26).")
        return enq

    # Derivativos: exposição por SA-CCR/CEM (art. 11 c/c art. 17, §§ 4º a 6º).
    if _contem(t, DERIVATIVOS):
        enq.regra_id = "DERIVATIVO_CCR"
        for campo in reg.REGRAS_FPR["DERIVATIVO_CCR"].requer:
            if campo not in attr:
                enq.registrar_faltante(campo)
        return enq

    # Títulos públicos federais (art. 23, I).
    if _contem(t, TITULOS_PUBLICOS_FEDERAIS) or "titulos publicos" in normalizar(
            ativo.tipo_aplicacao):
        if _contem(t, EXTERIOR) and "brasil" not in t:
            return _classificar_soberano_estrangeiro(attr, enq)
        enq.regra_id = "SOBERANO_BR"
        return enq

    # Organismos multilaterais (art. 27).
    if _contem(t, MULTILATERAIS):
        enq.regra_id = "MULTILATERAL_0"
        return enq

    # Investimento no exterior sem identificação do emissor.
    if _contem(t, EXTERIOR) and not ativo.emissor:
        enq.regra_id = "NAO_CLASSIFICADO"
        enq.registrar_faltante("rating_soberano")
        enq.registrar_faltante("porte_emissor")
        enq.premissas.append(
            "Ativo no exterior sem identificação do emissor na CDA: exposição "
            "tratada como fração não identificada (art. 17, § 8º).")
        return enq

    # Dívida subordinada (art. 44), inclusive LF subordinada.
    if _contem(t, SUBORDINADOS):
        enq.regra_id = "DIVIDA_SUBORDINADA"
        return enq

    # Securitização (arts. 61 e 62).
    if _contem(t, SECURITIZACAO):
        classe = attr.get("classe_priorizacao")
        if classe and normalizar(classe) in ("senior", "unica", "classe unica"):
            enq.regra_id = "SECURITIZACAO_SENIOR_COMO_FUNDO"
            enq.premissas.append(
                "Classe sênior apurada como exposição a fundo de investimento "
                "(art. 19, § 2º).")
            return enq
        enq.regra_id = "SECURITIZACAO_SEM_DADOS"
        for campo in reg.REGRAS_FPR["SECURITIZACAO_SEM_DADOS"].requer:
            if campo not in attr:
                enq.registrar_faltante(campo)
        return enq

    # Ações e participações societárias (arts. 42 a 45).
    if _contem(t, ACOES):
        if attr.get("participacao_significativa"):
            enq.regra_id = "PARTIC_SIGNIFICATIVA"
            return enq
        listada = attr.get("listada_em_bolsa")
        if listada is False:
            enq.regra_id = "ACAO_NAO_LISTADA"
            return enq
        enq.regra_id = "ACAO_LISTADA"
        if listada is None:
            enq.premissas.append(
                "Assumida entidade listada em bolsa (FPR de 250%, art. 43, III). "
                "Se não listada e não integrada operacionalmente, o FPR é de 400% "
                "(art. 43, I).")
            enq.registrar_faltante("listada_em_bolsa")
        return enq

    # Títulos de instituições financeiras (art. 33).
    if _contem(t, TITULOS_IF) or _contem(t, COMPROMISSADAS):
        return _classificar_if(attr, enq)

    # Debêntures e demais créditos corporativos (arts. 35, 36 e 41).
    if _contem(t, DEBENTURES) or ativo.emissor:
        return _classificar_corporativo(attr, enq)

    enq.regra_id = "NAO_CLASSIFICADO"
    enq.registrar_faltante("porte_emissor")
    enq.premissas.append(
        "Ativo sem elementos suficientes na CDA para identificar a contraparte "
        "(art. 17, § 1º).")
    return enq


def _classificar_soberano_estrangeiro(attr, enq: Enquadramento) -> Enquadramento:
    rating = normalizar(attr.get("rating_soberano", ""))
    if not rating:
        enq.regra_id = "SOBERANO_EXT_B"
        enq.registrar_faltante("rating_soberano")
        enq.premissas.append(
            "Sem classificação externa disponível: aplicado FPR de 100% "
            "(art. 25, IV, que equipara a ausência de rating).")
        return enq
    escala = [
        ("aaa", "SOBERANO_EXT_AA"), ("aa", "SOBERANO_EXT_AA"),
        ("a", "SOBERANO_EXT_A"), ("bbb", "SOBERANO_EXT_BBB"),
        ("bb", "SOBERANO_EXT_B"), ("b", "SOBERANO_EXT_B"),
    ]
    for prefixo, chave in escala:
        if rating.startswith(prefixo):
            enq.regra_id = chave
            return enq
    enq.regra_id = "SOBERANO_EXT_SUBB"
    return enq


def _classificar_if(attr, enq: Enquadramento) -> Enquadramento:
    categoria = normalizar(attr.get("categoria_risco_if", ""))
    prazo = attr.get("prazo_original")
    if not categoria:
        enq.regra_id = "IF_CAT_B_LONGO"
        enq.registrar_faltante("categoria_risco_if")
        enq.premissas.append(
            "Categoria de risco da instituição não informada: aplicado o FPR da "
            "categoria B para prazo superior a 90 dias (75%), tratamento "
            "conservador frente à categoria A.")
        if prazo is None:
            enq.registrar_faltante("prazo_original")
        return enq
    if categoria == "c":
        enq.regra_id = "IF_CAT_C"
        return enq
    curto = prazo is not None and float(prazo) <= 90
    if prazo is None:
        enq.registrar_faltante("prazo_original")
        enq.premissas.append(
            "Prazo de vencimento original não informado: aplicado o FPR de prazo "
            "superior a 90 dias, mais conservador.")
    if categoria == "a":
        if (attr.get("indice_capital_principal") or 0) >= 0.14 and \
                (attr.get("razao_alavancagem") or 0) >= 0.05 and not curto:
            enq.regra_id = "IF_CAT_A_LONGO_REDUZIDO"
        else:
            enq.regra_id = "IF_CAT_A_CURTO" if curto else "IF_CAT_A_LONGO"
    else:
        enq.regra_id = "IF_CAT_B_CURTO" if curto else "IF_CAT_B_LONGO"
    return enq


def _classificar_corporativo(attr, enq: Enquadramento) -> Enquadramento:
    porte = normalizar(attr.get("porte_emissor", ""))
    if not porte:
        enq.regra_id = "PJ_DEMAIS"
        enq.registrar_faltante("porte_emissor")
        enq.premissas.append(
            "Porte do emissor não disponível na CDA: aplicado o FPR residual de "
            "100% (art. 41). Com ativo total > R$240 mi ou receita > R$300 mi e "
            "demais requisitos do art. 35, o FPR cai para 65%; para pequeno e "
            "médio porte, 85% (art. 36).")
        return enq
    if porte.startswith("grande"):
        if attr.get("demonstracoes_auditadas") and not attr.get("ativo_problematico"):
            enq.regra_id = "PJ_GRANDE_BAIXO_RISCO"
        else:
            enq.regra_id = "PJ_DEMAIS"
            if "demonstracoes_auditadas" not in attr:
                enq.registrar_faltante("demonstracoes_auditadas")
            if "ativo_problematico" not in attr:
                enq.registrar_faltante("ativo_problematico")
        return enq
    if porte.startswith("pequeno") or porte.startswith("medio"):
        enq.regra_id = "PJ_PEQUENO_MEDIO"
        return enq
    if porte.startswith("varejo"):
        enq.regra_id = "VAREJO"
        return enq
    enq.regra_id = "PJ_DEMAIS"
    return enq


# ---------------------------------------------------------------------------
# Classificação para a carteira de negociação (RWADRC, Res. BCB 313/2023)
# ---------------------------------------------------------------------------

def classificar_drc(ativo: Ativo) -> Enquadramento:
    """Determina a regra de RW/FP do RWADRC aplicável ao ativo."""
    t = ativo.texto_busca()
    attr = ativo.atributos or {}
    enq = Enquadramento(regra_id="DRC_NAO_CLASSIFICADO")

    if attr.get("evento_credito"):
        enq.regra_id = "DRC_EVENTO_CREDITO"
        return enq

    if ativo.eh_cota_de_fundo:
        # Art. 14: fundo com uma única classe de priorização é Referência DRC
        # específica com RW de 15%; art. 4º, § 7º trata a cota como ação.
        if attr.get("politica_investimento") == "emissores_inadimplentes":
            enq.regra_id = "DRC_FUNDO_EMISSORES_INADIMPLENTES"
        else:
            enq.regra_id = "DRC_FUNDO_CLASSE_UNICA"
        return enq

    if _contem(t, CAIXA):
        enq.regra_id = "DRC_SOBERANO_BR"
        enq.premissas.append(
            "Disponibilidades em reais tratadas com RW de 0% (art. 12, I).")
        return enq

    natureza = ativo.natureza

    # Derivativos antes dos demais ramos: a presença de emissor não pode
    # desviar um swap ou futuro para o tratamento de crédito corporativo.
    if natureza == NAT_DERIVATIVO:
        enq.regra_id = "DRC_NAO_CLASSIFICADO"
        enq.registrar_faltante("valor_nocional")
        enq.registrar_faltante("contraparte_derivativo")
        enq.premissas.append(
            "Derivativo: o JTD depende do ValorBase e do ativo subjacente "
            "(art. 4º, §§ 4º a 6º); a parcela RWACVA (Res. BCB 291/2023) é "
            "apurada à parte e não está incluída neste total.")
        return enq

    if natureza == NAT_SECURITIZACAO:
        enq.regra_id = "DRC_SECURITIZACAO"
        for campo in reg.REGRAS_DRC["DRC_SECURITIZACAO"].requer:
            if campo not in attr:
                enq.registrar_faltante(campo)
        return enq

    # Soberano.
    if _contem(t, TITULOS_PUBLICOS_FEDERAIS) or "titulos publicos" in normalizar(
            ativo.tipo_aplicacao):
        if _contem(t, EXTERIOR) and "brasil" not in t:
            rating = normalizar(attr.get("rating_soberano", ""))
            mapa = [("aaa", "DRC_SOBERANO_AAA"), ("aa", "DRC_SOBERANO_AA"),
                    ("a", "DRC_SOBERANO_A"), ("bbb", "DRC_SOBERANO_BBB"),
                    ("bb", "DRC_SOBERANO_BB"), ("b", "DRC_SOBERANO_B"),
                    ("ccc", "DRC_SOBERANO_CCC")]
            for prefixo, chave in mapa:
                if rating.startswith(prefixo):
                    enq.regra_id = chave
                    return enq
            enq.regra_id = "DRC_SOBERANO_SEM_RATING"
            enq.registrar_faltante("rating_soberano")
            return enq
        enq.regra_id = "DRC_SOBERANO_BR"
        return enq

    if _contem(t, MULTILATERAIS):
        enq.regra_id = "DRC_MULTILATERAL"
        return enq

    if natureza == NAT_SUBORDINADA:
        enq.regra_id = "DRC_SUBORDINADA"
        enq.premissas.append(
            "Dívida subordinada: Fator de Perda de 100% (art. 6º, I, 'b') com RW "
            "residual de 30% (art. 10, IV) na ausência de categoria de risco.")
        enq.registrar_faltante("categoria_risco_if")
        return enq

    if natureza == NAT_ACAO:
        if attr.get("investment_grade") and normalizar(
                attr.get("porte_emissor", "")).startswith("grande"):
            enq.regra_id = "DRC_ACAO_IG"
        else:
            enq.regra_id = "DRC_ACAO"
            if "investment_grade" not in attr:
                enq.premissas.append(
                    "Sem avaliação de investment grade: aplicado RW residual de 30% "
                    "(art. 10, IV).")
        return enq

    # Títulos de instituição financeira.
    if _contem(t, TITULOS_IF) or _contem(t, COMPROMISSADAS):
        categoria = normalizar(attr.get("categoria_risco_if", ""))
        if categoria == "a":
            enq.regra_id = "DRC_IF_A"
        elif categoria == "b":
            enq.regra_id = "DRC_IF_B"
        else:
            enq.regra_id = "DRC_DEMAIS_30"
            enq.registrar_faltante("categoria_risco_if")
            enq.premissas.append(
                "Categoria de risco da instituição não informada: aplicado RW de "
                "30% (art. 10, IV).")
        return enq

    # Crédito corporativo.
    if _contem(t, DEBENTURES) or ativo.emissor:
        porte = normalizar(attr.get("porte_emissor", ""))
        if porte.startswith("grande") and attr.get("investment_grade"):
            enq.regra_id = "DRC_CORP_IG"
        elif porte.startswith("grande"):
            enq.regra_id = "DRC_CORP_GRANDE_15"
            if "investment_grade" not in attr:
                enq.registrar_faltante("investment_grade")
        else:
            enq.regra_id = "DRC_DEMAIS_30"
            if not porte:
                enq.registrar_faltante("porte_emissor")
                enq.registrar_faltante("investment_grade")
                enq.premissas.append(
                    "Porte e qualidade creditícia do emissor não disponíveis na CDA: "
                    "aplicado RW de 30% (art. 10, IV).")
        return enq

    enq.regra_id = "DRC_NAO_CLASSIFICADO"
    enq.registrar_faltante("porte_emissor")
    return enq
