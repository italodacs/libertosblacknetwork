# 🎯 Guia Prático: Configurando o Domínio na Vercel (Passo a Passo Focado & Estruturado)

> 💡 **Para quem é este guia**: Criado especialmente para navegação objetiva, sem ambiguidade, com micro-passos claros, caixas de checagem e resultados esperados em cada etapa.

---

## 🧭 Visão Geral Rápida (O Que Vamos Fazer)
Você comprou o domínio **`libertosblacknetwork.com.br`** e precisamos dizer à internet que ele deve abrir o site que está hospedado na **Vercel**. 

- **Tempo estimado**: 3 a 5 minutos para executar.
- **O que você precisa ter em mãos**: 
  - Login e senha da sua conta no **Registro.br**.

---

## ⚡ Bloco de Copiar e Colar (Mantenha à Mão)

Abaixo estão os únicos 2 dados que você vai cadastrar. Copie exatamente como estão:

### Dado 1 (Domínio principal)
- **Tipo**: `A`
- **Nome / Host**: *(Deixar em branco ou digitar `@`)*
- **Valor / IP**: `76.76.21.21`

### Dado 2 (Variação com WWW)
- **Tipo**: `CNAME`
- **Nome / Host**: `www`
- **Valor / Destino**: `cname.vercel-dns.com`

---

## 🐾 Passo a Passo (Execute Um por Um)

### 📌 Etapa 1: Entrar no Registro.br
- [ ] **1.1.** Abra uma nova aba no seu navegador e acesse: `https://registro.br`
- [ ] **1.2.** Clique no botão **Acessar Conta** (canto superior direito).
- [ ] **1.3.** Digite seu **CPF/CNPJ/Usuário** e sua **Senha**.
- [ ] **1.4.** Clique no domínio: **`libertosblacknetwork.com.br`**.

> 🟢 **Resultado Esperado**: Você estará na página de gerenciamento do domínio `libertosblacknetwork.com.br`.

---

### 📌 Etapa 2: Acessar o Painel de DNS
- [ ] **2.1.** Role a página para baixo até encontrar o bloco chamado **DNS**.
- [ ] **2.2.** Clique no botão cinza ou azul que diz **Configurar Zona DNS** ou **Editar Zona**.

> 🟢 **Resultado Esperado**: Você verá uma tela com uma tabela de registros DNS (ou um botão para adicionar entradas).

---

### 📌 Etapa 3: Criar a Entrada Principal (A)
- [ ] **3.1.** Clique no botão **Nova Entrada** (ou **Adicionar Regra**).
- [ ] **3.2.** No campo **Nome**, deixe **totalmente em branco** (ou se o sistema exigir preenchimento, coloque `@`).
- [ ] **3.3.** No menu suspenso **Tipo**, selecione: **`A`**.
- [ ] **3.4.** No campo **Endereço IP** (ou Dados), cole exatamente:
  ```text
  76.76.21.21
  ```
- [ ] **3.5.** Clique no botão **Adicionar** / **Inserir**.

> 🟢 **Resultado Esperado**: A linha com o tipo `A` e o IP `76.76.21.21` vai aparecer na sua lista.

---

### 📌 Etapa 4: Criar a Entrada do WWW (CNAME)
- [ ] **4.1.** Clique novamente no botão **Nova Entrada**.
- [ ] **4.2.** No campo **Nome**, digite exatamente:
  ```text
  www
  ```
- [ ] **4.3.** No menu suspenso **Tipo**, selecione: **`CNAME`**.
- [ ] **4.4.** No campo **Nome de Domínio / Dados**, cole exatamente:
  ```text
  cname.vercel-dns.com
  ```
- [ ] **4.5.** Clique no botão **Adicionar** / **Inserir**.

> 🟢 **Resultado Esperado**: A linha do tipo `CNAME` apontando `www` para `cname.vercel-dns.com` vai aparecer na lista.

---

### 📌 Etapa 5: Salvar as Alterações
- [ ] **5.1.** Procure o botão **Salvar Alterações** (geralmente fica no topo ou no final da tabela).
- [ ] **5.2.** Clique em **Salvar Alterações**.

> 🟢 **Resultado Esperado**: Aparecerá uma mensagem verde confirmando que as alterações da zona DNS foram salvas com sucesso.

---

## 🔍 Como Saber se Funcionou? (Verificação)

1. Aguarde **5 a 10 minutos** (tempo padrão para a internet atualizar os endereços).
2. Acesse no seu navegador ou celular:
   - `https://libertosblacknetwork.com.br`
   - `https://www.libertosblacknetwork.com.br`
3. Se a página carregar o site da **Libertos Black Network** com o cadeado de segurança (HTTPS), **TUDO PRONTO! 🎉**

---

## 🛠️ Solução de Problemas / O Que Fazer se Der Dúvida

| Situação | O que significa | O que fazer |
| :--- | :--- | :--- |
| **Página "Não é possível acessar este site"** | O DNS ainda está propagando na internet. | Aguarde 15 a 30 minutos e atualize com `Ctrl + F5`. |
| **Aviso de "Sua conexão não é privada"** | O certificado SSL da Vercel está sendo gerado. | Aguarde cerca de 10 minutos que o HTTPS ativa sozinho. |
| **Já existia um registro A ou CNAME antigo** | Apague a linha antiga antes de criar a nova. | Clique no ícone da lixeira ao lado da regra antiga e crie a nova. |

---
*Pronto! Você completou toda a configuração com precisão.*
