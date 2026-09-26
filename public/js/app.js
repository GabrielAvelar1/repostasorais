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
let autoSaveTimer = null;
let statusPollingInterval = null;

// DOM Elements
const viewLogin = document.getElementById('view-login');
const viewWaiting = document.getElementById('view-waiting');
const viewExam = document.getElementById('view-exam');
const viewSubmitted = document.getElementById('view-submitted');
const viewResults = document.getElementById('view-results');

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
      loadStudentFlow();
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
  [viewLogin, viewWaiting, viewExam, viewSubmitted, viewResults].forEach(v => {
    v.style.display = 'none';
  });
  viewElement.style.display = 'block';
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
      loadStudentFlow();
    } catch (err) {
      alert(err.message);
    }
  });

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
    if (currentQuestionIndex > 0) {
      saveDraftNow();
      currentQuestionIndex--;
      renderCurrentQuestion();
    }
  });

  btnNextQ.addEventListener('click', () => {
    if (currentQuestionIndex < questions.length - 1) {
      saveDraftNow();
      currentQuestionIndex++;
      renderCurrentQuestion();
    }
  });

  // Manual save draft
  btnSaveDraft.addEventListener('click', async () => {
    await saveDraftNow();
    showToast('💾 Rascunho salvo com sucesso!');
  });

  // Submit exam
  btnFinishExam.addEventListener('click', async () => {
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
      // Exam is locked by teacher
      waitingStudentName.textContent = currentUser.fullName;
      showView(viewWaiting);
      startExamStatusPolling();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao carregar prova');

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

// Poll until teacher unlocks the exam
function startExamStatusPolling() {
  clearInterval(statusPollingInterval);
  statusPollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/exam/status');
      const data = await res.json();
      if (data.examOpen) {
        clearInterval(statusPollingInterval);
        showToast('📢 A Professora Patricia liberou a prova!');
        loadStudentFlow();
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 4000);
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

    speechStatus.textContent = '⏳ Áudio capturado! Transcrevendo com Inteligência Artificial...';
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
            studentAnswerInput.value = data.transcript.trim();
            if (questions[currentQuestionIndex]) {
              questions[currentQuestionIndex].student_answer = data.transcript.trim();
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
        }
        speechStatus.classList.remove('active');
      };
    } catch (err) {
      console.warn('FileReader error:', err);
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
        speechStatus.textContent = '⏳ Áudio capturado! A Inteligência Artificial está transcrevendo sua resposta...';
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
                const existing = (studentAnswerInput.value || '').trim();
                const newText = existing ? `${existing} ${data.transcript.trim()}` : data.transcript.trim();
                studentAnswerInput.value = newText;
                studentAnswerInput.dispatchEvent(new Event('input'));
                if (questions[currentQuestionIndex]) {
                  questions[currentQuestionIndex].student_answer = newText;
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
            }
            speechStatus.classList.remove('active');
          };
        } catch (e) {
          console.warn('FileReader error:', e);
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
        <span class="review-score-badge">Nota: ${scoreNum} / 10.0</span>
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
