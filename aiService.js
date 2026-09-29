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

// In-memory key cooldown tracker to prevent wasting time on 429 exhausted keys
const keyCooldowns = new Map();

function isKeyCoolingDown(key) {
  const until = keyCooldowns.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    keyCooldowns.delete(key);
    return false;
  }
  return true;
}

function markKeyExhausted(key, durationMs = 60000) {
  keyCooldowns.set(key, Date.now() + durationMs);
}

/**
 * Get configured Gemini API keys (Free first, then Paid)
 */
function getGeminiApiKeys() {
  const allKeys = [];

  // Free keys (Key 1, Key 2, Key 3, Key 4, Key 5, GEMINI_API_KEY, or comma-separated list)
  const free1 = process.env.FREE_GEMINI_API_KEY || '';
  const free2 = process.env.FREE_GEMINI_API_KEY_2 || '';
  const free3 = process.env.FREE_GEMINI_API_KEY_3 || '';
  const free4 = process.env.FREE_GEMINI_API_KEY_4 || '';
  const free5 = process.env.FREE_GEMINI_API_KEY_5 || '';
  const geminiDefault = process.env.GEMINI_API_KEY || '';
  const freeExtra = process.env.FREE_GEMINI_API_KEYS ? process.env.FREE_GEMINI_API_KEYS.split(',') : [];

  const freeList = [free1, free2, free3, free4, free5, geminiDefault, ...freeExtra]
    .map(k => k.trim())
    .filter(Boolean);

  const uniqueFree = [...new Set(freeList)];
  uniqueFree.forEach((k, idx) => {
    allKeys.push({ type: `Gratuito #${idx + 1}`, key: k });
  });

  // Paid keys
  const paid1 = process.env.PAID_GEMINI_API_KEY || '';
  const paid2 = process.env.PAID_GEMINI_API_KEY_2 || '';
  const paid3 = process.env.PAID_GEMINI_API_KEY_3 || '';
  const paidExtra = process.env.PAID_GEMINI_API_KEYS ? process.env.PAID_GEMINI_API_KEYS.split(',') : [];

  const paidList = [paid1, paid2, paid3, ...paidExtra]
    .map(k => k.trim())
    .filter(Boolean);

  const uniquePaid = [...new Set(paidList)];
  uniquePaid.forEach((k, idx) => {
    allKeys.push({ type: `Pago #${idx + 1}`, key: k });
  });

  // Prioritize keys that are not cooling down
  const activeKeys = allKeys.filter(k => !isKeyCoolingDown(k.key));
  if (activeKeys.length > 0) {
    return activeKeys;
  }

  // If all keys are marked cooling down, reset cooldowns and retry all
  keyCooldowns.clear();
  return allKeys;
}

let currentKeyIndex = 0;

/**
 * Execute Gemini call with fallback from free key to paid key
 */
async function callGeminiWithFallback(fn) {
  const keys = getGeminiApiKeys();
  if (!keys || keys.length === 0) {
    throw new Error('Nenhuma chave Gemini configurada');
  }

  let lastError = null;
  const startIndex = currentKeyIndex % keys.length;

  for (let i = 0; i < keys.length; i++) {
    const idx = (startIndex + i) % keys.length;
    const item = keys[idx];
    try {
      console.log(`[AI] Executando com plano ${item.type}...`);
      const result = await fn(item.key);
      // Remember this working key for subsequent requests so they are fast
      currentKeyIndex = idx;
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
  const candidateModels = [
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.8-flash'
  ];
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
        }),
        signal: AbortSignal.timeout(12000)
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
        // If quota exceeded, mark key exhausted and immediately switch to next key
        if (response.status === 429) {
          markKeyExhausted(apiKey);
          throw lastErr;
        }
      }
    } catch (mErr) {
      lastErr = mErr;
      if (mErr.message && (mErr.message.includes('429') || mErr.message.includes('quota'))) {
        markKeyExhausted(apiKey);
        throw mErr;
      }
    }
  }

  throw lastErr || new Error('Nenhum modelo Gemini respondeu para correção.');
}

/**
 * Grade with Groq API
 */
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
        { role: 'system', content: 'Você é a IA assistente pedagógica da Professora Patricia na avaliação de Prova Oral de Odontopediatria. Seja benevolente, valorize o aprendizado oral do aluno e responda estritamente em JSON.' },
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
 * Build consolidated evaluation prompt (Scale 0.0 to 5.0, benevolent rubric)
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
Você é a inteligência artificial assistente pedagógica da Professora Patricia na avaliação da Prova Oral de Odontopediatria da Faculdade Arnaldo.

DIRETRIZES DE AVALIAÇÃO OBRIGATÓRIAS (SEJA BENEVALENTE E VALORIZE O CONHECIMENTO):
1. A resposta do aluno foi gravada por voz e transcrita por IA. Desconsidere hesitações, pausas, vícios de fala e pequenas variações de vocabulário ou pontuação.
2. A escala de notas é de 0.0 a 5.0 (NOTA MÁXIMA É 5.0).
3. SE O ALUNO FALOU OU ABORDOU OS PRINCIPAIS PONTOS E CONCEITOS CENTRAIS DA "Resposta Esperada", ATRIBUA A NOTA MÁXIMA (5.0) OU MUITO PRÓXIMA DISSO (4.5 a 5.0), mesmo que com suas próprias palavras e sem formalismos excessivos.
4. Se o aluno explicou de forma correta e suficiente boa parte do conteúdo, atribua notas altas (entre 3.5 e 4.5).
5. Apenas desconte pontos caso haja erro conceitual grave, ou se faltou algum aspecto crucial. Se o aluno não souber ou a resposta for vaga, atribua proporcionalmente (1.5 a 3.0).
6. Se o aluno não respondeu ou falou algo totalmente desconexo do tema, atribua 0.0.
7. O "feedback" deve ser encorajador, cordial e direto em português, ressaltando os acertos e indicando com gentileza caso algo possa ser complementado.

Dados das questões:
${JSON.stringify(questionsData, null, 2)}

RESPONDA EXCLUSIVAMENTE COM UM JSON NO SEGUINTE FORMATO:
{
  "evaluations": [
    {
      "answerId": número_do_answerId,
      "score": 5.0,
      "feedback": "Excelente resposta! O aluno explicou com precisão os conceitos clínicos essenciais da questão."
    }
  ]
}
`.trim();
}

/**
 * Parse grading JSON output (Cap at 5.0)
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
      let rawScore = typeof match.score === 'number' ? match.score : parseFloat(match.score) || 0;
      // If AI mistakenly returned out of 10, scale to 5
      if (rawScore > 5.0 && rawScore <= 10.0) {
        rawScore = rawScore / 2;
      }
      const score = Math.min(5.0, Math.max(0.0, Math.round(rawScore * 10) / 10));

      results.push({
        answerId: a.answer_id,
        score: score,
        feedback: match.feedback || 'Resposta avaliada com sucesso.'
      });
    } else {
      results.push({
        answerId: a.answer_id,
        score: 3.5,
        feedback: 'Avaliação processada.'
      });
    }
  }
  return results;
}

/**
 * Heuristic fallback evaluation when no AI key is configured (Scale 0.0 to 5.0)
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

    const ratio = uniqueWords.length > 0 ? matchCount / uniqueWords.length : 0.6;
    // Scale to 0-5.0 with benevolent baseline: 2+ concepts gives 4.0+, 4+ concepts gives 5.0
    let score = ratio >= 0.4 ? (ratio >= 0.65 ? 5.0 : 4.5) : Math.round((ratio * 4 + 1.5) * 10) / 10;
    score = Math.min(5.0, Math.max(0.0, score));

    return {
      answerId: a.answer_id,
      score: score,
      feedback: `Resposta avaliada com sucesso (${matchCount} conceitos-chave identificados). A professora Patricia pode ajustar esta nota.`
    };
  });
}

/**
 * Test AI Connection
 */
async function testAIConnection(apiKey, provider = 'gemini') {
  if (provider === 'gemini') {
    const keyToUse = apiKey || (getGeminiApiKeys()[0]?.key);
    if (!keyToUse) {
      throw new Error('Nenhuma chave Gemini configurada no sistema.');
    }
    const candidateModels = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;

    for (const m of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${keyToUse}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responda apenas com a palavra: Conectado' }] }]
          })
        });
        if (res.ok) {
          const data = await res.json();
          try { await dbService.setSetting('ai_model', m); } catch (e) {}
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

  // Active models supporting audio multimodal inputs, ordered by speed and availability
  const candidateModels = [
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.7-flash'
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
                      text: 'Você é um assistente especialista de transcrição para alunos de odontologia da Faculdade Arnaldo. Transcreva com máxima precisão e fidelidade todas as palavras faladas no áudio em português do Brasil. Se o aluno falar termos técnicos odontológicos (como cárie, pulpectomia, decíduo, endodontia, restauração, resina, amálgama, cimento de ionômero de vidro, etc.), transcreva-os corretamente. Retorne estritamente o texto falado pelo aluno, sem adicionar aspas, sem introdução, sem explicações e sem saudações.'
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.1
              }
            }),
            signal: AbortSignal.timeout(5500)
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
            // If quota exceeded on this key, immediately throw to switch to the next key
            if (res.status === 429) {
              markKeyExhausted(apiKey);
              throw lastErr;
            }
          }
        } catch (mErr) {
          console.warn(`[Transcription] Exceção com modelo ${model}:`, mErr.message);
          lastErr = mErr;
          const isQuota = mErr.message && (mErr.message.includes('429') || mErr.message.includes('quota'));
          if (isQuota) {
            markKeyExhausted(apiKey, 45000);
            throw mErr;
          }
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
  transcribeAudio,
  getGeminiApiKeys
};

