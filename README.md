# Risk Data

Sistema de abertura de carteiras de fundos de investimento (*look-through*) com
apuração de FPR e RWA segundo os normativos prudenciais do Banco Central.

A consulta parte do **CNPJ ou do nome do fundo**. Quando o fundo detém cotas de
outros fundos, o Risk Data abre cada um deles recursivamente até chegar aos
**ativos finais**, atribui a cada ativo o **Fator de Ponderação de Risco (FPR)**
correspondente — **citando o artigo e a resolução que originaram o FPR** — e
totaliza o RWA e o capital requerido em dois cenários: **carteira de negociação**
e **carteira bancária**.

---

## Como executar

Requer apenas **Python 3.8 ou superior**. Não há dependências externas — decisão
deliberada, para que o sistema rode em ambiente corporativo restrito sem
instalação de pacotes.

```bash
# 1. Subir a interface
python3 run.py servir --porta 8000

# 2. Abrir no navegador
http://127.0.0.1:8000
```

Para conhecer o sistema antes de baixar as bases públicas (que levam alguns
minutos), suba com a carteira de demonstração:

```bash
python3 run.py servir --demo
```

### Primeira carga dos dados públicos

Na tela, escolha a competência e clique em **Carregar dados da CVM**. Isso baixa
e indexa, em SQLite local:

| Conjunto | Origem |
| --- | --- |
| Cadastro de fundos | `dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv` |
| Composição da carteira (CDA) | `dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/cda_fi_AAAAMM.zip` |
| Patrimônio líquido (informe diário) | `dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_AAAAMM.zip` |

Equivalente por linha de comando:

```bash
python3 run.py carregar --competencia 202608
```

### ANBIMA (opcional)

O Feed de Dados da ANBIMA exige credenciais. Com elas configuradas, o relatório
é enriquecido com a classificação ANBIMA e dados cadastrais complementares.
Sem elas, o sistema opera normalmente com a base da CVM e sinaliza isso no
cabeçalho.

```bash
export ANBIMA_CLIENT_ID="..."
export ANBIMA_CLIENT_SECRET="..."
```

### Uso em lote

```bash
python3 run.py analisar --cnpj 00.000.000/0001-00 \
                        --data 2026-08-31 \
                        --valor 100000000 \
                        --cenario bancaria \
                        --formato csv --saida relatorio.csv
```

---

## O relatório

O topo traz o resumo — fundo, CNPJ, categoria, gestor, administrador, data-base,
patrimônio líquido, participação apurada, exposição total, **RWA total**, FPR
médio ponderado e capital requerido. Abaixo vem o detalhamento, uma linha por
ativo final:

| Coluna | Conteúdo |
| --- | --- |
| Nome do fundo | fundo que detém diretamente o ativo |
| CNPJ | do fundo detentor |
| Categoria | classe CVM ou classificação ANBIMA |
| Gestor / Administrador | do fundo detentor |
| Ativo | descrição do ativo final |
| Valor | exposição atribuída à instituição |
| FPR / RW | fator aplicado |
| Artigo e Resolução | **dispositivo que originou o fator** |
| RWA e Capital | resultado da ponderação |

Exportação em **CSV** (separador `;`, decimal com vírgula, BOM para abertura
direta no Excel) e **XML**, sempre incluindo resumo, pendências de dados e
detalhamento. Há também impressão em PDF pelo navegador.

O seletor **Data da pesquisa** define a competência da carteira consultada.

---

## Os dois cenários

### Cenário 1 — Carteira de negociação (RWA<sub>DRC</sub>)

Resolução BCB nº 313/2023. Para cada instrumento:

```
JTD  = ValorBase × FP           (art. 4º, I, c/c art. 6º)
DRC  = Σ RW × JTDL              (art. 15)
RWA  = (1 / F) × DRC   com F = 8%  →  12,5 × DRC   (art. 3º)
```

Fatores de perda: 100% para ações e dívida subordinada, 75% para dívida não
subordinada, 25% para *covered bonds* (art. 6º). Cota de fundo com uma única
classe de priorização é Referência DRC própria, com RW de 15% (art. 14), e a
cota é tratada como ação (art. 4º, § 7º).

**Escopo:** este total cobre apenas o risco de crédito. O risco de mercado das
posições corre pela parcela RWA<sub>MPAD</sub> e a variação do valor dos
derivativos pela RWA<sub>CVA</sub> (Resolução BCB nº 291/2023) — nenhuma das
duas está somada aqui. Na carteira de negociação, a RWA<sub>CPAD</sub> alcança
somente o risco de crédito de contraparte (Res. BCB 229/2022, art. 3º, II).

### Cenário 2 — Carteira bancária (RWA<sub>CPAD</sub>)

Resolução BCB nº 229/2022: `RWA = Σ (exposição × FPR)` (art. 2º), com a carteira
aberta por transparência.

---

## Regras de look-through implementadas

| Dispositivo | Tratamento |
| --- | --- |
| Art. 16 | Exposição = total das exposições do fundo na proporção da participação da instituição no PL. Informe o valor da posição para apurar a proporção; em branco, a carteira é analisada integralmente. |
| Art. 17 | Identificação das exposições pela CDA/CVM, tratadas como se fossem detidas pela instituição. |
| Art. 17, §§ 2º e 3º | Alerta quando a defasagem da carteira ultrapassa 30 dias (ou 90 dias, para fundos com sigilo autorizado pela CVM). |
| Art. 17, § 7º | Majoração de 120% quando a informação não é de domínio público nem fornecida pelo administrador — controlada pela caixa de seleção na tela. |
| Art. 17, § 8º | A diferença entre o PL e a soma das posições informadas vira uma linha de *fração não identificada*, a 1.250%. |
| Art. 18, § 5º | É vedado inferir a exposição de fundo cuja cota foi adquirida por meio de outro fundo igualmente adquirido via fundo. A partir do terceiro nível sem CDA, a cota vai a 1.250%. |
| Art. 59, I | Exposição identificada recebe o FPR da respectiva contraparte. |
| Art. 59, II | Cota sem identificação nem inferência recebe FPR de 1.250%. |
| Art. 59, § 3º | O RWA da exposição ao fundo é limitado a 1.250% do valor contábil das cotas. |
| Art. 60 | Demais exposições a fundos: FPR de 100%. |

Ciclos de participação entre fundos são detectados e interrompem a recursão, com
registro do aviso no relatório.

---

## Dados faltantes

Este é um ponto central do sistema. Quando a CDA/CVM não traz o dado que
discrimina o enquadramento, o Risk Data **não arbitra em silêncio**: aplica o
tratamento conservador previsto no normativo, marca a linha e informa, na seção
*Dados faltantes para o cálculo*, qual dado falta, quantos ativos e quanto de
exposição estão afetados, a base legal e o tratamento adotado.

Exemplos frequentes:

| Dado faltante | Efeito |
| --- | --- |
| Ativo total e receita bruta do emissor | FPR residual de 100% (art. 41) em vez de 65% (art. 35) ou 85% (art. 36) |
| Categoria de risco A/B/C da instituição financeira | Aplicada a categoria B com prazo superior a 90 dias (75%) |
| Negociação em bolsa | Assumida entidade listada (250%, art. 43, III) em vez de 400% (art. 43, I) |
| Pontos de encaixe (A) e desencaixe (D), razão de inadimplência (W), capital hipotético (K) | Securitização a 1.250%, por falta dos parâmetros dos arts. 61 e 62 |
| Nocional, valor de reposição e contraparte do derivativo | Exposição de CCR não apurável pelo SA-CCR/CEM (art. 11) |
| Composição da carteira do fundo investido | Fração não identificada a 1.250% (art. 59, II) |

Para eliminar uma pendência, basta enriquecer o ativo com o atributo
correspondente — o vocabulário está em `riskdata/regulation.py`, no dicionário
`DESCRICAO_CAMPOS`.

---

## Estrutura

```
riskdata/
  regulation.py   catálogo de FPR e RW, cada regra com resolução e artigo
  taxonomy.py     classificação dos ativos da CDA em regras
  cvm.py          download e indexação em SQLite dos dados abertos da CVM
  anbima.py       Feed de Dados da ANBIMA (opcional)
  lookthrough.py  abertura recursiva com as travas dos arts. 17 e 18
  engine.py       motores RWACPAD e RWADRC e consolidação
  report.py       montagem do relatório e exportadores CSV/XML
  server.py       API HTTP e servidor da interface
  demo.py         carteira sintética de demonstração
web/              interface Risk Data (HTML, CSS e JavaScript)
docs/             normativos de referência
tests/            verificação dos cálculos
```

Testes:

```bash
python3 -m unittest discover -s tests -v
```

---

## Normativos de referência

- **Resolução BCB nº 229/2022** — RWA<sub>CPAD</sub>, risco de crédito pela
  abordagem padronizada; arts. 16 a 18 (fundos), 59 e 60 (FPR de cotas)
- **Resolução BCB nº 313/2023** — RWA<sub>DRC</sub>, risco de crédito da
  carteira de negociação
- **Resolução BCB nº 291/2023** — RWA<sub>CVA</sub>
- **Resolução BCB nº 202/2022** — RWA<sub>SP</sub>, risco operacional
- **Resolução BCB nº 303/2023** — RWA<sub>CIRB</sub>, abordagem IRB
- **Circular nº 3.809/2016** — instrumentos mitigadores do risco de crédito

---

## Limites conhecidos

- O enquadramento parte do que a CDA/CVM publica. Atributos de contraparte
  (porte, rating, categoria de risco) não constam da CDA e precisam vir de base
  interna ou de provedor externo.
- Mitigadores de risco de crédito (Circular nº 3.809/2016) ainda não reduzem a
  exposição: o efeito de colateral, garantia e acordo de compensação deve ser
  aplicado sobre o resultado.
- Derivativos aparecem no relatório com a exposição sinalizada como pendente: o
  SA-CCR (Anexo I) e o CEM (Anexo II) exigem nocional, valor de reposição e
  conjunto de compensação, que a CDA não fornece.
- As parcelas RWA<sub>MPAD</sub>, RWA<sub>CVA</sub> e RWA<sub>SP</sub> não são
  calculadas.
