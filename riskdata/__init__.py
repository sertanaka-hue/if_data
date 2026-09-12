"""Risk Data - Look-through de fundos de investimento e cálculo de RWA (BCB).

Módulos:
    regulation  - catálogo de FPR/RW com citação de artigo e resolução
    taxonomy    - normalização e classificação dos ativos da CDA/CVM
    cvm         - cliente de dados abertos da CVM (cadastro + CDA)
    anbima      - cliente ANBIMA (dados públicos e API opcional)
    lookthrough - resolução recursiva de cotas de fundos até o ativo final
    engine      - motores RWACPAD (carteira bancária) e RWADRC (negociação)
    report      - montagem do relatório e exportação CSV/XML
    server      - API HTTP e servidor da interface web
"""

__version__ = "1.0.0"
__appname__ = "Risk Data"
