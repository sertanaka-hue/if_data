# -*- coding: utf-8 -*-
"""Cliente ANBIMA.

A ANBIMA expõe o Feed de Dados sob autenticação OAuth 2.0 (client credentials).
Quando as credenciais estão configuradas, o Risk Data enriquece o relatório com
a classificação ANBIMA (níveis 1 a 3) e com dados cadastrais do fundo. Sem
credenciais, o sistema segue funcionando com a base da CVM e sinaliza no
relatório que a classificação ANBIMA não foi obtida.

Configuração:
    export ANBIMA_CLIENT_ID="..."
    export ANBIMA_CLIENT_SECRET="..."
    # opcional, para o ambiente de homologação:
    export ANBIMA_BASE="https://api-sandbox.anbima.com.br"
"""

import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional

from .taxonomy import so_digitos

BASE_PADRAO = "https://api.anbima.com.br"
CAMINHO_TOKEN = "/oauth/access-token"
CAMINHO_FUNDOS = "/feed/fundos/v1/fundos"


class ClienteANBIMA:
    """Acesso ao Feed de Dados da ANBIMA, com cache em memória por CNPJ."""

    def __init__(self, client_id: Optional[str] = None,
                 client_secret: Optional[str] = None,
                 base: Optional[str] = None, log=None):
        self.client_id = client_id or os.environ.get("ANBIMA_CLIENT_ID", "")
        self.client_secret = client_secret or os.environ.get("ANBIMA_CLIENT_SECRET", "")
        self.base = (base or os.environ.get("ANBIMA_BASE") or BASE_PADRAO).rstrip("/")
        self.log = log or (lambda m: None)
        self._token = None
        self._token_expira_em = 0.0
        self._cache: Dict[str, dict] = {}
        self.ultimo_erro: Optional[str] = None

    # -- estado ------------------------------------------------------------

    @property
    def configurado(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def status(self) -> dict:
        return {
            "configurado": self.configurado,
            "base": self.base,
            "ultimo_erro": self.ultimo_erro,
            "observacao": (
                "Credenciais ANBIMA configuradas."
                if self.configurado else
                "Sem credenciais ANBIMA (ANBIMA_CLIENT_ID/ANBIMA_CLIENT_SECRET). "
                "A classificação usada será a da base cadastral da CVM."),
        }

    # -- transporte --------------------------------------------------------

    def _contexto(self):
        ctx = ssl.create_default_context()
        ca = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
        if ca and os.path.exists(ca):
            ctx.load_verify_locations(ca)
        return ctx

    def _obter_token(self) -> Optional[str]:
        if not self.configurado:
            return None
        if self._token and time.time() < self._token_expira_em - 60:
            return self._token
        credencial = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()).decode()
        corpo = json.dumps({"grant_type": "client_credentials"}).encode()
        req = urllib.request.Request(
            self.base + CAMINHO_TOKEN, data=corpo, method="POST",
            headers={"Authorization": f"Basic {credencial}",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60,
                                        context=self._contexto()) as resp:
                dados = json.loads(resp.read().decode("utf-8"))
            self._token = dados.get("access_token")
            self._token_expira_em = time.time() + float(dados.get("expires_in", 3600))
            self.ultimo_erro = None
            return self._token
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            self.ultimo_erro = f"Falha na autenticação ANBIMA: {exc}"
            self.log(self.ultimo_erro)
            return None

    def _get(self, caminho: str, parametros: dict) -> Optional[dict]:
        token = self._obter_token()
        if not token:
            return None
        url = f"{self.base}{caminho}?{urllib.parse.urlencode(parametros)}"
        req = urllib.request.Request(url, headers={
            "client_id": self.client_id,
            "access_token": token,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=60,
                                        context=self._contexto()) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            self.ultimo_erro = f"ANBIMA HTTP {exc.code} em {caminho}"
            self.log(self.ultimo_erro)
            return None
        except (urllib.error.URLError, ValueError) as exc:
            self.ultimo_erro = f"Falha de rede com a ANBIMA: {exc}"
            self.log(self.ultimo_erro)
            return None

    # -- consultas ---------------------------------------------------------

    def consultar_fundo(self, cnpj: str) -> dict:
        """Dados ANBIMA do fundo. Devolve {} quando indisponível."""
        cnpj = so_digitos(cnpj)
        if not cnpj:
            return {}
        if cnpj in self._cache:
            return self._cache[cnpj]
        if not self.configurado:
            self._cache[cnpj] = {}
            return {}

        resposta = self._get(CAMINHO_FUNDOS, {"codigo_cnpj": cnpj})
        registro = {}
        if resposta:
            conteudo = resposta.get("content") if isinstance(resposta, dict) else resposta
            if isinstance(conteudo, list) and conteudo:
                conteudo = conteudo[0]
            if isinstance(conteudo, dict):
                registro = {
                    "classificacao_anbima": conteudo.get("classificacao")
                        or conteudo.get("categoria_anbima") or "",
                    "nivel_1": conteudo.get("nivel_1", ""),
                    "nivel_2": conteudo.get("nivel_2", ""),
                    "nivel_3": conteudo.get("nivel_3", ""),
                    "gestor": conteudo.get("gestor", ""),
                    "administrador": conteudo.get("administrador", ""),
                    "patrimonio_liquido": conteudo.get("patrimonio_liquido"),
                    "codigo_anbima": conteudo.get("codigo_anbima", ""),
                    "tipo_investidor": conteudo.get("tipo_investidor", ""),
                    "fonte": "ANBIMA Feed de Dados",
                }
        self._cache[cnpj] = registro
        return registro

    def enriquecer(self, fundo: dict) -> dict:
        """Completa lacunas do cadastro CVM com dados ANBIMA, sem sobrescrever."""
        dados = self.consultar_fundo(fundo.get("cnpj", ""))
        if not dados:
            return fundo
        saida = dict(fundo)
        if dados.get("classificacao_anbima"):
            saida["categoria_anbima"] = dados["classificacao_anbima"]
        for campo in ("gestor", "administrador"):
            if not saida.get(campo) and dados.get(campo):
                saida[campo] = dados[campo]
        if not saida.get("patrimonio_liquido") and dados.get("patrimonio_liquido"):
            saida["patrimonio_liquido"] = dados["patrimonio_liquido"]
        saida["codigo_anbima"] = dados.get("codigo_anbima", "")
        return saida
