// app.js — GymOS v4
import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, addDoc, getDocs, collection, query, where, updateDoc, increment, serverTimestamp, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ── CONFIG ───────────────────────────────────────────────────
const app = initializeApp({
  apiKey:            "AIzaSyDrycyaWFGrnZ0fHzYjYcC8MDFpSsmrwqI",
  authDomain:        "gymos-app.firebaseapp.com",
  projectId:         "gymos-app",
  storageBucket:     "gymos-app.firebasestorage.app",
  messagingSenderId: "128500011082",
  appId:             "1:128500011082:web:eacf8270fd4e2435b0d6b3"
});
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── STATE ────────────────────────────────────────────────────
const S = {
  user:null, ud:null,
  aps:[], checkinOk:false,
  ciTime:null, ciCoords:null, coCoords:null,
  tipoSel:null, treinoAtual:null,
  timerIv:null, timerS:0,
  mTipo:'A', mExs:{A:[],B:[],C:[]}, mIds:{A:null,B:null,C:null},
  apAtual:null, editExIdx:null, activeTab:'treino',
};

// ── DOM ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = s  => document.querySelectorAll(s);
const SCRS = ['login','checkin','sel','exec','montar','ap','rel','perfil'];
const FB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="#1b1f2c" width="64" height="64"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="28" fill="#c9ff00">🏋️</text></svg>')}`;

// ── HELPERS ──────────────────────────────────────────────────
function show(nm) {
  SCRS.forEach(n => { const el = $(`s-${n}`); if (el) el.classList.toggle('hidden', n !== nm); });
  $('bnav').classList.toggle('hidden', nm === 'login');
  $$('.ni').forEach(b => b.classList.toggle('active', b.dataset.tab === S.activeTab));
}

let toastT;
function toast(msg, type = 's') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `on ${type}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 3200);
}

function showL() { $('loader').classList.remove('hidden'); }
function hideL() { $('loader').classList.add('hidden'); }

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function fmtHora(d) { return d ? d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '—'; }
function fmtDur(ms) { const m = Math.round(ms / 60000), h = Math.floor(m / 60), mm = m % 60; return h > 0 ? `${h}h ${mm}min` : `${mm} min`; }
function fmtCoord(c) { return c ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (±${c.acc}m)` : '—'; }
function greet() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }

function ytId(url) {
  if (!url) return null;
  // Suporta todos os formatos:
  // https://www.youtube.com/watch?v=ID
  // https://youtu.be/ID
  // https://www.youtube.com/embed/ID
  // https://www.youtube.com/shorts/ID   ← Shorts
  // https://youtube.com/shorts/ID
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([^&?\/\s]{11})/);
  return m ? m[1] : null;
}

function fotoAp(ap) {
  if (ap.url_foto) return ap.url_foto;
  if (ap.video_url) { const v = ytId(ap.video_url); if (v) return `https://img.youtube.com/vi/${v}/hqdefault.jpg`; }
  return FB;
}

// Retorna o número do aparelho de forma segura (inclusive "0" é válido se digitado)
function numAp(n) {
  if (n === undefined || n === null || n === '') return '?';
  const s = String(n).trim();
  return s === '' ? '?' : s;
}

// ── UPLOAD ───────────────────────────────────────────────────
function doUpload(file, uid, barId, pctId, progId) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Nenhum arquivo.')); return; }
    if (!file.type.startsWith('image/')) { reject(new Error('Selecione uma imagem.')); return; }
    if (file.size > 5 * 1024 * 1024) { reject(new Error('Imagem muito grande (máx 5MB).')); return; }
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `aparelhos/${uid}/${Date.now()}.${ext}`;
    const ref  = sRef(storage, path);
    const task = uploadBytesResumable(ref, file);
    const prog = $(progId), bar = $(barId), pct = $(pctId);
    if (prog) prog.classList.remove('hidden');
    task.on('state_changed',
      s => { const p = Math.round(s.bytesTransferred / s.totalBytes * 100); if (bar) bar.style.width = p + '%'; if (pct) pct.textContent = p + '%'; },
      err => { console.error('Upload erro:', err.code, err.message); reject(err); },
      async () => { try { resolve(await getDownloadURL(task.snapshot.ref)); } catch(e) { reject(e); } }
    );
  });
}

// ── AUTH ─────────────────────────────────────────────────────
$('btn-login').addEventListener('click', async () => {
  try { showL(); await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(e) { hideL(); toast('Erro login: ' + e.message, 'e'); }
});

$('btn-logout').addEventListener('click', async () => {
  try { await signOut(auth); } catch(e) { console.error(e); }
});

onAuthStateChanged(auth, async user => {
  if (user) {
    S.user = user; showL();
    try { await initApp(); } catch(e) { console.error(e); toast('Erro: ' + e.message, 'e'); hideL(); }
  } else {
    S.user = null; S.ud = null; show('login'); hideL();
  }
});

// ── INIT ─────────────────────────────────────────────────────
async function initApp() {
  const uid   = S.user.uid;
  const name  = (S.user.displayName || 'Atleta').split(' ')[0];
  const photo = S.user.photoURL || '';

  ['uav','pav'].forEach(id => { const el = $(id); if (el) { el.src = photo; el.onerror = () => el.style.display = 'none'; } });
  $('unm').textContent = name;
  $('ci-name').textContent = name;
  $('ci-time').textContent = greet();
  $('pnm').textContent = S.user.displayName || 'Atleta';
  $('pem').textContent = S.user.email || '';

  const uRef = doc(db, 'usuarios', uid);
  const snap = await getDoc(uRef);
  if (!snap.exists()) {
    await setDoc(uRef, { usuario_id: uid, contador_treinos: 0 });
    S.ud = { usuario_id: uid, contador_treinos: 0 };
  } else {
    S.ud = snap.data();
  }

  atualizaStats();
  await carregaAps();
  carregaDescTreinos();

  try {
    const hs = await getDocs(query(collection(db, 'historico_treinos'), where('usuario_id', '==', uid)));
    if (!hs.empty) {
      const sorted = hs.docs.sort((a, b) => (b.data().data?.toMillis?.() ?? 0) - (a.data().data?.toMillis?.() ?? 0));
      $('st-ult').textContent = fmtDate(sorted[0].data().data);
    }
  } catch(_) {}

  const ct = S.ud.contador_treinos ?? 0;
  if (ct >= 30) { showModal30(); hideL(); return; }

  // Restaura check-in salvo (persiste entre troca de abas/refresh)
  const savedCI = sessionStorage.getItem('gymos_checkin');
  if (savedCI) {
    try {
      const ci = JSON.parse(savedCI);
      S.checkinOk = true;
      S.ciTime    = new Date(ci.time);
      S.ciCoords  = ci.coords;
      // Atualiza UI do checkin
      $('ci-ico').textContent = '✅';
      $('ci-ring').style.borderColor = 'rgba(0,229,201,.4)';
      $('ci-tit').textContent = 'Check-in realizado!';
      $('ci-sub').textContent = `Entrada: ${fmtHora(S.ciTime)} · ±${S.ciCoords.acc}m`;
      $('btn-refazer').style.display = 'flex';
      $('btn-checkin').style.display = 'none';
      S.activeTab = 'treino';
      show('sel');
      hideL();
      return;
    } catch(_) { sessionStorage.removeItem('gymos_checkin'); }
  }

  S.activeTab = 'treino';
  show('checkin');
  hideL();
}

function atualizaStats() {
  const ct  = S.ud?.contador_treinos ?? 0;
  const pct = Math.min((ct / 30) * 100, 100);
  $('st-ct').textContent  = ct;
  $('p-tot').textContent  = ct;
  $('st-pf').style.width  = pct + '%';
  $('st-pl').textContent  = `${ct} / 30`;
}

// ── MODAL 30 ─────────────────────────────────────────────────
function showModal30() {
  $('m30').classList.remove('hidden');
  SCRS.forEach(n => { const el = $(`s-${n}`); if (el) el.classList.add('hidden'); });
  $('bnav').classList.add('hidden');
}

$('btn-zerar').addEventListener('click', async () => {
  showL();
  try {
    await updateDoc(doc(db, 'usuarios', S.user.uid), { contador_treinos: 0 });
    S.ud.contador_treinos = 0;
    atualizaStats();
    $('m30').classList.add('hidden');
    toast('Contador zerado! 💪');
    S.activeTab = 'treino';
    show('checkin');
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
  hideL();
});

// ── CHECK-IN ─────────────────────────────────────────────────
function doCheckin() {
  if (!navigator.geolocation) { toast('GPS indisponível.', 'e'); return; }
  const btn = $('btn-checkin');
  btn.disabled = true;
  btn.textContent = '📡 Localizando...';

  navigator.geolocation.getCurrentPosition(
    pos => {
      S.checkinOk  = true;
      S.ciTime     = new Date();
      S.ciCoords   = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
      // Persiste no sessionStorage para sobreviver a troca de abas
      sessionStorage.setItem('gymos_checkin', JSON.stringify({ time: S.ciTime.toISOString(), coords: S.ciCoords }));
      btn.disabled = false;
      btn.textContent = '📍 Fazer Check-in';
      $('ci-ico').textContent   = '✅';
      $('ci-ring').style.borderColor = 'rgba(0,229,201,.4)';
      $('ci-tit').textContent   = 'Check-in realizado!';
      $('ci-sub').textContent   = `Entrada: ${fmtHora(S.ciTime)} · ±${S.ciCoords.acc}m`;
      $('btn-refazer').style.display = 'flex';
      btn.style.display = 'none';
      toast(`✅ Check-in OK! ±${S.ciCoords.acc}m`);
      setTimeout(() => { S.activeTab = 'treino'; show('sel'); }, 1000);
    },
    err => {
      btn.disabled = false;
      btn.textContent = '📍 Fazer Check-in';
      const msgs = { 1:'Permissão negada. Ative o GPS.', 2:'GPS indisponível.', 3:'Tempo esgotado.' };
      toast(msgs[err.code] || 'Erro de GPS.', 'e');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

$('btn-checkin').addEventListener('click', doCheckin);

$('btn-refazer').addEventListener('click', () => {
  S.checkinOk = false; S.ciTime = null; S.ciCoords = null;
  $('ci-ico').textContent = '📍';
  $('ci-ring').style.borderColor = '';
  $('ci-tit').textContent = 'Pronto para treinar?';
  $('ci-sub').textContent = 'Confirme sua localização para fazer o check-in.';
  $('btn-refazer').style.display = 'none';
  $('btn-checkin').style.display = 'flex';
  doCheckin();
});

$('btn-ir-ci').addEventListener('click', () => { S.checkinOk = false; S.activeTab = 'treino'; show('checkin'); });

// ── CHECK-OUT ────────────────────────────────────────────────
function abreCheckout() {
  $('co-h-ent').textContent = fmtHora(S.ciTime);
  $('co-l-ent').textContent = fmtCoord(S.ciCoords);
  $('co-h-sai').textContent = '📡 Obtendo GPS...';
  $('co-l-sai').textContent = 'Aguarde...';
  $('co-dur').textContent   = '—';
  $('btn-conf-co').disabled = true;
  $('m-checkout').classList.remove('hidden');

  navigator.geolocation?.getCurrentPosition(
    pos => {
      const saida = new Date();
      S.coCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
      $('co-h-sai').textContent = fmtHora(saida);
      $('co-l-sai').textContent = fmtCoord(S.coCoords);
      $('co-dur').textContent   = S.ciTime ? fmtDur(saida - S.ciTime) : '—';
      $('btn-conf-co').disabled = false;
    },
    () => {
      const saida = new Date();
      $('co-h-sai').textContent = fmtHora(saida);
      $('co-l-sai').textContent = 'GPS indisponível';
      if (S.ciTime) $('co-dur').textContent = fmtDur(saida - S.ciTime);
      $('btn-conf-co').disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

['btn-co-sel','btn-co-exec'].forEach(id => { const el = $(id); if (el) el.addEventListener('click', abreCheckout); });
$('btn-cancel-co').addEventListener('click', () => $('m-checkout').classList.add('hidden'));

$('btn-conf-co').addEventListener('click', async () => {
  showL();
  try {
    const saida = new Date(), uid = S.user.uid;
    await addDoc(collection(db, 'historico_treinos'), {
      usuario_id: uid, data: serverTimestamp(), tipo_treino: '🚪 Check-out',
      cardio: { aparelho: '', minutos: 0 }, forca: [],
      checkin:  { horario: S.ciTime?.toISOString() ?? null, lat: S.ciCoords?.lat ?? null, lng: S.ciCoords?.lng ?? null, precisao: S.ciCoords?.acc ?? null },
      checkout: { horario: saida.toISOString(), lat: S.coCoords?.lat ?? null, lng: S.coCoords?.lng ?? null, precisao: S.coCoords?.acc ?? null },
      duracao_minutos: S.ciTime ? Math.round((saida - S.ciTime) / 60000) : null
    });
    $('m-checkout').classList.add('hidden');
    S.checkinOk = false; S.ciTime = null; S.ciCoords = null; S.coCoords = null;
    sessionStorage.removeItem('gymos_checkin');
    toast('🏁 Checkout registrado! Bom descanso! 💪');
    setTimeout(() => { S.activeTab = 'treino'; show('checkin'); }, 1200);
  } catch(e) { toast('Erro checkout: ' + e.message, 'e'); }
  hideL();
});

// ── SELEÇÃO ──────────────────────────────────────────────────
async function carregaDescTreinos() {
  try {
    const snap = await getDocs(query(collection(db, 'treinos_base'), where('usuario_id', '==', S.user.uid)));
    ['A','B','C'].forEach(t => {
      const el = $(`td-${t}`); if (!el) return;
      const d  = snap.docs.find(d => d.data().nome === `Treino ${t}`);
      const exs = d ? d.data().exercicios || [] : [];
      // Conta só exercícios reais (com nome)
      const count = exs.filter(e => e.nome).length;
      el.textContent = count ? `${count} exercício${count > 1 ? 's' : ''}` : 'Sem exercícios — monte na aba Montar';
    });
  } catch(e) { console.error(e); }
}

$$('.tc').forEach(card => {
  card.addEventListener('click',   () => selTreino(card.dataset.tipo));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selTreino(card.dataset.tipo); });
});

async function selTreino(tipo) {
  S.tipoSel = tipo; showL();
  try {
    const snap = await getDocs(query(collection(db, 'treinos_base'), where('usuario_id', '==', S.user.uid), where('nome', '==', `Treino ${tipo}`)));
    if (snap.empty) {
      S.treinoAtual = { nome: `Treino ${tipo}`, exercicios: [] };
    } else {
      const data = snap.docs[0].data();
      // Sincroniza número e foto com aparelhos atualizados
      const exs = (data.exercicios || []).map(ex => {
        if (ex.aparelho_id) {
          const ap = S.aps.find(a => a.id === ex.aparelho_id);
          if (ap) {
            return {
              ...ex,
              numero_aparelho: ap.numero_aparelho,
              url_foto: ap.url_foto || ex.url_foto,
              video_url: ap.video_url || ex.video_url,
            };
          }
        }
        return ex;
      });
      S.treinoAtual = { ...data, exercicios: exs };
    }
    renderExec(); startTimer(); S.activeTab = 'treino'; show('exec');
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
  hideL();
}

// ── EXECUÇÃO ─────────────────────────────────────────────────
function startTimer() {
  S.timerS = 0; clearInterval(S.timerIv);
  S.timerIv = setInterval(() => {
    S.timerS++;
    const m = String(Math.floor(S.timerS / 60)).padStart(2,'0');
    const s = String(S.timerS % 60).padStart(2,'0');
    const el = $('ex-timer'); if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() { clearInterval(S.timerIv); }

function renderExec() {
  $('ex-tit').textContent = `Treino ${S.tipoSel}`;
  const list = $('ex-list'); list.innerHTML = '';
  const exs  = S.treinoAtual?.exercicios || [];
  $('ex-ct').textContent = `${exs.length} exercício${exs.length !== 1 ? 's' : ''}`;
  // Reset controle de séries concluídas
  S.seriesDone = {};
  // Inicia cronômetro regressivo do cardio ao mudar os minutos
  setupCardioCronometro();

  if (!exs.length) {
    list.innerHTML = `<div class="empty"><span class="empty-ico">📋</span><p class="empty-tit">Treino vazio</p><p class="empty-txt">Monte na aba <strong style="color:var(--acc)">Montar</strong> primeiro.</p></div>`;
    return;
  }

  exs.forEach((ex, i) => {
    const thumb  = ex.url_foto || (ex.video_url ? `https://img.youtube.com/vi/${ytId(ex.video_url) || ''}/hqdefault.jpg` : FB);
    const series = ex.series_meta || 3;
    S.seriesDone[i] = 0;
    const card  = document.createElement('div');
    card.className     = 'exc';
    card.dataset.index = i;

    // Gera botões de série
    let seriesBtns = '';
    for (let s = 1; s <= series; s++) {
      seriesBtns += `<button class="serie-btn" data-ex="${i}" data-serie="${s}">Série ${s}</button>`;
    }

    card.innerHTML = `
      <div class="ex-top">
        <img class="ex-thumb" src="${thumb}" alt="${ex.nome}" onerror="this.src='${FB}'" style="cursor:${ex.video_url ? 'pointer' : 'default'}">
        <div class="ex-nbadge"><span class="ex-n">${numAp(ex.numero_aparelho)}</span></div>
        <div class="ex-info">
          <div class="ex-nm">${ex.nome}</div>
          <div class="ex-mt">${series}x${ex.reps_meta || 12} reps · meta</div>
          ${ex.video_url ? '<div class="ex-vbadge">🎬 Ver tutorial</div>' : ''}
        </div>
      </div>
      <div class="ex-series-row">${seriesBtns}</div>
      <div class="ex-ins">
        <div class="ex-ic"><span class="fl">Carga (kg)</span><input type="number" class="inp-carga" placeholder="0" min="0" step="0.5" inputmode="decimal"></div>
        <div class="ex-ic"><span class="fl">Reps feitas</span><input type="number" class="inp-reps" placeholder="${ex.reps_meta || 12}" min="0" inputmode="numeric"></div>
      </div>`;

    // Clique nas séries — marca como feita e inicia descanso
    card.querySelectorAll('.serie-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('done')) return;
        btn.classList.add('done');
        btn.textContent = '✓ ' + btn.textContent.replace('✓ ', '');
        S.seriesDone[i] = (S.seriesDone[i] || 0) + 1;
        const total = ex.series_meta || 3;
        // Marca exercício como concluído
        if (S.seriesDone[i] >= total) {
          card.classList.add('ex-concluido');
        }
        // Inicia descanso de 45 segundos (exceto na última série do último exercício)
        const isLastEx    = i === exs.length - 1;
        const isLastSerie = S.seriesDone[i] >= total;
        if (!(isLastEx && isLastSerie)) {
          iniciarDescanso(isLastSerie ? 60 : 45);
        }
      });
    });

    if (ex.video_url) {
      card.querySelector('.ex-thumb').addEventListener('click', () => abreVideo(ex.video_url, ex.nome));
      card.querySelector('.ex-vbadge')?.addEventListener('click', () => abreVideo(ex.video_url, ex.nome));
    }
    list.appendChild(card);
  });
}

// ── DESCANSO ─────────────────────────────────────────────────
let descansoIv = null;
function iniciarDescanso(segundos) {
  clearInterval(descansoIv);
  const overlay = document.createElement('div');
  overlay.id = 'descanso-overlay';
  overlay.innerHTML = `
    <div class="desc-box">
      <div class="desc-label">⏱️ Descanso</div>
      <div class="desc-timer" id="desc-num">${segundos}</div>
      <div class="desc-sub">Próxima série em breve...</div>
      <div class="desc-progress"><div class="desc-progress-fill" id="desc-fill" style="width:100%"></div></div>
      <button class="desc-skip" id="desc-skip">Pular descanso →</button>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));

  const total  = segundos;
  let remaining = segundos;

  descansoIv = setInterval(() => {
    remaining--;
    const numEl  = document.getElementById('desc-num');
    const fillEl = document.getElementById('desc-fill');
    if (numEl)  numEl.textContent = remaining;
    if (fillEl) fillEl.style.width = ((remaining / total) * 100) + '%';
    if (remaining <= 0) { finalizarDescanso(); }
  }, 1000);

  document.getElementById('desc-skip')?.addEventListener('click', finalizarDescanso);
}

function finalizarDescanso() {
  clearInterval(descansoIv);
  const el = document.getElementById('descanso-overlay');
  if (el) { el.classList.remove('active'); setTimeout(() => el.remove(), 400); }
}

// ── CARDIO CRONÔMETRO ────────────────────────────────────────
let cardioIv = null;
function setupCardioCronometro() {
  const minInput = $('crd-min');
  const btn = document.getElementById('btn-cardio-start');
  if (!btn || !minInput) return;

  btn.addEventListener('click', () => {
    const mins = parseInt(minInput.value) || 0;
    if (mins <= 0) { toast('Digite os minutos do cardio.', 'e'); return; }
    clearInterval(cardioIv);
    let remaining = mins * 60;
    const display = document.getElementById('cardio-countdown');
    if (display) { display.style.display = 'flex'; }
    btn.textContent = '⏹ Parar';
    btn.onclick = () => {
      clearInterval(cardioIv);
      if (display) display.style.display = 'none';
      btn.textContent = '▶ Iniciar';
      btn.onclick = null;
      setupCardioCronometro();
    };

    function tick() {
      const m = String(Math.floor(remaining / 60)).padStart(2,'0');
      const s = String(remaining % 60).padStart(2,'0');
      const numEl = document.getElementById('cardio-time-display');
      if (numEl) numEl.textContent = `${m}:${s}`;
      const pct = document.getElementById('cardio-prog-fill');
      if (pct) pct.style.width = ((remaining / (mins * 60)) * 100) + '%';
      if (remaining <= 0) {
        clearInterval(cardioIv);
        if (display) display.style.display = 'none';
        btn.textContent = '▶ Iniciar';
        toast('✅ Cardio concluído! Bom trabalho! 💪');
        btn.onclick = null; setupCardioCronometro();
      }
      remaining--;
    }
    tick();
    cardioIv = setInterval(tick, 1000);
  });
}

function abreVideo(url, nome) {
  const vid = ytId(url); if (!vid) { toast('URL inválida.', 'e'); return; }
  const ov = document.createElement('div');
  ov.className = 'modal'; ov.style.zIndex = '6000'; ov.style.alignItems = 'center';
  ov.innerHTML = `<div style="background:var(--sur);border-radius:20px;padding:18px;width:calc(100% - 32px);max-width:440px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-family:var(--fd);font-size:18px">${nome}</span>
      <button id="xvid" style="width:32px;height:32px;border-radius:50%;background:var(--sur2);border:1px solid var(--bor2);color:var(--txt2);font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer">✕</button>
    </div>
    <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:10px">
      <iframe src="https://www.youtube.com/embed/${vid}?autoplay=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen allow="autoplay"></iframe>
    </div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#xvid').addEventListener('click', () => ov.remove());
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

$('btn-voltar').addEventListener('click', () => { stopTimer(); S.activeTab = 'treino'; show('sel'); });

$('btn-fin').addEventListener('click', async () => {
  stopTimer();
  const uid   = S.user.uid;
  const forca = [];
  $$('.exc').forEach(card => {
    const i  = parseInt(card.dataset.index);
    const ex = S.treinoAtual.exercicios[i];
    forca.push({ nome_aparelho: ex.nome, numero_aparelho: ex.numero_aparelho || '', series: ex.series_meta || 3, reps: parseInt(card.querySelector('.inp-reps').value) || 0, carga: parseFloat(card.querySelector('.inp-carga').value) || 0 });
  });
  showL();
  try {
    await addDoc(collection(db, 'historico_treinos'), { usuario_id: uid, data: serverTimestamp(), tipo_treino: `Treino ${S.tipoSel}`, cardio: { aparelho: $('crd-ap').value, minutos: parseInt($('crd-min').value) || 0 }, forca });
    await updateDoc(doc(db, 'usuarios', uid), { contador_treinos: increment(1) });
    S.ud.contador_treinos = (S.ud.contador_treinos ?? 0) + 1;
    atualizaStats();
    toast('🎉 Treino salvo!');
    if (S.ud.contador_treinos >= 30) setTimeout(showModal30, 900);
    else setTimeout(() => { S.activeTab = 'treino'; show('checkin'); }, 1400);
  } catch(e) { toast('Erro: ' + e.message, 'e'); alert('Erro:\n' + e.message); }
  hideL();
});

// ── MONTAR ───────────────────────────────────────────────────
$$('.mtab').forEach(b => b.addEventListener('click', () => {
  $$('.mtab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  S.mTipo = b.dataset.treino;
  renderMontar();
}));

async function carregaMontar() {
  try {
    const snap = await getDocs(query(collection(db, 'treinos_base'), where('usuario_id', '==', S.user.uid)));
    ['A','B','C'].forEach(t => {
      const d = snap.docs.find(d => d.data().nome === `Treino ${t}`);
      if (d) {
        // Sincroniza número e foto de cada exercício com o aparelho cadastrado
        const exs = (d.data().exercicios || []).map(ex => {
          if (ex.aparelho_id) {
            const ap = S.aps.find(a => a.id === ex.aparelho_id);
            if (ap) {
              return {
                ...ex,
                numero_aparelho: ap.numero_aparelho,
                url_foto: ap.url_foto || ex.url_foto,
                video_url: ap.video_url || ex.video_url,
              };
            }
          }
          return ex;
        });
        S.mExs[t] = exs;
        S.mIds[t] = d.id;
      } else {
        S.mExs[t] = []; S.mIds[t] = null;
      }
    });
    renderMontar();
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
}

function renderMontar() {
  const t   = S.mTipo;
  const exs = S.mExs[t] || [];
  const list = $('mex-list');
  $('mc-let').textContent = t;
  $('mc-nm').textContent  = `Treino ${t}`;
  $('mc-ct').textContent  = `${exs.length} exercício${exs.length !== 1 ? 's' : ''}`;
  list.innerHTML = '';

  if (!exs.length) {
    list.innerHTML = `<div class="tip"><span class="tip-ico">💡</span><span class="tip-txt">Nenhum exercício. Toque em <strong>"Adicionar Exercício"</strong> abaixo.</span></div>`;
    return;
  }

  exs.forEach((ex, i) => {
    const thumb = ex.url_foto || (ex.video_url ? `https://img.youtube.com/vi/${ytId(ex.video_url) || ''}/hqdefault.jpg` : FB);
    const item  = document.createElement('div');
    item.className = 'mex-item';
    item.innerHTML = `
      <img class="mex-thumb" src="${thumb}" alt="${ex.nome}" onerror="this.src='${FB}'">
      <div class="mex-num">${numAp(ex.numero_aparelho)}</div>
      <div class="mex-inf">
        <div class="mex-nm">${ex.nome}</div>
        <div class="mex-mt">${ex.series_meta || 3} séries × ${ex.reps_meta || 12} reps</div>
        ${ex.video_url ? '<div class="mex-vb">🎬 Ver tutorial</div>' : '<div class="mex-novid">Sem vídeo</div>'}
      </div>
      <div class="mex-btns">
        <button class="mex-edit" title="Editar">✏️</button>
        <button class="mex-del" title="Remover">✕</button>
      </div>`;
    const clickVid = () => {
      if (ex.video_url) abreVideo(ex.video_url, ex.nome);
      else toast('Sem vídeo. Edite e adicione um link do YouTube.', 'i');
    };
    item.querySelector('.mex-thumb').addEventListener('click', clickVid);
    item.querySelector('.mex-inf').addEventListener('click', clickVid);
    item.querySelector('.mex-edit').addEventListener('click', e => { e.stopPropagation(); abreEditEx(i); });
    item.querySelector('.mex-del').addEventListener('click',  e => { e.stopPropagation(); if (confirm(`Remover "${ex.nome}"?`)) { S.mExs[S.mTipo].splice(i, 1); renderMontar(); toast('Removido.', 'i'); } });
    list.appendChild(item);
  });
}

function abreEditEx(idx) {
  const ex = S.mExs[S.mTipo][idx]; S.editExIdx = idx;
  $('addex-tit').textContent = 'Editar Exercício';
  $('sel-ap-ex').value = '';
  $('ex-nome').value = ex.nome || '';
  $('ex-num').value  = ex.numero_aparelho || '';
  $('ex-ser').value  = ex.series_meta || 3;
  $('ex-rep').value  = ex.reps_meta || 12;
  $('ex-vid').value  = ex.video_url || '';
  $('m-addex').classList.remove('hidden');
}

$('btn-sav-treino').addEventListener('click', async () => {
  showL();
  try {
    const uid = S.user.uid, t = S.mTipo;
    const data = { usuario_id: uid, nome: `Treino ${t}`, exercicios: S.mExs[t] };
    if (S.mIds[t]) await updateDoc(doc(db, 'treinos_base', S.mIds[t]), data);
    else { const r = await addDoc(collection(db, 'treinos_base'), data); S.mIds[t] = r.id; }
    toast(`✅ Treino ${t} salvo!`); carregaDescTreinos();
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
  hideL();
});

$('btn-addex').addEventListener('click', () => {
  S.editExIdx = null; $('addex-tit').textContent = 'Adicionar Exercício';
  popularSelAp();
  ['sel-ap-ex','ex-nome','ex-num','ex-ser','ex-rep','ex-vid'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  $('m-addex').classList.remove('hidden');
});
$('btn-close-addex').addEventListener('click', () => $('m-addex').classList.add('hidden'));
$('m-addex').addEventListener('click', e => { if (e.target === $('m-addex')) $('m-addex').classList.add('hidden'); });
$('sel-ap-ex').addEventListener('change', e => {
  const ap = S.aps.find(a => a.id === e.target.value);
  if (ap) { $('ex-nome').value = ap.nome; $('ex-num').value = ap.numero_aparelho; if (ap.video_url) $('ex-vid').value = ap.video_url; }
});

function popularSelAp() {
  const sel = $('sel-ap-ex');
  sel.innerHTML = '<option value="">-- Escolha um aparelho --</option>';
  S.aps.forEach(ap => { const o = document.createElement('option'); o.value = ap.id; o.textContent = `#${ap.numero_aparelho} · ${ap.nome}`; sel.appendChild(o); });
}

$('btn-conf-addex').addEventListener('click', () => {
  const nome = $('ex-nome').value.trim();
  if (!nome) { toast('Digite o nome.', 'e'); return; }
  const apId = $('sel-ap-ex').value;
  const ap   = S.aps.find(a => a.id === apId);
  // Prioriza dados do aparelho cadastrado; fallback para manual
  const obj = {
    aparelho_id:     ap?.id || '',
    nome,
    numero_aparelho: ap ? ap.numero_aparelho : $('ex-num').value.trim(),
    url_foto:        ap?.url_foto || '',
    video_url:       ap?.video_url || $('ex-vid').value.trim(),
    series_meta:     parseInt($('ex-ser').value) || 3,
    reps_meta:       parseInt($('ex-rep').value) || 12,
  };
  if (S.editExIdx !== null) { S.mExs[S.mTipo][S.editExIdx] = obj; toast('Atualizado! ✅'); }
  else { S.mExs[S.mTipo].push(obj); toast(`"${nome}" adicionado! 💪`); }
  $('m-addex').classList.add('hidden'); renderMontar();
});

// ── APARELHOS ────────────────────────────────────────────────
let formOpen = false;

$('btn-tog-form').addEventListener('click', () => {
  formOpen = !formOpen;
  $('form-ap-wrap').classList.toggle('hidden', !formOpen);
  $('btn-tog-form').classList.toggle('open', formOpen);
  $('btn-tog-form').textContent = formOpen ? '✕' : '＋';
});

$('btn-cancel-form').addEventListener('click', resetFormAp);

function resetFormAp() {
  formOpen = false;
  $('form-ap-wrap').classList.add('hidden');
  $('btn-tog-form').classList.remove('open');
  $('btn-tog-form').textContent = '＋';
  $('form-ap').reset();
  $('prev-foto').style.display = 'none';
  $('foto-ico').textContent = '📷';
  $('foto-txt').innerHTML = 'Toque para <strong>fotografar</strong>';
  $('foto-prog').classList.add('hidden');
}

$('inp-foto-ap').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  $('prev-foto').src = URL.createObjectURL(f);
  $('prev-foto').style.display = 'block';
  $('foto-ico').textContent = '✅';
  $('foto-txt').innerHTML = `<strong>${f.name}</strong>`;
});

$('form-ap').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('inp-nome-ap').value.trim();
  const num  = $('inp-num-ap').value.trim();
  const vid  = $('inp-vid-ap').value.trim();
  const file = $('inp-foto-ap').files[0];
  if (!nome || !num) { toast('Preencha nome e número.', 'e'); return; }
  const btn = $('btn-subm-ap'); btn.disabled = true; $('subm-lbl').textContent = 'Salvando...'; showL();
  try {
    let url_foto = '';
    if (file) url_foto = await doUpload(file, S.user.uid, 'foto-bar', 'foto-pct', 'foto-prog');
    await addDoc(collection(db, 'aparelhos'), { usuario_id: S.user.uid, nome, numero_aparelho: num, url_foto, video_url: vid });
    resetFormAp(); toast('✅ Aparelho cadastrado!'); await carregaAps();
  } catch(e) { toast('Erro: ' + e.message, 'e'); alert('Erro:\n' + e.message); }
  finally { btn.disabled = false; $('subm-lbl').textContent = 'Salvar'; hideL(); }
});

async function carregaAps() {
  try {
    const snap = await getDocs(query(collection(db, 'aparelhos'), where('usuario_id', '==', S.user.uid)));
    S.aps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $('p-ap').textContent = S.aps.length;
    renderAps(S.aps);
  } catch(e) { console.error(e); }
}

function renderAps(list) {
  const grid = $('ap-grid'); if (!grid) return; grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = `<div class="empty"><span class="empty-ico">🏋️</span><p class="empty-tit">Sem aparelhos</p><p class="empty-txt">Cadastre o primeiro usando o + acima.</p></div>`; return; }
  list.forEach(ap => {
    const item = document.createElement('div'); item.className = 'ap-item';
    const semNum = !ap.numero_aparelho || String(ap.numero_aparelho).trim() === '' || String(ap.numero_aparelho).trim() === '0';
    item.innerHTML = `<img class="ap-img" src="${fotoAp(ap)}" alt="${ap.nome}" onerror="this.src='${FB}'">${ap.video_url ? '<div class="ap-vbadge">🎬</div>' : ''}${semNum ? '<div class="ap-sem-num">✏️ Sem nº</div>' : ''}<div class="ap-inf"><div class="ap-num">#${numAp(ap.numero_aparelho)}</div><div class="ap-nome">${ap.nome}</div></div>`;
    item.addEventListener('click', () => abreModalAp(ap));
    grid.appendChild(item);
  });
}

$('ap-srch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderAps(S.aps.filter(a => a.nome.toLowerCase().includes(q) || a.numero_aparelho.toLowerCase().includes(q)));
});

// Modal aparelho detalhe
function abreModalAp(ap) {
  S.apAtual = ap;
  $('ap-nome-m').textContent = ap.nome;
  $('ap-num-m').textContent  = `#${numAp(ap.numero_aparelho)}`;
  const foto = $('ap-foto-m'); foto.src = fotoAp(ap); foto.style.display = 'block';
  const yt = $('ap-yt'), ph = $('ap-vid-ph');
  yt.innerHTML = ''; yt.classList.add('hidden'); ph.classList.remove('hidden');
  if (ap.video_url) {
    const vid = ytId(ap.video_url);
    if (vid) {
      ph.classList.add('hidden'); yt.classList.remove('hidden');
      yt.innerHTML = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="https://www.youtube.com/embed/${vid}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>`;
    }
  }
  $('m-ap').classList.remove('hidden');
}

$('btn-close-ap').addEventListener('click', () => $('m-ap').classList.add('hidden'));
$('m-ap').addEventListener('click', e => { if (e.target === $('m-ap')) $('m-ap').classList.add('hidden'); });

// Editar aparelho
$('btn-edit-ap').addEventListener('click', () => {
  const ap = S.apAtual;
  $('eap-nome').value = ap.nome; $('eap-num').value = ap.numero_aparelho; $('eap-vid').value = ap.video_url || '';
  $('m-ap').classList.add('hidden'); $('m-edit-ap').classList.remove('hidden');
});
$('btn-close-edit-ap').addEventListener('click',  () => $('m-edit-ap').classList.add('hidden'));
$('btn-cancel-edit-ap').addEventListener('click', () => $('m-edit-ap').classList.add('hidden'));
$('btn-save-edit-ap').addEventListener('click', async () => {
  const nome = $('eap-nome').value.trim(), num = $('eap-num').value.trim(), vid = $('eap-vid').value.trim();
  if (!nome || !num) { toast('Preencha nome e número.', 'e'); return; }
  showL();
  try {
    await updateDoc(doc(db, 'aparelhos', S.apAtual.id), { nome, numero_aparelho: num, video_url: vid });
    Object.assign(S.apAtual, { nome, numero_aparelho: num, video_url: vid });
    $('m-edit-ap').classList.add('hidden'); toast('✅ Atualizado!'); await carregaAps();
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
  hideL();
});

// Vídeo rápido
$('btn-add-vid').addEventListener('click', () => {
  $('m-ap').classList.add('hidden');
  $('eap-nome').value = S.apAtual.nome; $('eap-num').value = S.apAtual.numero_aparelho; $('eap-vid').value = S.apAtual.video_url || '';
  $('m-edit-ap').classList.remove('hidden');
  setTimeout(() => $('eap-vid').focus(), 300);
});

// Trocar foto
$('btn-troca-foto').addEventListener('click', () => {
  $('m-ap').classList.add('hidden');
  $('nova-prev').style.display = 'none';
  $('nova-ico').textContent = '📷';
  $('nova-txt').innerHTML = 'Toque para <strong>fotografar</strong>';
  $('nova-prog').classList.add('hidden');
  $('inp-nova-foto').value = '';
  $('m-troca-foto').classList.remove('hidden');
});
$('btn-close-troca').addEventListener('click',  () => $('m-troca-foto').classList.add('hidden'));
$('btn-cancel-troca').addEventListener('click', () => $('m-troca-foto').classList.add('hidden'));
$('inp-nova-foto').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  $('nova-prev').src = URL.createObjectURL(f);
  $('nova-prev').style.display = 'block';
  $('nova-ico').textContent = '✅';
  $('nova-txt').innerHTML = `<strong>${f.name}</strong>`;
});
$('btn-conf-troca').addEventListener('click', async () => {
  const file = $('inp-nova-foto').files[0];
  if (!file)     { toast('Selecione uma foto.', 'e'); return; }
  if (!S.apAtual){ toast('Nenhum aparelho.', 'e'); return; }
  const btn = $('btn-conf-troca'); btn.disabled = true; btn.textContent = 'Salvando...'; showL();
  try {
    const url = await doUpload(file, S.user.uid, 'nova-bar', 'nova-pct', 'nova-prog');
    await updateDoc(doc(db, 'aparelhos', S.apAtual.id), { url_foto: url });
    S.apAtual.url_foto = url;
    $('m-troca-foto').classList.add('hidden');
    $('inp-nova-foto').value = '';
    toast('✅ Foto atualizada!'); await carregaAps();
  } catch(e) {
    const msg = e.code === 'storage/unauthorized' ? 'Sem permissão no Storage. Verifique as regras do Firebase.' : e.message;
    toast('Erro: ' + msg, 'e'); alert('Erro ao salvar foto:\n' + msg);
  } finally { btn.disabled = false; btn.textContent = 'Salvar Foto'; hideL(); }
});

// Deletar aparelho
$('btn-del-ap').addEventListener('click', async () => {
  if (!confirm(`Excluir "${S.apAtual.nome}"?`)) return;
  showL();
  try {
    await deleteDoc(doc(db, 'aparelhos', S.apAtual.id));
    $('m-ap').classList.add('hidden');
    toast('Aparelho excluído.', 'i'); await carregaAps();
  } catch(e) { toast('Erro: ' + e.message, 'e'); }
  hideL();
});

// ── RELATÓRIO ────────────────────────────────────────────────
async function carregaRel() {
  const uid = S.user.uid;
  try {
    const snap = await getDocs(query(collection(db, 'historico_treinos'), where('usuario_id', '==', uid)));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                         .sort((a, b) => (b.data?.toMillis?.() ?? 0) - (a.data?.toMillis?.() ?? 0));
    const now  = new Date(), sem7 = 7 * 24 * 60 * 60 * 1000;
    const isSem = d => { const dt = d.data?.toDate?.(); return dt && (now - dt) < sem7; };
    const isMes = d => { const dt = d.data?.toDate?.(); return dt && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear(); };

    $('rel-tot').textContent = docs.length;
    $('rel-sem').textContent = docs.filter(isSem).length;
    $('rel-mes').textContent = docs.filter(isMes).length;

    // Frequência
    const freq = {}; docs.forEach(d => { const t = d.tipo_treino || '?'; freq[t] = (freq[t] || 0) + 1; });
    const fw = $('rel-freq'); fw.innerHTML = '';
    Object.entries(freq).sort((a, b) => b[1] - a[1]).forEach(([tipo, n]) => {
      const pct  = docs.length ? Math.round((n / docs.length) * 100) : 0;
      const item = document.createElement('div'); item.className = 'freq-item';
      item.innerHTML = `<div class="freq-lbl"><span class="freq-tipo">${tipo}</span><span class="freq-n">${n}x</span></div><div class="freq-bw"><div class="freq-bf" style="width:${pct}%"></div></div>`;
      fw.appendChild(item);
    });
    if (!Object.keys(freq).length) fw.innerHTML = '<p style="color:var(--txt3);font-size:13px">Nenhum treino ainda.</p>';

    // Calendário
    const cg = $('cal-grid'); cg.innerHTML = '';
    const diasT = new Set(docs.map(d => { const dt = d.data?.toDate?.(); return dt ? dt.toLocaleDateString('pt-BR') : null; }).filter(Boolean));
    const hoje  = new Date(); hoje.setHours(0,0,0,0);
    const ini   = new Date(hoje); ini.setDate(ini.getDate() - 34);
    const dw    = ini.getDay();
    for (let i = 0; i < dw; i++) { const b = document.createElement('div'); b.className = 'cal-d em'; cg.appendChild(b); }
    for (let i = 0; i <= 34; i++) {
      const d    = new Date(ini); d.setDate(d.getDate() + i);
      const str  = d.toLocaleDateString('pt-BR');
      const cell = document.createElement('div');
      cell.className = `cal-d${diasT.has(str) ? ' ct' : ''}${d.getTime() === hoje.getTime() ? ' hj' : ''}`;
      cell.textContent = d.getDate(); cell.title = str + (diasT.has(str) ? ' — Treinou' : '');
      cg.appendChild(cell);
    }

    // Histórico
    const hl = $('hist-list'); hl.innerHTML = '';
    if (!docs.length) { hl.innerHTML = `<div class="empty"><span class="empty-ico">📊</span><p class="empty-tit">Sem histórico</p><p class="empty-txt">Complete seu primeiro treino!</p></div>`; return; }
    docs.slice(0, 30).forEach(h => {
      const card = document.createElement('div'); card.className = 'hcard';
      const tags = [];
      if (h.cardio?.minutos > 0) tags.push(`<span class="htag co">❤️ ${h.cardio.aparelho} · ${h.cardio.minutos}min</span>`);
      (h.forca || []).forEach(ex => { if (ex.carga > 0 || ex.reps > 0) tags.push(`<span class="htag">${ex.nome_aparelho} · ${ex.carga}kg × ${ex.reps} reps</span>`); });
      let extra = '';
      if (h.tipo_treino === '🚪 Check-out' && h.checkin && h.checkout) {
        const ent = h.checkin.horario  ? new Date(h.checkin.horario).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
        const sai = h.checkout.horario ? new Date(h.checkout.horario).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
        const dur = h.duracao_minutos != null ? (h.duracao_minutos >= 60 ? `${Math.floor(h.duracao_minutos/60)}h ${h.duracao_minutos%60}min` : `${h.duracao_minutos} min`) : '—';
        extra = `<div class="co-detail">
          <div class="co-row"><span>🕐 Entrada</span><strong>${ent}</strong></div>
          <div class="co-row"><span>🕐 Saída</span><strong>${sai}</strong></div>
          <div class="co-row"><span>⏱️ Duração</span><strong class="co-dur-v">${dur}</strong></div>
          ${h.checkin.lat  ? `<div class="co-row"><span>📍 Entrada</span><a class="co-map" href="https://maps.google.com/?q=${h.checkin.lat},${h.checkin.lng}" target="_blank">Ver no mapa</a></div>` : ''}
          ${h.checkout.lat ? `<div class="co-row"><span>📍 Saída</span><a class="co-map" href="https://maps.google.com/?q=${h.checkout.lat},${h.checkout.lng}" target="_blank">Ver no mapa</a></div>` : ''}
        </div>`;
      }
      card.innerHTML = `<div class="hcard-hd"><span class="hcard-tipo">${h.tipo_treino}</span><span class="hcard-dt">${fmtDate(h.data)}</span></div>${extra}<div class="hcard-tags">${tags.join('') || (!extra ? '<span class="htag">Treino registrado</span>' : '')}</div>`;
      hl.appendChild(card);
    });
  } catch(e) { console.error(e); toast('Erro relatório.', 'e'); }
}

// ── BOTTOM NAV ───────────────────────────────────────────────
$$('.ni').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    S.activeTab = tab;
    $$('.ni').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if      (tab === 'treino')    { show(S.checkinOk ? 'sel' : 'checkin'); }
    else if (tab === 'montar')    { show('montar');  showL(); await carregaMontar(); hideL(); }
    else if (tab === 'aparelhos') { show('ap');      showL(); await carregaAps();   hideL(); }
    else if (tab === 'relatorio') { show('rel');     showL(); await carregaRel();   hideL(); }
    else if (tab === 'perfil')    { show('perfil'); }
  });
});
