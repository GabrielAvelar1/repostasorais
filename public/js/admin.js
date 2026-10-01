/**
 * PAINEL DA PROFESSORA PATRICIA - LÓGICA ADMINISTRATIVA
 */

let currentUser = null;
let studentsList = [];
let activeReviewExamId = null;
let currentModalAnswers = [];
let activeLiveExamId = null;
let liveQuestionsInterval = null;

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

// Waiting Queue for Pairs
const waitingQueueContainer = document.getElementById('waiting-queue-container');
const badgeWaitingCount = document.getElementById('badge-waiting-count');
const selectedPairCounter = document.getElementById('selected-pair-counter');
const btnApprovePair = document.getElementById('btn-approve-pair');

let waitingStudentsList = [];
let selectedWaitingStudentIds = [];

// Modals
const modalReview = document.getElementById('modal-review');
const modalReviewStudentName = document.getElementById('modal-review-student-name');
const modalReviewStudentMeta = document.getElementById('modal-review-student-meta');
const modalReviewBody = document.getElementById('modal-review-body');
const modalTopScoreBadge = document.getElementById('modal-top-score-badge');
const modalTotalScoreBadge = document.getElementById('modal-total-score-badge');
const btnSaveAllGradesTop = document.getElementById('btn-save-all-grades-top');
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
  loadWaitingStudents();
  // Poll waiting queue and students every 5 seconds to show active exams and arrivals in real-time
  setInterval(() => {
    loadWaitingStudents();
    loadStudents();
  }, 5000);
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

  // Toggle Exam Open/Closed (if button exists)
  if (btnToggleExam) {
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
  }

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
            score: isNaN(scoreVal) ? 0 : Math.min(5, Math.max(0, scoreVal)),
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

  // Top Sticky Save All Grades Button
  if (btnSaveAllGradesTop && btnSaveAllGrades) {
    btnSaveAllGradesTop.addEventListener('click', () => {
      btnSaveAllGrades.click();
    });
  }

  // Approve Individual / Pair / Trio Button Trigger
  if (btnApprovePair) {
    btnApprovePair.addEventListener('click', async () => {
      const count = selectedWaitingStudentIds.length;
      if (count < 1) {
        showToast('⚠️ Selecione pelo menos 1 aluno para iniciar a prova.');
        return;
      }

      let groupType = 'aluno individual';
      if (count === 2) groupType = 'dupla';
      else if (count === 3) groupType = 'trio';
      else if (count > 3) groupType = `grupo de ${count} alunos`;

      const confirmMsg = count === 1
        ? 'Deseja autorizar este aluno para fazer a prova individualmente com 5 questões?'
        : `Deseja autorizar este ${groupType} e sortear as 5 questões idênticas para todos eles?`;

      if (!confirm(confirmMsg)) return;

      try {
        btnApprovePair.disabled = true;
        btnApprovePair.textContent = count === 1 ? 'Autorizando prova individual...' : `Autorizando ${groupType}...`;

        const res = await fetch('/api/admin/approve-pair', {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({ studentIds: selectedWaitingStudentIds })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const successMsg = count === 1
          ? '🎉 Prova individual autorizada com sucesso! As 5 questões foram sorteadas.'
          : `🎉 ${groupType.charAt(0).toUpperCase() + groupType.slice(1)} autorizada com sucesso! As 5 questões idênticas foram sorteadas.`;

        showToast(successMsg);
        selectedWaitingStudentIds = [];
        loadWaitingStudents();
        loadStudents();
        loadDashboardData();
      } catch (err) {
        alert(err.message || 'Erro ao autorizar aluno(s).');
      } finally {
        btnApprovePair.disabled = false;
        updateSelectedPairUI();
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

async function handleExportExcel(type) {
  try {
    showToast('⏳ Gerando planilha Excel...');
    const user = JSON.parse(localStorage.getItem('oral_exam_user') || '{}');
    const role = user.role || 'teacher';
    const reg = user.registration || '12345';

    const url = `/api/admin/export-excel?type=${type}&role=${encodeURIComponent(role)}&reg=${encodeURIComponent(reg)}`;
    const res = await fetch(url, {
      headers: getAdminHeaders()
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status} ao gerar planilha.`);
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    a.download = type === 'detailed'
      ? `Notas_Odontopediatria_Detalhado_Patricia_${dateStr}.xlsx`
      : `Notas_Odontopediatria_Resumo_Patricia_${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);

    showToast('✅ Planilha baixada com sucesso!');
    closeExportModal();
  } catch (err) {
    console.error('Export Excel error:', err);
    alert(err.message || 'Erro ao exportar planilha Excel.');
  }
}
window.handleExportExcel = handleExportExcel;

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
  if (!btnToggleExam || !examStatusDot || !examStatusText) return;
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
// WAITING QUEUE & PAIR MANAGEMENT
// -------------------------------------------------------------
async function loadWaitingStudents() {
  try {
    const res = await fetch('/api/admin/waiting-students', { headers: getAdminHeaders() });
    waitingStudentsList = await res.json();
    renderWaitingQueue();
  } catch (err) {
    console.error('Error fetching waiting queue:', err);
  }
}

function renderWaitingQueue() {
  if (!waitingQueueContainer) return;

  if (badgeWaitingCount) {
    badgeWaitingCount.textContent = `${waitingStudentsList.length} aguardando`;
  }

  // Filter selected IDs that still exist in waiting list
  selectedWaitingStudentIds = selectedWaitingStudentIds.filter(id => waitingStudentsList.some(s => s.user_id === id));
  updateSelectedPairUI();

  if (waitingStudentsList.length === 0) {
    waitingQueueContainer.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.9rem; padding: 1.25rem; text-align: center; grid-column: 1 / -1; background: #f8fafc; border-radius: 8px;">
        ✨ Nenhum aluno aguardando autorização no momento. Quando os alunos entrarem no sistema, eles aparecerão aqui para você autorizar (individual, dupla ou trio).
      </div>
    `;
    return;
  }

  waitingQueueContainer.innerHTML = waitingStudentsList.map(s => {
    const isSelected = selectedWaitingStudentIds.includes(s.user_id);
    return `
      <div 
        class="waiting-student-card" 
        onclick="toggleSelectWaitingStudent(${s.user_id})"
        style="
          border: 2px solid ${isSelected ? 'var(--primary)' : '#e2e8f0'};
          background: ${isSelected ? 'var(--primary-light)' : '#ffffff'};
          border-radius: 8px;
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s ease;
        "
      >
        <div>
          <div style="font-weight: 700; color: ${isSelected ? 'var(--primary-dark)' : 'var(--text-main)'}; font-size: 0.95rem;">
            ${escapeHtml(s.full_name)}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">
            Matrícula: <strong>${escapeHtml(s.registration)}</strong>
          </div>
        </div>
        <div>
          <input 
            type="checkbox" 
            id="chk-student-${s.user_id}" 
            ${isSelected ? 'checked' : ''} 
            style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);"
            onclick="event.stopPropagation(); toggleSelectWaitingStudent(${s.user_id});"
          >
        </div>
      </div>
    `;
  }).join('');
}

function toggleSelectWaitingStudent(userId) {
  const index = selectedWaitingStudentIds.indexOf(userId);
  if (index > -1) {
    selectedWaitingStudentIds.splice(index, 1);
  } else {
    if (selectedWaitingStudentIds.length >= 5) {
      showToast('⚠️ Você pode selecionar no máximo 5 alunos por grupo.');
      return;
    }
    selectedWaitingStudentIds.push(userId);
  }
  renderWaitingQueue();
}
window.toggleSelectWaitingStudent = toggleSelectWaitingStudent;

function updateSelectedPairUI() {
  const count = selectedWaitingStudentIds.length;
  if (selectedPairCounter) {
    if (count === 0) {
      selectedPairCounter.textContent = 'Selecionados: 0';
    } else if (count === 1) {
      selectedPairCounter.textContent = 'Selecionado: 1 aluno (Individual)';
    } else if (count === 2) {
      selectedPairCounter.textContent = 'Selecionados: 2 alunos (Dupla)';
    } else if (count === 3) {
      selectedPairCounter.textContent = 'Selecionados: 3 alunos (Trio)';
    } else {
      selectedPairCounter.textContent = `Selecionados: ${count} alunos (Grupo)`;
    }
  }
  if (btnApprovePair) {
    btnApprovePair.disabled = count < 1;
    if (count === 1) {
      btnApprovePair.textContent = '✨ Aprovar Aluno (Individual) e Iniciar Prova';
    } else if (count === 2) {
      btnApprovePair.textContent = '✨ Aprovar Dupla e Iniciar Prova';
    } else if (count === 3) {
      btnApprovePair.textContent = '✨ Aprovar Trio e Iniciar Prova';
    } else if (count > 3) {
      btnApprovePair.textContent = `✨ Aprovar Grupo (${count}) e Iniciar Prova`;
    } else {
      btnApprovePair.textContent = '✨ Autorizar Prova';
    }
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
    updateActiveExamBanner();
  } catch (err) {
    console.error('Error fetching students:', err);
    studentsTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 1rem;">Erro ao carregar alunos.</td></tr>`;
  }
}

function updateActiveExamBanner() {
  const banner = document.getElementById('active-exam-banner');
  const namesSpan = document.getElementById('active-exam-pair-names');
  const btnOpen = document.getElementById('btn-open-active-questions');
  if (!banner) return;

  const activeStudent = studentsList.find(s => s.exam_id && s.exam_status === 'draft');
  if (activeStudent) {
    banner.style.display = 'block';
    if (namesSpan) {
      namesSpan.textContent = activeStudent.pair_label || activeStudent.full_name;
    }
    if (btnOpen) {
      btnOpen.onclick = () => openLiveQuestionsModal(activeStudent.exam_id);
    }
  } else {
    banner.style.display = 'none';
  }
}

function renderStudentsTable() {
  const query = (searchStudentInput.value || '').toLowerCase().trim();
  const filtered = studentsList.filter(s => 
    s.full_name.toLowerCase().includes(query) || 
    s.registration.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    studentsTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum aluno encontrado.</td></tr>`;
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

    const pairDisplay = s.pair_label
      ? `<span class="badge badge-primary" style="font-size: 0.75rem; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;">👥 ${escapeHtml(s.pair_label)}</span>`
      : '<span style="color: var(--text-muted); font-size: 0.85rem;">-</span>';

    const scoreDisplay = (s.total_score !== null && s.total_score !== undefined) 
      ? `<strong style="font-size: 1.1rem; color: var(--primary-dark);">${Number(s.total_score).toFixed(1)} / 5.0</strong>` 
      : '-';

    const dateDisplay = s.submitted_at ? new Date(s.submitted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';

    const escapedName = escapeHtml(s.full_name).replace(/'/g, "\\'");
    const escapedReg = escapeHtml(s.registration).replace(/'/g, "\\'");

    // TCLE Badge
    let tcleBadge = '';
    if (s.tcle_accepted) {
      const timeStr = s.tcle_accepted_at ? new Date(s.tcle_accepted_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      tcleBadge = `<button class="btn btn-outline btn-sm" style="color: #059669; border-color: #a7f3d0; background: #ecfdf5; font-size: 0.8rem; padding: 0.25rem 0.55rem; font-weight: 600;" onclick="openTcleProofModal(${s.user_id}, '${escapedName}', '${escapedReg}')" title="Visualizar comprovante digital do TCLE">✅ Aceito ${timeStr ? `(${timeStr})` : ''}</button>`;
    } else {
      tcleBadge = `<button class="btn btn-outline btn-sm" style="color: #d97706; border-color: #fde68a; background: #fffbeb; font-size: 0.8rem; padding: 0.25rem 0.55rem; font-weight: 600;" onclick="openTcleProofModal(${s.user_id}, '${escapedName}', '${escapedReg}')" title="Aluno ainda não aceitou o TCLE">⏳ Pendente</button>`;
    }

    const isDraft = s.exam_status === 'draft';
    const actionBtns = `
      <div class="action-btn-group">
        ${s.exam_id ? `
          <button class="btn btn-primary btn-sm btn-action-review" onclick="openReviewModal(${s.exam_id})" title="Ver respostas transcritas do aluno e correção da IA">
            👁️ Ver Respostas & IA
          </button>
          <button class="btn btn-outline btn-sm btn-action-compact" style="color: #0284c7; border-color: #38bdf8; background: #f0f9ff; font-weight: 600;" onclick="openLiveQuestionsModal(${s.exam_id})" title="${isDraft ? 'Acompanhar perguntas sorteadas e transcrição ao vivo' : 'Ver perguntas sorteadas e gabarito da prova'}">
            📖 ${isDraft ? 'Acompanhar' : 'Perguntas'}
          </button>
        ` : '<span style="font-size: 0.8rem; color: var(--text-muted); margin-right: 0.25rem;">(Sem prova)</span>'}
        <button class="btn btn-outline btn-sm btn-action-compact" style="color: #0369a1; border-color: #bae6fd; background: #f0f9ff; font-weight: 600;" onclick="openTcleProofModal(${s.user_id}, '${escapedName}', '${escapedReg}')" title="Ver comprovante oficial do TCLE">📜 TCLE</button>
        ${s.exam_id ? `<button class="btn btn-outline btn-sm btn-action-compact" style="color: #b45309; border-color: #fde68a;" onclick="handleResetExam(${s.user_id}, '${escapedName}')" title="Zerar a prova deste aluno para ele refazer">🔄 Resetar</button>` : ''}
        <button class="btn btn-outline btn-sm btn-action-compact" style="color: #b91c1c; border-color: #fecaca;" onclick="handleDeleteStudent(${s.user_id}, '${escapedName}')" title="Remover aluno da turma">🗑️ Excluir</button>
      </div>
    `;

    return `
      <tr>
        <td data-label="Matrícula" style="font-weight: 600;">${escapeHtml(s.registration)}</td>
        <td data-label="Nome Completo"><strong>${escapeHtml(s.full_name)}</strong></td>
        <td data-label="Dupla">${pairDisplay}</td>
        <td data-label="Termo (TCLE)">${tcleBadge}</td>
        <td data-label="Status da Prova">${statusBadge}</td>
        <td data-label="Nota Final">${scoreDisplay}</td>
        <td data-label="Data de Envio">${dateDisplay}</td>
        <td data-label="Ações da Professora" class="actions-cell">${actionBtns}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// TCLE PROOF CERTIFICATE MODAL
// -------------------------------------------------------------
async function openTcleProofModal(userId, studentName, registration) {
  const modal = document.getElementById('modal-tcle-proof');
  const body = document.getElementById('modal-tcle-body');
  if (!modal || !body) return;

  modal.style.display = 'flex';
  body.innerHTML = `
    <div style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
      <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📜</div>
      <p style="font-size: 0.95rem;">Carregando comprovante do termo...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/admin/student/${userId}/tcle`, {
      headers: getAdminHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao consultar comprovante');

    const sName = escapeHtml(data.student.fullName || studentName);
    const sReg = escapeHtml(data.student.registration || registration);
    const hasAccepted = data.hasAccepted;
    const acceptedAtStr = data.acceptedAt ? new Date(data.acceptedAt).toLocaleString('pt-BR') : 'Pendente de aceite';
    const code = escapeHtml(data.verificationCode || `TCLE-${userId}-${sReg}`);
    const discipline = escapeHtml(data.discipline || 'Estágio em Clínica odontológica integrada infantil I');
    const teacher = escapeHtml(data.teacherName || 'Patricia Drummond');

    body.innerHTML = `
      <div style="background: #ffffff; border: 2px solid ${hasAccepted ? '#22c55e' : '#f59e0b'}; border-radius: 12px; padding: 1.5rem; position: relative;">
        <!-- Header badge -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.25rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: ${hasAccepted ? '#15803d' : '#b45309'}; letter-spacing: 0.05em;">
              FACULDADE ARNALDO • CURSO DE ODONTOLOGIA
            </div>
            <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--text-main); margin: 0.25rem 0 0 0;">
              Comprovante de Aceite Digital do TCLE
            </h2>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.2rem;">
              Termo de Consentimento Livre e Esclarecido • Avaliação Oral com IA
            </div>
          </div>
          <div>
            ${hasAccepted 
              ? `<span style="background: #dcfce7; color: #166534; font-weight: 700; font-size: 0.85rem; padding: 0.4rem 0.85rem; border-radius: 50px; border: 1px solid #86efac; display: inline-flex; align-items: center; gap: 0.35rem;">
                  ✅ Aceite Registrado
                 </span>`
              : `<span style="background: #fef3c7; color: #92400e; font-weight: 700; font-size: 0.85rem; padding: 0.4rem 0.85rem; border-radius: 50px; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 0.35rem;">
                  ⏳ Aceite Pendente
                 </span>`
            }
          </div>
        </div>

        <!-- Student & Discipline Details -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; background: #f8fafc; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem; border: 1px solid #e2e8f0;">
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: block;">Nome do(a) Aluno(a)</span>
            <strong style="font-size: 1.05rem; color: var(--text-main);">${sName}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: block;">Matrícula Acadêmica</span>
            <strong style="font-size: 1.05rem; color: var(--text-main);">${sReg}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: block;">Data e Horário do Aceite</span>
            <strong style="font-size: 0.95rem; color: ${hasAccepted ? '#166534' : '#b45309'};">${acceptedAtStr}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: block;">Docente Responsável</span>
            <strong style="font-size: 0.95rem; color: var(--text-main);">${teacher}</strong>
          </div>
          <div style="grid-column: 1 / -1;">
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: block;">Disciplina</span>
            <span style="font-size: 0.95rem; font-weight: 600; color: var(--primary-dark);">${discipline}</span>
          </div>
        </div>

        <!-- Terms Manifested -->
        <div style="margin-bottom: 1.25rem;">
          <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.6rem;">
            Declarações e Cláusulas Aceitas Digitalmente pelo Aluno:
          </h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; color: #334155; line-height: 1.45;">
            <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
              <span style="color: ${hasAccepted ? '#16a34a' : '#94a3b8'}; font-weight: bold; font-size: 1rem;">✔</span>
              <span><strong>Gravação em Áudio:</strong> Consentiu com a gravação do áudio de suas respostas orais durante a avaliação para posterior transcrição textual.</span>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
              <span style="color: ${hasAccepted ? '#16a34a' : '#94a3b8'}; font-weight: bold; font-size: 1rem;">✔</span>
              <span><strong>Auxílio de Inteligência Artificial:</strong> Concordou com a utilização de ferramenta de IA como instrumento auxiliar de transcrição e sugestão de correção.</span>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
              <span style="color: ${hasAccepted ? '#16a34a' : '#94a3b8'}; font-weight: bold; font-size: 1rem;">✔</span>
              <span><strong>Soberania Docente:</strong> Teve ciência expressa de que a Professora Patricia Drummond é a autoridade responsável pela revisão soberana e lançamento da nota final.</span>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: flex-start;">
              <span style="color: ${hasAccepted ? '#16a34a' : '#94a3b8'}; font-weight: bold; font-size: 1rem;">✔</span>
              <span><strong>Sigilo e Privacidade:</strong> Aceitou que as gravações e transcrições destinam-se exclusivamente a finalidades acadêmicas e didáticas da disciplina.</span>
            </div>
          </div>
        </div>

        <!-- Digital Verification Stamp -->
        <div style="background: ${hasAccepted ? '#f0fdf4' : '#fffbeb'}; border: 1px dashed ${hasAccepted ? '#86efac' : '#fde68a'}; border-radius: 8px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <div style="font-size: 0.7rem; font-weight: 700; color: ${hasAccepted ? '#166534' : '#92400e'}; text-transform: uppercase;">
              🛡️ Código de Autenticação Digital
            </div>
            <div style="font-family: monospace; font-size: 0.9rem; font-weight: 700; color: ${hasAccepted ? '#15803d' : '#b45309'}; letter-spacing: 0.05em;">
              ${code}
            </div>
          </div>
          <div style="font-size: 0.75rem; color: ${hasAccepted ? '#166534' : '#92400e'}; text-align: right;">
            ${hasAccepted ? 'Documento eletrônico autenticado e armazenado' : 'Aguardando confirmação do aluno no sistema'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--danger);">
        <p>Erro ao carregar comprovante: ${escapeHtml(err.message)}</p>
        <button class="btn btn-outline btn-sm" onclick="openTcleProofModal(${userId}, '${studentName}', '${registration}')">Tentar Novamente</button>
      </div>
    `;
  }
}
window.openTcleProofModal = openTcleProofModal;

function closeTcleProofModal() {
  const modal = document.getElementById('modal-tcle-proof');
  if (modal) modal.style.display = 'none';
}
window.closeTcleProofModal = closeTcleProofModal;

function printTcleCertificate() {
  const body = document.getElementById('modal-tcle-body');
  if (body) body.scrollTop = 0;
  window.print();
}
window.printTcleCertificate = printTcleCertificate;

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

    modalReviewStudentName.textContent = exam.isPair ? `Dupla / Grupo: ${exam.full_name}` : `Aluno: ${exam.full_name}`;
    modalReviewStudentMeta.textContent = exam.isPair
      ? `Avaliação Compartilhada (Nota válida para a dupla) | Status: ${exam.status.toUpperCase()} | Enviado em: ${exam.submitted_at ? new Date(exam.submitted_at).toLocaleString('pt-BR') : '-'}`
      : `Matrícula: ${exam.registration} | Status: ${exam.status.toUpperCase()} | Enviado em: ${exam.submitted_at ? new Date(exam.submitted_at).toLocaleString('pt-BR') : '-'}`;
    
    const initialScoreText = exam.total_score !== null && exam.total_score !== undefined
      ? `${Number(exam.total_score).toFixed(1)} / 5.0`
      : '-- / 5.0';
    if (modalTopScoreBadge) modalTopScoreBadge.textContent = initialScoreText;
    if (modalTotalScoreBadge) modalTotalScoreBadge.textContent = initialScoreText;

    modalReviewBody.innerHTML = answers.map((a, idx) => {
      const currentScore = a.final_score !== null && a.final_score !== undefined ? Number(a.final_score).toFixed(1) : '';
      const feedback = a.teacher_feedback || a.ai_feedback || '';

      return `
        <div class="question-review-card">
          <!-- QUESTION HEADER -->
          <div class="review-item-header">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span class="badge badge-primary" style="font-size: 0.8rem; padding: 0.2rem 0.6rem;">Questão ${idx + 1} de 5</span>
                <span class="review-ai-score-pill">
                  Nota Sugerida IA: <strong>${a.ai_score !== null ? Number(a.ai_score).toFixed(1) : '-'} / 5.0</strong>
                </span>
              </div>
              <h4 class="review-question-title">${escapeHtml(a.question)}</h4>
            </div>
          </div>

          <!-- 1. RESPOSTA DO ALUNO (PRINCIPAL FOCO DE LEITURA) -->
          <div class="review-block review-student">
            <div class="review-block-header">
              <strong style="color: #0369a1; font-size: 0.95rem; display: flex; align-items: center; gap: 0.35rem;">
                🗣️ Resposta Transcrita do Aluno (Áudio):
              </strong>
              <span class="badge badge-primary" style="font-size: 0.7rem; padding: 0.15rem 0.45rem;">Áudio</span>
            </div>
            <div class="review-student-text">${escapeHtml(a.student_answer || '[Nenhuma resposta gravada pelo aluno]')}</div>
          </div>

          <!-- 2. GABARITO DA PROFESSORA -->
          <div class="review-block review-expected">
            <div class="review-block-header">
              <strong style="color: #15803d; font-size: 0.92rem;">📚 Resposta Esperada (Gabarito da Professora):</strong>
            </div>
            <div class="review-expected-text">${escapeHtml(a.expected_answer)}</div>
          </div>

          <!-- 3. ANÁLISE DA IA -->
          ${a.ai_feedback ? `
            <div class="review-block review-feedback">
              <div class="review-block-header">
                <strong style="color: #b45309; font-size: 0.92rem;">🤖 Análise e Justificativa Gerada pela IA:</strong>
              </div>
              <div id="ai-feedback-text-${a.answer_id}" class="review-feedback-text">${escapeHtml(a.ai_feedback)}</div>
            </div>
          ` : ''}

          <!-- 4. CONTROLE DE NOTA DA PROFESSORA (COMPACTO E DISCRETO) -->
          <div class="review-teacher-box">
            <div class="review-teacher-top-row">
              <div class="review-teacher-score-group">
                <label for="score-input-${a.answer_id}">Nota Oficial (0 a 5.0):</label>
                <input 
                  type="number" 
                  step="0.1" 
                  min="0" 
                  max="5.0" 
                  id="score-input-${a.answer_id}" 
                  class="form-control review-score-input" 
                  value="${currentScore}"
                  oninput="updateLiveModalAverage()"
                >
              </div>

              <div class="review-teacher-mini-actions">
                ${a.ai_feedback ? `
                  <button 
                    type="button" 
                    class="btn btn-outline btn-xs" 
                    onclick="copyAiCorrectionToTeacher(${a.answer_id})"
                    title="Copiar o texto da IA para o campo de comentários"
                  >
                    📋 Usar Texto IA
                  </button>
                ` : ''}
                <button 
                  type="button"
                  class="btn btn-primary btn-xs" 
                  onclick="saveAnswerGrade(${a.answer_id})"
                  title="Salvar apenas a nota desta questão"
                >
                  💾 Salvar
                </button>
              </div>
            </div>
            
            <div class="review-teacher-comment-group">
              <textarea 
                id="feedback-input-${a.answer_id}" 
                class="form-control review-feedback-textarea" 
                rows="2" 
                placeholder="Comentário da professora para o aluno (opcional)..."
              >${escapeHtml(feedback)}</textarea>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    modalReviewBody.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 2rem;">Erro ao carregar prova: ${escapeHtml(err.message)}</div>`;
  }
}

function updateLiveModalAverage() {
  if (!currentModalAnswers || currentModalAnswers.length === 0) return;
  let sum = 0;
  let count = 0;
  currentModalAnswers.forEach(a => {
    const el = document.getElementById(`score-input-${a.answer_id}`);
    if (el) {
      const val = parseFloat(el.value);
      if (!isNaN(val)) {
        sum += Math.min(5, Math.max(0, val));
        count++;
      }
    }
  });
  const avg = count > 0 ? (Math.round((sum / count) * 10) / 10).toFixed(1) : '--';
  if (modalTopScoreBadge) modalTopScoreBadge.textContent = `${avg} / 5.0`;
  if (modalTotalScoreBadge) modalTotalScoreBadge.textContent = `${avg} / 5.0`;
}
window.updateLiveModalAverage = updateLiveModalAverage;

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
  if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 5) {
    alert('A nota deve ser um número entre 0 e 5.0.');
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

// -------------------------------------------------------------
// LIVE QUESTIONS MODAL (ACOMPANHAMENTO AO VIVO DAS PERGUNTAS)
// -------------------------------------------------------------
async function openLiveQuestionsModal(examId) {
  activeLiveExamId = examId;
  const modal = document.getElementById('modal-live-questions');
  const body = document.getElementById('modal-live-q-body');

  if (!modal || !body) return;
  modal.style.display = 'flex';

  body.innerHTML = `
    <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
      <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📖</div>
      <p style="font-size: 1rem;">Carregando perguntas sorteadas da prova...</p>
    </div>
  `;

  await loadLiveQuestionsData(examId);

  if (liveQuestionsInterval) clearInterval(liveQuestionsInterval);
  liveQuestionsInterval = setInterval(() => {
    if (activeLiveExamId === examId && modal.style.display !== 'none') {
      loadLiveQuestionsData(examId, true);
    }
  }, 4000);
}
window.openLiveQuestionsModal = openLiveQuestionsModal;

async function loadLiveQuestionsData(examId, isSilent = false) {
  const body = document.getElementById('modal-live-q-body');
  const meta = document.getElementById('modal-live-q-meta');
  const badge = document.getElementById('modal-live-q-badge');
  const timer = document.getElementById('modal-live-q-timer');

  try {
    const res = await fetch(`/api/admin/exam/${examId}/live-questions`, {
      headers: getAdminHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao carregar perguntas');

    const exam = data.exam;
    const questions = data.questions || [];

    if (meta) {
      meta.textContent = `${exam.full_name} | Prova #${exam.id}`;
    }

    if (badge) {
      if (exam.status === 'draft') {
        badge.className = 'badge badge-warning';
        badge.textContent = '🎙️ Prova em Andamento (Ao Vivo)';
      } else if (exam.status === 'submitted') {
        badge.className = 'badge badge-primary';
        badge.textContent = 'Enviada pelos Alunos';
      } else if (exam.status === 'graded') {
        badge.className = 'badge badge-success';
        badge.textContent = 'Avaliação Concluída';
      } else {
        badge.className = 'badge badge-gray';
        badge.textContent = exam.status;
      }
    }

    if (timer) {
      timer.textContent = `Última atualização: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    if (questions.length === 0) {
      body.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          Nenhuma questão encontrada para este exame.
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        ${questions.map((q, idx) => {
          const num = q.order_num || (idx + 1);
          const hasAnswer = !!(q.student_answer && q.student_answer.trim().length > 0);

          return `
            <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge badge-primary" style="font-size: 0.85rem; font-weight: 700; padding: 0.25rem 0.65rem;">
                    Questão ${num} de ${questions.length}
                  </span>
                </div>
                <div>
                  ${hasAnswer 
                    ? `<span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700;">✅ Resposta Transcrita</span>`
                    : `<span class="badge badge-gray" style="font-size: 0.75rem;">⏳ Aguardando Aluno Falar...</span>`
                  }
                </div>
              </div>

              <!-- Question Enunciado -->
              <div style="margin-bottom: 0.85rem;">
                <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.25rem;">Enunciado da Pergunta:</div>
                <div style="font-size: 1.05rem; font-weight: 600; color: var(--text-main); line-height: 1.5; background: #fafafa; padding: 0.75rem 1rem; border-radius: 6px; border-left: 4px solid #0284c7;">
                  ${escapeHtml(q.question)}
                </div>
              </div>

              <!-- Expected Answer / Teacher Answer Key -->
              <div style="margin-bottom: 0.85rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; padding: 0.75rem 1rem;">
                <div style="font-size: 0.8rem; font-weight: 700; color: #0f766e; text-transform: uppercase; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.35rem;">
                  🔑 <span>Gabarito de Referência (Resposta Esperada da Professora):</span>
                </div>
                <div style="font-size: 0.95rem; color: #334155; line-height: 1.5; white-space: pre-wrap;">
                  ${escapeHtml(q.expected_answer || 'Não especificada no banco de questões.')}
                </div>
              </div>

              <!-- Student Transcribed Live Answer -->
              <div style="background: ${hasAnswer ? '#f0fdf4' : '#fffbeb'}; border-radius: 6px; border: 1px solid ${hasAnswer ? '#bbf7d0' : '#fef3c7'}; padding: 0.75rem 1rem;">
                <div style="font-size: 0.8rem; font-weight: 700; color: ${hasAnswer ? '#15803d' : '#b45309'}; text-transform: uppercase; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.35rem;">
                  🎙️ <span>Transcrição da Resposta do Aluno:</span>
                </div>
                <div style="font-size: 0.95rem; color: ${hasAnswer ? '#166534' : '#92400e'}; line-height: 1.5; font-style: ${hasAnswer ? 'normal' : 'italic'}; white-space: pre-wrap;">
                  ${hasAnswer ? escapeHtml(q.student_answer) : 'O aluno ainda não gravou resposta para esta questão.'}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    if (!isSilent) {
      body.innerHTML = `
        <div style="color: var(--danger); text-align: center; padding: 2rem;">
          Erro ao carregar perguntas: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }
}

function refreshLiveQuestions() {
  if (activeLiveExamId) {
    loadLiveQuestionsData(activeLiveExamId);
    showToast('🔄 Perguntas e transcrições atualizadas!');
  }
}
window.refreshLiveQuestions = refreshLiveQuestions;

function closeLiveQuestionsModal() {
  const modal = document.getElementById('modal-live-questions');
  if (modal) modal.style.display = 'none';
  if (liveQuestionsInterval) {
    clearInterval(liveQuestionsInterval);
    liveQuestionsInterval = null;
  }
  activeLiveExamId = null;
}
window.closeLiveQuestionsModal = closeLiveQuestionsModal;

