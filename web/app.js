/* Risk Data — camada de interface */
(function () {
  "use strict";

  const estado = {
    relatorio: null,
    cenario: "negociacao",
    status: null,
    indiceSugestao: -1,
    sugestoes: [],
  };

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ formatação

  const moeda = (v) =>
    (v === null || v === undefined || isNaN(v))
      ? "—"
      : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL",
          minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const moedaCurta = (v) => {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const n = Number(v), abs = Math.abs(n);
    if (abs >= 1e9) return "R$ " + (n / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " bi";
    if (abs >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
    if (abs >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return moeda(n);
  };

  const pct = (v, casas = 2) =>
    (v === null || v === undefined || isNaN(v))
      ? "—"
      : (Number(v) * 100).toLocaleString("pt-BR", {
          minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";

  const esc = (t) =>
    String(t === null || t === undefined ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const classeFator = (f) => {
    if (f >= 12.5) return "fpr-critico";
    if (f >= 1.5) return "fpr-alto";
    if (f >= 0.5) return "fpr-medio";
    return "fpr-baixo";
  };

  // ------------------------------------------------------------------- rede

  async function api(caminho, opcoes) {
    const resposta = await fetch(caminho, opcoes);
    const texto = await resposta.text();
    let dados;
    try { dados = texto ? JSON.parse(texto) : {}; }
    catch (e) { throw new Error("Resposta inesperada do servidor: " + texto.slice(0, 200)); }
    if (!resposta.ok) throw new Error(dados.erro || ("Erro HTTP " + resposta.status));
    return dados;
  }

  function alerta(destino, tipo, titulo, texto) {
    const icones = {
      alerta: "M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
      critico: "M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
      info: "M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
      ok: "m9 12 2 2 4-4m7 2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    };
    return `<div class="aviso-caixa ${tipo}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="${icones[tipo]}"/></svg>
      <div><strong>${esc(titulo)}</strong>${texto ? esc(texto) : ""}</div></div>`;
  }

  // ------------------------------------------------------------------ status

  async function carregarStatus() {
    try {
      const s = await api("/api/status");
      estado.status = s;

      const sel = $("competenciaCarga");
      if (!sel.options.length) {
        s.competencias_sugeridas.forEach((c) => {
          const o = document.createElement("option");
          o.value = c;
          o.textContent = c.slice(0, 4) + "/" + c.slice(4) +
            (s.competencias_carregadas.includes(c) ? " — carregada" : "");
          sel.appendChild(o);
        });
        const carregada = s.competencias_sugeridas.find((c) =>
          s.competencias_carregadas.includes(c));
        if (carregada) sel.value = carregada;
        else if (sel.options.length > 1) sel.selectedIndex = 1;
      }

      const temDados = s.fundos_cadastrados > 0;
      $("seloFonte").className = "selo " + (temDados ? "ativo" : "aviso");
      $("seloFonteTexto").textContent = temDados
        ? s.fundos_cadastrados.toLocaleString("pt-BR") + " fundos · " +
          (s.competencias_carregadas.length || 0) + " competência(s)"
        : "Base da CVM não carregada";

      $("seloAnbima").className = "selo " + (s.anbima.configurado ? "ativo" : "");
      $("seloAnbimaTexto").textContent = s.anbima.configurado
        ? "ANBIMA conectada" : "ANBIMA sem credenciais";

      $("resumoBase").innerHTML = temDados
        ? alerta("", "ok", "Base disponível. ",
            "Competências carregadas: " + (s.competencias_carregadas.join(", ") || "—") +
            ". " + s.anbima.observacao)
        : alerta("", "alerta", "Base da CVM ainda não carregada. ",
            "Selecione a competência e clique em “Carregar dados da CVM”. O primeiro " +
            "carregamento baixa e indexa os arquivos públicos e pode levar alguns minutos.");
    } catch (e) {
      $("seloFonteTexto").textContent = "Servidor indisponível";
    }
  }

  // ------------------------------------------------------------------- carga

  async function carregarBase() {
    const competencia = $("competenciaCarga").value;
    const botao = $("btnCarregar");
    botao.disabled = true;
    botao.innerHTML = '<span class="carregando"></span> Carregando…';
    $("statusCarga").classList.remove("oculto");
    $("registroCarga").textContent = "Iniciando…";
    try {
      const r = await api("/api/carregar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competencia, forcar: $("forcarDownload").checked }),
      });
      await acompanhar(r.trabalho);
    } catch (e) {
      $("registroCarga").textContent += "\nERRO: " + e.message;
    } finally {
      botao.disabled = false;
      botao.textContent = "Carregar dados da CVM";
      carregarStatus();
    }
  }

  function acompanhar(id) {
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const t = await api("/api/trabalho?id=" + encodeURIComponent(id));
          if (t.mensagens) $("registroCarga").textContent = t.mensagens.join("\n");
          if (t.estado === "concluido" || t.estado === "erro") {
            clearInterval(timer);
            if (t.erro) $("registroCarga").textContent += "\nERRO: " + t.erro;
            else $("registroCarga").textContent += "\nConcluído.";
            resolve(t);
          }
        } catch (e) { clearInterval(timer); resolve(null); }
      }, 1200);
    });
  }

  // ------------------------------------------------------------------ busca

  let temporizadorBusca = null;

  function ligarBusca() {
    const campo = $("busca"), caixa = $("sugestoes");

    campo.addEventListener("input", () => {
      $("cnpjSelecionado").value = "";
      clearTimeout(temporizadorBusca);
      const termo = campo.value.trim();
      if (termo.length < 2) { caixa.innerHTML = ""; return; }
      temporizadorBusca = setTimeout(async () => {
        try {
          const r = await api("/api/buscar?q=" + encodeURIComponent(termo));
          estado.sugestoes = r.resultados || [];
          estado.indiceSugestao = -1;
          caixa.innerHTML = estado.sugestoes.map((f, i) => `
            <div class="sugestao" data-indice="${i}">
              <strong>${esc(f.denominacao)}</strong>
              <span>${esc(formatarCnpj(f.cnpj))} · ${esc(f.classe || "—")} · ${esc(f.situacao || "")}</span>
            </div>`).join("");
        } catch (e) { caixa.innerHTML = ""; }
      }, 260);
    });

    caixa.addEventListener("click", (ev) => {
      const alvo = ev.target.closest(".sugestao");
      if (alvo) escolher(estado.sugestoes[Number(alvo.dataset.indice)]);
    });

    campo.addEventListener("keydown", (ev) => {
      const itens = caixa.querySelectorAll(".sugestao");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!itens.length) return;
        estado.indiceSugestao += ev.key === "ArrowDown" ? 1 : -1;
        if (estado.indiceSugestao < 0) estado.indiceSugestao = itens.length - 1;
        if (estado.indiceSugestao >= itens.length) estado.indiceSugestao = 0;
        itens.forEach((n, i) => n.classList.toggle("ativa", i === estado.indiceSugestao));
        itens[estado.indiceSugestao].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        if (estado.indiceSugestao >= 0) escolher(estado.sugestoes[estado.indiceSugestao]);
        else analisar();
      } else if (ev.key === "Escape") { caixa.innerHTML = ""; }
    });

    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".campo")) caixa.innerHTML = "";
    });
  }

  function escolher(fundo) {
    if (!fundo) return;
    $("busca").value = fundo.denominacao;
    $("cnpjSelecionado").value = fundo.cnpj;
    $("sugestoes").innerHTML = "";
  }

  function formatarCnpj(c) {
    const d = String(c || "").replace(/\D/g, "").padStart(14, "0");
    if (d.length !== 14) return c || "";
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  }

  // ----------------------------------------------------------------- análise

  async function analisar() {
    const botao = $("btnAnalisar");
    $("erroConsulta").innerHTML = "";
    botao.disabled = true;
    botao.innerHTML = '<span class="carregando"></span> Abrindo a carteira…';
    try {
      const corpo = {
        cnpj: $("cnpjSelecionado").value,
        termo: $("busca").value,
        data: $("dataPesquisa").value,
        valor_posicao: $("valorPosicao").value || null,
        profundidade: $("profundidade").value,
        info_publica: $("infoPublica").checked,
        acp: Number($("acp").value),
      };
      const relatorio = await api("/api/analisar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      estado.relatorio = relatorio;
      $("estadoVazio").classList.add("oculto");
      $("relatorio").classList.remove("oculto");
      desenhar();
      $("relatorio").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      $("erroConsulta").innerHTML = alerta("", "critico", "Não foi possível gerar o relatório. ", e.message);
    } finally {
      botao.disabled = false;
      botao.textContent = "Gerar relatório";
    }
  }

  // ------------------------------------------------------------------ render

  function desenhar() {
    const r = estado.relatorio;
    if (!r) return;
    const cab = r.cabecalho;
    const dados = r.cenarios[estado.cenario];
    const resumo = dados.resumo;

    $("tituloRelatorio").textContent = resumo.rotulo;

    $("fichaFundo").innerHTML = [
      ["Nome do fundo", cab.fundo_nome],
      ["CNPJ", cab.fundo_cnpj],
      ["Categoria", cab.fundo_categoria || "Não informada"],
      ["Gestor", cab.fundo_gestor || "Não informado"],
      ["Administrador", cab.fundo_administrador || "Não informado"],
      ["Data da pesquisa", cab.data_consulta],
      ["Competência da carteira", cab.competencia.slice(0,4) + "/" + cab.competencia.slice(4)],
      ["Data-base da carteira", cab.data_base_carteira || "Não informada"],
      ["Patrimônio líquido", moeda(cab.patrimonio_liquido)],
      ["Posição da instituição", cab.valor_posicao ? moeda(cab.valor_posicao) : "Carteira integral"],
      ["Participação apurada", pct(cab.participacao_instituicao, 4)],
      ["Majoração art. 17, § 7º", cab.majoracao_art_17_7 > 1 ? "120% aplicada" : "Não aplicável"],
    ].map(([t, v]) => `<div><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`).join("");

    const criticos = resumo.valor_com_pendencia > 0;
    $("indicadores").innerHTML = [
      { rotulo: "Exposição total", valor: moedaCurta(resumo.exposicao_total),
        complemento: moeda(resumo.exposicao_total), classe: "" },
      { rotulo: "RWA total", valor: moedaCurta(resumo.rwa_total),
        complemento: moeda(resumo.rwa_total), classe: "destaque" },
      { rotulo: "FPR médio ponderado", valor: pct(resumo.fpr_medio),
        complemento: "RWA ÷ exposição", classe: "" },
      { rotulo: "Capital requerido", valor: moedaCurta(resumo.capital_minimo),
        complemento: "F = " + pct(cab.fator_f, 1), classe: "destaque" },
      { rotulo: "Capital com ACP", valor: moedaCurta(resumo.capital_com_acp),
        complemento: "inclui ACP de " + pct(cab.acp_conservacao, 1), classe: "" },
      { rotulo: "Ativos finais", valor: String(cab.qtd_ativos_finais),
        complemento: cab.qtd_fundos + " fundo(s), " + cab.profundidade_maxima + " nível(is)", classe: "" },
      { rotulo: "Com pendência de dados", valor: String(resumo.qtd_com_pendencia),
        complemento: moedaCurta(resumo.valor_com_pendencia) + " de exposição",
        classe: criticos ? "aviso" : "" },
    ].map((i) => `<div class="indicador ${i.classe}">
        <div class="rotulo">${esc(i.rotulo)}</div>
        <div class="valor">${esc(i.valor)}</div>
        <div class="complemento">${esc(i.complemento)}</div></div>`).join("");

    let avisos = "";
    if (estado.cenario === "negociacao") {
      avisos += alerta("", "info", "Escopo do cenário 1. ",
        "O total apresentado é a parcela RWA DRC (Resolução BCB nº 313/2023), que cobre o " +
        "risco de crédito dos instrumentos da carteira de negociação. O risco de mercado " +
        "dessas posições corre pela parcela RWA MPAD e a variação do valor dos derivativos " +
        "pela RWA CVA (Resolução BCB nº 291/2023) — nenhuma das duas está somada aqui. " +
        "Na carteira de negociação, a RWA CPAD alcança apenas o risco de crédito de " +
        "contraparte (Resolução BCB nº 229/2022, art. 3º, II).");
    } else {
      avisos += alerta("", "info", "Escopo do cenário 2. ",
        "O total é a parcela RWA CPAD (Resolução BCB nº 229/2022), apurada como o somatório " +
        "das exposições ponderadas pelos respectivos FPR (art. 2º), com a carteira aberta " +
        "por transparência na forma dos arts. 16 a 18 e o tratamento do art. 59 para as cotas.");
    }
    (resumo.observacoes || []).forEach((o) => { avisos += alerta("", "alerta", "Teto do art. 59, § 3º. ", o); });
    (r.avisos || []).forEach((a) => { avisos += alerta("", "alerta", "Atenção. ", a); });
    $("avisosCenario").innerHTML = avisos;

    desenharPendencias(r);
    desenharAlocacao(resumo);
    desenharArvore(r);
    desenharTabela();

    document.querySelectorAll(".aba").forEach((b) =>
      b.classList.toggle("ativa", b.dataset.cenario === estado.cenario));
  }

  function desenharPendencias(r) {
    const p = r.pendencias || [];
    if (!p.length) {
      $("corpoPendencias").innerHTML = alerta("", "ok",
        "Nenhuma pendência de dados. ",
        "Todos os ativos finais puderam ser enquadrados com as informações disponíveis.");
      return;
    }
    $("corpoPendencias").innerHTML =
      alerta("", "alerta", "Há informações faltantes que impedem o enquadramento definitivo. ",
        "Enquanto o dado não é fornecido, o Risk Data aplica o tratamento conservador " +
        "previsto no normativo e registra a premissa na linha correspondente.") +
      `<div class="envolve-tabela"><table>
        <thead><tr>
          <th>Dado faltante</th><th>Onde falta</th>
          <th class="direita">Ocorrências</th><th class="direita">Exposição afetada</th>
          <th>Base legal</th><th>Tratamento adotado</th>
        </tr></thead><tbody>${p.map((i) => `
          <tr>
            <td><strong>${esc(i.descricao)}</strong><span class="base-legal">campo: ${esc(i.campo)}</span></td>
            <td>${(i.exemplos || []).slice(0, 3).map((e) => `<div>${esc(String(e).slice(0, 150))}</div>`).join("") || "—"}</td>
            <td class="direita">${i.ocorrencias}</td>
            <td class="direita">${moeda(i.valor_afetado)}</td>
            <td>${esc(i.base_legal || "—")}</td>
            <td>${esc(i.efeito || "Aplicado o tratamento conservador do normativo.")}</td>
          </tr>`).join("")}</tbody></table></div>`;
  }

  function desenharAlocacao(resumo) {
    const grupos = resumo.rwa_por_artigo || [];
    if (!grupos.length) { $("corpoAlocacao").innerHTML = '<p class="vazio">Sem dados.</p>'; return; }
    const maior = Math.max.apply(null, grupos.map((g) => g.rwa)) || 1;
    $("corpoAlocacao").innerHTML = grupos.map((g) => `
      <div class="barra-grupo">
        <div class="barra-rotulo">
          <span><strong>${esc(g.chave)}</strong> — ${g.qtd} ativo(s), FPR médio ${pct(g.fpr_medio)}</span>
          <span class="peso">${moeda(g.rwa)} &nbsp;(${pct(g.participacao_rwa)})</span>
        </div>
        <div class="barra-trilha"><div class="barra-preenchida"
          style="width:${(g.rwa / maior * 100).toFixed(2)}%"></div></div>
      </div>`).join("");
  }

  function desenharArvore(r) {
    if (!r.arvore) { $("corpoArvore").innerHTML = '<p class="vazio">Sem estrutura.</p>'; return; }
    const porCnpj = {};
    (r.fundos || []).forEach((f) => { porCnpj[f.cnpj] = f; });

    function no(n, raiz) {
      const f = porCnpj[n.cnpj] || {};
      const alerta_ = n.nao_aberto
        ? `<div class="aviso-caixa alerta" style="margin-top:7px">
             <div>${esc(n.nao_aberto)}</div></div>` : "";
      return `<div class="arvore-no ${raiz ? "raiz" : ""}">
        <div class="arvore-titulo">
          <span class="nivel-marca">N${n.nivel}</span>
          <strong>${esc(n.nome)}</strong>
          <span class="arvore-meta">${esc(n.cnpj_formatado)}</span>
        </div>
        <div class="arvore-meta">
          ${esc(f.categoria || "Categoria não informada")} ·
          Gestor: ${esc(f.gestor || "—")} · Administrador: ${esc(f.administrador || "—")} ·
          PL: ${moeda(f.patrimonio_liquido)} · Carteira informada: ${moeda(n.total_carteira)} ·
          Participação acumulada: ${pct(n.fator, 4)} · ${n.qtd_ativos} ativo(s) diretos
        </div>
        ${alerta_}
        ${(n.filhos || []).map((c) => no(c, false)).join("")}
      </div>`;
    }
    $("corpoArvore").innerHTML = `<div class="arvore">${no(r.arvore, true)}</div>`;
  }

  const COLUNAS = [
    { campo: "fundo_nome", titulo: "Fundo detentor" },
    { campo: "ativo", titulo: "Ativo" },
    { campo: "valor", titulo: "Valor", direita: true, tipo: "moeda" },
    { campo: "fator_pct", titulo: "FPR / RW", direita: true, tipo: "fator" },
    { campo: "artigo", titulo: "Base normativa" },
    { campo: "rwa", titulo: "RWA", direita: true, tipo: "moeda" },
    { campo: "capital", titulo: "Capital", direita: true, tipo: "moeda" },
  ];

  function linhasFiltradas() {
    const r = estado.relatorio;
    if (!r) return [];
    const termo = ($("filtroTexto").value || "").toLowerCase().trim();
    const artigo = $("filtroArtigo").value;
    const soPendentes = $("filtroPendentes").checked;
    return r.cenarios[estado.cenario].linhas.filter((l) => {
      if (soPendentes && !(l.faltantes || []).length && !l.residual) return false;
      if (artigo && (l.resolucao + " - " + l.artigo) !== artigo) return false;
      if (termo) {
        const alvo = [l.ativo, l.emissor, l.fundo_nome, l.tipo_aplicacao, l.codigo]
          .join(" ").toLowerCase();
        if (alvo.indexOf(termo) === -1) return false;
      }
      return true;
    });
  }

  function desenharTabela() {
    const r = estado.relatorio;
    const dados = r.cenarios[estado.cenario];

    const sel = $("filtroArtigo");
    const atual = sel.value;
    const artigos = Array.from(new Set(dados.linhas.map((l) => l.resolucao + " - " + l.artigo))).sort();
    sel.innerHTML = '<option value="">Todos os artigos</option>' +
      artigos.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    if (artigos.indexOf(atual) !== -1) sel.value = atual;

    $("cabecalhoTabela").innerHTML =
      '<th>Nível</th>' +
      COLUNAS.map((c) => `<th class="${c.direita ? "direita" : ""}">${esc(c.titulo)}</th>`).join("") +
      "<th>Situação</th>";

    const linhas = linhasFiltradas();
    $("legendaTabela").textContent =
      estado.cenario === "negociacao"
        ? "JTD = valor × fator de perda (art. 4º c/c art. 6º); RWA = 12,5 × RW × JTD (art. 3º)"
        : "RWA = exposição × FPR (art. 2º da Resolução BCB nº 229/2022)";
    $("contadorLinhas").textContent =
      linhas.length + " de " + dados.linhas.length + " ativo(s)";

    $("corpoTabela").innerHTML = linhas.map((l) => {
      const pendente = (l.faltantes || []).length > 0;
      const classe = l.residual ? "linha-critica" : (pendente ? "linha-pendente" : "");
      const drc = estado.cenario === "negociacao" && l.fator_perda !== null
        ? `<span class="base-legal">FP ${pct(l.fator_perda, 0)} (${esc(l.artigo_fator_perda)}) ·
           JTD ${moedaCurta(l.jtd)}</span>` : "";
      const situacao = [
        ...(l.faltantes || []).map((f) => `<span class="pendencia-chip">${esc(f)}</span>`),
        ...(l.residual ? ['<span class="pendencia-chip">não identificado</span>'] : []),
      ].join("") || '<span class="etiqueta fpr-baixo">enquadrado</span>';

      return `<tr class="${classe}">
        <td><span class="nivel-marca">N${l.nivel}</span></td>
        <td>${esc(l.fundo_nome)}<span class="base-legal">${esc(l.fundo_cnpj_formatado)} ·
          ${esc(l.fundo_categoria || "—")}</span></td>
        <td>${esc(l.ativo)}<span class="base-legal">${esc(l.tipo_aplicacao || "")}${
          l.emissor ? " · " + esc(l.emissor) : ""}</span></td>
        <td class="direita">${moeda(l.valor)}</td>
        <td class="direita"><span class="etiqueta ${classeFator(l.fator)}">${esc(l.fator_pct)}</span>${drc}</td>
        <td><span class="artigo">${esc(l.artigo)}</span>
          <span class="base-legal">${esc(l.resolucao)}</span>
          <span class="base-legal">${esc(String(l.descricao_regra).slice(0, 190))}</span></td>
        <td class="direita">${moeda(l.rwa)}</td>
        <td class="direita">${moeda(l.capital)}</td>
        <td>${situacao}</td>
      </tr>`;
    }).join("");

    const somaExp = linhas.reduce((a, l) => a + l.valor, 0);
    const somaRwa = linhas.reduce((a, l) => a + l.rwa, 0);
    const somaCap = linhas.reduce((a, l) => a + l.capital, 0);
    $("rodapeTabela").innerHTML = `<tr>
      <td colspan="3">Somatório${linhas.length !== dados.linhas.length ? " (filtrado)" : ""}</td>
      <td class="direita">${moeda(somaExp)}</td>
      <td class="direita">${pct(somaExp ? somaRwa / somaExp : 0)}</td>
      <td>${dados.resumo.teto_aplicado ? "Teto do art. 59, § 3º aplicado ao total" : ""}</td>
      <td class="direita">${moeda(somaRwa)}</td>
      <td class="direita">${moeda(somaCap)}</td>
      <td></td></tr>`;
  }

  // ----------------------------------------------------------------- eventos

  function ligar() {
    $("dataPesquisa").value = new Date().toISOString().slice(0, 10);

    $("btnCarregar").addEventListener("click", carregarBase);
    $("btnAnalisar").addEventListener("click", analisar);

    $("btnDemo").addEventListener("click", async () => {
      try {
        await api("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        await carregarStatus();
        $("busca").value = "RISK DATA DEMO MULTIMERCADO FIC FIM";
        $("cnpjSelecionado").value = "11111111000191";
        $("dataPesquisa").value = "2026-08-31";
        $("valorPosicao").value = "100000000";
        $("resumoBase").innerHTML = alerta("", "ok", "Carteira de demonstração carregada. ",
          "Estrutura de três níveis com um fundo sem composição publicada, para exercitar " +
          "as travas dos arts. 17, § 8º, 18, § 5º e 59, II. Clique em “Gerar relatório”.");
      } catch (e) {
        $("resumoBase").innerHTML = alerta("", "critico", "Falha ao carregar a demonstração. ", e.message);
      }
    });

    $("btnAlternarBase").addEventListener("click", () => {
      const corpo = $("corpoBase");
      const oculto = corpo.classList.toggle("oculto");
      $("btnAlternarBase").textContent = oculto ? "Mostrar" : "Ocultar";
    });

    document.querySelectorAll(".aba").forEach((b) =>
      b.addEventListener("click", () => {
        estado.cenario = b.dataset.cenario;
        desenhar();
      }));

    ["filtroTexto", "filtroArtigo", "filtroPendentes"].forEach((id) =>
      $(id).addEventListener("input", desenharTabela));

    $("btnCsv").addEventListener("click", () => exportar("csv"));
    $("btnXml").addEventListener("click", () => exportar("xml"));
    $("btnImprimir").addEventListener("click", () => window.print());

    ligarBusca();
    carregarStatus();
  }

  function exportar(formato) {
    if (!estado.relatorio) return;
    const url = "/api/exportar?id=" + encodeURIComponent(estado.relatorio.id) +
      "&formato=" + formato + "&cenario=" + estado.cenario;
    const link = document.createElement("a");
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ligar);
  else ligar();
})();
