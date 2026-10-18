# Relatório simples — o que melhorou no site

**Projeto:** Libertos Black Network

**Data do relatório:** 18 de outubro de 2026

**Situação:** melhorias feitas na cópia local do projeto. A atualização do site publicado continua pendente.

O trabalho deixou os formulários mais cuidadosos com os dados, corrigiu dificuldades de uso e criou verificações para ajudar a evitar que os mesmos problemas voltem.

## O que foi melhorado

| Melhoria | O que isso significa na prática |
|---|---|
| **Proteção dos dados nos formulários** | Se os scripts da página não carregarem corretamente, o formulário fica indisponível e mostra uma orientação de contato. Isso evita o envio acidental de dados pessoais pelo endereço da página nos cenários testados. |
| **Mensagens de envio mais honestas** | O site deixa de tratar uma resposta desconhecida como cadastro confirmado. Quando não consegue confirmar o recebimento, avisa a pessoa e mantém o que ela preencheu. |
| **Mais cuidado durante o envio** | O botão bloqueia outra tentativa enquanto um envio está em andamento. Se a espera demorar demais, a pessoa recebe uma orientação. Isso ainda não elimina duplicações em tentativas posteriores. |
| **Conferência dos dados preenchidos** | Entradas como idade, e-mail, endereço de perfil e campos obrigatórios recebem verificações e mensagens mais claras. O servidor também mantém suas próprias verificações dos dados e dos currículos. |
| **Proteção da organização da planilha** | O sistema confere os nomes e a ordem das colunas antes de gravar. Se a estrutura estiver diferente do esperado, recusa o cadastro para evitar colocar informações na coluna errada. Isso não corrige registros antigos. |
| **Mais cuidado para não perder currículos** | Quando uma tentativa de gravação termina com resultado incerto, o currículo é preservado para conferência. Ainda é necessário resolver os casos em que existe arquivo sem cadastro ou cadastro duplicado. |
| **Melhor uso pelo teclado e em telas pequenas** | Foram ajustados contraste, indicação do campo selecionado, navegação por teclado e situações em que o cabeçalho escondia o campo ou o texto de contato ficava cortado. A avaliação completa de acessibilidade continua pendente. |
| **Arquivos de fonte menores** | As duas fontes Luciole usadas na página passaram a ocupar cerca de 74% menos espaço, preservando seus caracteres. Isso reduz o volume desses arquivos; não significa que o site inteiro ficou 74% mais rápido. |
| **Código mais organizado e testes automáticos** | Funções usadas pelas duas páginas foram reunidas, reduzindo repetição. Foram acrescentados testes para detectar erros nos formulários, na gravação simulada dos dados e na interface antes de futuras publicações. |

## Como as melhorias foram verificadas

Na rodada concluída em **17 de outubro de 2026**, passaram:

- 86 testes do funcionamento interno, incluindo regras dos cadastros e tratamento de falhas.
- 68 verificações gerais no navegador.
- 37 verificações dos formulários, incluindo falhas de carregamento, validação e foco dos campos.
- 29 verificações específicas de foco, leitura e comportamento da interface.

Uma revisão independente encontrou um problema no foco dos campos inválidos. Ele foi corrigido e os dois casos que reproduziam a falha passaram a fazer parte dos testes.

Essas verificações usaram dados fictícios e serviços Google simulados. Os números têm escopos diferentes e não representam garantia de ausência de erros. Para preparar este commit, a fonte foi comparada com a versão testada; o relatório é uma documentação nova, não uma nova rodada de testes com os serviços reais.

## O que ainda precisa ser resolvido

1. Preparar um ambiente de testes separado e comprovar os três cadastros usando Apps Script, planilha, pasta de currículos e e-mail reais desse ambiente.
2. Criar uma confirmação confiável de recebimento e evitar cadastros duplicados quando alguém tenta novamente.
3. Proteger o sistema contra muitos envios automáticos, spam e consumo excessivo dos serviços.
4. Testar cópias de segurança e recuperação dos dados; conferir quem pode acessar cadastros e currículos.
5. Concluir decisões sobre privacidade, compartilhamento, retenção dos dados e informações do evento.
6. Completar verificações de acessibilidade com leitores de tela, ampliação real e aparelhos relevantes.
7. Medir a capacidade para **200 pessoas online ao mesmo tempo** e conferir planos, limites e custos. Essa capacidade e o orçamento mensal de R$ 0 ainda não foram comprovados.

**A publicação continua sem aprovação.** Salvar as alterações em um commit registra o trabalho no histórico local; enviar ao GitHub e atualizar o site são etapas separadas. Nenhum risco restante foi considerado aceito apenas por estar documentado.
