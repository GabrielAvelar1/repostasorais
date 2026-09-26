const dbService = require('./dbService');

// In-memory queue to process exam grading safely within free-tier rate limits
const gradingQueue = [];
let isProcessingQueue = false;

/**
 * Enqueue an exam for AI grading
 */
function enqueueExamGrading(examId) {
  if (!gradingQueue.includes(examId)) {
    gradingQueue.push(examId);
    processQueue();
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (gradingQueue.length > 0) {
    const examId = gradingQueue.shift();
    try {
      console.log(`[AI Grading] Iniciando correção para Exame ID ${examId}...`);
      await gradeExam(examId);
      console.log(`[AI Grading] Exame ID ${examId} corrigido com sucesso.`);
    } catch (err) {
      console.error(`[AI Grading] Erro ao corrigir Exame ID ${examId}:`, err);
    }
    // Safe delay between requests: 800ms
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  isProcessingQueue = false;
}

/**
 * Get configured Gemini API keys (Free first, then Paid)
 */
function getGeminiApiKeys() {
  const keys = [];

  // Free keys (Key 1, Key 2, or comma-separated list)
  const free1 = process.env.FREE_GEMINI_API_KEY || '';
  const free2 = process.env.FREE_GEMINI_API_KEY_2 || '';
  const freeExtra = process.env.FREE_GEMINI_API_KEYS ? process.env.FREE_GEMINI_API_KEYS.split(',') : [];

  const freeList = [free1, free2, ...freeExtra]
    .map(k => k.trim())
    .filter(Boolean);

  const uniqueFree = [...new Set(freeList)];
  uniqueFree.forEach((k, idx) => {
    keys.push({ type: `Gratuito #${idx + 1}`, key: k });
  });

  // Paid keys
  const paid1 = process.env.PAID_GEMINI_API_KEY || '';
  const paid2 = process.env.PAID_GEMINI_API_KEY_2 || '';
  const paidExtra = process.env.PAID_GEMINI_API_KEYS ? process.env.PAID_GEMINI_API_KEYS.split(',') : [];

  const paidList = [paid1, paid2, ...paidExtra]
    .map(k => k.trim())
    .filter(Boolean);

  const uniquePaid = [...new Set(paidList)];
  uniquePaid.forEach((k, idx) => {
    keys.push({ type: `Pago #${idx + 1}`, key: k });
  });

  return keys;
}

/**
 * Execute Gemini call with fallback from free key to paid key
 */
async function callGeminiWithFallback(fn) {
  const keys = getGeminiApiKeys();
  let lastError = null;

  for (const item of keys) {
    try {
      console.log(`[AI] Executando com plano ${item.type}...`);
      const result = await fn(item.key);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[AI] Falha no plano ${item.type}:`, err.message);
    }
  }

  throw lastError || new Error('Nenhuma chave Gemini configurada');
}

/**
 * Grade an exam using AI or heuristic fallback
 */
async function gradeExam(examId) {
  try {
    const answers = await dbService.getExamAnswers(examId);
    if (!answers || answers.length === 0) return;

    let gradingResults = null;

    try {
      gradingResults = await callGeminiWithFallback((key) => gradeWithGemini(answers, key));
    } catch (err) {
      console.warn('[AI] Gemini falhou em todos os planos, aplicando fallback offline:', err.message);
    }

    if (!gradingResults) {
      gradingResults = gradeWithHeuristic(answers);
    }

    await dbService.updateGradingResults(examId, gradingResults);
  } catch (err) {
    console.error(`[AI] Erro no processamento do exame ${examId}:`, err.message);
  }
}

/**
 * Grade all 5 questions in a single request with Google Gemini API
 */
async function gradeWithGemini(answers, apiKey) {
  const candidateModels = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
  const prompt = buildEvaluationPrompt(answers);
  let lastErr = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textOutput) {
          return parseGradingResponse(textOutput, answers);
        }
      } else {
        const errText = await response.text();
        lastErr = new Error(`Gemini ${model} error ${response.status}: ${errText.substring(0, 120)}`);
        // If quota exceeded or service unavailable, immediately switch to next key
        if (response.status === 429 || response.status === 503) {
          throw lastErr;
        }
      }
    } catch (mErr) {
      lastErr = mErr;
      if (mErr.message.includes('429') || mErr.message.includes('503')) {
        throw mErr;
      }
    }
  }

  throw lastErr || new Error('Nenhum modelo Gemini respondeu para correção.');
}

/**
 * Grade with Groq API
 */
async function gradeWithGroq(answers, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const prompt = buildEvaluationPrompt(answers);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Você é um professor avaliador de odontologia especialista e rigoroso. Sempre responda estritamente em formato JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const textOutput = data.choices?.[0]?.message?.content;
  return parseGradingResponse(textOutput, answers);
}

/**
 * Build consolidated evaluation prompt
 */
function buildEvaluationPrompt(answers) {
  const questionsData = answers.map((a, i) => ({
    itemIndex: i + 1,
    answerId: a.answer_id,
    question: a.question,
    expectedAnswer: a.expected_answer,
    studentAnswer: a.student_answer?.trim() || '[O aluno não respondeu ou áudio em branco]'
  }));

  return `
Você é a inteligência artificial assistente da Professora Patricia na avaliação de Prova Oral de Odontopediatria.
Avalie com critério pedagógico cada uma das respostas dos alunos comparando-a com a "Resposta Esperada".
Atenção: A resposta do aluno foi obtida por transcrição de voz (áudio), portanto pequenos desvios de pontuação ou fonética devem ser compreendidos se o conceito odontológico estiver correto.

Para cada questão, atribua:
1. "score": nota numérica de 0.0 a 10.0 (sendo 10.0 resposta completa com todos os conceitos-chave, notas intermediárias proporcionais ao que foi explicado, e 0.0 se não respondeu ou errou completamente).
2. "feedback": justificativa clara e amigável em português explicando os acertos e o que faltou mencionar em relação à resposta esperada.

Dados das questões:
${JSON.stringify(questionsData, null, 2)}

RESPONDA EXCLUSIVAMENTE COM UM JSON NO SEGUINTE FORMATO:
{
  "evaluations": [
    {
      "answerId": número_do_answerId,
      "score": 8.5,
      "feedback": "O aluno explicou corretamente os pontos A e B, mas faltou citar o ponto C."
    }
  ]
}
`.trim();
}

/**
 * Parse grading JSON output
 */
function parseGradingResponse(rawText, answers) {
  let cleaned = rawText.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

  const parsed = JSON.parse(cleaned);
  const items = Array.isArray(parsed) ? parsed : (parsed.evaluations || parsed.results || []);

  const results = [];
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    const match = items.find(it => it.answerId === a.answer_id) || items[i];
    if (match) {
      results.push({
        answerId: a.answer_id,
        score: typeof match.score === 'number' ? match.score : parseFloat(match.score) || 0,
        feedback: match.feedback || 'Resposta avaliada com sucesso.'
      });
    } else {
      results.push({
        answerId: a.answer_id,
        score: 5.0,
        feedback: 'Avaliação processada.'
      });
    }
  }
  return results;
}

/**
 * Heuristic fallback evaluation when no AI key is configured
 * Compares keywords and length semantically
 */
function gradeWithHeuristic(answers) {
  return answers.map(a => {
    const student = (a.student_answer || '').toLowerCase().trim();
    const expected = (a.expected_answer || '').toLowerCase();

    if (!student || student.length < 5) {
      return {
        answerId: a.answer_id,
        score: 0.0,
        feedback: 'Questão não respondida ou resposta insuficiente.'
      };
    }

    // Extract significant terms from expected answer
    const words = expected.replace(/[^\w\sà-ú]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['sobre', 'entre', 'quando', 'como', 'para', 'estão', 'sendo', 'pode'].includes(w));
    
    const uniqueWords = [...new Set(words)];
    let matchCount = 0;

    for (const w of uniqueWords) {
      if (student.includes(w)) {
        matchCount++;
      }
    }

    const ratio = uniqueWords.length > 0 ? matchCount / uniqueWords.length : 0.5;
    // Scale to 0-10 with generous baseline for effort
    let score = Math.round((ratio * 8 + (student.length > 60 ? 2 : 1)) * 10) / 10;
    score = Math.min(10.0, Math.max(0.0, score));

    return {
      answerId: a.answer_id,
      score: score,
      feedback: `Resposta avaliada pelo sistema (${matchCount} conceitos-chave identificados). A professora Patricia pode ajustar esta nota.`
    };
  });
}

/**
 * Test AI Connection
 */
async function testAIConnection(apiKey, provider = 'gemini') {
  if (provider === 'gemini') {
    const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;

    for (const m of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responda apenas com a palavra: Conectado' }] }]
          })
        });
        if (res.ok) {
          const data = await res.json();
          setSetting('ai_model', m);
          return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Conexão OK!';
        } else {
          lastErr = await res.text();
        }
      } catch (err) {
        lastErr = err.message;
      }
    }
    throw new Error(`Falha na conexão Gemini: ${lastErr}`);
  } else {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Responda apenas: Conectado' }]
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Falha na conexão Groq (${res.status}): ${err}`);
    }
    return 'Conexão Groq OK!';
  }
}

/**
 * Transcribe Audio using Gemini Multimodal or Groq Whisper
 */
/**
 * Transcribe Audio using Gemini Multimodal (with Model Fallback & Free -> Paid key fallback)
 */
async function transcribeAudio(base64Data, mimeType = 'audio/webm') {
  let cleanMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!cleanMime || cleanMime === 'audio/x-m4a' || cleanMime === 'audio/m4a') {
    cleanMime = 'audio/mp4';
  }
  const validMimes = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/aac', 'audio/flac', 'audio/mpeg'];
  if (!validMimes.includes(cleanMime)) {
    cleanMime = 'audio/webm';
  }

  // Tested candidate models supporting audio multimodal inputs
  const candidateModels = [
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-2.5-flash'
  ];

  try {
    return await callGeminiWithFallback(async (apiKey) => {
      let lastErr = null;

      for (const model of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inlineData: {
                        mimeType: cleanMime,
                        data: base64Data
                      }
                    },
                    {
                      text: 'Você é um assistente especialista de transcrição para alunos de odontologia. Transcreva fielmente as palavras faladas no áudio em português do Brasil. Retorne estritamente o texto falado, sem aspas, sem introduções e sem explicações.'
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.1
              }
            })
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim()) {
              console.log(`[Transcription] Sucesso com modelo ${model}: "${text.trim().substring(0, 40)}..."`);
              return text.trim();
            }
          } else {
            const errText = await res.text();
            console.warn(`[Transcription] Modelo ${model} falhou com status ${res.status}: ${errText.substring(0, 100)}`);
            lastErr = new Error(`Model ${model} status ${res.status}`);
          }
        } catch (mErr) {
          console.warn(`[Transcription] Exceção com modelo ${model}:`, mErr.message);
          lastErr = mErr;
        }
      }

      throw lastErr || new Error('Nenhum modelo Gemini conseguiu transcrever o áudio');
    });
  } catch (err) {
    console.warn('[Transcription] Falha geral na transcrição:', err.message);
    return '';
  }
}

module.exports = {
  enqueueExamGrading,
  gradeExam,
  testAIConnection,
  transcribeAudio
};

