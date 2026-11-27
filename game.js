'use strict';

function gameEntries(entries) { const result = {}; for (const pair of entries) result[pair[0]] = pair[1]; return result; }
const LOW_POWER = !!window.GAME_LOW_POWER;
if (window.__startup) window.__startup('webgl', '正在建立直升機 3D 畫面（' + (LOW_POWER ? '手機省資源' : '標準') + '）', false);
const GAME_BUILD = window.GAME_BUILD || 's1-20261127-1332';
// Diagnostic switches are explicit and independent of map loading/flight logic.
// showDock restores the obsolete synthetic platform ONLY for identification.
const renderQuery = new URLSearchParams(location.search);
const renderOptions = Object.freeze(gameEntries(
  ['hideObjects', 'hideMap', 'hideDrone', 'showDock', 'objectTint']
    .map(name => [name, renderQuery.get(name) === '1'])
));
let lastObjectCounts = { dockVertices: 0, missionVertices: 0 };
let lastRenderFrame = {};

function reportInitError(stage, error) {
  const message = String(error && (error.message || error) || 'unknown error').replace(/\s+/g, ' ').slice(0, 280);
  if (typeof window.__diag === 'function') {
    window.__diag({ type: 'init', stage: stage, message: message });
  }
  const stamp = byId('build-id');
  if (stamp) {
    stamp.hidden = false;
    stamp.textContent = '版本 ' + GAME_BUILD + ' · ' + stage;
    stamp.dataset.error = message;
  }
  return message;
}
function showInitFailure(stage, error) {
  const detail = reportInitError(stage, error);
  if (window.__startup) window.__startup('error', stage + ': ' + detail, false);
  start.disabled = true;
  start.dataset.unlocked = '0';
  start.textContent = '未能開始飛行';
  if (byId('explore')) byId('explore').disabled = true;
  byId('briefing').textContent = '未能載入 3D 畫面（' + GAME_BUILD + '／' + stage + '）。原因：' + detail;
  if (window.__introPendingStart) {
    window.__introPendingStart = false;
    showInitFailureOverlay();
  }
}

function appendBriefing(note) {
  const node = byId('briefing');
  if (!node || !note) return;
  node.textContent += note;
}

function allSettled(promises) {
  if (typeof Promise.allSettled === 'function') return Promise.allSettled(promises);
  return Promise.all(promises.map(item => Promise.resolve(item).then(
    value => ({ status: 'fulfilled', value: value }),
    reason => ({ status: 'rejected', reason: reason })
  )));
}

// Unlock as soon as the WebGL renderer can draw. Do not wait for network
// tiles, baked atlas images, or drone textures — those settle in the background.
function enableFlightStart() {
  if (start.dataset.unlocked === '1' || start.textContent === '未能開始飛行') return;
  start.dataset.unlocked = '1';
  if (window.__startup) window.__startup('ready', (LOW_POWER ? '手機省資源模式' : '3D 畫面') + '已就緒；地圖會在起飛後逐步載入', true);
  start.textContent = '開始任務';
  start.disabled = false;
  if (byId('explore')) byId('explore').disabled = false;
  const stamp = byId('build-id');
  if (stamp && window.GAME_DEBUG && !window.__heliInitError && !stamp.dataset.error) {
    stamp.textContent = '版本 ' + GAME_BUILD + ' · 已初始化';
  }
  // If the player already pressed LET'S GO on a section title, start or resume.
  // Guarded so the regression fixture (which only evals this slice) is safe.
  if (window.__introPendingStart && typeof startOrResumeSection === 'function') {
    window.__introPendingStart = false;
    startOrResumeSection();
  }
}


const byId = id => document.getElementById(id);
const canvas = byId('world');
const gl = canvas.getContext('webgl', { antialias: !LOW_POWER, powerPreference: LOW_POWER ? 'low-power' : 'default' });
const map = byId('map').getContext('2d');
const start = byId('start');
let contextLost = false;
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  contextLost = true;
  clearFlightInput();
  if (byId('intro')) byId('intro').hidden = true;
  byId('overlay').hidden = false;
  showInitFailure('context-lost', Error('手機 3D 資源已中斷；請用相容模式重載'));
});

// Named coastal objects; Tung Wan moved onto the sandy beach using LandsD imagery.
// Nam Tam is the actual locality, NOT Po Toi's identically named bay.
const MISSION_TIME_LIMIT = 600;
const BALLOON_HEIGHT = 160;
const BALLOON_REACH = 150;
const BALLOON_RESPAWN_MIN = 380;
const BALLOON_SKY_MIN = 320;
const BALLOON_SKY_MAX = 400;
const BALLOON_FIRST_DIST = 3000;
const BALLOON_NEAR = 500;
const BALLOON_FAR = 1400;
const QUIZ_FADE_MS = 280;
let quizFadeTimer = null;
let quizLeaving = false;
const CHAPTER_GOAL = 3;
const CHAPTER_QUIZZES = [
  [
    { prompt: '海岸考察前查閱潮汐預報表最主要原因是甚麼？', choices: ['A. 避免正午高溫導致中暑', 'B. 了解漲潮和退潮的時間，確保考察的安全性', 'C. 配合渡輪班次以節省時間', 'D. 建設性波浪只在清晨出現'], correct: 1 },
    { prompt: '下列哪項正確排列海灘剖面(beach profile)由外海至陸地方向的各個地帶？', choices: ['A. 後灘 → 前灘 → 近岸 → 濱外', 'B. 濱外 → 近岸 → 前灘 → 後灘', 'C. 近岸 → 濱外 → 後灘 → 前灘', 'D. 前灘 → 後灘 → 濱外 → 近岸'], correct: 1 },
    { prompt: '前灘的沉積物較幼細，以砂粒為主，而後灘多見卵石。造成這種沉積物分選的主要機制是甚麼？', choices: ['A. 能量較強的沖流可將卵石推向後灘，較弱的回流把較幼細的沉積物帶回前灘', 'B. 沿岸漂移只搬運粗礫至海灣兩側', 'C. 後灘風化作用較強，使岩石碎裂成卵石', 'D. 濱外區域的潮差較後灘大，令前灘的粗礫被帶走'], correct: 0 },
    { prompt: '為甚麼接近岬角(headland)的海灘，其沉積物通常較粗？', choices: ['A. 岬角附近河流帶來較粗的沉積物', 'B. 波浪折射令岬角能量較為集中，較幼的沉積物被帶走，留下較粗的沉積物', 'C. 岬角的離岸風吹走幼細的沉積物', 'D. 岬角岩石的抗蝕力低，容易受風化而崩塌成石塊'], correct: 1 },
    { prompt: '下列哪項關於「建設性波浪」（Constructive waves）的描述是正確的？', choices: ['A. 波高(wave height)較高，波長(wave length)較短', 'B. 波浪頻率高', 'C. 沖流(swash)強於回流(backwash)', 'D. 常見於強風暴吹襲期間'], correct: 2 },
    { prompt: '海浪攜帶大量搬運物，不斷撞擊及磨擦海崖底部，使岩石逐漸被削走。這種侵蝕作用稱為甚麼？', choices: ['A. 磨蝕作用（Abrasion）', 'B. 磨耗作用（Attrition）', 'C. 溶蝕作用（Solution）', 'D. 水力作用（Hydraulic action）'], correct: 0 },
    { prompt: '長洲的東岸沒有遮擋，風浪特別強勁。決定波浪能量的最主要因素不包括哪項？', choices: ['A. 吹程（Fetch）的長短', 'B. 風速與持續時間', 'C. 海水鹽度高低', 'D. 近岸海底水深變化'], correct: 2 }
  ],
  [
    { prompt: '哪組波浪與侵蝕作用最有利於海崖(sea cliff)及海蝕凹地(notch)形成？', choices: ['A. 建設性波浪；水力作用與溶蝕作用', 'B. 建設性波浪；磨蝕作用與磨耗作用', 'C. 破壞性波浪；水力作用與磨蝕作用', 'D. 破壞性波浪；沿岸漂移與沉積作用'], correct: 2 },
    { prompt: '下列哪項正確排列「浪蝕平台」(wave-cut platform)的形成次序？①凹地頂崩塌成崖 ②形成海蝕凹地 ③波浪沖走岩屑令平台變闊', choices: ['A. ① → ② → ③', 'B. ② → ① → ③', 'C. ② → ③ → ①', 'D. ③ → ② → ①'], correct: 1 },
    { prompt: '一般浪蝕平台漲潮時會被淹沒，但長洲南氹的浪蝕平台(wave-cut platform)在漲潮時仍露出水面，主要原因是？', choices: ['A. 全球海平面急劇下降', 'B. 該處曾經歷地殼抬升', 'C. 大規模火山噴發，熔岩在該處堆積', 'D. 附近河口的沉積物在平台上大量淤積'], correct: 1 }
  ],
  [
    { prompt: '海蝕隙(Geo)的形成與哪項岩石特徵關係最密切？', choices: ['A. 岩石礦物成分均勻', 'B. 岩石存在天然裂縫或弱線', 'C. 岩石抗蝕力極高', 'D. 岩石表面覆蓋著厚層土壤'], correct: 1 },
    { prompt: '「海蝕隙」（Geo）的外觀形態主要是怎樣的？', choices: ['A. 連接兩個島嶼的狹長沙堤', 'B. 海岸岩壁上一條狹窄而深長的岩石縫隙', 'C. 海面上獨立矗立的圓形石柱', 'D. 在岬角形成拱形橋狀或隧道狀通道'], correct: 1 },
    { prompt: '若長洲北角咀的「海蝕隙」（Geo）繼續受到海浪強烈侵蝕並進一步擴展，它有機會發展成哪種地貌？', choices: ['A. 連島沙洲（Tombolo）', 'B. 更寬闊的海蝕穴（Sea cave）', 'C. 沙嘴（Spit）', 'D. 潟湖（Lagoon）'], correct: 1 }
  ],
  [
    { prompt: '在岬角正面及背面的海蝕穴發展成海蝕柱的次序是？①拱頂倒塌 ②兩邊海蝕穴不斷被波浪侵蝕 ③兩邊海蝕穴貫穿成拱', choices: ['A. ① → ② → ③', 'B. ② → ① → ③', 'C. ② → ③ → ①', 'D. ③ → ② → ①'], correct: 2 },
    { prompt: '「海蝕柱」（Stack）的外觀形態主要是怎樣的？', choices: ['A. 連接兩個島嶼的狹長沙堤', 'B. 矗立在海面上的獨立岩石柱', 'C. 岩壁底部向內凹陷的深洞', 'D. 在岬角形成拱形橋狀或隧道狀通道'], correct: 1 },
    { prompt: '「海蝕柱」（Stack）是由下列哪一種海岸地貌的頂部倒塌而直接演變而成的？', choices: ['A. 海崖（Sea cliff）', 'B. 浪蝕平台（Wave-cut platform）', 'C. 海蝕拱（Sea arch）', 'D. 沙嘴（Spit）'], correct: 2 }
  ]
];
const balloon = { x: 0, y: 0, z: 0, yaw: 0, visible: false, armed: false };
let quizDeck = [];
let quizAsked = 0;
let quizPhase = 'off';
let quizCurrent = null;
let quizIntroSeen = false;
let lastBalloon = null;
let quizChapter = 0;
let chapterProgress = emptyChapterProgress();

function emptyChapterProgress() {
  return (typeof CHAPTER_QUIZZES !== 'undefined' ? CHAPTER_QUIZZES : [[], [], [], []]).map(() => ({ correct: 0, solved: [] }));
}

function chapterUnlocked(index) {
  if (index == null) index = run && run.next;
  if (run && run.explore) return true;
  const row = chapterProgress[index];
  return !!(row && row.correct >= CHAPTER_GOAL);
}

function chapterQuestions(index) {
  return CHAPTER_QUIZZES[index] || [];
}

function unsolvedQuestionIndexes(index) {
  const row = chapterProgress[index] || { solved: [] };
  return chapterQuestions(index).map((_, i) => i).filter(i => row.solved.indexOf(i) < 0);
}

function chapterHasQuiz(index) {
  if (index == null) index = run && run.next;
  return !chapterUnlocked(index) && unsolvedQuestionIndexes(index).length > 0;
}
const route = [
  { name: '東灣', lat: 22.211842, lon: 114.029212, source: 'http://www.hong-kong.su/tung-wan-beach/' },
  { name: '南氹', lat: 22.2031516, lon: 114.0317132, source: 'https://www.openstreetmap.org/node/3239128609' },
  { name: '東灣仔', lat: 22.216894575413754, lon: 114.03374428205683, agl: 50, source: 'user-adjusted 2026-11-24; near https://www.openstreetmap.org/node/1134027647' },
  { name: '觀音灣（饅頭石）', lat: 22.2087992, lon: 114.0369247, source: 'https://www.openstreetmap.org/way/596846734' }
].map(point => ({ ...point, ...HK.toXZ(point.lat, point.lon) }));
const LAST_ROUTE_INDEX = route.length - 1;
function missionAgl(point) {
  const agl = point && Number(point.agl);
  return Number.isFinite(agl) ? agl : MIN_AGL;
}

function missionTarget(index = run.next) {
  const point = route[index];
  // Re-sample the current rendered surface: streamed terrain may arrive mid-flight.
  // Checkpoint centres are AGL above that surface (default 30 m; 小螢 is 50 m),
  // not a cached sea-level altitude. The global flight floor stays MIN_AGL.
  return { ...point, y: surfaceHeight(point.x, point.z) + missionAgl(point) };
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const bearing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const run = { mode: 'ready', next: 0, time: 0, camera: false, explore: false, sessionStarted: false };
let tiles = null;
let bakedLand = null;
const atlasTextures = [];
let heliRenderer = null;
let heliAssetState = 'waiting';
let balloonRenderer = null;
let balloonAssetState = 'waiting';
const lazyScripts = {};
function loadGameScript(file) {
  if (lazyScripts[file]) return lazyScripts[file];
  lazyScripts[file] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = file + '?v=' + GAME_BUILD;
    script.fetchPriority = 'low';
    script.dataset.optional = '1';
    script.onload = resolve;
    script.onerror = () => { delete lazyScripts[file]; reject(Error(file + ' 載入失敗')); };
    document.head.appendChild(script);
  });
  return lazyScripts[file];
}
const craft = { x: 0, y: 4, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0 };
const keys = new Set();
const pointers = new Map();
const buttons = [...document.querySelectorAll('[data-key]')];
const active = key => keys.has(key) || [...pointers.values()].includes(key);
const items = [];
function populatePlaces() {
  // School edition has a single Cheung Chau start; the place selector is omitted.
}


function terrainSample(column, row) {
  const index = 2 * (row * 401 + column);
  const sample = terrainBytes.charCodeAt(index) | terrainBytes.charCodeAt(index + 1) << 8;
  return Math.max(0, (sample << 16 >> 16) / 10);
}

let detailGrid = window.HK_DEPARTURE_TERRAIN || null;
let detailBytes = detailGrid ? atob(detailGrid.data) : '';
let offlineDataPromise = null;
function loadOfflineData() {
  if (detailGrid && typeof terrainBytes !== 'undefined') return Promise.resolve();
  if (!offlineDataPromise) offlineDataPromise = Promise.all([
    typeof terrainBytes !== 'undefined' ? Promise.resolve() : loadGameScript('terrain.js'),
    detailGrid ? Promise.resolve() : loadGameScript('local-heights.js')
  ]).then(() => {
    detailGrid = window.HK_DEPARTURE_TERRAIN;
    detailBytes = atob(detailGrid.data);
  }).catch(error => { offlineDataPromise = null; throw error; });
  return offlineDataPromise;
}
function bakedElevation(x, z) {
  if (!detailGrid || typeof terrainBytes === 'undefined') return null;
  const c = (x / 103 - 73.3 - detailGrid.x) / detailGrid.step;
  const r = (71.85 - z / 111 - detailGrid.z) / detailGrid.step;
  if (c >= 0 && r >= 0 && c < detailGrid.width-1 && r < detailGrid.height-1) {
    const left = Math.floor(c), top = Math.floor(r);
    const sample = (col,row) => {
      const i = 2 * (row * detailGrid.width + col);
      const raw = (detailBytes.charCodeAt(i) | detailBytes.charCodeAt(i+1)<<8)<<16>>16;
      return Math.max(0,raw*.1);
    };
    const dx=c-left, dz=r-top;
    return (sample(left,top)*(1-dx)+sample(left+1,top)*dx)*(1-dz)
      + (sample(left,top+1)*(1-dx)+sample(left+1,top+1)*dx)*dz;
  }
  const column = (x / 103 + 46.7) / .3;
  const row = (106.85 - z / 111) / .3;
  if (column < 0 || column > 400 || row < 0 || row > 490) return null;
  const left = Math.min(399, Math.floor(column));
  const top = Math.min(489, Math.floor(row));
  const east = column - left;
  const south = row - top;
  const upper = terrainSample(left, top) * (1 - east) + terrainSample(left + 1, top) * east;
  const lower = terrainSample(left, top + 1) * (1 - east) + terrainSample(left + 1, top + 1) * east;
  return upper * (1 - south) + lower * south;
}

function heightMode() {
  if (tiles && tiles.getHeightMode) return tiles.getHeightMode();
  return (typeof HK !== 'undefined' && HK.heightDebug && HK.heightDebug.mode) || 'auto';
}

function elevation(x, z) {
  const mode = heightMode();
  if (mode === 'baked') {
    const baked = bakedElevation(x, z);
    return baked == null ? 0 : baked;
  }
  if (tiles) {
    const streamed = tiles.terrainElevation(x, z);
    if (streamed != null) return streamed;
  }
  if (mode === 'tiles') return 0;
  const baked = bakedElevation(x, z);
  return baked == null ? 0 : baked;
}

function selectedPlace() {
  return (HK.places && HK.places[0]) || { id: 'south-approach', name: '南面海域', lat: 22.1892017, lon: 114.0360482, yaw: 5.934119456780721, altitude: 589, mission: true };
}

const MIN_AGL = (typeof HK !== 'undefined' && HK.MIN_AGL) || 30;

function surfaceHeight(x, z) {
  return Math.max(0, elevation(x, z));
}

function terrainFloor(x, z) {
  return surfaceHeight(x, z) + MIN_AGL;
}

function altitudeAgl(x, y, z) {
  return y - surfaceHeight(x, z);
}

function placeCraft(place, explore) {
  const pos = HK.toXZ(place.lat, place.lon);
  // Global floor stays 30 m AGL; a place may start higher (e.g. 589 m).
  const floor = terrainFloor(pos.x, pos.z);
  const ceiling = (typeof HK !== 'undefined' && HK.MAX_ALTITUDE) || 2500;
  const startY = place.altitude != null ? clamp(place.altitude, floor, ceiling) : floor;
  Object.assign(craft, {
    x: pos.x,
    y: startY,
    z: pos.z,
    vx: 0, vy: 0, vz: 0,
    yaw: place.yaw == null ? 0 : place.yaw
  });
}


const defaultBriefing = byId('briefing') ? byId('briefing').textContent : '';
const defaultTitle = byId('title') ? byId('title').textContent : '郊野學園考察團';

const INTRO_PAGES = [
  { src: 'intro/01-title.jpg', alt: '郊野學園考察團　出發吧～認識海岸地貌' },
  { src: 'intro/02-depart.jpg', alt: '地理考察加油站嘅《郊野學園考察團》正式出發' },
  { src: 'intro/03-late.jpg', alt: '遲大到' },
  { src: 'intro/04-skill.jpg', alt: '金剛仔特殊技能發動' },
  { src: 'intro/05-accident.jpg', alt: '可惜中途發生意外，眾人下落不明' },
  { src: 'intro/06-news.jpg', alt: '飛行服務隊於長洲海岸展開搜救，準備出發' }
];
const SECTIONS = [
  {
    search: 'intro/s1-search.jpg', found: 'intro/s1-found.mp4', foundPoster: 'intro/s1-found-poster.jpg',
    searchAlt: '尋找莫博士　出發吧～認識海岸地貌', foundAlt: '已找到莫博士',
    character: '莫博士', hintWhere: '島的東邊', hint: '與海洋相連的狹長地帶',
    bridge: [
      { src: 'intro/s1-bridge-1.jpg', alt: '莫博士特殊技能發動　戴回眼鏡嘅莫博士希望幫忙搜救團員，發動特殊技能「真相放大」' },
      { src: 'intro/s1-bridge-2.jpg', alt: '「真相放大」睇到金剛仔趴喺巨大岩石上，大家估下金剛仔所在嘅位置屬於邊種海岸地貌？' }
    ]
  },
  {
    search: 'intro/s2-search.jpg', found: 'intro/s2-found.mp4', foundPoster: 'intro/s2-found-poster.jpg',
    searchAlt: '尋找金剛仔　出發吧～認識海岸地貌', foundAlt: '已找到莫博士同金剛仔',
    character: '金剛仔', hintWhere: '島的南邊', hint: '沿海巨大岩石附近',
    bridge: [
      { src: 'intro/s2-bridge-1.jpg', alt: '金剛仔提到喺海崖頂睇到北面遠處有強光閃爌，強光嚟自一條貫穿岩壁嘅狹窄縫隙。' }
    ]
  },
  {
    search: 'intro/s3-search.jpg', found: 'intro/s3-found.mp4', foundPoster: 'intro/s3-found-poster.jpg',
    searchAlt: '尋找小螢　出發吧～認識海岸地貌', foundAlt: '已找到莫博士、金剛仔同小螢',
    character: '小螢', hintWhere: '島的東北邊', hint: '一條貫穿岩壁嘅狹窄縫隙',
    bridge: [
      { src: 'intro/s3-bridge-1.jpg', alt: '莫博士再次使用「真相放大」搜尋最後一位隊員——斑班長' },
      { src: 'intro/s3-bridge-2.jpg', alt: '但今次連儀器都失效、畫面一片漆黑！究竟斑班長遇到咩危險呢？金剛仔：「但今次咩都睇唔到！唔通佢……去咖賣咸鴨蛋？」' }
    ]
  },
  {
    search: 'intro/s4-search.jpg', found: 'intro/s4-found.mp4', foundPoster: 'intro/s4-found-poster.jpg',
    searchAlt: '尋找斑班長　出發吧～認識海岸地貌', foundAlt: '已找到莫博士、金剛仔、小螢同斑班長',
    character: '斑班長', hintWhere: '島的東南邊', hint: '海面上嘅獨立岩柱',
    bridge: []
  }
];
let introStep = 0;
let introPhase = 'story';
let bridgeStep = 0;
let endingActive = false;
let introTransitioning = false;
let introTransitionTimer = null;
const INTRO_FADE_MS = 480;

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function pulseIntroButton(id) {
  const node = byId(id);
  if (!node || prefersReducedMotion()) return;
  node.classList.remove('feedback-pulse');
  // Restart the luminous surface ripple, without changing the artwork itself.
  void node.offsetWidth;
  node.classList.add('feedback-pulse');
  setTimeout(() => node.classList.remove('feedback-pulse'), 240);
}

function transitionIntroScene(change) {
  if (introTransitioning) return false;
  const veil = byId('scene-fade');
  const snapshot = byId('scene-fade-art');
  const intro = byId('intro');
  if (prefersReducedMotion() || !veil || !snapshot) {
    change();
    return true;
  }
  introTransitioning = true;
  if (intro) intro.setAttribute('aria-busy', 'true');
  const wasIntro = introVisible();
  if (wasIntro) snapshot.src = byId('intro-art').src;
  snapshot.hidden = !wasIntro;
  veil.classList.remove('is-fading');
  veil.hidden = false;
  void veil.offsetWidth;
  change();
  veil.classList.add('is-fading');
  // Release on the actual last animation frame, not a timer that can run
  // before CSS starts painting. Keep a short fallback for interrupted animations.
  const complete = event => {
    if (event && (event.target !== veil || event.animationName !== 'scene-crossfade')) return;
    veil.removeEventListener('animationend', complete);
    if (introTransitionTimer !== null) clearTimeout(introTransitionTimer);
    veil.hidden = true;
    veil.classList.remove('is-fading');
    introTransitioning = false;
    introTransitionTimer = null;
    if (intro) intro.setAttribute('aria-busy', 'false');
  };
  veil.addEventListener('animationend', complete);
  introTransitionTimer = setTimeout(() => complete(), INTRO_FADE_MS + 80);
  return true;
}

function introVisible() {
  const node = byId('intro');
  return !!(node && !node.hidden);
}

function setIntroStatus(message) {
  const status = byId('intro-status');
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.textContent = '';
    status.hidden = true;
  }
}

function showIntro(step) {
  const node = byId('intro');
  const art = byId('intro-art');
  if (!node || !art) return;
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  introPhase = 'story';
  introStep = step;
  window.__introPendingStart = false;
  const page = INTRO_PAGES[step];
  art.src = page.src + '?v=' + GAME_BUILD;
  art.alt = page.alt;
  node.hidden = false;
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('intro-start')) byId('intro-start').hidden = step !== 0;
  if (byId('intro-next')) byId('intro-next').hidden = step === 0;
  // Back exists on story pages 3–6 only (steps 2–5); hidden on page 2 (step 1).
  if (byId('intro-back')) byId('intro-back').hidden = step < 2;
  if (byId('intro-go')) byId('intro-go').hidden = true;
  setIntroStatus('');
}

function showSearchPage(index) {
  const node = byId('intro');
  const art = byId('intro-art');
  const section = SECTIONS[index];
  if (!node || !art || !section) return;
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  introPhase = 'search';
  window.__introPendingStart = false;
  art.src = section.search + '?v=' + GAME_BUILD;
  art.alt = section.searchAlt;
  node.hidden = false;
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('intro-start')) byId('intro-start').hidden = true;
  if (byId('intro-next')) byId('intro-next').hidden = true;
  if (byId('intro-back')) byId('intro-back').hidden = true;
  if (byId('intro-go')) {
    byId('intro-go').hidden = false;
    byId('intro-go').setAttribute('aria-label', "LET'S GO，開始尋找" + section.character);
  }
  setIntroStatus('');
  if (index >= LAST_ROUTE_INDEX) preloadEnding();
}

function showFoundPage(index) {
  const node = byId('intro');
  const art = byId('intro-art');
  const section = SECTIONS[index];
  if (!node || !art || !section) return;
  if (typeof fadeBgmOut === 'function') fadeBgmOut(400);
  if (typeof startTheme === 'function') startTheme({ fromStart: true, fadeMs: 400 });
  introPhase = 'found';
  window.__introPendingStart = false;
  const poster = section.foundPoster || section.found;
  art.src = poster + '?v=' + GAME_BUILD;
  art.alt = section.foundAlt;
  node.classList.add('is-found');
  node.hidden = false;
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('intro-start')) byId('intro-start').hidden = true;
  if (byId('intro-go')) byId('intro-go').hidden = true;
  if (byId('intro-back')) byId('intro-back').hidden = true;
  if (byId('intro-next')) {
    byId('intro-next').hidden = false;
    byId('intro-next').setAttribute('aria-label', index >= LAST_ROUTE_INDEX ? '播放結尾片' : '下一頁');
  }
  setIntroStatus('');
  if (typeof playFoundFilm === 'function') playFoundFilm(section);
  if (index >= LAST_ROUTE_INDEX) preloadEnding();
}

function foundFilmSrc(section) {
  if (!section) return '';
  return (section.found || '') + (section.found.indexOf('?') >= 0 ? '' : '?v=' + GAME_BUILD);
}

function playFoundFilm(section) {
  const video = byId('intro-found');
  if (!video || !section || !section.found || !/\.mp4(?:$|\?)/.test(section.found)) return;
  // Silent found clips must never steal or duck the theme already playing here.
  video.muted = true;
  video.defaultMuted = true;
  video.loop = false;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  if (typeof setMediaVolume === 'function') setMediaVolume(video, 0);
  else video.volume = 0;
  const poster = section.foundPoster ? section.foundPoster + '?v=' + GAME_BUILD : '';
  if (poster) video.poster = poster;
  const src = foundFilmSrc(section);
  if (video.getAttribute('src') !== src && video.src !== src) {
    video.src = src;
    try { if (typeof video.load === 'function') video.load(); } catch (error) {}
  }
  video.hidden = false;
  try { video.currentTime = 0; } catch (error) {}
  tryPlayMedia(video);
}

function onFoundFilmEnded() {
  const video = byId('intro-found');
  if (!video || introPhase !== 'found') return;
  try { if (typeof video.pause === 'function') video.pause(); } catch (error) {}
  // Leave currentTime at the end so the last frame stays on screen.
}

function stopFoundFilm() {
  const node = byId('intro');
  if (node) node.classList.remove('is-found');
  const video = byId('intro-found');
  if (!video) return;
  try { if (typeof video.pause === 'function') video.pause(); } catch (error) {}
  try { video.currentTime = 0; } catch (error) {}
  video.hidden = true;
}

function bindFoundFilm() {
  const video = byId('intro-found');
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = false;
  if (typeof setMediaVolume === 'function') setMediaVolume(video, 0);
  video.addEventListener('ended', onFoundFilmEnded);
  video.addEventListener('click', event => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (introPhase === 'found' && !introTransitioning) introNext();
  });
}

function showBridgePage(sectionIndex, pageIndex) {
  const node = byId('intro');
  const art = byId('intro-art');
  const section = SECTIONS[sectionIndex];
  const pages = section && section.bridge ? section.bridge : [];
  const page = pages[pageIndex];
  if (!node || !art || !page) return;
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  introPhase = 'bridge';
  bridgeStep = pageIndex;
  window.__introPendingStart = false;
  art.src = page.src + '?v=' + GAME_BUILD;
  art.alt = page.alt;
  node.hidden = false;
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('ending')) byId('ending').hidden = true;
  if (byId('intro-start')) byId('intro-start').hidden = true;
  if (byId('intro-go')) byId('intro-go').hidden = true;
  if (byId('intro-back')) byId('intro-back').hidden = false;
  if (byId('intro-next')) {
    byId('intro-next').hidden = false;
    byId('intro-next').setAttribute('aria-label', '下一頁');
  }
  setIntroStatus('');
}

function isCoarsePointer() {
  try { return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }
  catch (error) { return (navigator.maxTouchPoints || 0) > 0; }
}

function startIntroStory() {
  if (introTransitioning) return;
  if (typeof hideMenu === 'function') hideMenu();
  if (typeof markIntroStorySeen === 'function') markIntroStorySeen();
  if (!introVisible() || introPhase !== 'story' || introStep !== 0) {
    if (typeof showIntro === 'function') showIntro(0);
  }
  pulseIntroButton('intro-start');
  // Fullscreen remains synchronous in the original click/keyboard user gesture.
  if (isCoarsePointer() && typeof window.__enterFullscreen === 'function') {
    window.__enterFullscreen();
  }
  // Warm video/audio in this gesture so later unmuted playback is more likely to be allowed.
  if (typeof preloadLiftoffMedia === 'function') preloadLiftoffMedia();
  if (typeof startTheme === 'function') {
    const theme = byId('theme');
    if (!theme || theme.paused) startTheme({ fromStart: true, fadeMs: 400 });
  }
  transitionIntroScene(() => showIntro(1));
}

function showInitFailureOverlay() {
  if (byId('intro')) byId('intro').hidden = true;
  if (byId('overlay')) byId('overlay').hidden = false;
  if (byId('startup-status')) byId('startup-status').hidden = false;
  if (byId('startup-retry')) byId('startup-retry').hidden = false;
  if (byId('start-help')) byId('start-help').hidden = true;
  if (byId('explore')) byId('explore').hidden = true;
  if (byId('title-home')) byId('title-home').hidden = false;
  if (byId('title')) byId('title').textContent = '未能開始飛行';
  setIntroStatus('');
}


const LIFTOFF_FADE_S = 1;
const BGM_VOLUME = 0.55;
const MUTE_STORAGE_KEY = 'cheungChauHeliMute';
let liftoffActive = false;
let liftoffFading = false;
let liftoffTimer = null;
let liftoffNeedsGesture = false;
let bgmWanted = false;
let bgmFadeTimer = null;

function readMutedPreference() {
  try { return !!(window.localStorage && window.localStorage.getItem(MUTE_STORAGE_KEY) === '1'); }
  catch (error) { return false; }
}

function writeMutedPreference(muted) {
  try { if (window.localStorage) window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0'); }
  catch (error) {}
}

function isMuted() {
  const btn = byId('mute');
  if (btn && btn.getAttribute('aria-pressed') === 'true') return true;
  const bgm = byId('bgm');
  if (bgm && bgm.muted) return true;
  return readMutedPreference();
}

function syncMuteButton() {
  const btn = byId('mute');
  if (!btn) return;
  const muted = isMuted();
  if (btn.classList && typeof btn.classList.toggle === 'function') btn.classList.toggle('is-muted', muted);
  else if (btn.classList && muted && typeof btn.classList.add === 'function') btn.classList.add('is-muted');
  else if (btn.classList && !muted && typeof btn.classList.remove === 'function') btn.classList.remove('is-muted');
  btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  btn.setAttribute('aria-label', muted ? '開啟聲音' : '靜音');
  btn.title = muted ? '開啟聲音' : '靜音';
}

function applyMute(muted, persist) {
  const bgm = byId('bgm');
  const theme = byId('theme');
  const video = byId('liftoff-video');
  const found = byId('intro-found');
  if (bgm) bgm.muted = !!muted;
  if (theme) theme.muted = !!muted;
  if (video) video.muted = !!muted;
  if (found) {
    found.muted = true;
    found.defaultMuted = true;
    if (typeof setMediaVolume === 'function') setMediaVolume(found, 0);
  }
  const btn = byId('mute');
  if (btn) btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  if (persist) writeMutedPreference(!!muted);
  syncMuteButton();
}

function toggleMute() {
  applyMute(!isMuted(), true);
}

function cancelBgmFade() {
  if (bgmFadeTimer !== null) {
    clearTimeout(bgmFadeTimer);
    bgmFadeTimer = null;
  }
}


function clampMediaVolume(value) {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function setMediaVolume(media, value) {
  if (!media) return 0;
  const volume = clampMediaVolume(value);
  try { media.volume = volume; }
  catch (error) {
    // Last resort if a browser rejects a clamped value; never leave an uncaught IndexSizeError.
    try { media.volume = volume > 0.5 ? 1 : 0; } catch (ignored) {}
  }
  return volume;
}

function fadeMediaVolume(media, to, ms, done) {
  if (!media) { if (done) done(); return; }
  const from = clampMediaVolume(media.volume);
  const target = clampMediaVolume(to);
  const duration = Number(ms);
  if (prefersReducedMotion() || !isFinite(duration) || duration <= 0 || Math.abs(from - target) < 0.01) {
    setMediaVolume(media, target);
    if (done) done();
    return;
  }
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const tick = now => {
    const clock = isFinite(Number(now)) ? Number(now) : Date.now();
    const t = Math.max(0, Math.min(1, (clock - start) / duration));
    setMediaVolume(media, from + (target - from) * t);
    if (t < 1) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
      else bgmFadeTimer = setTimeout(() => tick(Date.now()), 16);
    } else if (done) done();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
  else bgmFadeTimer = setTimeout(() => tick(Date.now()), 16);
}

function tryPlayMedia(media) {
  if (!media || typeof media.play !== 'function') return null;
  try { return media.play(); }
  catch (error) { return null; }
}

function pauseBgm(reset) {
  cancelBgmFade();
  bgmWanted = false;
  const bgm = byId('bgm');
  if (!bgm) return;
  try { if (typeof bgm.pause === 'function') bgm.pause(); } catch (error) {}
  if (reset) {
    try { bgm.currentTime = 0; } catch (error) {}
    setMediaVolume(bgm, 0);
  }
}

function startBgm(fadeMs) {
  const bgm = byId('bgm');
  if (!bgm) return;
  bgmWanted = true;
  if (typeof document !== "undefined" && document.hidden) return;
  applyMute(isMuted(), false);
  if (bgm.volume == null || bgm.volume > BGM_VOLUME && !fadeMs) setMediaVolume(bgm, BGM_VOLUME);
  if (!fadeMs) setMediaVolume(bgm, isMuted() ? 0 : BGM_VOLUME);
  const result = tryPlayMedia(bgm);
  const fade = () => {
    if (!bgmWanted) return;
    fadeMediaVolume(bgm, isMuted() ? 0 : BGM_VOLUME, fadeMs || 0);
  };
  if (result && typeof result.then === 'function') result.then(fade, () => {});
  else fade();
}


const THEME_VOLUME = 0.70;
let themeWanted = false;
let themeAutoplayBlocked = false;
let themeUnlockBound = false;
let themeVisibilityRetried = false;
let themeUnlockHandler = null;

function openingThemeShouldPlay() {
  if (!themeWanted) return false;
  if (liftoffActive || (run && (run.mode === 'liftoff' || run.mode === 'flying'))) return false;
  return true;
}

function unbindThemeGestureUnlock() {
  if (!themeUnlockBound || !themeUnlockHandler) return;
  if (typeof document !== 'undefined' && document.removeEventListener) {
    for (const type of themeUnlockHandler.events) {
      document.removeEventListener(type, themeUnlockHandler.unlock, true);
    }
  }
  themeUnlockBound = false;
  themeUnlockHandler = null;
}

function bindThemeGestureUnlock() {
  if (themeUnlockBound) return;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const events = ['pointerdown', 'keydown', 'touchstart', 'click'];
  const unlock = () => {
    if (!openingThemeShouldPlay()) {
      if (themeWanted === false) unbindThemeGestureUnlock();
      return;
    }
    startTheme({ fromStart: false, fadeMs: 0 });
  };
  themeUnlockHandler = { events: events, unlock: unlock };
  themeUnlockBound = true;
  for (const type of events) document.addEventListener(type, unlock, true);
}

function attemptOpeningTheme() {
  themeWanted = true;
  startTheme({ fromStart: true, fadeMs: 0 });
}

function startTheme(options) {
  const opts = options || {};
  const theme = byId('theme');
  if (!theme) return;
  themeWanted = true;
  if (typeof document !== "undefined" && document.hidden) return;
  applyMute(isMuted(), false);
  theme.loop = true;
  if (opts.fromStart) {
    try { theme.currentTime = 0; } catch (error) {}
  }
  if (!opts.fadeMs) setMediaVolume(theme, isMuted() ? 0 : THEME_VOLUME);
  else if (theme.paused) setMediaVolume(theme, 0);
  const result = tryPlayMedia(theme);
  const fade = () => {
    if (!themeWanted) return;
    fadeMediaVolume(theme, isMuted() ? 0 : THEME_VOLUME, opts.fadeMs || 0);
  };
  if (result && typeof result.then === 'function') {
    result.then(() => {
      themeAutoplayBlocked = false;
      unbindThemeGestureUnlock();
      fade();
    }, () => {
      themeAutoplayBlocked = true;
      bindThemeGestureUnlock();
    });
  } else if (theme.paused) {
    themeAutoplayBlocked = true;
    bindThemeGestureUnlock();
  } else fade();
}

function pauseTheme(reset) {
  themeWanted = false;
  unbindThemeGestureUnlock();
  const theme = byId('theme');
  if (!theme) return;
  try { if (typeof theme.pause === 'function') theme.pause(); } catch (error) {}
  if (reset) {
    try { theme.currentTime = 0; } catch (error) {}
    setMediaVolume(theme, 0);
  }
}

function fadeThemeOut(ms, reset) {
  themeWanted = false;
  const theme = byId('theme');
  if (!theme) return;
  fadeMediaVolume(theme, 0, ms || 0, () => {
    if (themeWanted) return;
    try { if (typeof theme.pause === 'function') theme.pause(); } catch (error) {}
    if (reset !== false) {
      try { theme.currentTime = 0; } catch (error) {}
      setMediaVolume(theme, 0);
    }
  });
}

function fadeBgmOut(ms) {
  cancelBgmFade();
  bgmWanted = false;
  const bgm = byId('bgm');
  if (!bgm) return;
  fadeMediaVolume(bgm, 0, ms || 0, () => {
    if (bgmWanted) return;
    try { if (typeof bgm.pause === 'function') bgm.pause(); } catch (error) {}
  });
}

function preloadLiftoffMedia() {
  const video = byId('liftoff-video');
  if (video) {
    if (!video.getAttribute('src') && !video.src) video.src = 'media/intro.mp4?v=' + GAME_BUILD;
    video.preload = 'auto';
    try { if (typeof video.load === 'function') video.load(); } catch (error) {}
  }
  const bgm = byId('bgm');
  if (bgm) {
    if (!bgm.getAttribute('src') && !bgm.src) bgm.src = 'media/bgm.mp3?v=' + GAME_BUILD;
    bgm.loop = true;
    bgm.preload = 'auto';
    try { if (typeof bgm.load === 'function') bgm.load(); } catch (error) {}
  }
  const theme = byId('theme');
  if (theme) {
    if (!theme.getAttribute('src') && !theme.src) theme.src = 'media/theme.mp3?v=' + GAME_BUILD;
    theme.loop = true;
    theme.preload = 'auto';
    try { if (typeof theme.load === 'function') theme.load(); } catch (error) {}
  }
}

function liftoffVisible() {
  if (!liftoffActive) return false;
  const node = byId('liftoff');
  return !!(node && !node.hidden);
}

function clearLiftoffTimer() {
  if (liftoffTimer !== null) {
    clearTimeout(liftoffTimer);
    liftoffTimer = null;
  }
}

function completeLiftoff() {
  clearLiftoffTimer();
  liftoffActive = false;
  liftoffFading = false;
  liftoffNeedsGesture = false;
  const video = byId('liftoff-video');
  if (video) {
    try { if (typeof video.pause === 'function') video.pause(); } catch (error) {}
    try { video.currentTime = 0; } catch (error) {}
    setMediaVolume(video, 1);
  }
  const node = byId('liftoff');
  if (node) {
    node.hidden = true;
    node.classList.remove('is-fading');
  }
  if (run && (run.mode === 'liftoff' || run.mode === 'flying')) run.mode = 'flying';
  if (bgmWanted || (run && run.mode === 'flying')) startBgm(0);
}

function startLiftoffDissolve() {
  if (!liftoffActive || liftoffFading) return;
  liftoffFading = true;
  const node = byId('liftoff');
  const video = byId('liftoff-video');
  if (node) node.classList.add('is-fading');
  if (video) fadeMediaVolume(video, 0, LIFTOFF_FADE_S * 1000);
  bgmWanted = true;
  const bgm = byId('bgm');
  if (bgm && !isMuted()) {
    if (bgm.volume == null) setMediaVolume(bgm, 0);
    startBgm(LIFTOFF_FADE_S * 1000);
  } else if (bgm) {
    setMediaVolume(bgm, 0);
    tryPlayMedia(bgm);
  }
  const ms = prefersReducedMotion() ? 0 : LIFTOFF_FADE_S * 1000 + 80;
  clearLiftoffTimer();
  liftoffTimer = setTimeout(() => completeLiftoff(), ms);
}

function stopLiftoff(options) {
  const immediate = !options || options.immediate !== false;
  clearLiftoffTimer();
  const video = byId('liftoff-video');
  if (immediate || !liftoffActive) {
    liftoffActive = false;
    liftoffFading = false;
    liftoffNeedsGesture = false;
    if (video) {
      try { if (typeof video.pause === 'function') video.pause(); } catch (error) {}
      try { video.currentTime = 0; } catch (error) {}
      setMediaVolume(video, 1);
    }
    const node = byId('liftoff');
    if (node) {
      node.hidden = true;
      node.classList.remove('is-fading');
    }
    return;
  }
  startLiftoffDissolve();
}

function skipLiftoff(force) {
  if (!liftoffActive) return;
  const video = byId('liftoff-video');
  if (!force && liftoffNeedsGesture && video && video.paused && !(video.currentTime > 0.2)) {
    liftoffNeedsGesture = false;
    try { video.currentTime = 0; } catch (error) {}
    const played = tryPlayMedia(video);
    if (played && typeof played.then === 'function') {
      played.then(() => { liftoffNeedsGesture = false; }, () => { liftoffNeedsGesture = true; });
    }
    return;
  }
  startLiftoffDissolve();
}

function onLiftoffTimeUpdate() {
  if (!liftoffActive || liftoffFading) return;
  const video = byId('liftoff-video');
  if (!video) return;
  const duration = video.duration > 0 ? video.duration : 6.04;
  if (video.currentTime >= duration - LIFTOFF_FADE_S) startLiftoffDissolve();
}

function onLiftoffEnded() {
  if (!liftoffActive) return;
  startLiftoffDissolve();
}

function shouldPlayTakeoffFilm() {
  // Every mission title page (sections 1–4) plays the lift-off film before 3D flight.
  return !!(run && !run.explore);
}

function isMissionOneTakeoff() {
  return shouldPlayTakeoffFilm();
}

// Start unmuted playback in the LET'S GO gesture so autoplay policy allows sound.
// Reduced-motion users still get the full clip; only the end dissolve may be shortened.
function startLiftoffFromGesture() {
  const video = byId('liftoff-video');
  if (!video) return false;
  preloadLiftoffMedia();
  applyMute(isMuted(), false);
  try { video.currentTime = 0; } catch (error) {}
  setMediaVolume(video, isMuted() ? 0 : 1);
  const played = tryPlayMedia(video);
  const bgm = byId('bgm');
  if (bgm) {
    bgm.loop = true;
    setMediaVolume(bgm, 0);
    applyMute(isMuted(), false);
    tryPlayMedia(bgm);
  }
  if (played && typeof played.then === 'function') {
    played.then(() => { liftoffNeedsGesture = false; }, () => { liftoffNeedsGesture = true; });
  } else if (video.paused) {
    liftoffNeedsGesture = true;
  }
  return true;
}

function revealLiftoffOverlay() {
  const node = byId('liftoff');
  const video = byId('liftoff-video');
  if (!node || !video) {
    bgmWanted = true;
    startBgm(400);
    return;
  }
  liftoffActive = true;
  liftoffFading = false;
  node.classList.remove('is-fading');
  node.hidden = false;
  if (run) run.mode = 'liftoff';
  if (video.paused) {
    const played = tryPlayMedia(video);
    if (played && typeof played.then === 'function') {
      played.then(() => {}, () => { liftoffNeedsGesture = true; });
    }
  }
}

function bindLiftoffAndBgm() {
  preloadLiftoffMedia();
  applyMute(readMutedPreference(), false);
  const video = byId('liftoff-video');
  if (video) {
    video.loop = false;
    video.addEventListener('timeupdate', onLiftoffTimeUpdate);
    video.addEventListener('ended', onLiftoffEnded);
  }
  const overlay = byId('liftoff');
  if (overlay) overlay.addEventListener('click', skipLiftoff);
  const mute = byId('mute');
  if (mute) mute.addEventListener('click', toggleMute);
  const bgm = byId('bgm');
  if (bgm) bgm.loop = true;
  const theme = byId('theme');
  if (theme) theme.loop = true;
}

function suspendGameAudio() {
  const video = byId('liftoff-video');
  if (video && liftoffActive && typeof video.pause === 'function') {
    try { video.pause(); } catch (error) {}
  }
  const bgm = byId('bgm');
  if (bgm && typeof bgm.pause === 'function') {
    try { bgm.pause(); } catch (error) {}
  }
  const theme = byId('theme');
  if (theme && typeof theme.pause === 'function') {
    try { theme.pause(); } catch (error) {}
  }
}

function resumeGameAudio() {
  if (typeof document !== "undefined" && document.hidden) return;
  if (liftoffActive) {
    const video = byId('liftoff-video');
    if (video && video.paused) tryPlayMedia(video);
  }
  if (bgmWanted) startBgm(200);
  if (themeWanted) {
    // If unmuted autoplay was blocked, retry once when the tab is visible again.
    if (themeAutoplayBlocked && themeVisibilityRetried) return;
    if (themeAutoplayBlocked) themeVisibilityRetried = true;
    startTheme({ fadeMs: 200 });
  }
}

function startOrResumeSection() {
  if (introTransitioning || (introVisible() && introPhase !== 'search')) return;
  if (liftoffActive || (run && (run.mode === 'liftoff' || run.mode === 'flying'))) return;
  if (start.textContent === '未能開始飛行') {
    window.__introPendingStart = false;
    showInitFailureOverlay();
    return;
  }
  if (start.dataset.unlocked === '1') {
    window.__introPendingStart = false;
    pulseIntroButton('intro-go');
    // First takeoff uses startFlight (also what the intro fixture mocks) and
    // starts the lift-off film in this user gesture so unmuted play() is allowed.
    // Later sections still use beginSectionFlight and keep the shared clock, but
    // they now respawn at the mission-1 start so later checkpoints are not reached immediately.
    const playFilm = typeof shouldPlayTakeoffFilm === 'function' ? shouldPlayTakeoffFilm() : !run.explore;
    if (typeof fadeThemeOut === 'function') fadeThemeOut(500, true);
    if (playFilm && typeof startLiftoffFromGesture === 'function') startLiftoffFromGesture();
    const begin = () => {
      if (run.sessionStarted && typeof beginSectionFlight === 'function') beginSectionFlight();
      else startFlight(false);
      if (playFilm && typeof revealLiftoffOverlay === 'function') revealLiftoffOverlay();
      else if (typeof startBgm === 'function') startBgm(400);
    };
    // Show the film immediately so the 480 ms search-page veil does not hide the first moments.
    if (playFilm) begin();
    else transitionIntroScene(begin);
    return;
  }
  window.__introPendingStart = true;
  setIntroStatus('載入中…');
}

function introNext() {
  if (introTransitioning || !introVisible()) return;
  if (introPhase === 'found') {
    pulseIntroButton('intro-next');
    advanceFromFound();
    return;
  }
  if (introPhase === 'bridge') {
    pulseIntroButton('intro-next');
    const pages = (SECTIONS[run.next] && SECTIONS[run.next].bridge) || [];
    if (bridgeStep < pages.length - 1) {
      transitionIntroScene(() => showBridgePage(run.next, bridgeStep + 1));
      return;
    }
    const next = run.next + 1;
    transitionIntroScene(() => {
      run.next = next;
      run.mode = 'section';
      showSearchPage(next);
    });
    return;
  }
  if (introPhase !== 'story' || introStep === 0) return;
  pulseIntroButton('intro-next');
  if (introStep < INTRO_PAGES.length - 1) transitionIntroScene(() => showIntro(introStep + 1));
  else transitionIntroScene(() => showSearchPage(0));
}

function introBack() {
  if (introTransitioning || !introVisible()) return;
  if (introPhase === 'bridge') {
    pulseIntroButton('intro-back');
    if (bridgeStep > 0) transitionIntroScene(() => showBridgePage(run.next, bridgeStep - 1));
    else transitionIntroScene(() => showFoundPage(run.next));
    return;
  }
  // No wrap past story page 2 (step 1). Back is not drawn on section or found pages.
  if (introPhase !== 'story' || introStep <= 1) return;
  pulseIntroButton('intro-back');
  transitionIntroScene(() => showIntro(introStep - 1));
}

function handleIntroKey(event) {
  if (typeof handleMenuKey === 'function' && handleMenuKey(event)) return true;
  if (typeof handleQuizKey === 'function' && handleQuizKey(event)) return true;
  if (typeof liftoffVisible === 'function' && liftoffVisible()) {
    if (event.repeat) { event.preventDefault(); return true; }
    if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      skipLiftoff(true);
    }
    return true;
  }
  if (endingVisible()) {
    if (event.repeat) { event.preventDefault(); return true; }
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight') {
      event.preventDefault();
      skipEnding();
    }
    return true;
  }
  if (!introVisible()) return false;
  if (event.repeat || introTransitioning) { event.preventDefault(); return true; }
  if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
  }
  if (introPhase === 'search') {
    if (event.code === 'Enter' || event.code === 'Space') startOrResumeSection();
    return true;
  }
  if (introPhase === 'found') {
    if (event.code === 'Enter' || event.code === 'ArrowRight') introNext();
    return true;
  }
  if (introPhase === 'bridge') {
    if (event.code === 'Enter' || event.code === 'ArrowRight') introNext();
    if (event.code === 'ArrowLeft') introBack();
    return true;
  }
  if (introStep === 0 && (event.code === 'Enter' || event.code === 'Space')) {
    if (typeof openTitleMenu === 'function') openTitleMenu();
    else startIntroStory();
    return true;
  }
  if (introStep > 0 && (event.code === 'Enter' || event.code === 'ArrowRight')) {
    introNext();
    return true;
  }
  if (event.code === 'ArrowLeft') {
    introBack();
    return true;
  }
  return introVisible();
}

function bindIntroStory() {
  INTRO_PAGES.forEach(page => {
    const image = new Image();
    image.src = page.src + '?v=' + GAME_BUILD;
  });
  SECTIONS.forEach(section => {
    [section.search, section.foundPoster].forEach(src => {
      if (!src) return;
      const image = new Image();
      image.src = src + '?v=' + GAME_BUILD;
    });
    if (section.found && /\.mp4(?:$|\?)/.test(section.found) && typeof document !== 'undefined' && document.createElement) {
      const warm = document.createElement('video');
      warm.muted = true;
      warm.preload = 'auto';
      warm.src = section.found + '?v=' + GAME_BUILD;
    }
    (section.bridge || []).forEach(page => {
      const image = new Image();
      image.src = page.src + '?v=' + GAME_BUILD;
    });
  });
  const startBtn = byId('intro-start');
  const nextBtn = byId('intro-next');
  const backBtn = byId('intro-back');
  const goBtn = byId('intro-go');
  if (startBtn) startBtn.addEventListener('click', typeof openTitleMenu === 'function' ? openTitleMenu : startIntroStory);
  if (nextBtn) nextBtn.addEventListener('click', introNext);
  if (backBtn) backBtn.addEventListener('click', introBack);
  if (goBtn) goBtn.addEventListener('click', startOrResumeSection);
  [startBtn, nextBtn, backBtn, goBtn].forEach(node => {
    if (node) node.addEventListener('pointerdown', () => {
      if (!introTransitioning) pulseIntroButton(node.id);
    });
  });
  bindEnding();
  if (typeof bindFoundFilm === 'function') bindFoundFilm();
  if (typeof bindLiftoffAndBgm === 'function') bindLiftoffAndBgm();
  if (typeof bindBalloonQuiz === 'function') bindBalloonQuiz();
  if (typeof bindMenu === 'function') bindMenu();
  showIntro(0);
  if (typeof attemptOpeningTheme === 'function') attemptOpeningTheme();
}

function advanceFromFound() {
  if (introTransitioning || introPhase !== 'found') return;
  if (run.next >= LAST_ROUTE_INDEX) {
    startEndingFromFound();
    return;
  }
  const pages = (SECTIONS[run.next] && SECTIONS[run.next].bridge) || [];
  if (pages.length) {
    transitionIntroScene(() => showBridgePage(run.next, 0));
    return;
  }
  const next = run.next + 1;
  transitionIntroScene(() => {
    run.next = next;
    run.mode = 'section';
    showSearchPage(next);
  });
}

function endingVisible() {
  const node = byId('ending');
  return !!(node && !node.hidden);
}

function preloadEnding() {
  const video = byId('ending-video');
  if (!video) return;
  if (!video.getAttribute('src') && !video.src) video.src = 'media/ending.mp4?v=' + GAME_BUILD;
  video.preload = 'auto';
  try { if (typeof video.load === 'function') video.load(); } catch (error) {}
}

function updateEndingProgress() {
  const video = byId('ending-video');
  const bar = byId('ending-progress') && byId('ending-progress').firstElementChild;
  if (!video || !bar || !video.duration) return;
  bar.style.width = Math.max(0, Math.min(100, (video.currentTime / video.duration) * 100)) + '%';
}

function stopEnding() {
  endingActive = false;
  const video = byId('ending-video');
  if (video) {
    try { if (typeof video.pause === 'function') video.pause(); } catch (error) {}
    try { video.currentTime = 0; } catch (error) {}
  }
  if (byId('ending')) byId('ending').hidden = true;
  if (byId('ending-play')) byId('ending-play').hidden = true;
  const bar = byId('ending-progress') && byId('ending-progress').firstElementChild;
  if (bar) bar.style.width = '0%';
}

function completeEnding() {
  if (!endingActive) return;
  endingActive = false;
  stopEnding();
  if (typeof finish === 'function') finish(true);
}

function skipEnding() {
  completeEnding();
}

function tryPlayEnding(fromGesture) {
  const video = byId('ending-video');
  const playBtn = byId('ending-play');
  if (!video || typeof video.play !== 'function') {
    if (playBtn) playBtn.hidden = false;
    return;
  }
  const result = video.play();
  const failed = () => { if (playBtn) playBtn.hidden = false; };
  if (result && typeof result.then === 'function') result.then(() => {
    if (playBtn) playBtn.hidden = true;
  }, failed);
  else if (video.paused) failed();
}

function showEndingOverlay() {
  endingActive = true;
  run.mode = 'ending';
  clearFlightInput();
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  if (byId('intro')) byId('intro').hidden = true;
  if (byId('overlay')) byId('overlay').hidden = true;
  const node = byId('ending');
  if (node) node.hidden = false;
}

function startEndingFromFound() {
  if (introPhase !== 'found') return;
  preloadEnding();
  endingActive = true;
  if (typeof pauseBgm === 'function') pauseBgm(false);
  if (typeof fadeThemeOut === 'function') fadeThemeOut(400, true);
  // Start playback in this user-gesture turn, before the 480 ms visual cut.
  // Waiting for transitionIntroScene would cause browsers to block unmuted play().
  tryPlayEnding(true);
  const reveal = () => showEndingOverlay();
  if (typeof transitionIntroScene === 'function') {
    const started = transitionIntroScene(reveal);
    if (!started) reveal();
  } else reveal();
}

function bindEnding() {
  const video = byId('ending-video');
  const skip = byId('ending-skip');
  const playBtn = byId('ending-play');
  if (skip) skip.addEventListener('click', skipEnding);
  if (playBtn) playBtn.addEventListener('click', () => tryPlayEnding(true));
  if (video) {
    video.addEventListener('ended', completeEnding);
    video.addEventListener('timeupdate', updateEndingProgress);
    video.loop = false;
  }
}



const SAVE_STORAGE_KEY = 'cheung-chau-heli-saves-v1';
const STORY_SEEN_KEY = 'cheung-chau-heli-seen-story';
const SAVE_SLOTS = 3;
let menuSnapshot = null;
let menuSlotAction = null;
let menuConfirmKind = null;
let menuPendingSlot = -1;
let lastSaveSlot = 0;
let autosaveTimer = null;

function menuVisible() {
  const node = byId('menu');
  return !!(node && !node.hidden);
}

function hideMenuConfirm() {
  const node = byId('menu-confirm');
  if (node) node.hidden = true;
  menuConfirmKind = null;
  menuPendingSlot = -1;
}

function hideMenu() {
  hideMenuConfirm();
  menuSlotAction = null;
  setMenuStatus('');
  const node = byId('menu');
  if (node) node.hidden = true;
}

function setMenuStatus(message, kind) {
  const node = byId('menu-status');
  if (!node) return;
  if (!message) {
    node.hidden = true;
    node.textContent = '';
    if (node.classList && typeof node.classList.remove === 'function') {
      node.classList.remove('is-ok', 'is-warn');
    }
    return;
  }
  node.hidden = false;
  node.textContent = message;
  if (node.classList && typeof node.classList.remove === 'function') {
    node.classList.remove('is-ok', 'is-warn');
    if (kind && typeof node.classList.add === 'function') node.classList.add(kind === 'ok' ? 'is-ok' : 'is-warn');
  }
}

function hasSeenIntroStory() {
  try { return !!(window.localStorage && window.localStorage.getItem(STORY_SEEN_KEY) === '1'); }
  catch (error) { return false; }
}

function markIntroStorySeen() {
  try { if (window.localStorage) window.localStorage.setItem(STORY_SEEN_KEY, '1'); }
  catch (error) {}
}

function formatSaveTime(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(ms));
    const get = type => ((parts.find(part => part.type === type) || {}).value || '');
    return get('year') + '-' + get('month') + '-' + get('day') + '  ' + get('hour') + ':' + get('minute');
  } catch (error) {
    const date = new Date(ms);
    const pad = n => (n < 10 ? '0' : '') + n;
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '  ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
}

function readSaveStore() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return { slots: [null, null, null], lastSlot: 0 };
    const data = JSON.parse(raw);
    const slots = Array.isArray(data && data.slots) ? data.slots.slice(0, SAVE_SLOTS) : [];
    while (slots.length < SAVE_SLOTS) slots.push(null);
    return { slots: slots, lastSlot: Math.max(0, Math.min(SAVE_SLOTS - 1, data.lastSlot | 0)) };
  } catch (error) {
    return { slots: [null, null, null], lastSlot: 0 };
  }
}

function writeSaveStore(store) {
  try {
    if (window.localStorage) window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    return false;
  }
}

function sessionInProgress() {
  if (typeof run === 'undefined' || !run) return false;
  if (run.sessionStarted || run.explore) return true;
  if (run.mode && run.mode !== 'ready') return true;
  if (typeof introPhase === 'string' && introPhase !== 'story') return true;
  if (typeof introStep === 'number' && introStep > 0) return true;
  const progress = (typeof chapterProgress !== 'undefined' && chapterProgress) || [];
  return progress.some(row => row && ((row.correct | 0) > 0 || (row.solved && row.solved.length)));
}

function captureSavePayload() {
  const progress = (typeof chapterProgress !== 'undefined' && chapterProgress) || [];
  const deck = (typeof quizDeck !== 'undefined' && quizDeck) || [];
  const pose = (typeof craft === 'object' && craft) ? craft : { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0 };
  const balloonState = (typeof balloon !== 'undefined' && balloon) ? balloon : { visible: false };
  const last = (typeof lastBalloon !== 'undefined' && lastBalloon) ? lastBalloon : null;
  return {
    v: 1,
    savedAt: Date.now(),
    next: run.next,
    time: run.time,
    camera: !!run.camera,
    explore: !!run.explore,
    sessionStarted: !!run.sessionStarted,
    mode: run.mode === 'quiz' ? 'flying' : run.mode,
    introPhase: typeof introPhase === 'string' ? introPhase : 'story',
    introStep: typeof introStep === 'number' ? introStep : 0,
    chapterProgress: progress.map(row => ({
      correct: row && row.correct | 0,
      solved: row && Array.isArray(row.solved) ? row.solved.slice() : []
    })),
    quizDeck: deck.slice(),
    quizChapter: (typeof quizChapter === 'number' ? quizChapter : 0) | 0,
    quizAsked: (typeof quizAsked === 'number' ? quizAsked : 0) | 0,
    quizIntroSeen: typeof quizIntroSeen !== 'undefined' && !!quizIntroSeen,
    craft: {
      x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
      vx: pose.vx, vy: pose.vy, vz: pose.vz
    },
    balloon: balloonState.visible ? { x: balloonState.x, y: balloonState.y, z: balloonState.z, visible: true } : { visible: false },
    lastBalloon: last && typeof last.x === 'number' ? { x: last.x, y: last.y, z: last.z } : null,
    lastSaveSlot: lastSaveSlot
  };
}

function applySavePayload(data) {
  if (!data || data.v !== 1) return false;
  if (typeof closeQuiz === 'function') closeQuiz();
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof stopEnding === 'function') stopEnding();
  const allowed = { ready: 1, flying: 1, section: 1, found: 1, ended: 1, ending: 1 };
  const mode = data.mode === 'quiz' ? 'flying' : (allowed[data.mode] ? data.mode : 'flying');
  const last = typeof LAST_ROUTE_INDEX === 'number' ? LAST_ROUTE_INDEX : 3;
  Object.assign(run, {
    mode: mode,
    next: Math.max(0, Math.min(last, data.next | 0)),
    time: Math.max(0, Number(data.time) || 0),
    camera: !!data.camera,
    explore: !!data.explore,
    sessionStarted: data.sessionStarted !== false
  });
  if (Array.isArray(data.chapterProgress)) {
    chapterProgress = emptyChapterProgress();
    data.chapterProgress.forEach((row, i) => {
      if (!chapterProgress[i] || !row) return;
      chapterProgress[i].correct = Math.max(0, row.correct | 0);
      chapterProgress[i].solved = Array.isArray(row.solved) ? row.solved.map(n => n | 0) : [];
    });
  } else if (typeof emptyChapterProgress === 'function') {
    chapterProgress = emptyChapterProgress();
  }
  quizChapter = data.quizChapter | 0;
  quizAsked = data.quizAsked | 0;
  quizIntroSeen = !!data.quizIntroSeen;
  quizDeck = Array.isArray(data.quizDeck) ? data.quizDeck.map(n => n | 0) : [];
  if (data.craft && typeof craft === 'object') {
    const num = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    craft.x = num(data.craft.x, craft.x);
    craft.y = num(data.craft.y, craft.y);
    craft.z = num(data.craft.z, craft.z);
    craft.yaw = num(data.craft.yaw, 0);
    craft.vx = num(data.craft.vx, 0);
    craft.vy = num(data.craft.vy, 0);
    craft.vz = num(data.craft.vz, 0);
  }
  if (data.balloon && data.balloon.visible) {
    balloon.x = Number(data.balloon.x) || 0;
    balloon.y = Number(data.balloon.y) || 0;
    balloon.z = Number(data.balloon.z) || 0;
    balloon.visible = true;
    balloon.armed = typeof chapterHasQuiz === 'function' ? chapterHasQuiz(run.next) : true;
  } else if (typeof hideBalloon === 'function') {
    hideBalloon();
  }
  lastBalloon = data.lastBalloon && typeof data.lastBalloon.x === 'number'
    ? { x: data.lastBalloon.x, y: data.lastBalloon.y, z: data.lastBalloon.z }
    : null;
  if (typeof data.lastSaveSlot === 'number') lastSaveSlot = data.lastSaveSlot;
  if (typeof introPhase !== 'undefined' && data.introPhase) introPhase = data.introPhase;
  if (typeof introStep !== 'undefined' && typeof data.introStep === 'number') introStep = data.introStep;
  if (typeof updateChapterChecks === 'function') updateChapterChecks();
  return true;
}

function resumeAfterLoadOrContinue(options) {
  const fromLoad = options && options.fromLoad;
  const snap = fromLoad ? null : menuSnapshot;
  menuSnapshot = null;
  hideMenu();
  if (run.mode === 'ending' || (snap && snap.ending)) {
    if (typeof showEndingOverlay === 'function') showEndingOverlay();
    return;
  }
  if (run.mode === 'ended' || (snap && snap.overlay && run.mode === 'ended')) {
    if (typeof finish === 'function') finish(typeof LAST_ROUTE_INDEX === 'number' && run.next >= LAST_ROUTE_INDEX);
    return;
  }
  if (run.mode === 'found' || (snap && snap.introPhase === 'found')) {
    run.mode = 'found';
    if (typeof showFoundPage === 'function') showFoundPage(run.next);
    if (typeof startTheme === 'function') startTheme({ fadeMs: 400 });
    return;
  }
  if (run.mode === 'section' || (snap && (snap.introPhase === 'search' || snap.introPhase === 'bridge' || run.mode === 'ready' && snap && snap.introVisible && snap.introPhase !== 'story'))) {
    run.mode = 'section';
    if (typeof showSearchPage === 'function') showSearchPage(run.next);
    if (typeof startTheme === 'function') startTheme({ fadeMs: 400 });
    return;
  }
  if (snap && snap.introVisible && snap.introPhase === 'story') {
    if (typeof showIntro === 'function') showIntro(typeof snap.introStep === 'number' ? snap.introStep : 0);
    if (typeof startTheme === 'function') startTheme({ fadeMs: 400 });
    return;
  }
  if (run.explore || run.mode === 'flying' || run.mode === 'quiz' || run.sessionStarted) {
    run.mode = 'flying';
    hideFlightOverlays();
    if (window.__loadHeli) window.__loadHeli();
    if (typeof prepareBalloonForFlight === 'function') prepareBalloonForFlight();
    if (typeof pauseTheme === 'function') pauseTheme(true);
    if (typeof startBgm === 'function') { bgmWanted = true; startBgm(400); }
    return;
  }
  if (typeof showIntro === 'function') showIntro(0);
}

function writeSlot(index) {
  const store = readSaveStore();
  store.slots[index] = captureSavePayload();
  store.lastSlot = index;
  lastSaveSlot = index;
  return writeSaveStore(store);
}

function loadSlot(index) {
  const store = readSaveStore();
  const data = store.slots[index];
  if (!data) return false;
  lastSaveSlot = index;
  store.lastSlot = index;
  writeSaveStore(store);
  applySavePayload(data);
  resumeAfterLoadOrContinue({ fromLoad: true });
  return true;
}

function canAutosave() {
  if (!sessionInProgress() || (run && run.explore)) return false;
  const mode = run && run.mode;
  return mode === 'flying' || mode === 'section' || mode === 'found' || mode === 'quiz';
}

function scheduleAutosave() {
  if (autosaveTimer && typeof clearTimeout === 'function') clearTimeout(autosaveTimer);
  if (typeof setTimeout !== 'function') {
    if (canAutosave()) writeSlot(lastSaveSlot);
    return;
  }
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (canAutosave()) writeSlot(lastSaveSlot);
  }, 250);
}

function paintMenuSlots(action) {
  const title = byId('menu-slots-title');
  if (title) title.textContent = action === 'save' ? '儲存進度' : '讀取進度';
  const store = readSaveStore();
  const buttons = typeof document !== 'undefined' && document.querySelectorAll
    ? document.querySelectorAll('#menu .menu-slot')
    : [];
  buttons.forEach(btn => {
    const index = Number(btn.dataset.slot);
    const slot = store.slots[index];
    if (btn.classList && typeof btn.classList.toggle === 'function') btn.classList.toggle('is-empty', !slot);
    if (slot && slot.savedAt) {
      btn.textContent = formatSaveTime(slot.savedAt);
      btn.disabled = false;
    } else {
      btn.textContent = '空白檔案';
      btn.disabled = action === 'load';
    }
  });
}

function showMenuPanel(name) {
  hideMenuConfirm();
  setMenuStatus('');
  const home = byId('menu-home');
  const slots = byId('menu-slots');
  const back = byId('menu-slots-back');
  if (home) home.hidden = name !== 'home';
  if (slots) slots.hidden = name !== 'slots';
  if (back) back.hidden = name !== 'slots';
}

function refreshMenuHome() {
  const cont = byId('menu-continue');
  const save = byId('menu-save');
  const playing = sessionInProgress();
  if (cont) cont.hidden = !playing;
  if (save) {
    save.disabled = !playing;
    save.title = playing ? '儲存進度到檔案位' : '尚未有可儲存的進度';
    save.setAttribute('aria-disabled', playing ? 'false' : 'true');
  }
}

function openMenu(options) {
  const fromTitle = options && options.fromTitle;
  menuSnapshot = {
    mode: run && run.mode,
    introPhase: typeof introPhase === 'string' ? introPhase : 'story',
    introStep: typeof introStep === 'number' ? introStep : 0,
    introVisible: typeof introVisible === 'function' && introVisible(),
    ending: typeof endingVisible === 'function' && endingVisible(),
    overlay: !!(byId('overlay') && !byId('overlay').hidden)
  };
  if (typeof closeQuiz === 'function') closeQuiz();
  if (run && (run.mode === 'quiz' || run.mode === 'liftoff')) run.mode = 'flying';
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof endingVisible === 'function' && endingVisible() && typeof stopEnding === 'function') stopEnding();
  if (typeof pauseBgm === 'function') pauseBgm(true);
  if (typeof startTheme === 'function') startTheme({ fromStart: !!fromTitle, fadeMs: 400 });
  if (typeof clearFlightInput === 'function') clearFlightInput();
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('intro')) byId('intro').hidden = true;
  if (byId('ending')) byId('ending').hidden = true;
  const node = byId('menu');
  if (node) node.hidden = false;
  showMenuPanel('home');
  refreshMenuHome();
}

function openTitleMenu() {
  if (typeof isCoarsePointer === 'function' && isCoarsePointer() && typeof window.__enterFullscreen === 'function') {
    window.__enterFullscreen();
  }
  if (typeof preloadLiftoffMedia === 'function') preloadLiftoffMedia();
  if (typeof startTheme === 'function') {
    const theme = byId('theme');
    if (!theme || theme.paused) startTheme({ fromStart: true, fadeMs: 400 });
  }
  openMenu({ fromTitle: true });
}

function resetInMemoryGame() {
  if (typeof closeQuiz === 'function') closeQuiz();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  if (typeof stopEnding === 'function') stopEnding();
  chapterProgress = emptyChapterProgress();
  quizDeck = [];
  quizAsked = 0;
  quizChapter = 0;
  quizIntroSeen = false;
  lastBalloon = null;
  if (typeof hideBalloon === 'function') hideBalloon();
  Object.assign(run, { mode: 'ready', next: 0, time: 0, camera: false, explore: false, sessionStarted: false });
  window.__introPendingStart = false;
  if (byId('marker')) byId('marker').hidden = true;
  if (byId('hint-box')) byId('hint-box').classList.remove('is-near');
  if (byId('title')) byId('title').textContent = defaultTitle;
  if (byId('briefing') && defaultBriefing) byId('briefing').textContent = defaultBriefing;
  if (start && start.dataset && start.dataset.unlocked === '1') start.textContent = '開始任務';
  if (typeof updateChapterChecks === 'function') updateChapterChecks();
}

function confirmRestart() {
  resetInMemoryGame();
  hideMenu();
  if (hasSeenIntroStory()) {
    if (typeof showSearchPage === 'function') showSearchPage(0);
    if (typeof startTheme === 'function') startTheme({ fadeMs: 400 });
  } else if (typeof startIntroStory === 'function') {
    startIntroStory();
  } else if (typeof showIntro === 'function') {
    showIntro(0);
  }
}

function askMenuConfirm(kind, slot) {
  menuConfirmKind = kind;
  menuPendingSlot = slot == null ? -1 : slot;
  const node = byId('menu-confirm');
  if (node) node.hidden = false;
}

function resolveMenuConfirm(ok) {
  const kind = menuConfirmKind;
  const slot = menuPendingSlot;
  hideMenuConfirm();
  if (!ok) return;
  if (kind === 'restart') confirmRestart();
  else if (kind === 'save') {
    const ok = writeSlot(slot);
    showMenuPanel('slots');
    paintMenuSlots('save');
    setMenuStatus(ok ? '已儲存進度' : '儲存失敗，請再試一次', ok ? 'ok' : 'warn');
  }
  else if (kind === 'load') loadSlot(slot);
}

function handleMenuKey(event) {
  if (!menuVisible()) return false;
  if (event.repeat) { event.preventDefault(); return true; }
  const confirm = byId('menu-confirm');
  if (confirm && !confirm.hidden) {
    if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); resolveMenuConfirm(true); }
    if (event.code === 'Escape') { event.preventDefault(); resolveMenuConfirm(false); }
    return true;
  }
  if (menuSlotAction && (event.code === 'Escape' || event.code === 'ArrowLeft')) {
    event.preventDefault();
    menuSlotAction = null;
    showMenuPanel('home');
    refreshMenuHome();
    return true;
  }
  if (event.code === 'Escape' && sessionInProgress()) {
    event.preventDefault();
    resumeAfterLoadOrContinue();
  }
  return true;
}

function bindMenu() {
  const art = byId('menu-art');
  if (art && !art.getAttribute('src') && !art.src) art.src = 'intro/menu-bg.jpg?v=' + GAME_BUILD;
  const image = new Image();
  image.src = 'intro/menu-bg.jpg?v=' + GAME_BUILD;
  const cont = byId('menu-continue');
  const restart = byId('menu-restart');
  const load = byId('menu-load');
  const save = byId('menu-save');
  const back = byId('menu-slots-back');
  const yes = byId('menu-confirm-yes');
  const no = byId('menu-confirm-no');
  if (cont) cont.addEventListener('click', resumeAfterLoadOrContinue);
  if (restart) restart.addEventListener('click', () => {
    if (sessionInProgress()) askMenuConfirm('restart');
    else confirmRestart();
  });
  if (load) load.addEventListener('click', () => {
    menuSlotAction = 'load';
    showMenuPanel('slots');
    paintMenuSlots('load');
  });
  if (save) save.addEventListener('click', () => {
    if (!sessionInProgress()) return;
    menuSlotAction = 'save';
    showMenuPanel('slots');
    paintMenuSlots('save');
  });
  if (back) back.addEventListener('click', () => {
    menuSlotAction = null;
    showMenuPanel('home');
    refreshMenuHome();
  });
  if (yes) yes.addEventListener('click', () => resolveMenuConfirm(true));
  if (no) no.addEventListener('click', () => resolveMenuConfirm(false));
  const buttons = typeof document !== 'undefined' && document.querySelectorAll
    ? document.querySelectorAll('#menu .menu-slot')
    : [];
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const index = Number(btn.dataset.slot);
      if (menuSlotAction === 'save' || menuSlotAction === 'load') askMenuConfirm(menuSlotAction, index);
    });
  });
}

function goHome() {
  const fromEnding = typeof endingVisible === 'function' && endingVisible();
  const fromLiftoff = typeof liftoffVisible === 'function' && liftoffVisible();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof stopFoundFilm === 'function') stopFoundFilm();
  if (typeof pauseBgm === 'function') pauseBgm(true);
  if (introTransitioning) introTransitioning = false;
  if (typeof closeQuiz === 'function') closeQuiz();
  if (run && run.mode === 'quiz') run.mode = 'flying';
  if (typeof clearFlightInput === 'function') clearFlightInput();
  if (typeof scheduleAutosave === 'function') scheduleAutosave();
  const onTitle = typeof introVisible === 'function' && introVisible() && introPhase === 'story' && introStep === 0 && !sessionInProgress();
  if (typeof openMenu === 'function') openMenu({ fromTitle: onTitle });
  else if (typeof showIntro === 'function') {
    if (typeof startTheme === 'function') startTheme({ fromStart: true, fadeMs: 400 });
    if (typeof transitionIntroScene === 'function') transitionIntroScene(() => showIntro(0));
    else showIntro(0);
  }
}


function hideFlightOverlays() {
  if (byId('intro')) byId('intro').hidden = true;
  if (byId('overlay')) byId('overlay').hidden = true;
  if (byId('ending')) byId('ending').hidden = true;
  if (typeof hideMenu === 'function') hideMenu();
  if (typeof closeQuiz === 'function') closeQuiz();
  // The lift-off film is managed separately so a scene cut does not hide it mid-play.
}

function beginSectionFlight() {
  window.__introPendingStart = false;
  const first = !run.sessionStarted;
  const place = selectedPlace();
  const free = !place.mission;
  if (first) {
    Object.assign(run, { mode: 'flying', next: 0, time: 0, camera: false, explore: free, sessionStarted: true });
  } else {
    // Keep the shared clock and current section, but always return to the
    // original mission-1 start (south-sea spawn) so later goals are not instant.
    run.mode = 'flying';
    run.camera = false;
  }
  placeCraft(place, free);
  if (byId('marker')) byId('marker').hidden = true;
  if (byId('hint-box')) byId('hint-box').classList.remove('is-near');
  clearFlightInput();
  hideFlightOverlays();
  if (window.__loadHeli) window.__loadHeli();
  if (typeof prepareBalloonForFlight === 'function') prepareBalloonForFlight(first);
  if (typeof updateChapterChecks === 'function') updateChapterChecks();
  start.blur();
}

function startFlight(explore = false) {
  const place = selectedPlace();
  const free = explore || !place.mission;
  // A full restart (or first takeoff) uses the south-sea spawn and a fresh clock.
  window.__introPendingStart = false;
  Object.assign(run, { mode: 'flying', next: 0, time: 0, camera: false, explore: free, sessionStarted: !free });
  placeCraft(place, free);
  if (byId('marker')) byId('marker').hidden = true;
  if (byId('hint-box')) byId('hint-box').classList.remove('is-near');
  clearFlightInput();
  hideFlightOverlays();
  if (window.__loadHeli) window.__loadHeli();
  if (typeof resetBalloonGame === 'function') resetBalloonGame();
  if (typeof prepareBalloonForFlight === 'function') prepareBalloonForFlight(true);
  start.blur();
  if (free && typeof startBgm === 'function') { bgmWanted = true; startBgm(400); }
}

function retryMission() {
  if (typeof resetBalloonGame === 'function') resetBalloonGame();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof pauseBgm === 'function') pauseBgm(true);
  if (introTransitioning) return;
  if (start.textContent === '未能開始飛行') {
    showInitFailureOverlay();
    return;
  }
  clearFlightInput();
  Object.assign(run, { mode: 'ready', next: 0, time: 0, camera: false, explore: false, sessionStarted: false });
  window.__introPendingStart = false;
  if (byId('title')) byId('title').textContent = defaultTitle;
  if (byId('briefing') && defaultBriefing) byId('briefing').textContent = defaultBriefing;
  if (byId('marker')) byId('marker').hidden = true;
  if (byId('hint-box')) byId('hint-box').classList.remove('is-near');
  if (start.dataset.unlocked === '1') start.textContent = '開始任務';
  stopEnding();
  if (typeof startTheme === 'function') startTheme({ fromStart: true, fadeMs: 400 });
  transitionIntroScene(() => showSearchPage(0));
}

function finish(success) {
  if (typeof closeQuiz === 'function') closeQuiz();
  if (typeof hideBalloon === 'function') hideBalloon();
  run.mode = 'ended';
  clearFlightInput();
  if (typeof stopLiftoff === 'function') stopLiftoff({ immediate: true });
  if (typeof pauseBgm === 'function') pauseBgm(true);
  if (typeof pauseTheme === 'function') pauseTheme(true);
  stopEnding();
  if (byId('intro')) byId('intro').hidden = true;
  byId('overlay').hidden = false;
  byId('title').textContent = success ? '考察完成' : '考察中斷';
  byId('briefing').textContent = success
    ? '已找到莫博士、金剛仔、小螢同斑班長。飛行時間 ' + Math.ceil(run.time) + ' 秒。'
    : '電量耗盡。可以再試一次。';
  start.textContent = '再飛一次';
  start.disabled = start.dataset.unlocked !== '1';
  if (byId('startup-status')) byId('startup-status').hidden = true;
  if (byId('startup-retry')) byId('startup-retry').hidden = true;
  if (byId('start-help')) byId('start-help').hidden = true;
  if (byId('explore')) byId('explore').hidden = true;
  if (byId('title-home')) byId('title-home').hidden = false;
  start.focus();
}

function shuffleQuizDeck(index) {
  if (index == null) index = (run && typeof run.next === 'number') ? run.next : 0;
  const order = unsolvedQuestionIndexes(index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  quizDeck = order;
  quizChapter = index;
  quizAsked = 0;
  return order;
}

function ensureChapterDeck() {
  const index = (run && typeof run.next === 'number') ? run.next : 0;
  if (quizChapter !== index || !quizDeck.length) shuffleQuizDeck(index);
}

function updateChapterChecks() {
  const root = byId('chapter-checks');
  if (!root) return;
  const row = (chapterProgress && chapterProgress[run.next]) || { correct: 0 };
  const marks = root.querySelectorAll ? root.querySelectorAll('.chapter-check') : [];
  marks.forEach((el, i) => {
    if (el.classList && typeof el.classList.toggle === 'function') el.classList.toggle('is-on', i < row.correct);
  });
  root.hidden = !!(run && run.explore);
  root.setAttribute('aria-label', '本篇答對 ' + Math.min(CHAPTER_GOAL, row.correct | 0) + ' / ' + CHAPTER_GOAL);
}

function energyRemaining() {
  if (run.explore) return 1;
  return Math.max(0, 1 - run.time / MISSION_TIME_LIMIT);
}

function refillEnergy() {
  run.time = 0;
}

function updateEnergyBar() {
  const track = byId('energy-track');
  if (!track) return;
  const frac = energyRemaining();
  track.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  const cells = track.querySelectorAll('i');
  cells.forEach((cell, index) => {
    cell.classList.toggle('is-on', (index + 0.5) / Math.max(1, cells.length) <= frac);
  });
}

function quizVisible() {
  const node = byId('quiz');
  return !!(node && !node.hidden);
}

function quizFadeDuration() {
  return (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 0 : QUIZ_FADE_MS;
}

function clearQuizFade() {
  if (quizFadeTimer) {
    clearTimeout(quizFadeTimer);
    quizFadeTimer = null;
  }
}

function revealQuizOverlay(fromHidden) {
  const root = byId('quiz');
  if (!root) return;
  quizLeaving = false;
  root.hidden = false;
  root.classList.remove('is-leaving');
  const ms = quizFadeDuration();
  if (!fromHidden || ms <= 0) {
    root.classList.add('is-visible');
    return;
  }
  root.classList.remove('is-visible');
  if (root.offsetWidth) void root.offsetWidth;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => root.classList.add('is-visible'));
  else root.classList.add('is-visible');
}

function fadeQuizSheet() {
  const sheet = byId('quiz-sheet');
  const ms = quizFadeDuration();
  if (!sheet || ms <= 0) return;
  sheet.classList.remove('is-entering');
  void sheet.offsetWidth;
  sheet.classList.add('is-entering');
}

function closeQuiz(options) {
  const fade = options && options.fade;
  const node = byId('quiz');
  quizPhase = 'off';
  quizCurrent = null;
  clearQuizFade();
  if (!node) return;
  const finish = () => {
    node.hidden = true;
    node.classList.remove('is-visible', 'is-leaving');
    const sheet = byId('quiz-sheet');
    if (sheet) sheet.classList.remove('is-entering');
    quizLeaving = false;
    quizFadeTimer = null;
  };
  const ms = fade && typeof setTimeout === 'function' ? quizFadeDuration() : 0;
  if (!ms || node.hidden) {
    finish();
    return;
  }
  quizLeaving = true;
  node.classList.add('is-leaving');
  node.classList.remove('is-visible');
  quizFadeTimer = setTimeout(finish, ms);
}

function hideBalloon() {
  balloon.visible = false;
  balloon.armed = false;
}

function resetBalloonGame() {
  closeQuiz();
  quizIntroSeen = false;
  lastBalloon = null;
  hideBalloon();
  if (typeof emptyChapterProgress === 'function') chapterProgress = emptyChapterProgress();
  shuffleQuizDeck(run && typeof run.next === 'number' ? run.next : 0);
  if (typeof updateChapterChecks === 'function') updateChapterChecks();
}

function balloonSpawnBounds() {
  const box = HK.MINIMAP;
  const padLon = (box.east - box.west) * 0.08;
  const padLat = (box.north - box.south) * 0.08;
  const sw = HK.toXZ(box.south + padLat, box.west + padLon);
  const ne = HK.toXZ(box.north - padLat, box.east - padLon);
  return {
    minX: Math.min(sw.x, ne.x), maxX: Math.max(sw.x, ne.x),
    minZ: Math.min(sw.z, ne.z), maxZ: Math.max(sw.z, ne.z)
  };
}

function inBalloonSpawnBox(x, z) {
  const box = balloonSpawnBounds();
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

function balloonSkyAltitude(x, z) {
  const surface = typeof surfaceHeight === 'function' ? surfaceHeight(x, z) : 0;
  const sky = BALLOON_SKY_MIN + Math.random() * (BALLOON_SKY_MAX - BALLOON_SKY_MIN);
  return Math.max(sky, surface + 220);
}

function firstBalloonSpot() {
  const start = typeof selectedPlace === 'function' ? selectedPlace() : (HK.places && HK.places[0]);
  const origin = HK.toXZ(start.lat, start.lon);
  const sine = Math.sin(start.yaw), cosine = Math.cos(start.yaw);
  for (let dist = BALLOON_FIRST_DIST; dist >= 2000; dist -= 80) {
    const x = origin.x + sine * dist;
    const z = origin.z + cosine * dist;
    if (inBalloonSpawnBox(x, z)) return { x: x, y: balloonSkyAltitude(x, z), z: z };
  }
  const box = HK.MINIMAP;
  const mid = HK.toXZ(box.south + (box.north - box.south) * 0.72, (box.west + box.east) / 2);
  return { x: mid.x, y: balloonSkyAltitude(mid.x, mid.z), z: mid.z };
}

function randomBalloonSpot(avoid) {
  const box = balloonSpawnBounds();
  const previous = avoid || lastBalloon;
  const preferAhead = run && run.mode === 'flying';
  const forwardX = Math.sin(craft.yaw), forwardZ = Math.cos(craft.yaw);
  let fallback = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = box.minX + Math.random() * (box.maxX - box.minX);
    const z = box.minZ + Math.random() * (box.maxZ - box.minZ);
    const candidate = { x: x, y: balloonSkyAltitude(x, z), z: z };
    const range = Math.hypot(candidate.x - craft.x, candidate.y - craft.y, candidate.z - craft.z);
    if (range < BALLOON_REACH + 120 || range > BALLOON_FAR + 400) continue;
    if (previous && Math.hypot(candidate.x - previous.x, candidate.y - previous.y, candidate.z - previous.z) < BALLOON_RESPAWN_MIN) continue;
    const ahead = (candidate.x - craft.x) * forwardX + (candidate.z - craft.z) * forwardZ;
    if (!fallback) fallback = candidate;
    if (preferAhead && ahead < 80 && attempt < 50) continue;
    if (range < BALLOON_NEAR && attempt < 40) continue;
    return candidate;
  }
  if (fallback) return fallback;
  const mid = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  mid.y = balloonSkyAltitude(mid.x, mid.z);
  return mid;
}

function spawnBalloon(avoid) {
  if (run.explore || !chapterHasQuiz(run.next)) {
    hideBalloon();
    return false;
  }
  ensureChapterDeck();
  const first = !avoid && !lastBalloon && !(chapterProgress[run.next] && chapterProgress[run.next].correct);
  const chosen = first ? firstBalloonSpot() : randomBalloonSpot(avoid);
  balloon.x = chosen.x;
  balloon.y = chosen.y;
  balloon.z = chosen.z;
  balloon.visible = true;
  balloon.armed = true;
  lastBalloon = { x: chosen.x, y: chosen.y, z: chosen.z };
  return true;
}

function prepareBalloonForFlight() {
  if (window.__loadBalloon) window.__loadBalloon();
  if (run.explore || !chapterHasQuiz(run.next)) {
    hideBalloon();
    return;
  }
  ensureChapterDeck();
  if (!balloon.visible) spawnBalloon();
}

function balloonRange() {
  return Math.hypot(craft.x - balloon.x, craft.y - balloon.y, craft.z - balloon.z);
}

function maybeTriggerBalloonQuiz() {
  if (run.mode !== 'flying' || run.explore || !balloon.visible || !balloon.armed) return;
  if (balloonRange() <= BALLOON_REACH) openBalloonQuiz();
}

function openBalloonQuiz() {
  if (!chapterHasQuiz(run.next)) return;
  ensureChapterDeck();
  const qi = quizDeck[0];
  if (qi == null) return;
  const question = chapterQuestions(run.next)[qi];
  if (!question) return;
  quizCurrent = { prompt: question.prompt, choices: question.choices, correct: question.correct, index: qi, chapter: run.next };
  balloon.armed = false;
  clearFlightInput();
  run.mode = 'quiz';
  showQuizPhase('intro');
}

function showQuizPhase(phase) {
  const root = byId('quiz');
  const appeared = !root || root.hidden;
  quizPhase = phase;
  const art = byId('quiz-art');
  const question = byId('quiz-question');
  const next = byId('quiz-next');
  const prompt = byId('quiz-prompt');
  if (!root) return;
  const artFor = {
    intro: 'intro/quiz-intro.jpg',
    question: 'intro/quiz-bg.jpg',
    correct: 'intro/quiz-correct.jpg',
    wrong: 'intro/quiz-wrong.jpg'
  };
  if (art) {
    art.src = (artFor[phase] || artFor.question) + '?v=' + GAME_BUILD;
    art.alt = phase === 'intro' ? '地理考察加油站' : phase === 'correct' ? '答對了' : phase === 'wrong' ? '答錯了' : '地理問題';
  }
  if (question) question.hidden = phase !== 'question';
  if (next) {
    next.hidden = phase === 'question';
    next.setAttribute('aria-label', '下一頁');
  }
  if (phase === 'question' && quizCurrent) {
    if (prompt) prompt.textContent = quizCurrent.prompt;
    const choices = quizCurrent.choices || [];
    for (let i = 0; i < 4; i++) {
      const btn = byId('quiz-choice-' + i);
      if (!btn) continue;
      if (i < choices.length) {
        btn.hidden = false;
        btn.textContent = choices[i];
      } else {
        btn.hidden = true;
        btn.textContent = '';
      }
    }
  }
  const status = byId('quiz-status');
  if (status) {
    status.hidden = false;
    status.textContent = phase === 'intro'
      ? '考考你，答對問題會為你加油。'
      : phase === 'question' ? '請選擇答案。'
      : phase === 'correct' ? '答對了，能量已充滿。'
      : '答錯了。';
  }
  if (appeared) revealQuizOverlay(true);
  else fadeQuizSheet();
}

function answerQuiz(choice) {
  if (quizLeaving || quizPhase !== 'question' || !quizCurrent) return;
  const ok = choice === quizCurrent.correct;
  if (ok) {
    const chap = quizCurrent.chapter != null ? quizCurrent.chapter : run.next;
    const row = chapterProgress[chap] || (chapterProgress[chap] = { correct: 0, solved: [] });
    if (row.solved.indexOf(quizCurrent.index) < 0) {
      row.solved.push(quizCurrent.index);
      row.correct += 1;
    }
    quizDeck = quizDeck.filter(i => i !== quizCurrent.index);
    refillEnergy();
    if (typeof updateChapterChecks === 'function') updateChapterChecks();
    if (typeof scheduleAutosave === 'function') scheduleAutosave();
  } else if (quizDeck.length > 1 && quizDeck[0] === quizCurrent.index) {
    quizDeck.push(quizDeck.shift());
  }
  showQuizPhase(ok ? 'correct' : 'wrong');
}

function advanceQuiz() {
  if (quizLeaving) return;
  if (quizPhase === 'intro') {
    showQuizPhase('question');
    return;
  }
  if (quizPhase !== 'correct' && quizPhase !== 'wrong') return;
  closeQuiz({ fade: true });
  if (run.mode === 'quiz') run.mode = 'flying';
  if (!chapterHasQuiz(run.next)) {
    hideBalloon();
    if (typeof scheduleAutosave === 'function') scheduleAutosave();
  } else {
    spawnBalloon(lastBalloon);
  }
}

function handleQuizKey(event) {
  if (!quizVisible() || quizLeaving) return false;
  if (event.repeat) { event.preventDefault(); return true; }
  if (quizPhase === 'question') {
    if (event.code === 'Digit1' || event.code === 'Numpad1') { event.preventDefault(); answerQuiz(0); }
    if (event.code === 'Digit2' || event.code === 'Numpad2') { event.preventDefault(); answerQuiz(1); }
    if (event.code === 'Digit3' || event.code === 'Numpad3') { event.preventDefault(); answerQuiz(2); }
    if (event.code === 'Digit4' || event.code === 'Numpad4') { event.preventDefault(); answerQuiz(3); }
    return true;
  }
  if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight') {
    event.preventDefault();
    advanceQuiz();
  }
  return true;
}

function bindBalloonQuiz() {
  ['intro/quiz-intro.jpg', 'intro/quiz-bg.jpg', 'intro/quiz-correct.jpg', 'intro/quiz-wrong.jpg'].forEach(src => {
    const image = new Image();
    image.src = src + '?v=' + GAME_BUILD;
  });
  const next = byId('quiz-next');
  if (next) next.addEventListener('click', advanceQuiz);
  for (let i = 0; i < 4; i++) {
    const btn = byId('quiz-choice-' + i);
    if (btn) btn.addEventListener('click', answerQuiz.bind(null, i));
  }
}

function balloonBasis(yaw) {
  const sine = Math.sin(yaw), cosine = Math.cos(yaw);
  return new Float32Array([
    cosine, 0, -sine,
    0, 1, 0,
    sine, 0, cosine
  ]);
}

function faceBalloonToCamera(camera) {
  if (!camera || !camera.eye) return;
  balloon.yaw = Math.atan2(camera.eye[0] - balloon.x, camera.eye[2] - balloon.z);
}



function update(dt) {
  if (run.mode !== 'flying') return;
  if (typeof menuVisible === 'function' && menuVisible()) return;
  run.time += dt;
  if (!run.explore && run.time >= MISSION_TIME_LIMIT) return finish(false);
  const axis = (positive, negative) => Number(active(positive)) - Number(active(negative));
  craft.yaw += (Number(active('KeyR') || active('KeyE')) - Number(active('KeyQ'))) * dt * 1.7;
  const forward = axis('KeyW', 'KeyS');
  const side = axis('KeyD', 'KeyA');
  const vertical = Number(active('KeyJ') || active('Space')) - Number(active('KeyM') || active('ShiftLeft') || active('ShiftRight') || active('KeyX'));
  const speed = 51 / Math.max(1, Math.hypot(forward, side));
  const sine = Math.sin(craft.yaw), cosine = Math.cos(craft.yaw);
  const ease = 1 - Math.exp(-4 * dt);
  craft.vx += ((forward * sine + side * cosine) * speed - craft.vx) * ease;
  craft.vz += ((forward * cosine - side * sine) * speed - craft.vz) * ease;
  craft.vy += (vertical * 23 - craft.vy) * ease;
  craft.x = clamp(craft.x + craft.vx * dt, HK.bounds.minX, HK.bounds.maxX);
  craft.z = clamp(craft.z + craft.vz * dt, HK.bounds.minZ, HK.bounds.maxZ);
  const floor = terrainFloor(craft.x, craft.z);
  const altitude = craft.y + craft.vy * dt;
  craft.y = clamp(altitude, floor, HK.MAX_ALTITUDE);
  if (altitude !== craft.y) craft.vy = 0;

  if (!run.explore) {
    const target = missionTarget();
    const arrived = Math.hypot(craft.x - target.x, craft.z - target.z) <= 70;
    if (arrived) arriveAtStation();
    else if (typeof maybeTriggerBalloonQuiz === 'function') maybeTriggerBalloonQuiz();
  }
}

function arriveAtStation() {
  if (run.mode !== 'flying' || run.explore) return;
  if (typeof chapterUnlocked === 'function' && !chapterUnlocked(run.next)) return;
  clearFlightInput();
  run.mode = 'found';
  if (typeof scheduleAutosave === 'function') scheduleAutosave();
  if (typeof transitionIntroScene === 'function' && typeof showFoundPage === 'function') {
    transitionIntroScene(() => showFoundPage(run.next));
  }
}

function toggleCamera() {
  if (run.mode === 'flying') run.camera = !run.camera;
}

start.addEventListener('click', () => retryMission());
if (byId('explore')) byId('explore').addEventListener('click', () => startFlight(true));
if (byId('home')) byId('home').addEventListener('click', goHome);
if (byId('title-home')) byId('title-home').addEventListener('click', goHome);
bindIntroStory();
const flightKeys = new Set([...buttons.map(button => button.dataset.key), 'Space', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyE']);
window.addEventListener('keydown', event => {
  if (event.target.closest('select,input,textarea,[contenteditable]')) return;
  if (handleIntroKey(event)) return;
  if (run.mode !== 'flying') return;
  if (event.code === 'KeyC' && !event.repeat) toggleCamera();
  if (!flightKeys.has(event.code) || (event.code === 'Space' && event.target.closest('button,a'))) return;
  event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
function clearFlightInput() {
  keys.clear();
  pointers.clear();
  for (const button of buttons) button.classList.remove('pressed');
}
function releaseFlightPointer(event) {
  pointers.delete(event.pointerId);
  for (const button of buttons) {
    if (![...pointers.values()].includes(button.dataset.key)) button.classList.remove('pressed');
  }
}
window.addEventListener('blur', clearFlightInput);
document.addEventListener('visibilitychange', () => {
  if (typeof document !== "undefined" && document.hidden) {
    clearFlightInput();
    if (typeof suspendGameAudio === 'function') suspendGameAudio();
  } else if (typeof resumeGameAudio === 'function') {
    resumeGameAudio();
  }
});
// Global release is a fallback if pointer capture is lost or unsupported.
window.addEventListener('pointerup', releaseFlightPointer);
window.addEventListener('pointercancel', releaseFlightPointer);
for (const button of buttons) {
  const stopNativeGesture = event => { if (event.cancelable) event.preventDefault(); };
  // Scope cancellation to flight controls, NEVER the whole page or <select>.
  for (const type of ['contextmenu', 'selectstart', 'dragstart', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    button.addEventListener(type, stopNativeGesture, { passive: false });
  }
  button.addEventListener('pointerdown', event => {
    stopNativeGesture(event);
    if (run.mode !== 'flying' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, button.dataset.key);
    button.classList.add('pressed');
    try { button.setPointerCapture(event.pointerId); } catch (_) { /* global release still clears this pointer */ }
  }, { passive: false });
  button.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) stopNativeGesture(event);
  }, { passive: false });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      stopNativeGesture(event);
      releaseFlightPointer(event);
    }, { passive: false });
  }
}

function shader(type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw Error(kind + ' shader compile failed: ' + (gl.getShaderInfoLog(result) || 'unknown'));
  }
  return result;
}

function loadAtlas(unit, url) {
  const texture = gl.createTexture();
  atlasTextures[unit] = texture;
  function upload(source) {
    if (LOW_POWER && Math.max(source.width || 0, source.height || 0) > 1024) {
      const reduced = document.createElement('canvas');
      const scale = 1024 / Math.max(source.width, source.height);
      reduced.width = Math.max(1, Math.round(source.width * scale));
      reduced.height = Math.max(1, Math.round(source.height * scale));
      reduced.getContext('2d').drawImage(source, 0, 0, reduced.width, reduced.height);
      source = reduced;
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return source;
  }
  upload(new ImageData(1, 1));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const atlasImage = upload(image);
        if (gl.getError() !== gl.NO_ERROR) throw Error('Imagery texture upload failed');
        chartImages[unit] = atlasImage;
        paintChart();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(Error('Imagery image could not be decoded'));
    image.src = url;
  });
}


function decodeBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function encodeAssetUrl(url) {
  if (!url || String(url).slice(0, 5) === 'data:') return url;
  try { return encodeURI(url); } catch (error) { return url; }
}

function loadTexture(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([180, 180, 180, 255]));
  const ready = new Promise(resolve => {
    const finish = (ok, error) => {
      if (error) {
        console.error(error);
        if (!window.__heliTextureError) {
          window.__heliTextureError = reportInitError('heli-texture', error);
        }
      }
      resolve(!!ok);
    };
    if (!url) return finish(false, Error('Missing drone texture url'));
    const image = new Image();
    image.fetchPriority = 'low';
    image.onload = () => {
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        let source = image;
        if (LOW_POWER && Math.max(image.width, image.height) > 512) {
          source = document.createElement('canvas');
          const scale = 512 / Math.max(image.width, image.height);
          source.width = Math.max(1, Math.round(image.width * scale));
          source.height = Math.max(1, Math.round(image.height * scale));
          source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const code = gl.getError();
        if (code !== gl.NO_ERROR) throw Error('Texture upload failed (' + code + '): ' + url);
        // WebGL1 treats non-power-of-two mipmaps as incomplete; generateMipmap
        // sets a GL error rather than throwing, and LINEAR_MIPMAP_LINEAR then
        // samples black on desktop GPUs. Phones often auto-downscale first.
        const pot = n => n > 0 && (n & (n - 1)) === 0;
        if (pot(source.width) && pot(source.height)) {
          try {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          } catch (mipError) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          }
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        finish(true);
      } catch (error) {
        // Typical on file:// when the image is treated as cross-origin / tainted.
        finish(false, error);
      }
    };
    image.onerror = () => finish(false, Error('Texture failed to load: ' + url));
    try {
      image.src = encodeAssetUrl(url);
    } catch (error) {
      finish(false, error);
    }
  });
  return { texture, ready };
}

// Common body transform, used AFTER each original propeller's local spin.
function droneModelBasis(state) {
  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
  const forward = state.vx * sy + state.vz * cy;
  const side = state.vx * cy - state.vz * sy;
  const pitch = -clamp(forward / 51, -1, 1) * .10;
  const roll = -clamp(side / 51, -1, 1) * .10;
  const sx = Math.sin(pitch), cx = Math.cos(pitch), sz = Math.sin(roll), cz = Math.cos(roll);
  // R_y(yaw) * R_x(pitch) * R_z(roll), column-major for WebGL.
  return new Float32Array([
    cy*cz+sy*sx*sz, cx*sz, -sy*cz+cy*sx*sz,
    -cy*sz+sy*sx*cz, cx*cz, sy*sz+cy*sx*cz,
    sy*cx, -sx, cy*cx
  ]);
}

function createHeliRenderer(gl) {
  const visualScale = 2; // 9 m baked longest axis -> 18 m; camera unchanged.
  const model = window.HELI_MODEL;
  if (!model) throw Error('Helicopter model data missing');
  const vary = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) || {}).precision
    ? 'highp' : 'mediump';
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec4 tangent;
    attribute vec2 uv;
    uniform vec3 eye, rightAxis, upAxis, forwardAxis, modelPos;
    uniform vec2 lens, rotorSpin;
    uniform mat3 modelBasis;
    uniform vec3 rotorPivot, rotorAxis;
    uniform float visualScale;
    vec3 spin(vec3 p) {
      return p * rotorSpin.x + cross(rotorAxis, p) * rotorSpin.y
        + rotorAxis * dot(rotorAxis, p) * (1.0 - rotorSpin.x);
    }
    varying ${vary} vec3 vWorld, vNormal, vTangent;
    varying ${vary} vec2 vUv;
    varying ${vary} float depth, bitangentSign;
    void main() {
      vec3 local = modelBasis * ((rotorPivot + spin(position - rotorPivot)) * visualScale);
      vec3 world = modelPos + local;
      vec3 delta = world - eye;
      depth = dot(delta, forwardAxis);
      gl_Position = vec4(dot(delta,rightAxis)*lens.x, dot(delta,upAxis)*lens.y,
                         depth*1.00005-0.4, depth);
      vWorld = world;
      vNormal = modelBasis * spin(normal);
      vTangent = modelBasis * spin(tangent.xyz);
      bitangentSign = tangent.w;
      vUv = uv;
    }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying ${vary} vec3 vWorld, vNormal, vTangent;
    varying ${vary} vec2 vUv;
    varying ${vary} float depth, bitangentSign;
    uniform sampler2D baseColorMap, metallicRoughnessMap, normalMap;
    uniform vec3 eye, baseColorFactor;
    uniform float metallicFactor, roughnessFactor, clearcoatFactor, clearcoatRoughnessFactor;
    void main() {
      vec3 Nref = normalize(vNormal);
      vec3 T = normalize(vTangent);
      vec3 B = normalize(cross(Nref, T)) * bitangentSign;
      vec3 Nmap = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
      vec3 N = normalize(mat3(T, B, Nref) * Nmap);
      vec3 L = normalize(vec3(0.35, 0.85, 0.4));
      vec3 V = normalize(eye - vWorld);
      vec3 H = normalize(L + V);
      vec3 baseColor = texture2D(baseColorMap, vUv).rgb * baseColorFactor;
      vec3 mr = texture2D(metallicRoughnessMap, vUv).rgb;
      float metallic = mr.b * metallicFactor;
      float roughness = mr.g * roughnessFactor;
      vec3 albedo = mix(baseColor, vec3(0.0), metallic);
      vec3 spec = mix(vec3(0.04), baseColor, metallic);
      float ndotl = max(dot(N, L), 0.0);
      vec3 colour = albedo * (0.28 + 0.72 * ndotl);
      float gloss = 1.0 - roughness;
      colour += spec * pow(max(dot(N, H), 0.0), exp2(10.0 * gloss + 1.0));
      if (clearcoatFactor > 0.0) {
        float coatGloss = 1.0 - clearcoatRoughnessFactor;
        colour += vec3(clearcoatFactor) * pow(max(dot(N, H), 0.0), exp2(10.0 * coatGloss + 1.0));
      }
      float haze = min(0.55, 1.0-exp(-max(0.0,depth)*0.00008));
      gl_FragColor = vec4(mix(colour, vec3(0.69,0.84,0.81), haze), 1.0);
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));

  const positions = new Float32Array(decodeBuffer(model.positions));
  const normals = new Float32Array(decodeBuffer(model.normals));
  const uvs = new Float32Array(decodeBuffer(model.uvs));
  const tangents = new Float32Array(decodeBuffer(model.tangents));
  const indices = new Uint16Array(decodeBuffer(model.indices));
  if (positions.length !== model.vertexCount * 3 || indices.length !== model.indexCount) {
    throw Error('Helicopter model buffer size mismatch');
  }
  const packed = new Float32Array(indices.length * 12);
  const rotorGroups = model.rotorGroups ? new Uint8Array(decodeBuffer(model.rotorGroups)) : new Uint8Array(model.vertexCount);
  const rotorParts = [[], [], []];
  for (let t = 0; t < indices.length; t += 3) {
    const group = rotorGroups[indices[t]];
    if (group !== rotorGroups[indices[t+1]] || group !== rotorGroups[indices[t+2]]) throw Error('Rotor triangle crosses component boundary');
    rotorParts[group].push(indices[t], indices[t+1], indices[t+2]);
  }
  const ranges = [], reordered = [];
  for (const part of rotorParts) { ranges.push({ first: reordered.length, count: part.length }); reordered.push(...part); }
  let w = 0;
  for (const i of reordered) {
    packed[w++] = positions[i * 3];
    packed[w++] = positions[i * 3 + 1];
    packed[w++] = positions[i * 3 + 2];
    packed[w++] = normals[i * 3];
    packed[w++] = normals[i * 3 + 1];
    packed[w++] = normals[i * 3 + 2];
    packed[w++] = tangents[i * 4];
    packed[w++] = tangents[i * 4 + 1];
    packed[w++] = tangents[i * 4 + 2];
    packed[w++] = tangents[i * 4 + 3];
    packed[w++] = uvs[i * 2];
    packed[w++] = uvs[i * 2 + 1];
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
  const uniforms = gameEntries(
    ['eye','rightAxis','upAxis','forwardAxis','lens','modelPos','modelBasis','rotorPivot','rotorAxis','rotorSpin','visualScale',
     'baseColorMap','metallicRoughnessMap','normalMap','baseColorFactor','metallicFactor','roughnessFactor','clearcoatFactor','clearcoatRoughnessFactor']
      .map(name => [name, gl.getUniformLocation(program, name)])
  );
  const attribs = {
    position: gl.getAttribLocation(program, 'position'),
    normal: gl.getAttribLocation(program, 'normal'),
    tangent: gl.getAttribLocation(program, 'tangent'),
    uv: gl.getAttribLocation(program, 'uv')
  };
  const textures = model.material.textures;
  const withBuild = url => !url || String(url).indexOf('?') >= 0 ? url : url + '?v=' + GAME_BUILD;
  const maps = [
    loadTexture(gl, withBuild(textures.baseColor)),
    loadTexture(gl, withBuild(textures.metallicRoughness)),
    loadTexture(gl, withBuild(textures.normal))
  ];
  const ready = Promise.all(maps.map(item => item.ready));
  const stride = 48;
  return {
    ready,
    debug: () => ({ originalFaces: indices.length / 3, ranges: ranges.map(r => ({ ...r })), rotors: model.rotors, visualScale, dimensionsMetres: model.bounds ? model.bounds.max.map((value, i) => (value - model.bounds.min[i]) * visualScale) : null, flying: run.mode === 'flying' }),
    draw(camera) {
      if (run.camera) return;
      gl.useProgram(program);
      gl.disable(gl.CULL_FACE);
      gl.uniform3fv(uniforms.eye, camera.eye);
      gl.uniform3fv(uniforms.rightAxis, camera.right);
      gl.uniform3fv(uniforms.upAxis, camera.up);
      gl.uniform3fv(uniforms.forwardAxis, camera.forward);
      gl.uniform2f(uniforms.lens, camera.fx, camera.fy);
      gl.uniform3f(uniforms.modelPos, craft.x, craft.y, craft.z);
      gl.uniformMatrix3fv(uniforms.modelBasis, false, droneModelBasis(craft));
      gl.uniform1f(uniforms.visualScale, visualScale);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, maps[0].texture);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, maps[1].texture);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, maps[2].texture);
      gl.uniform1i(uniforms.baseColorMap, 2);
      gl.uniform1i(uniforms.metallicRoughnessMap, 3);
      gl.uniform1i(uniforms.normalMap, 4);
      gl.uniform3fv(uniforms.baseColorFactor, new Float32Array(model.material.baseColorFactor.slice(0, 3)));
      gl.uniform1f(uniforms.metallicFactor, model.material.metallicFactor);
      gl.uniform1f(uniforms.roughnessFactor, model.material.roughnessFactor);
      gl.uniform1f(uniforms.clearcoatFactor, model.material.clearcoatFactor || 0);
      gl.uniform1f(uniforms.clearcoatRoughnessFactor, model.material.clearcoatRoughnessFactor || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attribs.position);
      gl.enableVertexAttribArray(attribs.normal);
      gl.enableVertexAttribArray(attribs.tangent);
      gl.enableVertexAttribArray(attribs.uv);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(attribs.tangent, 4, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, stride, 40);
      gl.uniform3f(uniforms.rotorPivot, 0, 0, 0);
      gl.uniform3f(uniforms.rotorAxis, 0, 1, 0);
      gl.uniform2f(uniforms.rotorSpin, 1, 0);
      gl.drawArrays(gl.TRIANGLES, ranges[0].first, ranges[0].count);
      for (let i = 0; i < 2; i++) {
        const rotor = model.rotors && model.rotors[i];
        if (!rotor || !ranges[i+1] || !ranges[i+1].count) continue;
        const speed = rotor.radiansPerSecond || 14.46;
        const angle = (run.mode === 'flying' || run.mode === 'liftoff') ? run.time * speed * (rotor.direction || 1) : 0;
        gl.uniform3fv(uniforms.rotorPivot, rotor.pivot);
        gl.uniform3fv(uniforms.rotorAxis, rotor.axis);
        gl.uniform2f(uniforms.rotorSpin, Math.cos(angle), Math.sin(angle));
        gl.drawArrays(gl.TRIANGLES, ranges[i+1].first, ranges[i+1].count);
      }
      gl.disableVertexAttribArray(attribs.normal);
      gl.disableVertexAttribArray(attribs.tangent);
      gl.disableVertexAttribArray(attribs.uv);
    }
  };
}

function createBalloonRenderer(gl) {
  const model = window.BALLOON_MODEL;
  if (!model) throw Error('Balloon model data missing');
  const height = model.bounds && model.bounds.max ? (model.bounds.max[1] - model.bounds.min[1]) : 3.27;
  const visualScale = BALLOON_HEIGHT / height;
  const vary = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) || {}).precision
    ? 'highp' : 'mediump';
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    uniform vec3 eye, rightAxis, upAxis, forwardAxis, modelPos;
    uniform vec2 lens;
    uniform mat3 modelBasis;
    uniform float visualScale;
    varying ${vary} vec3 vWorld, vNormal;
    varying ${vary} vec2 vUv;
    varying ${vary} float depth;
    void main() {
      vec3 local = modelBasis * (position * visualScale);
      vec3 world = modelPos + local;
      vec3 delta = world - eye;
      depth = dot(delta, forwardAxis);
      gl_Position = vec4(dot(delta,rightAxis)*lens.x, dot(delta,upAxis)*lens.y,
                         depth*1.00005-0.4, depth);
      vWorld = world;
      vNormal = modelBasis * normal;
      // Logo lettering is authored in texture space; flip U so it reads correctly
      // when the envelope faces the camera (otherwise Geography appears mirrored).
      vUv = vec2(1.0 - uv.x, uv.y);
    }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying ${vary} vec3 vWorld, vNormal;
    varying ${vary} vec2 vUv;
    varying ${vary} float depth;
    uniform sampler2D baseColorMap;
    uniform vec3 eye, baseColorFactor;
    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = normalize(vec3(0.35, 0.85, 0.4));
      vec3 baseColor = texture2D(baseColorMap, vUv).rgb * baseColorFactor;
      float ndotl = max(dot(N, L), 0.0);
      vec3 colour = baseColor * (0.48 + 0.62 * ndotl);
      float haze = min(0.22, 1.0-exp(-max(0.0,depth)*0.00004));
      gl_FragColor = vec4(mix(colour, vec3(0.69,0.84,0.81), haze), 1.0);
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));

  const positions = new Float32Array(decodeBuffer(model.positions));
  const normals = new Float32Array(decodeBuffer(model.normals));
  const uvs = new Float32Array(decodeBuffer(model.uvs));
  const indices = new Uint16Array(decodeBuffer(model.indices));
  if (positions.length !== model.vertexCount * 3 || indices.length !== model.indexCount) {
    throw Error('Balloon model buffer size mismatch');
  }
  const packed = new Float32Array(indices.length * 8);
  let w = 0;
  for (let t = 0; t < indices.length; t++) {
    const i = indices[t];
    packed[w++] = positions[i * 3];
    packed[w++] = positions[i * 3 + 1];
    packed[w++] = positions[i * 3 + 2];
    packed[w++] = normals[i * 3];
    packed[w++] = normals[i * 3 + 1];
    packed[w++] = normals[i * 3 + 2];
    packed[w++] = uvs[i * 2];
    packed[w++] = uvs[i * 2 + 1];
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
  const uniforms = gameEntries(
    ['eye','rightAxis','upAxis','forwardAxis','lens','modelPos','modelBasis','visualScale','baseColorMap','baseColorFactor']
      .map(name => [name, gl.getUniformLocation(program, name)])
  );
  const attribs = {
    position: gl.getAttribLocation(program, 'position'),
    normal: gl.getAttribLocation(program, 'normal'),
    uv: gl.getAttribLocation(program, 'uv')
  };
  const withBuild = url => !url || String(url).indexOf('?') >= 0 ? url : url + '?v=' + GAME_BUILD;
  const maps = {};
  const readyList = [];
  (model.ranges || []).forEach(range => {
    if (range.texture && !maps[range.texture]) {
      maps[range.texture] = loadTexture(gl, withBuild(range.texture));
      readyList.push(maps[range.texture].ready);
    }
  });
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  const ready = Promise.all(readyList.length ? readyList : [Promise.resolve(true)]);
  const stride = 32;
  return {
    ready,
    debug: () => ({
      visualScale, height: BALLOON_HEIGHT, visible: balloon.visible, armed: balloon.armed,
      position: { x: balloon.x, y: balloon.y, z: balloon.z },
      ranges: (model.ranges || []).map(range => ({ ...range }))
    }),
    draw(camera, seconds) {
      if (!balloon.visible) return;
      faceBalloonToCamera(camera);
      const bob = Math.sin((seconds || 0) * 1.15) * 1.15;
      const sway = Math.sin((seconds || 0) * 0.7) * 0.04;
      gl.useProgram(program);
      gl.disable(gl.CULL_FACE);
      gl.uniform3fv(uniforms.eye, camera.eye);
      gl.uniform3fv(uniforms.rightAxis, camera.right);
      gl.uniform3fv(uniforms.upAxis, camera.up);
      gl.uniform3fv(uniforms.forwardAxis, camera.forward);
      gl.uniform2f(uniforms.lens, camera.fx, camera.fy);
      gl.uniform3f(uniforms.modelPos, balloon.x, balloon.y + bob, balloon.z);
      gl.uniformMatrix3fv(uniforms.modelBasis, false, balloonBasis(balloon.yaw + sway));
      gl.uniform1f(uniforms.visualScale, visualScale);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attribs.position);
      gl.enableVertexAttribArray(attribs.normal);
      gl.enableVertexAttribArray(attribs.uv);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, stride, 24);
      const ranges = model.ranges || [{ first: 0, count: indices.length, color: [1, 1, 1] }];
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        const color = range.color || [1, 1, 1];
        gl.uniform3f(uniforms.baseColorFactor, color[0], color[1], color[2]);
        const map = range.texture && maps[range.texture];
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, map ? map.texture : white);
        gl.uniform1i(uniforms.baseColorMap, 2);
        gl.drawArrays(gl.TRIANGLES, range.first, range.count);
      }
      gl.disableVertexAttribArray(attribs.normal);
      gl.disableVertexAttribArray(attribs.uv);
    }
  };
}



function initializeRenderer() {
  if (!gl) throw Error('WebGL unavailable');
  if (typeof HK === 'undefined') throw Error('hk-map.js did not load (HK missing)');
  const program = gl.createProgram();
  const varyingPrecision = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) || {}).precision
    ? 'highp' : 'mediump';
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec3 position;
    attribute vec3 colour;
    uniform vec3 eye, rightAxis, upAxis, forwardAxis;
    uniform vec2 lens;
    varying ${varyingPrecision} vec3 shade, world;
    varying ${varyingPrecision} float depth;
    void main() {
      vec3 delta = position - eye;
      depth = dot(delta, forwardAxis);
      gl_Position = vec4(dot(delta,rightAxis)*lens.x, dot(delta,upAxis)*lens.y,
                         depth*1.00005-0.4, depth);
      shade = colour;
      world = position;
    }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying ${varyingPrecision} vec3 shade, world;
    varying ${varyingPrecision} float depth;
    uniform sampler2D overviewPhoto, detailPhoto;
    uniform float overviewReady, detailReady, photoSurface;
    void main() {
      vec3 colour = shade;
      if (photoSurface > 0.5) {
        vec2 tile = vec2(
          dot(world.xz, vec2(0.00706204649, -0.000006988322)) + 0.827321833,
          dot(world.xz, vec2(0.000006799489, 0.00710306546)) + 0.046492600);
        vec2 overviewUV = (vec2(tile.x, -tile.y) + vec2(23.0, 80.0)) / vec2(64.0, 96.0);
        vec2 detailUV = (vec2(tile.x, -tile.y) + vec2(14.0, 19.0)) / vec2(26.0, 30.0);
        vec2 overviewEdge = min(overviewUV, 1.0 - overviewUV);
        vec2 detailEdge = min(detailUV, 1.0 - detailUV);
        float overviewWeight = overviewReady * smoothstep(0.0, 0.012, min(overviewEdge.x, overviewEdge.y));
        float detailWeight = detailReady * smoothstep(0.0, 0.015, min(detailEdge.x, detailEdge.y));
        colour = mix(colour, texture2D(overviewPhoto, overviewUV).rgb, overviewWeight);
        colour = mix(colour, texture2D(detailPhoto, detailUV).rgb, detailWeight);
      }
      float haze = 1.0-exp(-max(0.0,depth)*0.00023);
      gl_FragColor = vec4(mix(colour,vec3(0.69,0.84,0.81),haze),1.0);
    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  const uniforms = gameEntries(['eye','rightAxis','upAxis','forwardAxis','lens',
    'overviewPhoto','detailPhoto','overviewReady','detailReady','photoSurface']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  const position = gl.getAttribLocation(program, 'position');
  const colour = gl.getAttribLocation(program, 'colour');
  gl.enableVertexAttribArray(position);
  gl.enableVertexAttribArray(colour);
  // Complete 1px texture for both samplers even before any optional model,
  // atlas or map image arrives. Some WebGL1 drivers validate both branches.
  const emptyPhoto = gl.createTexture();
  for (let unit = 0; unit < 2; unit++) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, emptyPhoto);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([80,90,100,255]));
  }
  const landscape = gl.createBuffer();
  const objects = gl.createBuffer();
  let landCount = 0;
  let bakedReady = false, atlasStarted = false, offlineDataLoading = false, offlineDataRetryAfter = 0;
  function loadOfflineAtlas() {
    if (atlasStarted) return;
    atlasStarted = true;
    const scriptReady = typeof landsImagery !== 'undefined' ? Promise.resolve() : loadGameScript('imagery.js');
    scriptReady.then(() => allSettled(landsImagery.map((url, unit) => loadAtlas(unit, url).then(() => {
      gl.useProgram(program);
      gl.uniform1f(unit === 0 ? uniforms.overviewReady : uniforms.detailReady, 1);
    })))).then(results => {
      if (results.some(result => result.status === 'rejected')) appendBriefing(' 部分離線航拍未能載入。');
    }).catch(() => appendBriefing(' 離線航拍未能載入，使用備用地形。'));
  }
  function ensureBakedLandscape() {
    if (run.mode === 'ready' || heightMode() === 'tiles' || (tiles && tiles.status.mode !== 'offline')) return;
    if (!detailGrid || typeof terrainBytes === 'undefined') {
      if (!offlineDataLoading && Date.now() >= offlineDataRetryAfter) {
        offlineDataLoading = true;
        loadOfflineData().then(() => { offlineDataLoading = false; tiles.rebuildAllMeshes(); })
          .catch(error => { offlineDataLoading = false; offlineDataRetryAfter = Date.now() + 30000; appendBriefing(' ' + error.message); });
      }
      return;
    }
    loadOfflineAtlas();
    if (bakedReady) return;
    const land = createLandscape();
    landCount = land.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, landscape);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(land), gl.STATIC_DRAW);
    bakedReady = true;
    bakedLand = true;
  }
  gl.useProgram(program);
  gl.uniform1i(uniforms.overviewPhoto, 0);
  gl.uniform1i(uniforms.detailPhoto, 1);
  tiles = HK.createTileManager(gl, bakedElevation);
  // Read-only diagnostics for local visual A/B, no browser automation needed.
  window.mapDebug = () => tiles.debugSnapshot();
  window.renderDebug = () => ({
    options: { ...renderOptions }, objects: { ...lastObjectCounts },
    frame: { ...lastRenderFrame }, craft: { ...craft },
    mission: { timeLimit: MISSION_TIME_LIMIT, next: run.next, route: route.map(p => ({ ...p })) },
    startup: window.__startupInfo, lowPower: LOW_POWER, heliAssetState, balloonAssetState,
    rotors: heliRenderer && heliRenderer.debug ? heliRenderer.debug() : null,
    balloon: balloonRenderer && balloonRenderer.debug ? balloonRenderer.debug() : null,
    quiz: { asked: quizAsked, phase: quizPhase, visible: balloon.visible, armed: balloon.armed },
    map: tiles.debugSnapshot()
  });
  if (byId('height-mode')) {
    byId('height-mode').value = tiles.getHeightMode();
    byId('height-mode').addEventListener('change', event => {
      tiles.setHeightMode(event.target.value);
      const statusNode = byId('map-status');
      const labels = { auto: '自動（全球高程）', tiles: '只用全球圖磚', baked: '只用本地長洲高程' };
      if (statusNode) statusNode.textContent = '高程來源：' + (labels[event.target.value] || event.target.value);
    });
  }
  function startHeliLoad() {
    if (heliAssetState === 'loading' || heliRenderer) return;
    heliAssetState = 'loading';
    const build = () => {
      try {
        heliRenderer = createHeliRenderer(gl);
        heliAssetState = 'texturing';
        heliRenderer.ready.then(flags => {
          heliAssetState = flags.every(Boolean) ? 'ready' : 'plain';
        }).catch(() => { heliAssetState = 'plain'; });
      } catch (error) {
        heliAssetState = 'error';
        window.__heliInitError = reportInitError('helicopter-model', error);
      }
    };
    if (window.HELI_MODEL) build();
    else loadGameScript('helicopter-model.js').then(build).catch(error => {
      heliAssetState = 'error';
      window.__heliInitError = reportInitError('helicopter-model-download', error);
    });
  }
  window.__loadHeli = startHeliLoad;
  function startBalloonLoad() {
    if (balloonAssetState === 'loading' || balloonRenderer) return;
    balloonAssetState = 'loading';
    const build = () => {
      try {
        balloonRenderer = createBalloonRenderer(gl);
        balloonAssetState = 'texturing';
        balloonRenderer.ready.then(flags => {
          balloonAssetState = flags.every(Boolean) ? 'ready' : 'plain';
        }).catch(() => { balloonAssetState = 'plain'; });
      } catch (error) {
        balloonAssetState = 'error';
        window.__balloonInitError = reportInitError('balloon-model', error);
      }
    };
    if (window.BALLOON_MODEL) build();
    else loadGameScript('balloon-model.js').then(build).catch(error => {
      balloonAssetState = 'error';
      window.__balloonInitError = reportInitError('balloon-model-download', error);
    });
  }
  window.__loadBalloon = startBalloonLoad;
  // Keep already-cached model support for offline/test embedding. HTTP bootstrap
  // doesn't request it until flight begins, so it cannot block the Start button.
  if (window.HELI_MODEL) startHeliLoad();
  if (window.BALLOON_MODEL) startBalloonLoad();
  enableFlightStart();
  if (byId('map-retry')) byId('map-retry').addEventListener('click', () => {
    offlineDataRetryAfter = 0;
    tiles.retry();
    tiles.requestAround(craft.x, craft.z);
    if (heliAssetState === 'error') startHeliLoad();
    if (balloonAssetState === 'error') startBalloonLoad();
  });
  if (byId('height-mode')) byId('height-mode').addEventListener('change', () => {
    if (heightMode() === 'baked') loadOfflineData().then(() => tiles.rebuildAllMeshes()).catch(error => appendBriefing(error.message));
  });
  // A slow phone/network is NOT proof the map is offline. r11's 4-second
  // timeout synchronously built 370,951 offline triangles (~76 MiB combined
  // JS-array/float staging) while the start overlay was still displayed.
  // Only actual tile failure/file:// switches to the bounded offline path.

  function draw(buffer, count) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(colour, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, count / 6);
  }

  const reference = gl.createBuffer();
  let referenceGeometry = [], referenceX = null, referenceZ = null;
  function updateReferenceGrid() {
    const cx = Math.floor(craft.x / 1000), cz = Math.floor(craft.z / 1000);
    if (referenceX === cx && referenceZ === cz) return;
    referenceX = cx; referenceZ = cz; referenceGeometry = [];
    for (let row = -4; row < 4; row++) for (let col = -4; col < 4; col++) {
      const x = (col + cx) * 1000, z = (row + cz) * 1000;
      const tint = (row + col + cx + cz) % 2 ? [.22,.29,.33] : [.27,.34,.38];
      quad(referenceGeometry, [x,0,z], [x+1000,0,z], [x+1000,0,z+1000], [x,0,z+1000], tint);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, reference);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(referenceGeometry), gl.STATIC_DRAW);
  }
  let tileClock = 0, noticeClock = -1, waitingSince = null;
  function updateStreamingNotice(seconds, snapshot, referenceVisible) {
    if (seconds - noticeClock < .5) return;
    noticeClock = seconds;
    const panel = byId('stream-notice');
    if (!panel) return;
    const waiting = referenceVisible || snapshot.draw.missingPhotos > 0;
    if (waiting && waitingSince === null) waitingSince = seconds;
    if (!waiting) waitingSince = null;
    const modelPending = !heliRenderer || heliAssetState === 'texturing' || heliAssetState === 'error';
    panel.hidden = run.mode === 'ready' || (!waiting && !modelPending);
    const elapsed = waitingSince === null ? 0 : Math.floor(seconds - waitingSince);
    const progress = '航拍 ' + snapshot.loadedImages + '、高程 ' + snapshot.loadedTerrain +
      '；載入中 ' + snapshot.inflight + '、排隊 ' + snapshot.pending;
    byId('stream-message').textContent = waiting
      ? (referenceVisible ? '地圖尚未顯示；棋盤網格只作方位參考，並非真實海陸。' : '地圖正逐步補齊。') +
        progress + '（等候 ' + elapsed + ' 秒）。可先操控；慢網絡可能需較長時間。'
      : '地圖已顯示。';
    byId('map-retry').hidden = !waiting && heliAssetState !== 'error';
    byId('model-status').textContent = heliAssetState === 'error'
      ? '原直升機模型載入失敗，可按重試；飛行仍可操作。'
      : (!heliRenderer ? '原直升機模型正背景下載（約1.2 MB），完成後自動顯示。'
        : heliAssetState === 'texturing' ? '原直升機已顯示，機身貼圖載入中。' : '');
  }
  return (camera, seconds) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(.66,.83,.87,1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (run.mode !== 'ready' && seconds - tileClock > 0.4) {
      tiles.requestAround(craft.x, craft.z, camera);
      tileClock = seconds;
      const statusNode = byId('map-status');
      if (statusNode) statusNode.textContent = tiles.status.message;
    }
    const offline = tiles.status.mode === 'offline';
    if (offline) ensureBakedLandscape();
    if (run.mode !== 'ready' && !offline && !renderOptions.hideMap) tiles.draw(camera);
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(colour);
    gl.uniform3fv(uniforms.eye, camera.eye);
    gl.uniform3fv(uniforms.rightAxis, camera.right);
    gl.uniform3fv(uniforms.upAxis, camera.up);
    gl.uniform3fv(uniforms.forwardAxis, camera.forward);
    gl.uniform2f(uniforms.lens, camera.fx, camera.fy);
    const snapshot = tiles.progressSnapshot();
    const referenceVisible = run.mode !== 'ready' && !(offline && bakedReady) && (offline || snapshot.draw.topTriangles === 0);
    if (referenceVisible && !renderOptions.hideMap) {
      updateReferenceGrid();
      gl.uniform1f(uniforms.photoSurface, 0);
      draw(reference, referenceGeometry.length);
    }
    updateStreamingNotice(seconds, snapshot, referenceVisible);
    if (bakedReady && offline && !renderOptions.hideMap) {
      // Tile/drone draws also use texture units 0/1; never depend on a
      // previous async atlas upload leaving those global bindings intact.
      atlasTextures.forEach((texture, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      });
      gl.uniform1f(uniforms.photoSurface, 1);
      draw(landscape, landCount);
    }
    gl.uniform1f(uniforms.photoSurface, 0);
    const geometry = createObjects(seconds);
    gl.bindBuffer(gl.ARRAY_BUFFER, objects);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry), gl.DYNAMIC_DRAW);
    if (!renderOptions.hideObjects) draw(objects, geometry.length);
    if (heliRenderer && !renderOptions.hideDrone) heliRenderer.draw(camera, seconds);
    if (typeof balloonRenderer !== 'undefined' && balloonRenderer) balloonRenderer.draw(camera, seconds);
    lastRenderFrame = {
      referenceVisible, mapVisible: !renderOptions.hideMap, offlineLandscape: offline && bakedReady && !renderOptions.hideMap,
      objectsDrawn: !renderOptions.hideObjects, droneDrawn: !!heliRenderer && !renderOptions.hideDrone,
      balloonDrawn: typeof balloonRenderer !== 'undefined' && !!balloonRenderer && typeof balloon !== 'undefined' && balloon.visible,
      objectVertices: renderOptions.hideObjects ? 0 : geometry.length / 6,
      eye: camera.eye.slice(), forward: camera.forward.slice()
    };
  };
}

function triangle(out, a, b, c, colour) {
  out.push(...a, ...colour, ...b, ...colour, ...c, ...colour);
}

function quad(out, a, b, c, d, colour) {
  triangle(out, a, b, c, colour);
  triangle(out, a, c, d, colour);
}

function box(out, x, y, z, w, h, d, colour, transform = point => point) {
  const corners = [
    [-w,-h,-d],[w,-h,-d],[w,-h,d],[-w,-h,d],
    [-w,h,-d],[w,h,-d],[w,h,d],[-w,h,d]
  ].map(([dx,dy,dz]) => transform([x+dx/2,y+dy/2,z+dz/2]));
  const faces = [[0,1,2,3,.54],[4,5,6,7,1],[0,1,5,4,.77],
    [1,2,6,5,.67],[2,3,7,6,.82],[3,0,4,7,.71]];
  for (const [a,b,c,d,light] of faces) {
    quad(out,corners[a],corners[b],corners[c],corners[d],colour.map(value => value*light));
  }
}

function createLandscape() {
  const geometry = [];
  quad(geometry,[-7100,-.25,-7100],[7100,-.25,-7100],[7100,-.25,7100],[-7100,-.25,7100],[.061,.34,.38]);
  function landFace(a,b,c) {
    const average = (a[1]+b[1]+c[1])/3;
    const slope = clamp(.53 + ((a[1]-b[1])*.7 + a[1]-c[1])*.022,.29,.72);
    const grain = Math.sin(a[0]*.17+a[2]*.09)*.028;
    const colour = average < 4 ? [.62,.57,.39] : [slope*.53+grain,slope*.84+grain,slope*.48];
    triangle(geometry,a,b,c,colour);
  }
  // Build from the original elevation grid so narrow coves and ridges keep their samples.
  function gridRow(row) {
    const z = (106.85 - row * .3) * 111;
    const columns = LOW_POWER ? 200 : 800;
    return Array.from({ length: columns + 1 }, (_, column) => {
      const x = (column * (120 / columns) - 46.7) * 103;
      return [x,(bakedElevation(x,z) || 0),z];
    });
  }
  let north = gridRow(0);
  const rowStep = LOW_POWER ? 2 : .5;
  for (let row = rowStep; row <= 490; row += rowStep) {
    const south = gridRow(row);
    for (let column = 0; column < north.length - 1; column++) {
      const nw = north[column], ne = north[column + 1];
      const sw = south[column], se = south[column + 1];
      if (nw[1] || ne[1] || sw[1]) landFace(nw, ne, sw);
      if (ne[1] || se[1] || sw[1]) landFace(ne, se, sw);
    }
    north = south;
  }
  return geometry;
}

function createObjects(seconds) {
  const out = [];
  // The old game invented a 62 x 64 m concrete box at world origin, y=0..2,
  // with two pale strips. It is not surveyed dock geometry. Terrarium cuts
  // through that flat box, leaving two grey polygons on top of the aerial
  // photograph. Remove it by default; the mission target remains unchanged.
  if (renderOptions.showDock) {
    box(out,0,1,0,62,2,64,renderOptions.objectTint ? [1,0,1] : [.48,.54,.49]);
    for (const x of [-27,27]) box(out,x,2.08,0,1,.15,55,
      renderOptions.objectTint ? [1,1,0] : [.77,.78,.63]);
  }
  const dockVertices = out.length / 6;
  const target = missionTarget();
  const finishing = run.next === LAST_ROUTE_INDEX;
  const angleToCraft = bearing(target,craft);
  // Keep the complete low-altitude ring above a flat surface (30 - 22 = 8 m).
  const radius = 22;
  const centreY = target.y; // Same live 30 m AGL target as marker and distance gates.
  const stripe = 3.5;
  const showRing = run.mode === 'flying' && !run.explore && distance(craft, target) <= 300 && (typeof chapterUnlocked !== 'function' || chapterUnlocked(run.next));
  if (showRing) {
    function ringPoint(angle, r) {
      const lateral = Math.cos(angle)*r;
      return [target.x+lateral*Math.cos(angleToCraft),centreY+Math.sin(angle)*r,
         target.z-lateral*Math.sin(angleToCraft)];
    }
    for (let i=0;i<48;i++) {
      const a = i*Math.PI/24, b = (i+.86)*Math.PI/24;
      quad(out,ringPoint(a,radius-stripe),ringPoint(a,radius),
        ringPoint(b,radius),ringPoint(b,radius-stripe),renderOptions.objectTint ? [0,1,1] : finishing?[.33,.96,.55]:[1,.65,.18]);
    }
  }
  lastObjectCounts = { dockVertices, missionVertices: out.length / 6 - dockVertices };
  return out;
}

const chart = document.createElement('canvas');
chart.width = 256;
chart.height = 256;
const chartContext = chart.getContext('2d');
const chartImages = [];
const chartPoint = (x,z) => HK.minimapProjection(chart.width, chart.height).worldToPix(x,z);
function paintChart() {
  chartContext.fillStyle = '#204d5d';
  chartContext.fillRect(0,0,chart.width,chart.height);
  const frame = HK.minimapProjection(chart.width, chart.height);
  const x0 = frame.x0, z0 = frame.z0, mpp = frame.metersPerPixel;
  chartImages.forEach((image,unit) => {
    // Map chart pixels to the same north-up aerial tile coordinates as the terrain shader.
    const scale = unit ? 128 : 16;
    const tileX = unit ? 14 : 23, tileY = unit ? 19 : 80;
    const transform = new DOMMatrix([
      scale*.00706204649*mpp,-scale*.000006799489*mpp,
      scale*.000006988322*mpp,scale*.00710306546*mpp,
      scale*(tileX+.827321833+x0*.00706204649-z0*.000006988322),
      scale*(tileY-.046492600-x0*.000006799489-z0*.00710306546)
    ]);
    chartContext.save();
    chartContext.setTransform(transform.inverse());
    chartContext.drawImage(image,0,0);
    chartContext.restore();
  });
}

function drawMap() {
  let worldToPix;
  if (tiles && tiles.status.mode === 'online') {
    worldToPix = tiles.paintMinimap(map, craft);
  } else {
    map.drawImage(chart,0,0);
    worldToPix = (x,z) => chartPoint(x,z);
  }
  const plot = (x,z) => {
    const p = worldToPix(x,z);
    const width = map.canvas.width, height = map.canvas.height;
    return [clamp(p[0], 4, width - 4), clamp(p[1], 4, height - 4)];
  };
  if (!run.explore) {
    const foundCount = (run.mode === 'found' || run.mode === 'ended') ? run.next + 1 : run.next;
    for (let i = 0; i < foundCount; i++) {
      map.fillStyle = '#b3e9c6';
      map.beginPath();
      map.arc(...plot(route[i].x, route[i].z), 3, 0, Math.PI * 2);
      map.fill();
    }
    if (run.mode === 'flying' && (typeof chapterUnlocked !== 'function' || chapterUnlocked(run.next))) {
      const target = missionTarget();
      if (distance(craft, target) <= 300) {
        map.fillStyle = '#ffca6c';
        map.beginPath();
        map.arc(...plot(target.x, target.z), 3, 0, Math.PI * 2);
        map.fill();
      }
    }
  }
  const [x,z] = plot(craft.x,craft.z);
  map.save();
  map.translate(x,z);
  map.rotate(craft.yaw);
  map.fillStyle = '#fff';
  map.beginPath();
  map.moveTo(0,-7); map.lineTo(5,5); map.lineTo(0,3); map.lineTo(-5,5);
  map.closePath(); map.fill();
  map.restore();
}

function cameraView() {
  const yaw = run.mode === 'ready' ? -.72 : craft.yaw;
  const sine = Math.sin(yaw), cosine = Math.cos(yaw);
  const pitch = run.mode === 'ready' ? -.27 : run.camera ? -.13 : -.27;
  const horizontal = Math.cos(pitch), vertical = Math.sin(pitch);
  const ready = run.mode === 'ready';
  const setback = ready ? 460 : run.camera ? -2.4 : 22;
  const lift = ready ? 190 : run.camera ? .2 : 7;
  const fy = 1.52;
  return {
    eye: [craft.x-sine*setback,craft.y+lift,craft.z-cosine*setback],
    right: [cosine,0,-sine],
    up: [-sine*vertical,horizontal,-cosine*vertical],
    forward: [sine*horizontal,vertical,cosine*horizontal],
    fx: Math.min(fy*canvas.height/canvas.width,2.3), fy
  };
}

let hudTime = -Infinity;
function drawHud(camera, seconds) {
  const target = missionTarget();
  const marker = byId('marker');
  const flying = run.mode === 'flying';
  const flyingMission = flying && !run.explore;
  const range = distance(craft, target);
  const hintBox = byId('hint-box');
  if (typeof updateChapterChecks === 'function') updateChapterChecks();
  const chapterOpen = typeof chapterUnlocked !== 'function' || chapterUnlocked(run.next);
  if (hintBox) {
    hintBox.hidden = !(flyingMission && chapterOpen);
    hintBox.classList.toggle('is-near', flyingMission && range <= 600 && chapterOpen);
  }
  const section = SECTIONS[run.next];
  const hintLabel = byId('hint-label');
  const hintText = byId('hint-text');
  if (section && hintLabel) hintLabel.textContent = '提示：' + section.hintWhere;
  if (section && hintText) hintText.textContent = section.hint;
  marker.hidden = !(flyingMission && range <= 300 && chapterOpen);
  byId('reticle').hidden = !flying || !run.camera;
  if (!marker.hidden) {
    const relative = [target.x-camera.eye[0],target.y-camera.eye[1],target.z-camera.eye[2]];
    const depth = dot(relative,camera.forward);
    const side = dot(relative,camera.right);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const x = depth>1 ? width*(.5+.5*camera.fx*side/depth) : side<0 ? 0 : width;
    const y = depth>1 ? height*(.5-.5*camera.fy*dot(relative,camera.up)/depth) : height*.5;
    marker.style.left = clamp(x, 90, width-90)+'px';
    marker.style.top = clamp(y, 80, height-48)+'px';
    const hint = depth<=1 || x<90 ? (side<0?'‹ ':'› ') : x>width-90 ? '› ' : '';
    marker.textContent = hint + Math.round(range) + ' m';
  }
  if (seconds - hudTime < .12) return;
  hudTime = seconds;
  byId('height').textContent = Math.round(craft.y);
  if (byId('agl')) byId('agl').textContent = Math.max(0, Math.round(altitudeAgl(craft.x, craft.y, craft.z)));
  byId('speed').textContent = Math.round(Math.hypot(craft.vx,craft.vz)*3.6);
  const heading = (Math.round(craft.yaw*180/Math.PI)%360+360)%360;
  byId('heading').textContent = String(heading).padStart(3,'0');
  if (typeof updateEnergyBar === 'function') updateEnergyBar();
  const battery = byId('battery');
  if (battery) battery.textContent = run.explore ? '—' : Math.max(0,100-Math.floor(run.time / MISSION_TIME_LIMIT * 100));
  items.forEach((li,index) => {
    li.classList.toggle('current',index===run.next);
    li.classList.toggle('done',index<run.next);
  });
  const needle = byId('compass-needle');
  if (needle) needle.style.transform = 'rotate(' + heading + 'deg)';
  drawMap();
}

try {
  if (byId('build-id') && window.GAME_DEBUG) byId('build-id').textContent = '版本 ' + GAME_BUILD + ' · 正在初始化';
  populatePlaces();
  const render = initializeRenderer();
  let previous = performance.now();
  function frame(now) {
    try {
      const scale = Math.min(devicePixelRatio || 1, LOW_POWER ? 1 : 1.6);
      const width = Math.max(1,Math.round(canvas.clientWidth*scale));
      const height = Math.max(1,Math.round(canvas.clientHeight*scale));
      if (canvas.width!==width || canvas.height!==height) {
        canvas.width=width; canvas.height=height;
      }
      if (contextLost) { previous = now; requestAnimationFrame(frame); return; }
      update(clamp((now-previous)/1000,0,.05));
      previous = now;
      const camera = cameraView();
      render(camera,now/1000);
      drawHud(camera,now/1000);
    } catch (error) {
      if (!window.__frameError) {
        window.__frameError = reportInitError('frame', error);
        appendBriefing(' 畫面更新發生錯誤（' + GAME_BUILD + '／frame）。原因：' + window.__frameError + '。若開始按鈕已解鎖，仍可嘗試飛行。');
        enableFlightStart();
      }
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('visibilitychange', () => { previous = performance.now(); });
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  const stage = !gl ? 'webgl-context' : (typeof HK === 'undefined' ? 'hk-map-script' : 'initializeRenderer');
  showInitFailure(stage, error);
}

