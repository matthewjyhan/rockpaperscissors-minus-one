/* ═══════════════════════════════════════════════════
   RPS Minus One — Client
   ───────────────────────────────────────────────────
   Modes: CPU (local) | Multiplayer (WebSocket)

   WebSocket message types (client → server):
     setName      { name }
     joinQueue    {}
     createRoom   {}
     joinRoom     { roomId }
     submitHands  { hands: [h1, h2] }
     submitDrop   { kept }
     playAgain    {}

   WebSocket message types (server → client):
     hello           { sessionId }
     queued          { position }
     roomCreated     { roomId }
     matched         { roomId, playerNum, opponentName, scores }
     opponentReady   { phase }
     phase2Start     { yourHands, opponentHands }
     reveal          { yourKept, opponentKept, yourDropped, opponentDropped, outcome, scores }
     opponentLeft    {}
     opponentWantsRematch {}
     error           { msg }
═══════════════════════════════════════════════════ */

/* ── Constants ── */
const ICONS = { r: '✊', p: '✋', s: '✌️' };
const NAMES = { r: 'Rock', p: 'Paper', s: 'Scissors' };
const HANDS = ['r', 'p', 's'];

/*
  IMPORTANT: Set this to your deployed Railway WebSocket URL.
  Example: 'wss://rps-minus-one.up.railway.app'
  Leave as empty string while developing locally (falls back to ws://localhost:8080).
*/
const WS_URL = 'wss://rockpaperscissors-minus-one-server.onrender.com';

/* ── App state ── */
let mode    = null;   // 'cpu' | 'multi'
let scores  = { user: 0, opp: 0 };
let state   = {};
let oppName = 'Opponent';

/* ── WebSocket state ── */
let ws            = null;
let sessionId     = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

/* ─────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────── */
function rand(n) { return Math.floor(Math.random() * n); }
function cpuPick() { return HANDS[rand(3)]; }
function beats(a, b) {
  return (a==='r'&&b==='s') || (a==='p'&&b==='r') || (a==='s'&&b==='p');
}

function cpuSmartRemove(c1, c2, u1, u2) {
  const score = (c, u) => beats(c, u) ? 2 : (c === u ? 1 : 0);
  const k1 = Math.max(score(c1, u1), score(c1, u2));
  const k2 = Math.max(score(c2, u1), score(c2, u2));
  if (k1 > k2) return c2;
  if (k2 > k1) return c1;
  return rand(2) === 0 ? c2 : c1;
}

function render(html) {
  const area = document.getElementById('game-area');
  area.innerHTML = html;
  area.style.animation = 'none';
  area.offsetHeight;
  area.style.animation = '';
}

function showScoreBar(show = true) {
  document.getElementById('score-bar').style.display = show ? 'grid' : 'none';
}

function updateScores() {
  document.getElementById('score-user').textContent = scores.user;
  document.getElementById('score-cpu').textContent  = scores.opp;
  document.getElementById('score-label-you').textContent = 'You';
  document.getElementById('score-label-opp').textContent = mode === 'multi' ? oppName : 'CPU';
}

/* ─────────────────────────────────────────────────
   WebSocket — connection & reconnection
───────────────────────────────────────────────── */
function getWsUrl() {
  if (WS_URL) return WS_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:8080`;
}

function connectWs(onOpen) {
  if (ws && ws.readyState === WebSocket.OPEN) { onOpen?.(); return; }

  setConnStatus('connecting');
  ws = new WebSocket(getWsUrl());

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    clearTimeout(reconnectTimer);
    setConnStatus('connected');
    onOpen?.();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServerMsg(msg);
  });

  ws.addEventListener('close', () => {
    setConnStatus('disconnected');
    // Only auto-reconnect if we're actively in a multiplayer session
    if (mode === 'multi') scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setConnStatus('disconnected');
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    setConnStatus('connecting');
    connectWs(() => {
      // After reconnect, re-announce our name; server assigns new sessionId
      wsSend('setName', { name: 'Player' });
    });
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function wsSend(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

/* ─────────────────────────────────────────────────
   Connection status badge
───────────────────────────────────────────────── */
function setConnStatus(status) {
  const el = document.getElementById('conn-status');
  if (mode !== 'multi') { el.style.display = 'none'; return; }

  const labels = {
    connected:    'Connected',
    connecting:   'Connecting…',
    disconnected: 'Disconnected — retrying',
  };

  el.style.display = 'block';
  el.innerHTML = `
    <span class="conn-badge ${status}">
      <span class="conn-dot${status === 'connecting' ? ' pulse' : ''}"></span>
      ${labels[status]}
    </span>`;
}

/* ─────────────────────────────────────────────────
   Server message handler
───────────────────────────────────────────────── */
function handleServerMsg(msg) {
  switch (msg.type) {

    case 'hello':
      sessionId = msg.sessionId;
      break;

    case 'queued':
      renderQueued();
      break;

    case 'roomCreated':
      state.roomId = msg.roomId;
      renderWaitingForOpponent(msg.roomId);
      break;

    case 'matched':
      state.roomId   = msg.roomId;
      state.playerNum = msg.playerNum;
      oppName        = msg.opponentName || 'Opponent';
      scores         = { user: msg.scores[msg.playerNum], opp: msg.scores[1 - msg.playerNum] };
      showScoreBar(true);
      updateScores();
      mpPhase1();
      break;

    case 'opponentReady':
      showOpponentReady(msg.phase);
      break;

    case 'phase2Start':
      state.opponentHands = msg.opponentHands;
      mpPhase2(msg.yourHands, msg.opponentHands);
      break;

    case 'reveal':
      mpReveal(msg);
      break;

    case 'opponentLeft':
      renderOpponentLeft();
      break;

    case 'opponentWantsRematch':
      showRematchPending();
      break;

    case 'error':
      showError(msg.msg);
      break;
  }
}

/* ─────────────────────────────────────────────────
   Mode selection screen
───────────────────────────────────────────────── */
function showModeSelect() {
  mode = null;
  scores = { user: 0, opp: 0 };
  showScoreBar(false);
  document.getElementById('conn-status').style.display = 'none';

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Choose mode</div>
    <div class="panel-instruction">How do you want to play?</div>

    <div class="mode-grid">
      <div class="mode-card" onclick="startCpu()">
        <div class="mode-icon">🤖</div>
        <div class="mode-title">vs CPU</div>
        <div class="mode-desc">Play solo against a smart AI opponent</div>
      </div>
      <div class="mode-card" onclick="showMultiLobby()">
        <div class="mode-icon">🌐</div>
        <div class="mode-title">Multiplayer</div>
        <div class="mode-desc">Play live against another person</div>
      </div>
    </div>
  `);
}

/* ─────────────────────────────────────────────────
   CPU mode
───────────────────────────────────────────────── */
function startCpu() {
  mode   = 'cpu';
  scores = { user: 0, opp: 0 };
  showScoreBar(true);
  updateScores();
  cpuPhase1();
}

/* Phase 1 — pick two hands */
function cpuPhase1() {
  state = { phase: 'cpu-p1', picks: [] };
  renderPhase1({ onConfirm: confirmCpuPhase1 });
}

function confirmCpuPhase1() {
  state.c1 = cpuPick();
  state.c2 = cpuPick();
  cpuPhase2();
}

/* Phase 2 — see CPU hands, drop one of yours */
function cpuPhase2() {
  renderPhase2({
    yourHands:    state.picks,
    opponentHands: [state.c1, state.c2],
    oppLabel:     'CPU hands — revealed',
    handCls:      'cpu-revealed',
    onDrop:       (kept) => {
      const removed  = cpuSmartRemove(state.c1, state.c2, state.picks[0], state.picks[1]);
      const cpuKept  = removed === state.c1 ? state.c2 : state.c1;
      const win      = beats(kept, cpuKept);
      const lose     = beats(cpuKept, kept);

      if (win)  scores.user++;
      else if (lose) scores.opp++;
      updateScores();

      renderReveal({
        yourKept:        kept,
        opponentKept:    cpuKept,
        yourDropped:     state.picks.find(h => h !== kept) ?? state.picks[0],
        opponentDropped: removed,
        outcome:         win ? 'win' : lose ? 'lose' : 'draw',
        onPlayAgain:     cpuPhase1,
        onMenu:          showModeSelect,
        oppLabel:        'CPU kept',
      });
    },
  });
}

/* ─────────────────────────────────────────────────
   Multiplayer lobby
───────────────────────────────────────────────── */
function showMultiLobby() {
  mode = 'multi';
  setConnStatus('connecting');

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Multiplayer</div>
    <div class="panel-instruction">How do you want to connect?</div>

    <div class="mp-options">
      <button class="mp-btn" onclick="joinQueue()">
        <span class="mp-btn-icon">⚡</span>
        <span class="mp-btn-text">
          <div class="mp-btn-title">Quick match</div>
          <div class="mp-btn-sub">Auto-pair with a random player</div>
        </span>
      </button>
      <button class="mp-btn" onclick="createPrivateRoom()">
        <span class="mp-btn-icon">🔒</span>
        <span class="mp-btn-text">
          <div class="mp-btn-title">Create private room</div>
          <div class="mp-btn-sub">Get a code to share with a friend</div>
        </span>
      </button>
      <button class="mp-btn" onclick="showJoinRoom()">
        <span class="mp-btn-icon">🔑</span>
        <span class="mp-btn-text">
          <div class="mp-btn-title">Join with code</div>
          <div class="mp-btn-sub">Enter a friend's room code</div>
        </span>
      </button>
    </div>

    <div class="panel-instruction">Multiplayer server startup time is around 2 minutes. Your patience when connecting or generating a room code is appreciated.</div>

    <button class="btn" onclick="showModeSelect()">← Back</button>
  `);

  connectWs();
}

function joinQueue() {
  connectWs(() => wsSend('joinQueue'));
  renderQueued();
}

function renderQueued() {
  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Quick match</div>
    <div class="waiting-indicator">
      <div class="waiting-dots">
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
      </div>
      <div class="waiting-text">Searching for an opponent…</div>
    </div>
    <button class="btn" onclick="cancelQueue()">Cancel</button>
  `);
}

function cancelQueue() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Reconnect drops queue membership on server
    ws.close();
  }
  showMultiLobby();
}

function createPrivateRoom() {
  connectWs(() => wsSend('createRoom'));
}

function renderWaitingForOpponent(roomId) {
  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Private room</div>
    <div class="panel-instruction">Share this code with your opponent:</div>

    <div class="room-code-box">
      <div class="room-code-label">Room code</div>
      <div class="room-code">${roomId}</div>
      <div class="room-code-hint">They must enter this exactly</div>
    </div>

    <div class="waiting-indicator" style="padding: 1rem 0;">
      <div class="waiting-dots">
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
        <div class="waiting-dot"></div>
      </div>
      <div class="waiting-text">Waiting for opponent to join…</div>
    </div>

    <button class="btn" onclick="showMultiLobby()">← Back</button>
  `);
}

function showJoinRoom() {
  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Join room</div>
    <div class="panel-instruction">Enter the room code your friend shared:</div>

    <div class="input-row">
      <input
        class="text-input"
        id="room-code-input"
        type="text"
        maxlength="8"
        placeholder="e.g. A1B2C3"
        autocomplete="off"
        onkeydown="if(event.key==='Enter') submitJoinRoom()"
      />
      <button class="btn primary" onclick="submitJoinRoom()">Join →</button>
    </div>

    <div id="join-error"></div>

    <button class="btn" onclick="showMultiLobby()">← Back</button>
  `);
  document.getElementById('room-code-input')?.focus();
}

function submitJoinRoom() {
  const input = document.getElementById('room-code-input');
  const code  = input?.value.trim().toUpperCase();
  if (!code || code.length < 4) {
    showError('Please enter a valid room code.', 'join-error');
    return;
  }
  connectWs(() => wsSend('joinRoom', { roomId: code }));
  if (ws && ws.readyState === WebSocket.OPEN) wsSend('joinRoom', { roomId: code });
}

function showError(msg, containerId = null) {
  const html = `<div class="error-msg">${msg}</div>`;
  if (containerId) {
    const el = document.getElementById(containerId);
    if (el) { el.innerHTML = html; return; }
  }
  // Prepend to game area
  const area = document.getElementById('game-area');
  const err  = document.createElement('div');
  err.innerHTML = html;
  area.prepend(err.firstChild);
}

/* ─────────────────────────────────────────────────
   Multiplayer game phases
───────────────────────────────────────────────── */
function mpPhase1() {
  state = { phase: 'mp-p1', picks: [], oppReady: false };
  renderPhase1({
    onConfirm: () => {
      wsSend('submitHands', { hands: state.picks });
      renderWaitingForPhase('Hands locked in — waiting for opponent…');
    },
  });
}

function mpPhase2(yourHands, opponentHands) {
  state.picks = yourHands;
  renderPhase2({
    yourHands,
    opponentHands,
    oppLabel:  `${oppName}'s hands`,
    handCls:   'opp-revealed',
    onDrop:    (kept) => {
      wsSend('submitDrop', { kept });
      renderWaitingForPhase('Drop confirmed — waiting for opponent…');
    },
  });
}

function mpReveal(msg) {
  const { yourKept, opponentKept, yourDropped, opponentDropped, outcome, scores: newScores } = msg;

  scores.user = newScores[state.playerNum];
  scores.opp  = newScores[1 - state.playerNum];
  updateScores();

  renderReveal({
    yourKept,
    opponentKept,
    yourDropped,
    opponentDropped,
    outcome,
    oppLabel:    `${oppName} kept`,
    onPlayAgain: () => {
      wsSend('playAgain');
      showRematchPending(true);
    },
    onMenu: () => {
      ws?.close();
      showModeSelect();
    },
  });
}

function renderWaitingForPhase(msg) {
  // Append a waiting indicator below current content without full re-render
  const area = document.getElementById('game-area');
  // Disable all buttons so player can't re-submit
  area.querySelectorAll('button').forEach(b => { b.disabled = true; });
  // Add waiting note
  const note = document.createElement('div');
  note.className = 'waiting-indicator';
  note.style.paddingTop = '1rem';
  note.innerHTML = `
    <div class="waiting-dots">
      <div class="waiting-dot"></div><div class="waiting-dot"></div><div class="waiting-dot"></div>
    </div>
    <div class="waiting-text">${msg}</div>`;
  area.appendChild(note);
}

function showOpponentReady(phase) {
  // If player hasn't submitted yet, show a small ready pill above game area
  const existing = document.getElementById('opp-ready-pill');
  if (existing) return;
  const pill = document.createElement('div');
  pill.id = 'opp-ready-pill';
  pill.className = 'opp-ready-pill';
  pill.style.cssText = 'display:block;margin-bottom:0.75rem;text-align:center;';
  pill.innerHTML = `<span style="font-size:12px;">✓</span> ${oppName} has locked in`;
  document.getElementById('game-area').prepend(pill);
}

function showRematchPending(isSelf = false) {
  // Remove any existing rematch note
  document.getElementById('rematch-note')?.remove();
  const area = document.getElementById('game-area');
  const note = document.createElement('div');
  note.id = 'rematch-note';
  note.className = 'rematch-note';
  note.textContent = isSelf
    ? `Waiting for ${oppName} to accept rematch…`
    : `${oppName} wants a rematch!`;
  area.appendChild(note);
}

function renderOpponentLeft() {
  render(`
    <div class="phase-badge" style="background:var(--red-50);color:var(--red-600);border-color:var(--red-100);">
      <div class="phase-dot" style="background:var(--red-400);"></div>Disconnected
    </div>
    <div class="panel-instruction">Your opponent left the game.</div>
    <div class="action-row">
      <button class="btn" onclick="showMultiLobby()">Find new opponent</button>
      <button class="btn primary" onclick="showModeSelect()">Main menu</button>
    </div>
  `);
}

/* ─────────────────────────────────────────────────
   Shared rendering — Phase 1 picker
   options: { onConfirm }
───────────────────────────────────────────────── */
function renderPhase1({ onConfirm }) {
  // Store callback
  state._onConfirm = onConfirm;
  state.picks = state.picks || [];
  _drawPhase1();
}

function _drawPhase1() {
  const p     = state.picks;
  const ready = p.length === 2;

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

  let buttonsHtml = `<div class="hands-row">`;
  for (const h of HANDS) {
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

  const oppReadyPill = state.oppReady
    ? `<div class="opp-ready-pill"><span>✓</span> ${oppName} is ready</div>`
    : '';

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Phase 1 of 2</div>
    ${oppReadyPill}
    <div class="panel-instruction">Choose <strong>two hands</strong> to play. They can be the same.</div>
    ${summaryHtml}
    ${buttonsHtml}
    <button class="confirm-btn" ${ready ? '' : 'disabled'} onclick="confirmPhase1()">
      ${mode === 'multi' ? 'Lock in hands →' : 'Shoot! — reveal CPU hands →'}
    </button>
  `);
}

/* Called from inline onclick */
function pickHand(h) {
  const p = state.picks;

  if (p.length === 0) {
    state.picks = [h];
  } else if (p.length === 1) {
    state.picks = [p[0], h];
  } else {
    const isBoth   = p[0] === h && p[1] === h;
    const isFirst  = p[0] === h;
    const isSecond = p[1] === h;
    if (isBoth)        state.picks = [h];
    else if (isFirst)  state.picks = [p[1]];
    else if (isSecond) state.picks = [p[0]];
    else               state.picks = [p[0], h];
  }

  _drawPhase1();
}

function confirmPhase1() {
  if (state.picks.length !== 2) return;
  state._onConfirm?.();
}

/* ─────────────────────────────────────────────────
   Shared rendering — Phase 2
   options: { yourHands, opponentHands, oppLabel, handCls, onDrop }
───────────────────────────────────────────────── */
function renderPhase2({ yourHands, opponentHands, oppLabel, handCls, onDrop }) {
  state._onDrop = onDrop;
  state.picks   = yourHands;
  const [u1, u2] = yourHands;
  const [o1, o2] = opponentHands;

  render(`
    <div class="phase-badge"><div class="phase-dot"></div>Phase 2 of 2</div>
    <div class="panel-instruction">${mode === 'multi' ? `${oppName} has` : 'CPU has'} revealed their hands. Now <strong>drop one of yours</strong>.</div>

    <div class="arena">
      <div class="arena-side">
        <div class="arena-label">Your hands — tap to drop</div>
        <div class="arena-hands">
          <div class="arena-hand droppable" onclick="dropHand(0)">
            <span>${ICONS[u1]}</span>
            <span class="sm-label">${NAMES[u1]}</span>
          </div>
          <div class="arena-hand droppable" onclick="dropHand(1)">
            <span>${ICONS[u2]}</span>
            <span class="sm-label">${NAMES[u2]}</span>
          </div>
        </div>
      </div>

      <div class="vs-badge">VS</div>

      <div class="arena-side">
        <div class="arena-label">${oppLabel}</div>
        <div class="arena-hands">
          <div class="arena-hand ${handCls}">
            <span>${ICONS[o1]}</span>
            <span class="sm-label">${NAMES[o1]}</span>
          </div>
          <div class="arena-hand ${handCls}">
            <span>${ICONS[o2]}</span>
            <span class="sm-label">${NAMES[o2]}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="drop-hint">Tap a hand above to drop it. Your other hand plays.</div>
  `);
}

/* Called from inline onclick — droppedIdx is the index (0 or 1) of the hand being dropped */
function dropHand(droppedIdx) {
  const kept = state.picks[1 - droppedIdx]; // the OTHER hand is kept
  state._onDrop?.(kept);
}

/* ─────────────────────────────────────────────────
   Shared rendering — Reveal
   options: { yourKept, opponentKept, yourDropped, opponentDropped,
              outcome, oppLabel, onPlayAgain, onMenu }
───────────────────────────────────────────────── */
function renderReveal({ yourKept, opponentKept, yourDropped, opponentDropped,
                         outcome, oppLabel, onPlayAgain, onMenu }) {
  state._onPlayAgain = onPlayAgain;
  state._onMenu      = onMenu;

  const win  = outcome === 'win';
  const lose = outcome === 'lose';

  const resultIcon   = win ? '🏆' : lose ? '💀' : '🤝';
  const resultText   = win ? 'You win!' : lose ? 'You lose.' : 'Draw!';
  const resultSub    = win
    ? `${NAMES[yourKept]} beats ${NAMES[opponentKept]}`
    : lose
      ? `${NAMES[opponentKept]} beats ${NAMES[yourKept]}`
      : `Both played ${NAMES[yourKept]}`;
  const resultBorder = win
    ? 'border-color: var(--green-400);'
    : lose ? 'border-color: var(--red-400);' : '';

  const userHandCls = 'arena-hand' + (win ? ' final-win' : lose ? ' final-lose' : '');
  const oppHandCls  = 'arena-hand' + (lose ? ' final-win' : win ? ' final-lose' : '');

  // Show both CPU hands (kept + dropped/faded)
  const oppHandsHtml = `
    <div class="arena-hand removed">
      <span>${ICONS[opponentDropped]}</span>
      <span class="sm-label">dropped</span>
    </div>
    <div class="${oppHandCls}">
      <span>${ICONS[opponentKept]}</span>
      <span class="sm-label">${NAMES[opponentKept]}</span>
    </div>`;

  render(`
    <div class="phase-badge" style="background:#F2F1ED;color:var(--text-2);border-color:var(--border);">
      <div class="phase-dot" style="background:var(--text-3);"></div>Result
    </div>

    <div class="arena" style="margin-bottom:1rem;">
      <div class="arena-side">
        <div class="arena-label">You kept</div>
        <div class="arena-hands">
          <div class="${userHandCls}">
            <span>${ICONS[yourKept]}</span>
            <span class="sm-label">${NAMES[yourKept]}</span>
          </div>
        </div>
      </div>

      <div class="vs-badge">VS</div>

      <div class="arena-side">
        <div class="arena-label">${oppLabel ?? (mode === 'multi' ? oppName + ' kept' : 'CPU kept')}</div>
        <div class="arena-hands">${oppHandsHtml}</div>
      </div>
    </div>

    <div class="result-box" style="${resultBorder}">
      <div class="result-emoji">${resultIcon}</div>
      <div class="result-text">${resultText}</div>
      <div class="result-sub">${resultSub}</div>
    </div>

    <div class="cpu-reveal-note">
      You dropped ${NAMES[yourDropped]} · opponent dropped ${NAMES[opponentDropped]}
    </div>

    <div class="action-row">
      <button class="btn" onclick="goMenu()">Menu</button>
      <button class="btn primary" onclick="playAgain()">
        ${mode === 'multi' ? 'Rematch →' : 'Play again →'}
      </button>
    </div>
  `);
}

/* Called from inline onclick — delegates to stored callbacks */
function playAgain() { state._onPlayAgain?.(); }
function goMenu()    { state._onMenu?.(); }

/* ─────────────────────────────────────────────────
   Boot
───────────────────────────────────────────────── */
showModeSelect();
