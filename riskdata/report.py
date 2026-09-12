# -*- coding: utf-8 -*-
"""Montagem do relatório Risk Data e exportação em CSV e XML."""

import csv
import io
from datetime import datetime
from typing import List, Optional
from xml.etree import ElementTree as ET
from xml.dom import minidom

from . import cva as mod_cva
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


def _somar_pendencias_cva(pendencias: list, cva) -> list:
    """Acrescenta às pendências os derivativos sem parâmetros para o RWACVA."""
    if not cva.nao_apurados:
        return pendencias
    indice = {p["campo"]: p for p in pendencias}
    for item in cva.nao_apurados:
        for campo in item.get("faltantes", []):
            registro = indice.get(campo)
            if registro is None:
                registro = {"campo": campo, "descricao": reg.descrever_campo(campo),
                            "ocorrencias": 0, "valor_afetado": 0.0, "exemplos": [],
                            "efeito": "", "base_legal": ""}
                indice[campo] = registro
                pendencias.append(registro)
            registro["ocorrencias"] += 1
            registro["valor_afetado"] += float(item.get("valor_mercado") or 0.0)
            if not registro["base_legal"]:
                registro["base_legal"] = f"{mod_cva.RES_291}, {item.get('artigo', '')}"
            if not registro["efeito"]:
                registro["efeito"] = (
                    "Derivativo excluído da parcela RWACVA por falta do valor de "
                    "referência; o RWACVA apurado fica subestimado nessa medida.")
            if len(registro["exemplos"]) < 5:
                registro["exemplos"].append(item.get("descricao", ""))
    return sorted(pendencias, key=lambda r: r["valor_afetado"], reverse=True)


def montar_relatorio(resultado: ResultadoLookthrough, competencia: str,
                     data_consulta: str, valor_posicao: Optional[float] = None,
                     acp: float = 0.025, info_publica: bool = True,
                     origem_dados: Optional[dict] = None,
                     metodo_cva: str = mod_cva.METODO_ALTERNATIVO,
                     metodo_ccr: str = mod_cva.CCR_SACCR) -> dict:
    """Constrói o dicionário completo do relatório, com os dois cenários."""
    cenarios = calcular_cenarios(resultado, valor_contabil_cotas=valor_posicao,
                                 acp=acp, metodo_cva=metodo_cva,
                                 metodo_ccr=metodo_ccr)
    cva = cenarios["cva"]
    pendencias = consolidar_pendencias(resultado, cenarios)
    pendencias = _somar_pendencias_cva(pendencias, cva)
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
        "metodo_cva": metodo_cva,
        "metodo_ccr": metodo_ccr,
        "qtd_fundos": len(resultado.fundos_visitados),
        "qtd_ativos_finais": len(resultado.folhas),
        "profundidade_maxima": resultado.profundidade_maxima,
        "ciclos_detectados": len(resultado.ciclos),
        "origem_dados": origem_dados or {},
    }

    resumo_neg = cenarios[CENARIO_NEGOCIACAO]["resumo"].to_dict()
    resumo_banc = cenarios[CENARIO_BANCARIA]["resumo"].to_dict()
    for resumo in (resumo_neg, resumo_banc):
        # Art. 3º da Res. BCB 291/2023: a parcela RWACVA alcança os dois livros.
        resumo["rwa_cva"] = cva.rwa
        resumo["rwa_com_cva"] = resumo["rwa_total"] + cva.rwa
        resumo["capital_com_cva"] = resumo["rwa_com_cva"] * reg.FATOR_F
        resumo["capital_com_cva_e_acp"] = resumo["rwa_com_cva"] * (reg.FATOR_F + acp)

    return {
        "cabecalho": cabecalho,
        "arvore": raiz.to_dict() if raiz else None,
        "cva": cva.to_dict(),
        "fundos": fundos,
        "avisos": resultado.avisos,
        "pendencias": pendencias,
        "cenarios": {
            CENARIO_NEGOCIACAO: {
                "resumo": resumo_neg,
                "linhas": [_linha_exportavel(l, acp)
                           for l in cenarios[CENARIO_NEGOCIACAO]["linhas"]],
            },
            CENARIO_BANCARIA: {
                "resumo": resumo_banc,
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
        ("RWA CVA (Res. BCB 291/2023)", _formatar_valor(resumo.get("rwa_cva"))),
        ("RWA total com CVA", _formatar_valor(resumo.get("rwa_com_cva"))),
        ("Capital com CVA (F = 8%)", _formatar_valor(resumo.get("capital_com_cva"))),
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

    cva = relatorio.get("cva") or {}
    if cva:
        escritor.writerow([])
        escritor.writerow(["PARCELA RWA CVA - RISCO DE VARIAÇÃO DO VALOR DOS "
                           "DERIVATIVOS PELA QUALIDADE CREDITÍCIA DA CONTRAPARTE"])
        escritor.writerow(["Base legal", cva.get("base_legal", "")])
        escritor.writerow(["Abordagem", cva.get("metodo", "")])
        escritor.writerow(["Método de apuração da exposição", cva.get("metodo_ccr", "")])
        escritor.writerow(["Derivativos na carteira", cva.get("qtd_derivativos", 0)])
        escritor.writerow(["Derivativos considerados", cva.get("qtd_considerados", 0)])
        escritor.writerow(["Derivativos excluídos (art. 2º, § 1º)",
                           len(cva.get("excluidos", []))])
        escritor.writerow(["Derivativos sem parâmetros",
                           len(cva.get("nao_apurados", []))])
        escritor.writerow(["Exposição total (EXP)",
                           _formatar_valor(cva.get("exposicao_total"))])
        escritor.writerow(["RWA CVA", _formatar_valor(cva.get("rwa"))])
        escritor.writerow(["Capital CVA", _formatar_valor(cva.get("capital"))])

        if cva.get("contrapartes"):
            escritor.writerow([])
            escritor.writerow(["Contraparte", "Operações", "Exposição (EXP)",
                               "Prazo médio (anos)", "Fator de desconto",
                               "Hedge reconhecido", "Termo agregado"])
            for c in cva["contrapartes"]:
                escritor.writerow([
                    c["contraparte"], c["qtd_operacoes"],
                    _formatar_valor(c["exposicao"]),
                    _formatar_valor(c.get("prazo_medio")),
                    _formatar_valor(c.get("fator_desconto")),
                    _formatar_valor(c.get("hedge_reconhecido")),
                    _formatar_valor(c.get("termo"))])

        if cva.get("excluidos"):
            escritor.writerow([])
            escritor.writerow(["Derivativos excluídos", "Fundo", "Valor",
                               "Base legal", "Motivo"])
            for e in cva["excluidos"]:
                escritor.writerow([e.get("descricao", ""), e.get("fundo", ""),
                                   _formatar_valor(e.get("valor_mercado")),
                                   f"{e.get('resolucao', '')}, {e.get('artigo', '')}",
                                   e.get("motivo", "")])

        if cva.get("nao_apurados"):
            escritor.writerow([])
            escritor.writerow(["Derivativos sem parâmetros", "Fundo", "Contraparte",
                               "Valor", "Dados faltantes"])
            for n in cva["nao_apurados"]:
                escritor.writerow([n.get("descricao", ""), n.get("fundo", ""),
                                   n.get("contraparte", ""),
                                   _formatar_valor(n.get("valor_mercado")),
                                   "; ".join(n.get("faltantes_descritos", []))])

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
                  "capital_com_acp", "rwa_cva", "rwa_com_cva", "capital_com_cva",
                  "fpr_medio", "qtd_linhas",
                  "qtd_com_pendencia", "valor_com_pendencia", "teto_aplicado"):
        _texto(el_resumo, chave, resumo.get(chave))
    for obs in resumo.get("observacoes", []):
        _texto(el_resumo, "Observacao", obs)

    cva = relatorio.get("cva") or {}
    if cva:
        el_cva = ET.SubElement(raiz, "RwaCva", {
            "baseLegal": str(cva.get("base_legal", "")),
            "abordagem": str(cva.get("metodo", "")),
            "metodoExposicao": str(cva.get("metodo_ccr", ""))})
        _texto(el_cva, "ExposicaoTotal", f"{cva.get('exposicao_total', 0.0):.2f}")
        _texto(el_cva, "Rwa", f"{cva.get('rwa', 0.0):.2f}")
        _texto(el_cva, "Capital", f"{cva.get('capital', 0.0):.2f}")
        _texto(el_cva, "QtdDerivativos", cva.get("qtd_derivativos", 0))
        _texto(el_cva, "QtdConsiderados", cva.get("qtd_considerados", 0))
        _texto(el_cva, "Calculavel", cva.get("calculavel", True))
        for c in cva.get("contrapartes", []):
            item = ET.SubElement(el_cva, "Contraparte", {"nome": str(c["contraparte"])})
            _texto(item, "Exposicao", f"{c['exposicao']:.2f}")
            _texto(item, "Operacoes", c["qtd_operacoes"])
            _texto(item, "PrazoMedio", c.get("prazo_medio"))
            _texto(item, "FatorDesconto", c.get("fator_desconto"))
            _texto(item, "HedgeReconhecido", f"{c.get('hedge_reconhecido', 0.0):.2f}")
            _texto(item, "Termo", f"{c.get('termo', 0.0):.2f}")
        for e in cva.get("excluidos", []):
            item = ET.SubElement(el_cva, "Excluido")
            _texto(item, "Descricao", e.get("descricao", ""))
            _texto(item, "Valor", f"{e.get('valor_mercado', 0.0):.2f}")
            _texto(item, "BaseLegal",
                   f"{e.get('resolucao', '')}, {e.get('artigo', '')}")
            _texto(item, "Motivo", e.get("motivo", ""))
        for n in cva.get("nao_apurados", []):
            item = ET.SubElement(el_cva, "SemParametros")
            _texto(item, "Descricao", n.get("descricao", ""))
            _texto(item, "Contraparte", n.get("contraparte", ""))
            _texto(item, "Valor", f"{n.get('valor_mercado', 0.0):.2f}")
            for campo in n.get("faltantes_descritos", []):
                _texto(item, "DadoFaltante", campo)
        for aviso in cva.get("avisos", []):
            _texto(el_cva, "Aviso", aviso)

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
    _texto(el_total, "RwaCva", f"{resumo.get('rwa_cva', 0.0):.2f}")
    _texto(el_total, "RwaTotalComCva", f"{resumo.get('rwa_com_cva', 0.0):.2f}")
    _texto(el_total, "CapitalComCva", f"{resumo.get('capital_com_cva', 0.0):.2f}")

    el_norm = ET.SubElement(raiz, "Normativos")
    for n in relatorio.get("normativos", []):
        item = ET.SubElement(el_norm, "Normativo", {"resolucao": n["resolucao"]})
        item.text = n["objeto"]

    bruto = ET.tostring(raiz, encoding="utf-8")
    return minidom.parseString(bruto).toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")
