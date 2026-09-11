#!/usr/bin/env python3
"""Gera ifdata-analytics.html: uma cópia do sistema inteiro num arquivo só.

O arquivo resultante não depende da pasta assets/ e pode ser enviado por e-mail,
guardado no iCloud/OneDrive ou aberto direto do disco. É gerado, não editado:
mexa nos arquivos em assets/ e rode este script de novo.

    python3 build/gerar-arquivo-unico.py
"""
import io
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "ifdata-analytics.html")


def gerar():
    html = io.open(os.path.join(RAIZ, "index.html"), encoding="utf-8").read()

    css = io.open(os.path.join(RAIZ, "assets/css/app.css"), encoding="utf-8").read()
    html = html.replace(
        '<link rel="stylesheet" href="assets/css/app.css">',
        "<style>\n" + css + "\n</style>",
    )

    def inline(m):
        caminho = os.path.join(RAIZ, m.group(1))
        js = io.open(caminho, encoding="utf-8").read()
        return ("<script>\n/* ===== " + os.path.basename(caminho) + " ===== */\n"
                + js + "\n</script>")

    html = re.sub(r'<script src="(assets/js/[^"]+)"></script>', inline, html)
    html = html.replace(
        "<title>IF.data Analytics — Instituições financeiras (BCB)</title>",
        "<title>IF.data Analytics — Instituições financeiras (BCB)</title>\n"
        "  <!-- Arquivo único gerado por build/gerar-arquivo-unico.py.\n"
        "       Não edite aqui: edite os arquivos em assets/ e gere de novo. -->",
    )

    # Só interessa atributo que o navegador vai buscar — comentários no código
    # citam caminhos e não são referência. O leitor de PDF (assets/vendor/pdfjs)
    # fica de fora de propósito: são 1,8 MB que não cabem embutidos, e a tela de
    # importação de PDF degrada sozinha quando a pasta não está ao lado.
    pendentes = re.findall(r'(?:src|href)="(assets/(?:js|css)/[^"]+)"', html)
    if pendentes:
        raise SystemExit("erro: sobraram referências externas: %s" % pendentes)

    io.open(SAIDA, "w", encoding="utf-8").write(html)
    print("gerado: %s (%.0f KB)" % (SAIDA, os.path.getsize(SAIDA) / 1024))


if __name__ == "__main__":
    gerar()
