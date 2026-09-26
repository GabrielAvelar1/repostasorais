require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pvtjonucgajkjtgonwfl.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dGpvbnVjZ2Fqa2p0Z29ud2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzk4OTAsImV4cCI6MjEwNTk1NTg5MH0.0ZuNt_sadyadPIJJMxJxKqUPkLBotP8mFIHUs1S7sBw';

const supabase = createClient(supabaseUrl, supabaseKey);

// Fallback questions from perguntas.json
let localQuestions = [];
try {
  localQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, 'perguntas.json'), 'utf8'));
} catch (e) {}

/**
 * Settings
 */
async function getSetting(key, defaultValue = '0') {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    return data && data.value !== null && data.value !== undefined ? String(data.value) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

async function setSetting(key, value) {
  try {
    await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' });
  } catch (e) {
    console.warn('Error setting config:', e.message);
  }
}

/**
 * Users
 */
async function getUserByRegistration(registration) {
  const { data } = await supabase.from('users').select('*').eq('registration', registration).maybeSingle();
  return data;
}

async function getUserById(id) {
  const { data } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  return data;
}

async function findOrCreateUser(registration, fullName, role = 'student') {
  let user = await getUserByRegistration(registration);
  if (!user) {
    const { data, error } = await supabase
      .from('users')
      .insert({ registration, full_name: fullName, role })
      .select()
      .single();
    if (error) throw error;
    user = data;
  } else if (user.full_name !== fullName) {
    const { data } = await supabase
      .from('users')
      .update({ full_name: fullName })
      .eq('id', user.id)
      .select()
      .single();
    if (data) user = data;
  }
  return user;
}

/**
 * Questions
 */
async function getAllQuestions() {
  try {
    const { data } = await supabase.from('questions').select('*').order('id', { ascending: true });
    if (data && data.length > 0) return data;

    // Auto-seed Supabase questions if table is empty
    if (localQuestions.length > 0) {
      const rows = localQuestions.map(q => ({
        id: q.id,
        question: q.question,
        expected_answer: q.expectedAnswer
      }));
      await supabase.from('questions').upsert(rows);
      const { data: seeded } = await supabase.from('questions').select('*').order('id', { ascending: true });
      if (seeded && seeded.length > 0) return seeded;
    }
  } catch (err) {
    console.warn('Supabase questions read/seed warning:', err.message);
  }

  return localQuestions.map(q => ({
    id: q.id,
    question: q.question,
    expected_answer: q.expectedAnswer
  }));
}

/**
 * Exams
 */
async function getStudentExam(userId) {
  const { data } = await supabase.from('student_exams').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function createStudentExamWithRandomQuestions(userId) {
  // 1. Create exam
  const { data: exam, error: examErr } = await supabase
    .from('student_exams')
    .insert({ user_id: userId, status: 'draft' })
    .select()
    .single();
  if (examErr) throw examErr;

  // 2. Pick 5 random questions
  const allQ = await getAllQuestions();
  const shuffled = [...allQ].sort(() => 0.5 - Math.random());
  const selected5 = shuffled.slice(0, 5);

  // 3. Create exam answers
  const rows = selected5.map((q, idx) => ({
    exam_id: exam.id,
    question_id: q.id,
    order_num: idx + 1,
    student_answer: ''
  }));

  const { error: ansErr } = await supabase.from('exam_answers').insert(rows);
  if (ansErr) throw ansErr;

  return exam;
}

async function getExamAnswers(examId) {
  const { data: answers, error } = await supabase
    .from('exam_answers')
    .select(`
      id,
      exam_id,
      question_id,
      order_num,
      student_answer,
      ai_score,
      ai_feedback,
      teacher_score,
      teacher_feedback,
      final_score
    `)
    .eq('exam_id', examId)
    .order('order_num', { ascending: true });

  if (error) throw error;

  // Self-healing: If an exam exists but has 0 answers (due to a previous failed attempt), populate 5 random questions immediately
  if (!answers || answers.length === 0) {
    const allQ = await getAllQuestions();
    const shuffled = [...allQ].sort(() => 0.5 - Math.random());
    const selected5 = shuffled.slice(0, 5);
    const rows = selected5.map((q, idx) => ({
      exam_id: examId,
      question_id: q.id,
      order_num: idx + 1,
      student_answer: ''
    }));
    await supabase.from('exam_answers').insert(rows);

    const { data: retryAnswers } = await supabase
      .from('exam_answers')
      .select(`
        id,
        exam_id,
        question_id,
        order_num,
        student_answer,
        ai_score,
        ai_feedback,
        teacher_score,
        teacher_feedback,
        final_score
      `)
      .eq('exam_id', examId)
      .order('order_num', { ascending: true });

    if (retryAnswers && retryAnswers.length > 0) {
      const qMap = new Map(allQ.map(q => [Number(q.id), q]));
      return retryAnswers.map(a => {
        const q = qMap.get(Number(a.question_id)) || {};
        return {
          answer_id: a.id,
          question_id: a.question_id,
          order_num: a.order_num,
          student_answer: a.student_answer || '',
          ai_score: a.ai_score,
          ai_feedback: a.ai_feedback,
          teacher_score: a.teacher_score,
          teacher_feedback: a.teacher_feedback,
          final_score: a.final_score,
          question: q.question || '',
          expected_answer: q.expected_answer || ''
        };
      });
    }
  }

  const allQ = await getAllQuestions();
  const qMap = new Map(allQ.map(q => [Number(q.id), q]));

  return answers.map(a => {
    const q = qMap.get(Number(a.question_id)) || {};
    return {
      answer_id: a.id,
      question_id: a.question_id,
      order_num: a.order_num,
      student_answer: a.student_answer || '',
      ai_score: a.ai_score,
      ai_feedback: a.ai_feedback,
      teacher_score: a.teacher_score,
      teacher_feedback: a.teacher_feedback,
      final_score: a.final_score,
      question: q.question || '',
      expected_answer: q.expected_answer || ''
    };
  });
}

async function saveDraftAnswers(examId, answersList) {
  for (const item of answersList) {
    await supabase
      .from('exam_answers')
      .update({ student_answer: item.studentAnswer || '' })
      .eq('exam_id', examId)
      .eq('question_id', item.questionId);
  }
}

async function submitExam(examId, answersList) {
  if (answersList && Array.isArray(answersList)) {
    await saveDraftAnswers(examId, answersList);
  }
  const { data, error } = await supabase
    .from('student_exams')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', examId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateGradingResults(examId, results) {
  let totalScore = 0;
  for (const res of results) {
    const scoreVal = Math.min(10, Math.max(0, parseFloat(res.score) || 0));
    totalScore += scoreVal;
    await supabase
      .from('exam_answers')
      .update({
        ai_score: scoreVal,
        ai_feedback: res.feedback || '',
        final_score: scoreVal,
        teacher_feedback: res.feedback || ''
      })
      .eq('id', res.answerId);
  }

  const averageScore = Math.round((totalScore / results.length) * 10) / 10;

  await supabase
    .from('student_exams')
    .update({
      status: 'graded',
      total_score: averageScore,
      graded_at: new Date().toISOString()
    })
    .eq('id', examId);

  return averageScore;
}

async function updateTeacherGrade(answerId, teacherScore, teacherFeedback) {
  const scoreNum = Math.min(10, Math.max(0, parseFloat(teacherScore) || 0));

  const { data: ans, error } = await supabase
    .from('exam_answers')
    .update({
      teacher_score: scoreNum,
      teacher_feedback: teacherFeedback || '',
      final_score: scoreNum
    })
    .eq('id', answerId)
    .select('exam_id')
    .single();

  if (error) throw error;

  // Recalculate average
  const { data: allAns } = await supabase
    .from('exam_answers')
    .select('final_score')
    .eq('exam_id', ans.exam_id);

  if (allAns && allAns.length > 0) {
    const sum = allAns.reduce((acc, cur) => acc + (parseFloat(cur.final_score) || 0), 0);
    const avg = Math.round((sum / allAns.length) * 10) / 10;
    await supabase
      .from('student_exams')
      .update({ total_score: avg, status: 'graded' })
      .eq('id', ans.exam_id);
  }
}

async function getStudentsList() {
  const { data: students } = await supabase
    .from('users')
    .select(`
      id,
      registration,
      full_name,
      created_at,
      student_exams (
        id,
        status,
        total_score,
        submitted_at,
        graded_at
      )
    `)
    .eq('role', 'student')
    .order('full_name', { ascending: true });

  return (students || []).map(s => {
    const exam = s.student_exams?.[0] || null;
    return {
      user_id: s.id,
      registration: s.registration,
      full_name: s.full_name,
      created_at: s.created_at,
      exam_id: exam ? exam.id : null,
      exam_status: exam ? exam.status : null,
      total_score: exam ? exam.total_score : null,
      submitted_at: exam ? exam.submitted_at : null,
      graded_at: exam ? exam.graded_at : null
    };
  });
}

async function getDashboardStats() {
  const { count: totalStudents } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'student');

  const { data: exams } = await supabase
    .from('student_exams')
    .select('status, total_score');

  const submitted = (exams || []).filter(e => ['submitted', 'grading', 'graded'].includes(e.status)).length;
  const graded = (exams || []).filter(e => e.status === 'graded');
  const gradedCount = graded.length;

  let avgScore = 0;
  if (gradedCount > 0) {
    const sum = graded.reduce((acc, cur) => acc + (parseFloat(cur.total_score) || 0), 0);
    avgScore = Math.round((sum / gradedCount) * 10) / 10;
  }

  const examOpen = (await getSetting('exam_open')) === '1';
  const gradesReleased = (await getSetting('grades_released')) === '1';

  return {
    examOpen,
    gradesReleased,
    stats: {
      totalStudents: totalStudents || 0,
      totalSubmitted: submitted,
      totalGraded: gradedCount,
      averageScore: avgScore
    }
  };
}

module.exports = {
  supabase,
  getSetting,
  setSetting,
  getUserById,
  getUserByRegistration,
  findOrCreateUser,
  getAllQuestions,
  getStudentExam,
  createStudentExamWithRandomQuestions,
  getExamAnswers,
  saveDraftAnswers,
  submitExam,
  updateGradingResults,
  updateTeacherGrade,
  getStudentsList,
  getDashboardStats
};
