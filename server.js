require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dbService = require('./dbService');
const { enqueueExamGrading, transcribeAudio } = require('./aiService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Netlify Functions URL rewrite middleware
app.use((req, res, next) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace('/.netlify/functions/api', '') || '/';
    if (!req.url.startsWith('/api')) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

// -------------------------------------------------------------
// AUTH (FIND OR CREATE STUDENT / TEACHER CHECK)
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { registration, fullName } = req.body;
    if (!registration || !fullName) {
      return res.status(400).json({ error: 'Matrícula e Nome Completo são obrigatórios.' });
    }

    const cleanReg = String(registration).trim();
    const cleanName = String(fullName).trim();

    // Teacher check
    if (cleanReg === '12345' || (cleanName.toLowerCase() === 'patricia' && cleanReg === '12345')) {
      const teacher = await dbService.findOrCreateUser('12345', 'Patricia', 'teacher');
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
    const student = await dbService.findOrCreateUser(cleanReg, cleanName, 'student');

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
    res.status(500).json({ error: 'Erro ao autenticar no banco de dados Supabase.' });
  }
});

// -------------------------------------------------------------
// EXAM STATUS
// -------------------------------------------------------------
app.get('/api/exam/status', async (req, res) => {
  try {
    const examOpen = (await dbService.getSetting('exam_open')) === '1';
    const gradesReleased = (await dbService.getSetting('grades_released')) === '1';
    const examTitle = await dbService.getSetting('exam_title', 'Prova Oral de Odontopediatria');

    res.json({ examOpen, gradesReleased, examTitle });
  } catch (err) {
    res.json({ examOpen: false, gradesReleased: false, examTitle: 'Prova Oral' });
  }
});

// -------------------------------------------------------------
// STUDENT EXAM (RANDOMIZE 5 QUESTIONS OR RESUME)
// -------------------------------------------------------------
app.get('/api/exam/my-exam', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id'] || req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Usuário não identificado.' });

    const user = await dbService.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const isExamOpen = (await dbService.getSetting('exam_open')) === '1';

    let exam = await dbService.getStudentExam(userId);

    // If student hasn't started yet and exam is closed, block
    if (!exam && !isExamOpen) {
      return res.status(403).json({
        locked: true,
        message: 'A prova ainda não foi liberada pela Professora Patricia.'
      });
    }

    // Create exam with 5 random questions if new
    if (!exam) {
      exam = await dbService.createStudentExamWithRandomQuestions(userId);
    }

    // Fetch questions and student's draft answers
    const answers = await dbService.getExamAnswers(exam.id);

    res.json({
      exam: {
        id: exam.id,
        status: exam.status,
        submittedAt: exam.submitted_at,
        isExamOpen
      },
      questions: answers.map(a => ({
        answer_id: a.answer_id,
        order_num: a.order_num,
        student_answer: a.student_answer || '',
        question_id: a.question_id,
        question: a.question
      }))
    });
  } catch (err) {
    console.error('Error fetching exam:', err);
    res.status(500).json({ error: 'Erro ao carregar prova do aluno.' });
  }
});

// Audio transcription endpoint (AI powered - Gemini 3.8 Flash)
app.post('/api/exam/transcribe-audio', async (req, res) => {
  try {
    const { audioData, mimeType } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: 'Nenhum dado de áudio recebido.' });
    }

    let cleanBase64 = audioData;
    if (cleanBase64.includes(';base64,')) {
      cleanBase64 = cleanBase64.split(';base64,')[1];
    } else if (cleanBase64.startsWith('data:')) {
      cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(',') + 1);
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

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
app.post('/api/exam/save-draft', async (req, res) => {
  try {
    const { examId, answers } = req.body;
    if (!examId || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    await dbService.saveDraftAnswers(examId, answers);
    res.json({ success: true, message: 'Rascunho salvo.' });
  } catch (err) {
    console.error('Error saving draft:', err);
    res.status(500).json({ error: 'Erro ao salvar rascunho.' });
  }
});

// Final submit
app.post('/api/exam/submit', async (req, res) => {
  try {
    const { examId, answers } = req.body;
    if (!examId) return res.status(400).json({ error: 'ID do exame obrigatório.' });

    await dbService.submitExam(examId, answers);

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
app.get('/api/exam/my-result', async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id'] || req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Usuário não identificado.' });

    const gradesReleased = (await dbService.getSetting('grades_released')) === '1';

    const exam = await dbService.getStudentExam(userId);
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
    const answers = await dbService.getExamAnswers(exam.id);

    res.json({
      status: exam.status,
      gradesReleased: true,
      totalScore: exam.total_score,
      submittedAt: exam.submitted_at,
      gradedAt: exam.graded_at,
      questions: answers.map(a => ({
        answer_id: a.answer_id,
        order_num: a.order_num,
        student_answer: a.student_answer,
        score: a.final_score,
        feedback: a.teacher_feedback || a.ai_feedback || 'Avaliação concluída.',
        question: a.question,
        expected_answer: a.expected_answer
      }))
    });
  } catch (err) {
    console.error('Error fetching result:', err);
    res.status(500).json({ error: 'Erro ao buscar resultados.' });
  }
});

// -------------------------------------------------------------
// TEACHER (ADMIN) APIS
// -------------------------------------------------------------
function requireTeacher(req, res, next) {
  const role = req.headers['x-user-role'];
  const reg = req.headers['x-user-reg'];
  if (role === 'teacher' || reg === '12345') {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito à Professora Patricia.' });
}

// Toggle exam open/closed
app.post('/api/admin/toggle-exam', requireTeacher, async (req, res) => {
  const current = (await dbService.getSetting('exam_open')) === '1';
  const nextVal = current ? '0' : '1';
  await dbService.setSetting('exam_open', nextVal);
  res.json({ examOpen: nextVal === '1' });
});

// Toggle grades released
app.post('/api/admin/toggle-grades', requireTeacher, async (req, res) => {
  const current = (await dbService.getSetting('grades_released')) === '1';
  const nextVal = current ? '0' : '1';
  await dbService.setSetting('grades_released', nextVal);
  res.json({ gradesReleased: nextVal === '1' });
});

// Dashboard stats
app.get('/api/admin/dashboard', requireTeacher, async (req, res) => {
  try {
    const data = await dbService.getDashboardStats();
    res.json(data);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Erro ao carregar estatísticas.' });
  }
});

// List all students and exam statuses
app.get('/api/admin/students', requireTeacher, async (req, res) => {
  try {
    const list = await dbService.getStudentsList();
    res.json(list);
  } catch (err) {
    console.error('Error fetching students list:', err);
    res.status(500).json({ error: 'Erro ao listar alunos.' });
  }
});

// Get single exam details for review
app.get('/api/admin/exam/:id', requireTeacher, async (req, res) => {
  try {
    const examId = parseInt(req.params.id);
    const { data: exam, error } = await dbService.supabase
      .from('student_exams')
      .select('*, users(full_name, registration)')
      .eq('id', examId)
      .single();

    if (error || !exam) return res.status(404).json({ error: 'Exame não encontrado.' });

    const answers = await dbService.getExamAnswers(examId);

    res.json({
      exam: {
        id: exam.id,
        user_id: exam.user_id,
        status: exam.status,
        total_score: exam.total_score,
        submitted_at: exam.submitted_at,
        full_name: exam.users?.full_name,
        registration: exam.users?.registration
      },
      answers
    });
  } catch (err) {
    console.error('Error fetching exam detail:', err);
    res.status(500).json({ error: 'Erro ao carregar detalhes do exame.' });
  }
});

// Update teacher manual score/feedback for an answer
app.post('/api/admin/grade-answer', requireTeacher, async (req, res) => {
  try {
    const { answerId, teacherScore, teacherFeedback } = req.body;
    if (!answerId) return res.status(400).json({ error: 'ID da resposta obrigatório.' });

    await dbService.updateTeacherGrade(answerId, teacherScore, teacherFeedback);
    res.json({ success: true, message: 'Nota atualizada com sucesso no Supabase!' });
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

// Export CSV for Grades
app.get('/api/admin/export-csv', requireTeacher, async (req, res) => {
  try {
    const list = await dbService.getStudentsList();

    let csv = 'Matricula,Nome Completo,Status da Prova,Nota Final,Data de Envio\n';
    for (const r of list) {
      const nota = r.total_score !== null && r.total_score !== undefined ? String(r.total_score).replace('.', ',') : '-';
      const statusMap = {
        'draft': 'Em andamento',
        'submitted': 'Enviada',
        'grading': 'Corrigindo',
        'graded': 'Corrigida'
      };
      const statusStr = statusMap[r.exam_status] || 'Não iniciou';
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

// Start server if not running as serverless function
if (!process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Sistema de Prova Oral ativo em: http://localhost:${PORT}`);
    console.log(`⚡ Banco de Dados Conectado: SUPABASE`);
    console.log(`👩‍🏫 Painel da Professora: Patricia | Matrícula: 12345`);
    console.log(`🤖 IA: Google Gemini 3.8 Flash com fallback automático`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
