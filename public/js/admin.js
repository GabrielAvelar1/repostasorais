/**
 * PAINEL DA PROFESSORA PATRICIA - LÓGICA ADMINISTRATIVA
 */

let currentUser = null;
let studentsList = [];
let activeReviewExamId = null;
let currentModalAnswers = [];

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
  if (currentUser.role !== 'teacher') {
    alert('Acesso restrito à Professora.');
    window.location.href = '/index.html';
    return;
  }
  updateTeacherHeaderUI();
}

function updateTeacherHeaderUI() {
  const headerName = document.getElementById('header-teacher-name');
  const headerReg = document.getElementById('header-teacher-reg');
  if (headerName && currentUser && currentUser.fullName) {
    headerName.textContent = currentUser.fullName;
  }
  if (headerReg && currentUser && currentUser.registration) {
    headerReg.textContent = `Matrícula: ${currentUser.registration} (Acesso Docente)`;
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

  // Export Modal Trigger
  const btnOpenExportModal = document.getElementById('btn-open-export-modal');
  if (btnOpenExportModal) {
    btnOpenExportModal.addEventListener('click', () => {
      const modal = document.getElementById('modal-export');
      if (modal) modal.style.display = 'flex';
    });
  }

  // Reset Entire System Trigger
  const btnResetSystem = document.getElementById('btn-reset-system');
  if (btnResetSystem) {
    btnResetSystem.addEventListener('click', async () => {
      const msg = '⚠️ ATENÇÃO PROFESSORA PATRICIA:\n\n' +
        'Deseja realmente RESETAR TODO O SISTEMA?\n\n' +
        'Esta ação irá:\n' +
        '• Apagar todos os alunos inscritos\n' +
        '• Apagar todas as provas enviadas e rascunhos\n' +
        '• Apagar todas as notas e correções da IA\n' +
        '• Zerar as estatísticas e a média da turma\n\n' +
        'O sistema ficará 100% limpo para aplicar uma nova prova do zero.\n\n' +
        'Deseja prosseguir?';

      if (!confirm(msg)) return;

      const confirmText = prompt('Para confirmar a limpeza total do sistema, digite RESETAR:');
      if (confirmText !== 'RESETAR') {
        showToast('Reset cancelado.');
        return;
      }

      try {
        btnResetSystem.disabled = true;
        btnResetSystem.textContent = 'Resetando sistema...';

        const res = await fetch('/api/admin/reset-system', {
          method: 'POST',
          headers: getAdminHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('✨ Sistema resetado com sucesso! Tudo limpo para a nova prova.');
        loadDashboardData();
        loadStudents();
      } catch (err) {
        alert(err.message || 'Erro ao resetar o sistema.');
      } finally {
        btnResetSystem.disabled = false;
        btnResetSystem.textContent = '⚠️ Resetar Sistema';
      }
    });
  }

  // Save All Grades & Feedbacks Trigger
  const btnSaveAllGrades = document.getElementById('btn-save-all-grades');
  if (btnSaveAllGrades) {
    btnSaveAllGrades.addEventListener('click', async () => {
      if (!activeReviewExamId || !currentModalAnswers || currentModalAnswers.length === 0) return;

      btnSaveAllGrades.disabled = true;
      btnSaveAllGrades.textContent = 'Salvando todas...';

      try {
        const gradesPayload = currentModalAnswers.map(a => {
          const scoreEl = document.getElementById(`score-input-${a.answer_id}`);
          const feedbackEl = document.getElementById(`feedback-input-${a.answer_id}`);
          const scoreVal = scoreEl ? parseFloat(scoreEl.value) : 0;
          return {
            answerId: a.answer_id,
            score: isNaN(scoreVal) ? 0 : Math.min(10, Math.max(0, scoreVal)),
            feedback: feedbackEl ? feedbackEl.value.trim() : ''
          };
        });

        const res = await fetch('/api/admin/save-all-grades', {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({
            examId: activeReviewExamId,
            grades: gradesPayload
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('🎉 Todas as 5 notas e correções foram salvas com sucesso!');
        openReviewModal(activeReviewExamId);
        loadDashboardData();
        loadStudents();
      } catch (err) {
        alert(err.message || 'Erro ao salvar notas.');
      } finally {
        btnSaveAllGrades.disabled = false;
        btnSaveAllGrades.textContent = '💾 Salvar Todas as Notas e Correções';
      }
    });
  }

  // Edit Teacher Profile Trigger
  const btnEditProfile = document.getElementById('btn-edit-profile');
  const modalProfile = document.getElementById('modal-profile');
  const formProfile = document.getElementById('form-teacher-profile');
  const profileNameInput = document.getElementById('profile-name');
  const profileRegInput = document.getElementById('profile-reg');

  if (btnEditProfile) {
    btnEditProfile.addEventListener('click', () => {
      if (profileNameInput && currentUser) profileNameInput.value = currentUser.fullName || 'Patricia';
      if (profileRegInput && currentUser) profileRegInput.value = currentUser.registration || '12345';
      if (modalProfile) modalProfile.style.display = 'flex';
    });
  }

  if (formProfile) {
    formProfile.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = profileNameInput.value.trim();
      const newReg = profileRegInput.value.trim();
      if (!newName || !newReg) return;

      try {
        const res = await fetch('/api/admin/profile', {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ fullName: newName, registration: newReg })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentUser.fullName = data.teacher.fullName;
        currentUser.registration = data.teacher.registration;
        localStorage.setItem('oral_exam_user', JSON.stringify(currentUser));

        updateTeacherHeaderUI();
        closeProfileModal();
        showToast('✅ Nome e matrícula de acesso alterados com sucesso!');
      } catch (err) {
        alert(err.message || 'Erro ao atualizar dados.');
      }
    });
  }
}

function closeExportModal() {
  const modal = document.getElementById('modal-export');
  if (modal) modal.style.display = 'none';
}
window.closeExportModal = closeExportModal;

function closeProfileModal() {
  const modal = document.getElementById('modal-profile');
  if (modal) modal.style.display = 'none';
}
window.closeProfileModal = closeProfileModal;

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

    const escapedName = escapeHtml(s.full_name).replace(/'/g, "\\'");

    const actionBtns = `
      <div style="display: inline-flex; gap: 0.35rem; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
        ${s.exam_id ? `<button class="btn btn-primary btn-sm" onclick="openReviewModal(${s.exam_id})" title="Ver respostas transcritas do aluno e correção da IA">👁️ Ver Respostas & Correção IA</button>` : '<span style="font-size: 0.85rem; color: var(--text-muted); margin-right: 0.5rem;">(Aguardando aluno)</span>'}
        ${s.exam_id ? `<button class="btn btn-outline btn-sm" style="color: #b45309; border-color: #fde68a;" onclick="handleResetExam(${s.user_id}, '${escapedName}')" title="Zerar a prova deste aluno para ele refazer">🔄 Resetar Prova</button>` : ''}
        <button class="btn btn-outline btn-sm" style="color: #b91c1c; border-color: #fecaca;" onclick="handleDeleteStudent(${s.user_id}, '${escapedName}')" title="Remover aluno da turma">🗑️ Excluir</button>
      </div>
    `;

    return `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(s.registration)}</td>
        <td><strong>${escapeHtml(s.full_name)}</strong></td>
        <td>${statusBadge}</td>
        <td>${scoreDisplay}</td>
        <td>${dateDisplay}</td>
        <td style="text-align: right;">${actionBtns}</td>
      </tr>
    `;
  }).join('');
}

async function handleResetExam(userId, studentName) {
  if (!confirm(`Deseja realmente RESETAR a prova do(a) aluno(a) "${studentName}"?\n\nAs respostas e a nota serão apagadas e o aluno poderá realizar a prova novamente do zero com novo sorteio de questões.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/student/${userId}/reset-exam`, {
      method: 'POST',
      headers: getAdminHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`🔄 Prova de "${studentName}" resetada com sucesso!`);
    loadDashboardData();
    loadStudents();
  } catch (err) {
    alert(err.message || 'Erro ao resetar prova.');
  }
}
window.handleResetExam = handleResetExam;

async function handleDeleteStudent(userId, studentName) {
  if (!confirm(`ATENÇÃO: Deseja realmente EXCLUIR o(a) aluno(a) "${studentName}" da turma?\n\nO cadastro do aluno e qualquer histórico de prova serão removidos definitivamente.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/student/${userId}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`🗑️ Aluno(a) "${studentName}" removido(a) da turma!`);
    loadDashboardData();
    loadStudents();
  } catch (err) {
    alert(err.message || 'Erro ao excluir aluno.');
  }
}
window.handleDeleteStudent = handleDeleteStudent;

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
    currentModalAnswers = answers || [];

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
              <strong style="color: var(--primary); font-size: 1.1rem;">${a.ai_score !== null ? Number(a.ai_score).toFixed(1) : '-'} / 10</strong>
            </div>
          </div>

          <!-- Student Answer -->
          <div class="review-block review-student">
            <strong>🗣️ Resposta Transcrita do Aluno (Áudio):</strong>
            <p style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(a.student_answer || '[Nenhuma resposta gravada]')}</p>
          </div>

          <!-- Expected Answer -->
          <div class="review-block review-expected">
            <strong>📚 Resposta Esperada (Gabarito da Professora):</strong>
            <p style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(a.expected_answer)}</p>
          </div>

          <!-- AI Feedback -->
          ${a.ai_feedback ? `
            <div class="review-block review-feedback">
              <strong>🤖 Correção e Justificativa Gerada pela IA:</strong>
              <p id="ai-feedback-text-${a.answer_id}" style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(a.ai_feedback)}</p>
            </div>
          ` : ''}

          <!-- Teacher Score & Feedback Customization -->
          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 1.25rem; margin-top: 1rem;">
            <div style="font-weight: 700; color: var(--primary-dark); margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
              <span>✏️ Nota Oficial e Correção da Professora Patricia:</span>
              ${a.ai_feedback ? `
                <button 
                  type="button" 
                  class="btn btn-outline btn-sm" 
                  style="font-size: 0.75rem; padding: 0.2rem 0.5rem;"
                  onclick="copyAiCorrectionToTeacher(${a.answer_id})"
                  title="Copiar o texto da IA para este campo para você editar"
                >
                  📋 Usar texto da IA como base
                </button>
              ` : ''}
            </div>
            
            <div style="display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap;">
              <div style="width: 140px;">
                <label style="font-size: 0.8rem; font-weight: 600; color: var(--text); display: block; margin-bottom: 0.25rem;">Nota (0 a 10):</label>
                <input 
                  type="number" 
                  step="0.1" 
                  min="0" 
                  max="10" 
                  id="score-input-${a.answer_id}" 
                  class="form-control" 
                  value="${currentScore}"
                  style="font-weight: 700; font-size: 1.15rem; color: var(--primary-dark);"
                >
              </div>

              <div style="flex: 1; min-width: 260px;">
                <label style="font-size: 0.8rem; font-weight: 600; color: var(--text); display: block; margin-bottom: 0.25rem;">Comentário / Correção da Professora:</label>
                <textarea 
                  id="feedback-input-${a.answer_id}" 
                  class="form-control" 
                  rows="3" 
                  placeholder="Você pode modificar a correção feita pela IA ou escrever suas considerações para o aluno..."
                  style="font-size: 0.9rem; line-height: 1.4;"
                >${escapeHtml(feedback)}</textarea>
              </div>

              <div style="padding-top: 1.5rem;">
                <button 
                  class="btn btn-primary btn-sm" 
                  onclick="saveAnswerGrade(${a.answer_id})"
                  style="white-space: nowrap;"
                >
                  💾 Salvar Esta Questão
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

function copyAiCorrectionToTeacher(answerId) {
  const aiBlock = document.getElementById(`ai-feedback-text-${answerId}`);
  const feedbackInput = document.getElementById(`feedback-input-${answerId}`);
  if (aiBlock && feedbackInput) {
    feedbackInput.value = aiBlock.innerText.trim();
    showToast('Texto da IA copiado para o campo de edição!');
  }
}
window.copyAiCorrectionToTeacher = copyAiCorrectionToTeacher;

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

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
