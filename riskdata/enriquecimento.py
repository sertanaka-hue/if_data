# -*- coding: utf-8 -*-
"""Camada de enriquecimento dos ativos com dados que a CDA/CVM não publica.

A CDA informa o que o fundo detém, mas não os atributos de contraparte que
discriminam o enquadramento prudencial — porte do emissor, categoria de risco
da instituição financeira, nocional e prazo dos derivativos. Este módulo lê uma
planilha mantida pela própria instituição e injeta esses atributos nos ativos,
eliminando as pendências correspondentes do relatório.

Formato (CSV com separador ';', codificação UTF-8 ou Latin-1):

    codigo;cnpj_emissor;descricao;porte_emissor;categoria_risco_if;prazo_original;
    listada_em_bolsa;investment_grade;rating_soberano;valor_nocional;
    valor_reposicao;prazo_derivativo;contraparte;liquidacao_ccp;
    classe_priorizacao;ativo_problematico;demonstracoes_auditadas

Preencha apenas as colunas conhecidas; as vazias são ignoradas. O casamento com
o ativo é feito, nesta ordem, por código, por CNPJ do emissor e por descrição
normalizada.
"""

import csv
import io
import os
from typing import Dict, List, Optional

from .taxonomy import normalizar, so_digitos

#: Colunas interpretadas como número.
CAMPOS_NUMERICOS = ("prazo_original", "valor_nocional", "valor_reposicao",
                    "prazo_derivativo", "indice_capital_principal",
                    "razao_alavancagem", "ltv")

#: Colunas interpretadas como booleano.
CAMPOS_BOOLEANOS = ("listada_em_bolsa", "investment_grade", "ativo_problematico",
                    "demonstracoes_auditadas", "liquidacao_ccp", "posse_direta",
                    "evento_credito", "participacao_significativa",
                    "receptor_risco_credito", "contraparte_isenta")

#: Colunas que identificam a linha, e não atributos do ativo.
COLUNAS_CHAVE = ("codigo", "cnpj_emissor", "descricao")

VERDADEIRO = ("1", "s", "sim", "true", "verdadeiro", "y", "yes", "x")
FALSO = ("0", "n", "nao", "não", "false", "falso")


def _converter(campo: str, valor: str):
    texto = (valor or "").strip()
    if not texto:
        return None
    if campo in CAMPOS_BOOLEANOS:
        minusculo = texto.lower()
        if minusculo in VERDADEIRO:
            return True
        if minusculo in FALSO:
            return False
        return None
    if campo in CAMPOS_NUMERICOS:
        limpo = texto.replace(".", "").replace(",", ".") if "," in texto else texto
        try:
            return float(limpo)
        except ValueError:
            return None
    return texto


class TabelaEnriquecimento:
    """Índice de atributos por código, CNPJ do emissor e descrição."""

    def __init__(self):
        self.por_codigo: Dict[str, dict] = {}
        self.por_cnpj: Dict[str, dict] = {}
        self.por_descricao: Dict[str, dict] = {}
        self.caminho: Optional[str] = None
        self.linhas: int = 0
        self.campos: List[str] = []

    # -- carga -------------------------------------------------------------

    @classmethod
    def carregar(cls, caminho: Optional[str]) -> "TabelaEnriquecimento":
        tabela = cls()
        if not caminho or not os.path.isfile(caminho):
            return tabela
        with open(caminho, "rb") as fh:
            dados = fh.read()
        texto = None
        for codificacao in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                texto = dados.decode(codificacao)
                break
            except UnicodeDecodeError:
                continue
        if texto is None:
            return tabela

        amostra = texto[:8192]
        delimitador = ";" if amostra.count(";") >= amostra.count(",") else ","
        leitor = csv.DictReader(io.StringIO(texto), delimiter=delimitador)
        campos = set()

        for linha in leitor:
            registro = {}
            chaves = {}
            for coluna, valor in linha.items():
                nome = (coluna or "").strip().lower()
                if not nome:
                    continue
                if nome in COLUNAS_CHAVE:
                    chaves[nome] = (valor or "").strip()
                    continue
                convertido = _converter(nome, valor)
                if convertido is not None:
                    registro[nome] = convertido
                    campos.add(nome)
            if not registro:
                continue
            tabela.linhas += 1
            if chaves.get("codigo"):
                tabela.por_codigo[normalizar(chaves["codigo"])] = registro
            if chaves.get("cnpj_emissor"):
                tabela.por_cnpj[so_digitos(chaves["cnpj_emissor"])] = registro
            if chaves.get("descricao"):
                tabela.por_descricao[normalizar(chaves["descricao"])] = registro

        tabela.caminho = caminho
        tabela.campos = sorted(campos)
        return tabela

    # -- aplicação ---------------------------------------------------------

    @property
    def vazia(self) -> bool:
        return self.linhas == 0

    def buscar(self, ativo) -> dict:
        """Atributos aplicáveis ao ativo, na ordem código, CNPJ, descrição."""
        if self.vazia:
            return {}
        if ativo.codigo:
            registro = self.por_codigo.get(normalizar(ativo.codigo))
            if registro:
                return registro
        if ativo.cnpj_emissor:
            registro = self.por_cnpj.get(so_digitos(ativo.cnpj_emissor))
            if registro:
                return registro
        if ativo.descricao:
            registro = self.por_descricao.get(normalizar(ativo.descricao))
            if registro:
                return registro
        return {}

    def aplicar(self, ativo) -> int:
        """Injeta os atributos no ativo sem sobrescrever o que já existe."""
        registro = self.buscar(ativo)
        if not registro:
            return 0
        aplicados = 0
        for campo, valor in registro.items():
            if campo not in ativo.atributos:
                ativo.atributos[campo] = valor
                aplicados += 1
        return aplicados

    def status(self) -> dict:
        return {
            "ativa": not self.vazia,
            "caminho": self.caminho,
            "linhas": self.linhas,
            "campos": self.campos,
            "observacao": (
                f"{self.linhas} linha(s) de enriquecimento carregadas de "
                f"{os.path.basename(self.caminho or '')}."
                if not self.vazia else
                "Nenhuma planilha de enriquecimento carregada. Os atributos de "
                "contraparte ausentes na CDA seguirão como pendência."),
        }
