# -*- coding: utf-8 -*-
"""Montagem do relatório Risk Data e exportação em CSV e XML."""

import csv
import io
from datetime import datetime
from typing import List, Optional
from xml.etree import ElementTree as ET
from xml.dom import minidom

from . import regulation as reg
from .engine import (CENARIO_BANCARIA, CENARIO_NEGOCIACAO, LinhaRelatorio,
                     calcular_cenarios, consolidar_pendencias)
from .lookthrough import ResultadoLookthrough
from .taxonomy import formatar_cnpj

APLICACAO = "Risk Data"

#: Colunas do relatório, na ordem pedida, com os acréscimos de capital e RWA.
COLUNAS_RELATORIO = [
    ("fundo_nome", "Nome do fundo"),
    ("fundo_cnpj_formatado", "CNPJ"),
    ("fundo_categoria", "Categoria"),
    ("fundo_gestor", "Gestor"),
    ("fundo_administrador", "Administrador"),
    ("ativo", "Ativo"),
    ("valor", "Valor"),
    ("fator_pct", "FPR / RW"),
    ("artigo", "Artigo"),
    ("resolucao", "Resolução"),
    ("rwa", "RWA"),
    ("capital", "Capital requerido"),
    ("nivel", "Nível de aninhamento"),
    ("caminho_formatado", "Cadeia de fundos"),
    ("tipo_aplicacao", "Tipo de aplicação"),
    ("tipo_ativo", "Tipo de ativo"),
    ("codigo", "Código"),
    ("emissor", "Emissor"),
    ("participacao", "Participação acumulada"),
    ("fator_perda", "Fator de perda (DRC)"),
    ("jtd", "JTD (DRC)"),
    ("descricao_regra", "Fundamento do enquadramento"),
    ("pendencias", "Dados faltantes"),
    ("premissas_txt", "Premissas adotadas"),
    ("observacoes_txt", "Observações"),
]


def _linha_exportavel(linha: LinhaRelatorio, acp: float) -> dict:
    d = linha.to_dict()
    d["fundo_cnpj_formatado"] = formatar_cnpj(linha.fundo_cnpj)
    d["capital"] = linha.rwa * reg.FATOR_F
    d["capital_com_acp"] = linha.rwa * (reg.FATOR_F + acp)
    d["pendencias"] = "; ".join(reg.descrever_campo(c) for c in linha.faltantes)
    d["premissas_txt"] = " | ".join(linha.premissas)
    d["observacoes_txt"] = " | ".join(linha.observacoes)
    return d


def montar_relatorio(resultado: ResultadoLookthrough, competencia: str,
                     data_consulta: str, valor_posicao: Optional[float] = None,
                     acp: float = 0.025, info_publica: bool = True,
                     origem_dados: Optional[dict] = None) -> dict:
    """Constrói o dicionário completo do relatório, com os dois cenários."""
    cenarios = calcular_cenarios(resultado, valor_contabil_cotas=valor_posicao, acp=acp)
    pendencias = consolidar_pendencias(resultado, cenarios)
    raiz = resultado.raiz

    fundos = []
    for no in resultado.fundos_visitados.values():
        fundos.append({
            "cnpj": no.cnpj, "cnpj_formatado": formatar_cnpj(no.cnpj),
            "nome": no.nome, "categoria": no.categoria, "gestor": no.gestor,
            "administrador": no.administrador, "nivel": no.nivel,
            "patrimonio_liquido": no.patrimonio_liquido,
            "total_carteira": no.total_carteira, "data_base": no.data_base,
            "participacao": no.fator, "avisos": no.avisos,
        })
    fundos.sort(key=lambda f: (f["nivel"], f["nome"]))

    cabecalho = {
        "aplicacao": APLICACAO,
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "data_consulta": data_consulta,
        "competencia": competencia,
        "fundo_nome": raiz.nome if raiz else "",
        "fundo_cnpj": formatar_cnpj(raiz.cnpj) if raiz else "",
        "fundo_categoria": raiz.categoria if raiz else "",
        "fundo_gestor": raiz.gestor if raiz else "",
        "fundo_administrador": raiz.administrador if raiz else "",
        "patrimonio_liquido": raiz.patrimonio_liquido if raiz else None,
        "data_base_carteira": raiz.data_base if raiz else "",
        "valor_posicao": valor_posicao,
        "participacao_instituicao": raiz.fator if raiz else 1.0,
        "info_publica": info_publica,
        "majoracao_art_17_7": 1.0 if info_publica else reg.MAJORACAO_INFO_NAO_PUBLICA,
        "acp_conservacao": acp,
        "fator_f": reg.FATOR_F,
        "qtd_fundos": len(resultado.fundos_visitados),
        "qtd_ativos_finais": len(resultado.folhas),
        "profundidade_maxima": resultado.profundidade_maxima,
        "ciclos_detectados": len(resultado.ciclos),
        "origem_dados": origem_dados or {},
    }

    return {
        "cabecalho": cabecalho,
        "arvore": raiz.to_dict() if raiz else None,
        "fundos": fundos,
        "avisos": resultado.avisos,
        "pendencias": pendencias,
        "cenarios": {
            CENARIO_NEGOCIACAO: {
                "resumo": cenarios[CENARIO_NEGOCIACAO]["resumo"].to_dict(),
                "linhas": [_linha_exportavel(l, acp)
                           for l in cenarios[CENARIO_NEGOCIACAO]["linhas"]],
            },
            CENARIO_BANCARIA: {
                "resumo": cenarios[CENARIO_BANCARIA]["resumo"].to_dict(),
                "linhas": [_linha_exportavel(l, acp)
                           for l in cenarios[CENARIO_BANCARIA]["linhas"]],
            },
        },
        "normativos": [
            {"resolucao": reg.RES_229, "objeto": "RWACPAD - risco de crédito, "
             "abordagem padronizada; arts. 16 a 18 (fundos) e 59 e 60 (FPR de cotas)"},
            {"resolucao": reg.RES_313, "objeto": "RWADRC - risco de crédito dos "
             "instrumentos da carteira de negociação"},
            {"resolucao": reg.RES_291, "objeto": "RWACVA - variação do valor dos "
             "derivativos pela qualidade creditícia da contraparte"},
            {"resolucao": reg.RES_202, "objeto": "RWASP - risco operacional"},
            {"resolucao": reg.CIRC_3809, "objeto": "Instrumentos mitigadores do "
             "risco de crédito"},
        ],
    }


# ---------------------------------------------------------------------------
# Exportação CSV
# ---------------------------------------------------------------------------

def _formatar_pct(valor, casas: int = 2) -> str:
    """Percentual com vírgula decimal, para abertura direta no Excel pt-BR."""
    if valor is None:
        return ""
    return f"{valor * 100:.{casas}f}".replace(".", ",") + "%"


def _formatar_valor(valor):
    if valor is None:
        return ""
    if isinstance(valor, float):
        return f"{valor:.2f}".replace(".", ",")
    if isinstance(valor, list):
        return " | ".join(str(v) for v in valor)
    return str(valor)


def exportar_csv(relatorio: dict, cenario: str) -> str:
    """CSV com bloco de resumo no topo, seguido do detalhamento por ativo."""
    dados = relatorio["cenarios"][cenario]
    resumo = dados["resumo"]
    cab = relatorio["cabecalho"]
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL,
                          lineterminator="\r\n")

    escritor.writerow([f"{APLICACAO} - Relatório de composição de fundo e RWA"])
    escritor.writerow([resumo["rotulo"]])
    escritor.writerow([])
    escritor.writerow(["RESUMO"])
    for rotulo, valor in [
        ("Fundo", cab["fundo_nome"]),
        ("CNPJ", cab["fundo_cnpj"]),
        ("Categoria", cab["fundo_categoria"]),
        ("Gestor", cab["fundo_gestor"]),
        ("Administrador", cab["fundo_administrador"]),
        ("Data da consulta", cab["data_consulta"]),
        ("Competência da carteira", cab["competencia"]),
        ("Data-base da carteira", cab["data_base_carteira"]),
        ("Patrimônio líquido do fundo", _formatar_valor(cab["patrimonio_liquido"])),
        ("Valor da posição da instituição", _formatar_valor(cab["valor_posicao"])),
        ("Participação da instituição", _formatar_pct(cab["participacao_instituicao"], 6)),
        ("Majoração art. 17, § 7º", f"{cab['majoracao_art_17_7']:.2f}"),
        ("Fundos abertos", cab["qtd_fundos"]),
        ("Ativos finais", cab["qtd_ativos_finais"]),
        ("Profundidade máxima", cab["profundidade_maxima"]),
        ("Exposição total", _formatar_valor(resumo["exposicao_total"])),
        ("RWA total", _formatar_valor(resumo["rwa_total"])),
        ("FPR médio ponderado", _formatar_pct(resumo["fpr_medio"])),
        ("Capital requerido (F = 8%)", _formatar_valor(resumo["capital_minimo"])),
        ("Capital com ACP de conservação", _formatar_valor(resumo["capital_com_acp"])),
        ("Linhas com pendência de dados", resumo["qtd_com_pendencia"]),
        ("Valor com pendência de dados", _formatar_valor(resumo["valor_com_pendencia"])),
        ("Gerado em", cab["gerado_em"]),
    ]:
        escritor.writerow([rotulo, valor])

    if resumo.get("observacoes"):
        escritor.writerow([])
        escritor.writerow(["OBSERVAÇÕES DO CÁLCULO"])
        for obs in resumo["observacoes"]:
            escritor.writerow([obs])

    if relatorio.get("avisos"):
        escritor.writerow([])
        escritor.writerow(["AVISOS"])
        for aviso in relatorio["avisos"]:
            escritor.writerow([aviso])

    if relatorio.get("pendencias"):
        escritor.writerow([])
        escritor.writerow(["DADOS FALTANTES PARA O CÁLCULO"])
        escritor.writerow(["Campo", "Descrição", "Ocorrências", "Valor afetado",
                           "Base legal", "Efeito adotado"])
        for p in relatorio["pendencias"]:
            escritor.writerow([p["campo"], p["descricao"], p["ocorrencias"],
                               _formatar_valor(p["valor_afetado"]),
                               p.get("base_legal", ""), p.get("efeito", "")])

    escritor.writerow([])
    escritor.writerow(["RWA POR ARTIGO"])
    escritor.writerow(["Base legal", "Exposição", "RWA", "% do RWA", "Ativos"])
    for g in resumo["rwa_por_artigo"]:
        escritor.writerow([g["chave"], _formatar_valor(g["exposicao"]),
                           _formatar_valor(g["rwa"]),
                           _formatar_pct(g["participacao_rwa"]), g["qtd"]])

    escritor.writerow([])
    escritor.writerow(["DETALHAMENTO POR ATIVO"])
    escritor.writerow([rotulo for _, rotulo in COLUNAS_RELATORIO])
    for linha in dados["linhas"]:
        escritor.writerow([_formatar_valor(linha.get(campo))
                           for campo, _ in COLUNAS_RELATORIO])

    escritor.writerow([])
    escritor.writerow(["TOTAL", "", "", "", "", "",
                       _formatar_valor(resumo["exposicao_total"]), "", "", "",
                       _formatar_valor(resumo["rwa_total"]),
                       _formatar_valor(resumo["capital_minimo"])])
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Exportação XML
# ---------------------------------------------------------------------------

def _texto(pai, tag, valor):
    elemento = ET.SubElement(pai, tag)
    elemento.text = "" if valor is None else str(valor)
    return elemento


def exportar_xml(relatorio: dict, cenario: str) -> str:
    dados = relatorio["cenarios"][cenario]
    resumo = dados["resumo"]
    cab = relatorio["cabecalho"]

    raiz = ET.Element("RiskData", {
        "versao": "1.0", "aplicacao": APLICACAO, "cenario": cenario,
    })

    el_cab = ET.SubElement(raiz, "Cabecalho")
    for chave in ("aplicacao", "gerado_em", "data_consulta", "competencia",
                  "fundo_nome", "fundo_cnpj", "fundo_categoria", "fundo_gestor",
                  "fundo_administrador", "patrimonio_liquido", "data_base_carteira",
                  "valor_posicao", "participacao_instituicao", "majoracao_art_17_7",
                  "acp_conservacao", "fator_f", "qtd_fundos", "qtd_ativos_finais",
                  "profundidade_maxima", "ciclos_detectados"):
        _texto(el_cab, chave, cab.get(chave))

    el_resumo = ET.SubElement(raiz, "Resumo", {"rotulo": resumo["rotulo"]})
    for chave in ("exposicao_total", "rwa_total", "capital_minimo",
                  "capital_com_acp", "fpr_medio", "qtd_linhas",
                  "qtd_com_pendencia", "valor_com_pendencia", "teto_aplicado"):
        _texto(el_resumo, chave, resumo.get(chave))
    for obs in resumo.get("observacoes", []):
        _texto(el_resumo, "Observacao", obs)

    el_avisos = ET.SubElement(raiz, "Avisos")
    for aviso in relatorio.get("avisos", []):
        _texto(el_avisos, "Aviso", aviso)

    el_pend = ET.SubElement(raiz, "DadosFaltantes")
    for p in relatorio.get("pendencias", []):
        item = ET.SubElement(el_pend, "Pendencia", {"campo": str(p["campo"])})
        _texto(item, "Descricao", p["descricao"])
        _texto(item, "Ocorrencias", p["ocorrencias"])
        _texto(item, "ValorAfetado", f"{p['valor_afetado']:.2f}")
        _texto(item, "BaseLegal", p.get("base_legal", ""))
        _texto(item, "Efeito", p.get("efeito", ""))

    el_grupos = ET.SubElement(raiz, "RwaPorArtigo")
    for g in resumo.get("rwa_por_artigo", []):
        item = ET.SubElement(el_grupos, "Grupo", {"baseLegal": g["chave"]})
        _texto(item, "Exposicao", f"{g['exposicao']:.2f}")
        _texto(item, "Rwa", f"{g['rwa']:.2f}")
        _texto(item, "ParticipacaoRwa", f"{g['participacao_rwa']:.6f}")
        _texto(item, "Quantidade", g["qtd"])

    el_fundos = ET.SubElement(raiz, "Fundos")
    for f in relatorio.get("fundos", []):
        item = ET.SubElement(el_fundos, "Fundo", {
            "cnpj": f["cnpj_formatado"], "nivel": str(f["nivel"])})
        for chave in ("nome", "categoria", "gestor", "administrador",
                      "patrimonio_liquido", "total_carteira", "data_base",
                      "participacao"):
            _texto(item, chave, f.get(chave))

    el_ativos = ET.SubElement(raiz, "Ativos")
    for linha in dados["linhas"]:
        item = ET.SubElement(el_ativos, "Ativo")
        _texto(item, "NomeFundo", linha.get("fundo_nome"))
        _texto(item, "Cnpj", linha.get("fundo_cnpj_formatado"))
        _texto(item, "Categoria", linha.get("fundo_categoria"))
        _texto(item, "Gestor", linha.get("fundo_gestor"))
        _texto(item, "Administrador", linha.get("fundo_administrador"))
        _texto(item, "Descricao", linha.get("ativo"))
        _texto(item, "Valor", f"{linha.get('valor', 0.0):.2f}")
        ponderacao = ET.SubElement(item, "Ponderacao")
        _texto(ponderacao, "Fator", linha.get("fator"))
        _texto(ponderacao, "FatorPercentual", linha.get("fator_pct"))
        _texto(ponderacao, "Resolucao", linha.get("resolucao"))
        _texto(ponderacao, "Artigo", linha.get("artigo"))
        _texto(ponderacao, "Fundamento", linha.get("descricao_regra"))
        if linha.get("fator_perda") is not None:
            _texto(ponderacao, "FatorPerda", linha.get("fator_perda"))
            _texto(ponderacao, "ArtigoFatorPerda", linha.get("artigo_fator_perda"))
            _texto(ponderacao, "Jtd", f"{linha.get('jtd') or 0.0:.2f}")
        _texto(item, "Rwa", f"{linha.get('rwa', 0.0):.2f}")
        _texto(item, "CapitalRequerido", f"{linha.get('capital', 0.0):.2f}")
        _texto(item, "Nivel", linha.get("nivel"))
        _texto(item, "CadeiaFundos", linha.get("caminho_formatado"))
        _texto(item, "TipoAplicacao", linha.get("tipo_aplicacao"))
        _texto(item, "Emissor", linha.get("emissor"))
        if linha.get("faltantes"):
            faltantes = ET.SubElement(item, "DadosFaltantes")
            for campo in linha["faltantes"]:
                _texto(faltantes, "Campo", reg.descrever_campo(campo))
        for premissa in linha.get("premissas", []):
            _texto(item, "Premissa", premissa)
        for obs in linha.get("observacoes", []):
            _texto(item, "Observacao", obs)

    el_total = ET.SubElement(raiz, "Totais")
    _texto(el_total, "ExposicaoTotal", f"{resumo['exposicao_total']:.2f}")
    _texto(el_total, "RwaTotal", f"{resumo['rwa_total']:.2f}")
    _texto(el_total, "CapitalRequerido", f"{resumo['capital_minimo']:.2f}")

    el_norm = ET.SubElement(raiz, "Normativos")
    for n in relatorio.get("normativos", []):
        item = ET.SubElement(el_norm, "Normativo", {"resolucao": n["resolucao"]})
        item.text = n["objeto"]

    bruto = ET.tostring(raiz, encoding="utf-8")
    return minidom.parseString(bruto).toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")
