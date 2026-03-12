/* ===== 初期ボタン構成 ===== */
const PRIMARY_BUTTONS = [
  { type:'primary', label:'不利' },
  { type:'primary', label:'有利' },
  { type:'primary', label:'立ち回り' },
  { type:'primary', label:'演出' },
];
const DEFAULT_EVENTS = [
  'コンボ','ヒット','投げ','固め','起き攻め','置き','差し','差し返し','対空','無敵','バースト','壁割'
];
const BTN_CFG_KEY = 'fg-event-config-v1';

const DAMAGE_INSTANT_LABELS = new Set(['ヒット','投げ']);
const DAMAGE_COMBO_TOGGLE_LABEL = 'コンボ';
/* ===== 状態 ===== */
const videoEl = document.getElementById('videoEl');
let videoId = ''; let videoTitle = '';
let startSec = null; let endSec = null; let activePrimary = null;
let sessionId = Math.random().toString(36).slice(2,8);
let lastTapAt = 0, seqCounter = 0;

// ログ：{ _id, _seq, sessionId, videoId, thms, tsec, kind, label }
const sessionLogs = [];

// コンボ状態の内部フラグ（UIはそのまま）
let comboActive = false;


/* ===== Util ===== */
const round3 = (x) => Math.round(x * 1000) / 1000;
function secToHMS3(sec) {
  sec = Math.max(0, +sec || 0);
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const pad2 = n => String(n).padStart(2, '0'), pad3 = n => String(n).padStart(3, '0');
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}.${pad3(ms)}` : `${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}
function clampSec(sec) {
  if (startSec != null && sec < startSec) sec = startSec;
  if (endSec != null && sec > endSec)   sec = endSec;
  return sec;
}
function currentTimeSec() {
  if (!videoEl || isNaN(videoEl.currentTime)) return 0;
  return clampSec(videoEl.currentTime || 0);
}
function debounceTap() {
  const t = Date.now();
  if (t - lastTapAt < 300) return true;
  lastTapAt = t; return false;
}
function makeId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

/* ===== CSV ===== */
function toCsvRow(p){ return { sessionId:p.sessionId, videoId:p.videoId, thms:p.thms, tsec:p.tsec, kind:p.kind, label:p.label }; }
function renderCsv(){
  const lines=[['SessionId','VideoId','THMS','TSec','Kind','Label']];
  sessionLogs.forEach(r=> lines.push([r.sessionId, r.videoId, r.thms, (typeof r.tsec==='number'? r.tsec.toFixed(3): r.tsec), r.kind, r.label]));
  const csv=lines.map(cols=>cols.map(v=>{ const s=(v??'').toString(); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }).join(',')).join('\n');
  document.getElementById('csvBox').value = csv;
}

/* ===== 並び順：TSec昇順 → kind優先度 → 追加順 ===== */
function kindRank(k){ return k==='mark'?0 : k==='primary'?1 : k==='damage'?2 : k==='event'?3 : k==='memo'?4 : 5; }
function sortLogs(){
  sessionLogs.sort((a,b)=>{
    if (a.tsec !== b.tsec) return a.tsec - b.tsec;
    const rk = kindRank(a.kind) - kindRank(b.kind);
    if (rk !== 0) return rk;
    return a._seq - b._seq;
  });
}

/* ===== 詳細パネル（初期OPEN／下の△/▽で開閉） ===== */
const detailPanel = document.getElementById('detailPanel');
const toggleDetailBtn = document.getElementById('toggleDetailBtn');
function setDetailVisible(v){
  detailPanel.style.display = v ? 'block' : 'none';
  toggleDetailBtn.textContent = v ? '▽' : '△'; // 開=▽ / 閉=△
}
setDetailVisible(true); // 初期：表示

/* ===== 詳細パネル内要素 ===== */
const fileExpanded = document.getElementById('fileExpanded');
const fileNameEl = document.getElementById('fileName');
const changeBtn = document.getElementById('changeBtn');
const rangeEditBtn = document.getElementById('rangeEditBtn');
const rangeText = document.getElementById('rangeText');
const fileInput = document.getElementById('fileInput');
const loadLocalBtn = document.getElementById('loadLocalBtn');

toggleDetailBtn.addEventListener('click', ()=>{
  const visible = detailPanel.style.display !== 'none';
  setDetailVisible(!visible);
});
changeBtn.addEventListener('click', ()=> fileInput.click());
rangeEditBtn.addEventListener('click', ()=> rangeButtons.classList.remove('hidden'));

function updateRangeText(){
  if (startSec != null && endSec != null) rangeText.textContent = `分析範囲: ${secToHMS3(startSec)} - ${secToHMS3(endSec)}`;
  else rangeText.textContent = '';
}

/* ===== 範囲ボタン（開始/終了：初期表示／両mark→非表示） ===== */
const rangeButtons = document.getElementById('rangeButtons');
function updateRangeButtonsVisibility(){
  const hasStart = sessionLogs.some(r => r.kind==='mark' && r.label==='分析開始');
  const hasEnd   = sessionLogs.some(r => r.kind==='mark' && r.label==='分析終了');
  if (hasStart && hasEnd) rangeButtons.classList.add('hidden'); else rangeButtons.classList.remove('hidden');
}

/* ===== ログ描画 ===== */
function renderLogList(){
  const box = document.getElementById('logList'); box.innerHTML = '';
  sessionLogs.forEach(r => {
    const row = document.createElement('div'); row.className = 'log-row';
    row.addEventListener('click', () => {
      videoEl.currentTime = clampSec(r.tsec);
    });
    const left = document.createElement('div'); left.className = 'log-left';
    const del = document.createElement('button'); del.className = 'log-del'; del.textContent = '削除'; del.title='この行を削除';
    del.addEventListener('click', (e)=>{
      e.stopPropagation();
      const idx = sessionLogs.findIndex(x => x._id === r._id);
      if (idx >= 0) {
        sessionLogs.splice(idx,1);
        recomputeRangeFromMarks();
        sortLogs(); renderCsv(); renderLogList();
        updateRangeButtonsVisibility(); updateRangeText();
      }
    });
    const tspan = document.createElement('div'); tspan.className='log-time'; tspan.textContent=r.thms;
    const kspan = document.createElement('div'); kspan.className='log-kind';
    kspan.textContent = r.kind==='primary'?'主': r.kind==='event'?'Ev': r.kind==='damage'?'Dmg': r.kind==='memo'?'Memo':'Mark';
    left.appendChild(del); left.appendChild(tspan); left.appendChild(kspan);

    const label = document.createElement('div'); label.className='log-label'; label.textContent = r.label || '';

    row.appendChild(left); row.appendChild(label);
    box.appendChild(row);
  });
}

function pushLogAndRender(row){
  row._id = makeId(); row._seq = ++seqCounter;
  sessionLogs.push(row);
  sortLogs(); renderCsv(); renderLogList();
  updateRangeButtonsVisibility(); updateRangeText();
}

/* ===== 記録 ===== */
function buildPayload({kind,label,tsec}){
  const ts = round3(tsec);
  return { sessionId, videoId, videoTitle, kind, label, tsec: ts, thms: secToHMS3(ts) };
}
function recordPrimary(label,t){ pushLogAndRender(toCsvRow(buildPayload({ kind:'primary', label, tsec:t }))); }
function recordEvent(label,t){ 
  const routed = routeEventKindByLabel(label);
  pushLogAndRender(toCsvRow(buildPayload({ kind:routed.kind,label:routed.label, tsec:t }))); 
 }
function recordMemoInline(text,t){
  const v=(text||'').trim(); if(!v){ alert('メモが空です'); return; }
  pushLogAndRender(toCsvRow(buildPayload({ kind:'memo', label:v, tsec:t })));
}
function recordMark(label,t){    pushLogAndRender(toCsvRow(buildPayload({ kind:'mark',    label, tsec:t }))); }

function recomputeRangeFromMarks(){
  let lastStart=null, lastEnd=null;
  for (const r of sessionLogs) {
    if (r.kind==='mark' && r.label==='分析開始') lastStart = r.tsec;
    if (r.kind==='mark' && r.label==='分析終了') lastEnd   = r.tsec;
  }
  if (lastStart != null && lastEnd != null && lastEnd < lastStart) { const tmp=lastStart; lastStart=lastEnd; lastEnd=tmp; }
  startSec = lastStart; endSec = lastEnd;
}


function routeEventKindByLabel(label) {
  //  コンボ（トグル開始/終了）
  if (label === DAMAGE_COMBO_TOGGLE_LABEL) {
    const out = comboActive
      ? { kind: 'damage', label: 'コンボ終了' }
      : { kind: 'damage', label: 'コンボ開始' };
    comboActive = !comboActive;
    return out;
  }

  // 3) 瞬間ダメージ（ヒット/投げ など）
  if (DAMAGE_INSTANT_LABELS.has(label)) {
    return { kind: 'damage', label: label };
  }

  // 4) それ以外は従来どおり event としてログ
  return { kind: 'event', label };
}

/* ===== ファイル読込 ===== */
loadLocalBtn.addEventListener('click', ()=>{
  const inp=fileInput; if(!inp.files || !inp.files[0]) return alert('動画ファイルを選択してください');
  const file=inp.files[0]; const url=URL.createObjectURL(file);
  videoEl.src = url; videoEl.playbackRate = 1.0;

  videoId = file.name; videoTitle = file.name;
  sessionId = Math.random().toString(36).slice(2,8);
  startSec=null; endSec=null; activePrimary=null; seqCounter=0;

  sessionLogs.length = 0; renderCsv(); renderLogList();
  updateRangeButtonsVisibility(); updateRangeText();

  fileNameEl.textContent = ' ' + file.name;

  // ◀ 仕様：ファイル読込完了後に詳細パネルを自動で閉じる
  setDetailVisible(false);
});
changeBtn.addEventListener('click', () => fileInput.click());

/* ===== 再生制御・シーク ===== */
const toggleBtn = document.getElementById('togglePlayBtn');
function updateToggleButton(){
  if (!videoEl.src) { toggleBtn.textContent='▶︎ 再生'; return; }
  toggleBtn.textContent = videoEl.paused ? '▶︎ 再生' : '⏸ 停止';
}
toggleBtn.addEventListener('click', ()=>{
  if(!videoEl.src) return alert('先にファイルを読み込んでください');
  if (videoEl.paused) videoEl.play(); else videoEl.pause();
});
videoEl.addEventListener('play',  updateToggleButton);
videoEl.addEventListener('pause', updateToggleButton);

/* 範囲ボタン（初期表示／両mark→非表示） */
document.getElementById('setStartBtn').addEventListener('click', ()=>{
  if(!videoEl.src) return alert('先にファイルを読み込んでください');
  const t = round3(currentTimeSec()); startSec = t; recordMark('分析開始', t);
});
document.getElementById('setEndBtn').addEventListener('click', ()=>{
  if(!videoEl.src) return alert('先にファイルを読み込んでください');
  const t = round3(currentTimeSec()); endSec = t;
  if (startSec != null && endSec != null && endSec < startSec) { const tmp=startSec; startSec=endSec; endSec=tmp; }
  recordMark('分析終了', endSec);
});

function stepSeek(delta){
  if(!videoEl.src) return;
  let t=(videoEl.currentTime||0)+delta; t = clampSec(t); videoEl.currentTime = t;
}
document.getElementById('back3Btn').addEventListener('click', () => stepSeek(-3));
document.getElementById('fwd3Btn').addEventListener('click',  () => stepSeek(3));
document.getElementById('back01Btn').addEventListener('click', () => stepSeek(-0.1));
document.getElementById('fwd01Btn').addEventListener('click',  () => stepSeek(0.1));

/* ===== 主ボタン描画 ===== */
function renderPrimaryButtons(){
  const grid = document.getElementById('primaryGrid'); grid.innerHTML = '';
  PRIMARY_BUTTONS.forEach(btn=>{
    const el=document.createElement('button'); el.textContent=btn.label; el.classList.add('primary');
    el.addEventListener('click', ()=>{
      if(debounceTap()) return;
      if(!videoEl.src) return alert('先にファイルを読み込んでください');
      if(startSec==null) return alert('先に「分析開始」を押してください');
      recordPrimary(btn.label, currentTimeSec());
    });
    grid.appendChild(el);
  });
}

/* ===== イベントボタン（4×3 / 長押し改名） ===== */
function loadEventConfig(){
  try{
    const raw=localStorage.getItem(BTN_CFG_KEY);
    if(!raw) return DEFAULT_EVENTS.slice(0,12);
    const arr=JSON.parse(raw), merged=[];
    for(let i=0;i<12;i++){ merged.push((arr[i] && arr[i].trim()) ? arr[i].trim() : (DEFAULT_EVENTS[i] || `イベント${i+1}`)); }
    return merged;
  }catch{ return DEFAULT_EVENTS.slice(0,12); }
}
function saveEventConfig(list){ localStorage.setItem(BTN_CFG_KEY, JSON.stringify(list)); }
function renderEventButtons(){
  const grid = document.getElementById('eventGrid'); grid.innerHTML = '';
  const labels = loadEventConfig();
  labels.forEach((name, idx)=>{
    const el=document.createElement('button'); el.textContent=name;
    el.addEventListener('click', ()=>{
      if(debounceTap()) return;
      if(!videoEl.src) return alert('先にファイルを読み込んでください');
      if(startSec==null) return alert('先に「分析開始」を押してください');
      recordEvent(name, currentTimeSec());
    });
    let tid=null;
    el.addEventListener('touchstart',(e)=>{
      tid=setTimeout(()=>{
        e.preventDefault();
        const newName=prompt('イベント名を変更', el.textContent);
        if(newName && newName.trim()){
          const next=loadEventConfig(); next[idx]=newName.trim(); saveEventConfig(next); renderEventButtons();
        }
      },600);
    },{passive:true});
    ['touchend','touchmove','touchcancel'].forEach(ev=>el.addEventListener(ev,()=>tid&&clearTimeout(tid)));
    grid.appendChild(el);
  });
}

// 初期描画
renderPrimaryButtons();
renderEventButtons();

// メモ
document.getElementById('saveMemoBtn').addEventListener('click', ()=>{
  if(!videoEl.src) return alert('先にファイルを読み込んでください');
  if(startSec==null) return alert('先に「分析開始」を押してください');
  recordMemoInline(document.getElementById('memoInput').value, currentTimeSec());
  document.getElementById('memoInput').value='';
});

// イベント名リセット
document.getElementById('resetLabelsBtn').addEventListener('click', ()=>{
  if(!confirm('イベント名を初期化します。よろしいですか？')) return;
  localStorage.removeItem(BTN_CFG_KEY); renderEventButtons();
});

// CSVモーダル（復旧）
const modal = document.getElementById('csvModal');
const openCsvBtn = document.getElementById('openCsvBtn');
const closeCsvBtn = document.getElementById('closeCsvBtn');
const csvBox = document.getElementById('csvBox');
openCsvBtn.addEventListener('click', ()=>{ renderCsv(); modal.style.display='flex'; setTimeout(()=>{ csvBox.focus(); csvBox.select(); }, 80); });
function closeModal(){ modal.style.display='none'; }
closeCsvBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e)=>{ if(e.target === modal) closeModal(); });
document.getElementById('copyCsvBtn').addEventListener('click', ()=>{ csvBox.focus(); csvBox.select(); try{ document.execCommand('copy'); } catch{} });
