/**
 * PAINEL DA PROFESSORA PATRICIA - LÓGICA ADMINISTRATIVA
 */

let currentUser = null;
let studentsList = [];
let activeReviewExamId = null;

// DOM Elements
const statTotalStudents = document.getElementById('stat-total-students');
const statTotalSubmitted = document.getElementById('stat-total-submitted');
const statTotalGraded = document.getElementById('stat-total-graded');
const statAvgScore = document.getElementById('stat-avg-score');

const btnToggleExam = document.getElementById('btn-toggle-exam');
const examStatusDot = document.getElementById('exam-status-dot');
const examStatusText = document.getElementById('exam-status-text');

const btnToggleGrades = document.getElementById('btn-toggle-grades');
const gradesStatusDot = document.getElementById('grades-status-dot');
const gradesStatusText = document.getElementById('grades-status-text');

const btnOpenSettings = document.getElementById('btn-open-settings');
const btnAdminLogout = document.getElementById('btn-admin-logout');

const searchStudentInput = document.getElementById('search-student');
const btnRefreshStudents = document.getElementById('btn-refresh-students');
const studentsTableBody = document.getElementById('students-table-body');

// Modals
const modalReview = document.getElementById('modal-review');
const modalReviewStudentName = document.getElementById('modal-review-student-name');
const modalReviewStudentMeta = document.getElementById('modal-review-student-meta');
const modalReviewBody = document.getElementById('modal-review-body');
const modalTotalScoreBadge = document.getElementById('modal-total-score-badge');
const btnRegradeAi = document.getElementById('btn-regrade-ai');

const modalSettings = document.getElementById('modal-settings');
const formSettings = document.getElementById('form-settings');
const settingGeminiKey = document.getElementById('setting-gemini-key');
const settingGroqKey = document.getElementById('setting-groq-key');
const settingExamTitle = document.getElementById('setting-exam-title');
const btnTestAi = document.getElementById('btn-test-ai');
const aiTestResult = document.getElementById('ai-test-result');

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  setupAdminEvents();
  loadDashboardData();
  loadStudents();
});

// -------------------------------------------------------------
// AUTH & HEADERS
// -------------------------------------------------------------
function checkAdminAuth() {
  const saved = localStorage.getItem('oral_exam_user');
  if (!saved) {
    window.location.href = '/index.html';
    return;
  }
  currentUser = JSON.parse(saved);
  if (currentUser.role !== 'teacher' && currentUser.registration !== '12345') {
    alert('Acesso restrito à Professora Patricia.');
    window.location.href = '/index.html';
  }
}

function getAdminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-user-role': currentUser.role,
    'x-user-reg': currentUser.registration
  };
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------
function setupAdminEvents() {
  btnAdminLogout.addEventListener('click', () => {
    if (confirm('Deseja sair do painel da professora?')) {
      localStorage.removeItem('oral_exam_user');
      window.location.href = '/index.html';
    }
  });

  // Toggle Exam Open/Closed
  btnToggleExam.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/toggle-exam', {
        method: 'POST',
        headers: getAdminHeaders()
      });
      const data = await res.json();
      updateExamStatusUI(data.examOpen);
      showToast(data.examOpen ? '🟢 Prova LIBERADA para os alunos!' : '🔴 Prova BLOQUEADA para os alunos.');
    } catch (e) {
      alert('Erro ao alterar status da prova.');
    }
  });

  // Toggle Grades Release
  btnToggleGrades.addEventListener('click', async () => {
    const isCurrentlyReleased = gradesStatusText.textContent.includes('LIBERADAS');
    const confirmMsg = isCurrentlyReleased 
      ? 'Deseja OCULTAR as notas novamente para os alunos?' 
      : 'Deseja LIBERAR as notas e correções para TODOS os alunos agora?';

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch('/api/admin/toggle-grades', {
        method: 'POST',
        headers: getAdminHeaders()
      });
      const data = await res.json();
      updateGradesStatusUI(data.gradesReleased);
      showToast(data.gradesReleased ? '📢 Notas liberadas com sucesso para toda a turma!' : '🔒 Notas ocultadas com sucesso.');
    } catch (e) {
      alert('Erro ao alterar liberação de notas.');
    }
  });

  // Settings
  btnOpenSettings.addEventListener('click', openSettingsModal);
  formSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        geminiApiKey: settingGeminiKey.value.trim(),
        groqApiKey: settingGroqKey.value.trim(),
        examTitle: settingExamTitle.value.trim()
      };
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      showToast('Configurações salvas!');
      closeSettingsModal();
    } catch (err) {
      alert(err.message);
    }
  });

  // Test AI
  btnTestAi.addEventListener('click', async () => {
    aiTestResult.style.display = 'block';
    aiTestResult.innerHTML = '<span style="color: var(--primary);">⏳ Testando conexão com a IA...</span>';

    try {
      const key = settingGeminiKey.value.trim() || undefined;
      const res = await fetch('/api/admin/test-ai', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ provider: 'gemini', apiKey: key })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      aiTestResult.innerHTML = `<div style="background: var(--success-light); color: #065f46; padding: 0.75rem; border-radius: 6px;">
        ✅ <strong>Sucesso:</strong> IA respondeu com sucesso! ("${escapeHtml(data.reply)}")
      </div>`;
    } catch (err) {
      aiTestResult.innerHTML = `<div style="background: var(--danger-light); color: #991b1b; padding: 0.75rem; border-radius: 6px;">
        ❌ <strong>Erro:</strong> ${escapeHtml(err.message)}
      </div>`;
    }
  });

  // Refresh & Search
  btnRefreshStudents.addEventListener('click', () => {
    loadDashboardData();
    loadStudents();
    showToast('Lista atualizada.');
  });

  searchStudentInput.addEventListener('input', () => {
    renderStudentsTable();
  });

  // Regrade AI in Modal
  btnRegradeAi.addEventListener('click', async () => {
    if (!activeReviewExamId) return;
    if (!confirm('Deseja reenviar esta prova para reavaliação pela IA?')) return;

    try {
      btnRegradeAi.disabled = true;
      btnRegradeAi.textContent = 'Enviando para a IA...';

      const res = await fetch(`/api/admin/regrade-exam/${activeReviewExamId}`, {
        method: 'POST',
        headers: getAdminHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('🤖 Prova reenviada para a IA! Atualizando em instantes...');
      setTimeout(() => {
        openReviewModal(activeReviewExamId);
        loadStudents();
        btnRegradeAi.disabled = false;
        btnRegradeAi.textContent = '🤖 Reavaliar com IA';
      }, 3000);
    } catch (err) {
      alert(err.message);
      btnRegradeAi.disabled = false;
      btnRegradeAi.textContent = '🤖 Reavaliar com IA';
    }
  });
}

// -------------------------------------------------------------
// LOAD DASHBOARD STATS
// -------------------------------------------------------------
async function loadDashboardData() {
  try {
    const res = await fetch('/api/admin/dashboard', { headers: getAdminHeaders() });
    const data = await res.json();

    statTotalStudents.textContent = data.stats.totalStudents || 0;
    statTotalSubmitted.textContent = data.stats.totalSubmitted || 0;
    statTotalGraded.textContent = data.stats.totalGraded || 0;
    statAvgScore.textContent = data.stats.averageScore ? Number(data.stats.averageScore).toFixed(1) : '--';

    updateExamStatusUI(data.examOpen);
    updateGradesStatusUI(data.gradesReleased);
  } catch (err) {
    console.error('Error dashboard:', err);
  }
}

function updateExamStatusUI(isOpen) {
  if (isOpen) {
    btnToggleExam.style.borderColor = 'var(--success)';
    examStatusDot.textContent = '🟢';
    examStatusText.textContent = 'Prova LIBERADA para Alunos';
  } else {
    btnToggleExam.style.borderColor = 'var(--danger)';
    examStatusDot.textContent = '🔴';
    examStatusText.textContent = 'Prova BLOQUEADA para Alunos';
  }
}

function updateGradesStatusUI(isReleased) {
  if (isReleased) {
    btnToggleGrades.style.borderColor = 'var(--success)';
    gradesStatusDot.textContent = '📢';
    gradesStatusText.textContent = 'Notas LIBERADAS para Todos';
  } else {
    btnToggleGrades.style.borderColor = 'var(--warning)';
    gradesStatusDot.textContent = '🔒';
    gradesStatusText.textContent = 'Notas OCULTAS (Em Revisão)';
  }
}

// -------------------------------------------------------------
// LOAD STUDENTS
// -------------------------------------------------------------
async function loadStudents() {
  try {
    const res = await fetch('/api/admin/students', { headers: getAdminHeaders() });
    studentsList = await res.json();
    renderStudentsTable();
  } catch (err) {
    console.error('Error fetching students:', err);
    studentsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 1rem;">Erro ao carregar alunos.</td></tr>`;
  }
}

function renderStudentsTable() {
  const query = (searchStudentInput.value || '').toLowerCase().trim();
  const filtered = studentsList.filter(s => 
    s.full_name.toLowerCase().includes(query) || 
    s.registration.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    studentsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum aluno encontrado.</td></tr>`;
    return;
  }

  studentsTableBody.innerHTML = filtered.map(s => {
    let statusBadge = '';
    if (!s.exam_id) {
      statusBadge = '<span class="badge badge-gray">Não iniciou</span>';
    } else if (s.exam_status === 'draft') {
      statusBadge = '<span class="badge badge-warning">Em andamento</span>';
    } else if (s.exam_status === 'submitted') {
      statusBadge = '<span class="badge badge-primary">Enviada</span>';
    } else if (s.exam_status === 'grading') {
      statusBadge = '<span class="badge badge-warning">Corrigindo (IA)...</span>';
    } else if (s.exam_status === 'graded') {
      statusBadge = '<span class="badge badge-success">Corrigida</span>';
    }

    const scoreDisplay = (s.total_score !== null && s.total_score !== undefined) 
      ? `<strong style="font-size: 1.1rem; color: var(--primary-dark);">${Number(s.total_score).toFixed(1)}</strong>` 
      : '-';

    const dateDisplay = s.submitted_at ? new Date(s.submitted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';

    const actionBtn = s.exam_id 
      ? `<button class="btn btn-outline btn-sm" onclick="openReviewModal(${s.exam_id})">👁️ Revisar / Alterar Nota</button>`
      : `<span style="font-size: 0.85rem; color: var(--text-muted);">Aguardando início</span>`;

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(s.registration)}</td>
        <td><strong>${escapeHtml(s.full_name)}</strong></td>
        <td>${statusBadge}</td>
        <td>${scoreDisplay}</td>
        <td>${dateDisplay}</td>
        <td style="text-align: right;">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// REVIEW EXAM MODAL & EDIT SCORES
// -------------------------------------------------------------
async function openReviewModal(examId) {
  activeReviewExamId = examId;
  modalReview.style.display = 'flex';
  modalReviewBody.innerHTML = '<div style="text-align: center; padding: 2rem;">Carregando detalhes do exame...</div>';

  try {
    const res = await fetch(`/api/admin/exam/${examId}`, { headers: getAdminHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const { exam, answers } = data;

    modalReviewStudentName.textContent = `Aluno: ${exam.full_name}`;
    modalReviewStudentMeta.textContent = `Matrícula: ${exam.registration} | Status: ${exam.status.toUpperCase()} | Enviado em: ${exam.submitted_at ? new Date(exam.submitted_at).toLocaleString('pt-BR') : '-'}`;
    modalTotalScoreBadge.textContent = exam.total_score !== null ? Number(exam.total_score).toFixed(1) : '--';

    modalReviewBody.innerHTML = answers.map((a, idx) => {
      const currentScore = a.final_score !== null && a.final_score !== undefined ? Number(a.final_score).toFixed(1) : '';
      const feedback = a.teacher_feedback || a.ai_feedback || '';

      return `
        <div class="question-review-card" style="margin-bottom: 1.5rem; border: 1px solid var(--border);">
          <div class="review-item-header">
            <div>
              <span class="badge badge-primary">Questão ${idx + 1} de 5</span>
              <h4 style="margin-top: 0.35rem; font-size: 1.05rem;">${escapeHtml(a.question)}</h4>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Nota Sugerida IA:</span>
              <strong>${a.ai_score !== null ? Number(a.ai_score).toFixed(1) : '-'} / 10</strong>
            </div>
          </div>

          <!-- Student Answer -->
          <div class="review-block review-student">
            <strong>Resposta Transcrita do Aluno:</strong>
            <p style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem;">${escapeHtml(a.student_answer || '[Não respondeu]')}</p>
          </div>

          <!-- Expected Answer -->
          <div class="review-block review-expected">
            <strong>Resposta Esperada (Referência da Professora):</strong>
            <p style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem;">${escapeHtml(a.expected_answer)}</p>
          </div>

          <!-- AI Feedback -->
          ${a.ai_feedback ? `
            <div class="review-block review-feedback">
              <strong>Análise da IA:</strong>
              <p style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem;">${escapeHtml(a.ai_feedback)}</p>
            </div>
          ` : ''}

          <!-- Teacher Score & Feedback Customization -->
          <div style="background: #f8fafc; border: 1px dashed var(--primary); border-radius: 8px; padding: 1rem; margin-top: 1rem;">
            <div style="font-weight: 600; color: var(--primary-dark); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
              <span>✏️ Nota Oficial da Professora Patricia:</span>
              <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-muted);">(Altere a nota se discordar da IA)</span>
            </div>
            <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
              <div style="width: 140px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Nota (0 a 10):</label>
                <input 
                  type="number" 
                  step="0.1" 
                  min="0" 
                  max="10" 
                  id="score-input-${a.answer_id}" 
                  class="form-control" 
                  value="${currentScore}"
                  style="font-weight: 700; font-size: 1.1rem;"
                >
              </div>
              <div style="flex: 1; min-width: 200px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block;">Comentário da Professora (Opcional):</label>
                <input 
                  type="text" 
                  id="feedback-input-${a.answer_id}" 
                  class="form-control" 
                  value="${escapeHtml(feedback)}"
                  placeholder="Justificativa da nota..."
                >
              </div>
              <div style="padding-top: 1.25rem;">
                <button 
                  class="btn btn-primary btn-sm" 
                  onclick="saveAnswerGrade(${a.answer_id})"
                >
                  Salvar Nota
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    modalReviewBody.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 2rem;">Erro ao carregar prova: ${escapeHtml(err.message)}</div>`;
  }
}

async function saveAnswerGrade(answerId) {
  const scoreInput = document.getElementById(`score-input-${answerId}`);
  const feedbackInput = document.getElementById(`feedback-input-${answerId}`);
  if (!scoreInput) return;

  const scoreVal = parseFloat(scoreInput.value);
  if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 10) {
    alert('A nota deve ser um número entre 0 e 10.');
    return;
  }

  try {
    const res = await fetch('/api/admin/grade-answer', {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify({
        answerId,
        teacherScore: scoreVal,
        teacherFeedback: feedbackInput ? feedbackInput.value.trim() : ''
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('✅ Nota atualizada com sucesso!');
    // Reload modal score & students list
    if (activeReviewExamId) {
      openReviewModal(activeReviewExamId);
      loadDashboardData();
      loadStudents();
    }
  } catch (err) {
    alert(err.message);
  }
}

function closeReviewModal() {
  modalReview.style.display = 'none';
  activeReviewExamId = null;
  loadDashboardData();
  loadStudents();
}

// -------------------------------------------------------------
// SETTINGS MODAL
// -------------------------------------------------------------
async function openSettingsModal() {
  modalSettings.style.display = 'flex';
  aiTestResult.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings', { headers: getAdminHeaders() });
    const data = await res.json();
    if (data.geminiKeyConfigured) {
      settingGeminiKey.placeholder = `Chave configurada (${data.geminiKeyMasked})`;
    }
    if (data.groqKeyConfigured) {
      settingGroqKey.placeholder = `Chave configurada (${data.groqKeyMasked})`;
    }
    if (data.examTitle) {
      settingExamTitle.value = data.examTitle;
    }
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

function closeSettingsModal() {
  modalSettings.style.display = 'none';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
