const { db, getSetting } = require('./db');

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
    // Safe delay between requests: 2.5 seconds (ensures well below 15 RPM limit)
    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  isProcessingQueue = false;
}

/**
 * Grade an exam using AI or heuristic fallback
 */
async function gradeExam(examId) {
  // Update status to grading
  db.prepare("UPDATE student_exams SET status = 'grading' WHERE id = ?").run(examId);

  // Fetch answers and questions
  const answers = db.prepare(`
    SELECT 
      ea.id as answer_id,
      ea.question_id,
      ea.order_num,
      ea.student_answer,
      q.question,
      q.expected_answer
    FROM exam_answers ea
    JOIN questions q ON q.id = ea.question_id
    WHERE ea.exam_id = ?
    ORDER BY ea.order_num ASC
  `).all(examId);

  if (!answers || answers.length === 0) return;

  const geminiApiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY || '';
  const groqApiKey = getSetting('groq_api_key') || process.env.GROQ_API_KEY || '';

  let gradingResults = null;

  if (geminiApiKey) {
    try {
      gradingResults = await gradeWithGemini(answers, geminiApiKey);
    } catch (err) {
      console.warn('[AI] Gemini falhou, tentando fallback:', err.message);
    }
  }

  if (!gradingResults && groqApiKey) {
    try {
      gradingResults = await gradeWithGroq(answers, groqApiKey);
    } catch (err) {
      console.warn('[AI] Groq falhou, tentando fallback heurístico:', err.message);
    }
  }

  // Fallback if no API key or network error
  if (!gradingResults) {
    console.log('[AI] Aplicando avaliação de referência offline...');
    gradingResults = gradeWithHeuristic(answers);
  }

  // Update DB with results
  const updateAnswerStmt = db.prepare(`
    UPDATE exam_answers 
    SET ai_score = ?, ai_feedback = ?, final_score = COALESCE(teacher_score, ?), teacher_feedback = COALESCE(teacher_feedback, ?)
    WHERE id = ?
  `);

  let totalScore = 0;
  for (const res of gradingResults) {
    const scoreVal = Math.min(10, Math.max(0, parseFloat(res.score) || 0));
    totalScore += scoreVal;
    updateAnswerStmt.run(scoreVal, res.feedback, scoreVal, res.feedback, res.answerId);
  }

  const averageScore = Math.round((totalScore / answers.length) * 10) / 10;

  db.prepare(`
    UPDATE student_exams 
    SET status = 'graded', total_score = ?, graded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(averageScore, examId);
}

/**
 * Grade all 5 questions in a single request with Google Gemini API
 */
async function gradeWithGemini(answers, apiKey) {
  const preferredModel = getSetting('ai_model') || 'gemini-3.8-flash';
  const candidateModels = [preferredModel, 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'].filter((v, i, a) => a.indexOf(v) === i);

  const prompt = buildEvaluationPrompt(answers);

  let lastError = null;

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

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status} (${model}): ${errText}`);
      }

      const data = await response.json();
      const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOutput) throw new Error('Resposta vazia da API Gemini');

      // Remember working model
      setSetting('ai_model', model);
      return parseGradingResponse(textOutput, answers);
    } catch (err) {
      lastError = err;
      console.warn(`[AI] Tentativa com modelo ${model} falhou:`, err.message);
    }
  }

  throw lastError || new Error('Nenhum modelo Gemini respondeu com sucesso');
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
async function transcribeAudio(base64Data, mimeType = 'audio/webm') {
  const geminiApiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY || '';
  const groqApiKey = getSetting('groq_api_key') || process.env.GROQ_API_KEY || '';

  let cleanMime = (mimeType || 'audio/webm').split(';')[0].trim();
  if (!cleanMime) cleanMime = 'audio/webm';

  if (geminiApiKey) {
    const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: cleanMime,
                      data: base64Data
                    }
                  },
                  {
                    text: 'Você é um assistente de transcrição de áudio para alunos de odontologia. Transcreva com fidelidade absoluta tudo o que a pessoa falou neste áudio em português do Brasil. Retorne APENAS o texto falado transcrito, sem introdução, sem aspas e sem comentários.'
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
          if (text && text.trim()) return text.trim();
        } else {
          const err = await res.text();
          console.warn(`[Transcription] Falha no Gemini (${model}):`, err);
        }
      } catch (e) {
        console.warn(`[Transcription] Erro no modelo ${model}:`, e.message);
      }
    }
  }

  if (groqApiKey) {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const formData = new FormData();
      const blob = new Blob([buffer], { type: cleanMime });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'pt');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text) return data.text.trim();
      }
    } catch (e) {
      console.warn('[Transcription] Falha no Groq Whisper:', e.message);
    }
  }

  return '';
}

module.exports = {
  enqueueExamGrading,
  gradeExam,
  testAIConnection,
  transcribeAudio
};

