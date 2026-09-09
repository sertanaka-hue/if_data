#!/usr/bin/env python3
"""Servidor local para o IF.data Analytics.

Abrir o index.html direto do disco (file://) costuma funcionar, mas alguns
navegadores tratam a origem "null" com mais rigor e bloqueiam a chamada ao
Banco Central. Servir a pasta por HTTP evita esse problema.

Uso:
    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080       # outra porta
"""
import http.server
import socketserver
import sys
import os
import webbrowser

PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
RAIZ = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    def end_headers(self):
        # a página é totalmente estática; evita servir versão velha durante o desenvolvimento
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORTA), Handler) as httpd:
        url = "http://localhost:%d/" % PORTA
        print("IF.data Analytics servindo em %s" % url)
        print("Ctrl+C para encerrar.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nEncerrado.")
