# -*- coding: utf-8 -*-
"""Cliente dos dados abertos da CVM.

Conjuntos utilizados:
    Cadastro de fundos   https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv
    CDA (composição)     https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/cda_fi_AAAAMM.zip
    CDA histórica        https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/HIST/cda_fi_AAAA.zip
    Informe diário (PL)  https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_AAAAMM.zip

Os arquivos são baixados uma vez e indexados em SQLite, de modo que a abertura
recursiva de cotas de fundos faça consultas por CNPJ em tempo constante.
"""

import csv
import io
import os
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional

from .taxonomy import Ativo, so_digitos, normalizar

BASE_CVM = "https://dados.cvm.gov.br/dados/FI"
URL_CADASTRO = f"{BASE_CVM}/CAD/DADOS/cad_fi.csv"
URL_CDA = f"{BASE_CVM}/DOC/CDA/DADOS/cda_fi_{{comp}}.zip"
URL_CDA_HIST = f"{BASE_CVM}/DOC/CDA/DADOS/HIST/cda_fi_{{ano}}.zip"
URL_INF_DIARIO = f"{BASE_CVM}/DOC/INF_DIARIO/DADOS/inf_diario_fi_{{comp}}.zip"

ENCODINGS = ("latin-1", "utf-8-sig", "utf-8")
CSV_LIMITE_CAMPO = 4 * 1024 * 1024
csv.field_size_limit(CSV_LIMITE_CAMPO)

DIR_CACHE = os.environ.get(
    "RISKDATA_CACHE",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache"),
)


class ErroFonteDados(RuntimeError):
    """Falha ao obter ou interpretar um conjunto de dados público."""


# ---------------------------------------------------------------------------
# Download com cache em disco
# ---------------------------------------------------------------------------

def _garantir_dir(caminho: str):
    os.makedirs(caminho, exist_ok=True)


def baixar(url: str, destino: str, forcar: bool = False, timeout: int = 300,
           tentativas: int = 4, log=None) -> str:
    """Baixa a URL para o destino, reaproveitando o cache quando já existe."""
    _garantir_dir(os.path.dirname(destino))
    if os.path.exists(destino) and os.path.getsize(destino) > 0 and not forcar:
        return destino

    ctx = ssl.create_default_context()
    ca = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    if ca and os.path.exists(ca):
        ctx.load_verify_locations(ca)

    ultimo_erro = None
    for tentativa in range(tentativas):
        try:
            if log:
                log(f"baixando {url}")
            req = urllib.request.Request(
                url, headers={"User-Agent": "RiskData/1.0 (+risco financeiro)"})
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                parcial = destino + ".parcial"
                with open(parcial, "wb") as saida:
                    while True:
                        bloco = resp.read(1 << 20)
                        if not bloco:
                            break
                        saida.write(bloco)
                os.replace(parcial, destino)
            return destino
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            ultimo_erro = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
                raise ErroFonteDados(
                    f"Arquivo não publicado pela CVM: {url} (HTTP 404). "
                    f"Verifique se a competência já foi divulgada.") from exc
            espera = 2 ** (tentativa + 1)
            if tentativa < tentativas - 1:
                if log:
                    log(f"falha ({exc}); nova tentativa em {espera}s")
                time.sleep(espera)
    raise ErroFonteDados(
        f"Não foi possível baixar {url}. Último erro: {ultimo_erro}. "
        f"Verifique a conectividade de rede com dados.cvm.gov.br.")


def _decodificar(dados: bytes) -> str:
    for enc in ENCODINGS:
        try:
            return dados.decode(enc)
        except UnicodeDecodeError:
            continue
    return dados.decode("latin-1", errors="replace")


def ler_csv(dados: bytes) -> Iterable[dict]:
    texto = _decodificar(dados)
    amostra = texto[:8192]
    delim = ";" if amostra.count(";") >= amostra.count(",") else ","
    for linha in csv.DictReader(io.StringIO(texto), delimiter=delim):
        yield {(k or "").strip().upper(): (v.strip() if isinstance(v, str) else v)
               for k, v in linha.items()}


# ---------------------------------------------------------------------------
# Mapeamento de colunas da CDA (tolerante às mudanças de layout da CVM)
# ---------------------------------------------------------------------------

#: A CVM renomeou CNPJ_FUNDO para CNPJ_FUNDO_CLASSE a partir da Res. CVM 175.
COLUNAS = {
    "cnpj_fundo": ("CNPJ_FUNDO", "CNPJ_FUNDO_CLASSE", "CNPJ_FDO", "CNPJ"),
    "denominacao": ("DENOM_SOCIAL", "DENOM_SOCIAL_CLASSE", "NM_FUNDO", "NOME"),
    "data_competencia": ("DT_COMPTC", "DT_COMPT", "DT_REF"),
    "tipo_aplicacao": ("TP_APLIC",),
    "tipo_ativo": ("TP_ATIVO", "TP_TITPUB", "TP_NEGOC"),
    "codigo_ativo": ("CD_ATIVO", "CD_ISIN", "CD_SELIC", "CD_PAPEL"),
    "descricao_ativo": ("DS_ATIVO", "DS_TITULO", "NM_ATIVO"),
    "emissor": ("EMISSOR", "NM_EMISSOR", "EMISSOR_LIGADO", "NM_FUNDO_COTA",
                "DENOM_SOCIAL_EMISSOR"),
    "cnpj_emissor": ("CNPJ_EMISSOR", "CPF_CNPJ_EMISSOR", "CNPJ_INSTITUICAO_FINANC_COOBR"),
    "valor_mercado": ("VL_MERC_POSI_FINAL", "VL_MERC_POSICAO_FINAL", "VL_MERCADO",
                      "VL_POSICAO_FINAL"),
    "valor_custo": ("VL_CUSTO_POSI_FINAL", "VL_CUSTO"),
    "quantidade": ("QT_POS_FINAL", "QT_VENDA_NEGOC", "QT_AQUIS_NEGOC"),
    "cnpj_fundo_cota": ("CNPJ_FUNDO_COTA", "CNPJ_FUNDO_CLASSE_COTA",
                        "CPF_CNPJ_EMISSOR"),
    "nome_fundo_cota": ("NM_FUNDO_COTA", "NM_FUNDO_CLASSE_SUBCLASSE_COTA",
                        "DENOM_SOCIAL_COTA"),
    "patrimonio_liquido": ("VL_PATRIM_LIQ", "PATRIM_LIQ"),
}


def _pegar(linha: dict, campo: str, padrao: str = "") -> str:
    for coluna in COLUNAS.get(campo, ()):
        valor = linha.get(coluna)
        if valor not in (None, "", "N/A"):
            return valor
    return padrao


def _numero(valor) -> float:
    if valor in (None, "", "N/A"):
        return 0.0
    s = str(valor).strip().replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Repositório SQLite
# ---------------------------------------------------------------------------

ESQUEMA = """
CREATE TABLE IF NOT EXISTS fundos (
    cnpj TEXT PRIMARY KEY, denominacao TEXT, classe TEXT, situacao TEXT,
    gestor TEXT, administrador TEXT, cnpj_admin TEXT, data_inicio TEXT,
    patrimonio_liquido REAL, data_pl TEXT, publico_alvo TEXT, condominio TEXT
);
CREATE INDEX IF NOT EXISTS ix_fundos_nome ON fundos(denominacao);

CREATE TABLE IF NOT EXISTS carteira (
    competencia TEXT, cnpj_fundo TEXT, data_competencia TEXT, bloco TEXT,
    tipo_aplicacao TEXT, tipo_ativo TEXT, codigo_ativo TEXT, descricao_ativo TEXT,
    emissor TEXT, cnpj_emissor TEXT, valor_mercado REAL, valor_custo REAL,
    quantidade REAL, cnpj_fundo_cota TEXT, nome_fundo_cota TEXT
);
CREATE INDEX IF NOT EXISTS ix_carteira_fundo ON carteira(competencia, cnpj_fundo);

CREATE TABLE IF NOT EXISTS patrimonio (
    competencia TEXT, cnpj_fundo TEXT, data_competencia TEXT,
    patrimonio_liquido REAL, valor_cota REAL, captacao REAL, resgate REAL,
    PRIMARY KEY (competencia, cnpj_fundo, data_competencia)
);

CREATE TABLE IF NOT EXISTS controle (
    chave TEXT PRIMARY KEY, valor TEXT, atualizado_em TEXT
);
"""


class RepositorioCVM:
    """Cache local dos dados da CVM, indexado por CNPJ e competência."""

    def __init__(self, dir_cache: str = DIR_CACHE, log=None):
        self.dir_cache = dir_cache
        self.log = log or (lambda m: None)
        _garantir_dir(dir_cache)
        self.caminho_db = os.path.join(dir_cache, "riskdata.sqlite")
        self.con = sqlite3.connect(self.caminho_db, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(ESQUEMA)
        self.con.commit()

    # -- controle de carga -------------------------------------------------

    def _carregado(self, chave: str) -> bool:
        cur = self.con.execute("SELECT valor FROM controle WHERE chave = ?", (chave,))
        linha = cur.fetchone()
        return bool(linha and linha["valor"] == "ok")

    def _marcar_carregado(self, chave: str):
        self.con.execute(
            "INSERT OR REPLACE INTO controle (chave, valor, atualizado_em) "
            "VALUES (?, 'ok', ?)", (chave, datetime.now().isoformat(timespec="seconds")))
        self.con.commit()

    def competencias_carregadas(self) -> List[str]:
        cur = self.con.execute(
            "SELECT chave FROM controle WHERE chave LIKE 'cda:%' AND valor='ok' "
            "ORDER BY chave DESC")
        return [linha["chave"].split(":", 1)[1] for linha in cur.fetchall()]

    # -- cadastro ----------------------------------------------------------

    def carregar_cadastro(self, forcar: bool = False) -> int:
        if self._carregado("cadastro") and not forcar:
            return self.con.execute("SELECT COUNT(*) c FROM fundos").fetchone()["c"]

        destino = os.path.join(self.dir_cache, "cad_fi.csv")
        baixar(URL_CADASTRO, destino, forcar=forcar, log=self.log)
        with open(destino, "rb") as fh:
            dados = fh.read()

        registros = []
        for linha in ler_csv(dados):
            cnpj = so_digitos(_pegar(linha, "cnpj_fundo"))
            if not cnpj:
                continue
            registros.append((
                cnpj,
                _pegar(linha, "denominacao"),
                linha.get("CLASSE") or linha.get("TP_FUNDO") or
                linha.get("CLASSE_ANBIMA") or "",
                linha.get("SIT", ""),
                linha.get("GESTOR", ""),
                linha.get("ADMIN", ""),
                so_digitos(linha.get("CNPJ_ADMIN", "")),
                linha.get("DT_INI_ATIV", ""),
                _numero(linha.get("VL_PATRIM_LIQ")),
                linha.get("DT_PATRIM_LIQ", ""),
                linha.get("PUBLICO_ALVO", ""),
                linha.get("CONDOM", ""),
            ))

        if not registros:
            raise ErroFonteDados(
                "Cadastro da CVM baixado, mas nenhum registro foi reconhecido. "
                "O layout do arquivo cad_fi.csv pode ter mudado.")

        self.con.execute("DELETE FROM fundos")
        self.con.executemany(
            "INSERT OR REPLACE INTO fundos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", registros)
        self.con.commit()
        self._marcar_carregado("cadastro")
        self.log(f"cadastro: {len(registros)} fundos")
        return len(registros)

    # -- composição (CDA) --------------------------------------------------

    def carregar_cda(self, competencia: str, forcar: bool = False) -> int:
        """Carrega a CDA de uma competência AAAAMM."""
        competencia = so_digitos(competencia)[:6]
        if len(competencia) != 6:
            raise ValueError("Competência deve estar no formato AAAAMM.")
        chave = f"cda:{competencia}"
        if self._carregado(chave) and not forcar:
            return self._contar_carteira(competencia)

        destino = os.path.join(self.dir_cache, f"cda_fi_{competencia}.zip")
        try:
            baixar(URL_CDA.format(comp=competencia), destino, forcar=forcar,
                   log=self.log)
        except ErroFonteDados:
            # Competências antigas ficam consolidadas por ano em HIST/.
            ano = competencia[:4]
            destino = os.path.join(self.dir_cache, f"cda_fi_{ano}.zip")
            baixar(URL_CDA_HIST.format(ano=ano), destino, forcar=forcar, log=self.log)

        total = self._ingerir_cda_zip(destino, competencia)
        if total == 0:
            raise ErroFonteDados(
                f"Nenhuma posição encontrada para a competência {competencia} no "
                f"arquivo da CVM.")
        self._marcar_carregado(chave)
        self.log(f"CDA {competencia}: {total} posições")
        return total

    def _ingerir_cda_zip(self, caminho_zip: str, competencia: str) -> int:
        self.con.execute("DELETE FROM carteira WHERE competencia = ?", (competencia,))
        total = 0
        alvo = f"{competencia[:4]}-{competencia[4:6]}"
        with zipfile.ZipFile(caminho_zip) as zf:
            nomes = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            for nome in nomes:
                bloco = self._nome_bloco(nome)
                with zf.open(nome) as fh:
                    dados = fh.read()
                lote = []
                for linha in ler_csv(dados):
                    dt = _pegar(linha, "data_competencia")
                    # O zip anual contém 12 competências; filtra a desejada.
                    if dt and not str(dt).startswith(alvo):
                        continue
                    cnpj = so_digitos(_pegar(linha, "cnpj_fundo"))
                    if not cnpj:
                        continue
                    lote.append((
                        competencia, cnpj, dt, bloco,
                        _pegar(linha, "tipo_aplicacao"),
                        _pegar(linha, "tipo_ativo"),
                        _pegar(linha, "codigo_ativo"),
                        _pegar(linha, "descricao_ativo"),
                        _pegar(linha, "emissor"),
                        so_digitos(_pegar(linha, "cnpj_emissor")),
                        _numero(_pegar(linha, "valor_mercado")),
                        _numero(_pegar(linha, "valor_custo")),
                        _numero(_pegar(linha, "quantidade")),
                        so_digitos(_pegar(linha, "cnpj_fundo_cota")),
                        _pegar(linha, "nome_fundo_cota"),
                    ))
                    if len(lote) >= 20000:
                        self._gravar_carteira(lote)
                        total += len(lote)
                        lote = []
                if lote:
                    self._gravar_carteira(lote)
                    total += len(lote)
        self.con.commit()
        return total

    @staticmethod
    def _nome_bloco(nome_arquivo: str) -> str:
        m = re.search(r"(blc_\d+|confid|pl)", nome_arquivo, re.I)
        return m.group(1).upper() if m else os.path.basename(nome_arquivo)

    def _gravar_carteira(self, lote):
        self.con.executemany(
            "INSERT INTO carteira VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", lote)

    def _contar_carteira(self, competencia: str) -> int:
        return self.con.execute(
            "SELECT COUNT(*) c FROM carteira WHERE competencia = ?",
            (competencia,)).fetchone()["c"]

    # -- patrimônio líquido (informe diário) --------------------------------

    def carregar_patrimonio(self, competencia: str, forcar: bool = False) -> int:
        competencia = so_digitos(competencia)[:6]
        chave = f"pl:{competencia}"
        if self._carregado(chave) and not forcar:
            return 1
        destino = os.path.join(self.dir_cache, f"inf_diario_fi_{competencia}.zip")
        baixar(URL_INF_DIARIO.format(comp=competencia), destino, forcar=forcar,
               log=self.log)
        total = 0
        with zipfile.ZipFile(destino) as zf:
            for nome in [n for n in zf.namelist() if n.lower().endswith(".csv")]:
                with zf.open(nome) as fh:
                    dados = fh.read()
                lote = []
                for linha in ler_csv(dados):
                    cnpj = so_digitos(_pegar(linha, "cnpj_fundo"))
                    if not cnpj:
                        continue
                    lote.append((competencia, cnpj,
                                 _pegar(linha, "data_competencia"),
                                 _numero(linha.get("VL_PATRIM_LIQ")),
                                 _numero(linha.get("VL_QUOTA")),
                                 _numero(linha.get("CAPTC_DIA")),
                                 _numero(linha.get("RESG_DIA"))))
                    if len(lote) >= 20000:
                        self.con.executemany(
                            "INSERT OR REPLACE INTO patrimonio VALUES (?,?,?,?,?,?,?)",
                            lote)
                        total += len(lote)
                        lote = []
                if lote:
                    self.con.executemany(
                        "INSERT OR REPLACE INTO patrimonio VALUES (?,?,?,?,?,?,?)", lote)
                    total += len(lote)
        self.con.commit()
        self._marcar_carregado(chave)
        return total

    # -- consultas ---------------------------------------------------------

    def buscar_fundos(self, termo: str, limite: int = 30) -> List[dict]:
        """Busca por CNPJ (parcial ou completo) ou por parte da denominação."""
        digitos = so_digitos(termo)
        if digitos:
            cur = self.con.execute(
                "SELECT * FROM fundos WHERE cnpj LIKE ? ORDER BY denominacao LIMIT ?",
                (digitos + "%", limite))
            resultados = [dict(linha) for linha in cur.fetchall()]
            if resultados:
                return resultados
        padrao = f"%{(termo or '').strip().upper()}%"
        cur = self.con.execute(
            "SELECT * FROM fundos WHERE UPPER(denominacao) LIKE ? "
            "ORDER BY CASE WHEN situacao='EM FUNCIONAMENTO NORMAL' THEN 0 ELSE 1 END, "
            "denominacao LIMIT ?", (padrao, limite))
        return [dict(linha) for linha in cur.fetchall()]

    def obter_fundo(self, cnpj: str) -> Optional[dict]:
        cur = self.con.execute("SELECT * FROM fundos WHERE cnpj = ?",
                               (so_digitos(cnpj),))
        linha = cur.fetchone()
        return dict(linha) if linha else None

    def obter_patrimonio(self, cnpj: str, competencia: str) -> Optional[float]:
        cur = self.con.execute(
            "SELECT patrimonio_liquido FROM patrimonio WHERE cnpj_fundo = ? "
            "AND competencia = ? ORDER BY data_competencia DESC LIMIT 1",
            (so_digitos(cnpj), so_digitos(competencia)[:6]))
        linha = cur.fetchone()
        if linha and linha["patrimonio_liquido"]:
            return float(linha["patrimonio_liquido"])
        fundo = self.obter_fundo(cnpj)
        if fundo and fundo.get("patrimonio_liquido"):
            return float(fundo["patrimonio_liquido"])
        return None

    def obter_carteira(self, cnpj: str, competencia: str) -> List[Ativo]:
        """Devolve os ativos de um fundo em uma competência, já normalizados."""
        cur = self.con.execute(
            "SELECT * FROM carteira WHERE cnpj_fundo = ? AND competencia = ?",
            (so_digitos(cnpj), so_digitos(competencia)[:6]))
        ativos = []
        for linha in cur.fetchall():
            ativos.append(Ativo(
                descricao=linha["descricao_ativo"] or linha["nome_fundo_cota"] or
                          linha["codigo_ativo"] or linha["tipo_ativo"] or
                          linha["tipo_aplicacao"],
                tipo_aplicacao=linha["tipo_aplicacao"] or "",
                tipo_ativo=linha["tipo_ativo"] or "",
                codigo=linha["codigo_ativo"] or "",
                emissor=linha["emissor"] or "",
                cnpj_emissor=linha["cnpj_emissor"] or "",
                valor=float(linha["valor_mercado"] or 0.0),
                quantidade=float(linha["quantidade"] or 0.0),
                cnpj_fundo_investido=linha["cnpj_fundo_cota"] or "",
                nome_fundo_investido=linha["nome_fundo_cota"] or "",
                bloco=linha["bloco"] or "",
                origem="CVM/CDA",
            ))
        return ativos

    def data_base_carteira(self, cnpj: str, competencia: str) -> Optional[str]:
        cur = self.con.execute(
            "SELECT MAX(data_competencia) d FROM carteira WHERE cnpj_fundo = ? "
            "AND competencia = ?", (so_digitos(cnpj), so_digitos(competencia)[:6]))
        linha = cur.fetchone()
        return linha["d"] if linha and linha["d"] else None

    def fechar(self):
        try:
            self.con.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Utilitários de competência
# ---------------------------------------------------------------------------

def competencia_de_data(data_iso: str) -> str:
    """Converte AAAA-MM-DD em AAAAMM."""
    d = so_digitos(data_iso)
    if len(d) >= 6:
        return d[:6]
    raise ValueError(f"Data inválida: {data_iso}")


def competencias_recentes(quantidade: int = 24, referencia: Optional[date] = None
                          ) -> List[str]:
    """Lista as competências mais recentes, da mais nova para a mais antiga."""
    hoje = referencia or date.today()
    ano, mes = hoje.year, hoje.month
    saida = []
    for _ in range(quantidade):
        saida.append(f"{ano:04d}{mes:02d}")
        mes -= 1
        if mes == 0:
            mes = 12
            ano -= 1
    return saida
