// Coloque sua chave da API do Groq aqui para testar localmente/prototipar
const GROQ_API_KEY = 'SUA_CHAVE_AQUI'; // Insira sua chave para rodar o app localmente

// Elementos da interface do Professor
const perguntaInput = document.getElementById('pergunta-input');
const respostaEspelhoInput = document.getElementById('resposta-espelho');

// Elementos da interface do Aluno
const perguntaTexto = document.getElementById('pergunta-texto');
const btnGravar = document.getElementById('btn-gravar');
const statusGravacao = document.getElementById('status-gravacao');
const btnEnviar = document.getElementById('btn-enviar');
const textoResposta = document.getElementById('texto-resposta');

// Elementos de Resultado
const resultadoContainer = document.getElementById('resultado-container');
const resultadoNota = document.getElementById('resultado-nota');
const resultadoAcertos = document.getElementById('resultado-acertos');
const resultadoErros = document.getElementById('resultado-erros');

let mediaRecorder;
let fragmentosDeAudio = [];
let estaGravando = false;

// SINCRONIZAÇÃO EM TEMPO REAL: Atualiza o cartão do aluno quando o professor digita
perguntaInput.addEventListener('input', () => {
    perguntaTexto.innerText = perguntaInput.value;
});

// 1. LÓGICA DE GRAVAÇÃO DO MICROFONE
btnGravar.addEventListener('click', async () => {
    if (!estaGravando) {
        try {
            statusGravacao.innerText = "Solicitando microfone...";
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.onstart = () => {
                estaGravando = true;
                fragmentosDeAudio = [];
                btnGravar.innerHTML = "⏹ Parar Gravação";
                btnGravar.classList.add('gravando');
                statusGravacao.innerText = "Gravando... Fale sua resposta claramente.";
            };

            mediaRecorder.ondataavailable = (event) => {
                fragmentosDeAudio.push(event.data);
            };

            mediaRecorder.onstop = () => {
                estaGravando = false;
                btnGravar.innerHTML = "🎤 Gravar Novamente";
                btnGravar.classList.remove('gravando');
                statusGravacao.innerText = "Processando áudio...";

                const audioBlob = new Blob(fragmentosDeAudio, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);

                mostrarPlayerDeAudio(audioUrl);
                
                // Dispara a transcrição do áudio usando o Groq Whisper
                transcreverAudioGroq(audioBlob);

                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();

        } catch (erro) {
            console.error("Erro no microfone:", erro);
            alert("Acesso ao microfone negado ou falhou.");
            statusGravacao.innerText = "❌ Sem acesso ao microfone.";
        }
    } else {
        mediaRecorder.stop();
    }
});

function mostrarPlayerDeAudio(url) {
    const playerAntigo = document.getElementById('player-teste');
    if (playerAntigo) playerAntigo.remove();

    const audioElement = document.createElement('audio');
    audioElement.id = 'player-teste';
    audioElement.controls = true;
    audioElement.src = url;
    audioElement.style.marginTop = "15px";
    audioElement.style.width = "100%";

    document.querySelector('.controls').appendChild(audioElement);
}

// 2. INTEGRAÇÃO GROQ (TRANSCRIÇÃO - WHISPER)
async function transcreverAudioGroq(audioBlob) {
    statusGravacao.innerText = "⏳ Transcrevendo áudio em tempo real...";

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
        textoResposta.value = dados.text;
        statusGravacao.innerText = "✅ Transcrição pronta! Você pode revisar o texto abaixo.";
        btnEnviar.disabled = false;
        
    } catch (erro) {
        console.error(erro);
        statusGravacao.innerText = "❌ Erro na transcrição do áudio.";
    }
}

// 3. INTEGRAÇÃO GROQ (CORREÇÃO DA PROVA - LLAMA 3.3 70B)
btnEnviar.addEventListener('click', async () => {
    const pergunta = perguntaInput.value.trim();
    const respostaAluno = textoResposta.value.trim();
    const respostaEspelho = respostaEspelhoInput.value.trim();

    if (!pergunta) {
        alert("Por favor, insira uma pergunta no painel do professor.");
        return;
    }

    if (!respostaAluno) {
        alert("Por favor, escreva ou grave uma resposta antes de enviar.");
        return;
    }

    btnEnviar.disabled = true;
    btnEnviar.innerText = "Analisando com Inteligência Artificial...";
    resultadoContainer.classList.add('hidden'); 

    try {
        const promptSistema = `Você é um avaliador acadêmico universitário de alta precisão e com excelente capacidade de interpretação de texto e coesão textual. 
Sua tarefa é avaliar a resposta de um aluno comparando-a com a Resposta Espelho (gabarito) fornecida pelo professor.

REGRAS CRÍTICAS DE AVALIAÇÃO:
1. EQUIVALÊNCIA SEMÂNTICA DE ALTO NÍVEL: O aluno não precisa usar as mesmas palavras do gabarito. Se a resposta dele significar clinicamente e teoricamente a mesma coisa, a avaliação deve ser positiva.
2. COMPREENSÃO DE ELIPSES E ZEUGMAS: Entenda estruturas comparativas e de síntese. Se o aluno diz "A raspagem supragengival remove tártaro acima da gengiva, enquanto a subgengival é feita abaixo", o objetivo de "remover tártaro e biofilme" está IMPLICITAMENTE associado também à subgengival pela estrutura paralela da frase. Não penalize o aluno por síntese linguística correta. Se o sentido geral foi respondido de forma lógica, dê nota máxima.
3. ERROS DE DIGITAÇÃO/FONÉTICA: Ignore totalmente pequenos deslizes de grafia ou fonética causados por transcrição de voz automática.
4. RIGOR JUSTO: Só retire pontos se houver erro conceitual real, omissão de informações técnicas críticas que mudariam o diagnóstico/conduta clínica, ou se a resposta for incompleta de fato.
5. EXCELÊNCIA (NOTA 10): Se o aluno cobriu todos os pontos do gabarito de forma clara e coesa (mesmo que resumida), atribua nota 10.0. No campo 'erros_ou_faltas', diga apenas "Excelente! Resposta conceitualmente completa e correta."

Você DEVE retornar a sua resposta estritamente no formato JSON abaixo, sem qualquer texto adicional antes ou depois do JSON. Não use blocos de código markdown (como \`\`\`json). Apenas envie o JSON cru estruturado exatamente assim:
{
  "nota": 10.0,
  "acertos": "Descreva o que o aluno acertou, destacando o domínio conceitual dele.",
  "erros_ou_faltas": "Descreva de forma construtiva o que faltou ou o que ele errou. Se a nota for 10.0, escreva apenas 'Nenhum erro ou omissão detectada.'"
}`;

        const promptUsuario = `Pergunta da Prova: ${pergunta}
Resposta Espelho (Gabarito): ${respostaEspelho}
Resposta do Aluno: ${respostaAluno}`;

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
                temperature: 0.1, // Reduzido um pouco mais para garantir ainda mais consistência
                response_format: { type: "json_object" } 
            })
        });

        if (!requisicao.ok) throw new Error("Erro de comunicação com a IA de correção.");

        const resultadoIA = await requisicao.json();
        const dadosCorrecao = JSON.parse(resultadoIA.choices[0].message.content);

        // Preenche o HTML com o resultado
        resultadoNota.innerText = Number(dadosCorrecao.nota).toFixed(1);
        resultadoAcertos.innerText = dadosCorrecao.acertos;
        resultadoErros.innerText = dadosCorrecao.erros_ou_faltas;

        // Exibe o painel de correção
        resultadoContainer.classList.remove('hidden');
        resultadoContainer.scrollIntoView({ behavior: 'smooth' });

    } catch (erro) {
        console.error("Erro na correção:", erro);
        alert("Ocorreu um problema ao tentar corrigir com a IA. Tente novamente.");
    } finally {
        btnEnviar.disabled = false;
        btnEnviar.innerText = "Enviar para Correção com IA";
    }
});