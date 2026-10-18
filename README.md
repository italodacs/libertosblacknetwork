# Libertos Black Network

Site estático em HTML/CSS/JavaScript, com publicação configurada para Vercel.

## Estrutura

- `HTML/index.html`: página institucional e formulários de apoio.
- `HTML/talentos.html`: cadastro e upload de currículo.
- `CSS/global.css`: estilos e tokens dos temas.
- `SCRIPT/site.js`: tema, configuração do endpoint e transporte compartilhado.
- `SCRIPT/form-validation.js`: validação compartilhada de campos, compatível com as regras do servidor.
- `SCRIPT/home.js` e `SCRIPT/talentos.js`: comportamentos específicos de cada página.
- `SCRIPT/formulario-apoie.gs`: backend Google Apps Script, implantado separadamente.
- `vercel.json`: rotas e cabeçalhos HTTP. `/` e `/talentos` são as rotas canônicas.
- `imagens-e-documentacao`: recursos do site e materiais de marca/autoria. Os scripts `support.js` e `deck-stage.js` pertencem aos documentos de autoria, não às páginas públicas.

## Desenvolvimento e verificações

Requer Node.js 22 ou superior. As dependências npm são exclusivamente ferramentas de desenvolvimento; o site não depende de Node no navegador e não tem etapa de compilação.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run serve
```

O servidor local abre em `http://127.0.0.1:4173` e simula as rotas e headers configurados. Não é um servidor de produção. Bloqueia métodos diferentes de GET/HEAD. Os testes de navegador bloqueiam envios às integrações e usam respostas simuladas, sem cadastrar pessoas reais. Para testar com Edge instalado, defina `PLAYWRIGHT_CHANNEL=msedge`. Resultados ficam em `test-results/` ou no diretório definido por `EVIDENCE_DIR`.

`npm run check` valida sintaxe, IDs, scripts e referências locais. `npm test` testa o contrato do Apps Script com serviços Google simulados, o esquema das planilhas, a validação compartilhada, o transporte e as rotas locais. `npm run test:browser` executa a suíte original e as regressões de formulários sem scripts, inicialização parcial, envio nativo, validação de campos, foco e texto ampliado. As últimas duas podem ser executadas isoladamente com `npm run test:forms` e `npm run test:accessibility`. A CI executa essas verificações e `npm audit`; ela precisa ser executada pelo GitHub após publicar a branch para comprovar seu resultado remoto.

`npm run verify` reúne check, testes Node e navegador. Em uma correção, execute primeiro os casos afetados e então o conjunto completo uma vez. Pare em falha reproduzível e investigue a causa: repetir indefinidamente a mesma execução não acrescenta cobertura. Fonte CSS duplicada no teste não equivale a zoom nativo; leitor de tela, aparelhos reais e serviços Google continuam exigindo homologação separada.

## Envio de formulários

Os campos começam desabilitados no HTML e apresentam uma orientação de contato. Cada formulário só é habilitado depois de carregar a validação e registrar seu handler por `LbnSite.bindForm`. Script ausente ou falha anterior ao bind mantém o formulário fechado. CSP `form-action 'none'`, em metadado HTML e nos headers canônicos, proíbe navegação nativa inclusive por `form.submit()`; o envio legítimo continua por fetch. Não remova essa política nem habilite os campos globalmente na carga de um script.

A URL pública do Apps Script está centralizada em `SCRIPT/site.js`. Ela não é segredo. O transporte atual usa `no-cors`: o navegador recebe uma resposta opaca e **não consegue verificar se o registro foi salvo**. O site mantém os campos e mostra que o recebimento não foi confirmado. Uma resposta opaca nunca apaga os dados nem anuncia sucesso. Timeout e falha de rede também podem ocorrer depois de uma gravação; antes de repetir um cadastro, confirme com a equipe.

O backend retorna texto simples: `ok` para persistência concluída, `invalid request`, `invalid file`, `ignored`, `busy` ou `error` nos demais casos. A validação do servidor é a autoridade: campos obrigatórios, consentimento, opções, limites e formato básico dos arquivos são verificados antes de gravar. Assinatura PDF/DOC/ZIP não é análise antimalware; DOCX exige validação do conteúdo do contêiner em uma evolução posterior.

Antes de criar currículo ou gravar o cadastro, o backend verifica os nomes, ordem e quantidade de colunas utilizadas na aba. Abas existentes incompatíveis, inclusive vazias, são recusadas; somente uma aba realmente ausente é inicializada. Não renomeie, reordene ou acrescente colunas sem migração compatível e backup. Uma recusa não corrige registros históricos: sua reconciliação deve ocorrer em ambiente controlado, sem apagar dados automaticamente.

O lock protege criação da pasta e escrita. O novo currículo só pode ser enviado à lixeira como compensação antes de iniciar a tentativa de gravar a linha. Se `appendRow` lançar erro, o arquivo é preservado, pois a linha pode já ter sido gravada. Sheets e Drive não oferecem uma transação conjunta: arquivos órfãos, falhas ambíguas e falhas de limpeza ainda precisam de reconciliação operacional. Não há idempotência nem limitação robusta de abuso acumulado.

## Publicação, homologação e rollback

1. Revise o diff e execute as verificações locais/CI.
2. Na conta responsável, crie um ambiente de homologação com planilha e pasta separadas. Publique o Apps Script ali e configure o endpoint de homologação na cópia de teste. Não reutilize cadastros reais.
3. Confirme os três tipos de cadastro, permissões privadas, falhas de upload, erros de quota, planilha, notificações e política de retenção com os responsáveis. Os testes locais não provam o comportamento dos serviços Google reais.
4. Para publicar o Apps Script autorizado, salve uma nova versão da implantação existente para preservar a URL `/exec`. Registre o número da versão anterior e os IDs dos recursos no inventário privado da operação.
5. Publique o site como projeto estático Vercel, preservando a configuração de diretório e domínio existente. Valide `/`, `/talentos`, redirects, recursos, CSP e integrações no preview antes de promover. Não existe comando de build obrigatório; as ferramentas npm não devem ser servidas como dependências do frontend.
6. Em regressão, restaure o deployment Vercel anterior e a versão anterior do Apps Script. Não apague planilhas, pastas ou registros para reverter código. O esquema das colunas foi preservado.

Nenhuma publicação é realizada pelos testes. A CSP está restrita às duas rotas públicas para preservar a execução dos documentos de autoria. Ela proíbe scripts inline e avaliação dinâmica nessas páginas; estilos inline continuam necessários à estrutura existente. Confirme no preview os headers efetivamente aplicados pela Vercel, inclusive barras finais/aliases.

## Operação e evolução

- Acompanhe erros por categoria no Apps Script: `submission_lock_unavailable`, `submission_write_failed`, `submission_write_outcome_unknown`, `submission_file_cleanup_failed`, `submission_notification_failed`. Não inclua payloads, nomes ou currículos nos logs.
- Verifique quotas de armazenamento e envio de e-mail da conta; não estime capacidade apenas pelo tráfego das páginas estáticas.
- Antes de ampliar a captação, planeje uma API de confirmação verificável com idempotência e controle de admissão antes dos efeitos no Google. Um proxy público que ainda permita contornar o backend diretamente não resolve abuso.
- Defina responsáveis por acesso, retenção, exclusão, backup/restauração e tratamento dos dados sensíveis e de menores. As permissões reais, as decisões LGPD e a política de privacidade não estão estabelecidas por este código.
- Preserve a arquitetura estática enquanto medições não mostrarem necessidade de outra solução. Adicione filas, banco transacional ou serviços separados somente a partir dos gargalos observados.

Referências: [respostas opacas](https://developer.mozilla.org/en-US/docs/Web/API/Response/type), [quotas Apps Script](https://developers.google.com/apps-script/guides/services/quotas), [configuração Vercel](https://vercel.com/docs/project-configuration/vercel-json), [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
