# 🦷 Manual de Uso do Sistema de Prova Oral - Professora Patricia

Este sistema foi desenvolvido especialmente para a **Professora Patricia** aplicar, avaliar e gerenciar provas orais de Odontopediatria para sua turma de alunos (~30 alunos), com sorteio individual de 5 questões, transcrição de áudio por voz, suporte de correção por IA gratuita e controle total pela professora.

---

## 🚀 Como Iniciar o Sistema

1. Abra a pasta do projeto e clique duas vezes em **`iniciar_sistema.bat`** (ou abra o terminal e execute `npm start`).
2. Acesse no navegador (recomendado: **Google Chrome** ou **Microsoft Edge** para suporte nativo ao reconhecimento de voz):
   - **Link de Acesso Geral:** `http://localhost:3000`

---

## 👩‍🏫 Acesso da Professora Patricia

- **Nome Completo:** `Patricia`
- **Matrícula:** `12345`

Ao digitar esses dados na tela inicial, o sistema reconhece automaticamente o perfil docente e direciona para o **Painel Administrativo da Professora** (`/admin.html`).

### Recursos do Painel da Professora:
1. **🟢 Liberar / Bloquear Prova Oral:**
   - Enquanto estiver **Bloqueada (Vermelho)**, os alunos que entrarem verão uma sala de espera ("Aguardando Liberação da Professora...").
   - Quando você clicar no botão para **Liberar (Verde)**, a prova iniciará automaticamente na tela de todos os alunos sem que eles precisem recarregar a página.
2. **📢 Liberar / Ocultar Notas para a Turma:**
   - Enquanto estiver **Oculta (Amarelo)**, o aluno que enviar a prova verá apenas "Prova enviada com sucesso! A professora está revisando as avaliações".
   - Quando você revisar todas as provas e clicar em **Liberar Notas (Verde)**, o boletim completo com a nota final, acertos e correções aparecerá para todos os alunos.
3. **👁️ Revisar / Alterar Nota:**
   - Ao lado do nome de cada aluno na tabela, clique em "Revisar / Alterar Nota".
   - Você verá:
     - As 5 perguntas sorteadas para aquele aluno.
     - A resposta por áudio transcrita e revisada pelo aluno.
     - A resposta de referência esperada.
     - A nota preliminar e justificativa pedagógica sugerida pela IA.
     - **Campos para você alterar a nota (de 0 a 10) e escrever seu próprio comentário**. O sistema recalcula a média final automaticamente!
4. **📥 Baixar Planilha de Notas (CSV / Excel):**
   - Baixa em 1 clique o arquivo `.csv` com o nome de todos os alunos, matrículas, status e notas finais prontas para lançar no diário de classe.
5. **⚙️ Configurar IA Gratuita (Google Gemini):**
   - No painel da professora, clique no botão "Configurar IA Gratuita".
   - Você pode colar sua chave gratuita do **Google AI Studio** (sem custo, com limite de até 1.500 requisições por dia).
   - O sistema precisa de apenas **30 requisições no dia** (2% da cota gratuita), pois consolida as 5 respostas de cada aluno em 1 única chamada inteligente.
   - Mesmo que nenhuma chave seja inserida, o sistema possui um **avaliador semântico de referência** que calcula uma nota justa e permite que você ajuste tudo manualmente!

---

## 👨‍🎓 Como Funciona para os Alunos

1. O aluno entra em `http://localhost:3000`.
2. Digita sua **Matrícula** e seu **Nome Completo**.
   - Se for o primeiro acesso, o cadastro é feito na hora. Se já tiver acessado, o sistema restaura o progresso.
3. **Sala de Espera:**
   - Se a prova ainda estiver bloqueada pela professora, o aluno aguarda.
   - Assim que a professora liberar, a prova abre na tela do aluno.
4. **Respondendo as 5 Questões:**
   - O sistema sorteia 5 questões aleatórias do banco de questões para o aluno.
   - O aluno clica no botão **🎤 "Gravar Resposta por Voz"** e fala ao microfone.
   - A fala é transcrita em tempo real diretamente na caixa de texto.
   - **Importante:** O aluno pode clicar e digitar na caixa de texto para corrigir termos técnicos odontológicos (ex: ART, furca, CIV) ou complementar a resposta antes de avançar.
   - O sistema possui **salvamento automático de rascunho**, então nada se perde caso a página seja recarregada.
5. **Envio da Prova:**
   - Na 5ª questão, o aluno clica em **"✓ Finalizar e Enviar Prova"**.
   - Aparece a confirmação de envio.
6. **Visualização das Notas:**
   - Assim que a professora Patricia liberar os resultados no painel dela, o aluno tem acesso ao espelho completo da prova com a nota final, as notas de cada questão, respostas esperadas e feedback.

---

## 🛡️ Dúvidas Frequentes

- **E se faltar internet na sala durante a prova?**
  - O sistema roda em servidor local na própria rede ou computador da sala. As respostas são salvas no banco de dados local `database.sqlite` e nunca são perdidas.
- **O que acontece se 30 alunos enviarem a prova ao mesmo tempo?**
  - O backend possui uma **fila inteligente com controle de taxa** (rate limiter), processando os exames em segundo plano sem travar a interface e sem estourar limites de requisição por minuto da IA.
