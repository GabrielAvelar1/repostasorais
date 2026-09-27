/**
 * SISTEMA DE PROVA ORAL - LÓGICA DO ALUNO & TRANSCRIÇÃO DE VOZ
 */

// State
let currentUser = null;
let currentExam = null;
let questions = [];
let currentQuestionIndex = 0;
let recognition = null;
let isRecording = false;
let isTranscribing = false;
let autoSaveTimer = null;
let statusPollingInterval = null;

function setTranscribingState(transcribing) {
  isTranscribing = transcribing;
  if (btnPrevQ) btnPrevQ.disabled = transcribing;
  if (btnNextQ) btnNextQ.disabled = transcribing;
  if (btnFinishExam) btnFinishExam.disabled = transcribing;
  if (btnSaveDraft) btnSaveDraft.disabled = transcribing;
  
  if (progressStepsContainer) {
    const stepBtns = progressStepsContainer.querySelectorAll('.step-indicator');
    stepBtns.forEach(b => {
      b.style.pointerEvents = transcribing ? 'none' : 'auto';
      b.style.opacity = transcribing ? '0.5' : '1';
    });
  }
}

// DOM Elements
const viewLogin = document.getElementById('view-login');
const viewTcle = document.getElementById('view-tcle');
const viewWaiting = document.getElementById('view-waiting');
const viewExam = document.getElementById('view-exam');
const viewSubmitted = document.getElementById('view-submitted');
const viewResults = document.getElementById('view-results');

// TCLE Elements
const tcleAcceptRadio = document.getElementById('tcle-accept');
const tcleDeclineRadio = document.getElementById('tcle-decline');
const tcleAcceptCard = document.getElementById('tcle-accept-card');
const tcleDeclineCard = document.getElementById('tcle-decline-card');
const tcleDateDisplay = document.getElementById('tcle-date-display');
const tcleStudentName = document.getElementById('tcle-student-name');
const tcleStudentReg = document.getElementById('tcle-student-reg');
const tcleDigitalStamp = document.getElementById('tcle-digital-stamp');
const tcleDeclineNotice = document.getElementById('tcle-decline-notice');
const btnTcleSubmit = document.getElementById('btn-tcle-submit');
const btnTcleLogout = document.getElementById('btn-tcle-logout');

const headerUserSection = document.getElementById('header-user-section');
const userDisplayName = document.getElementById('user-display-name');
const userDisplayReg = document.getElementById('user-display-reg');
const btnLogout = document.getElementById('btn-logout');

const formLogin = document.getElementById('form-login');
const inputReg = document.getElementById('login-reg');
const inputName = document.getElementById('login-name');

const waitingStudentName = document.getElementById('waiting-student-name');
const btnCheckExamNow = document.getElementById('btn-check-exam-now');

const currentQIndexEl = document.getElementById('current-q-index');
const progressStepsContainer = document.getElementById('progress-steps-container');
const questionTextEl = document.getElementById('question-text');
const studentAnswerInput = document.getElementById('student-answer-input');

const btnToggleRecord = document.getElementById('btn-toggle-record');
const micIcon = document.getElementById('mic-icon');
const micText = document.getElementById('mic-text');
const speechStatus = document.getElementById('speech-status');

const btnPrevQ = document.getElementById('btn-prev-q');
const btnNextQ = document.getElementById('btn-next-q');
const btnSaveDraft = document.getElementById('btn-save-draft');
const btnFinishExam = document.getElementById('btn-finish-exam');
const btnCheckGradesNow = document.getElementById('btn-check-grades-now');

// -------------------------------------------------------------
// INITIALIZATION & SESSION RESTORE
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupSpeechRecognition();
  setupMobileAudioFallback();
  restoreSession();
  setupEventListeners();
});

function restoreSession() {
  const savedUser = localStorage.getItem('oral_exam_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      if (currentUser.role === 'teacher') {
        window.location.href = '/admin.html';
        return;
      }
      renderUserHeader();
      if (!currentUser.tcleAccepted) {
        showTcleView();
      } else {
        loadStudentFlow();
      }
    } catch (e) {
      localStorage.removeItem('oral_exam_user');
      showView(viewLogin);
    }
  } else {
    showView(viewLogin);
  }
}

function renderUserHeader() {
  if (currentUser) {
    userDisplayName.textContent = currentUser.fullName;
    userDisplayReg.textContent = `Matrícula: ${currentUser.registration}`;
    headerUserSection.style.display = 'flex';
  } else {
    headerUserSection.style.display = 'none';
  }
}

function showView(viewElement) {
  [viewLogin, viewTcle, viewWaiting, viewExam, viewSubmitted, viewResults].forEach(v => {
    if (v) v.style.display = 'none';
  });
  if (viewElement) viewElement.style.display = 'block';
}

function showTcleView() {
  if (!currentUser) return;

  const today = new Date();
  const formattedDate = today.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  if (tcleDateDisplay) tcleDateDisplay.textContent = formattedDate;
  if (tcleStudentName) tcleStudentName.textContent = currentUser.fullName || '';
  if (tcleStudentReg) tcleStudentReg.textContent = currentUser.registration || '';

  // Reset radio choices
  if (tcleAcceptRadio) tcleAcceptRadio.checked = false;
  if (tcleDeclineRadio) tcleDeclineRadio.checked = false;
  if (tcleAcceptCard) {
    tcleAcceptCard.style.borderColor = '#cbd5e1';
    tcleAcceptCard.style.background = '#ffffff';
  }
  if (tcleDeclineCard) {
    tcleDeclineCard.style.borderColor = '#cbd5e1';
    tcleDeclineCard.style.background = '#ffffff';
  }
  if (tcleDeclineNotice) tcleDeclineNotice.style.display = 'none';
  if (tcleDigitalStamp) {
    tcleDigitalStamp.innerHTML = '<span style="color: #64748b; font-style: italic;">Aguardando manifestação acima...</span>';
  }
  if (btnTcleSubmit) {
    btnTcleSubmit.disabled = true;
    btnTcleSubmit.textContent = 'Confirmar e Prosseguir para a Fila da Prova ➔';
    btnTcleSubmit.style.background = '';
  }

  showView(viewTcle);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------
function setupEventListeners() {
  // Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reg = inputReg.value.trim();
    const name = inputName.value.trim();
    if (!reg || !name) return;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration: reg, fullName: name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao entrar');

      currentUser = data.user;
      localStorage.setItem('oral_exam_user', JSON.stringify(currentUser));

      if (currentUser.role === 'teacher') {
        window.location.href = '/admin.html';
        return;
      }

      renderUserHeader();
      if (!currentUser.tcleAccepted) {
        showTcleView();
      } else {
        loadStudentFlow();
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // TCLE Radio Options
  if (tcleAcceptRadio) {
    tcleAcceptRadio.addEventListener('change', () => {
      if (tcleAcceptRadio.checked) {
        if (tcleAcceptCard) {
          tcleAcceptCard.style.borderColor = 'var(--primary)';
          tcleAcceptCard.style.background = 'var(--primary-light)';
        }
        if (tcleDeclineCard) {
          tcleDeclineCard.style.borderColor = '#cbd5e1';
          tcleDeclineCard.style.background = '#ffffff';
        }
        if (tcleDeclineNotice) tcleDeclineNotice.style.display = 'none';

        const now = new Date();
        const timeStr = now.toLocaleTimeString('pt-BR');
        if (tcleDigitalStamp) {
          tcleDigitalStamp.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 0.35rem; color: #166534; font-weight: 700; background: #dcfce7; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid #86efac; font-size: 0.85rem;">
              <span>✓</span> ACEITE DIGITAL REGISTRADO (${currentUser?.fullName || ''} - Mat: ${currentUser?.registration || ''} às ${timeStr})
            </span>
          `;
        }

        if (btnTcleSubmit) {
          btnTcleSubmit.disabled = false;
          btnTcleSubmit.textContent = 'Confirmar e Prosseguir para a Fila da Prova ➔';
          btnTcleSubmit.style.background = '';
        }
      }
    });
  }

  if (tcleDeclineRadio) {
    tcleDeclineRadio.addEventListener('change', () => {
      if (tcleDeclineRadio.checked) {
        if (tcleDeclineCard) {
          tcleDeclineCard.style.borderColor = '#dc2626';
          tcleDeclineCard.style.background = '#fee2e2';
        }
        if (tcleAcceptCard) {
          tcleAcceptCard.style.borderColor = '#cbd5e1';
          tcleAcceptCard.style.background = '#ffffff';
        }
        if (tcleDeclineNotice) tcleDeclineNotice.style.display = 'block';

        if (tcleDigitalStamp) {
          tcleDigitalStamp.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 0.35rem; color: #991b1b; font-weight: 700; background: #fee2e2; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid #fca5a5; font-size: 0.85rem;">
              <span>✕</span> MANIFESTAÇÃO DE RECUSA REGISTRADA
            </span>
          `;
        }

        if (btnTcleSubmit) {
          btnTcleSubmit.disabled = false;
          btnTcleSubmit.textContent = 'Confirmar Opção Alternativa e Sair';
          btnTcleSubmit.style.background = '#dc2626';
        }
      }
    });
  }

  // TCLE Submit
  if (btnTcleSubmit) {
    btnTcleSubmit.addEventListener('click', async () => {
      if (!tcleAcceptRadio?.checked && !tcleDeclineRadio?.checked) {
        alert('Por favor, selecione uma das opções de consentimento para prosseguir.');
        return;
      }

      if (tcleDeclineRadio?.checked) {
        alert(
          'Você optou por não realizar a avaliação assistida por Inteligência Artificial.\n\n' +
          'Conforme o Item 4 do TCLE, você NÃO sofrerá nenhuma penalidade acadêmica.\n\n' +
          'Por favor, apresente-se à Professora Patrícia Drummond para realizar a avaliação alternativa.'
        );
        localStorage.removeItem('oral_exam_user');
        currentUser = null;
        renderUserHeader();
        showView(viewLogin);
        return;
      }

      btnTcleSubmit.disabled = true;
      btnTcleSubmit.textContent = 'Gravando consentimento...';

      try {
        const payload = {
          userId: currentUser?.id,
          registration: currentUser?.registration,
          fullName: currentUser?.fullName,
          accepted: true
        };

        const res = await fetch('/api/auth/tcle-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao registrar consentimento.');

        if (data.user) {
          currentUser = {
            id: data.user.id,
            registration: data.user.registration,
            fullName: data.user.full_name || data.user.fullName,
            role: data.user.role || 'student',
            tcleAccepted: true
          };
        } else {
          currentUser.tcleAccepted = true;
        }
        localStorage.setItem('oral_exam_user', JSON.stringify(currentUser));
        renderUserHeader();

        showToast('✅ Termo de Consentimento aceito com sucesso!');
        loadStudentFlow();
      } catch (err) {
        alert(err.message || 'Erro ao salvar consentimento.');
      } finally {
        btnTcleSubmit.disabled = false;
        btnTcleSubmit.textContent = 'Confirmar e Prosseguir para a Fila da Prova ➔';
      }
    });
  }

  // TCLE Return / Logout
  if (btnTcleLogout) {
    btnTcleLogout.addEventListener('click', () => {
      localStorage.removeItem('oral_exam_user');
      currentUser = null;
      renderUserHeader();
      showView(viewLogin);
    });
  }

  // Logout
  btnLogout.addEventListener('click', () => {
    if (confirm('Deseja realmente sair?')) {
      if (isRecording) stopRecording();
      clearInterval(statusPollingInterval);
      localStorage.removeItem('oral_exam_user');
      currentUser = null;
      currentExam = null;
      renderUserHeader();
      showView(viewLogin);
    }
  });

  // Waiting Room manual check
  btnCheckExamNow.addEventListener('click', async () => {
    btnCheckExamNow.disabled = true;
    btnCheckExamNow.textContent = 'Verificando...';
    await loadStudentFlow();
    setTimeout(() => {
      btnCheckExamNow.disabled = false;
      btnCheckExamNow.textContent = 'Verificar agora';
    }, 600);
  });

  // Speech Recognition toggle
  btnToggleRecord.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Input editing & auto-save trigger
  studentAnswerInput.addEventListener('input', () => {
    if (questions[currentQuestionIndex]) {
      questions[currentQuestionIndex].student_answer = studentAnswerInput.value;
      updateStepsUI();
      scheduleAutoSave();
    }
  });

  // Question navigation
  btnPrevQ.addEventListener('click', () => {
    if (isTranscribing) {
      showToast('⏳ Aguarde a Inteligência Artificial transcrever sua resposta antes de mudar de questão!');
      return;
    }
    if (currentQuestionIndex > 0) {
      saveDraftNow();
      currentQuestionIndex--;
      renderCurrentQuestion();
    }
  });

  btnNextQ.addEventListener('click', () => {
    if (isTranscribing) {
      showToast('⏳ Aguarde a Inteligência Artificial transcrever sua resposta antes de mudar de questão!');
      return;
    }
    if (currentQuestionIndex < questions.length - 1) {
      saveDraftNow();
      currentQuestionIndex++;
      renderCurrentQuestion();
    }
  });

  // Manual save draft
  btnSaveDraft.addEventListener('click', async () => {
    if (isTranscribing) {
      showToast('⏳ Aguarde a transcrição do áudio ser concluída!');
      return;
    }
    await saveDraftNow();
    showToast('💾 Rascunho salvo com sucesso!');
  });

  // Submit exam
  btnFinishExam.addEventListener('click', async () => {
    if (isTranscribing) {
      showToast('⏳ Aguarde a transcrição do áudio ser concluída antes de enviar a prova!');
      return;
    }
    if (isRecording) {
      try { await stopRecording(); } catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }

    // Check if any question is empty
    const emptyCount = questions.filter(q => !(q.student_answer || '').trim()).length;
    let msg = 'Tem certeza que deseja finalizar e enviar sua prova oral?';
    if (emptyCount > 0) {
      msg = `Atenção: você ainda tem ${emptyCount} questão(ões) sem resposta. Deseja enviar mesmo assim?`;
    }

    if (!confirm(msg)) return;

    btnFinishExam.disabled = true;
    btnFinishExam.textContent = 'Enviando prova...';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const payload = {
        examId: currentExam.id,
        answers: questions.map(q => ({
          questionId: q.question_id,
          studentAnswer: q.student_answer || ''
        }))
      };

      const res = await fetch('/api/exam/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar prova');

      showToast('🎉 Prova enviada com sucesso!');
      showView(viewSubmitted);
      startGradesPolling();
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      if (isTimeout) {
        showToast('Conexão lenta. Verificando envio da prova...');
      } else {
        alert(err.message || 'Erro ao enviar prova');
      }
      await loadStudentFlow();
    } finally {
      btnFinishExam.disabled = false;
      btnFinishExam.textContent = '✓ Finalizar e Enviar Prova';
    }
  });

  // Check grades now
  btnCheckGradesNow.addEventListener('click', () => checkGradesRelease(true));
}

// -------------------------------------------------------------
// STUDENT FLOW CONTROLLER
// -------------------------------------------------------------
async function loadStudentFlow() {
  if (!currentUser) return;
  clearInterval(statusPollingInterval);

  try {
    const res = await fetch(`/api/exam/my-exam?userId=${currentUser.id}`, {
      headers: { 'x-user-id': currentUser.id }
    });

    if (res.status === 403) {
      const errData = await res.json().catch(() => ({}));
      if (errData.needsTcle) {
        showTcleView();
        return;
      }
      // Exam is locked by teacher
      waitingStudentName.textContent = currentUser.fullName;
      showView(viewWaiting);
      startExamStatusPolling();
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 404) {
        localStorage.removeItem('oral_exam_user');
        currentUser = null;
        renderUserHeader();
        showView(viewLogin);
        showToast('Sessão reiniciada. Por favor, entre novamente com sua matrícula.');
        return;
      }
      throw new Error(data.error || 'Erro ao carregar prova');
    }

    currentExam = data.exam;
    questions = data.questions || [];

    if (currentExam.status === 'draft') {
      showView(viewExam);
      currentQuestionIndex = 0;
      renderSteps();
      renderCurrentQuestion();
    } else {
      // Exam is submitted or graded
      checkGradesRelease();
    }
  } catch (err) {
    console.error('Flow error:', err);
    showToast('Erro ao carregar dados da prova.');
  }
}

// Poll until teacher approves the pair exam
function startExamStatusPolling() {
  clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/exam/my-exam?userId=${currentUser.id}`, {
        headers: { 'x-user-id': currentUser.id }
      });
      if (res.ok) {
        clearInterval(statusPollingInterval);
        showToast('🎉 A Professora liberou a sua prova!');
        loadStudentFlow();
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 3500);
}

// Check if grades have been released
async function checkGradesRelease(manualClick = false) {
  if (manualClick && btnCheckGradesNow) {
    btnCheckGradesNow.disabled = true;
    btnCheckGradesNow.innerHTML = '<span>⏳</span> Verificando no sistema...';
  }

  try {
    const res = await fetch(`/api/exam/my-result?userId=${currentUser.id}`, {
      headers: { 'x-user-id': currentUser.id }
    });
    const data = await res.json();

    if (!data.gradesReleased) {
      showView(viewSubmitted);

      // Render student's submitted answers without questions or scores
      const submittedContainer = document.getElementById('submitted-answers-container');
      const submittedList = document.getElementById('submitted-answers-list');
      if (submittedContainer && submittedList && data.myAnswers && data.myAnswers.length > 0) {
        submittedList.innerHTML = '';
        data.myAnswers.forEach(ans => {
          const itemDiv = document.createElement('div');
          itemDiv.style.cssText = 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem 1rem;';
          itemDiv.innerHTML = `
            <strong style="color: #475569; display: block; margin-bottom: 0.35rem; font-size: 0.95rem;">Questão ${ans.order_num}:</strong>
            <p style="margin: 0; color: #1e293b; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5;">${escapeHtml(ans.student_answer || '[Nenhuma resposta inserida]')}</p>
          `;
          submittedList.appendChild(itemDiv);
        });
        submittedContainer.style.display = 'block';
      }

      startGradesPolling();
      if (manualClick) {
        showToast('⏳ A Professora Patricia ainda não liberou as notas. O sistema atualiza automaticamente!');
      }
    } else {
      clearInterval(statusPollingInterval);
      renderResults(data);
      showView(viewResults);
      if (manualClick) {
        showToast('🎉 As notas foram liberadas pela Professora!');
      }
    }
  } catch (err) {
    console.error('Error checking grades:', err);
    if (manualClick) {
      showToast('❌ Erro ao consultar notas. Verifique sua conexão e tente novamente.');
    }
  } finally {
    if (manualClick && btnCheckGradesNow) {
      setTimeout(() => {
        btnCheckGradesNow.disabled = false;
        btnCheckGradesNow.innerHTML = '🔄 Verificar se as Notas Foram Liberadas';
      }, 600);
    }
  }
}

function startGradesPolling() {
  clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/exam/status');
      const data = await res.json();
      if (data.gradesReleased) {
        clearInterval(statusPollingInterval);
        checkGradesRelease();
      }
    } catch (e) {}
  }, 5000);
}

// -------------------------------------------------------------
// EXAM INTERFACE (QUESTIONS & STEPS)
// -------------------------------------------------------------
function renderSteps() {
  progressStepsContainer.innerHTML = '';
  questions.forEach((q, idx) => {
    const stepBtn = document.createElement('div');
    stepBtn.className = 'step-indicator';
    stepBtn.textContent = idx + 1;
    stepBtn.title = `Questão ${idx + 1}`;
    stepBtn.addEventListener('click', () => {
      if (isTranscribing) {
        showToast('⏳ Aguarde a Inteligência Artificial transcrever sua resposta antes de mudar de questão!');
        return;
      }
      saveDraftNow();
      currentQuestionIndex = idx;
      renderCurrentQuestion();
    });
    progressStepsContainer.appendChild(stepBtn);
  });
  updateStepsUI();
}

function updateStepsUI() {
  const steps = progressStepsContainer.querySelectorAll('.step-indicator');
  steps.forEach((step, idx) => {
    step.classList.remove('active', 'filled');
    if (idx === currentQuestionIndex) {
      step.classList.add('active');
    }
    const q = questions[idx];
    if (q && (q.student_answer || '').trim().length > 0) {
      step.classList.add('filled');
    }
  });
}

function renderCurrentQuestion() {
  if (isRecording) stopRecording();

  const q = questions[currentQuestionIndex];
  if (!q) return;

  currentQIndexEl.textContent = currentQuestionIndex + 1;
  questionTextEl.textContent = q.question;
  studentAnswerInput.value = q.student_answer || '';

  // Nav buttons visibility
  btnPrevQ.style.visibility = currentQuestionIndex === 0 ? 'hidden' : 'visible';

  if (currentQuestionIndex === questions.length - 1) {
    btnNextQ.style.display = 'none';
    btnFinishExam.style.display = 'inline-flex';
  } else {
    btnNextQ.style.display = 'inline-flex';
    btnFinishExam.style.display = 'none';
  }

  updateStepsUI();
  studentAnswerInput.focus();
}

// -------------------------------------------------------------
// AUDIO RECORDING & LIVE SPEECH-TO-TEXT (ROBUST WEB SPEECH API)
// -------------------------------------------------------------
// -------------------------------------------------------------
// AUDIO RECORDING & LIVE SPEECH-TO-TEXT (HYBRID: MEDIARECORDER + SPEECH API + AI)
// -------------------------------------------------------------
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingSeconds = 0;
let recordingTimerInterval = null;
let restartRecognitionTimer = null;

const recordingTimerEl = document.getElementById('recording-timer');
const audioPreviewContainer = document.getElementById('audio-preview-container');
const audioPreview = document.getElementById('audio-preview');
const mobileMicInput = document.getElementById('mobile-mic-input');

function setupMobileAudioFallback() {
  if (!mobileMicInput) return;
  mobileMicInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const targetIdx = currentQuestionIndex;
    setTranscribingState(true);
    speechStatus.textContent = '⏳ Áudio capturado! Transcrevendo com Inteligência Artificial... Por favor, aguarde.';
    speechStatus.classList.add('active');

    // Preview
    if (audioPreview && audioPreviewContainer) {
      audioPreview.src = URL.createObjectURL(file);
      audioPreviewContainer.style.display = 'block';
    }

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Audio = reader.result;
        try {
          const res = await fetch('/api/exam/transcribe-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioData: base64Audio,
              mimeType: file.type || 'audio/mp4'
            })
          });
          const data = await res.json();
          if (data.transcript && data.transcript.trim()) {
            const transcribed = data.transcript.trim();
            if (questions[targetIdx]) {
              const existing = (questions[targetIdx].student_answer || '').trim();
              const fullText = existing ? `${existing} ${transcribed}` : transcribed;
              questions[targetIdx].student_answer = fullText;
              if (currentQuestionIndex === targetIdx) {
                studentAnswerInput.value = fullText;
                studentAnswerInput.dispatchEvent(new Event('input'));
              }
              updateStepsUI();
              scheduleAutoSave();
            }
            speechStatus.textContent = '✅ Áudio transcrito com sucesso! Você pode editar o texto se quiser.';
          } else {
            speechStatus.textContent = 'Áudio gravado com sucesso! Digite ou ajuste sua resposta abaixo.';
          }
        } catch (err) {
          console.warn('Transcription error:', err);
          speechStatus.textContent = 'Áudio gravado. Você pode digitar sua resposta abaixo.';
        } finally {
          setTranscribingState(false);
          speechStatus.classList.remove('active');
        }
      };
    } catch (err) {
      console.warn('FileReader error:', err);
      setTranscribingState(false);
      speechStatus.classList.remove('active');
    }
  });
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log('SpeechRecognition não suportado nativamente. Usando MediaRecorder + IA.');
    return;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let baseTranscript = '';

    recognition.onstart = () => {
      baseTranscript = studentAnswerInput.value.trim();
      if (baseTranscript.length > 0) baseTranscript += ' ';
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let newFinal = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          newFinal += event.results[i][0].transcript + ' ';
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (newFinal) baseTranscript += newFinal;

      const currentCombined = (baseTranscript + interimTranscript).trim();
      if (currentCombined) {
        studentAnswerInput.value = currentCombined;
        if (questions[currentQuestionIndex]) {
          questions[currentQuestionIndex].student_answer = currentCombined;
          updateStepsUI();
          scheduleAutoSave();
        }
      }
    };

    recognition.onerror = (event) => {
      console.log('[SpeechRecognition Error]', event.error);
      if (event.error === 'network' || event.error === 'not-allowed') {
        try { recognition.stop(); } catch (e) {}
        recognition = null;
        if (speechStatus) {
          speechStatus.textContent = '🔴 Gravando áudio via microfone... A Inteligência Artificial transcreverá sua fala ao parar.';
        }
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        clearTimeout(restartRecognitionTimer);
        restartRecognitionTimer = setTimeout(() => {
          if (isRecording && recognition) {
            try { recognition.start(); } catch (e) {}
          }
        }, 150);
      }
    };
  } catch (e) {
    console.warn('SpeechRecognition init error:', e);
  }
}

async function startRecording() {
  try {
    // 1. Request microphone access
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (mobileMicInput) {
        speechStatus.textContent = '📱 Abrindo gravador nativo do seu iPhone/celular...';
        mobileMicInput.click();
        return;
      }
      alert('Seu navegador não suporta gravação de áudio no microfone.');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 2. Initialize MediaRecorder (Standard for Chrome, Brave, Safari, Android, iOS)
    recordedChunks = [];
    const mimeOptions = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'];
    let selectedMime = '';
    for (const m of mimeOptions) {
      if (MediaRecorder.isTypeSupported(m)) {
        selectedMime = m;
        break;
      }
    }

    mediaRecorder = selectedMime 
      ? new MediaRecorder(mediaStream, { mimeType: selectedMime })
      : new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.start(250); // Slice every 250ms

    // 3. Start Timer
    isRecording = true;
    recordingSeconds = 0;
    if (recordingTimerEl) {
      recordingTimerEl.textContent = '00:00';
      recordingTimerEl.style.display = 'inline-block';
    }
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      if (recordingTimerEl) recordingTimerEl.textContent = `${mins}:${secs}`;
    }, 1000);

    // 4. Update UI
    btnToggleRecord.classList.add('recording');
    micIcon.textContent = '⏹️';
    micText.textContent = 'Parar e Salvar Áudio';
    speechStatus.textContent = '🔴 Gravando áudio... Fale sua resposta normalmente.';
    speechStatus.classList.add('active');

    // 5. Try SpeechRecognition in parallel if browser allows
    if (recognition) {
      try { recognition.start(); } catch (e) {}
    }

  } catch (err) {
    console.error('Error starting recording:', err);
    alert('Não foi possível acessar o microfone. Verifique se concedeu permissão no navegador.');
    cleanupRecordingUI();
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  clearInterval(recordingTimerInterval);
  clearTimeout(restartRecognitionTimer);

  if (recordingTimerEl) recordingTimerEl.style.display = 'none';

  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }

  btnToggleRecord.classList.remove('recording');
  micIcon.textContent = '🎤';
  micText.textContent = 'Gravar Resposta por Voz';
  speechStatus.classList.remove('active');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = async () => {
      const mimeType = mediaRecorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(recordedChunks, { type: mimeType });

      // Enable preview player
      if (audioPreview && audioPreviewContainer && audioBlob.size > 0) {
        audioPreview.src = URL.createObjectURL(audioBlob);
        audioPreviewContainer.style.display = 'block';
      }

      // Send recorded audio to backend AI for transcription
      if (audioBlob.size > 100) {
        const targetIdx = currentQuestionIndex;
        setTranscribingState(true);
        speechStatus.textContent = '⏳ Áudio capturado! A Inteligência Artificial está transcrevendo sua resposta... Por favor, aguarde.';
        speechStatus.classList.add('active');
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result;
            try {
              const res = await fetch('/api/exam/transcribe-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audioData: base64Audio,
                  mimeType: mimeType
                })
              });
              const data = await res.json();
              if (data.transcript && data.transcript.trim()) {
                const transcribed = data.transcript.trim();
                if (questions[targetIdx]) {
                  const existing = (questions[targetIdx].student_answer || '').trim();
                  const newText = existing ? `${existing} ${transcribed}` : transcribed;
                  questions[targetIdx].student_answer = newText;
                  if (currentQuestionIndex === targetIdx) {
                    studentAnswerInput.value = newText;
                    studentAnswerInput.dispatchEvent(new Event('input'));
                  }
                  updateStepsUI();
                  scheduleAutoSave();
                }
                speechStatus.textContent = '✅ Áudio transcrito com sucesso pela IA! Você pode editar o texto se quiser.';
              } else {
                speechStatus.textContent = 'Áudio gravado. Você pode falar novamente ou digitar no campo abaixo.';
              }
            } catch (apiErr) {
              console.warn('Backend transcription error:', apiErr);
              speechStatus.textContent = 'Áudio salvo. Você pode digitar ou complementar sua resposta abaixo.';
            } finally {
              setTranscribingState(false);
              speechStatus.classList.remove('active');
            }
          };
        } catch (e) {
          console.warn('FileReader error:', e);
          setTranscribingState(false);
          speechStatus.classList.remove('active');
        }
      } else {
        speechStatus.textContent = 'Gravação muito curta. Clique novamente para gravar.';
      }

      // Cleanup stream
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
    };

    mediaRecorder.stop();
  } else {
    cleanupRecordingUI();
  }
}

function cleanupRecordingUI() {
  isRecording = false;
  clearInterval(recordingTimerInterval);
  if (recordingTimerEl) recordingTimerEl.style.display = 'none';
  btnToggleRecord.classList.remove('recording');
  micIcon.textContent = '🎤';
  micText.textContent = 'Gravar Resposta por Voz';
  speechStatus.textContent = 'Clique no botão acima e fale sua resposta. Funciona no computador e no celular.';
  speechStatus.classList.remove('active');
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
}

// -------------------------------------------------------------
// AUTO-SAVE DRAFT
// -------------------------------------------------------------
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveDraftNow();
  }, 1200);
}

async function saveDraftNow() {
  if (!currentExam || !questions.length) return;
  // Update current in memory
  if (questions[currentQuestionIndex]) {
    questions[currentQuestionIndex].student_answer = studentAnswerInput.value;
  }

  try {
    await fetch('/api/exam/save-draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUser.id
      },
      body: JSON.stringify({
        examId: currentExam.id,
        answers: questions.map(q => ({
          questionId: q.question_id,
          studentAnswer: q.student_answer || ''
        }))
      })
    });
  } catch (e) {
    console.warn('Draft save failed:', e);
  }
}

// -------------------------------------------------------------
// RENDER FINAL RESULTS
// -------------------------------------------------------------
function renderResults(data) {
  const totalScoreEl = document.getElementById('results-total-score');
  const questionsListEl = document.getElementById('results-questions-list');

  const formattedScore = data.totalScore !== null && data.totalScore !== undefined
    ? Number(data.totalScore).toFixed(1)
    : '-';
  totalScoreEl.textContent = formattedScore;

  questionsListEl.innerHTML = '';
  (data.questions || []).forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-review-card';

    const scoreNum = q.score !== null && q.score !== undefined ? Number(q.score).toFixed(1) : '-';

    card.innerHTML = `
      <div class="review-item-header">
        <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">
          Questão ${idx + 1}: ${q.question}
        </h4>
        <span class="review-score-badge">Nota: ${scoreNum} / 5.0</span>
      </div>

      <div class="review-block review-student">
        <strong style="color: #475569;">Sua Resposta:</strong>
        <p style="margin-top: 0.25rem; white-space: pre-wrap;">${escapeHtml(q.student_answer || '[Sem resposta]')}</p>
      </div>

      <div class="review-block review-expected">
        <strong style="color: #166534;">Resposta Esperada (Referência da Professora):</strong>
        <p style="margin-top: 0.25rem; white-space: pre-wrap;">${escapeHtml(q.expected_answer)}</p>
      </div>

      <div class="review-block review-feedback">
        <strong style="color: #92400e;">Comentário e Feedback:</strong>
        <p style="margin-top: 0.25rem; white-space: pre-wrap;">${escapeHtml(q.feedback || 'Sem observações adicionais.')}</p>
      </div>
    `;
    questionsListEl.appendChild(card);
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
