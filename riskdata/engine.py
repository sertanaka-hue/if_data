# -*- coding: utf-8 -*-
"""Motores de cálculo de RWA sobre a carteira aberta por transparência.

Cenário 1 - Carteira de negociação
    RWADRC (Resolução BCB nº 313/2023): JTD = ValorBase x FP (art. 4º c/c art. 6º),
    DRC por categoria (art. 15) e RWADRC = (1/F) x DRC (art. 3º, com F = 8%).
    A parcela RWACPAD alcança, na carteira de negociação, apenas o risco de
    crédito de contraparte (Res. BCB 229/2022, art. 3º, II); o risco de mercado
    das posições corre pelo RWAMPAD, fora do escopo destes normativos.

Cenário 2 - Carteira bancária
    RWACPAD (Resolução BCB nº 229/2022): RWA = soma das exposições ponderadas
    pelos respectivos FPR (art. 2º), com a abertura dos arts. 16 a 18 e o
    tratamento do art. 59 para cotas de fundos.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from . import regulation as reg
from .lookthrough import Folha, ResultadoLookthrough
from .taxonomy import classificar_drc, classificar_fpr, formatar_cnpj

CENARIO_NEGOCIACAO = "negociacao"
CENARIO_BANCARIA = "bancaria"

#: Adicional de Capital Principal de conservação (Res. CMN 4.958/2021).
ACP_CONSERVACAO = 0.025


@dataclass
class LinhaRelatorio:
    """Uma linha do relatório: um ativo final com seu FPR/RW e RWA."""

    fundo_nome: str
    fundo_cnpj: str
    fundo_categoria: str
    fundo_gestor: str
    fundo_administrador: str
    nivel: int
    caminho: List[str]
    ativo: str
    tipo_aplicacao: str
    tipo_ativo: str
    codigo: str
    emissor: str
    valor: float                  # exposição atribuída à instituição
    # --- ponderação -----------------------------------------------------
    fator: float                  # FPR (bancária) ou RW (negociação)
    fator_pct: str
    resolucao: str
    artigo: str
    base_legal: str
    descricao_regra: str
    rwa: float
    # --- específicos do DRC ---------------------------------------------
    fator_perda: Optional[float] = None
    artigo_fator_perda: str = ""
    jtd: Optional[float] = None
    categoria_drc: str = ""
    # --- diagnóstico -----------------------------------------------------
    faltantes: List[str] = field(default_factory=list)
    premissas: List[str] = field(default_factory=list)
    observacoes: List[str] = field(default_factory=list)
    conservadora: bool = False
    residual: bool = False
    participacao: float = 1.0

    def to_dict(self) -> dict:
        d = dict(self.__dict__)
        d["caminho_formatado"] = " > ".join(formatar_cnpj(c) for c in self.caminho)
        d["faltantes_descritos"] = [reg.descrever_campo(c) for c in self.faltantes]
        return d


@dataclass
class ResumoCenario:
    cenario: str
    rotulo: str
    exposicao_total: float = 0.0
    rwa_total: float = 0.0
    capital_minimo: float = 0.0
    capital_com_acp: float = 0.0
    fpr_medio: float = 0.0
    qtd_linhas: int = 0
    qtd_com_pendencia: int = 0
    valor_com_pendencia: float = 0.0
    rwa_por_artigo: List[dict] = field(default_factory=list)
    rwa_por_classe: List[dict] = field(default_factory=list)
    teto_aplicado: bool = False
    observacoes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


# ---------------------------------------------------------------------------
# Cenário 2 - Carteira bancária (RWACPAD)
# ---------------------------------------------------------------------------

def calcular_bancaria(folhas: List[Folha]) -> List[LinhaRelatorio]:
    linhas = []
    for folha in folhas:
        ativo = folha.ativo
        if folha.residual:
            enq = type("E", (), {"regra_id": "FUNDO_NAO_IDENTIFICADO",
                                 "faltantes": ["composicao_carteira"],
                                 "premissas": []})()
        else:
            enq = classificar_fpr(ativo)
        regra = reg.regra_fpr(enq.regra_id)
        valor = folha.valor_atribuido
        rwa = valor * regra.fpr
        linhas.append(LinhaRelatorio(
            fundo_nome=folha.fundo_nome, fundo_cnpj=folha.fundo_cnpj,
            fundo_categoria=folha.fundo_categoria, fundo_gestor=folha.fundo_gestor,
            fundo_administrador=folha.fundo_administrador, nivel=folha.nivel,
            caminho=folha.caminho,
            ativo=ativo.descricao or ativo.tipo_ativo or ativo.tipo_aplicacao,
            tipo_aplicacao=ativo.tipo_aplicacao, tipo_ativo=ativo.tipo_ativo,
            codigo=ativo.codigo, emissor=ativo.emissor or ativo.nome_fundo_investido,
            valor=valor, fator=regra.fpr, fator_pct=regra.fpr_pct,
            resolucao=regra.resolucao, artigo=regra.artigo,
            base_legal=regra.base_legal, descricao_regra=regra.descricao,
            rwa=rwa, faltantes=list(enq.faltantes), premissas=list(enq.premissas),
            observacoes=list(folha.observacoes), conservadora=regra.conservadora,
            residual=folha.residual, participacao=folha.fator))
    return linhas


# ---------------------------------------------------------------------------
# Cenário 1 - Carteira de negociação (RWADRC)
# ---------------------------------------------------------------------------

def calcular_negociacao(folhas: List[Folha]) -> List[LinhaRelatorio]:
    linhas = []
    for folha in folhas:
        ativo = folha.ativo
        if folha.residual:
            enq = type("E", (), {"regra_id": "DRC_NAO_CLASSIFICADO",
                                 "faltantes": ["composicao_carteira"],
                                 "premissas": []})()
        else:
            enq = classificar_drc(ativo)
        regra = reg.regra_drc(enq.regra_id)
        valor = folha.valor_atribuido
        # JTD = ValorBase x FP (art. 4º, I, c/c art. 6º). Posições compradas.
        jtd = valor * regra.fp
        # DRC da categoria (art. 15) sem compensação: soma de RW x JTDL.
        drc = jtd * regra.rw
        rwa = drc * reg.MULTIPLICADOR_DRC
        linhas.append(LinhaRelatorio(
            fundo_nome=folha.fundo_nome, fundo_cnpj=folha.fundo_cnpj,
            fundo_categoria=folha.fundo_categoria, fundo_gestor=folha.fundo_gestor,
            fundo_administrador=folha.fundo_administrador, nivel=folha.nivel,
            caminho=folha.caminho,
            ativo=ativo.descricao or ativo.tipo_ativo or ativo.tipo_aplicacao,
            tipo_aplicacao=ativo.tipo_aplicacao, tipo_ativo=ativo.tipo_ativo,
            codigo=ativo.codigo, emissor=ativo.emissor or ativo.nome_fundo_investido,
            valor=valor, fator=regra.rw, fator_pct=regra.rw_pct,
            resolucao=regra.resolucao, artigo=regra.artigo,
            base_legal=regra.base_legal, descricao_regra=regra.descricao,
            rwa=rwa, fator_perda=regra.fp, artigo_fator_perda=regra.artigo_fp,
            jtd=jtd, categoria_drc=regra.categoria,
            faltantes=list(enq.faltantes), premissas=list(enq.premissas),
            observacoes=list(folha.observacoes), conservadora=regra.conservadora,
            residual=folha.residual, participacao=folha.fator))
    return linhas


# ---------------------------------------------------------------------------
# Consolidação
# ---------------------------------------------------------------------------

def _agrupar(linhas: List[LinhaRelatorio], chave_func, rotulo_func) -> List[dict]:
    grupos: Dict[str, dict] = {}
    total_rwa = sum(l.rwa for l in linhas) or 1.0
    for linha in linhas:
        chave = chave_func(linha)
        g = grupos.setdefault(chave, {
            "chave": chave, "rotulo": rotulo_func(linha),
            "exposicao": 0.0, "rwa": 0.0, "qtd": 0,
            "resolucao": linha.resolucao, "artigo": linha.artigo,
        })
        g["exposicao"] += linha.valor
        g["rwa"] += linha.rwa
        g["qtd"] += 1
    for g in grupos.values():
        g["participacao_rwa"] = g["rwa"] / total_rwa
        g["fpr_medio"] = (g["rwa"] / g["exposicao"]) if g["exposicao"] else 0.0
    return sorted(grupos.values(), key=lambda g: g["rwa"], reverse=True)


def consolidar(linhas: List[LinhaRelatorio], cenario: str,
               valor_contabil_cotas: Optional[float] = None,
               acp: float = ACP_CONSERVACAO) -> ResumoCenario:
    rotulo = ("Cenário 1 - Carteira de negociação (RWADRC)"
              if cenario == CENARIO_NEGOCIACAO else
              "Cenário 2 - Carteira bancária (RWACPAD)")
    resumo = ResumoCenario(cenario=cenario, rotulo=rotulo)
    resumo.exposicao_total = sum(l.valor for l in linhas)
    resumo.rwa_total = sum(l.rwa for l in linhas)
    resumo.qtd_linhas = len(linhas)
    com_pendencia = [l for l in linhas if l.faltantes or l.residual]
    resumo.qtd_com_pendencia = len(com_pendencia)
    resumo.valor_com_pendencia = sum(l.valor for l in com_pendencia)

    # Art. 59, § 3º - teto de 1.250% sobre o valor contábil das cotas.
    if cenario == CENARIO_BANCARIA and valor_contabil_cotas and valor_contabil_cotas > 0:
        teto = reg.FPR_TETO_FUNDO * valor_contabil_cotas
        if resumo.rwa_total > teto:
            resumo.observacoes.append(
                f"RWA ponderado de R$ {resumo.rwa_total:,.2f} limitado ao teto de "
                f"R$ {teto:,.2f}, correspondente à aplicação do FPR de 1.250% sobre o "
                f"valor contábil das cotas ({reg.RES_229}, art. 59, § 3º).")
            resumo.rwa_total = teto
            resumo.teto_aplicado = True

    resumo.capital_minimo = resumo.rwa_total * reg.FATOR_F
    resumo.capital_com_acp = resumo.rwa_total * (reg.FATOR_F + acp)
    resumo.fpr_medio = (resumo.rwa_total / resumo.exposicao_total
                        if resumo.exposicao_total else 0.0)
    resumo.rwa_por_artigo = _agrupar(
        linhas, lambda l: f"{l.resolucao} - {l.artigo}",
        lambda l: f"{l.artigo} ({l.fator_pct})")
    resumo.rwa_por_classe = _agrupar(
        linhas, lambda l: (l.tipo_aplicacao or "Não informado"),
        lambda l: (l.tipo_aplicacao or "Não informado"))
    return resumo


def calcular_cenarios(resultado: ResultadoLookthrough,
                      valor_contabil_cotas: Optional[float] = None,
                      acp: float = ACP_CONSERVACAO) -> dict:
    """Roda os dois cenários sobre o mesmo conjunto de ativos finais."""
    linhas_banc = calcular_bancaria(resultado.folhas)
    linhas_neg = calcular_negociacao(resultado.folhas)
    return {
        CENARIO_BANCARIA: {
            "linhas": linhas_banc,
            "resumo": consolidar(linhas_banc, CENARIO_BANCARIA,
                                 valor_contabil_cotas, acp),
        },
        CENARIO_NEGOCIACAO: {
            "linhas": linhas_neg,
            "resumo": consolidar(linhas_neg, CENARIO_NEGOCIACAO, None, acp),
        },
    }


# ---------------------------------------------------------------------------
# Pendências de dados
# ---------------------------------------------------------------------------

def consolidar_pendencias(resultado: ResultadoLookthrough,
                          cenarios: dict) -> List[dict]:
    """Reúne, por campo faltante, o valor afetado e o efeito no cálculo."""
    agregado: Dict[str, dict] = {}

    for item in resultado.pendencias:
        campo = item.get("campo") or item.get("tipo")
        registro = agregado.setdefault(campo, {
            "campo": campo, "descricao": reg.descrever_campo(campo),
            "ocorrencias": 0, "valor_afetado": 0.0, "exemplos": [],
            "efeito": "", "base_legal": "",
        })
        registro["ocorrencias"] += 1
        registro["valor_afetado"] += float(item.get("valor") or 0.0)
        if len(registro["exemplos"]) < 5:
            registro["exemplos"].append(item.get("mensagem", ""))
        if item.get("artigo"):
            registro["base_legal"] = f"{item.get('resolucao', '')}, {item['artigo']}"

    for cenario, dados in cenarios.items():
        for linha in dados["linhas"]:
            for campo in linha.faltantes:
                registro = agregado.setdefault(campo, {
                    "campo": campo, "descricao": reg.descrever_campo(campo),
                    "ocorrencias": 0, "valor_afetado": 0.0, "exemplos": [],
                    "efeito": "", "base_legal": "",
                })
                registro["ocorrencias"] += 1
                registro["valor_afetado"] += linha.valor
                if not registro["base_legal"]:
                    registro["base_legal"] = linha.base_legal
                if not registro["efeito"] and linha.premissas:
                    registro["efeito"] = linha.premissas[0]
                if len(registro["exemplos"]) < 5 and linha.ativo not in registro["exemplos"]:
                    registro["exemplos"].append(linha.ativo)

    return sorted(agregado.values(), key=lambda r: r["valor_afetado"], reverse=True)
