# Luciole para entrega web

Luciole © Laurent Bourcellier & Jonathan Perez – 2019.

Os metadados das fontes originais informam a licença **Creative Commons Attribution 4.0 International**:
[texto da licença](https://creativecommons.org/licenses/by/4.0/legalcode),
[texto em francês registrado na fonte](https://creativecommons.org/licenses/by/4.0/legalcode.fr).

Os arquivos WOFF2 desta pasta foram convertidos dos TTF em
`imagens-e-documentacao/documentacao/fonts/`. A mudança é de empacotamento e
compressão: nenhum glifo foi removido e os desenhos, mapeamentos Unicode,
ordem dos glifos e métricas foram preservados. Os TTF originais continuam intactos.
As informações de atribuição e licença embutidas também foram preservadas.
A tabela original `DSIG`, vazia e sem assinaturas, é omitida pelo formato WOFF2.

| Fonte | TTF original | WOFF2 | Redução |
|---|---:|---:|---:|
| Regular | 167.572 bytes | 42.816 bytes | 74,45% |
| Bold | 166.076 bytes | 42.812 bytes | 74,22% |

Ambas mantêm os 755 glifos originais. O validador também compara todos os
submapas de caracteres, contornos, métricas e bytes das tabelas não transformadas.
FontTools avisa sobre larguras incomuns dos glifos de controle `NULL`/`.null`
presentes nos arquivos originais; essas métricas também foram preservadas.

Para reproduzir, use Python com `fontTools` e o módulo Brotli. Se o módulo Brotli
não estiver disponível, o script usa a implementação da biblioteca padrão do
Node.js, sem instalar dependências:

```sh
python scripts/convert-fonts.py --report font-conversion.json
```

O script compara as fontes originais e convertidas antes de emitir o relatório.
Python e fontTools são ferramentas opcionais de manutenção; o site publicado
entrega os arquivos estáticos e não depende deles em execução.
