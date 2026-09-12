# -*- coding: utf-8 -*-
"""Servidor HTTP do Risk Data (biblioteca padrão, sem dependências externas)."""

import json
import mimetypes
import os
import threading
import traceback
import urllib.parse
import uuid
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

from . import __version__
from . import cva as mod_cva
from .anbima import ClienteANBIMA
from .enriquecimento import TabelaEnriquecimento
from .cvm import (DIR_CACHE, ErroFonteDados, RepositorioCVM, competencia_de_data,
                  competencias_recentes)
from .demo import COMPETENCIA_DEMO, semear
from .engine import ACP_CONSERVACAO
from .lookthrough import PROFUNDIDADE_PADRAO, MotorLookthrough
from .report import exportar_csv, exportar_xml, montar_relatorio
from .taxonomy import so_digitos

DIR_WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "web")


class Trabalhos:
    """Registro de tarefas longas (download e indexação de bases da CVM)."""

    def __init__(self):
        self._itens = {}
        self._trava = threading.Lock()

    def criar(self, descricao: str) -> str:
        ident = uuid.uuid4().hex[:12]
        with self._trava:
            self._itens[ident] = {"id": ident, "descricao": descricao,
                                  "estado": "executando", "mensagens": [],
                                  "resultado": None, "erro": None,
                                  "inicio": datetime.now().isoformat(timespec="seconds")}
        return ident

    def registrar(self, ident: str, mensagem: str):
        with self._trava:
            item = self._itens.get(ident)
            if item:
                item["mensagens"].append(mensagem)
                del item["mensagens"][:-40]

    def concluir(self, ident: str, resultado=None, erro=None):
        with self._trava:
            item = self._itens.get(ident)
            if item:
                item["estado"] = "erro" if erro else "concluido"
                item["resultado"] = resultado
                item["erro"] = erro
                item["fim"] = datetime.now().isoformat(timespec="seconds")

    def obter(self, ident: str):
        with self._trava:
            return dict(self._itens.get(ident) or {})


class Aplicacao:
    """Estado compartilhado entre as requisições."""

    def __init__(self, dir_cache: str = DIR_CACHE, modo_demo: bool = False,
                 enriquecimento: Optional[str] = None):
        # mensagens precede qualquer chamada a _log
        self.mensagens = []
        self.repo = RepositorioCVM(dir_cache=dir_cache, log=self._log)
        self.anbima = ClienteANBIMA(log=self._log)
        self.caminho_enriquecimento = enriquecimento or os.environ.get(
            "RISKDATA_ENRIQUECIMENTO") or os.path.join(dir_cache, "enriquecimento.csv")
        self._mtime_enriquecimento = None
        self.enriquecimento = TabelaEnriquecimento()
        self._recarregar_enriquecimento()
        self.motor = MotorLookthrough(self.repo, self.anbima, log=self._log,
                                      enriquecimento=self.enriquecimento)
        self.trabalhos = Trabalhos()
        self.relatorios = {}
        self.trava_relatorios = threading.Lock()
        self.modo_demo = modo_demo
        if modo_demo:
            semear(self.repo)

    def _recarregar_enriquecimento(self):
        """Recarrega a planilha de enriquecimento quando ela muda em disco."""
        caminho = self.caminho_enriquecimento
        if not caminho or not os.path.isfile(caminho):
            return
        mtime = os.path.getmtime(caminho)
        if mtime == self._mtime_enriquecimento:
            return
        tabela = TabelaEnriquecimento.carregar(caminho)
        self._mtime_enriquecimento = mtime
        self.enriquecimento = tabela
        if hasattr(self, "motor"):
            self.motor.enriquecimento = tabela
        self._log(f"enriquecimento: {tabela.linhas} linha(s) de {caminho}")

    def _log(self, mensagem: str):
        carimbo = datetime.now().strftime("%H:%M:%S")
        linha = f"[{carimbo}] {mensagem}"
        print(linha, flush=True)
        self.mensagens.append(linha)
        del self.mensagens[:-200]

    # -- carga de dados ----------------------------------------------------

    def carregar_async(self, competencia: str, forcar: bool = False) -> str:
        ident = self.trabalhos.criar(f"Carga da competência {competencia}")

        def tarefa():
            try:
                registrar = lambda m: self.trabalhos.registrar(ident, m)
                registrar("Baixando cadastro de fundos da CVM...")
                self.repo.log = registrar
                total_cad = self.repo.carregar_cadastro(forcar=forcar)
                registrar(f"Cadastro: {total_cad} fundos.")
                registrar(f"Baixando composição de carteiras (CDA) {competencia}...")
                total_cda = self.repo.carregar_cda(competencia, forcar=forcar)
                registrar(f"CDA: {total_cda} posições indexadas.")
                try:
                    registrar("Baixando informe diário (patrimônio líquido)...")
                    self.repo.carregar_patrimonio(competencia, forcar=forcar)
                    registrar("Patrimônio líquido carregado.")
                except ErroFonteDados as exc:
                    registrar(f"Informe diário indisponível: {exc}")
                self.trabalhos.concluir(ident, {
                    "cadastro": total_cad, "cda": total_cda,
                    "competencia": competencia})
            except Exception as exc:
                self.trabalhos.concluir(ident, erro=str(exc))
                self._log(f"ERRO na carga: {exc}")
            finally:
                self.repo.log = self._log

        threading.Thread(target=tarefa, daemon=True).start()
        return ident

    # -- análise -----------------------------------------------------------

    def analisar(self, parametros: dict) -> dict:
        cnpj = so_digitos(parametros.get("cnpj", ""))
        if not cnpj:
            termo = (parametros.get("termo") or "").strip()
            candidatos = self.repo.buscar_fundos(termo, limite=5) if termo else []
            if not candidatos:
                raise ValueError(
                    "Informe o CNPJ do fundo ou um nome que exista na base da CVM.")
            cnpj = candidatos[0]["cnpj"]

        data_consulta = parametros.get("data") or date.today().isoformat()
        competencia = parametros.get("competencia") or competencia_de_data(data_consulta)
        valor_posicao = parametros.get("valor_posicao")
        valor_posicao = float(valor_posicao) if valor_posicao else None
        profundidade = int(parametros.get("profundidade") or PROFUNDIDADE_PADRAO)
        info_publica = bool(parametros.get("info_publica", True))
        acp = float(parametros.get("acp", ACP_CONSERVACAO))
        metodo_cva = parametros.get("metodo_cva") or mod_cva.METODO_ALTERNATIVO
        if metodo_cva not in (mod_cva.METODO_ALTERNATIVO, mod_cva.METODO_COMPLETO):
            raise ValueError("Abordagem do RWACVA inválida.")
        metodo_ccr = parametros.get("metodo_ccr") or mod_cva.CCR_SACCR
        if metodo_ccr not in (mod_cva.CCR_SACCR, mod_cva.CCR_CEM):
            raise ValueError("Método de apuração da exposição inválido.")
        self._recarregar_enriquecimento()

        if not self.repo.obter_fundo(cnpj):
            raise ValueError(
                f"CNPJ {cnpj} não encontrado na base cadastral da CVM. "
                f"Carregue os dados da CVM antes de consultar.")

        resultado = self.motor.resolver(
            cnpj, competencia, valor_posicao=valor_posicao,
            profundidade_max=profundidade, info_publica=info_publica)

        origem = {
            "cvm_cadastro": "dados.cvm.gov.br/dados/FI/CAD",
            "cvm_cda": f"dados.cvm.gov.br/dados/FI/DOC/CDA ({competencia})",
            "anbima": self.anbima.status(),
            "enriquecimento": self.enriquecimento.status(),
            "modo_demo": self.modo_demo,
        }
        relatorio = montar_relatorio(
            resultado, competencia, data_consulta, valor_posicao=valor_posicao,
            acp=acp, info_publica=info_publica, origem_dados=origem,
            metodo_cva=metodo_cva, metodo_ccr=metodo_ccr)

        ident = uuid.uuid4().hex[:12]
        relatorio["id"] = ident
        with self.trava_relatorios:
            self.relatorios[ident] = relatorio
            if len(self.relatorios) > 20:
                for chave in list(self.relatorios)[:-20]:
                    del self.relatorios[chave]
        return relatorio

    def obter_relatorio(self, ident: str) -> Optional[dict]:
        with self.trava_relatorios:
            return self.relatorios.get(ident)

    def status(self) -> dict:
        try:
            total_fundos = self.repo.con.execute(
                "SELECT COUNT(*) c FROM fundos").fetchone()["c"]
        except Exception:
            total_fundos = 0
        return {
            "aplicacao": "Risk Data", "versao": __version__,
            "modo_demo": self.modo_demo,
            "fundos_cadastrados": total_fundos,
            "competencias_carregadas": self.repo.competencias_carregadas(),
            "competencias_sugeridas": competencias_recentes(24),
            "anbima": self.anbima.status(),
            "enriquecimento": self.enriquecimento.status(),
            "cache": self.repo.dir_cache,
            "profundidade_padrao": PROFUNDIDADE_PADRAO,
            "acp_padrao": ACP_CONSERVACAO,
        }


class Manipulador(BaseHTTPRequestHandler):
    server_version = "RiskData/" + __version__
    app: Aplicacao = None

    # -- infraestrutura ----------------------------------------------------

    def log_message(self, formato, *args):
        pass

    def _responder(self, codigo: int, corpo: bytes, tipo: str,
                   cabecalhos: dict = None):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        for chave, valor in (cabecalhos or {}).items():
            self.send_header(chave, valor)
        self.end_headers()
        self.wfile.write(corpo)

    def _json(self, dados, codigo: int = 200):
        corpo = json.dumps(dados, ensure_ascii=False, default=str).encode("utf-8")
        self._responder(codigo, corpo, "application/json; charset=utf-8")

    def _erro(self, mensagem: str, codigo: int = 400):
        self._json({"erro": mensagem}, codigo)

    def _corpo_json(self) -> dict:
        tamanho = int(self.headers.get("Content-Length") or 0)
        if not tamanho:
            return {}
        try:
            return json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except ValueError:
            return {}

    # -- rotas -------------------------------------------------------------

    def do_GET(self):
        partes = urllib.parse.urlparse(self.path)
        caminho = partes.path
        consulta = urllib.parse.parse_qs(partes.query)
        try:
            if caminho in ("/", "/index.html"):
                return self._servir_arquivo("index.html")
            if caminho.startswith("/static/"):
                return self._servir_arquivo(caminho[len("/static/"):])
            if caminho == "/api/status":
                return self._json(self.app.status())
            if caminho == "/api/buscar":
                termo = (consulta.get("q") or [""])[0]
                if len(termo.strip()) < 2:
                    return self._json({"resultados": []})
                return self._json({
                    "resultados": self.app.repo.buscar_fundos(termo, limite=30)})
            if caminho == "/api/trabalho":
                ident = (consulta.get("id") or [""])[0]
                return self._json(self.app.trabalhos.obter(ident))
            if caminho == "/api/exportar":
                return self._exportar(consulta)
            if caminho == "/api/relatorio":
                ident = (consulta.get("id") or [""])[0]
                relatorio = self.app.obter_relatorio(ident)
                if not relatorio:
                    return self._erro("Relatório não encontrado ou expirado.", 404)
                return self._json(relatorio)
            return self._erro("Rota não encontrada.", 404)
        except Exception as exc:
            traceback.print_exc()
            return self._erro(f"Erro interno: {exc}", 500)

    def do_POST(self):
        caminho = urllib.parse.urlparse(self.path).path
        try:
            corpo = self._corpo_json()
            if caminho == "/api/carregar":
                competencia = so_digitos(corpo.get("competencia", ""))[:6]
                if len(competencia) != 6:
                    return self._erro("Informe a competência no formato AAAAMM.")
                ident = self.app.carregar_async(competencia,
                                                forcar=bool(corpo.get("forcar")))
                return self._json({"trabalho": ident})
            if caminho == "/api/analisar":
                return self._json(self.app.analisar(corpo))
            if caminho == "/api/demo":
                info = semear(self.app.repo)
                self.app.modo_demo = True
                return self._json({"ok": True, "demo": info})
            return self._erro("Rota não encontrada.", 404)
        except ValueError as exc:
            return self._erro(str(exc), 400)
        except ErroFonteDados as exc:
            return self._erro(str(exc), 502)
        except Exception as exc:
            traceback.print_exc()
            return self._erro(f"Erro interno: {exc}", 500)

    # -- auxiliares --------------------------------------------------------

    def _servir_arquivo(self, relativo: str):
        relativo = relativo.lstrip("/")
        destino = os.path.normpath(os.path.join(DIR_WEB, relativo))
        if not destino.startswith(os.path.abspath(DIR_WEB)):
            return self._erro("Caminho inválido.", 403)
        if not os.path.isfile(destino):
            return self._erro("Arquivo não encontrado.", 404)
        tipo, _ = mimetypes.guess_type(destino)
        with open(destino, "rb") as fh:
            conteudo = fh.read()
        self._responder(200, conteudo, tipo or "application/octet-stream")

    def _exportar(self, consulta):
        ident = (consulta.get("id") or [""])[0]
        formato = (consulta.get("formato") or ["csv"])[0].lower()
        cenario = (consulta.get("cenario") or ["bancaria"])[0]
        relatorio = self.app.obter_relatorio(ident)
        if not relatorio:
            return self._erro("Relatório não encontrado ou expirado. "
                              "Refaça a consulta.", 404)
        if cenario not in relatorio["cenarios"]:
            return self._erro("Cenário inválido.", 400)

        cnpj = so_digitos(relatorio["cabecalho"]["fundo_cnpj"]) or "fundo"
        base = f"RiskData_{cnpj}_{relatorio['cabecalho']['competencia']}_{cenario}"
        if formato == "xml":
            conteudo = exportar_xml(relatorio, cenario).encode("utf-8")
            tipo = "application/xml; charset=utf-8"
            nome = base + ".xml"
        else:
            # BOM para abertura direta no Excel em pt-BR.
            conteudo = "﻿".encode("utf-8") + \
                exportar_csv(relatorio, cenario).encode("utf-8")
            tipo = "text/csv; charset=utf-8"
            nome = base + ".csv"
        self._responder(200, conteudo, tipo,
                        {"Content-Disposition": f'attachment; filename="{nome}"'})


def executar(host: str = "127.0.0.1", porta: int = 8000,
             dir_cache: str = DIR_CACHE, modo_demo: bool = False,
             enriquecimento: Optional[str] = None):
    Manipulador.app = Aplicacao(dir_cache=dir_cache, modo_demo=modo_demo,
                                enriquecimento=enriquecimento)
    servidor = ThreadingHTTPServer((host, porta), Manipulador)
    print(f"Risk Data {__version__} em http://{host}:{porta}")
    print(f"Cache: {dir_cache}")
    if modo_demo:
        print("Modo demonstração ativo (carteira sintética carregada).")
    status_enriquecimento = Manipulador.app.enriquecimento.status()
    if status_enriquecimento["ativa"]:
        print(f"Enriquecimento: {status_enriquecimento['linhas']} linha(s) de "
              f"{status_enriquecimento['caminho']}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando.")
    finally:
        servidor.server_close()
        Manipulador.app.repo.fechar()
