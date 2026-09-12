#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Risk Data — ponto de entrada.

Uso:
    python3 run.py servir [--porta 8000] [--demo]
    python3 run.py carregar --competencia 202608
    python3 run.py analisar --cnpj 00.000.000/0001-00 --data 2026-08-31 \
                            [--valor 100000000] [--cenario bancaria] \
                            [--formato csv|xml|resumo] [--saida relatorio.csv]
    python3 run.py demo
"""

import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from riskdata import __version__
from riskdata.anbima import ClienteANBIMA
from riskdata import cva as mod_cva
from riskdata.cvm import DIR_CACHE, RepositorioCVM, competencia_de_data
from riskdata.enriquecimento import TabelaEnriquecimento
from riskdata.demo import COMPETENCIA_DEMO, semear
from riskdata.engine import ACP_CONSERVACAO
from riskdata.lookthrough import PROFUNDIDADE_PADRAO, MotorLookthrough
from riskdata.report import exportar_csv, exportar_xml, montar_relatorio
from riskdata.server import executar
from riskdata.taxonomy import formatar_cnpj, so_digitos


def _registrar(mensagem):
    print(f"  {mensagem}", flush=True)


def comando_servir(args):
    executar(host=args.host, porta=args.porta, dir_cache=args.cache,
             modo_demo=args.demo, enriquecimento=args.enriquecimento)


def comando_carregar(args):
    repo = RepositorioCVM(dir_cache=args.cache, log=_registrar)
    print(f"Risk Data {__version__} — carga da competência {args.competencia}")
    print("Cadastro de fundos (CVM)...")
    total = repo.carregar_cadastro(forcar=args.forcar)
    print(f"  {total} fundos cadastrados.")
    print("Composição das carteiras (CDA)...")
    posicoes = repo.carregar_cda(args.competencia, forcar=args.forcar)
    print(f"  {posicoes} posições indexadas.")
    try:
        print("Informe diário (patrimônio líquido)...")
        repo.carregar_patrimonio(args.competencia, forcar=args.forcar)
        print("  patrimônio líquido carregado.")
    except Exception as exc:
        print(f"  informe diário indisponível: {exc}")
    repo.fechar()


def comando_demo(args):
    repo = RepositorioCVM(dir_cache=args.cache, log=_registrar)
    info = semear(repo)
    repo.fechar()
    print(f"Carteira de demonstração carregada: {info['fundos']} fundos, "
          f"{info['posicoes']} posições, competência {info['competencia']}.")
    print(f"CNPJ do fundo raiz: {formatar_cnpj(info['cnpj_raiz'])}")


def comando_analisar(args):
    repo = RepositorioCVM(dir_cache=args.cache, log=_registrar)
    anbima = ClienteANBIMA(log=_registrar)
    tabela = TabelaEnriquecimento.carregar(args.enriquecimento)
    if not tabela.vazia:
        print(f"Enriquecimento: {tabela.linhas} linha(s) de {args.enriquecimento}")
    motor = MotorLookthrough(repo, anbima, log=_registrar, enriquecimento=tabela)

    data_consulta = args.data or date.today().isoformat()
    competencia = args.competencia or competencia_de_data(data_consulta)
    cnpj = so_digitos(args.cnpj or "")

    if not cnpj and args.nome:
        candidatos = repo.buscar_fundos(args.nome, limite=5)
        if not candidatos:
            print(f"Nenhum fundo encontrado para '{args.nome}'.", file=sys.stderr)
            return 2
        cnpj = candidatos[0]["cnpj"]
        print(f"Fundo selecionado: {candidatos[0]['denominacao']} "
              f"({formatar_cnpj(cnpj)})")

    if not cnpj:
        print("Informe --cnpj ou --nome.", file=sys.stderr)
        return 2

    resultado = motor.resolver(cnpj, competencia, valor_posicao=args.valor,
                               profundidade_max=args.profundidade,
                               info_publica=not args.info_restrita)
    relatorio = montar_relatorio(
        resultado, competencia, data_consulta, valor_posicao=args.valor,
        acp=args.acp, info_publica=not args.info_restrita,
        origem_dados={"cvm_cda": competencia, "anbima": anbima.status(),
                      "enriquecimento": tabela.status()},
        metodo_cva=args.metodo_cva, metodo_ccr=args.metodo_ccr)

    if args.formato == "csv":
        conteudo = exportar_csv(relatorio, args.cenario)
    elif args.formato == "xml":
        conteudo = exportar_xml(relatorio, args.cenario)
    else:
        conteudo = _resumo_texto(relatorio, args.cenario)

    if args.saida:
        codificacao = "utf-8-sig" if args.formato == "csv" else "utf-8"
        with open(args.saida, "w", encoding=codificacao) as fh:
            fh.write(conteudo)
        print(f"Relatório gravado em {args.saida}")
    else:
        print(conteudo)
    repo.fechar()
    return 0


def _resumo_texto(relatorio, cenario):
    cab = relatorio["cabecalho"]
    dados = relatorio["cenarios"][cenario]
    resumo = dados["resumo"]
    linhas = [
        "=" * 92,
        f"RISK DATA — {resumo['rotulo']}",
        "=" * 92,
        f"Fundo ............. {cab['fundo_nome']}",
        f"CNPJ .............. {cab['fundo_cnpj']}",
        f"Categoria ......... {cab['fundo_categoria'] or 'Não informada'}",
        f"Gestor ............ {cab['fundo_gestor'] or 'Não informado'}",
        f"Administrador ..... {cab['fundo_administrador'] or 'Não informado'}",
        f"Data da pesquisa .. {cab['data_consulta']}   Competência: {cab['competencia']}",
        f"Patrimônio líquido  R$ {cab['patrimonio_liquido'] or 0:,.2f}",
        f"Participação ...... {cab['participacao_instituicao']:.6%}",
        f"Fundos abertos .... {cab['qtd_fundos']}   Ativos finais: {cab['qtd_ativos_finais']}"
        f"   Profundidade: {cab['profundidade_maxima']}",
        "-" * 92,
        f"Exposição total ... R$ {resumo['exposicao_total']:,.2f}",
        f"RWA total ......... R$ {resumo['rwa_total']:,.2f}",
        f"FPR médio ......... {resumo['fpr_medio']:.2%}",
        f"Capital (F=8%) .... R$ {resumo['capital_minimo']:,.2f}",
        f"Capital com ACP ... R$ {resumo['capital_com_acp']:,.2f}",
        "-" * 92,
        f"RWA CVA ........... R$ {resumo.get('rwa_cva', 0.0):,.2f}"
        f"   ({relatorio['cva'].get('base_legal', '')})",
        f"RWA com CVA ....... R$ {resumo.get('rwa_com_cva', 0.0):,.2f}",
        f"Capital com CVA ... R$ {resumo.get('capital_com_cva', 0.0):,.2f}",
        "-" * 92,
        f"{'ATIVO':<40}{'VALOR':>15}{'FPR/RW':>9}{'RWA':>16}  ARTIGO",
    ]
    for linha in sorted(dados["linhas"], key=lambda x: -x["rwa"]):
        linhas.append(f"{str(linha['ativo'])[:39]:<40}{linha['valor']:>15,.0f}"
                      f"{linha['fator_pct']:>9}{linha['rwa']:>16,.0f}  {linha['artigo']}")
    linhas.append("-" * 92)
    linhas.append(f"{'TOTAL':<40}{resumo['exposicao_total']:>15,.0f}"
                  f"{'':>9}{resumo['rwa_total']:>16,.0f}")

    if relatorio.get("pendencias"):
        linhas += ["", "DADOS FALTANTES PARA O CÁLCULO", "-" * 92]
        for p in relatorio["pendencias"]:
            linhas.append(f"- {p['descricao']} ({p['ocorrencias']} ocorrência(s), "
                          f"R$ {p['valor_afetado']:,.2f} de exposição)")
            if p.get("base_legal"):
                linhas.append(f"  base legal: {p['base_legal']}")
    if relatorio.get("avisos"):
        linhas += ["", "AVISOS", "-" * 92]
        for aviso in relatorio["avisos"]:
            linhas.append(f"- {aviso}")
    return "\n".join(linhas)


def principal():
    parser = argparse.ArgumentParser(
        prog="risk-data",
        description=f"Risk Data {__version__} — look-through de fundos de "
                    f"investimento e apuração de RWA.")
    parser.add_argument("--cache", default=DIR_CACHE,
                        help="diretório de cache dos dados públicos")
    parser.add_argument("--enriquecimento",
                        help="planilha CSV com atributos de contraparte ausentes "
                             "na CDA (porte, rating, nocional e prazo)")
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("servir", help="sobe a interface web")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--porta", type=int, default=8000)
    p.add_argument("--demo", action="store_true",
                   help="carrega a carteira de demonstração ao iniciar")
    p.set_defaults(func=comando_servir)

    p = sub.add_parser("carregar", help="baixa e indexa os dados da CVM")
    p.add_argument("--competencia", required=True, help="AAAAMM")
    p.add_argument("--forcar", action="store_true")
    p.set_defaults(func=comando_carregar)

    p = sub.add_parser("demo", help="carrega a carteira de demonstração")
    p.set_defaults(func=comando_demo)

    p = sub.add_parser("analisar", help="gera o relatório de um fundo")
    p.add_argument("--cnpj")
    p.add_argument("--nome", help="busca pelo nome quando o CNPJ não é conhecido")
    p.add_argument("--data", help="data da pesquisa (AAAA-MM-DD)")
    p.add_argument("--competencia", help="AAAAMM; padrão: derivada da data")
    p.add_argument("--valor", type=float, help="valor da posição da instituição")
    p.add_argument("--profundidade", type=int, default=PROFUNDIDADE_PADRAO)
    p.add_argument("--cenario", choices=["bancaria", "negociacao"],
                   default="bancaria")
    p.add_argument("--formato", choices=["resumo", "csv", "xml"], default="resumo")
    p.add_argument("--saida", help="arquivo de destino")
    p.add_argument("--acp", type=float, default=ACP_CONSERVACAO)
    p.add_argument("--info-restrita", action="store_true",
                   help="aplica a majoração de 120% do art. 17, § 7º")
    p.add_argument("--metodo-cva", choices=[mod_cva.METODO_ALTERNATIVO,
                                            mod_cva.METODO_COMPLETO],
                   default=mod_cva.METODO_ALTERNATIVO,
                   help="abordagem do RWACVA: alternativa (art. 2º, § 2º) ou "
                        "completa (art. 2º, caput)")
    p.add_argument("--metodo-ccr", choices=[mod_cva.CCR_SACCR, mod_cva.CCR_CEM],
                   default=mod_cva.CCR_SACCR,
                   help="apuração da exposição do derivativo: SA-CCR (Anexo I) "
                        "ou CEM (Anexo II) da Res. BCB 229/2022")
    p.set_defaults(func=comando_analisar)

    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(principal())
