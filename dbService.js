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

async function getTeacherUser() {
  const { data } = await supabase.from('users').select('*').eq('role', 'teacher').maybeSingle();
  if (data) return data;
  return await findOrCreateUser('12345', 'Patricia', 'teacher');
}

async function updateTeacherProfile(fullName, registration) {
  const teacher = await getTeacherUser();
  const { data, error } = await supabase
    .from('users')
    .update({ full_name: fullName, registration: registration })
    .eq('id', teacher.id)
    .select()
    .single();

  if (error) throw error;
  return data;
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
async function getStudentPairInfo(userId) {
  try {
    const rawPairs = await getSetting('pair_history', '[]');
    const pairs = JSON.parse(rawPairs);
    const numId = parseInt(userId);
    return pairs.slice().reverse().find(p => p.studentIds && (p.studentIds.includes(userId) || p.studentIds.includes(numId))) || null;
  } catch (e) {
    return null;
  }
}

async function getExamPairInfo(examId) {
  try {
    const rawPairs = await getSetting('pair_history', '[]');
    const pairs = JSON.parse(rawPairs);
    const numId = parseInt(examId);
    return pairs.slice().reverse().find(p => p.examId === numId || p.examId === examId) || null;
  } catch (e) {
    return null;
  }
}

async function getStudentExam(userId) {
  const numId = parseInt(userId);

  // 1. Check if user is part of an active pair in pair_history that has a shared examId
  try {
    const pair = await getStudentPairInfo(numId);
    if (pair && pair.examId) {
      const { data: sharedExam } = await supabase
        .from('student_exams')
        .select('*')
        .eq('id', pair.examId)
        .maybeSingle();
      if (sharedExam) return sharedExam;
    }
  } catch (e) {
    console.warn('Error finding pair exam:', e);
  }

  // 2. Direct lookup fallback by user_id
  const { data } = await supabase.from('student_exams').select('*').eq('user_id', numId || userId).maybeSingle();
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

/**
 * Create a single shared exam for a pair/trio/individual with the EXACT SAME 5 questions.
 * Only ONE student needs to answer and submit; the answers and final grade are shared by all members.
 */
async function createPairExams(studentIds) {
  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    throw new Error('Nenhum aluno selecionado para a prova.');
  }

  // 1. Pick 5 random questions ONCE for the entire pair/group!
  const allQ = await getAllQuestions();
  const shuffled = [...allQ].sort(() => 0.5 - Math.random());
  const selected5 = shuffled.slice(0, 5);

  // 2. Clean up any previous exams/answers for these students first
  for (const userId of studentIds) {
    const existing = await getStudentExam(userId);
    if (existing) {
      await supabase.from('exam_answers').delete().eq('exam_id', existing.id);
      await supabase.from('student_exams').delete().eq('id', existing.id);
    }
  }

  // 3. Create ONE shared exam record in student_exams (primary user_id is the first student)
  const primaryUserId = studentIds[0];
  const { data: exam, error: examErr } = await supabase
    .from('student_exams')
    .insert({ user_id: primaryUserId, status: 'draft' })
    .select()
    .single();
  if (examErr) throw examErr;

  // 4. Insert the 5 questions once for this shared exam
  const rows = selected5.map((q, idx) => ({
    exam_id: exam.id,
    question_id: q.id,
    order_num: idx + 1,
    student_answer: ''
  }));

  const { error: ansErr } = await supabase.from('exam_answers').insert(rows);
  if (ansErr) throw ansErr;

  // 5. Save pair session in settings for pair mapping and history
  let names = '';
  try {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, full_name, registration')
      .in('id', studentIds);

    const idMap = new Map((usersData || []).map(u => [u.id, u.full_name]));
    names = studentIds.map(id => idMap.get(id) || `Aluno ${id}`).join(' & ');

    const existingPairsStr = await getSetting('pair_history', '[]');
    let pairs = [];
    try { pairs = JSON.parse(existingPairsStr); } catch (e) { pairs = []; }

    // Remove any previous active pair entry for any of these students
    pairs = pairs.filter(p => !p.studentIds || !p.studentIds.some(id => studentIds.includes(Number(id))));

    pairs.push({
      pairId: Date.now().toString(),
      studentIds: studentIds.map(Number),
      examId: exam.id,
      studentNames: names,
      questionIds: selected5.map(q => q.id),
      createdAt: new Date().toISOString()
    });

    await setSetting('pair_history', JSON.stringify(pairs));
  } catch (e) {
    console.warn('Could not record pair history:', e.message);
  }

  return { success: true, count: studentIds.length, examId: exam.id, pairNames: names };
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
  if (!answersList || !Array.isArray(answersList)) return;
  await Promise.all(
    answersList.map(item =>
      supabase
        .from('exam_answers')
        .update({ student_answer: item.studentAnswer || '' })
        .eq('exam_id', examId)
        .eq('question_id', item.questionId)
    )
  );
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
  if (!results || !Array.isArray(results) || results.length === 0) return 0;

  let totalScore = 0;
  const updates = results.map(res => {
    const scoreVal = Math.min(5, Math.max(0, parseFloat(res.score) || 0));
    totalScore += scoreVal;
    return supabase
      .from('exam_answers')
      .update({
        ai_score: scoreVal,
        ai_feedback: res.feedback || '',
        final_score: scoreVal,
        teacher_feedback: res.feedback || ''
      })
      .eq('id', res.answerId);
  });

  await Promise.all(updates);

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
  const scoreNum = Math.min(5, Math.max(0, parseFloat(teacherScore) || 0));

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

  let pairHistory = [];
  try {
    const raw = await getSetting('pair_history', '[]');
    pairHistory = JSON.parse(raw);
  } catch (e) {}

  let consents = {};
  try {
    const rawConsents = await getSetting('tcle_consents', '{}');
    consents = JSON.parse(rawConsents);
  } catch (e) {
    consents = {};
  }

  // Fetch all exams once to quickly resolve shared pair exams
  const { data: allExams } = await supabase.from('student_exams').select('*');
  const allExamsMap = new Map((allExams || []).map(e => [e.id, e]));

  return (students || []).map(s => {
    // Find pair info if any
    const pair = pairHistory.slice().reverse().find(p => p.studentIds && (p.studentIds.includes(s.id) || p.studentIds.includes(Number(s.id))));
    const pair_label = pair ? pair.studentNames : null;

    let exam = Array.isArray(s.student_exams) && s.student_exams.length > 0 ? s.student_exams[0] : (s.student_exams || null);
    if ((!exam || !exam.id) && pair && pair.examId) {
      exam = allExamsMap.get(pair.examId) || null;
    }

    // Find TCLE info
    const tcle = consents[s.id] || (s.registration ? consents[s.registration] : null);

    return {
      user_id: s.id,
      registration: s.registration,
      full_name: s.full_name,
      created_at: s.created_at,
      exam_id: exam ? exam.id : null,
      exam_status: exam ? exam.status : null,
      total_score: exam ? exam.total_score : null,
      submitted_at: exam ? exam.submitted_at : null,
      graded_at: exam ? exam.graded_at : null,
      pair_label,
      tcle_accepted: !!(tcle && tcle.accepted),
      tcle_accepted_at: tcle && tcle.acceptedAt ? tcle.acceptedAt : null,
      tcle_verification_code: tcle && tcle.verificationCode ? tcle.verificationCode : (tcle && tcle.accepted ? `TCLE-${s.id}-${s.registration}` : null)
    };
  });
}

/**
 * Fetch all students currently waiting for permission/pair approval
 * (Only students who have accepted the TCLE digital consent and are not in an active exam appear in the queue)
 */
async function getWaitingStudentsList() {
  const { data: students, error } = await supabase
    .from('users')
    .select(`
      id,
      registration,
      full_name,
      created_at,
      student_exams (
        id,
        status
      )
    `)
    .eq('role', 'student')
    .order('full_name', { ascending: true });

  if (error) throw error;

  let consents = {};
  try {
    const raw = await getSetting('tcle_consents', '{}');
    consents = JSON.parse(raw);
  } catch (e) {
    consents = {};
  }

  let pairHistory = [];
  try {
    const rawPairs = await getSetting('pair_history', '[]');
    pairHistory = JSON.parse(rawPairs);
  } catch (e) {
    pairHistory = [];
  }

  const { data: allExams } = await supabase.from('student_exams').select('id');
  const existingExamIds = new Set((allExams || []).map(e => e.id));

  // Set of student IDs who are part of an active pair exam
  const activePairStudentIds = new Set();
  pairHistory.forEach(p => {
    if (p.examId && existingExamIds.has(p.examId) && Array.isArray(p.studentIds)) {
      p.studentIds.forEach(id => activePairStudentIds.add(Number(id)));
    }
  });

  return (students || []).filter(s => {
    const exam = Array.isArray(s.student_exams) && s.student_exams.length > 0 ? s.student_exams[0] : (s.student_exams || null);
    const hasConsent = !!(consents[s.id] && consents[s.id].accepted) || !!(s.registration && consents[s.registration] && consents[s.registration].accepted);
    const hasDirectExam = !!(exam && exam.id && existingExamIds.has(exam.id));
    const hasPairExam = activePairStudentIds.has(Number(s.id));

    return hasConsent && !hasDirectExam && !hasPairExam;
  }).map(s => ({
    user_id: s.id,
    registration: s.registration,
    full_name: s.full_name,
    created_at: s.created_at
  }));
}

/**
 * Save digital TCLE consent for a student (with automatic user recovery)
 */
async function saveTcleConsent(userId, accepted, studentData = {}) {
  let user = null;
  const numId = parseInt(userId);

  if (!isNaN(numId)) {
    user = await getUserById(numId);
  }

  // If not found by ID, try finding by registration if provided
  if (!user && studentData.registration) {
    user = await getUserByRegistration(String(studentData.registration).trim());
  }

  // If still not found and we have registration & fullName, re-create user
  if (!user && studentData.registration && studentData.fullName) {
    user = await findOrCreateUser(
      String(studentData.registration).trim(),
      String(studentData.fullName).trim(),
      'student'
    );
  }

  const raw = await getSetting('tcle_consents', '{}');
  let consents = {};
  try { consents = JSON.parse(raw); } catch (e) { consents = {}; }

  const finalId = user ? user.id : (numId || userId || 'unknown');
  const reg = user ? user.registration : (studentData.registration || '');
  const name = user ? user.full_name : (studentData.fullName || 'Aluno');

  const verificationCode = `TCLE-DOC-${finalId}-${Date.now().toString(36).toUpperCase()}`;
  const consentRecord = {
    accepted: !!accepted,
    acceptedAt: new Date().toISOString(),
    userId: finalId,
    registration: reg,
    fullName: name,
    verificationCode,
    discipline: 'Estágio em Clínica odontológica integrada infantil I',
    teacher: 'Patricia Drummond'
  };

  // Key by both finalId and registration for maximum resilience
  consents[finalId] = consentRecord;
  if (reg) {
    consents[reg] = consentRecord;
  }

  await setSetting('tcle_consents', JSON.stringify(consents));
  return { consentRecord, user };
}

/**
 * Retrieve TCLE consent record for a student
 */
async function getStudentTcle(userId, registration = null) {
  const raw = await getSetting('tcle_consents', '{}');
  let consents = {};
  try { consents = JSON.parse(raw); } catch (e) { consents = {}; }

  let record = consents[userId] || null;
  if (!record && registration) record = consents[registration] || null;
  const numId = parseInt(userId);
  if (!record && !isNaN(numId)) record = consents[numId] || null;

  return record;
}

/**
 * Check if a student has accepted the digital TCLE consent
 */
async function hasUserAcceptedTcle(userId, registration = null) {
  const record = await getStudentTcle(userId, registration);
  return !!(record && record.accepted);
}

async function getDashboardStats() {
  const students = await getStudentsList();
  const totalStudents = students.length;
  const submitted = students.filter(s => ['submitted', 'grading', 'graded'].includes(s.exam_status)).length;
  const graded = students.filter(s => s.exam_status === 'graded');
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
      totalStudents,
      totalSubmitted: submitted,
      totalGraded: gradedCount,
      averageScore: avgScore
    }
  };
}

/**
 * Reset a student's exam (removes answers and exam record so they can start fresh)
 * If the student is part of a pair, resets the shared pair exam and clears the pair.
 */
async function resetStudentExam(userId) {
  const numId = parseInt(userId);

  // Check if student belongs to a pair with shared examId
  let sharedExamId = null;
  try {
    const rawPairs = await getSetting('pair_history', '[]');
    let pairs = JSON.parse(rawPairs);
    const pairIndex = pairs.slice().reverse().findIndex(p => p.studentIds && (p.studentIds.includes(userId) || p.studentIds.includes(numId)));
    if (pairIndex !== -1) {
      const actualIndex = pairs.length - 1 - pairIndex;
      sharedExamId = pairs[actualIndex].examId;
      // Remove this pair from pair_history
      pairs.splice(actualIndex, 1);
      await setSetting('pair_history', JSON.stringify(pairs));
    }
  } catch (e) {
    console.warn('Error clearing pair during reset:', e);
  }

  // Delete answers and exam
  if (sharedExamId) {
    await supabase.from('exam_answers').delete().eq('exam_id', sharedExamId);
    await supabase.from('student_exams').delete().eq('id', sharedExamId);
  }

  // Also check if there was any direct exam by userId
  const { data: directExam } = await supabase
    .from('student_exams')
    .select('id')
    .eq('user_id', numId)
    .maybeSingle();

  if (directExam) {
    await supabase.from('exam_answers').delete().eq('exam_id', directExam.id);
    await supabase.from('student_exams').delete().eq('id', directExam.id);
  }

  return true;
}

/**
 * Delete a student from the class (removes exam, answers, and user record)
 */
async function deleteStudent(userId) {
  await resetStudentExam(userId);
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) throw error;
  return true;
}

/**
 * Fetch detailed data for all students and their answers for export
 */
async function getDetailedExamExportData() {
  const students = await getStudentsList();
  const allQ = await getAllQuestions();
  const qMap = new Map(allQ.map(q => [Number(q.id), q]));

  const result = [];
  for (const s of students) {
    let answers = [];
    if (s.exam_id) {
      const { data: rawAnswers } = await supabase
        .from('exam_answers')
        .select('*')
        .eq('exam_id', s.exam_id)
        .order('order_num', { ascending: true });

      answers = (rawAnswers || []).map(a => {
        const q = qMap.get(Number(a.question_id)) || {};
        return {
          order_num: a.order_num,
          question: q.question || '',
          expected_answer: q.expected_answer || '',
          student_answer: a.student_answer || '',
          ai_score: a.ai_score,
          ai_feedback: a.ai_feedback,
          teacher_score: a.teacher_score,
          teacher_feedback: a.teacher_feedback,
          final_score: a.final_score
        };
      });
    }
    result.push({
      student: s,
      answers: answers
    });
  }
  return result;
}

/**
 * Reset entire system: clears all students, exams, answers, and releases, preserving teacher Patricia & questions
 */
async function resetEntireSystem() {
  // 1. Delete all exam answers
  await supabase.from('exam_answers').delete().neq('id', 0);
  // 2. Delete all exams
  await supabase.from('student_exams').delete().neq('id', 0);
  // 3. Delete all students (keep teacher)
  await supabase.from('users').delete().eq('role', 'student');
  // 4. Ensure teacher Patricia exists
  await findOrCreateUser('12345', 'Patricia', 'teacher');
  // 5. Reset grades_released to '0'
  await setSetting('grades_released', '0');
  // 6. Reset pair history and TCLE consents
  await setSetting('pair_history', '[]');
  await setSetting('tcle_consents', '{}');
  return true;
}

/**
 * Save all teacher grades and corrections in batch
 */
async function updateAllTeacherGrades(examId, gradesList) {
  for (const item of gradesList) {
    if (item && item.answerId) {
      await updateTeacherGrade(item.answerId, item.score, item.feedback);
    }
  }
  return true;
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
  createPairExams,
  getExamAnswers,
  saveDraftAnswers,
  submitExam,
  updateGradingResults,
  updateTeacherGrade,
  updateAllTeacherGrades,
  getStudentsList,
  getWaitingStudentsList,
  getDashboardStats,
  resetStudentExam,
  deleteStudent,
  getDetailedExamExportData,
  resetEntireSystem,
  getTeacherUser,
  updateTeacherProfile,
  saveTcleConsent,
  getStudentTcle,
  hasUserAcceptedTcle,
  getStudentPairInfo,
  getExamPairInfo
};
