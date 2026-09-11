# Risk Bench

Monitor de instituições financeiras dos segmentos prudenciais **S1 e S2**, em
dois módulos:

| Módulo | O que faz |
|---|---|
| **IF.data** | Consulta, agrega e analisa os dados do [IF.data](https://www3.bcb.gov.br/ifdata/) do Banco Central, direto da API. |
| **Publicações** | Concilia o que os bancos publicam em quatro fontes — BR GAAP, IFRS, Pilar 3 e 20-F — e aponta onde os números não batem. |

Tema escuro fixo, janela de quatro anos (16 trimestres) e escopo restrito a S1
e S2, derivado do relatório de Segmentação do próprio BCB.

Roda inteiramente no navegador: **não há servidor, backend, build nem
dependência externa**. As consultas vão direto do seu navegador para a API de
dados abertos do BCB.

---

## Como usar

**Arquivo único — sem instalar nada.** `ifdata-analytics.html` contém o sistema
inteiro (HTML, CSS e JavaScript no mesmo arquivo). Dá para abrir com dois
cliques, mandar por e-mail ou guardar no drive da equipe.

**Servido por HTTP — recomendado para consultar o BCB.**

```bash
python3 serve.py          # abre http://localhost:8000 no navegador
```

Alguns navegadores tratam a origem `file://` com mais rigor e bloqueiam a
chamada à API do BCB; servido por HTTP isso não acontece. Publicar a pasta em
qualquer hospedagem estática (GitHub Pages, por exemplo) tem o mesmo efeito e
dá um endereço que funciona em celular e tablet.

Sem rede? A chave **Demonstração** na barra superior liga um conjunto de dados
sintéticos que exercita toda a interface (sempre sinalizado como fictício).

Depois de mexer em qualquer arquivo de `assets/`, regenere o arquivo único:

```bash
python3 build/gerar-arquivo-unico.py
```

---

## Módulo Publicações

### A restrição que define o desenho

BR GAAP, IFRS, Pilar 3 e 20-F **não têm API**. São PDFs e planilhas publicados
no site de relações com investidores de cada banco, na CVM e na SEC, cada um com
layout próprio. Um sistema que roda só no navegador não consegue baixá-los (os
sites não liberam acesso externo) nem extrair tabelas de PDF.

O desenho contorna isso sem fingir que o problema não existe:

- o **IF.data entra automático** e vira linha de base — ele já publica PR, RWA,
  índices de capital e resultado;
- as quatro publicações entram por **importação de planilha** ou lançamento
  manual, com o documento e a nota de origem registrados junto do número;
- o sistema faz o que é realmente difícil: **conciliar as fontes e apontar as
  divergências**.

O formato de importação é o contrato. Um extrator automático, no futuro, só
precisa gerar esse CSV — nada mais no sistema muda.

### As cinco telas

| Tela | O que entrega |
|---|---|
| **Cobertura** | Matriz banco × fonte: quantas das células esperadas (métrica × trimestre) já têm número. Mostra onde o levantamento está furado. |
| **Comparativo** | Uma métrica, um banco, as cinco fontes ao longo de 16 trimestres. Onde as linhas se separam, as publicações contam histórias diferentes. |
| **Divergências** | Conciliação ordenada pelo tamanho da diferença, com mapa de calor banco × métrica e exportação. |
| **Lançamentos** | Importação de CSV, lançamento manual, modelo de planilha e catálogo de identificadores. |
| **Onde buscar** | Atalhos de busca por banco para RI, Pilar 3, 20-F na SEC e CVM. |

### O catálogo de indicadores

42 métricas em cinco famílias, cada uma declarando em que fontes costuma ser
publicada — é isso que alimenta a matriz de cobertura:

- **Rentabilidade** (8) — lucro contábil e recorrente, ROAE, ROAA, NIM,
  eficiência, receita de serviços, custo do crédito.
- **Risco de mercado** (11) — VaR 1d 99% de fechamento, médio e máximo, stressed
  VaR, VaR por fator (juros, câmbio, ações), exceções de backtesting, IRRBB
  (ΔEVE e ΔNII) e DV01.
- **Liquidez** (8) — LCR com HQLA e saídas líquidas, NSFR, LDR, reserva de
  liquidez, concentração dos dez maiores depositantes, prazo médio de captação.
- **Capital** (9) — PR, Capital Principal, Nível I, os três índices, razão de
  alavancagem, folga sobre o requerimento e patrimônio contábil.
- **RWA** (6) — total e por parcela (crédito, mercado, operacional), densidade
  sobre o ativo e fatia apurada por abordagem interna.

Dez delas têm equivalente calculável no IF.data e são espelhadas
automaticamente.

### Como a divergência é medida

Índices e percentuais comparam-se em **pontos percentuais**; saldos, em
**variação relativa** sobre o maior valor observado. A severidade é alta acima
de 1 p.p. ou 5%, média acima de 0,25 p.p. ou 1%. Uma célula com uma só fonte não
gera apontamento — sem duas observações não há divergência, e inventar uma seria
ruído.

---

## Módulo IF.data — as sete telas

| Tela | O que entrega |
|---|---|
| **Consulta** | Ranking e tabela completa de qualquer relatório, com filtro por UF e segmento, seletor de colunas e exportação CSV. |
| **Comparar** | Até oito instituições lado a lado em várias colunas; escala em nível ou indexada (maior = 100) e matriz de posição relativa por indicador (escore-z). |
| **Série temporal** | Evolução trimestral de uma coluna ou indicador: nível, série indexada em base 100 e variação em 12 meses, com CAGR, volatilidade e extremos. |
| **Conjuntos** | Monta carteiras de instituições (peers, blocos, concorrentes), salvas no navegador, com sugestões automáticas por faixa de tamanho e importação/exportação em JSON. |
| **Análise de conjunto** | Agrega o conjunto, recalcula os índices, compara conjuntos entre si e com o sistema, mostra composição interna, dispersão dos membros e decomposição da variação por membro. |
| **Mercado & concentração** | Participação de mercado, HHI, CR5/CR10, Gini, curva de concentração acumulada e HHI comparado entre mercados. |
| **Diagnóstico** | Estado da conexão, forma do retorno, registro bruto da API, detecção de períodos e ajuste manual do mapeamento de campos. |

Todo gráfico tem uma aba **Tabela** com os mesmos números e botões **PNG/SVG** —
nenhum valor fica acessível só por *hover*.

O **escopo S1/S2** é derivado do relatório de Segmentação do BCB para o período
em tela. Quando o Banco Central não informa o segmento, o escopo não filtra nada
e a tela avisa — melhor mostrar tudo com um aviso do que esvaziar o painel em
silêncio.

---

## Fonte dos dados

Endpoint OData do portal de dados abertos do BCB:

```
https://olinda.bcb.gov.br/olinda/servico/IFDATA/versao/v1/odata
```

| Recurso | Uso |
|---|---|
| `ListaDeRelatorio` | Descobre os relatórios disponíveis (com catálogo interno de reserva). |
| `IfDataCadastro(AnoMes,TipoInstituicao)` | Nome, UF, cidade e segmento de cada instituição. |
| `IfDataValores(AnoMes,TipoInstituicao,Relatorio)` | Valores de cada coluna do relatório. |

Os dados são trimestrais (`AnoMes` = `AAAAMM`, com mês 03, 06, 09 ou 12) e
publicados cerca de 60 dias após o fechamento de março, junho e setembro, e 90
dias após dezembro. A lista de trimestres da barra superior já aplica essa
defasagem; **Diagnóstico → Detectar períodos** confirma o que realmente existe
para o relatório e o tipo escolhidos.

### O nome das instituições vem do cadastro

O `IfDataValores` identifica a instituição **apenas pelo código** (`CodInst`);
o nome, a UF, a cidade e o segmento estão no `IfDataCadastro`. O cliente busca
os dois e cruza pelo código — e, se cada endpoint usar uma chave diferente,
tenta ainda pelo CNPJ (comparando só os dígitos). Sem esse cruzamento o painel
mostraria códigos no lugar dos nomes e os filtros de UF e segmento ficariam
vazios.

O cruzamento roda só quando faz falta, e o cadastro fica em cache junto com o
resto. **Diagnóstico → Retorno do relatório em tela** informa quantos nomes
foram obtidos assim; se nenhum código casar, a tela avisa em vez de exibir
códigos silenciosamente.

### Descoberta de schema em tempo de execução

O `IfDataValores` não devolve sempre o mesmo formato: em alguns relatórios cada
linha é uma instituição com uma coluna por conta ("largo"), em outros cada linha
é uma conta ("longo"). E os rótulos das colunas mudam entre períodos.

Por isso o cliente (`assets/js/api.js`) **detecta a forma do retorno e converte
tudo para o formato largo**, e o catálogo (`assets/js/catalog.js`) casa as
colunas reais contra ~25 campos canônicos por correspondência normalizada
(exata → prefixo → termos). Nada de nomes de coluna cravados no código.

Quando a detecção erra, **Diagnóstico → Mapeamento de campos** deixa você apontar
manualmente cada campo canônico para a coluna certa, e todas as telas recalculam.

---

## Decisões analíticas

Três pontos em que a leitura ingênua do dado leva a número errado:

**1. A DRE do IF.data é acumulada no ano.** O lucro do 3T é o acumulado de
janeiro a setembro. O interruptor **Anualizar resultados** (ligado por padrão)
multiplica os resultados por `12 ÷ mês`, para que ROE e ROA de trimestres
diferentes sejam comparáveis. Desligue para ler o acumulado como publicado.

**2. Índice não soma nem tira média simples.** Ao agregar um conjunto, saldos e
fluxos são somados e os índices são **recalculados a partir dos componentes
agregados** (Basileia = ΣPR ÷ ΣRWA, e assim por diante). Quando o relatório em
tela não traz os componentes, cai-se para média ponderada pelo ativo — e a tela
diz explicitamente quais índices ficaram aproximados.

**3. Escala.** O IF.data publica os saldos em **R$ mil**. O seletor *Escala dos
valores* converte para reais ou para R$ milhões; índices e contagens nunca são
reescalados.

### Indicadores calculados

Rentabilidade — ROE, ROA, margem líquida, índice de eficiência.
Capital — Basileia, Capital Principal, Nível I, razão de alavancagem,
alavancagem contábil, PL/Ativo, densidade de RWA, imobilização.
Crédito e liquidez — Crédito/Ativo, Crédito/Captações (LDR), Provisão/Carteira,
custo do crédito.
Concentração — participação de mercado, HHI, CR*n*, Gini, curva acumulada.

Cada indicador declara os campos de que precisa; a tela só oferece os que o
relatório carregado consegue sustentar. **Diagnóstico** lista quais estão
disponíveis e por quê.

---

## Se a consulta falhar

O sintoma quase sempre é `Failed to fetch`. Em ordem de probabilidade:

1. **Rede corporativa** bloqueando `olinda.bcb.gov.br`. Teste em
   Diagnóstico → Testar conexão; se houver um espelho interno do endpoint,
   aponte a **Base da API** para ele.
2. **Página aberta como `file://`** — use `python3 serve.py`.
3. **Período sem publicação** para aquele relatório: a consulta responde, mas
   vazia. Use Detectar períodos.
4. **Indisponibilidade do BCB** — o cliente já repete requisições 5xx com espera
   progressiva; o botão *Atualizar* refaz tudo ignorando o cache.

Respostas ficam em cache no navegador por até 14 dias (`localStorage`), então
reabrir a mesma consulta é instantâneo.

---

## Estrutura

```
index.html                  casca da página
ifdata-analytics.html       o sistema inteiro num arquivo só (gerado)
serve.py                    servidor local estático
build/gerar-arquivo-unico.py  inlina assets/ dentro de um único HTML
assets/css/app.css          tokens de cor, tema claro/escuro, layout
assets/js/
  util.js                   formatação pt-BR, períodos, estatística, exportação
  catalog.js                campos canônicos, indicadores, regras de agregação
  api.js                    cliente Olinda: paginação, cache, retentativa, pivot
  demo.js                   gerador de dados sintéticos (modo demonstração)
  charts.js                 motor SVG próprio: ranking, colunas, linhas,
                            dispersão, heatmap, waterfall, sparkline
  ui.js                     multiselect, cards, modais, stat tiles, toasts
  table.js                  tabela com ordenação, busca e exportação CSV
  store.js                  estado e persistência dos conjuntos
  views-core.js             carga de dados, escopo S1/S2, escala, guarda de render
  views-dados.js            Consulta, Comparar, Série temporal
  views-analise.js          Conjuntos, Análise de conjunto, Mercado, Diagnóstico
  pub-catalog.js            fontes, famílias e as 42 métricas do módulo Publicações
  pub-store.js              lançamentos, importação e motor de conciliação
  views-publicacoes.js      Cobertura, Comparativo, Divergências, Lançamentos, Onde buscar
  app.js                    módulos, filtros globais, abas
```

### Notas de desenho

Tema escuro único e deliberado — o Risk Bench é operado em sala de risco, ao
lado de terminais —, com toda cor pintada explicitamente para que a página não
herde o fundo de quem a hospeda. A paleta categórica de oito séries foi validada
para contraste e para as três formas de daltonismo; a cor **segue a entidade**
(ou a fonte, no módulo Publicações), não a posição no ranking — o
Banco X mantém o mesmo azul em todos os gráficos e filtrar séries não repinta as
demais. Escalas sequenciais usam um único tom, e a divergente usa dois polos com
cinza neutro no meio. Nenhum gráfico tem dois eixos verticais: grandezas
diferentes viram *small multiples* ou série indexada. Rótulos diretos são
seletivos e desaparecem quando colidiriam — a legenda, o crosshair e a aba
Tabela cobrem o resto.

---

## Limitação conhecida

O ambiente onde este sistema foi construído não tem acesso de rede a
`olinda.bcb.gov.br`. Toda a lógica foi exercitada e conferida contra o modo
demonstração em navegador real, e o cliente foi escrito para se adaptar às duas
formas conhecidas de retorno do `IfDataValores` — mas a **primeira execução
contra a API real deve ser feita pela tela Diagnóstico**, que mostra a URL
consultada, a forma detectada e o primeiro registro bruto. Se algum rótulo de
coluna não bater com o esperado, o ajuste é no Mapeamento de campos, sem tocar
em código.
