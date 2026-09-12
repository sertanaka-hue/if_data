# -*- coding: utf-8 -*-
"""Abertura recursiva da carteira de um fundo até os ativos finais.

Regras observadas (Resolução BCB nº 229/2022):
    art. 16      - a exposição é o total das exposições do fundo na proporção da
                   participação da instituição no patrimônio líquido
    art. 17      - identificação das exposições (transparência); § 2º e § 3º
                   tratam da defasagem admitida das informações
    art. 17, §7º - majoração de 120% se a informação não for pública nem
                   disponibilizada pelo administrador
    art. 17, §8º - fração não identificada recebe o tratamento do art. 59, II
    art. 18, §5º - é vedado inferir a exposição de fundo cuja cota tenha sido
                   adquirida por meio de outro fundo igualmente adquirido via fundo
    art. 59, II  - FPR de 1.250% quando a exposição não é identificada nem inferida
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, List, Optional

from . import regulation as reg
from .taxonomy import Ativo, formatar_cnpj, so_digitos

#: Profundidade máxima de aninhamento percorrida por padrão.
PROFUNDIDADE_PADRAO = 6

#: Tolerância na conciliação entre soma da carteira e patrimônio líquido.
TOLERANCIA_COBERTURA = 0.005  # 0,5%


@dataclass
class NoFundo:
    """Um fundo na árvore de look-through."""

    cnpj: str
    nome: str = ""
    categoria: str = ""
    gestor: str = ""
    administrador: str = ""
    nivel: int = 0
    #: fração do patrimônio deste fundo atribuível à instituição
    fator: float = 1.0
    #: valor da cota deste fundo detido pelo fundo-pai (0 na raiz)
    valor_cota_no_pai: float = 0.0
    patrimonio_liquido: Optional[float] = None
    total_carteira: float = 0.0
    data_base: str = ""
    competencia: str = ""
    caminho: List[str] = field(default_factory=list)
    filhos: List["NoFundo"] = field(default_factory=list)
    ativos: List["Folha"] = field(default_factory=list)
    avisos: List[str] = field(default_factory=list)
    #: motivo pelo qual o fundo não foi aberto (quando aplicável)
    nao_aberto: str = ""

    def to_dict(self) -> dict:
        return {
            "cnpj": self.cnpj, "cnpj_formatado": formatar_cnpj(self.cnpj),
            "nome": self.nome, "categoria": self.categoria, "gestor": self.gestor,
            "administrador": self.administrador, "nivel": self.nivel,
            "fator": self.fator, "valor_cota_no_pai": self.valor_cota_no_pai,
            "patrimonio_liquido": self.patrimonio_liquido,
            "total_carteira": self.total_carteira, "data_base": self.data_base,
            "competencia": self.competencia, "caminho": self.caminho,
            "avisos": self.avisos, "nao_aberto": self.nao_aberto,
            "filhos": [f.to_dict() for f in self.filhos],
            "qtd_ativos": len(self.ativos),
        }


@dataclass
class Folha:
    """Um ativo final, já atribuído à instituição pela cadeia de participações."""

    ativo: Ativo
    #: fundo que detém diretamente o ativo
    fundo_cnpj: str
    fundo_nome: str
    fundo_categoria: str = ""
    fundo_gestor: str = ""
    fundo_administrador: str = ""
    nivel: int = 0
    #: cadeia de fundos percorrida, do topo até o detentor
    caminho: List[str] = field(default_factory=list)
    #: fração acumulada aplicada ao valor do ativo
    fator: float = 1.0
    #: valor atribuído à instituição (ativo.valor * fator)
    valor_atribuido: float = 0.0
    #: majoração do art. 17, § 7º já aplicada ao valor
    majoracao: float = 1.0
    #: quando a folha representa uma fração não identificada
    residual: bool = False
    observacoes: List[str] = field(default_factory=list)


@dataclass
class ResultadoLookthrough:
    raiz: Optional[NoFundo]
    folhas: List[Folha] = field(default_factory=list)
    fundos_visitados: Dict[str, NoFundo] = field(default_factory=dict)
    avisos: List[str] = field(default_factory=list)
    pendencias: List[dict] = field(default_factory=list)
    ciclos: List[List[str]] = field(default_factory=list)
    profundidade_maxima: int = 0
    #: maior nível alcançado, inclusive fundos referenciados mas não abertos
    nivel_referenciado_maximo: int = 0

    def registrar_pendencia(self, tipo: str, mensagem: str, **extra):
        item = {"tipo": tipo, "mensagem": mensagem}
        item.update(extra)
        self.pendencias.append(item)


class MotorLookthrough:
    """Percorre a cadeia de fundos usando o repositório da CVM."""

    def __init__(self, repositorio, anbima=None, log=None, enriquecimento=None):
        self.repo = repositorio
        self.anbima = anbima
        self.log = log or (lambda m: None)
        #: tabela opcional com atributos de contraparte ausentes na CDA
        self.enriquecimento = enriquecimento

    # -- API pública -------------------------------------------------------

    def resolver(self, cnpj: str, competencia: str,
                 valor_posicao: Optional[float] = None,
                 profundidade_max: int = PROFUNDIDADE_PADRAO,
                 info_publica: bool = True) -> ResultadoLookthrough:
        """Abre o fundo e todos os fundos investidos até os ativos finais.

        valor_posicao: valor aplicado pela instituição. Quando omitido, a
        carteira é analisada integralmente (participação de 100%).
        info_publica: False aplica a majoração de 120% do art. 17, § 7º.
        """
        cnpj = so_digitos(cnpj)
        resultado = ResultadoLookthrough(raiz=None)
        majoracao = 1.0 if info_publica else reg.MAJORACAO_INFO_NAO_PUBLICA
        if not info_publica:
            resultado.avisos.append(
                "Aplicada majoração de 120% sobre o valor das exposições por uso de "
                "informação que não é de domínio público nem disponibilizada pelo "
                f"administrador ({reg.RES_229}, art. 17, § 7º).")

        raiz = self._montar_no(cnpj, competencia, nivel=0, caminho=[],
                               fator=1.0, valor_cota_no_pai=0.0)
        if raiz is None:
            resultado.avisos.append(
                f"Fundo {formatar_cnpj(cnpj)} não encontrado no cadastro da CVM.")
            resultado.registrar_pendencia(
                "fundo_inexistente",
                f"CNPJ {formatar_cnpj(cnpj)} não localizado na base cadastral da CVM.",
                cnpj=cnpj)
            return resultado

        # Participação da instituição no patrimônio do fundo (art. 16).
        if valor_posicao and valor_posicao > 0:
            base = raiz.patrimonio_liquido or raiz.total_carteira
            if base and base > 0:
                raiz.fator = float(valor_posicao) / float(base)
            else:
                raiz.fator = 1.0
                resultado.registrar_pendencia(
                    "patrimonio_liquido",
                    "Patrimônio líquido do fundo não disponível para calcular a "
                    "participação da instituição (art. 16). Carteira analisada "
                    "integralmente.",
                    cnpj=cnpj,
                    campo="patrimonio_liquido_fundo")

        resultado.raiz = raiz
        resultado.fundos_visitados[cnpj] = raiz
        self._percorrer(raiz, competencia, resultado, profundidade_max, majoracao,
                        visitados={cnpj})
        resultado.profundidade_maxima = max(
            [f.nivel for f in resultado.folhas] +
            [no.nivel for no in resultado.fundos_visitados.values()] +
            [resultado.nivel_referenciado_maximo])
        self._conferir_defasagem(resultado, competencia)
        return resultado

    # -- montagem de nós ---------------------------------------------------

    def _montar_no(self, cnpj, competencia, nivel, caminho, fator,
                   valor_cota_no_pai, nome_sugerido="") -> Optional[NoFundo]:
        cadastro = self.repo.obter_fundo(cnpj)
        if cadastro is None and not nome_sugerido:
            return None
        cadastro = cadastro or {"cnpj": cnpj, "denominacao": nome_sugerido}
        if self.anbima is not None:
            try:
                cadastro = self.anbima.enriquecer(cadastro)
            except Exception as exc:  # a indisponibilidade da ANBIMA não é fatal
                self.log(f"ANBIMA indisponível para {cnpj}: {exc}")

        ativos = self.repo.obter_carteira(cnpj, competencia)
        if self.enriquecimento is not None and not self.enriquecimento.vazia:
            for ativo in ativos:
                self.enriquecimento.aplicar(ativo)
        total = sum(a.valor for a in ativos)
        no = NoFundo(
            cnpj=cnpj,
            nome=cadastro.get("denominacao") or nome_sugerido or formatar_cnpj(cnpj),
            categoria=cadastro.get("categoria_anbima") or cadastro.get("classe") or "",
            gestor=cadastro.get("gestor", ""),
            administrador=cadastro.get("administrador", ""),
            nivel=nivel, fator=fator, valor_cota_no_pai=valor_cota_no_pai,
            patrimonio_liquido=self.repo.obter_patrimonio(cnpj, competencia),
            total_carteira=total,
            data_base=self.repo.data_base_carteira(cnpj, competencia) or "",
            competencia=competencia,
            caminho=list(caminho) + [cnpj],
        )
        no._ativos_brutos = ativos  # usado por _percorrer
        return no

    # -- travessia ---------------------------------------------------------

    def _percorrer(self, no: NoFundo, competencia, resultado, profundidade_max,
                   majoracao, visitados):
        ativos = getattr(no, "_ativos_brutos", [])
        if not ativos:
            motivo = (f"Composição da carteira não disponível na CDA/CVM para o fundo "
                      f"{no.nome} ({formatar_cnpj(no.cnpj)}) na competência "
                      f"{competencia}.")
            no.nao_aberto = motivo
            no.avisos.append(motivo)
            self._registrar_nao_identificado(no, resultado, majoracao, motivo)
            return

        for ativo in ativos:
            if ativo.eh_cota_de_fundo and so_digitos(ativo.cnpj_fundo_investido):
                self._tratar_cota(no, ativo, competencia, resultado,
                                  profundidade_max, majoracao, visitados)
            else:
                resultado.folhas.append(self._folha(no, ativo, majoracao))

        self._conciliar_cobertura(no, resultado, majoracao)

    def _tratar_cota(self, pai: NoFundo, ativo: Ativo, competencia, resultado,
                     profundidade_max, majoracao, visitados):
        cnpj_filho = so_digitos(ativo.cnpj_fundo_investido)
        nivel_filho = pai.nivel + 1
        caminho = pai.caminho
        resultado.nivel_referenciado_maximo = max(
            resultado.nivel_referenciado_maximo, nivel_filho)

        # Ciclo: o fundo já aparece na cadeia percorrida.
        if cnpj_filho in caminho:
            ciclo = caminho + [cnpj_filho]
            resultado.ciclos.append(ciclo)
            aviso = (f"Ciclo de participações detectado: o fundo "
                     f"{formatar_cnpj(cnpj_filho)} já consta na cadeia. A cota foi "
                     f"mantida como ativo final para evitar recursão infinita.")
            folha = self._folha(pai, ativo, majoracao)
            folha.observacoes.append(aviso)
            resultado.folhas.append(folha)
            resultado.avisos.append(aviso)
            return

        # Limite de profundidade configurado pelo usuário.
        if nivel_filho > profundidade_max:
            motivo = (f"Profundidade máxima de {profundidade_max} níveis atingida; o "
                      f"fundo {ativo.nome_fundo_investido or formatar_cnpj(cnpj_filho)} "
                      f"não foi aberto.")
            folha = self._folha(pai, ativo, majoracao, residual=True)
            folha.observacoes.append(motivo)
            resultado.folhas.append(folha)
            resultado.registrar_pendencia(
                "profundidade", motivo, cnpj=cnpj_filho,
                artigo="Art. 59, inciso II", resolucao=reg.RES_229)
            return

        filho = self._montar_no(
            cnpj_filho, competencia, nivel_filho, caminho,
            fator=0.0, valor_cota_no_pai=ativo.valor,
            nome_sugerido=ativo.nome_fundo_investido or ativo.descricao)

        # Sem carteira publicada: exposição não identificada nem inferível.
        if filho is None or not getattr(filho, "_ativos_brutos", []):
            nome = (ativo.nome_fundo_investido or ativo.descricao
                    or formatar_cnpj(cnpj_filho))
            if nivel_filho >= 2:
                motivo = (
                    f"Fundo {nome}: cota adquirida por meio de outro fundo igualmente "
                    f"adquirido via fundo. É vedado inferir a exposição "
                    f"({reg.RES_229}, art. 18, § 5º) e a composição não está "
                    f"disponível na CDA/CVM, o que atrai o FPR de 1.250% "
                    f"({reg.RES_229}, art. 59, II).")
            else:
                motivo = (
                    f"Fundo {nome}: composição não disponível na CDA/CVM para a "
                    f"competência {competencia}. Sem identificação (art. 17) nem "
                    f"inferência pelo regulamento (art. 18), aplica-se o FPR de "
                    f"1.250% ({reg.RES_229}, art. 59, II).")
            folha = self._folha(pai, ativo, majoracao, residual=True)
            folha.observacoes.append(motivo)
            resultado.folhas.append(folha)
            resultado.registrar_pendencia(
                "carteira_indisponivel", motivo, cnpj=cnpj_filho, nome=nome,
                campo="composicao_carteira", artigo="Art. 59, inciso II",
                resolucao=reg.RES_229)
            return

        # Participação do fundo-pai no patrimônio do fundo investido.
        base = filho.patrimonio_liquido or filho.total_carteira
        if base and base > 0:
            filho.fator = pai.fator * (ativo.valor / base)
        else:
            filho.fator = pai.fator
            aviso = (f"Patrimônio líquido do fundo {filho.nome} indisponível; a "
                     f"proporção do art. 16 não pôde ser apurada.")
            filho.avisos.append(aviso)
            resultado.registrar_pendencia(
                "patrimonio_liquido", aviso, cnpj=cnpj_filho,
                campo="patrimonio_liquido_fundo")

        pai.filhos.append(filho)
        resultado.fundos_visitados[cnpj_filho] = filho
        self._percorrer(filho, competencia, resultado, profundidade_max, majoracao,
                        visitados | {cnpj_filho})

    # -- folhas e conciliação ----------------------------------------------

    def _folha(self, no: NoFundo, ativo: Ativo, majoracao: float,
               residual: bool = False) -> Folha:
        valor = ativo.valor * no.fator * majoracao
        return Folha(
            ativo=ativo, fundo_cnpj=no.cnpj, fundo_nome=no.nome,
            fundo_categoria=no.categoria, fundo_gestor=no.gestor,
            fundo_administrador=no.administrador, nivel=no.nivel,
            caminho=list(no.caminho), fator=no.fator, valor_atribuido=valor,
            majoracao=majoracao, residual=residual)

    def _conciliar_cobertura(self, no: NoFundo, resultado, majoracao):
        """Art. 17, § 8º - a fração não identificada da carteira vai a 1.250%."""
        pl = no.patrimonio_liquido
        if not pl or pl <= 0 or no.total_carteira <= 0:
            return
        diferenca = pl - no.total_carteira
        if diferenca <= pl * TOLERANCIA_COBERTURA:
            return
        proporcao = diferenca / pl
        ativo = Ativo(
            descricao=f"Fração não identificada da carteira ({proporcao:.2%} do PL)",
            tipo_aplicacao="Fração não identificada",
            tipo_ativo="NAO_IDENTIFICADO",
            valor=diferenca, origem="Conciliação PL x CDA")
        folha = self._folha(no, ativo, majoracao, residual=True)
        folha.observacoes.append(
            f"Diferença entre o patrimônio líquido e a soma das posições informadas "
            f"na CDA. Tratada como fração não identificada ({reg.RES_229}, art. 17, "
            f"§ 8º), sujeita ao FPR de 1.250% ({reg.RES_229}, art. 59, II).")
        resultado.folhas.append(folha)
        resultado.registrar_pendencia(
            "fracao_nao_identificada",
            f"Fundo {no.nome}: {proporcao:.2%} do patrimônio líquido não está "
            f"identificado na CDA.", cnpj=no.cnpj, valor=diferenca,
            campo="composicao_carteira", artigo="Art. 17, § 8º",
            resolucao=reg.RES_229)

    def _registrar_nao_identificado(self, no: NoFundo, resultado, majoracao, motivo):
        base = no.patrimonio_liquido or no.valor_cota_no_pai
        if not base:
            resultado.registrar_pendencia(
                "carteira_indisponivel", motivo, cnpj=no.cnpj,
                campo="composicao_carteira", artigo="Art. 59, inciso II",
                resolucao=reg.RES_229)
            return
        ativo = Ativo(
            descricao=f"Carteira não identificada - {no.nome}",
            tipo_aplicacao="Fração não identificada",
            tipo_ativo="NAO_IDENTIFICADO",
            valor=base, origem="Sem CDA publicada")
        folha = self._folha(no, ativo, majoracao, residual=True)
        folha.observacoes.append(motivo)
        resultado.folhas.append(folha)
        resultado.registrar_pendencia(
            "carteira_indisponivel", motivo, cnpj=no.cnpj, valor=base,
            campo="composicao_carteira", artigo="Art. 59, inciso II",
            resolucao=reg.RES_229)

    def _conferir_defasagem(self, resultado, competencia):
        """Art. 17, §§ 2º e 3º - defasagem das informações utilizadas."""
        datas = [no.data_base for no in resultado.fundos_visitados.values()
                 if no.data_base]
        if not datas:
            return
        try:
            mais_antiga = min(datetime.strptime(d[:10], "%Y-%m-%d").date()
                              for d in datas)
        except ValueError:
            return
        atraso = (date.today() - mais_antiga).days
        if atraso > reg.DEFASAGEM_MAX_DIAS_SIGILO:
            resultado.avisos.append(
                f"As informações de carteira mais antigas utilizadas têm {atraso} dias "
                f"corridos. O art. 17, § 2º, admite até {reg.DEFASAGEM_MAX_DIAS} dias e "
                f"o § 3º até {reg.DEFASAGEM_MAX_DIAS_SIGILO} dias para carteiras com "
                f"sigilo autorizado pela CVM. Avalie usar competência mais recente.")
        elif atraso > reg.DEFASAGEM_MAX_DIAS:
            resultado.avisos.append(
                f"As informações de carteira têm {atraso} dias corridos, acima dos "
                f"{reg.DEFASAGEM_MAX_DIAS} dias do art. 17, § 2º. O prazo de "
                f"{reg.DEFASAGEM_MAX_DIAS_SIGILO} dias do § 3º só se aplica a fundos "
                f"cuja divulgação possa ser prejudicada, na forma definida pela CVM.")
