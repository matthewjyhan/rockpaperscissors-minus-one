const ICONS = { r: '✊', p: '✋', s: '✌️' };
const NAMES = { r: 'Rock', p: 'Paper', s: 'Scissors' };
const HANDS = ['r', 'p', 's'];

let scores = { user: 0, cpu: 0 };
let state  = {};

/* ── Helpers ── */
function rand(n) { return Math.floor(Math.random() * n); }
function cpuPick() { return HANDS[rand(3)]; }
function beats(a, b) {
  return (a==='r'&&b==='s') || (a==='p'&&b==='r') || (a==='s'&&b==='p');
}

/*
  Smart CPU removal:
  Evaluate all 4 matchups (each CPU hand vs each user hand).
  Pick the removal that maximises the kept hand's outcome.
  Priority: win > draw > lose.
*/
function cpuSmartRemove(c1, c2, u1, u2) {
  const score = (c, u) => beats(c, u) ? 2 : (c === u ? 1 : 0);
  const keepC1 = Math.max(score(c1, u1), score(c1, u2));
  const keepC2 = Math.max(score(c2, u1), score(c2, u2));
  // Keep the hand with the higher best-case score; ties broken randomly
  if (keepC1 > keepC2) return c2;
  if (keepC2 > keepC1) return c1;
  return rand(2) === 0 ? c2 : c1;
}

function updateScores() {
  document.getElementById('score-user').textContent = scores.user;
  document.getElementById('score-cpu').textContent  = scores.cpu;
}

function render(html) {
  const area = document.getElementById('game-area');
  area.innerHTML = html;
  // Re-trigger the panel slide-up animation on each phase change
  area.style.animation = 'none';
  area.offsetHeight; // force reflow
  area.style.animation = '';
}

/* ─────────────────────────────────────────
   PHASE 1 — Declare two hands
───────────────────────────────────────── */
function phase1() {
  state = { phase: 1, picks: [] };
  renderPhase1();
}

function renderPhase1() {
  const p     = state.picks;
  const ready = p.length === 2;

  // Build selection summary chips
  let summaryHtml = '';
  if (p.length === 0) {
    summaryHtml = `<div class="selection-summary" style="color:var(--text-3);font-size:13px;">Pick your first hand</div>`;
  } else if (p.length === 1) {
    summaryHtml = `
      <div class="selection-summary">
        <span class="sel-chip">${ICONS[p[0]]} ${NAMES[p[0]]}</span>
        <span class="sel-plus">+ ?</span>
      </div>`;
  } else {
    summaryHtml = `
      <div class="selection-summary">
        <span class="sel-chip">${ICONS[p[0]]} ${NAMES[p[0]]}</span>
        <span class="sel-plus">+</span>
        <span class="sel-chip">${ICONS[p[1]]} ${NAMES[p[1]]}</span>
      </div>`;
  }

  // Build hand buttons
  let buttonsHtml = `<div class="hands-row">`;
  for (const h of HANDS) {
    // Which slot numbers (1-based) does this hand occupy?
    const slots = [];
    p.forEach((v, i) => { if (v === h) slots.push(i + 1); });

    const cls = slots.length > 0 ? 'selected' : '';

    let badgeHtml = '';
    if (slots.length === 2) {
      badgeHtml = `<div class="sel-badge" style="font-size:9px;width:22px;">×2</div>`;
    } else if (slots.length === 1) {
      badgeHtml = `<div class="sel-badge">${slots[0]}</div>`;
    }

    buttonsHtml += `
      <button class="hand-btn ${cls}" onclick="pickHand('${h}')">
        ${badgeHtml}
        <span class="hand-icon">${ICONS[h]}</span>
        <span class="hand-label">${NAMES[h]}</span>
      </button>`;
  }
  buttonsHtml += `</div>`;

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Phase 1 of 2</div>
    <div class="panel-instruction">Choose <strong>two hands</strong> to play. They can be the same.</div>
    ${summaryHtml}
    ${buttonsHtml}
    <button class="confirm-btn" ${ready ? '' : 'disabled'} onclick="confirmPhase1()">
      Shoot! — reveal CPU hands →
    </button>
  `);
}

function pickHand(h) {
  const p = state.picks;

  if (p.length === 0) {
    // Nothing selected — add as first pick
    state.picks = [h];

  } else if (p.length === 1) {
    // Always add as second pick, including the same hand (Rock + Rock is valid).
    // To deselect, the player clicks a selected hand once two picks are made.
    state.picks = [p[0], h];

  } else {
    // Two picks already exist
    const isBoth   = p[0] === h && p[1] === h;
    const isFirst  = p[0] === h;
    const isSecond = p[1] === h;

    if (isBoth) {
      // Hand fills both slots — reduce to one instance
      state.picks = [h];
    } else if (isFirst) {
      // Deselect the first pick, keep the second
      state.picks = [p[1]];
    } else if (isSecond) {
      // Deselect the second pick, keep the first
      state.picks = [p[0]];
    } else {
      // New hand, slots full — replace the second pick
      state.picks = [p[0], h];
    }
  }

  renderPhase1();
}

function confirmPhase1() {
  state.c1 = cpuPick();
  state.c2 = cpuPick();
  state.phase = 2;
  renderPhase2();
}

/* ─────────────────────────────────────────
   PHASE 2 — See all hands, drop one of yours
───────────────────────────────────────── */
function renderPhase2() {
  const u1 = state.picks[0];
  const u2 = state.picks[1];
  const c1 = state.c1;
  const c2 = state.c2;

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Phase 2 of 2</div>
    <div class="panel-instruction">CPU has revealed their hands. Now <strong>drop one of yours</strong>.</div>

    <div class="arena">
      <div class="arena-side">
        <div class="arena-label">Your hands — tap to drop</div>
        <div class="arena-hands">
          <div class="arena-hand droppable" onclick="removeHand('u1')">
            <span>${ICONS[u1]}</span>
            <span class="sm-label">${NAMES[u1]}</span>
          </div>
          <div class="arena-hand droppable" onclick="removeHand('u2')">
            <span>${ICONS[u2]}</span>
            <span class="sm-label">${NAMES[u2]}</span>
          </div>
        </div>
      </div>

      <div class="vs-badge">VS</div>

      <div class="arena-side">
        <div class="arena-label">CPU hands — revealed</div>
        <div class="arena-hands">
          <div class="arena-hand cpu-revealed">
            <span>${ICONS[c1]}</span>
            <span class="sm-label">${NAMES[c1]}</span>
          </div>
          <div class="arena-hand cpu-revealed">
            <span>${ICONS[c2]}</span>
            <span class="sm-label">${NAMES[c2]}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="drop-hint">Tap a hand above to drop it. Your other hand plays.</div>
  `);
}

function removeHand(slot) {
  const u1 = state.picks[0];
  const u2 = state.picks[1];

  state.userRemoved = slot === 'u1' ? u1 : u2;
  state.userKept    = slot === 'u1' ? u2 : u1;

  state.cpuRemoved  = cpuSmartRemove(state.c1, state.c2, u1, u2);
  state.cpuKept     = state.cpuRemoved === state.c1 ? state.c2 : state.c1;

  renderReveal();
}

/* ─────────────────────────────────────────
   REVEAL — Show result
───────────────────────────────────────── */
function renderReveal() {
  const uk = state.userKept;
  const ck = state.cpuKept;
  const win  = beats(uk, ck);
  const lose = beats(ck, uk);

  let resultIcon, resultText, resultSub, resultBorder;
  if (win) {
    scores.user++;
    resultIcon   = '🏆';
    resultText   = 'You win!';
    resultSub    = `${NAMES[uk]} beats ${NAMES[ck]}`;
    resultBorder = 'border-color: var(--green-400);';
  } else if (lose) {
    scores.cpu++;
    resultIcon   = '💀';
    resultText   = 'You lose.';
    resultSub    = `${NAMES[ck]} beats ${NAMES[uk]}`;
    resultBorder = 'border-color: var(--red-400);';
  } else {
    resultIcon   = '🤝';
    resultText   = 'Draw!';
    resultSub    = `Both played ${NAMES[uk]}`;
    resultBorder = '';
  }
  updateScores();

  const cpuHandsHtml = [
    { h: state.c1, isRemoved: state.cpuRemoved === state.c1 },
    { h: state.c2, isRemoved: state.cpuRemoved === state.c2 },
  ].map(x => {
    let cls = 'arena-hand';
    if (x.isRemoved) {
      cls += ' removed';
    } else {
      cls += win ? ' final-win' : lose ? ' final-lose' : '';
    }
    return `
      <div class="${cls}">
        <span>${ICONS[x.h]}</span>
        <span class="sm-label">${x.isRemoved ? 'dropped' : NAMES[x.h]}</span>
      </div>`;
  }).join('');

  const userHandCls = 'arena-hand' + (win ? ' final-win' : lose ? ' final-lose' : '');

  render(`
    <div class="phase-badge" style="background:#F2F1ED;color:var(--text-2);border-color:var(--border);">
      <div class="phase-dot" style="background:var(--text-3);"></div>Result
    </div>

    <div class="arena" style="margin-bottom:1rem;">
      <div class="arena-side">
        <div class="arena-label">You kept</div>
        <div class="arena-hands">
          <div class="${userHandCls}">
            <span>${ICONS[uk]}</span>
            <span class="sm-label">${NAMES[uk]}</span>
          </div>
        </div>
      </div>

      <div class="vs-badge">VS</div>

      <div class="arena-side">
        <div class="arena-label">CPU hands</div>
        <div class="arena-hands">${cpuHandsHtml}</div>
      </div>
    </div>

    <div class="result-box" style="${resultBorder}">
      <div class="result-emoji">${resultIcon}</div>
      <div class="result-text">${resultText}</div>
      <div class="result-sub">${resultSub}</div>
    </div>

    <div class="cpu-reveal-note">
      CPU dropped ${NAMES[state.cpuRemoved]} · kept ${NAMES[state.cpuKept]}
    </div>

    <div class="action-row">
      <button class="btn primary" onclick="phase1()">Play again →</button>
    </div>
  `);
}

/* ── Boot ── */
updateScores();
phase1();
