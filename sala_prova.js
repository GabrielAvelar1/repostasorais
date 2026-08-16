// ==========================================
// CONFIGURAÇÕES INICIAIS
// ==========================================
const GROQ_API_KEY = 'SUA_CHAVE_AQUI'; // Insira sua chave para rodar o app localmente
const supabaseUrl = 'https://nscwgutnytrbytlzzvil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zY3dndXRueXRyYnl0bHp6dmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2Mjk5ODcsImV4cCI6MjEwMDIwNTk4N30.cTzm3Hs2aov367E2uFBT4ZDyUZQNmvhF5yF-5hZyPUA';


const clienteSupabase = supabase.createClient(supabaseUrl, supabaseKey);

// Elementos HTML
const telaProva = document.getElementById('tela-prova');
const telaConclusao = document.getElementById('tela-conclusao');
const tituloProva = document.getElementById('titulo-prova');
const nomeAlunoDisplay = document.getElementById('nome-aluno');
const contadorQuestoes = document.getElementById('contador-questoes');
const textoPergunta = document.getElementById('texto-pergunta');
const btnMicrofone = document.getElementById('btn-microfone');
const statusMicrofone = document.getElementById('status-microfone');
const transcricaoTexto = document.getElementById('transcricao-texto');
const btnEnviarResposta = document.getElementById('btn-enviar-resposta');

// Variáveis de Estado
const parametrosUrl = new URLSearchParams(window.location.search);
const idProva = parametrosUrl.get('id');
let alunoId = null;
let nomeAluno = '';
let perguntas = [];
let indicePerguntaAtual = 0;

// Variáveis do Gravador de Áudio (Compatível com iPhone)
let mediaRecorder;
let audioChunks = [];
let gravando = false;

// ==========================================
// 1. INICIALIZAÇÃO DA PROVA
// ==========================================
async function iniciarSala() {
    const { data: { session } } = await clienteSupabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    
    alunoId = session.user.id;

    const { data: perfil } = await clienteSupabase.from('perfis').select('nome').eq('id', alunoId).single();
    if (perfil) {
        nomeAluno = perfil.nome;
        nomeAlunoDisplay.innerText = `Aluno(a): ${nomeAluno}`;
    }

    const { data: provaData, error: erroProva } = await clienteSupabase
        .from('provas')
        .select(`nome, perguntas (*)`)
        .eq('id', idProva)
        .single();

    if (erroProva || !provaData) {
        alert("Erro ao carregar a prova.");
        window.location.href = 'painel_aluno.html'; return;
    }

    tituloProva.innerText = provaData.nome;
    perguntas = provaData.perguntas;

    if (perguntas.length === 0) {
        alert("Esta prova não tem perguntas cadastradas.");
        window.location.href = 'painel_aluno.html'; return;
    }

    inicializarGravador();
    mostrarPerguntaAtual();
}

// ==========================================
// 2. EXIBIR A PERGUNTA
// ==========================================
function mostrarPerguntaAtual() {
    transcricaoTexto.value = '';
    statusMicrofone.innerText = 'Clique no microfone para começar a gravar';
    statusMicrofone.style.color = '#7f8c8d';
    
    const perguntaAtual = perguntas[indicePerguntaAtual];
    contadorQuestoes.innerText = `Questão ${indicePerguntaAtual + 1} de ${perguntas.length}`;
    textoPergunta.innerText = perguntaAtual.pergunta;

    if (indicePerguntaAtual === perguntas.length - 1) {
        btnEnviarResposta.innerText = "Finalizar Prova 🏁";
    } else {
        btnEnviarResposta.innerText = "Enviar Resposta e Continuar ➡️";
    }
}

// ==========================================
// 3. GRAVADOR UNIVERSAL (Compatível com iPhone/iOS)
// ==========================================
async function inicializarGravador() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            statusMicrofone.innerText = 'Processando áudio gravado (Enviando para IA)...';
            
            // Cria o blob do áudio gravado (compatível com mobile)
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];

            await transcreverAudioGroq(audioBlob);
        };

    } catch (err) {
        console.error("Erro ao acessar o microfone:", err);
        alert("Não foi possível acessar o seu microfone. Verifique as permissões do navegador.");
    }
}

function alternarGravacao() {
    if (!mediaRecorder) {
        alert("Gravador não inicializado.");
        return;
    }

    if (!gravando) {
        // Iniciar Gravação
        audioChunks = [];
        mediaRecorder.start();
        gravando = true;
        btnMicrofone.classList.add('gravando');
        statusMicrofone.innerText = '🔴 Gravando áudio... Fale com clareza.';
        statusMicrofone.style.color = '#e74c3c';
        transcricaoTexto.value = '';
    } else {
        // Parar Gravação
        mediaRecorder.stop();
        gravando = false;
        btnMicrofone.classList.remove('gravando');
    }
}

btnMicrofone.addEventListener('click', alternarGravacao);

// ==========================================
// 4. TRANSCRIÇÃO (GROQ WHISPER)
// ==========================================
async function transcreverAudioGroq(audioBlob) {
    statusMicrofone.innerText = "⏳ Transcrevendo áudio em tempo real...";
    statusMicrofone.style.color = '#f39c12';

    const formData = new FormData();
    formData.append('file', audioBlob, 'gravacao.webm'); 
    formData.append('model', 'whisper-large-v3'); 
    formData.append('language', 'pt'); 
    formData.append('response_format', 'json');

    try {
        const resposta = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: formData
        });

        if (!resposta.ok) throw new Error("Falha ao comunicar com API de voz.");

        const dados = await resposta.json();
        transcricaoTexto.value = dados.text;
        statusMicrofone.innerText = "✅ Transcrição pronta! Você pode revisar o texto abaixo.";
        statusMicrofone.style.color = '#27ae60';
        
    } catch (erro) {
        console.error(erro);
        statusMicrofone.innerText = "❌ Erro na transcrição do áudio.";
        statusMicrofone.style.color = '#e74c3c';
    }
}

// ==========================================
// 5. AVALIAÇÃO DA IA (GROQ LLAMA 3) E ENVIO
// ==========================================
async function avaliarRespostaComIA(pergunta, respostaEspelho, respostaAluno, valorTotal) {
    const valor = parseFloat(valorTotal) || 10;
    
    if (!respostaEspelho) {
        return { nota: valor, feedback: "Gabarito espelho não fornecido. Pontuação integral concedida para revisão do professor." };
    }

    const promptSistema = `Você é um avaliador acadêmico universitário de alta precisão e com excelente capacidade de interpretação de texto e coesão textual. 
Sua tarefa é avaliar a resposta de um aluno comparando-a com a Resposta Espelho (gabarito) fornecida pelo professor.
A questão vale ${valor} pontos.

REGRAS CRÍTICAS DE AVALIAÇÃO:
1. EQUIVALÊNCIA SEMÂNTICA DE ALTO NÍVEL: O aluno não precisa usar as mesmas palavras do gabarito. Se a resposta dele significar clinicamente e teoricamente a mesma coisa, a avaliação deve ser positiva.
2. ERROS DE DIGITAÇÃO/FONÉTICA: Ignore totalmente pequenos deslizes de grafia ou fonética causados por transcrição de voz automática.
3. RIGOR JUSTO: Só retire pontos se houver erro conceitual real, omissão de informações técnicas críticas que mudariam o diagnóstico/conduta, ou se a resposta for incompleta de fato.
4. EXCELÊNCIA: Se o aluno cobriu todos os pontos do gabarito de forma clara e coesa, atribua a nota máxima (${valor}).

Você DEVE retornar a sua resposta estritamente no formato JSON abaixo, sem qualquer texto adicional antes ou depois do JSON:
{
  "nota": ${valor},
  "feedback_ia": "Descreva o que o aluno acertou e o que faltou ou errou de forma construtiva. Seja direto e breve."
}`;

    const promptUsuario = `Pergunta da Prova: ${pergunta}\nResposta Espelho (Gabarito): ${respostaEspelho}\nResposta do Aluno: ${respostaAluno}`;

    try {
        const requisicao = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', 
                messages: [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: promptUsuario }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" } 
            })
        });

        if (!requisicao.ok) throw new Error("Erro de comunicação com a IA.");

        const resultadoIA = await requisicao.json();
        const dadosCorrecao = JSON.parse(resultadoIA.choices[0].message.content);
        
        // Garante que a nota não exceda o valor total e não seja negativa
        let notaFinal = parseFloat(dadosCorrecao.nota);
        if (isNaN(notaFinal) || notaFinal < 0) notaFinal = 0;
        if (notaFinal > valor) notaFinal = valor;

        return { nota: notaFinal, feedback: dadosCorrecao.feedback_ia };

    } catch (erro) {
        console.error("Erro na IA:", erro);
        return { nota: 0, feedback: "Erro ao processar a avaliação automática. O professor fará a correção manual." };
    }
}

btnEnviarResposta.addEventListener('click', async () => {
    const textoResposta = transcricaoTexto.value.trim();
    if (!textoResposta) {
        alert("Por favor, grave ou digite uma resposta antes de continuar.");
        return;
    }

    btnEnviarResposta.disabled = true;
    btnEnviarResposta.innerText = '🤖 Avaliando com Inteligência Artificial...';

    const perguntaAtual = perguntas[indicePerguntaAtual];
    
    // Chama a IA real
    const avaliacaoIA = await avaliarRespostaComIA(
        perguntaAtual.pergunta, 
        perguntaAtual.resposta_espelho, 
        textoResposta, 
        perguntaAtual.valor_pontos
    );

    try {
        const { error } = await clienteSupabase
            .from('respostas_alunos')
            .insert([{
                prova_id: idProva,
                aluno_id: alunoId,
                pergunta_id: perguntaAtual.id,
                transcricao: textoResposta,
                nota: avaliacaoIA.nota,
                feedback_ia: avaliacaoIA.feedback,
                revisada_professor: false
            }]);

        if (error) throw error;

        indicePerguntaAtual++;
        
        if (indicePerguntaAtual < perguntas.length) {
            mostrarPerguntaAtual();
        } else {
            telaProva.classList.add('hidden');
            telaConclusao.classList.remove('hidden');
        }

    } catch (erro) {
        console.error("Erro ao salvar:", erro);
        alert("Erro ao enviar resposta. Tente novamente.");
    } finally {
        btnEnviarResposta.disabled = false;
    }
});

// INICIA
iniciarSala();