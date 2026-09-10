// かめプログラミング - シンプルなインタプリタ + ワールド描画
const GRID_SIZE = 10;
const STEP_DELAY_MS = 400;

const FOOD_EMOJI = { apple: '🍎', orange: '🍊', melon: '🍈' };
const FOOD_NAME = { apple: 'りんご', orange: 'みかん', melon: 'メロン' };

const DEFAULT_STAGE = [
  '# ステージをつくろう!',
  'apple(2, 2)',
  'apple(7, 8)',
  'orange(5, 5)',
  'melon(9, 1)',
  'kame(1, 1)',
].join('\n');

const DEFAULT_TURTLE = [
  '# かめをうごかそう!',
  'right(1)',
  'down(1)',
  'eat()',
  'right(3)',
  'down(3)',
  'eat()',
].join('\n');

const stageInput = document.getElementById('stageInput');
const turtleInput = document.getElementById('turtleInput');
const gridEl = document.getElementById('grid');
const logList = document.getElementById('logList');
const docsPanel = document.getElementById('docsPanel');

const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const randomBtn = document.getElementById('randomBtn');
const docsBtn = document.getElementById('docsBtn');

let world = { turtle: { x: 1, y: 1, dir: 'right' }, foods: [] };
let actionQueue = [];
let queueIndex = 0;
let runTimer = null;

// ---------- 超簡単な言語のパーサー ----------

function parseProgram(text, allowedFns) {
  const lines = text.split('\n');
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;

    const m = line.match(/^([a-zA-Z]+)\s*\(\s*([^)]*)\s*\)\s*;?$/);
    if (!m) {
      return { ok: false, error: `${i + 1}ぎょうめが よめないよ: 「${line}」` };
    }
    const fn = m[1];
    const argsStr = m[2].trim();
    const rawArgs = argsStr === '' ? [] : argsStr.split(',').map(s => s.trim());

    if (!allowedFns.includes(fn)) {
      return { ok: false, error: `${i + 1}ぎょうめの「${fn}」は つかえないよ` };
    }

    const args = [];
    for (const a of rawArgs) {
      const n = Number(a);
      if (a === '' || !Number.isInteger(n)) {
        return { ok: false, error: `${i + 1}ぎょうめの すうじが おかしいよ: 「${a}」` };
      }
      args.push(n);
    }
    commands.push({ fn, args, line: i + 1 });
  }
  return { ok: true, commands };
}

function parseStage(text) {
  const res = parseProgram(text, ['apple', 'orange', 'melon', 'kame']);
  if (!res.ok) return res;

  const foods = [];
  let kame = null;

  for (const c of res.commands) {
    if (c.args.length !== 2) {
      return { ok: false, error: `${c.line}ぎょうめ: ${c.fn}(x, y) の かたちで かいてね` };
    }
    if (c.fn === 'kame') {
      if (kame) {
        return { ok: false, error: `kame(x, y) は 1かいだけ かいてね（${c.line}ぎょうめ）` };
      }
      kame = { x: c.args[0], y: c.args[1] };
    } else {
      foods.push({ type: c.fn, x: c.args[0], y: c.args[1], eaten: false });
    }
  }

  if (!kame) {
    return { ok: false, error: 'kame(x, y) を 1かい かいてね!' };
  }

  for (const p of [kame, ...foods]) {
    if (p.x < 1 || p.x > GRID_SIZE || p.y < 1 || p.y > GRID_SIZE) {
      return { ok: false, error: `x と y は 1〜${GRID_SIZE} の あいだで かいてね` };
    }
  }

  return { ok: true, kame, foods };
}

function parseTurtleProgram(text) {
  const res = parseProgram(text, ['up', 'down', 'left', 'right', 'eat']);
  if (!res.ok) return res;

  const actions = [];
  for (const c of res.commands) {
    if (c.fn === 'eat') {
      if (c.args.length !== 0) {
        return { ok: false, error: `${c.line}ぎょうめ: eat() に すうじは いらないよ` };
      }
      actions.push({ type: 'eat' });
    } else {
      if (c.args.length !== 1) {
        return { ok: false, error: `${c.line}ぎょうめ: ${c.fn}(n) の かたちで かいてね` };
      }
      const n = c.args[0];
      if (n < 0) {
        return { ok: false, error: `${c.line}ぎょうめ: すうじは 0いじょうに してね` };
      }
      for (let i = 0; i < n; i++) actions.push({ type: 'move', dir: c.fn });
    }
  }
  return { ok: true, actions };
}

// ---------- グリッド描画 ----------

function buildGridSkeleton() {
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(${GRID_SIZE + 1}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${GRID_SIZE + 1}, 1fr)`;

  const corner = document.createElement('div');
  corner.className = 'cell cell-label';
  corner.style.gridRow = 1;
  corner.style.gridColumn = 1;
  gridEl.appendChild(corner);

  for (let x = 1; x <= GRID_SIZE; x++) {
    const label = document.createElement('div');
    label.className = 'cell cell-label';
    label.textContent = x;
    label.style.gridRow = 1;
    label.style.gridColumn = x + 1;
    gridEl.appendChild(label);
  }

  for (let y = 1; y <= GRID_SIZE; y++) {
    const label = document.createElement('div');
    label.className = 'cell cell-label';
    label.textContent = y;
    label.style.gridRow = y + 1;
    label.style.gridColumn = 1;
    gridEl.appendChild(label);

    for (let x = 1; x <= GRID_SIZE; x++) {
      const cell = document.createElement('div');
      const parity = (x + y) % 2 === 0 ? 'parity-even' : 'parity-odd';
      cell.className = `cell cell-data ${parity}`;
      cell.id = `cell-${x}-${y}`;
      cell.style.gridRow = y + 1;
      cell.style.gridColumn = x + 1;
      gridEl.appendChild(cell);
    }
  }

  const turtleEl = document.createElement('div');
  turtleEl.id = 'turtle';
  turtleEl.textContent = '🐢';
  gridEl.appendChild(turtleEl);
}

function renderWorld() {
  for (let y = 1; y <= GRID_SIZE; y++) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      const cell = document.getElementById(`cell-${x}-${y}`);
      if (cell) cell.textContent = '';
    }
  }
  for (const food of world.foods) {
    if (food.eaten) continue;
    const cell = document.getElementById(`cell-${food.x}-${food.y}`);
    if (cell) cell.textContent = FOOD_EMOJI[food.type];
  }

  const turtleEl = document.getElementById('turtle');
  turtleEl.style.gridRow = world.turtle.y + 1;
  turtleEl.style.gridColumn = world.turtle.x + 1;
  turtleEl.className = `turtle-${world.turtle.dir}`;
}

// ---------- 実行ロジック ----------

function logMessage(text) {
  const li = document.createElement('li');
  li.textContent = text;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
  while (logList.children.length > 30) {
    logList.removeChild(logList.firstChild);
  }
}

function resetWorldFromStage(stageResult) {
  world = {
    turtle: { x: stageResult.kame.x, y: stageResult.kame.y, dir: 'right' },
    foods: stageResult.foods.map(f => ({ ...f })),
  };
  renderWorld();
}

function stopRun() {
  if (runTimer) {
    clearInterval(runTimer);
    runTimer = null;
  }
}

function applyMove(dir) {
  const t = world.turtle;
  t.dir = dir;
  let nx = t.x, ny = t.y;
  if (dir === 'up') ny -= 1;
  if (dir === 'down') ny += 1;
  if (dir === 'left') nx -= 1;
  if (dir === 'right') nx += 1;
  nx = Math.min(GRID_SIZE, Math.max(1, nx));
  ny = Math.min(GRID_SIZE, Math.max(1, ny));
  const blocked = nx === t.x && ny === t.y;
  t.x = nx;
  t.y = ny;
  return !blocked;
}

function tryEat() {
  const t = world.turtle;
  const food = world.foods.find(f => !f.eaten && f.x === t.x && f.y === t.y);
  if (food) {
    food.eaten = true;
    logMessage(`${FOOD_EMOJI[food.type]} ${FOOD_NAME[food.type]}を たべたよ!`);
  } else {
    logMessage('😶 ここには なにも なかったよ');
  }
}

function stepOnce() {
  if (queueIndex >= actionQueue.length) {
    stopRun();
    logMessage('🎉 プログラムが おわったよ!');
    return;
  }
  const action = actionQueue[queueIndex++];
  if (action.type === 'move') {
    const moved = applyMove(action.dir);
    if (!moved) logMessage('🧱 かべに ぶつかったよ');
  } else if (action.type === 'eat') {
    tryEat();
  }
  renderWorld();
}

function startRun() {
  stopRun();
  const stageResult = parseStage(stageInput.value);
  if (!stageResult.ok) {
    logMessage(`❌ ステージ: ${stageResult.error}`);
    return;
  }
  resetWorldFromStage(stageResult);

  const turtleResult = parseTurtleProgram(turtleInput.value);
  if (!turtleResult.ok) {
    logMessage(`❌ かめ: ${turtleResult.error}`);
    return;
  }
  if (turtleResult.actions.length === 0) {
    logMessage('かめの プログラムが からっぽだよ');
    return;
  }

  actionQueue = turtleResult.actions;
  queueIndex = 0;
  logMessage('▶ スタート!');
  runTimer = setInterval(stepOnce, STEP_DELAY_MS);
}

function resetWorld() {
  stopRun();
  const stageResult = parseStage(stageInput.value);
  if (!stageResult.ok) {
    logMessage(`❌ ステージ: ${stageResult.error}`);
    return;
  }
  resetWorldFromStage(stageResult);
  logMessage('🔄 リセットしたよ');
}

function generateRandomStage() {
  const types = ['apple', 'orange', 'melon'];
  const used = new Set();
  const key = (x, y) => `${x},${y}`;
  const randCoord = () => 1 + Math.floor(Math.random() * GRID_SIZE);

  const kx = randCoord();
  const ky = randCoord();
  used.add(key(kx, ky));

  const foodCount = 4 + Math.floor(Math.random() * 3);
  const lines = ['# ランダムステージ'];
  for (let i = 0; i < foodCount; i++) {
    let x, y, tries = 0;
    do {
      x = randCoord();
      y = randCoord();
      tries++;
    } while (used.has(key(x, y)) && tries < 50);
    used.add(key(x, y));
    const type = types[Math.floor(Math.random() * types.length)];
    lines.push(`${type}(${x}, ${y})`);
  }
  lines.push(`kame(${kx}, ${ky})`);
  return lines.join('\n');
}

// ---------- イベント ----------

runBtn.addEventListener('click', startRun);
stopBtn.addEventListener('click', () => {
  stopRun();
  logMessage('⏸ とめたよ');
});
resetBtn.addEventListener('click', resetWorld);
randomBtn.addEventListener('click', () => {
  stageInput.value = generateRandomStage();
  resetWorld();
});
docsBtn.addEventListener('click', () => {
  docsPanel.hidden = !docsPanel.hidden;
});

// ---------- 初期化 ----------

stageInput.value = DEFAULT_STAGE;
turtleInput.value = DEFAULT_TURTLE;
buildGridSkeleton();
resetWorld();
logMessage('ようこそ! ▶ じっこう を おしてみよう');
