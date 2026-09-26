require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');
const { enqueueExamGrading, gradeExam, testAIConnection, transcribeAudio } = require('./aiService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// AUTH
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  try {
    const { registration, fullName } = req.body;
    if (!registration || !fullName) {
      return res.status(400).json({ error: 'Matrícula e Nome Completo são obrigatórios.' });
    }

    const cleanReg = String(registration).trim();
    const cleanName = String(fullName).trim();

    // Teacher check
    if (cleanReg === '12345' || (cleanName.toLowerCase() === 'patricia' && cleanReg === '12345')) {
      let teacher = db.prepare("SELECT * FROM users WHERE registration = '12345'").get();
      if (!teacher) {
        db.prepare("INSERT INTO users (registration, full_name, role) VALUES ('12345', 'Patricia', 'teacher')").run();
        teacher = db.prepare("SELECT * FROM users WHERE registration = '12345'").get();
      }
      return res.json({
        success: true,
        user: {
          id: teacher.id,
          registration: teacher.registration,
          fullName: teacher.full_name,
          role: 'teacher'
        }
      });
    }

    // Student find or create
    let student = db.prepare('SELECT * FROM users WHERE registration = ?').get(cleanReg);
    if (!student) {
      const result = db.prepare('INSERT INTO users (registration, full_name, role) VALUES (?, ?, ?)').run(cleanReg, cleanName, 'student');
      student = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    } else {
      // Update name if changed
      if (student.full_name !== cleanName) {
        db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(cleanName, student.id);
        student.full_name = cleanName;
      }
    }

    return res.json({
      success: true,
      user: {
        id: student.id,
        registration: student.registration,
        fullName: student.full_name,
        role: student.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro ao autenticar usuário.' });
  }
});

// -------------------------------------------------------------
// EXAM STATUS
// -------------------------------------------------------------
app.get('/api/exam/status', (req, res) => {
  res.json({
    examOpen: getSetting('exam_open') === '1',
    gradesReleased: getSetting('grades_released') === '1',
    examTitle: getSetting('exam_title', 'Prova Oral de Odontopediatria')
  });
});

// -------------------------------------------------------------
// STUDENT EXAM (RANDOMIZE 5 QUESTIONS OR RESUME)
// -------------------------------------------------------------
app.get('/api/exam/my-exam', (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id'] || req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Usuário não identificado.' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const isExamOpen = getSetting('exam_open') === '1';

    let exam = db.prepare('SELECT * FROM student_exams WHERE user_id = ?').get(userId);

    // If student hasn't started yet and exam is closed, block
    if (!exam && !isExamOpen) {
      return res.status(403).json({
        locked: true,
        message: 'A prova ainda não foi liberada pela Professora Patricia.'
      });
    }

    // Create exam and pick 5 random questions if new
    if (!exam) {
      const examInsert = db.prepare("INSERT INTO student_exams (user_id, status) VALUES (?, 'draft')").run(userId);
      const examId = examInsert.lastInsertRowid;

      // Select 5 random questions
      const randomQuestions = db.prepare('SELECT id FROM questions ORDER BY RANDOM() LIMIT 5').all();
      const insertAnswer = db.prepare('INSERT INTO exam_answers (exam_id, question_id, order_num, student_answer) VALUES (?, ?, ?, ?)');

      randomQuestions.forEach((q, idx) => {
        insertAnswer.run(examId, q.id, idx + 1, '');
      });

      exam = db.prepare('SELECT * FROM student_exams WHERE id = ?').get(examId);
    }

    // Fetch questions and student's draft answers
    const answers = db.prepare(`
      SELECT 
        ea.id as answer_id,
        ea.order_num,
        ea.student_answer,
        q.id as question_id,
        q.question
      FROM exam_answers ea
      JOIN questions q ON q.id = ea.question_id
      WHERE ea.exam_id = ?
      ORDER BY ea.order_num ASC
    `).all(exam.id);

    res.json({
      exam: {
        id: exam.id,
        status: exam.status,
        submittedAt: exam.submitted_at,
        isExamOpen
      },
      questions: answers
    });
  } catch (err) {
    console.error('Error fetching exam:', err);
    res.status(500).json({ error: 'Erro ao carregar prova do aluno.' });
  }
});

// Audio transcription endpoint (for Brave, mobile and standard browsers)
app.post('/api/exam/transcribe-audio', async (req, res) => {
  try {
    const { audioData, mimeType } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: 'Nenhum dado de áudio recebido.' });
    }

    const cleanBase64 = audioData.replace(/^data:audio\/[a-z0-9.-]+;base64,/, '');
    const transcript = await transcribeAudio(cleanBase64, mimeType || 'audio/webm');

    res.json({
      success: true,
      transcript: transcript || ''
    });
  } catch (err) {
    console.error('Audio transcription error:', err);
    res.status(500).json({ error: 'Erro ao transcrever áudio com IA.' });
  }
});

// Save draft answers
app.post('/api/exam/save-draft', (req, res) => {
  try {
    const { examId, answers } = req.body;
    if (!examId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const exam = db.prepare('SELECT * FROM student_exams WHERE id = ?').get(examId);
    if (!exam) return res.status(404).json({ error: 'Exame não encontrado.' });
    if (exam.status !== 'draft') {
      return res.status(400).json({ error: 'Esta prova já foi enviada.' });
    }

    const updateStmt = db.prepare('UPDATE exam_answers SET student_answer = ? WHERE exam_id = ? AND question_id = ?');
    for (const item of answers) {
      updateStmt.run(item.studentAnswer || '', examId, item.questionId);
    }

    res.json({ success: true, message: 'Rascunho salvo.' });
  } catch (err) {
    console.error('Error saving draft:', err);
    res.status(500).json({ error: 'Erro ao salvar rascunho.' });
  }
});

// Final submit
app.post('/api/exam/submit', (req, res) => {
  try {
    const { examId, answers } = req.body;
    if (!examId) return res.status(400).json({ error: 'ID do exame obrigatório.' });

    const exam = db.prepare('SELECT * FROM student_exams WHERE id = ?').get(examId);
    if (!exam) return res.status(404).json({ error: 'Exame não encontrado.' });
    if (exam.status !== 'draft') {
      return res.status(400).json({ error: 'Esta prova já foi finalizada anteriormente.' });
    }

    if (answers && Array.isArray(answers)) {
      const updateStmt = db.prepare('UPDATE exam_answers SET student_answer = ? WHERE exam_id = ? AND question_id = ?');
      for (const item of answers) {
        updateStmt.run(item.studentAnswer || '', examId, item.questionId);
      }
    }

    db.prepare("UPDATE student_exams SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?").run(examId);

    // Enqueue for AI correction
    enqueueExamGrading(examId);

    res.json({
      success: true,
      message: 'Prova oral finalizada e enviada com sucesso!'
    });
  } catch (err) {
    console.error('Error submitting exam:', err);
    res.status(500).json({ error: 'Erro ao enviar a prova.' });
  }
});

// Get student's final result (only if released by teacher)
app.get('/api/exam/my-result', (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id'] || req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Usuário não identificado.' });

    const gradesReleased = getSetting('grades_released') === '1';

    const exam = db.prepare('SELECT * FROM student_exams WHERE user_id = ?').get(userId);
    if (!exam) return res.status(404).json({ error: 'Nenhuma prova encontrada para este aluno.' });

    if (exam.status === 'draft') {
      return res.json({ status: 'draft', message: 'Você ainda não finalizou sua prova.' });
    }

    if (!gradesReleased) {
      return res.json({
        status: exam.status,
        gradesReleased: false,
        submittedAt: exam.submitted_at,
        message: 'Sua prova foi enviada e está sendo revisada pela Professora Patricia. As notas serão liberadas para toda a turma em breve.'
      });
    }

    // Grades are released! Return full feedback
    const answers = db.prepare(`
      SELECT 
        ea.id as answer_id,
        ea.order_num,
        ea.student_answer,
        ea.final_score as score,
        COALESCE(ea.teacher_feedback, ea.ai_feedback) as feedback,
        q.question,
        q.expected_answer
      FROM exam_answers ea
      JOIN questions q ON q.id = ea.question_id
      WHERE ea.exam_id = ?
      ORDER BY ea.order_num ASC
    `).all(exam.id);

    res.json({
      status: exam.status,
      gradesReleased: true,
      totalScore: exam.total_score,
      submittedAt: exam.submitted_at,
      gradedAt: exam.graded_at,
      questions: answers
    });
  } catch (err) {
    console.error('Error fetching result:', err);
    res.status(500).json({ error: 'Erro ao buscar resultados.' });
  }
});

// -------------------------------------------------------------
// TEACHER (ADMIN) APIS
// -------------------------------------------------------------
// Middleware to verify teacher
function requireTeacher(req, res, next) {
  const role = req.headers['x-user-role'];
  const reg = req.headers['x-user-reg'];
  if (role === 'teacher' || reg === '12345') {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito à Professora Patricia.' });
}

// Toggle exam open/closed
app.post('/api/admin/toggle-exam', requireTeacher, (req, res) => {
  const current = getSetting('exam_open') === '1';
  const nextVal = current ? '0' : '1';
  setSetting('exam_open', nextVal);
  res.json({ examOpen: nextVal === '1' });
});

// Toggle grades released
app.post('/api/admin/toggle-grades', requireTeacher, (req, res) => {
  const current = getSetting('grades_released') === '1';
  const nextVal = current ? '0' : '1';
  setSetting('grades_released', nextVal);
  res.json({ gradesReleased: nextVal === '1' });
});

// Dashboard stats
app.get('/api/admin/dashboard', requireTeacher, (req, res) => {
  try {
    const totalStudents = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student'").get().c;
    const totalSubmitted = db.prepare("SELECT COUNT(*) as c FROM student_exams WHERE status IN ('submitted', 'grading', 'graded')").get().c;
    const totalGraded = db.prepare("SELECT COUNT(*) as c FROM student_exams WHERE status = 'graded'").get().c;
    const avgScore = db.prepare("SELECT AVG(total_score) as avg FROM student_exams WHERE status = 'graded'").get().avg;

    res.json({
      examOpen: getSetting('exam_open') === '1',
      gradesReleased: getSetting('grades_released') === '1',
      stats: {
        totalStudents,
        totalSubmitted,
        totalGraded,
        averageScore: avgScore ? Math.round(avgScore * 10) / 10 : 0
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Erro ao carregar estatísticas.' });
  }
});

// List all students and exam statuses
app.get('/api/admin/students', requireTeacher, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT 
        u.id as user_id,
        u.registration,
        u.full_name,
        u.created_at,
        se.id as exam_id,
        se.status as exam_status,
        se.total_score,
        se.submitted_at,
        se.graded_at
      FROM users u
      LEFT JOIN student_exams se ON se.user_id = u.id
      WHERE u.role = 'student'
      ORDER BY u.full_name ASC
    `).all();

    res.json(list);
  } catch (err) {
    console.error('Error fetching students list:', err);
    res.status(500).json({ error: 'Erro ao listar alunos.' });
  }
});

// Get single exam details for review
app.get('/api/admin/exam/:id', requireTeacher, (req, res) => {
  try {
    const examId = parseInt(req.params.id);
    const exam = db.prepare(`
      SELECT 
        se.*,
        u.full_name,
        u.registration
      FROM student_exams se
      JOIN users u ON u.id = se.user_id
      WHERE se.id = ?
    `).get(examId);

    if (!exam) return res.status(404).json({ error: 'Exame não encontrado.' });

    const answers = db.prepare(`
      SELECT 
        ea.id as answer_id,
        ea.order_num,
        ea.student_answer,
        ea.ai_score,
        ea.ai_feedback,
        ea.teacher_score,
        ea.teacher_feedback,
        ea.final_score,
        q.question,
        q.expected_answer
      FROM exam_answers ea
      JOIN questions q ON q.id = ea.question_id
      WHERE ea.exam_id = ?
      ORDER BY ea.order_num ASC
    `).all(examId);

    res.json({
      exam,
      answers
    });
  } catch (err) {
    console.error('Error fetching exam detail:', err);
    res.status(500).json({ error: 'Erro ao carregar detalhes do exame.' });
  }
});

// Update teacher manual score/feedback for an answer
app.post('/api/admin/grade-answer', requireTeacher, (req, res) => {
  try {
    const { answerId, teacherScore, teacherFeedback } = req.body;
    if (!answerId) return res.status(400).json({ error: 'ID da resposta obrigatório.' });

    const scoreNum = Math.min(10, Math.max(0, parseFloat(teacherScore) || 0));

    db.prepare(`
      UPDATE exam_answers 
      SET teacher_score = ?, teacher_feedback = ?, final_score = ?
      WHERE id = ?
    `).run(scoreNum, teacherFeedback || '', scoreNum, answerId);

    // Recalculate exam total score
    const answer = db.prepare('SELECT exam_id FROM exam_answers WHERE id = ?').get(answerId);
    if (answer) {
      const avg = db.prepare('SELECT AVG(final_score) as avg FROM exam_answers WHERE exam_id = ?').get(answer.exam_id).avg;
      const roundedAvg = Math.round((avg || 0) * 10) / 10;
      db.prepare('UPDATE student_exams SET total_score = ?, status = ? WHERE id = ?').run(roundedAvg, 'graded', answer.exam_id);
    }

    res.json({ success: true, message: 'Nota atualizada com sucesso!' });
  } catch (err) {
    console.error('Error grading answer:', err);
    res.status(500).json({ error: 'Erro ao salvar nota da professora.' });
  }
});

// Trigger re-grade with AI
app.post('/api/admin/regrade-exam/:id', requireTeacher, (req, res) => {
  try {
    const examId = parseInt(req.params.id);
    enqueueExamGrading(examId);
    res.json({ success: true, message: 'Exame colocado na fila de correção da IA.' });
  } catch (err) {
    console.error('Error regrading:', err);
    res.status(500).json({ error: 'Erro ao reavaliar exame.' });
  }
});

// Settings & API Keys
app.get('/api/admin/settings', requireTeacher, (req, res) => {
  const gemini = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY || '';
  const groq = getSetting('groq_api_key') || process.env.GROQ_API_KEY || '';
  res.json({
    geminiKeyConfigured: !!gemini,
    geminiKeyMasked: gemini ? gemini.substring(0, 4) + '...' + gemini.substring(gemini.length - 4) : '',
    groqKeyConfigured: !!groq,
    groqKeyMasked: groq ? groq.substring(0, 4) + '...' + groq.substring(groq.length - 4) : '',
    aiModel: getSetting('ai_model', 'gemini-1.5-flash'),
    examTitle: getSetting('exam_title', 'Prova Oral de Odontopediatria')
  });
});

app.post('/api/admin/settings', requireTeacher, (req, res) => {
  try {
    const { geminiApiKey, groqApiKey, aiModel, examTitle } = req.body;
    if (geminiApiKey !== undefined && geminiApiKey !== '') setSetting('gemini_api_key', geminiApiKey.trim());
    if (groqApiKey !== undefined && groqApiKey !== '') setSetting('groq_api_key', groqApiKey.trim());
    if (aiModel) setSetting('ai_model', aiModel);
    if (examTitle) setSetting('exam_title', examTitle);
    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

// Test AI Connection
app.post('/api/admin/test-ai', requireTeacher, async (req, res) => {
  try {
    const { provider, apiKey } = req.body;
    const keyToUse = apiKey || getSetting(provider === 'groq' ? 'groq_api_key' : 'gemini_api_key') || (provider === 'groq' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY);
    if (!keyToUse) return res.status(400).json({ error: 'Nenhuma chave informada para teste.' });

    const reply = await testAIConnection(keyToUse, provider || 'gemini');
    res.json({ success: true, reply });
  } catch (err) {
    console.error('Test AI error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Export CSV for Grades
app.get('/api/admin/export-csv', requireTeacher, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT 
        u.registration,
        u.full_name,
        se.status,
        se.total_score,
        se.submitted_at
      FROM users u
      LEFT JOIN student_exams se ON se.user_id = u.id
      WHERE u.role = 'student'
      ORDER BY u.full_name ASC
    `).all();

    let csv = 'Matricula,Nome Completo,Status da Prova,Nota Final,Data de Envio\n';
    for (const r of list) {
      const nota = r.total_score !== null && r.total_score !== undefined ? String(r.total_score).replace('.', ',') : '-';
      const statusMap = {
        'draft': 'Em andamento',
        'submitted': 'Enviada',
        'grading': 'Corrigindo',
        'graded': 'Corrigida'
      };
      const statusStr = statusMap[r.status] || 'Não iniciou';
      const dataStr = r.submitted_at ? new Date(r.submitted_at).toLocaleString('pt-BR') : '-';
      csv += `"${r.registration}","${r.full_name}","${statusStr}","${nota}","${dataStr}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="notas_prova_oral_patricia.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Erro ao gerar relatório CSV.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Sistema de Prova Oral ativo em: http://localhost:${PORT}`);
  console.log(`👩‍🏫 Painel da Professora: Patricia | Matrícula: 12345`);
  console.log(`=======================================================`);
});
