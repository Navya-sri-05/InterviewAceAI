/**
 * InterviewAce AI — Frontend Script
 *
 * All features:
 *  1. Interview type / company / job-role / difficulty correctly wired (bug fix)
 *  2. Custom question count (3 / 5 / 10 / 15)
 *  3. Custom practice timer dropdown (No Timer / 2–20 min) with Pause/Resume
 *  4. Session summary panel
 *  5. Progress indicator (Question X of Y + fill bar)
 *  6. Pause / Resume timer
 *  7. "New Set" — regenerate with same config
 *  8. Target Skills checkboxes
 *  9. Resume Upload (PDF) — parse, display detected skills, personalise questions
 * 10. Interview History — localStorage persistence
 * 11. Performance Dashboard — Chart.js charts (auto-updating)
 *  + Full button-lock during IBM Granite API calls
 */

'use strict';

/* ===================================================================
   STATE  — single source of truth for the current session config
   =================================================================== */
const state = {
  // Config (set from form before generating)
  jobRole:        '',
  company:        'General',
  interviewType:  'Technical',   // ← default matches the HTML active btn-option
  difficulty:     'Intermediate',
  questionCount:  5,
  timerSeconds:   0,             // 0 = no timer
  skills:         [],

  // Resume
  resumeProfile:  '',            // concise string injected into the Granite prompt
  resumeSkills:   [],            // display-only array for the summary pill

  // Session
  questions:      [],
  activeQuestion: null,          // { text, index }
  answeredCount:  0,

  // History / timing
  sessionStart:   null,          // Date.now() when questions were generated
};

/* ===================================================================
   DOM REFERENCES
   =================================================================== */
const $ = id => document.getElementById(id);

// Step 1 — config
const jobRoleInput      = $('job-role');        // hidden field — holds resolved role value
const roleSearch        = $('role-search');     // visible search input
const roleCustomInput   = $('role-custom');     // "Other" free-text
const roleCombobox      = $('role-combobox');
const roleListbox       = $('role-listbox');
const roleChevron       = $('role-chevron');
const companySelect     = $('target-company');
const questionCountSel  = $('question-count');
const timerSelectEl     = $('timer-select');
const generateBtn       = $('generate-btn');
const skillsToggleBtn   = $('skills-toggle-btn');
const skillsGrid        = $('skills-grid');

// Resume upload elements
const resumeDropzone    = $('resume-dropzone');
const resumeFileInput   = $('resume-file-input');
const resumeParsing     = $('resume-parsing');
const resumeResult      = $('resume-result');
const resumeFilename    = $('resume-filename');
const resumeRemoveBtn   = $('resume-remove-btn');
const resumeSkillsPills = $('resume-skills-pills');
const resumeTitlesPanel = $('resume-titles-panel');
const resumeTitlesPills = $('resume-titles-pills');
const resumeError       = $('resume-error');
const resumeErrorMsg    = $('resume-error-msg');

// Step 2 — questions
const questionsSection  = $('questions-section');
const questionsTitle    = $('questions-title');
const progressLabel     = $('progress-label');
const progressPct       = $('progress-pct');
const progressFill      = $('progress-fill');
const sessionSummary    = $('session-summary');
const sumRole           = $('sum-role');
const sumCompany        = $('sum-company');
const sumType           = $('sum-type');
const sumDifficulty     = $('sum-difficulty');
const sumCount          = $('sum-count');
const sumTimer          = $('sum-timer');
const timerBar          = $('timer-bar');
const timerDisplay      = $('timer-display');
const timerProgressFill = $('timer-progress-fill');
const pauseBtn          = $('pause-btn');
const resumeBtn         = $('resume-btn');
const timerExpired      = $('timer-expired');
const questionsList     = $('questions-list');
const answerInput       = $('answer-input');
const charCounter       = $('char-counter');
const clearAnswerBtn    = $('clear-answer-btn');
const newSetBtn         = $('new-set-btn');
const evaluateBtn       = $('evaluate-btn');

// Step 3 — results
const resultsSection    = $('results-section');
const scoreArc          = $('score-arc');
const scoreNumber       = $('score-number');
const scoreLabel        = $('score-label');
const strengthsList     = $('strengths-list');
const improvementsList  = $('improvements-list');
const idealOutline      = $('ideal-outline');
const overallFeedback   = $('overall-feedback');
const nextQuestionBtn   = $('next-question-btn');
const restartBtn        = $('restart-btn');

// Overlay / toast
const loadingOverlay    = $('loading-overlay');
const loadingText       = $('loading-text');
const toast             = $('toast');

/* ===================================================================
   BUTTON LOCK — disable all interactive controls during API calls
   =================================================================== */
const LOCKABLE = [
  generateBtn, evaluateBtn, clearAnswerBtn,
  newSetBtn, nextQuestionBtn, restartBtn,
  pauseBtn, resumeBtn,
  // mockInterviewBtn is added after its declaration (see LOCKABLE_EXTRA below)
];

// Extra lockable buttons declared after LOCKABLE — pushed in at definition time
const LOCKABLE_EXTRA_IDS = ['mock-interview-btn', 'download-report-btn'];
function setButtonsDisabledExtended(disabled) {
  LOCKABLE_EXTRA_IDS.forEach(id => {
    const el = $(id);
    if (el) el.disabled = disabled;
  });
}

function setButtonsDisabled(disabled) {
  LOCKABLE.forEach(el => { if (el) el.disabled = disabled; });
  setButtonsDisabledExtended(disabled);
  document.querySelectorAll('.btn-option').forEach(b => {
    b.style.pointerEvents = disabled ? 'none' : '';
    b.style.opacity       = disabled ? '0.6' : '';
  });
  [companySelect, questionCountSel, timerSelectEl, jobRoleInput].forEach(el => {
    if (el) el.disabled = disabled;
  });
  document.querySelectorAll('.skill-cb').forEach(cb => { cb.disabled = disabled; });
  // Don't lock the resume file input during Granite API calls —
  // the user should still be able to swap their resume between generations.
}

/* ===================================================================
   LOADING OVERLAY
   =================================================================== */
function showLoading(message) {
  loadingText.textContent = message;
  loadingOverlay.classList.remove('hidden');
  setButtonsDisabled(true);
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
  setButtonsDisabled(false);
}

/* ===================================================================
   COUNTDOWN TIMER
   =================================================================== */
let timerInterval    = null;
let timerRemaining   = 0;
let timerTotal       = 0;
let timerPaused      = false;
let timerExpiredFlag = false;

function formatTime(secs) {
  const m = Math.floor(Math.abs(secs) / 60).toString().padStart(2, '0');
  const s = (Math.abs(secs) % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function applyTimerState(secs) {
  timerBar.classList.remove('timer--warning', 'timer--danger', 'timer--done');
  if (secs <= 0)        timerBar.classList.add('timer--done');
  else if (secs <= 10)  timerBar.classList.add('timer--danger');
  else if (secs <= 30)  timerBar.classList.add('timer--warning');
}

function startTimer(totalSeconds) {
  stopTimer();

  if (!totalSeconds || totalSeconds <= 0) {
    // No timer — hide the bar
    timerBar.classList.add('hidden');
    return;
  }

  timerTotal       = totalSeconds;
  timerRemaining   = totalSeconds;
  timerPaused      = false;
  timerExpiredFlag = false;

  timerBar.classList.remove('hidden');
  timerExpired.classList.add('hidden');
  answerInput.disabled = false;
  timerDisplay.textContent      = formatTime(timerRemaining);
  timerProgressFill.style.width = '100%';
  pauseBtn.classList.remove('hidden');
  resumeBtn.classList.add('hidden');
  applyTimerState(timerRemaining);

  timerInterval = setInterval(tick, 1000);
}

function tick() {
  if (timerPaused) return;
  timerRemaining -= 1;

  timerDisplay.textContent = formatTime(Math.max(0, timerRemaining));
  const pct = (timerRemaining / timerTotal) * 100;
  timerProgressFill.style.width = `${Math.max(0, pct)}%`;
  applyTimerState(timerRemaining);

  if (timerRemaining <= 0) {
    stopTimer();
    timerExpiredFlag = true;
    timerDisplay.textContent      = '00:00';
    timerProgressFill.style.width = '0%';
    timerExpired.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    resumeBtn.classList.add('hidden');
    // Disable textarea; do NOT auto-evaluate
    answerInput.disabled = true;
    showToast("⏰ Time's up! Click 'Next Question' or 'Start Over'.", 'error', 5000);
  }
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function pauseTimer() {
  if (!timerInterval || timerPaused || timerExpiredFlag) return;
  timerPaused = true;
  pauseBtn.classList.add('hidden');
  resumeBtn.classList.remove('hidden');
}

function resumeTimer() {
  if (!timerInterval || !timerPaused || timerExpiredFlag) return;
  timerPaused = false;
  pauseBtn.classList.remove('hidden');
  resumeBtn.classList.add('hidden');
}

function resetTimerUI() {
  stopTimer();
  timerRemaining   = 0;
  timerTotal       = 0;
  timerPaused      = false;
  timerExpiredFlag = false;
  timerBar.classList.add('hidden');
  timerBar.classList.remove('timer--warning', 'timer--danger', 'timer--done');
  timerExpired.classList.add('hidden');
  timerDisplay.textContent      = '00:00';
  timerProgressFill.style.width = '100%';
  pauseBtn.classList.remove('hidden');
  resumeBtn.classList.add('hidden');
  answerInput.disabled = false;
}

/* ===================================================================
   SKILLS TOGGLE
   =================================================================== */
skillsToggleBtn.addEventListener('click', () => {
  const expanded = skillsGrid.classList.toggle('hidden');
  skillsToggleBtn.textContent    = expanded ? 'Show Skills ▾' : 'Hide Skills ▴';
  skillsToggleBtn.setAttribute('aria-expanded', String(!expanded));
});

/** Collect checked skill values */
function getSelectedSkills() {
  return Array.from(document.querySelectorAll('.skill-cb:checked')).map(cb => cb.value);
}

/* ===================================================================
   RESUME UPLOAD — drag-drop + file-input + /parse_resume API call
   =================================================================== */

/** Show only one resume status panel at a time */
function showResumeState(state) {
  // state: 'idle' | 'parsing' | 'result' | 'error'
  resumeParsing.classList.add('hidden');
  resumeResult.classList.add('hidden');
  resumeError.classList.add('hidden');
  if (state === 'parsing') resumeParsing.classList.remove('hidden');
  if (state === 'result')  resumeResult.classList.remove('hidden');
  if (state === 'error')   resumeError.classList.remove('hidden');
}

/** Upload a File object to /parse_resume and display the result */
async function uploadResume(file) {
  if (!file) return;

  // Validate client-side
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    resumeErrorMsg.textContent = 'Only PDF files are supported.';
    showResumeState('error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    resumeErrorMsg.textContent = 'File exceeds the 5 MB limit.';
    showResumeState('error');
    return;
  }

  showResumeState('parsing');

  const formData = new FormData();
  formData.append('resume', file);

  try {
    const res  = await fetch('/parse_resume', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok || data.error) {
      resumeErrorMsg.textContent = data.error || 'Failed to parse the PDF.';
      showResumeState('error');
      state.resumeProfile = '';
      state.resumeSkills  = [];
      return;
    }

    // Store in global state for use at generate time
    state.resumeProfile = data.resume_profile || '';
    state.resumeSkills  = data.skills         || [];

    // Display filename
    resumeFilename.textContent = file.name;

    // Render skill pills
    resumeSkillsPills.innerHTML = '';
    if (data.skills && data.skills.length > 0) {
      data.skills.slice(0, 30).forEach(skill => {
        const pill = document.createElement('span');
        pill.className   = 'resume-pill';
        pill.textContent = skill;
        resumeSkillsPills.appendChild(pill);
      });
    } else {
      resumeSkillsPills.innerHTML =
        '<span style="font-size:0.8rem;color:var(--color-muted)">No specific skills detected.</span>';
    }

    // Render job-title pills (only if found)
    resumeTitlesPills.innerHTML = '';
    if (data.job_titles && data.job_titles.length > 0) {
      resumeTitlesPanel.classList.remove('hidden');
      data.job_titles.forEach(title => {
        const pill = document.createElement('span');
        pill.className   = 'resume-pill';
        pill.textContent = title;
        resumeTitlesPills.appendChild(pill);
      });
    } else {
      resumeTitlesPanel.classList.add('hidden');
    }

    showResumeState('result');

  } catch (err) {
    resumeErrorMsg.textContent = 'Network error while parsing resume.';
    showResumeState('error');
    state.resumeProfile = '';
    state.resumeSkills  = [];
  }
}

/** Reset resume state back to idle drop zone */
function clearResume() {
  state.resumeProfile = '';
  state.resumeSkills  = [];
  resumeFileInput.value = '';
  showResumeState('idle');
}

// Click on drop zone → trigger hidden file input
resumeDropzone.addEventListener('click', e => {
  // Avoid double-trigger when clicking the input itself
  if (e.target !== resumeFileInput) resumeFileInput.click();
});

// Keyboard activation for accessibility
resumeDropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    resumeFileInput.click();
  }
});

// File input change
resumeFileInput.addEventListener('change', () => {
  if (resumeFileInput.files[0]) uploadResume(resumeFileInput.files[0]);
});

// Drag-and-drop
resumeDropzone.addEventListener('dragover', e => {
  e.preventDefault();
  resumeDropzone.classList.add('dragover');
});
resumeDropzone.addEventListener('dragleave', () => {
  resumeDropzone.classList.remove('dragover');
});
resumeDropzone.addEventListener('drop', e => {
  e.preventDefault();
  resumeDropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) uploadResume(file);
});

// Remove resume button
resumeRemoveBtn.addEventListener('click', e => {
  e.stopPropagation(); // don't re-trigger the drop zone click
  clearResume();
  showToast('Resume removed.', 'info');
});

/* ===================================================================
   TOGGLE BUTTON GROUPS — read active button values INTO state
   ================================================================
   BUG FIX: previously the state was only updated on click, but it was
   never validated at generate-time. We now always read the active
   btn-option live from the DOM when building the fetch payload, AND
   update state on click so they stay in sync.
   =================================================================== */

/** Read the currently active option for a group from the DOM */
function getActiveToggleValue(group) {
  const active = document.querySelector(`.btn-option--active[data-group="${group}"]`);
  return active ? active.dataset.value : null;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-option');
  if (!btn) return;

  const group = btn.dataset.group;
  const value = btn.dataset.value;

  document.querySelectorAll(`.btn-option[data-group="${group}"]`).forEach(b => {
    b.classList.remove('btn-option--active');
  });
  btn.classList.add('btn-option--active');

  if (group === 'interview-type') state.interviewType = value;
  if (group === 'difficulty')     state.difficulty     = value;
});

/* ===================================================================
   WORD COUNTER
   =================================================================== */
answerInput.addEventListener('input', () => {
  const words = answerInput.value.trim()
    ? answerInput.value.trim().split(/\s+/).length
    : 0;
  charCounter.textContent = `${words} word${words !== 1 ? 's' : ''}`;
});

/* ===================================================================
   CLEAR ANSWER
   =================================================================== */
clearAnswerBtn.addEventListener('click', () => {
  answerInput.value       = '';
  charCounter.textContent = '0 words';
  answerInput.focus();
});

/* ===================================================================
   PAUSE / RESUME
   =================================================================== */
pauseBtn.addEventListener('click',  pauseTimer);
resumeBtn.addEventListener('click', resumeTimer);

/* ===================================================================
   GENERATE QUESTIONS (also used by "New Set")
   =================================================================== */

/** Snapshot config from DOM into state immediately before generating */
function snapshotConfig() {
  // The hidden #job-role field is the single source of truth for the role value.
  // The combobox logic keeps it in sync whenever a selection or "Other" input changes.
  state.jobRole       = jobRoleInput.value.trim();
  state.company       = companySelect.value;
  // BUG FIX: always read from DOM — not from stale state variable
  state.interviewType = getActiveToggleValue('interview-type') || 'Technical';
  state.difficulty    = getActiveToggleValue('difficulty')     || 'Intermediate';
  state.questionCount = parseInt(questionCountSel.value, 10) || 5;
  state.timerSeconds  = parseInt(timerSelectEl.value, 10) || 0;
  state.skills        = getSelectedSkills();
}

async function doGenerateQuestions() {
  snapshotConfig();

  if (!state.jobRole) {
    showToast('Please select or enter a job role before generating questions.', 'error');
    roleSearch.focus();
    return;
  }

  showLoading('IBM Granite is preparing your interview…');

  try {
    const res = await fetch('/generate_questions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_role:       state.jobRole,
        company:        state.company,
        interview_type: state.interviewType,
        difficulty:     state.difficulty,
        question_count: state.questionCount,
        skills:         state.skills,
        resume_profile: state.resumeProfile,   // ← resume context (empty string if no upload)
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Unknown server error.');

    state.questions      = data.questions;
    state.activeQuestion = null;
    state.answeredCount  = 0;
    state.sessionStart   = Date.now();   // start timing the session

    renderQuestions(data.questions);
    updateSessionSummary();
    updateProgress(null);
    hideSection(resultsSection);
    showSection(questionsSection);

    // Start/restart timer according to current selection
    resetTimerUI();
    startTimer(state.timerSeconds);

    questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const companyTag = state.company !== 'General' ? ` for ${state.company}` : '';
    showToast(`${data.questions.length} questions generated${companyTag}!`, 'success');

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

generateBtn.addEventListener('click', doGenerateQuestions);

/* ===================================================================
   NEW SET BUTTON — regenerate with same config, no restart
   =================================================================== */
newSetBtn.addEventListener('click', async () => {
  if (!state.jobRole) {
    showToast('Please configure and generate questions first.', 'error');
    return;
  }

  showLoading('IBM Granite is generating a fresh set…');

  try {
    const res = await fetch('/generate_questions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_role:       state.jobRole,
        company:        state.company,
        interview_type: state.interviewType,
        difficulty:     state.difficulty,
        question_count: state.questionCount,
        skills:         state.skills,
        resume_profile: state.resumeProfile,   // ← resume context
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Unknown server error.');

    state.questions      = data.questions;
    state.activeQuestion = null;
    state.answeredCount  = 0;

    renderQuestions(data.questions);
    updateProgress(null);
    hideSection(resultsSection);

    // Clear answer area
    answerInput.value       = '';
    answerInput.disabled    = false;
    charCounter.textContent = '0 words';

    // Restart timer
    resetTimerUI();
    startTimer(state.timerSeconds);

    questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('New set of questions generated!', 'success');

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
});

/* ===================================================================
   SESSION SUMMARY
   =================================================================== */
function updateSessionSummary() {
  sumRole.textContent       = state.jobRole       || '—';
  sumCompany.textContent    = state.company        || 'General';
  sumType.textContent       = state.interviewType  || '—';
  sumDifficulty.textContent = state.difficulty     || '—';
  sumCount.textContent      = String(state.questionCount);
  sumTimer.textContent      = state.timerSeconds > 0
    ? formatTime(state.timerSeconds)
    : 'No Timer';

  // Add/update Resume pill in the session summary
  const existing = document.getElementById('sum-resume-item');
  if (state.resumeProfile) {
    if (!existing) {
      const item = document.createElement('div');
      item.className = 'summary-item summary-item--resume';
      item.id        = 'sum-resume-item';
      item.innerHTML = '<span class="summary-key">Resume</span>'
                     + '<span class="summary-val">Uploaded ✓</span>';
      document.getElementById('session-summary').appendChild(item);
    }
  } else {
    if (existing) existing.remove();
  }
}

/* ===================================================================
   PROGRESS INDICATOR
   =================================================================== */
function updateProgress(activeIdx) {
  const total    = state.questions.length;
  const answered = activeIdx !== null ? activeIdx + 1 : 0;
  const pct      = total > 0 ? Math.round((answered / total) * 100) : 0;

  progressLabel.textContent = activeIdx !== null
    ? `Question ${answered} of ${total}`
    : `0 of ${total} questions`;
  progressPct.textContent  = `${pct}%`;
  progressFill.style.width = `${pct}%`;
}

/* ===================================================================
   RENDER QUESTIONS
   =================================================================== */
function renderQuestions(questions) {
  questionsList.innerHTML = '';

  questions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className   = 'question-item';
    item.dataset.idx = i;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-pressed', 'false');

    item.innerHTML = `
      <div class="question-num">${i + 1}</div>
      <p class="question-text">${escapeHtml(q)}</p>
    `;

    item.addEventListener('click', () => selectQuestion(i));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectQuestion(i);
    });

    questionsList.appendChild(item);
  });

  // --- BUG FIX: title always uses state.interviewType (snapshot from DOM) ---
  const companyTag = state.company !== 'General' ? ` (${state.company} \u2022 ${state.difficulty})` : ` (${state.difficulty})`;
  questionsTitle.textContent =
    `${questions.length} ${state.interviewType} Questions for ${state.jobRole}${companyTag}`;

  // Reset answer area
  answerInput.value       = '';
  answerInput.disabled    = false;
  charCounter.textContent = '0 words';
}

function selectQuestion(idx) {
  if (timerExpiredFlag) {
    showToast("Time is up! Click 'Next Question' to continue.", 'error');
    return;
  }

  state.activeQuestion = { text: state.questions[idx], index: idx };

  document.querySelectorAll('.question-item').forEach((el, i) => {
    el.classList.toggle('question-item--active', i === idx);
    el.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
  });

  updateProgress(idx);

  answerInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  answerInput.focus();
}

/* ===================================================================
   EVALUATE ANSWER
   =================================================================== */
evaluateBtn.addEventListener('click', async () => {
  if (!state.activeQuestion) {
    showToast('Please select a question first.', 'error');
    return;
  }

  const answer = answerInput.value.trim();
  if (!answer) {
    showToast('Please type your answer before evaluating.', 'error');
    answerInput.focus();
    return;
  }

  if (answer.split(/\s+/).length < 5) {
    showToast('Please provide a more detailed answer (at least 5 words).', 'error');
    answerInput.focus();
    return;
  }

  // Pause timer during evaluation; do not reset it
  if (timerInterval && !timerPaused) pauseTimer();

  showLoading('Evaluating your answer…');

  try {
    const res = await fetch('/evaluate_answer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_role:       state.jobRole,
        interview_type: state.interviewType,
        difficulty:     state.difficulty,
        question:       state.activeQuestion.text,
        answer:         answer,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Unknown server error.');

    state.answeredCount = Math.max(state.answeredCount, state.activeQuestion.index + 1);
    renderResults(data);

    // ── Record this evaluation in history ──────────────────────────
    const score = Math.min(10, Math.max(0, Number(data.score) || 0));
    recordInterviewSession(score);

    showSection(resultsSection);
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // ── Mock mode: auto-advance to next question ───────────────────
    if (mockMode) {
      handleMockPostEval(score, data);
    }

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    // Resume timer if evaluation failed
    if (timerInterval && timerPaused) resumeTimer();
  } finally {
    hideLoading();
  }
});

/* ===================================================================
   RENDER RESULTS
   =================================================================== */
function renderResults(data) {
  const score         = Math.min(10, Math.max(0, Number(data.score) || 0));
  const circumference = 2 * Math.PI * 50; // r=50 ≈ 314.16

  scoreNumber.textContent         = score;
  const offset                    = circumference - (score / 10) * circumference;
  scoreArc.style.strokeDashoffset = offset;
  scoreArc.style.stroke           = scoreColor(score);
  scoreLabel.textContent          = scoreDescription(score);
  scoreLabel.style.color          = scoreColor(score);

  renderList(strengthsList,    data.strengths,    'No specific strengths noted.');
  renderList(improvementsList, data.improvements, 'No specific improvements noted.');
  idealOutline.textContent    = data.ideal_outline    || 'Not provided.';
  overallFeedback.textContent = data.overall_feedback || 'No overall feedback provided.';
}

function renderList(el, items, fallback) {
  el.innerHTML = '';
  const list = Array.isArray(items) && items.length ? items : [fallback];
  list.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}

function scoreColor(score) {
  if (score >= 8) return '#16a34a';
  if (score >= 6) return '#0f62fe';
  if (score >= 4) return '#d97706';
  return '#dc2626';
}

function scoreDescription(score) {
  if (score === 10) return 'Perfect Answer!';
  if (score >= 9)   return 'Excellent Response';
  if (score >= 8)   return 'Very Strong Answer';
  if (score >= 7)   return 'Good Answer';
  if (score >= 6)   return 'Decent Response';
  if (score >= 5)   return 'Average Answer';
  if (score >= 4)   return 'Needs Improvement';
  if (score >= 3)   return 'Significant Gaps';
  return 'Try Again';
}

/* ===================================================================
   NAVIGATION — NEXT QUESTION & RESTART
   =================================================================== */
nextQuestionBtn.addEventListener('click', () => {
  hideSection(resultsSection);

  // Resume timer if it was paused for evaluation
  if (timerInterval && timerPaused && !timerExpiredFlag) resumeTimer();

  const nextIdx = state.activeQuestion !== null
    ? state.activeQuestion.index + 1
    : 0;

  if (nextIdx < state.questions.length) {
    selectQuestion(nextIdx);
    showToast(`Question ${nextIdx + 1} of ${state.questions.length}`, 'success');
  } else {
    showToast('All questions completed! Start over or generate a new set.', 'success');
    updateProgress(state.questions.length - 1);
  }

  answerInput.value       = '';
  answerInput.disabled    = timerExpiredFlag; // stay disabled if time is up
  charCounter.textContent = '0 words';

  questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

restartBtn.addEventListener('click', () => {
  resetTimerUI();

  // Reset state
  state.questions      = [];
  state.activeQuestion = null;
  state.answeredCount  = 0;
  state.jobRole        = '';
  state.company        = 'General';
  state.interviewType  = 'Technical';
  state.difficulty     = 'Intermediate';
  state.questionCount  = 5;
  state.timerSeconds   = 0;
  state.skills         = [];

  // Reset form inputs
  jobRoleInput.value      = '';   // hidden field
  resetRoleCombobox();
  companySelect.value     = 'General';
  questionCountSel.value  = '5';
  timerSelectEl.value     = '0';
  answerInput.value       = '';
  answerInput.disabled    = false;
  charCounter.textContent = '0 words';

  // Uncheck all skills
  document.querySelectorAll('.skill-cb').forEach(cb => { cb.checked = false; });

  // Clear resume
  clearResume();

  // Reset toggles to defaults
  setDefaultToggle('interview-type', 'Technical');
  setDefaultToggle('difficulty',     'Intermediate');

  // Hide dynamic sections
  hideSection(questionsSection);
  hideSection(resultsSection);
  questionsList.innerHTML = '';

  window.scrollTo({ top: 0, behavior: 'smooth' });
  jobRoleInput.focus();
});

function setDefaultToggle(group, value) {
  document.querySelectorAll(`.btn-option[data-group="${group}"]`).forEach(btn => {
    btn.classList.toggle('btn-option--active', btn.dataset.value === value);
  });
  if (group === 'interview-type') state.interviewType = value;
  if (group === 'difficulty')     state.difficulty     = value;
}

/* ===================================================================
   UI HELPERS
   =================================================================== */
function showSection(el) { el.classList.remove('hidden'); }
function hideSection(el) { el.classList.add('hidden');    }

let toastTimer = null;

function showToast(message, type = 'info', duration = 3500) {
  toast.textContent = message;
  toast.className   = 'toast';
  if (type === 'error')   toast.classList.add('toast--error');
  if (type === 'success') toast.classList.add('toast--success');
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function escapeHtml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/* ===================================================================
   INTERVIEW HISTORY — localStorage engine
   =================================================================== */

const HISTORY_KEY = 'interviewace_history_v1';

/** Load all sessions from localStorage (newest first). */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

/** Persist the full history array. */
function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {
    /* localStorage quota exceeded — silently ignore */
  }
}

/**
 * Record the just-completed evaluation into history and refresh UI.
 * Called immediately after renderResults().
 *
 * @param {number} score  0–10
 */
function recordInterviewSession(score) {
  const durationSec = state.sessionStart
    ? Math.round((Date.now() - state.sessionStart) / 1000)
    : null;

  const entry = {
    id:           crypto.randomUUID(),
    timestamp:    new Date().toISOString(),
    jobRole:      state.jobRole,
    company:      state.company,
    interviewType: state.interviewType,
    difficulty:   state.difficulty,
    skills:       state.skills.slice(),
    resumeUsed:   !!state.resumeProfile,
    questionCount: state.questionCount,
    questionsAttempted: state.answeredCount,
    score:        score,
    durationSec:  durationSec,
  };

  const history = loadHistory();
  history.unshift(entry);          // newest first
  saveHistory(history);

  renderHistorySection(history);
  renderDashboard(history);
}

/** Delete a single session by id. */
function deleteHistoryEntry(id) {
  const history = loadHistory().filter(e => e.id !== id);
  saveHistory(history);
  renderHistorySection(history);
  renderDashboard(history);
  showToast('Session deleted.', 'info');
}

/** Delete all history. */
function clearAllHistory() {
  if (!confirm('Delete all interview history? This cannot be undone.')) return;
  saveHistory([]);
  renderHistorySection([]);
  renderDashboard([]);
  showToast('All history cleared.', 'info');
}

/* ===================================================================
   HISTORY SECTION RENDERER
   =================================================================== */

const dashboardSection  = $('dashboard-section');
const historySection    = $('history-section');
const historyList       = $('history-list');
const historyDesc       = $('history-desc');
const clearHistoryBtn   = $('clear-history-btn');
const detailModal       = $('detail-modal');
const modalBody         = $('modal-body');
const modalTitle        = $('modal-title');
const modalClose        = $('modal-close');

clearHistoryBtn.addEventListener('click', clearAllHistory);
modalClose.addEventListener('click', () => detailModal.classList.add('hidden'));
detailModal.addEventListener('click', e => {
  if (e.target === detailModal) detailModal.classList.add('hidden');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !detailModal.classList.contains('hidden')) {
    detailModal.classList.add('hidden');
  }
});

function scoreBadgeClass(score) {
  if (score >= 8) return 'history-score-badge--green';
  if (score >= 6) return 'history-score-badge--blue';
  if (score >= 4) return 'history-score-badge--amber';
  return 'history-score-badge--red';
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDuration(secs) {
  if (!secs && secs !== 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderHistorySection(history) {
  if (!history.length) {
    hideSection(historySection);
    hideSection(dashboardSection);
    return;
  }

  showSection(historySection);
  historyDesc.textContent = `${history.length} session${history.length !== 1 ? 's' : ''} recorded`;
  historyList.innerHTML   = '';

  history.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const badgeClass = scoreBadgeClass(entry.score);
    const companyTag = entry.company && entry.company !== 'General'
      ? ` &bull; ${escapeHtml(entry.company)}` : '';

    card.innerHTML = `
      <div class="history-score-badge ${badgeClass}" aria-label="Score ${entry.score}">${entry.score}</div>
      <div class="history-card__body">
        <div class="history-card__title">${escapeHtml(entry.jobRole)} — ${escapeHtml(entry.interviewType)}${companyTag}</div>
        <div class="history-card__meta">
          <span class="history-card__tag"><strong>${escapeHtml(entry.difficulty)}</strong></span>
          <span class="history-card__tag">${entry.questionsAttempted}/${entry.questionCount} questions</span>
          <span class="history-card__tag">${escapeHtml(fmtDate(entry.timestamp))}</span>
          ${entry.resumeUsed ? '<span class="history-card__tag"><strong>Resume ✓</strong></span>' : ''}
        </div>
      </div>
      <div class="history-card__actions">
        <button class="btn btn--secondary btn--sm" data-action="view" data-id="${entry.id}">View</button>
        <button class="btn btn--outline btn--sm btn--danger" data-action="delete" data-id="${entry.id}">Delete</button>
      </div>
    `;
    historyList.appendChild(card);
  });

}

// Single permanent delegated listener — avoids stacking duplicate handlers
// on every renderHistorySection() call (the previous `{ once: false }` bug).
historyList.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id     = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'delete') {
    deleteHistoryEntry(id);
  } else if (action === 'view') {
    const entry = loadHistory().find(h => h.id === id);
    if (entry) showDetailModal(entry);
  }
});

function showDetailModal(entry) {
  modalTitle.textContent = `${entry.jobRole} — ${entry.interviewType}`;
  modalBody.innerHTML    = '';

  const rows = [
    ['Date & Time',          fmtDate(entry.timestamp)],
    ['Job Role',             entry.jobRole],
    ['Company',              entry.company || 'General'],
    ['Interview Type',       entry.interviewType],
    ['Difficulty',           entry.difficulty],
    ['Score',                `${entry.score} / 10`],
    ['Questions Attempted',  `${entry.questionsAttempted} of ${entry.questionCount}`],
    ['Duration',             fmtDuration(entry.durationSec)],
    ['Resume Used',          entry.resumeUsed ? 'Yes ✓' : 'No'],
    ['Skills',               entry.skills.length ? entry.skills.join(', ') : '—'],
  ];

  rows.forEach(([key, val]) => {
    const row = document.createElement('div');
    row.className = 'modal-row';
    row.innerHTML = `<span class="modal-row__key">${escapeHtml(key)}</span>`
                  + `<span class="modal-row__val">${escapeHtml(String(val))}</span>`;
    modalBody.appendChild(row);
  });

  detailModal.classList.remove('hidden');
}

/* ===================================================================
   PERFORMANCE DASHBOARD — Chart.js
   =================================================================== */

// Chart instances — kept so they can be destroyed and re-created on update
let chartTrend   = null;
let chartTypes   = null;
let chartCompany = null;

// Shared Chart.js defaults matching the app's colour palette
const CHART_FONT = "'Inter', -apple-system, sans-serif";
Chart.defaults.font.family = CHART_FONT;
Chart.defaults.color       = '#64748b';

const PALETTE = [
  '#0f62fe', '#7c3aed', '#16a34a', '#d97706',
  '#dc2626', '#0891b2', '#9333ea', '#ca8a04',
];

function renderDashboard(history) {
  if (!history.length) {
    hideSection(dashboardSection);
    destroyCharts();
    return;
  }

  showSection(dashboardSection);

  // ── Summary stats ────────────────────────────────────────────────
  const scores  = history.map(h => h.score);
  const total   = history.length;
  const avg     = (scores.reduce((a, b) => a + b, 0) / total).toFixed(1);
  const high    = Math.max(...scores);

  const roleCounts    = countBy(history, h => h.jobRole);
  const companyCounts = countBy(history, h => h.company || 'General');

  const topRole    = topKey(roleCounts);
  const topCompany = topKey(companyCounts);

  $('stat-total').textContent   = total;
  $('stat-avg').textContent     = avg;
  $('stat-high').textContent    = high;
  $('stat-role').textContent    = topRole    || '—';
  $('stat-company').textContent = topCompany || '—';

  // ── Chart 1: Score Trend (Line) ──────────────────────────────────
  const trendLabels = history.map((h, i) => {
    const d = new Date(h.timestamp);
    return `${d.getMonth()+1}/${d.getDate()} #${total - i}`;
  }).reverse();
  const trendData = history.map(h => h.score).reverse();

  destroyChart('trend');
  const trendCtx = $('chart-trend').getContext('2d');
  chartTrend = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: 'Score',
        data:  trendData,
        borderColor:     '#0f62fe',
        backgroundColor: 'rgba(15,98,254,0.08)',
        borderWidth: 2.5,
        pointBackgroundColor: trendData.map(s => scoreColorHex(s)),
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.35,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Score: ${ctx.parsed.y} / 10`,
          },
        },
      },
      scales: {
        y: {
          min: 0, max: 10,
          ticks: { stepSize: 2, font: { size: 11 } },
          grid:  { color: 'rgba(0,0,0,0.05)' },
        },
        x: {
          ticks: { font: { size: 10 }, maxRotation: 45 },
          grid:  { display: false },
        },
      },
    },
  });

  // ── Chart 2: Interview Types Doughnut ────────────────────────────
  const typeCounts = countBy(history, h => h.interviewType);
  destroyChart('types');
  const typesCtx = $('chart-types').getContext('2d');
  chartTypes = new Chart(typesCtx, {
    type: 'doughnut',
    data: {
      labels:   Object.keys(typeCounts),
      datasets: [{
        data:            Object.values(typeCounts),
        backgroundColor: PALETTE.slice(0, Object.keys(typeCounts).length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 10, font: { size: 11 } },
        },
      },
    },
  });

  // ── Chart 3: Company Bar ─────────────────────────────────────────
  const compLabels = Object.keys(companyCounts);
  const compValues = Object.values(companyCounts);
  destroyChart('company');
  const compCtx = $('chart-company').getContext('2d');
  chartCompany = new Chart(compCtx, {
    type: 'bar',
    data: {
      labels: compLabels,
      datasets: [{
        label: 'Sessions',
        data:  compValues,
        backgroundColor: compLabels.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
        borderColor:     compLabels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: compLabels.length > 5 ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y ?? ctx.parsed.x} session${(ctx.parsed.y ?? ctx.parsed.x) !== 1 ? 's' : ''}`,
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' } },
      },
    },
  });
}

/** Destroy a named chart safely. */
function destroyChart(name) {
  if (name === 'trend'   && chartTrend)   { chartTrend.destroy();   chartTrend   = null; }
  if (name === 'types'   && chartTypes)   { chartTypes.destroy();   chartTypes   = null; }
  if (name === 'company' && chartCompany) { chartCompany.destroy(); chartCompany = null; }
}

function destroyCharts() {
  destroyChart('trend');
  destroyChart('types');
  destroyChart('company');
}

/** Count history entries grouped by a key function. */
function countBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k     = keyFn(item) || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

/** Return the key with the highest count. */
function topKey(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return '';
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

/** Map a score to the chart colour hex. */
function scoreColorHex(score) {
  if (score >= 8) return '#16a34a';
  if (score >= 6) return '#0f62fe';
  if (score >= 4) return '#d97706';
  return '#dc2626';
}

/* ===================================================================
   SEARCHABLE JOB ROLE COMBOBOX
   =================================================================== */

/**
 * Grouped role catalogue.
 * Each group: { label: string, roles: string[] }
 */
const ROLE_CATALOGUE = [
  {
    label: 'Software Engineering',
    roles: [
      'Software Engineer', 'Senior Software Engineer', 'Staff Software Engineer',
      'Principal Engineer', 'Frontend Developer', 'Backend Developer',
      'Full Stack Developer', 'Mobile Developer', 'Android Developer',
      'iOS Developer', 'Embedded Systems Engineer',
    ],
  },
  {
    label: 'Data & AI',
    roles: [
      'Data Scientist', 'Data Analyst', 'Data Engineer', 'ML Engineer',
      'AI Engineer', 'Research Scientist', 'NLP Engineer',
      'Computer Vision Engineer', 'Business Intelligence Analyst',
    ],
  },
  {
    label: 'Cloud & DevOps',
    roles: [
      'DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
      'Platform Engineer', 'Infrastructure Engineer', 'Solutions Architect',
      'Cloud Architect', 'Kubernetes Engineer', 'Security Engineer',
    ],
  },
  {
    label: 'Product & Management',
    roles: [
      'Product Manager', 'Technical Program Manager', 'Engineering Manager',
      'Tech Lead', 'Project Manager', 'Scrum Master', 'Business Analyst',
    ],
  },
  {
    label: 'Quality & Testing',
    roles: [
      'QA Engineer', 'SDET', 'Test Automation Engineer', 'Performance Engineer',
    ],
  },
  {
    label: 'Database & Systems',
    roles: [
      'Database Administrator', 'Systems Administrator', 'Network Engineer',
      'IT Support Engineer',
    ],
  },
];

// Flat list used for keyboard navigation
const ALL_ROLES_FLAT = ROLE_CATALOGUE.flatMap(g => g.roles);

let comboboxOpen    = false;
let activeOptionIdx = -1;    // index into currently visible list items

/** Close the dropdown list */
function closeRoleList() {
  roleListbox.classList.add('hidden');
  roleCombobox.setAttribute('aria-expanded', 'false');
  comboboxOpen    = false;
  activeOptionIdx = -1;
}

/** Open the dropdown list */
function openRoleList() {
  roleListbox.classList.remove('hidden');
  roleCombobox.setAttribute('aria-expanded', 'true');
  comboboxOpen = true;
}

/**
 * Build visible list items from the current search query.
 * When query is empty, show all groups; otherwise show flat filtered results.
 */
function buildRoleList(query) {
  roleListbox.innerHTML = '';
  activeOptionIdx = -1;

  const q = query.trim().toLowerCase();

  let items = [];   // { text, isOther }

  if (q === '') {
    // Show all groups
    ROLE_CATALOGUE.forEach(group => {
      // Group label
      const groupEl = document.createElement('li');
      groupEl.className   = 'role-combobox__group-label';
      groupEl.textContent = group.label;
      groupEl.setAttribute('role', 'presentation');
      roleListbox.appendChild(groupEl);

      group.roles.forEach(role => {
        const li = document.createElement('li');
        li.className = 'role-combobox__option';
        li.textContent = role;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.value = role;
        roleListbox.appendChild(li);
        items.push(li);
      });
    });
  } else {
    // Filtered flat list
    const matched = ALL_ROLES_FLAT.filter(r => r.toLowerCase().includes(q));
    if (matched.length) {
      matched.forEach(role => {
        const li = document.createElement('li');
        li.className = 'role-combobox__option';
        li.textContent = role;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.value = role;
        roleListbox.appendChild(li);
        items.push(li);
      });
    } else {
      const noRes = document.createElement('li');
      noRes.className = 'role-combobox__no-results';
      noRes.textContent = 'No matching roles — use "Other" to type a custom role.';
      noRes.setAttribute('role', 'presentation');
      roleListbox.appendChild(noRes);
    }
  }

  // Always append "Other" at the bottom
  const otherLi = document.createElement('li');
  otherLi.className = 'role-combobox__option role-combobox__option--other';
  otherLi.textContent = '✏️  Other (type a custom role…)';
  otherLi.setAttribute('role', 'option');
  otherLi.setAttribute('aria-selected', 'false');
  otherLi.dataset.value = '__other__';
  roleListbox.appendChild(otherLi);
  items.push(otherLi);

  return items;
}

/** Select a role option by value. */
function selectRole(value) {
  if (value === '__other__') {
    // Reveal the custom input
    roleSearch.value    = 'Other';
    jobRoleInput.value  = '';        // cleared until user types
    roleCustomInput.classList.remove('hidden');
    roleCustomInput.focus();
  } else {
    roleSearch.value    = value;
    jobRoleInput.value  = value;
    roleCustomInput.classList.add('hidden');
    roleCustomInput.value = '';
  }
  closeRoleList();
}

/** Reset combobox to initial empty state */
function resetRoleCombobox() {
  roleSearch.value      = '';
  roleCustomInput.value = '';
  jobRoleInput.value    = '';
  roleCustomInput.classList.add('hidden');
  closeRoleList();
}

// ── Event wiring ────────────────────────────────────────────────

// Focus / type in search box → open list and filter
roleSearch.addEventListener('focus', () => {
  buildRoleList(roleSearch.value);
  openRoleList();
});

roleSearch.addEventListener('input', () => {
  // If user starts editing after a selection, clear the hidden value
  // until they pick again — prevents sending a stale role
  const rawValue = roleSearch.value.trim();
  if (rawValue !== 'Other') {
    roleCustomInput.classList.add('hidden');
    roleCustomInput.value = '';
    // Optimistically set the hidden field so a direct-typed value works too
    jobRoleInput.value = rawValue;
  } else {
    jobRoleInput.value = '';
  }
  buildRoleList(roleSearch.value);
  openRoleList();
});

// Chevron toggle
roleChevron.addEventListener('click', () => {
  if (comboboxOpen) {
    closeRoleList();
  } else {
    buildRoleList(roleSearch.value);
    openRoleList();
    roleSearch.focus();
  }
});

// Click an option in the list
roleListbox.addEventListener('click', e => {
  const opt = e.target.closest('.role-combobox__option');
  if (!opt) return;
  selectRole(opt.dataset.value);
});

// Keyboard navigation inside the search input
roleSearch.addEventListener('keydown', e => {
  const opts = [...roleListbox.querySelectorAll('.role-combobox__option')];

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!comboboxOpen) { buildRoleList(roleSearch.value); openRoleList(); }
    activeOptionIdx = Math.min(activeOptionIdx + 1, opts.length - 1);
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === activeOptionIdx ? 'true' : 'false'));
    if (opts[activeOptionIdx]) {
      opts[activeOptionIdx].scrollIntoView({ block: 'nearest' });
      roleSearch.setAttribute('aria-activedescendant', opts[activeOptionIdx].id || '');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeOptionIdx = Math.max(activeOptionIdx - 1, 0);
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === activeOptionIdx ? 'true' : 'false'));
    if (opts[activeOptionIdx]) opts[activeOptionIdx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeOptionIdx >= 0 && opts[activeOptionIdx]) {
      selectRole(opts[activeOptionIdx].dataset.value);
    } else if (roleSearch.value.trim() && roleSearch.value.trim() !== 'Other') {
      // Allow free-type confirmation with Enter
      jobRoleInput.value = roleSearch.value.trim();
      closeRoleList();
    }
  } else if (e.key === 'Escape') {
    closeRoleList();
    roleSearch.blur();
  } else if (e.key === 'Tab') {
    closeRoleList();
  }
});

// Custom "Other" input — sync its value into the hidden field in real time
roleCustomInput.addEventListener('input', () => {
  jobRoleInput.value = roleCustomInput.value.trim();
});

// Close list when clicking outside
document.addEventListener('click', e => {
  if (!roleCombobox.contains(e.target) && e.target !== roleCustomInput) {
    closeRoleList();
  }
});

/* ===================================================================
   BOOT — load and display history on page load
   =================================================================== */
(function initHistoryOnLoad() {
  const history = loadHistory();
  if (history.length) {
    renderHistorySection(history);
    renderDashboard(history);
  }
}());

/* ===================================================================
   ACCESSIBILITY
   =================================================================== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !loadingOverlay.classList.contains('hidden')) {
    e.preventDefault();
  }
});

/* ===================================================================
   DARK MODE — persistent toggle
   =================================================================== */

const DARK_KEY       = 'interviewace_dark_v1';
const darkModeToggle = $('dark-mode-toggle');

/** Apply dark/light theme to <html> and save preference */
function applyTheme(dark) {
  if (dark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  darkModeToggle.setAttribute('aria-pressed', String(dark));
  darkModeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

// Restore saved preference on load
(function initDarkMode() {
  const saved = localStorage.getItem(DARK_KEY);
  // Respect OS preference if no saved setting
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved !== null ? saved === 'true' : prefersDark);
}());

darkModeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(!isDark);
  localStorage.setItem(DARK_KEY, String(!isDark));
});

/* ===================================================================
   STICKY PROGRESS BAR
   =================================================================== */

const stickyProgress      = $('sticky-progress');
const stickyProgressFill  = $('sticky-progress-fill');
const stickyProgressLabel = $('sticky-progress-label');
const stickyProgressPct   = $('sticky-progress-pct');

/** Sync sticky bar with the main progress indicator */
function syncStickyProgress() {
  if (!stickyProgressFill) return;
  const pct   = progressFill.style.width   || '0%';
  const label = progressLabel.textContent  || '';
  const pctTxt = progressPct.textContent   || '0%';
  stickyProgressFill.style.width  = pct;
  stickyProgressLabel.textContent = label;
  stickyProgressPct.textContent   = pctTxt;
}

/** Show/hide sticky bar based on whether questions section is scrolled off screen */
function handleStickyProgress() {
  if (questionsSection.classList.contains('hidden')) {
    stickyProgress.classList.remove('sticky-progress--visible');
    stickyProgress.setAttribute('aria-hidden', 'true');
    return;
  }
  const rect = questionsSection.getBoundingClientRect();
  const visible = rect.top < 0;  // section header scrolled past viewport top
  stickyProgress.classList.toggle('sticky-progress--visible', visible);
  stickyProgress.setAttribute('aria-hidden', String(!visible));
  if (visible) syncStickyProgress();
}

window.addEventListener('scroll', handleStickyProgress, { passive: true });

/* ===================================================================
   ANSWER TIPS — context-sensitive guidance per interview type
   =================================================================== */

const ANSWER_TIPS = {
  Technical: [
    'Think aloud — explain your reasoning step by step, not just the answer.',
    'Use concrete examples from past projects or well-known systems.',
    'For coding questions, start with brute-force, then optimise.',
    'Clarify constraints before diving in — ask about edge cases.',
    'End with complexity analysis (time & space) where applicable.',
  ],
  HR: [
    'Structure your answer: state your point, explain why, give an example.',
    'Keep answers focused — 60 to 90 seconds is usually ideal.',
    'Avoid speaking negatively about previous employers.',
    'Tie your values and career goals to the company\'s mission.',
    'Prepare specific numbers and outcomes (e.g., "improved efficiency by 20%").',
  ],
  Behavioral: [
    'Use the STAR method: Situation → Task → Action → Result.',
    'Choose examples that highlight leadership, ownership, or growth.',
    'Be honest — interviewers can detect rehearsed non-answers.',
    'Quantify results wherever possible ("reduced churn by 15%").',
    'Show self-awareness: mention what you learned from the experience.',
  ],
};

const tipsSectionEl  = $('tips-section');
const tipsToggleBtn  = $('tips-toggle-btn');
const tipsBody       = $('tips-body');
const tipsList       = $('tips-list');
const tipsTypeLabel  = $('tips-type-label');

/** Render tips for the current interview type */
function renderTips(interviewType) {
  const tips = ANSWER_TIPS[interviewType] || ANSWER_TIPS.Technical;
  tipsTypeLabel.textContent = `${interviewType} questions`;
  tipsList.innerHTML = '';
  tips.forEach(tip => {
    const li = document.createElement('li');
    li.textContent = tip;
    tipsList.appendChild(li);
  });
}

const tipsChevron = $('tips-chevron');

tipsToggleBtn.addEventListener('click', () => {
  const nowHidden = tipsBody.classList.toggle('hidden');
  // nowHidden=true  → just collapsed → show ▾
  // nowHidden=false → just expanded  → show ▴
  tipsToggleBtn.setAttribute('aria-expanded', String(!nowHidden));
  if (tipsChevron) tipsChevron.textContent = nowHidden ? '▾' : '▴';

  // Re-render tips based on current interview type whenever opened
  if (!nowHidden) renderTips(state.interviewType);
});

// Update tips label whenever interview type changes
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-option');
  if (!btn) return;
  if (btn.dataset.group === 'interview-type') {
    renderTips(btn.dataset.value);
  }
});

/* ===================================================================
   MOCK INTERVIEW MODE
   Full-auto sequential mode: generates questions, then prompts the
   user to type each answer and automatically advances after evaluation.
   =================================================================== */

const mockInterviewBtn     = $('mock-interview-btn');
const mockSummaryModal     = $('mock-summary-modal');
const mockModalBody        = $('mock-modal-body');
const mockModalClose       = $('mock-modal-close');
const mockModalDoneBtn     = $('mock-modal-done-btn');
const mockModalRestartBtn  = $('mock-modal-restart-btn');

let mockMode            = false;     // is mock interview active?
let mockCurrentIdx      = 0;         // current question index in mock
let mockResults         = [];        // { question, answer, score, feedback } per Q

/** Enter mock interview mode */
function enterMockMode() {
  mockMode       = true;
  mockCurrentIdx = 0;
  mockResults    = [];

  // Inject mock badge into questions title area
  const existingBadge = document.getElementById('mock-mode-badge');
  if (!existingBadge) {
    const badge = document.createElement('span');
    badge.id = 'mock-mode-badge';
    badge.className = 'mock-badge';
    badge.textContent = 'Mock Mode';
    questionsTitle.insertAdjacentElement('afterend', badge);
  }
}

/** Exit mock mode and clean up */
function exitMockMode() {
  mockMode = false;
  const badge = document.getElementById('mock-mode-badge');
  if (badge) badge.remove();
}

/** Show mock summary modal after all questions evaluated */
function showMockSummary() {
  const total    = mockResults.length;
  const scores   = mockResults.map(r => r.score);
  const avg      = total ? (scores.reduce((a, b) => a + b, 0) / total).toFixed(1) : '—';
  const highest  = total ? Math.max(...scores) : '—';
  const lowest   = total ? Math.min(...scores) : '—';
  const passing  = scores.filter(s => s >= 6).length;

  mockModalBody.innerHTML = '';

  // Stats grid
  const grid = document.createElement('div');
  grid.className = 'mock-summary-grid';
  [
    [avg,                       'Avg Score'],
    [`${highest} / 10`,         'Best Answer'],
    [`${lowest} / 10`,          'Weakest Answer'],
    [`${passing} / ${total}`,   'Passed (≥6)'],
  ].forEach(([val, label]) => {
    grid.innerHTML += `
      <div class="mock-summary-stat">
        <span class="mock-summary-stat__val">${escapeHtml(String(val))}</span>
        <span class="mock-summary-stat__label">${escapeHtml(label)}</span>
      </div>`;
  });
  mockModalBody.appendChild(grid);

  // Per-question rows
  const rowsTitle = document.createElement('h4');
  rowsTitle.style.cssText = 'margin-bottom:10px;font-size:0.9rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:0.4px;';
  rowsTitle.textContent = 'Question Breakdown';
  mockModalBody.appendChild(rowsTitle);

  mockResults.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'mock-q-row';
    const scoreColor = r.score >= 8 ? '#16a34a' : r.score >= 6 ? '#0f62fe' : r.score >= 4 ? '#d97706' : '#dc2626';
    row.innerHTML = `
      <span class="mock-q-row__num">${i + 1}</span>
      <span class="mock-q-row__score" style="color:${scoreColor}">${r.score}/10</span>
      <span class="mock-q-row__text">${escapeHtml(r.question.slice(0, 120))}${r.question.length > 120 ? '…' : ''}</span>`;
    mockModalBody.appendChild(row);
  });

  mockSummaryModal.classList.remove('hidden');
}

// Close mock summary modal
mockModalClose.addEventListener('click', () => {
  mockSummaryModal.classList.add('hidden');
  exitMockMode();
});
mockModalDoneBtn.addEventListener('click', () => {
  mockSummaryModal.classList.add('hidden');
  exitMockMode();
});
mockModalRestartBtn.addEventListener('click', () => {
  mockSummaryModal.classList.add('hidden');
  exitMockMode();
  restartBtn.click();
});
mockSummaryModal.addEventListener('click', e => {
  if (e.target === mockSummaryModal) {
    mockSummaryModal.classList.add('hidden');
    exitMockMode();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !mockSummaryModal.classList.contains('hidden')) {
    mockSummaryModal.classList.add('hidden');
    exitMockMode();
  }
});

/** Run mock interview: generate questions, then sequentially prompt for each */
mockInterviewBtn.addEventListener('click', async () => {
  snapshotConfig();

  if (!state.jobRole) {
    showToast('Please select or enter a job role before starting a mock interview.', 'error');
    roleSearch.focus();
    return;
  }

  showLoading('IBM Granite is preparing your mock interview…');

  try {
    const res = await fetch('/generate_questions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_role:       state.jobRole,
        company:        state.company,
        interview_type: state.interviewType,
        difficulty:     state.difficulty,
        question_count: state.questionCount,
        skills:         state.skills,
        resume_profile: state.resumeProfile,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Unknown server error.');

    state.questions      = data.questions;
    state.activeQuestion = null;
    state.answeredCount  = 0;
    state.sessionStart   = Date.now();

    renderQuestions(data.questions);
    updateSessionSummary();
    updateProgress(null);
    hideSection(resultsSection);
    showSection(questionsSection);
    resetTimerUI();
    startTimer(state.timerSeconds);

    questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Mock interview started — answer each question in order!`, 'success');

    enterMockMode();

    // Automatically select the first question after a short delay
    setTimeout(() => selectQuestion(0), 600);

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
});

/* ===================================================================
   MOCK MODE — override evaluateBtn behaviour when mockMode is active.
   After each answer is submitted, automatically advance to the next
   question (or show the summary when all questions are done).
   =================================================================== */

// We patch the existing evaluate handler by intercepting post-evaluation
// in recordInterviewSession and checking mockMode.

/** Called from recordInterviewSession when mockMode is on */
function handleMockPostEval(score, evalData) {
  mockResults.push({
    question: state.activeQuestion ? state.activeQuestion.text : '',
    answer:   answerInput.value.trim(),
    score:    score,
    feedback: evalData.overall_feedback || '',
  });

  const nextIdx = state.activeQuestion !== null
    ? state.activeQuestion.index + 1
    : 0;

  if (nextIdx < state.questions.length) {
    // Advance to next question automatically after a brief pause
    setTimeout(() => {
      hideSection(resultsSection);
      answerInput.value       = '';
      answerInput.disabled    = false;
      charCounter.textContent = '0 words';

      if (timerInterval && timerPaused && !timerExpiredFlag) resumeTimer();

      selectQuestion(nextIdx);
      showToast(`Question ${nextIdx + 1} of ${state.questions.length} — keep going!`, 'success');
      questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 1200);
  } else {
    // All questions done — show summary
    setTimeout(() => {
      showMockSummary();
    }, 800);
  }
}

/* ===================================================================
   EXPORT SESSION REPORT — download a self-contained HTML file
   =================================================================== */

const downloadReportBtn = $('download-report-btn');

/** Generate and download an HTML report for the last evaluated session */
downloadReportBtn.addEventListener('click', () => {
  if (!state.activeQuestion) {
    showToast('Evaluate an answer first to export a report.', 'error');
    return;
  }

  const score       = Number(scoreNumber.textContent) || 0;
  const scoreClr    = scoreColor(score);
  const now         = new Date().toLocaleString();
  const roleTag     = escapeHtml(state.jobRole || '—');
  const companyTag  = escapeHtml(state.company || 'General');
  const typeTag     = escapeHtml(state.interviewType);
  const diffTag     = escapeHtml(state.difficulty);
  const question    = escapeHtml(state.activeQuestion.text);
  const answer      = escapeHtml(answerInput.value.trim() || '(no answer)');

  // Collect feedback from the DOM
  const strengthsHtml = [...strengthsList.querySelectorAll('li')]
    .map(li => `<li>${escapeHtml(li.textContent)}</li>`).join('');
  const improvHtml = [...improvementsList.querySelectorAll('li')]
    .map(li => `<li>${escapeHtml(li.textContent)}</li>`).join('');
  const idealHtml  = escapeHtml(idealOutline.textContent || '');
  const overallHtml = escapeHtml(overallFeedback.textContent || '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>InterviewAce AI — Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,"Segoe UI",sans-serif;background:#f0f4ff;color:#1e293b;padding:32px 20px;line-height:1.6}
  .report{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);overflow:hidden}
  .report-header{background:linear-gradient(135deg,#0f62fe,#7c3aed);color:#fff;padding:28px 32px}
  .report-header h1{font-size:1.4rem;margin-bottom:4px}
  .report-header p{font-size:0.85rem;opacity:0.85}
  .report-body{padding:28px 32px}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
  .meta-item{background:#f0f4ff;border-radius:10px;padding:12px 14px}
  .meta-item__label{font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#64748b;margin-bottom:2px}
  .meta-item__val{font-size:0.95rem;font-weight:600;color:#1e293b}
  .score-row{display:flex;align-items:center;gap:16px;margin-bottom:24px;padding:16px;background:#f0f4ff;border-radius:12px}
  .score-circle{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:#fff}
  .score-info h3{font-size:1rem;margin-bottom:2px}
  .score-info p{font-size:0.82rem;color:#64748b}
  .section{margin-bottom:20px}
  .section h3{font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
  .question-box{background:#f0f4ff;border-left:4px solid #0f62fe;border-radius:0 10px 10px 0;padding:14px 16px;font-size:0.95rem;margin-bottom:20px}
  .answer-box{background:#fafafa;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;font-size:0.9rem;white-space:pre-wrap;margin-bottom:20px}
  ul{padding-left:20px}
  li{margin-bottom:6px;font-size:0.9rem}
  .text-block{font-size:0.9rem;line-height:1.7}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:0.78rem;color:#94a3b8;text-align:center}
</style>
</head>
<body>
<div class="report">
  <div class="report-header">
    <h1>InterviewAce AI — Session Report</h1>
    <p>Generated on ${now} &nbsp;&bull;&nbsp; Powered by IBM watsonx.ai Granite</p>
  </div>
  <div class="report-body">
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-item__label">Role</div><div class="meta-item__val">${roleTag}</div></div>
      <div class="meta-item"><div class="meta-item__label">Company</div><div class="meta-item__val">${companyTag}</div></div>
      <div class="meta-item"><div class="meta-item__label">Type</div><div class="meta-item__val">${typeTag}</div></div>
      <div class="meta-item"><div class="meta-item__label">Difficulty</div><div class="meta-item__val">${diffTag}</div></div>
    </div>
    <div class="score-row">
      <div class="score-circle" style="background:${scoreClr}">${score}</div>
      <div class="score-info">
        <h3>Score: ${score} / 10</h3>
        <p>${escapeHtml(scoreDescription(score))}</p>
      </div>
    </div>
    <div class="section">
      <h3>Question</h3>
      <div class="question-box">${question}</div>
    </div>
    <div class="section">
      <h3>Your Answer</h3>
      <div class="answer-box">${answer}</div>
    </div>
    <div class="section">
      <h3>Strengths</h3>
      <ul>${strengthsHtml || '<li>No strengths noted.</li>'}</ul>
    </div>
    <div class="section">
      <h3>Areas for Improvement</h3>
      <ul>${improvHtml || '<li>No improvements noted.</li>'}</ul>
    </div>
    <div class="section">
      <h3>Ideal Answer Outline</h3>
      <p class="text-block">${idealHtml || 'Not provided.'}</p>
    </div>
    <div class="section">
      <h3>Overall Feedback</h3>
      <p class="text-block">${overallHtml || 'Not provided.'}</p>
    </div>
    <div class="footer">InterviewAce AI &mdash; Built with Flask &amp; IBM watsonx.ai Granite</div>
  </div>
</div>
</body>
</html>`;

  const blob    = new Blob([html], { type: 'text/html' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = `interviewace-report-${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Report downloaded!', 'success');
});

/* ===================================================================
   STICKY PROGRESS — synced by the scroll handler on every scroll event.
   syncStickyProgress() mirrors progressFill/progressLabel/progressPct.
   =================================================================== */
