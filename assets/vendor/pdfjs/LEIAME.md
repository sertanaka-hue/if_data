# pdf.js embutido

Arquivos de `pdfjs-dist@4.10.38` (build *legacy*, que roda em navegadores mais
antigos), usados pela tela **Importar PDF** do módulo Publicações:

- `pdf.min.mjs` — a biblioteca
- `pdf.worker.min.mjs` — o worker que faz a leitura fora da thread da interface
- `LICENSE` — Apache 2.0, do projeto Mozilla pdf.js

Estão versionados no repositório de propósito: a leitura de PDF precisa
funcionar em rede corporativa que bloqueia CDN externa. Para atualizar:

    npm pack pdfjs-dist@<versão>
    tar xzf pdfjs-dist-<versão>.tgz
    cp package/legacy/build/pdf.min.mjs package/legacy/build/pdf.worker.min.mjs .
    cp package/LICENSE .

Nada aqui é editado à mão.
