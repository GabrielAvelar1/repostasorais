# 🦷 Sistema de Provas Orais com Áudio e IA - Profª. Patricia

Sistema web completo desenvolvido para aplicação e avaliação de provas orais em Odontologia / Odontopediatria.

## ✨ Recursos Principais

- **Banco com 33 Questões Oficiais**: Extraídas do conteúdo programático da disciplina.
- **Sorteio Individual**: Cada aluno recebe 5 questões aleatórias exclusivas.
- **Gravação de Áudio & Transcrição**:
  - Suporte a qualquer dispositivo e navegador (Brave, Google Chrome, Edge, Safari, iOS e Android).
  - Transcrição automática de voz para texto com Inteligência Artificial.
  - Caixa de resposta 100% editável para o aluno revisar e corrigir termos técnicos antes de enviar.
  - Player para conferir o áudio gravado.
- **Correção por IA Gratuita**:
  - Consolidação das 5 respostas em uma única requisição (apenas 30 requisições para a turma toda).
  - Suporte ao Google Gemini Flash (plano gratuito do Google AI Studio com até 1.500 requisições/dia) e Groq Whisper/Llama.
  - Fila inteligente em segundo plano para não sobrecarregar as chamadas.
  - Avaliador semântico de fallback caso não haja conexão.
- **Painel de Controle da Professora Patricia (12345)**:
  - Botão mestre para Liberar / Bloquear a prova para a turma.
  - Botão para Liberar Notas apenas quando a professora autorizar.
  - Visualização das 5 questões, respostas transcritas, gabarito e sugestão da IA.
  - Ajuste manual de notas e comentários pedagógicos.
  - Exportação da planilha completa de notas em CSV/Excel.

## 🚀 Como Executar

1. Instale o [Node.js](https://nodejs.org/) (versão 20 ou superior).
2. Clone o repositório ou baixe os arquivos.
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Inicie o sistema dando 2 cliques em `iniciar_sistema.bat` ou pelo terminal:
   ```bash
   npm start
   ```
5. Acesse no navegador:
   - **`http://localhost:3000`**

### Acessos:
- **Professora:** Nome: `Patricia` | Matrícula: `12345`
- **Alunos:** Qualquer matrícula e nome completo (o cadastro é automático no primeiro login).
