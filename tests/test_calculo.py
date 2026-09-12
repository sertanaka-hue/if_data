# -*- coding: utf-8 -*-
"""Verificação do motor de FPR/RWA contra cálculos conferidos manualmente.

Execução:  python3 -m unittest discover -s tests -v
"""

import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from riskdata import regulation as reg
from riskdata.cvm import RepositorioCVM
from riskdata.demo import COMPETENCIA_DEMO, semear
from riskdata.engine import CENARIO_BANCARIA, CENARIO_NEGOCIACAO
from riskdata.lookthrough import MotorLookthrough
from riskdata.report import exportar_csv, exportar_xml, montar_relatorio
from riskdata.taxonomy import Ativo, classificar_drc, classificar_fpr


class BaseDemo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir_temp = tempfile.mkdtemp(prefix="riskdata-teste-")
        cls.repo = RepositorioCVM(dir_cache=cls.dir_temp)
        semear(cls.repo)
        cls.motor = MotorLookthrough(cls.repo)

    @classmethod
    def tearDownClass(cls):
        cls.repo.fechar()
        shutil.rmtree(cls.dir_temp, ignore_errors=True)

    def montar(self, valor=100_000_000.0, profundidade=6, info_publica=True):
        resultado = self.motor.resolver(
            "11111111000191", COMPETENCIA_DEMO, valor_posicao=valor,
            profundidade_max=profundidade, info_publica=info_publica)
        return resultado, montar_relatorio(
            resultado, COMPETENCIA_DEMO, "2026-08-31", valor_posicao=valor,
            info_publica=info_publica)


class TesteClassificacao(unittest.TestCase):
    """Cada ativo deve cair no artigo correto da Resolução BCB 229/2022."""

    def enquadrar(self, **kwargs):
        return reg.regra_fpr(classificar_fpr(Ativo(**kwargs)).regra_id)

    def test_titulo_publico_federal_fpr_zero(self):
        regra = self.enquadrar(tipo_aplicacao="Títulos Públicos", tipo_ativo="NTN-B",
                               descricao="NOTA DO TESOURO NACIONAL SERIE B")
        self.assertEqual(regra.fpr, 0.00)
        self.assertEqual(regra.artigo, "Art. 23, inciso I")

    def test_caixa_em_reais_fpr_zero(self):
        regra = self.enquadrar(tipo_aplicacao="Disponibilidades",
                               descricao="SALDO EM CONTA CORRENTE")
        self.assertEqual(regra.fpr, 0.00)
        self.assertEqual(regra.artigo, "Art. 23, inciso II")

    def test_debenture_sem_porte_vai_para_residual_100(self):
        regra = self.enquadrar(tipo_aplicacao="Debêntures", emissor="VALE S.A.",
                               descricao="DEBENTURE VALE 2028")
        self.assertEqual(regra.fpr, 1.00)
        self.assertEqual(regra.artigo, "Art. 41")

    def test_debenture_grande_porte_baixo_risco_65(self):
        ativo = Ativo(tipo_aplicacao="Debêntures", emissor="VALE S.A.",
                      atributos={"porte_emissor": "grande",
                                 "demonstracoes_auditadas": True,
                                 "ativo_problematico": False})
        regra = reg.regra_fpr(classificar_fpr(ativo).regra_id)
        self.assertEqual(regra.fpr, 0.65)
        self.assertEqual(regra.artigo, "Art. 35")

    def test_acao_listada_250(self):
        regra = self.enquadrar(tipo_aplicacao="Ações", descricao="PETROBRAS PN")
        self.assertEqual(regra.fpr, 2.50)
        self.assertEqual(regra.artigo, "Art. 43, inciso III")

    def test_acao_nao_listada_400(self):
        ativo = Ativo(tipo_aplicacao="Ações", descricao="PARTICIPACAO EM SPE",
                      atributos={"listada_em_bolsa": False})
        regra = reg.regra_fpr(classificar_fpr(ativo).regra_id)
        self.assertEqual(regra.fpr, 4.00)
        self.assertEqual(regra.artigo, "Art. 43, inciso I")

    def test_cdb_sem_categoria_usa_categoria_b_longo(self):
        regra = self.enquadrar(tipo_aplicacao="Depósitos a prazo", tipo_ativo="CDB",
                               emissor="ITAU UNIBANCO S.A.")
        self.assertEqual(regra.fpr, 0.75)

    def test_cdb_categoria_a_curto_prazo_20(self):
        ativo = Ativo(tipo_aplicacao="Depósitos a prazo", tipo_ativo="CDB",
                      atributos={"categoria_risco_if": "A", "prazo_original": 60})
        regra = reg.regra_fpr(classificar_fpr(ativo).regra_id)
        self.assertEqual(regra.fpr, 0.20)
        self.assertEqual(regra.artigo, "Art. 33, inciso I, alínea 'a'")

    def test_letra_financeira_subordinada_150(self):
        regra = self.enquadrar(tipo_aplicacao="Depósitos a prazo", tipo_ativo="LFSN",
                               descricao="LETRA FINANCEIRA SUBORDINADA")
        self.assertEqual(regra.fpr, 1.50)
        self.assertEqual(regra.artigo, "Art. 44")

    def test_securitizacao_sem_parametros_vai_a_1250(self):
        enq = classificar_fpr(Ativo(tipo_aplicacao="Títulos do Setor Imobiliário",
                                    tipo_ativo="CRI", descricao="CRI HABITASEC"))
        regra = reg.regra_fpr(enq.regra_id)
        self.assertEqual(regra.fpr, 12.50)
        self.assertIn("ponto_encaixe_A", enq.faltantes)

    def test_termo_curto_nao_gera_falso_positivo(self):
        """'cri' dentro de 'escritura' não pode enquadrar como securitização."""
        regra = self.enquadrar(tipo_aplicacao="Outras aplicações",
                               descricao="ESCRITURA DE EMISSAO", emissor="EMPRESA X")
        self.assertNotEqual(regra.artigo, "Art. 62 c/c art. 66")

    def test_derivativo_nao_cai_no_ramo_corporativo_no_drc(self):
        """Um swap com emissor preenchido deve ser tratado como derivativo."""
        enq = classificar_drc(Ativo(tipo_aplicacao="Swap", tipo_ativo="Swap",
                                    descricao="DIFERENCIAL DE SWAP DI X PRE",
                                    emissor="B3 S.A."))
        regra = reg.regra_drc(enq.regra_id)
        self.assertEqual(regra.fp, reg.FP_ACAO)
        self.assertIn("valor_nocional", enq.faltantes)

    def test_acao_no_drc_tem_fator_de_perda_integral(self):
        regra = reg.regra_drc(classificar_drc(
            Ativo(tipo_aplicacao="Ações", descricao="VALE ON")).regra_id)
        self.assertEqual(regra.fp, 1.00)
        self.assertEqual(regra.rw, 0.30)

    def test_cota_de_fundo_no_drc_usa_rw_de_15(self):
        regra = reg.regra_drc(classificar_drc(
            Ativo(tipo_aplicacao="Cotas de Fundos",
                  cnpj_fundo_investido="11111111000191")).regra_id)
        self.assertEqual(regra.rw, 0.15)
        self.assertEqual(regra.artigo, "Art. 14")


class TesteLookthrough(BaseDemo):
    """Abertura recursiva e proporção do art. 16."""

    def test_abre_todos_os_fundos_com_carteira_publicada(self):
        resultado, _ = self.montar()
        self.assertEqual(len(resultado.fundos_visitados), 3)
        self.assertEqual(len(resultado.folhas), 16)

    def test_exposicao_total_respeita_a_participacao_do_art_16(self):
        """Posição de R$ 100 mi em fundo com PL de R$ 1 bi expõe 10% da carteira."""
        _, relatorio = self.montar(valor=100_000_000.0)
        resumo = relatorio["cenarios"][CENARIO_BANCARIA]["resumo"]
        self.assertAlmostEqual(resumo["exposicao_total"], 100_000_000.0, places=2)
        self.assertAlmostEqual(
            relatorio["cabecalho"]["participacao_instituicao"], 0.10, places=6)

    def test_fundo_sem_carteira_publicada_recebe_1250(self):
        _, relatorio = self.montar()
        linhas = relatorio["cenarios"][CENARIO_BANCARIA]["linhas"]
        fidc = [l for l in linhas if "FIDC" in l["ativo"]]
        self.assertEqual(len(fidc), 1)
        self.assertEqual(fidc[0]["fator"], 12.50)
        self.assertEqual(fidc[0]["artigo"], "Art. 59, inciso II")

    def test_limite_de_profundidade_interrompe_a_abertura(self):
        resultado, _ = self.montar(profundidade=0)
        self.assertEqual(len(resultado.fundos_visitados), 1)

    def test_majoracao_do_art_17_paragrafo_7(self):
        _, publico = self.montar(info_publica=True)
        _, restrito = self.montar(info_publica=False)
        rwa_publico = publico["cenarios"][CENARIO_BANCARIA]["resumo"]["rwa_total"]
        rwa_restrito = restrito["cenarios"][CENARIO_BANCARIA]["resumo"]["rwa_total"]
        self.assertAlmostEqual(rwa_restrito / rwa_publico, 1.20, places=6)


class TesteRwa(BaseDemo):
    """Totais conferidos manualmente sobre a carteira de demonstração."""

    #: 12 + 6 + 6 + 6 + 56,25 + 112,5 + 0,5 + 57,5 (em R$ milhões)
    RWA_BANCARIA = 256_750_000.00
    #: 33,75 + 16,875 + 22,5 + 15 + 12,65625 + 33,75 + 1,875 + 86,25
    RWA_NEGOCIACAO = 222_656_250.00

    def test_rwacpad_carteira_bancaria(self):
        _, relatorio = self.montar()
        resumo = relatorio["cenarios"][CENARIO_BANCARIA]["resumo"]
        self.assertAlmostEqual(resumo["rwa_total"], self.RWA_BANCARIA, places=2)

    def test_rwadrc_carteira_negociacao(self):
        _, relatorio = self.montar()
        resumo = relatorio["cenarios"][CENARIO_NEGOCIACAO]["resumo"]
        self.assertAlmostEqual(resumo["rwa_total"], self.RWA_NEGOCIACAO, places=2)

    def test_capital_minimo_e_oito_por_cento_do_rwa(self):
        _, relatorio = self.montar()
        for cenario in (CENARIO_BANCARIA, CENARIO_NEGOCIACAO):
            resumo = relatorio["cenarios"][cenario]["resumo"]
            self.assertAlmostEqual(resumo["capital_minimo"],
                                   resumo["rwa_total"] * 0.08, places=2)

    def test_rwa_e_a_soma_das_linhas(self):
        _, relatorio = self.montar()
        for cenario in (CENARIO_BANCARIA, CENARIO_NEGOCIACAO):
            dados = relatorio["cenarios"][cenario]
            soma = sum(l["rwa"] for l in dados["linhas"])
            self.assertAlmostEqual(soma, dados["resumo"]["rwa_total"], places=2)

    def test_teto_do_art_59_paragrafo_3(self):
        """O RWA não pode superar 1.250% do valor contábil das cotas."""
        _, relatorio = self.montar(valor=1_000_000.0)
        resumo = relatorio["cenarios"][CENARIO_BANCARIA]["resumo"]
        self.assertLessEqual(resumo["rwa_total"], 12.50 * 1_000_000.0 + 0.01)

    def test_multiplicador_do_drc_e_doze_e_meio(self):
        self.assertAlmostEqual(reg.MULTIPLICADOR_DRC, 12.5, places=10)


class TesteRelatorio(BaseDemo):
    """Estrutura do relatório e das exportações."""

    def test_todas_as_linhas_citam_resolucao_e_artigo(self):
        _, relatorio = self.montar()
        for cenario in (CENARIO_BANCARIA, CENARIO_NEGOCIACAO):
            for linha in relatorio["cenarios"][cenario]["linhas"]:
                self.assertTrue(linha["resolucao"], "resolução ausente")
                self.assertTrue(linha["artigo"], "artigo ausente")

    def test_pendencias_apontam_o_dado_faltante(self):
        _, relatorio = self.montar()
        campos = {p["campo"] for p in relatorio["pendencias"]}
        self.assertIn("porte_emissor", campos)
        self.assertIn("composicao_carteira", campos)
        for p in relatorio["pendencias"]:
            self.assertTrue(p["descricao"], "pendência sem descrição legível")

    def test_csv_traz_resumo_e_detalhamento(self):
        _, relatorio = self.montar()
        csv_texto = exportar_csv(relatorio, CENARIO_BANCARIA)
        self.assertIn("RESUMO", csv_texto)
        self.assertIn("DADOS FALTANTES PARA O CÁLCULO", csv_texto)
        self.assertIn("DETALHAMENTO POR ATIVO", csv_texto)
        self.assertIn("Nome do fundo;CNPJ;Categoria;Gestor;Administrador;Ativo;Valor",
                      csv_texto)

    def test_xml_e_bem_formado_e_tem_os_totais(self):
        from xml.etree import ElementTree as ET
        _, relatorio = self.montar()
        raiz = ET.fromstring(exportar_xml(relatorio, CENARIO_NEGOCIACAO))
        self.assertEqual(raiz.tag, "RiskData")
        self.assertEqual(len(raiz.findall("Ativos/Ativo")), 16)
        self.assertAlmostEqual(
            float(raiz.find("Totais/RwaTotal").text), TesteRwa.RWA_NEGOCIACAO, places=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
