# -*- coding: utf-8 -*-
"""Verificação do motor de FPR/RWA contra cálculos conferidos manualmente.

Execução:  python3 -m unittest discover -s tests -v
"""

import math
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
        self.assertEqual(len(resultado.folhas), 17)

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
        self.assertEqual(len(raiz.findall("Ativos/Ativo")), 17)
        self.assertAlmostEqual(
            float(raiz.find("Totais/RwaTotal").text), TesteRwa.RWA_NEGOCIACAO, places=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)


# ---------------------------------------------------------------------------
# Parcela RWACVA — Resolução BCB nº 291/2023
# ---------------------------------------------------------------------------

class TesteCva(unittest.TestCase):
    """Fórmulas do art. 2º conferidas contra cálculo manual."""

    def derivativo(self, contraparte="BANCO X", nocional=100.0, reposicao=85.0,
                   prazo=None, **kwargs):
        from riskdata.cva import Derivativo
        return Derivativo(descricao=f"SWAP {contraparte}", tipo="swap",
                          contraparte=contraparte, nocional=nocional,
                          valor_reposicao=reposicao, prazo_anos=prazo, **kwargs)

    def test_fator_de_desconto(self):
        """d = (1 − e^(−0,05 M)) / 0,05, art. 2º, inciso II."""
        from riskdata.cva import fator_desconto
        self.assertAlmostEqual(fator_desconto(1.0), 0.97541151, places=8)
        self.assertAlmostEqual(fator_desconto(5.0), 4.42398434, places=7)
        self.assertEqual(fator_desconto(0.0), 0.0)

    def test_prazo_medio_ponderado_por_valor_de_referencia(self):
        """M_i = Σ(M0 × R0) / Σ R0, art. 2º, inciso II, alínea 'a'."""
        from riskdata.cva import prazo_medio_ponderado
        self.assertAlmostEqual(
            prazo_medio_ponderado([(1.0, 100.0), (5.0, 300.0)]), 4.0, places=9)
        self.assertIsNone(prazo_medio_ponderado([]))

    def test_exposicao_pelo_cem_usa_fator_de_15_por_cento(self):
        """Art. 17, §§ 5º e 6º da Res. BCB 229/2022 sobre nocional."""
        from riskdata.cva import CCR_CEM, exposicao_ccr
        exp, _, _ = exposicao_ccr(self.derivativo(nocional=100.0, reposicao=0.0),
                                  CCR_CEM)
        self.assertAlmostEqual(exp, 15.0, places=9)

    def test_exposicao_pelo_sa_ccr_aplica_alfa_de_1_4(self):
        from riskdata.cva import CCR_SACCR, exposicao_ccr
        exp, _, _ = exposicao_ccr(self.derivativo(nocional=100.0, reposicao=0.0),
                                  CCR_SACCR)
        self.assertAlmostEqual(exp, 21.0, places=9)

    def test_abordagem_alternativa_uma_contraparte(self):
        """RWA = 0,1 × 12,5 × raiz(0,25 EXP² + 0,75 EXP²) = 1,25 × EXP."""
        from riskdata.cva import CCR_CEM, METODO_ALTERNATIVO, calcular
        r = calcular([self.derivativo(nocional=100.0, reposicao=85.0)],
                     metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        self.assertAlmostEqual(r.exposicao_total, 100.0, places=9)
        self.assertAlmostEqual(r.rwa, 125.0, places=6)

    def test_abordagem_alternativa_duas_contrapartes(self):
        from riskdata.cva import CCR_CEM, METODO_ALTERNATIVO, calcular
        r = calcular([self.derivativo("BANCO X"), self.derivativo("BANCO Y")],
                     metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        esperado = 0.1 * 12.5 * math.sqrt(0.25 * 200.0 ** 2 + 0.75 * (100.0 ** 2 * 2))
        self.assertAlmostEqual(r.rwa, esperado, places=6)

    def test_abordagem_completa_com_prazo(self):
        """RWA = 2,33 × 0,01 × 12,5 × raiz(...), art. 2º, caput."""
        from riskdata.cva import (CCR_CEM, METODO_COMPLETO, calcular,
                                  fator_desconto)
        r = calcular([self.derivativo(prazo=1.0)], metodo=METODO_COMPLETO,
                     metodo_ccr=CCR_CEM)
        d = fator_desconto(1.0)
        esperado = 2.33 * 0.01 * 12.5 * math.sqrt(
            (0.5 * d * 100.0) ** 2 + 0.75 * (d * 100.0) ** 2)
        self.assertAlmostEqual(r.rwa, esperado, places=6)
        self.assertAlmostEqual(r.contrapartes[0].prazo_medio, 1.0, places=9)

    def test_hedge_de_credito_reduz_a_parcela(self):
        """Art. 2º, incisos IV e V: d_i^h × B_i^h abate o termo da contraparte."""
        from riskdata.cva import (CCR_CEM, METODO_COMPLETO, HedgeCredito,
                                  calcular)
        sem = calcular([self.derivativo(prazo=1.0)], metodo=METODO_COMPLETO,
                       metodo_ccr=CCR_CEM)
        com = calcular([self.derivativo(prazo=1.0)],
                       hedges=[HedgeCredito(contraparte="BANCO X",
                                            valor_referencia=50.0, prazo_anos=1.0)],
                       metodo=METODO_COMPLETO, metodo_ccr=CCR_CEM)
        self.assertLess(com.rwa, sem.rwa)
        self.assertAlmostEqual(com.rwa, sem.rwa / 2.0, places=6)

    def test_abordagem_alternativa_ignora_hedge(self):
        """O art. 2º, § 2º não reconhece hedge."""
        from riskdata.cva import (CCR_CEM, METODO_ALTERNATIVO, HedgeCredito,
                                  calcular)
        hedge = [HedgeCredito(contraparte="BANCO X", valor_referencia=50.0,
                              prazo_anos=1.0)]
        sem = calcular([self.derivativo()], metodo=METODO_ALTERNATIVO,
                       metodo_ccr=CCR_CEM)
        com = calcular([self.derivativo()], hedges=hedge,
                       metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        self.assertAlmostEqual(sem.rwa, com.rwa, places=9)

    def test_exclusao_de_operacao_com_contraparte_central(self):
        """Art. 2º, § 1º, inciso I."""
        from riskdata.cva import CCR_CEM, METODO_ALTERNATIVO, Derivativo, calcular
        r = calcular([Derivativo(descricao="MERCADO FUTURO DI", tipo="Mercado Futuro",
                                 contraparte="B3 S.A.", nocional=1000.0,
                                 valor_reposicao=10.0)],
                     metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        self.assertEqual(r.rwa, 0.0)
        self.assertEqual(len(r.excluidos), 1)
        self.assertEqual(r.excluidos[0]["artigo"], "Art. 2º, § 1º, inciso I")

    def test_exclusao_de_contraparte_soberana(self):
        """Art. 2º, § 1º, inciso II."""
        from riskdata.cva import CCR_CEM, METODO_ALTERNATIVO, calcular
        r = calcular([self.derivativo("TESOURO NACIONAL", contraparte_isenta=True)],
                     metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        self.assertEqual(r.rwa, 0.0)
        self.assertEqual(r.excluidos[0]["artigo"], "Art. 2º, § 1º, inciso II")

    def test_exclusao_de_swap_de_credito_receptor_de_risco(self):
        """Art. 2º, § 1º, inciso III."""
        from riskdata.cva import CCR_CEM, METODO_ALTERNATIVO, calcular
        r = calcular([self.derivativo("BANCO X", receptor_risco_credito=True)],
                     metodo=METODO_ALTERNATIVO, metodo_ccr=CCR_CEM)
        self.assertEqual(r.excluidos[0]["artigo"], "Art. 2º, § 1º, inciso III")

    def test_derivativo_sem_nocional_fica_pendente(self):
        from riskdata.cva import METODO_ALTERNATIVO, Derivativo, calcular
        r = calcular([Derivativo(descricao="SWAP SEM DADOS", tipo="swap",
                                 contraparte="BANCO W", valor_mercado=500.0)],
                     metodo=METODO_ALTERNATIVO)
        self.assertFalse(r.calculavel)
        self.assertEqual(len(r.nao_apurados), 1)
        self.assertIn("valor_nocional", r.nao_apurados[0]["faltantes"])


class TesteCvaNoRelatorio(BaseDemo):
    """Integração da parcela RWACVA ao relatório e às exportações."""

    def montar_enriquecido(self, **kwargs):
        from riskdata.enriquecimento import TabelaEnriquecimento
        caminho = os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), "samples", "enriquecimento_exemplo.csv")
        tabela = TabelaEnriquecimento.carregar(caminho)
        motor = MotorLookthrough(self.repo, enriquecimento=tabela)
        resultado = motor.resolver("11111111000191", COMPETENCIA_DEMO,
                                   valor_posicao=100_000_000.0)
        return resultado, montar_relatorio(
            resultado, COMPETENCIA_DEMO, "2026-08-31",
            valor_posicao=100_000_000.0, **kwargs)

    def test_sem_enriquecimento_o_swap_fica_pendente(self):
        _, relatorio = self.montar()
        cva = relatorio["cva"]
        self.assertEqual(cva["qtd_considerados"], 0)
        self.assertEqual(len(cva["nao_apurados"]), 1)
        self.assertEqual(cva["rwa"], 0.0)

    def test_com_enriquecimento_a_parcela_e_apurada(self):
        """Nocional 250 mi a 10% de participação, reposição 12 mi, SA-CCR."""
        _, relatorio = self.montar_enriquecido()
        cva = relatorio["cva"]
        self.assertEqual(cva["qtd_considerados"], 1)
        # EXP = 1,4 × (1,2 mi + 0,15 × 25 mi) = 6,93 mi
        self.assertAlmostEqual(cva["exposicao_total"], 6_930_000.0, places=2)
        # RWA = 1,25 × EXP para uma única contraparte
        self.assertAlmostEqual(cva["rwa"], 8_662_500.0, places=2)

    def test_futuro_de_bolsa_e_excluido_da_parcela(self):
        _, relatorio = self.montar_enriquecido()
        excluidos = relatorio["cva"]["excluidos"]
        self.assertEqual(len(excluidos), 1)
        self.assertIn("FUTURO", excluidos[0]["descricao"].upper())

    def test_cva_entra_nos_dois_cenarios(self):
        """Art. 3º da Res. BCB 291/2023: carteira bancária e de negociação."""
        _, relatorio = self.montar_enriquecido()
        cva_rwa = relatorio["cva"]["rwa"]
        self.assertGreater(cva_rwa, 0)
        for cenario in (CENARIO_BANCARIA, CENARIO_NEGOCIACAO):
            resumo = relatorio["cenarios"][cenario]["resumo"]
            self.assertAlmostEqual(resumo["rwa_cva"], cva_rwa, places=2)
            self.assertAlmostEqual(resumo["rwa_com_cva"],
                                   resumo["rwa_total"] + cva_rwa, places=2)
            self.assertAlmostEqual(resumo["capital_com_cva"],
                                   resumo["rwa_com_cva"] * 0.08, places=2)

    def test_enriquecimento_reduz_o_fpr_das_debentures(self):
        """Porte grande e baixo risco leva a debênture de 100% (art. 41) a 65% (art. 35)."""
        _, relatorio = self.montar_enriquecido()
        linhas = relatorio["cenarios"][CENARIO_BANCARIA]["linhas"]
        debentures = [l for l in linhas if "DEBENTURE" in l["ativo"].upper()]
        self.assertTrue(debentures)
        for linha in debentures:
            self.assertAlmostEqual(linha["fator"], 0.65, places=6)
            self.assertEqual(linha["artigo"], "Art. 35")

    def test_csv_traz_a_secao_do_cva(self):
        _, relatorio = self.montar_enriquecido()
        texto = exportar_csv(relatorio, CENARIO_BANCARIA)
        self.assertIn("PARCELA RWA CVA", texto)
        self.assertIn("Resolução BCB nº 291/2023", texto)
        self.assertIn("Derivativos excluídos", texto)

    def test_xml_traz_o_bloco_do_cva(self):
        from xml.etree import ElementTree as ET
        _, relatorio = self.montar_enriquecido()
        raiz = ET.fromstring(exportar_xml(relatorio, CENARIO_NEGOCIACAO))
        bloco = raiz.find("RwaCva")
        self.assertIsNotNone(bloco)
        self.assertIn("291", bloco.get("baseLegal"))
        self.assertEqual(len(raiz.findall("RwaCva/Contraparte")), 1)
        self.assertIsNotNone(raiz.find("Totais/RwaTotalComCva"))


class TesteEnriquecimento(unittest.TestCase):
    """Leitura da planilha de atributos ausentes na CDA."""

    def carregar(self, conteudo):
        from riskdata.enriquecimento import TabelaEnriquecimento
        caminho = tempfile.mktemp(suffix=".csv")
        with open(caminho, "w", encoding="utf-8") as fh:
            fh.write(conteudo)
        try:
            return TabelaEnriquecimento.carregar(caminho)
        finally:
            os.unlink(caminho)

    def test_converte_numeros_com_virgula_decimal(self):
        tabela = self.carregar("codigo;valor_nocional;prazo_derivativo\nABC;1.500.000,50;2,5\n")
        registro = tabela.por_codigo["abc"]
        self.assertAlmostEqual(registro["valor_nocional"], 1_500_000.50, places=2)
        self.assertAlmostEqual(registro["prazo_derivativo"], 2.5, places=6)

    def test_converte_booleanos_em_portugues(self):
        tabela = self.carregar("codigo;listada_em_bolsa;liquidacao_ccp\nABC;sim;nao\n")
        registro = tabela.por_codigo["abc"]
        self.assertIs(registro["listada_em_bolsa"], True)
        self.assertIs(registro["liquidacao_ccp"], False)

    def test_nao_sobrescreve_atributo_ja_existente(self):
        tabela = self.carregar("codigo;porte_emissor\nABC;grande\n")
        ativo = Ativo(codigo="ABC", atributos={"porte_emissor": "pequeno"})
        tabela.aplicar(ativo)
        self.assertEqual(ativo.atributos["porte_emissor"], "pequeno")

    def test_tabela_ausente_nao_quebra(self):
        from riskdata.enriquecimento import TabelaEnriquecimento
        tabela = TabelaEnriquecimento.carregar("/caminho/que/nao/existe.csv")
        self.assertTrue(tabela.vazia)
        self.assertEqual(tabela.aplicar(Ativo(codigo="X")), 0)
