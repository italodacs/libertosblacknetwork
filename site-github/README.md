# Libertos Black Network

Site institucional da Libertos Black Network — a rede que conecta universitários, profissionais e empresas.

## Como publicar no GitHub Pages

1. Crie um repositório novo no GitHub (ex: `site`).
2. Envie **todo o conteúdo desta pasta** para a raiz do repositório
   (arraste os arquivos na página do repositório, ou use `git push`).
3. No repositório, vá em **Settings → Pages**.
4. Em *Source*, escolha **Deploy from a branch**, branch `main` e pasta `/ (root)`. Salve.
5. Em alguns minutos o site fica no ar em
   `https://<seu-usuario>.github.io/<nome-do-repo>/`

Para usar um domínio próprio, adicione o domínio em **Settings → Pages → Custom domain**.

## Estrutura

```
index.html                 página única do site (HTML + CSS, sem dependências)
assets/sol-*.svg           símbolo Sol Liberto nas três cores
assets/clube-logo-*.png    logotipo do Clube dos Libertos
fonts/Luciole-*.ttf        tipografia de texto
.nojekyll                  evita o processamento Jekyll do GitHub Pages
```

A tipografia display é a **Archivo**, carregada do Google Fonts pelo `index.html`.

## Editar conteúdo

Todo o texto está direto no `index.html`, em português, na ordem em que aparece na página.
As cores vêm de variáveis CSS no topo do arquivo, em dois blocos:
`[data-lbn-theme="light"]` (tema padrão) e `[data-lbn-theme="dark"]`.

| Token | Uso |
|---|---|
| `--accent` `#FF4B0F` | laranja da marca (preenchimentos) |
| `--accent-text` | laranja de texto pequeno (escurecido no tema claro por contraste) |
| `--bg1` `--bg2` `--bg3` | fundos das seções |
| `--fg` `--fg2` `--fg3` | texto principal, secundário e discreto |

## Links configurados

- Inscrição universitários: https://forms.gle/o7Xz1uMxWEaXUTqD9
- Inscrição profissionais: https://forms.gle/HBGDYFMSejqq1oXt9
- Instagram: https://www.instagram.com/libertosblacknetwork/
- LinkedIn: https://www.linkedin.com/company/libertos-black-network/
- E-mail: libertosblacknetwork@gmail.com
