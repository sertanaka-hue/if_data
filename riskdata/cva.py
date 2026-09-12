# -*- coding: utf-8 -*-
"""Parcela RWA_CVA — Resolução BCB nº 291, de 8/2/2023.

Risco de variação do valor dos instrumentos financeiros derivativos em
decorrência da variação da qualidade creditícia da contraparte.

Abordagem completa (art. 2º, caput), com reconhecimento de hedge:

    RWA_CVA = 2,33 × 0,01 × (1/F) × raiz(
        ( Σ_i 0,5 × (d_i × EXP_i − Σ_h d_i^h × B_i^h) − Σ_ind d_ind × B_ind )²
      + Σ_i 0,75 × (d_i × EXP_i − Σ_h d_i^h × B_i^h)² )

Abordagem alternativa (art. 2º, § 2º), sem reconhecimento de hedge e sem
necessidade de prazo:

    RWA_CVA = 0,1 × (1/F) × raiz( 0,25 × (Σ_i EXP_i)² + 0,75 × Σ_i EXP_i² )

Fatores de desconto (art. 2º, incisos II, IV e VI):

    d = (1 − e^(−0,05 × M)) / 0,05

com M_i = Σ(M_0 × R_0) / Σ R_0, o prazo médio ponderado por valor de
referência da contraparte "i" (art. 2º, inciso II, alínea "a").

EXP_i é a exposição apurada pelos Anexos I (SA-CCR) e II (CEM) da Resolução
BCB nº 229/2022, por contraparte (art. 2º, inciso III). Para derivativos
integrantes da carteira de fundos de investimento, a Resolução BCB nº 229/2022
admite, na impossibilidade de apurar o valor de reposição e o ganho potencial
futuro, o uso do valor nocional e do fator de 15% (art. 17, §§ 5º e 6º).

Art. 3º: a parcela alcança tanto a carteira bancária quanto a de negociação.
"""

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from . import regulation as reg
from .taxonomy import normalizar

RES_291 = reg.RES_291

# --- constantes da fórmula --------------------------------------------------

#: 2,33 × 0,01, fator de escala da abordagem completa (art. 2º, caput).
FATOR_ESCALA_COMPLETA = 2.33 * 0.01
#: 0,1, fator de escala da abordagem alternativa (art. 2º, § 2º).
FATOR_ESCALA_ALTERNATIVA = 0.10
#: Correlação supervisória embutida nas fórmulas (0,5 e 0,5² = 0,25).
RHO = 0.5
#: Taxa de decaimento do fator de desconto (art. 2º, inciso II).
DECAIMENTO = 0.05

#: Alfa do SA-CCR (Anexo I da Resolução BCB nº 229/2022).
ALFA_SACCR = 1.4
#: Fator de ganho potencial futuro admitido para derivativos de fundos
#: (Resolução BCB nº 229/2022, art. 17, § 6º).
FEPF_FUNDO = 0.15

METODO_COMPLETO = "completa"
METODO_ALTERNATIVO = "alternativa"
CCR_SACCR = "sa-ccr"
CCR_CEM = "cem"


def fator_desconto(prazo_anos: float) -> float:
    """d = (1 − e^(−0,05 × M)) / 0,05 (art. 2º, incisos II, IV e VI)."""
    if prazo_anos is None or prazo_anos <= 0:
        return 0.0
    return (1.0 - math.exp(-DECAIMENTO * float(prazo_anos))) / DECAIMENTO


def prazo_medio_ponderado(operacoes: List[Tuple[float, float]]) -> Optional[float]:
    """M_i = Σ(M_0 × R_0) / Σ R_0, sobre pares (prazo_anos, valor_referencia)."""
    numerador = 0.0
    denominador = 0.0
    for prazo, referencia in operacoes:
        if prazo is None or referencia is None or referencia <= 0:
            continue
        numerador += float(prazo) * float(referencia)
        denominador += float(referencia)
    if denominador <= 0:
        return None
    return numerador / denominador


# ---------------------------------------------------------------------------
# Estruturas
# ---------------------------------------------------------------------------

@dataclass
class Derivativo:
    """Um derivativo da carteira, já atribuído à instituição pelo look-through."""

    descricao: str = ""
    tipo: str = ""
    contraparte: str = ""
    #: valor de referência (nocional) da operação — R_0 do art. 2º, II, "b"
    nocional: Optional[float] = None
    #: valor de reposição (marcação a mercado positiva)
    valor_reposicao: Optional[float] = None
    #: prazo efetivo de vencimento em anos — M_0
    prazo_anos: Optional[float] = None
    #: valor de mercado informado na CDA, usado apenas como referência
    valor_mercado: float = 0.0
    #: True quando a liquidação ocorre em contraparte central (art. 2º, § 1º, I)
    liquidacao_ccp: Optional[bool] = None
    #: True quando a contraparte é soberano ou multilateral (art. 2º, § 1º, II)
    contraparte_isenta: bool = False
    #: True para swap de crédito em que a instituição recebe o risco (§ 1º, III)
    receptor_risco_credito: bool = False
    fundo_nome: str = ""
    fundo_cnpj: str = ""
    nivel: int = 0


@dataclass
class HedgeCredito:
    """Derivativo de crédito usado como hedge de CVA (art. 2º, IV a VII)."""

    contraparte: str = ""          # vazio para índice (B_ind)
    valor_referencia: float = 0.0  # B_i^h ou B_ind
    prazo_anos: float = 0.0        # M_i^h ou M_ind
    indice: bool = False
    descricao: str = ""


@dataclass
class DetalheContraparte:
    contraparte: str
    exposicao: float = 0.0             # EXP_i
    prazo_medio: Optional[float] = None  # M_i
    fator_desconto: Optional[float] = None  # d_i
    termo: float = 0.0                 # d_i × EXP_i − Σ_h d_i^h × B_i^h
    hedge_reconhecido: float = 0.0
    qtd_operacoes: int = 0
    premissas: List[str] = field(default_factory=list)
    faltantes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = dict(self.__dict__)
        d["faltantes_descritos"] = [reg.descrever_campo(c) for c in self.faltantes]
        return d


@dataclass
class ResultadoCVA:
    metodo: str
    metodo_ccr: str
    rwa: float = 0.0
    capital: float = 0.0
    exposicao_total: float = 0.0
    contrapartes: List[DetalheContraparte] = field(default_factory=list)
    excluidos: List[dict] = field(default_factory=list)
    nao_apurados: List[dict] = field(default_factory=list)
    avisos: List[str] = field(default_factory=list)
    qtd_derivativos: int = 0
    qtd_considerados: int = 0
    valor_nao_apurado: float = 0.0
    calculavel: bool = True
    base_legal: str = f"{RES_291}, art. 2º"

    def to_dict(self) -> dict:
        d = dict(self.__dict__)
        d["contrapartes"] = [c.to_dict() for c in self.contrapartes]
        return d


# ---------------------------------------------------------------------------
# Exposição de contraparte (EXP_i)
# ---------------------------------------------------------------------------

def exposicao_ccr(derivativo: Derivativo, metodo_ccr: str = CCR_SACCR
                  ) -> Tuple[Optional[float], List[str], List[str]]:
    """EXP de um derivativo pelos Anexos I/II da Resolução BCB nº 229/2022.

    Aplica as faculdades do art. 17, §§ 5º e 6º, daquela resolução quando o
    valor de reposição ou o ganho potencial futuro do derivativo do fundo não
    podem ser determinados.
    """
    premissas: List[str] = []
    faltantes: List[str] = []

    reposicao = derivativo.valor_reposicao
    nocional = derivativo.nocional

    if reposicao is None and nocional is None:
        faltantes.append("valor_nocional")
        faltantes.append("valor_reposicao")
        return None, premissas, faltantes

    if reposicao is None:
        # Art. 17, § 5º: o valor de reposição corresponde ao somatório dos
        # nocionais (SA-CCR, inciso I) ou ao nocional do derivativo (CEM, II).
        reposicao = float(nocional)
        premissas.append(
            "Valor de reposição não disponível: utilizado o valor nocional, na "
            f"forma do art. 17, § 5º, da {reg.RES_229}.")

    if nocional is None:
        faltantes.append("valor_nocional")
        return None, premissas, faltantes

    # Art. 17, § 6º: ganho potencial futuro pelo fator de 15% sobre o nocional.
    ganho_potencial = float(nocional) * FEPF_FUNDO
    premissas.append(
        "Ganho potencial futuro apurado pelo fator de 15% sobre o valor "
        f"nocional, na forma do art. 17, § 6º, da {reg.RES_229}.")

    if metodo_ccr == CCR_CEM:
        exposicao = max(reposicao, 0.0) + ganho_potencial
        premissas.append(
            f"Exposição apurada pela abordagem CEM (Anexo II da {reg.RES_229}).")
    else:
        exposicao = ALFA_SACCR * (max(reposicao, 0.0) + ganho_potencial)
        premissas.append(
            "Exposição apurada pela Abordagem SA-CCR, com alfa de 1,4 "
            f"(Anexo I da {reg.RES_229}).")

    return exposicao, premissas, faltantes


# ---------------------------------------------------------------------------
# Exclusões do art. 2º, § 1º
# ---------------------------------------------------------------------------

#: Termos que indicam liquidação em contraparte central (art. 2º, § 1º, I).
TERMOS_CCP = ("b3", "bm&f", "bmf", "bovespa", "camara", "contraparte central",
              "ccp", "qccp", "clearing", "bolsa")

#: Derivativos padronizados de bolsa, sempre liquidados por contraparte central.
TIPOS_BOLSA = ("futuro", "mercado futuro", "opcao de bolsa", "posicoes compradas",
               "posicoes vendidas", "posicoes titulares", "posicoes lancadas")


def _liquidado_em_ccp(derivativo: Derivativo) -> bool:
    if derivativo.liquidacao_ccp is not None:
        return bool(derivativo.liquidacao_ccp)
    texto = normalizar(" ".join([derivativo.tipo, derivativo.descricao,
                                 derivativo.contraparte]))
    if any(t in texto for t in TIPOS_BOLSA):
        return True
    return any(t in texto for t in TERMOS_CCP)


def avaliar_exclusao(derivativo: Derivativo) -> Optional[dict]:
    """Devolve o motivo da exclusão do derivativo, ou None se ele entra no cálculo."""
    if _liquidado_em_ccp(derivativo):
        return {"motivo": "Operação liquidada em câmara ou prestador de serviços "
                          "com interposição de contraparte central.",
                "artigo": "Art. 2º, § 1º, inciso I", "resolucao": RES_291}
    if derivativo.contraparte_isenta:
        return {"motivo": "Contraparte é a União, o Banco Central do Brasil ou "
                          "organismo multilateral / EMD.",
                "artigo": "Art. 2º, § 1º, inciso II", "resolucao": RES_291}
    if derivativo.receptor_risco_credito:
        return {"motivo": "Swap de crédito em que a instituição figura como "
                          "contraparte receptora do risco.",
                "artigo": "Art. 2º, § 1º, inciso III", "resolucao": RES_291}
    return None


# ---------------------------------------------------------------------------
# Cálculo da parcela
# ---------------------------------------------------------------------------

def calcular(derivativos: List[Derivativo],
             hedges: Optional[List[HedgeCredito]] = None,
             metodo: str = METODO_ALTERNATIVO,
             metodo_ccr: str = CCR_SACCR,
             fator_f: float = reg.FATOR_F) -> ResultadoCVA:
    """Apura a parcela RWA_CVA sobre os derivativos informados."""
    hedges = hedges or []
    resultado = ResultadoCVA(metodo=metodo, metodo_ccr=metodo_ccr)
    resultado.qtd_derivativos = len(derivativos)
    resultado.base_legal = (f"{RES_291}, art. 2º, § 2º"
                            if metodo == METODO_ALTERNATIVO
                            else f"{RES_291}, art. 2º, caput")

    # 1) Exclusões do § 1º e apuração de EXP por operação.
    por_contraparte: Dict[str, List[Tuple[Derivativo, float]]] = {}
    for derivativo in derivativos:
        exclusao = avaliar_exclusao(derivativo)
        if exclusao:
            resultado.excluidos.append({
                "descricao": derivativo.descricao,
                "fundo": derivativo.fundo_nome,
                "valor_mercado": derivativo.valor_mercado,
                **exclusao})
            continue

        exposicao, premissas, faltantes = exposicao_ccr(derivativo, metodo_ccr)
        if exposicao is None:
            resultado.nao_apurados.append({
                "descricao": derivativo.descricao,
                "fundo": derivativo.fundo_nome,
                "contraparte": derivativo.contraparte or "Não identificada",
                "valor_mercado": derivativo.valor_mercado,
                "faltantes": faltantes,
                "faltantes_descritos": [reg.descrever_campo(c) for c in faltantes],
                "artigo": "Art. 2º, inciso III",
                "resolucao": RES_291})
            resultado.valor_nao_apurado += derivativo.valor_mercado
            continue

        chave = derivativo.contraparte.strip() or "Contraparte não identificada"
        por_contraparte.setdefault(chave, []).append((derivativo, exposicao))
        for premissa in premissas:
            if premissa not in resultado.avisos:
                resultado.avisos.append(premissa)

    # 2) Consolidação por contraparte.
    hedges_por_contraparte: Dict[str, List[HedgeCredito]] = {}
    hedges_indice: List[HedgeCredito] = []
    for hedge in hedges:
        if hedge.indice or not hedge.contraparte:
            hedges_indice.append(hedge)
        else:
            hedges_por_contraparte.setdefault(hedge.contraparte.strip(), []).append(hedge)

    for chave, operacoes in sorted(por_contraparte.items()):
        detalhe = DetalheContraparte(contraparte=chave)
        detalhe.qtd_operacoes = len(operacoes)
        detalhe.exposicao = sum(exp for _, exp in operacoes)

        pares = [(d.prazo_anos, d.nocional) for d, _ in operacoes
                 if d.prazo_anos is not None and d.nocional]
        detalhe.prazo_medio = prazo_medio_ponderado(pares) if pares else None

        if metodo == METODO_COMPLETO:
            if detalhe.prazo_medio is None:
                detalhe.faltantes.append("prazo_derivativo")
                detalhe.premissas.append(
                    "Prazo médio ponderado não apurável: a abordagem completa do "
                    "art. 2º, caput, exige o prazo efetivo de vencimento e o valor "
                    "de referência de cada operação.")
                detalhe.fator_desconto = None
                detalhe.termo = 0.0
            else:
                detalhe.fator_desconto = fator_desconto(detalhe.prazo_medio)
                bruto = detalhe.fator_desconto * detalhe.exposicao
                protecao = sum(fator_desconto(h.prazo_anos) * h.valor_referencia
                               for h in hedges_por_contraparte.get(chave, []))
                detalhe.hedge_reconhecido = protecao
                detalhe.termo = bruto - protecao
        else:
            detalhe.termo = detalhe.exposicao

        resultado.contrapartes.append(detalhe)

    resultado.exposicao_total = sum(c.exposicao for c in resultado.contrapartes)
    resultado.qtd_considerados = sum(c.qtd_operacoes for c in resultado.contrapartes)

    # 3) Agregação com a correlação supervisória.
    termos = [c.termo for c in resultado.contrapartes]
    if not termos:
        resultado.rwa = 0.0
        resultado.capital = 0.0
        resultado.calculavel = not resultado.nao_apurados
        if resultado.nao_apurados:
            resultado.avisos.append(
                "Nenhum derivativo pôde ter a exposição apurada; a parcela RWA_CVA "
                "não foi calculada.")
        return resultado

    soma_ponderada = RHO * sum(termos)
    if metodo == METODO_COMPLETO:
        protecao_indice = sum(fator_desconto(h.prazo_anos) * h.valor_referencia
                              for h in hedges_indice)
        soma_ponderada -= protecao_indice
        escala = FATOR_ESCALA_COMPLETA
    else:
        escala = FATOR_ESCALA_ALTERNATIVA

    soma_quadrados = (1.0 - RHO ** 2) * sum(t ** 2 for t in termos)
    raiz = math.sqrt(soma_ponderada ** 2 + soma_quadrados)

    resultado.rwa = escala * (1.0 / fator_f) * raiz
    resultado.capital = resultado.rwa * fator_f
    resultado.calculavel = True

    if resultado.nao_apurados:
        resultado.avisos.append(
            f"{len(resultado.nao_apurados)} derivativo(s) ficaram fora da parcela "
            f"por falta de valor nocional ou de reposição; o RWA_CVA apurado está "
            f"subestimado nessa medida.")
    return resultado
