// ═══════════════════════════════════════════════════════════
// app.js — GymOS PWA
// Firebase SDK v10 Modular | Vanilla JS ES6+
// ═══════════════════════════════════════════════════════════

import { auth, db, storage } from './firebase-config.js';

import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import {
  doc, getDoc, setDoc, addDoc, getDocs, collection,
  query, where, updateDoc, increment, serverTimestamp,
  orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import {
  ref as sRef, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const S = {
  user:          null,
  userData:      null,
  tipoSel:       null,
  treinoAtual:   null,
  aparelhos:     [],
  checkinOk:     false,
  activeTab:     'treino',
  timerInterval: null,
  timerSecs:     0,
};

// ═══════════════════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const SCREENS = ['login','checkin','selecao','execucao','aparelhos','historico','perfil'];

function showScreen(name) {
  SCREENS.forEach(n => {
    const el = $(`screen-${n}`);
    if (el) el.classList.toggle('hidden', n !== name);
  });
  const hasNav = name !== 'login';
  $('bottom-nav').classList.toggle('hidden', !hasNav);
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === S.activeTab));
}

let toastTimer;
function toast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

function showLoader() { $('global-loader').classList.remove('hidden'); }
function hideLoader() { $('global-loader').classList.add('hidden'); }

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = (ts.toDate ? ts.toDate() : new Date(ts));
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ═══════════════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════════════
function startTimer() {
  S.timerSecs = 0;
  clearInterval(S.timerInterval);
  S.timerInterval = setInterval(() => {
    S.timerSecs++;
    const m = String(Math.floor(S.timerSecs / 60)).padStart(2, '0');
    const s = String(S.timerSecs % 60).padStart(2, '0');
    const el = $('exec-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() { clearInterval(S.timerInterval); }

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
$('btn-google-login').addEventListener('click', async () => {
  try {
    showLoader();
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    hideLoader();
    console.error('Login:', err);
    toast('Erro ao fazer login: ' + err.message, 'error');
  }
});

$('btn-logout').addEventListener('click', async () => {
  try { await signOut(auth); } catch (err) { console.error(err); }
});

onAuthStateChanged(auth, async user => {
  if (user) {
    S.user = user;
    showLoader();
    try { await initApp(); } catch(e) { console.error(e); toast('Erro ao inicializar: ' + e.message, 'error'); }
    hideLoader();
  } else {
    S.user = null; S.userData = null;
    showScreen('login');
    hideLoader();
  }
});

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
async function initApp() {
  const uid  = S.user.uid;
  const name = (S.user.displayName || 'Atleta').split(' ')[0];
  const photo = S.user.photoURL || '';

  // Avatar e nomes
  ['user-avatar','perfil-avatar'].forEach(id => { const el=$(id); if(el){ el.src=photo; el.onerror=()=>el.style.display='none'; }});
  ['user-name'].forEach(id => { const el=$(id); if(el) el.textContent = name; });
  $('greeting-name').textContent = name;
  $('greeting-time').textContent = greetingText();
  $('perfil-name').textContent   = S.user.displayName || 'Atleta';
  $('perfil-email').textContent  = S.user.email || '';

  // Documento do usuário
  const uRef = doc(db, 'usuarios', uid);
  const snap = await getDoc(uRef);
  if (!snap.exists()) {
    await setDoc(uRef, { usuario_id: uid, contador_treinos: 0 });
    S.userData = { usuario_id: uid, contador_treinos: 0 };
  } else {
    S.userData = snap.data();
  }

  // Stats
  const ct = S.userData.contador_treinos ?? 0;
  $('stat-treinos').textContent   = ct;
  $('perfil-total-treinos').textContent = ct;
  const pct = Math.min((ct / 30) * 100, 100);
  $('stat-progress-fill').style.width = pct + '%';
  $('stat-progress-label').textContent = `${ct} / 30`;

  // Último treino
  try {
    const hq = query(
      collection(db, 'historico_treinos'),
      where('usuario_id','==', uid),
      orderBy('data','desc'), limit(1)
    );
    const hsnap = await getDocs(hq);
    if (!hsnap.empty) {
      const d = hsnap.docs[0].data().data;
      $('stat-ultima').textContent = fmtDate(d);
    }
  } catch(_) {}

  // Modal 30 treinos
  if (ct >= 30) { showModal30(); return; }

  S.activeTab = 'treino';
  showScreen('checkin');
}

// ═══════════════════════════════════════════════════════════
// MODAL 30 TREINOS
// ═══════════════════════════════════════════════════════════
function showModal30() {
  $('modal-overlay').classList.remove('hidden');
  SCREENS.forEach(n => { const el=$(`screen-${n}`); if(el) el.classList.add('hidden'); });
  $('bottom-nav').classList.add('hidden');
}

$('btn-zerar-contador').addEventListener('click', async () => {
  try {
    showLoader();
    await updateDoc(doc(db, 'usuarios', S.user.uid), { contador_treinos: 0 });
    S.userData.contador_treinos = 0;
    $('stat-treinos').textContent = 0;
    $('stat-progress-fill').style.width = '0%';
    $('stat-progress-label').textContent = '0 / 30';
    $('modal-overlay').classList.add('hidden');
    hideLoader();
    toast('Contador zerado! Hora de novos estímulos 💪');
    S.activeTab = 'treino';
    showScreen('checkin');
  } catch(err) {
    hideLoader();
    console.error(err);
    toast('Erro ao zerar contador.', 'error');
  }
});

// ═══════════════════════════════════════════════════════════
// TELA 1 — CHECK-IN
// ═══════════════════════════════════════════════════════════
$('btn-checkin').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('Geolocalização indisponível neste dispositivo.', 'error');
    return;
  }
  const btn = $('btn-checkin');
  btn.disabled = true;
  btn.innerHTML = `<span>📍</span> Localizando...`;

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { accuracy } = pos.coords;
      S.checkinOk = true;
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Fazer Check-in`;
      toast(`✅ Check-in OK! ±${Math.round(accuracy)}m`);
      S.activeTab = 'treino';
      showScreen('selecao');
    },
    err => {
      btn.disabled = false;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Fazer Check-in`;
      const msgs = { 1:'Permissão negada. Ative o GPS.', 2:'Posição indisponível.', 3:'Tempo esgotado.' };
      const msg = msgs[err.code] || 'Erro de geolocalização.';
      console.error('Geo:', err);
      toast(msg, 'error');
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
});

// ═══════════════════════════════════════════════════════════
// TELA 2 — SELEÇÃO
// ═══════════════════════════════════════════════════════════
$$('.treino-card').forEach(card => {
  card.addEventListener('click', () => selecionarTreino(card.dataset.tipo));
  card.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' ') selecionarTreino(card.dataset.tipo); });
});

async function selecionarTreino(tipo) {
  S.tipoSel = tipo;
  showLoader();
  try {
    const uid = S.user.uid;
    const q   = query(
      collection(db, 'treinos_base'),
      where('usuario_id','==', uid),
      where('nome','==', `Treino ${tipo}`)
    );
    const snap = await getDocs(q);
    S.treinoAtual = snap.empty
      ? { nome: `Treino ${tipo}`, exercicios: [] }
      : snap.docs[0].data();

    renderExecucao();
    startTimer();
    S.activeTab = 'treino';
    showScreen('execucao');
  } catch(err) {
    console.error(err);
    toast('Erro ao carregar treino: ' + err.message, 'error');
  }
  hideLoader();
}

// ═══════════════════════════════════════════════════════════
// TELA 3 — EXECUÇÃO
// ═══════════════════════════════════════════════════════════
function renderExecucao() {
  $('exec-title').textContent = `Treino ${S.tipoSel}`;
  const list = $('exercicio-list');
  list.innerHTML = '';
  const exs = S.treinoAtual?.exercicios || [];
  $('ex-counter').textContent = `${exs.length} exercício${exs.length !== 1 ? 's' : ''}`;

  if (!exs.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">📋</span>
      <p class="empty-title">Treino vazio</p>
      <p class="empty-text">Nenhum exercício cadastrado ainda. Adicione aparelhos na aba Aparelhos.</p>
    </div>`;
    return;
  }

  exs.forEach((ex, i) => {
    const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="#1b1f2c" width="64" height="64"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="28" fill="#c9ff00">🏋️</text></svg>`)}`;
    const card = document.createElement('div');
    card.className = 'exercicio-card';
    card.dataset.index = i;
    card.innerHTML = `
      <div class="ex-top">
        <img class="ex-thumb" src="${ex.url_foto || fallback}" alt="${ex.nome}"
             onerror="this.src='${fallback}'">
        <div class="ex-num-badge"><span class="ex-num">${ex.numero_aparelho || '—'}</span></div>
        <div class="ex-info">
          <div class="ex-name">${ex.nome}</div>
          <div class="ex-meta">${ex.series_meta || '3'}x${ex.reps_meta || '12'} reps · meta</div>
        </div>
      </div>
      <div class="ex-inputs">
        <div class="ex-input-cell">
          <span class="field-label">Carga (kg)</span>
          <input type="number" class="input-carga" placeholder="0" min="0" step="0.5" inputmode="decimal">
        </div>
        <div class="ex-input-cell">
          <span class="field-label">Reps realizadas</span>
          <input type="number" class="input-reps" placeholder="${ex.reps_meta || '12'}" min="0" inputmode="numeric">
        </div>
      </div>`;
    list.appendChild(card);
  });
}

$('btn-voltar').addEventListener('click', () => {
  stopTimer();
  S.activeTab = 'treino';
  showScreen('selecao');
});

$('btn-finalizar').addEventListener('click', finalizarTreino);

async function finalizarTreino() {
  stopTimer();
  const uid = S.user.uid;

  // Cardio
  const cardioAp  = $('cardio-aparelho').value;
  const cardioMin = parseInt($('cardio-min').value) || 0;

  // Força
  const forca = [];
  $$('.exercicio-card').forEach(card => {
    const i  = parseInt(card.dataset.index);
    const ex = S.treinoAtual.exercicios[i];
    forca.push({
      nome_aparelho:   ex.nome,
      numero_aparelho: ex.numero_aparelho || '',
      series:          ex.series_meta || 3,
      reps:            parseInt(card.querySelector('.input-reps').value) || 0,
      carga:           parseFloat(card.querySelector('.input-carga').value) || 0,
    });
  });

  showLoader();
  try {
    await addDoc(collection(db, 'historico_treinos'), {
      usuario_id:  uid,
      data:        serverTimestamp(),
      tipo_treino: `Treino ${S.tipoSel}`,
      cardio:      { aparelho: cardioAp, minutos: cardioMin },
      forca,
    });

    await updateDoc(doc(db, 'usuarios', uid), { contador_treinos: increment(1) });
    S.userData.contador_treinos = (S.userData.contador_treinos ?? 0) + 1;

    const ct  = S.userData.contador_treinos;
    const pct = Math.min((ct / 30) * 100, 100);
    $('stat-treinos').textContent        = ct;
    $('stat-progress-fill').style.width  = pct + '%';
    $('stat-progress-label').textContent = `${ct} / 30`;
    $('perfil-total-treinos').textContent = ct;

    hideLoader();
    toast('🎉 Treino finalizado e salvo!');

    if (ct >= 30) {
      setTimeout(showModal30, 900);
    } else {
      setTimeout(() => { S.activeTab = 'treino'; showScreen('checkin'); }, 1400);
    }
  } catch(err) {
    hideLoader();
    console.error('finalizar:', err);
    toast('Erro ao salvar treino: ' + err.message, 'error');
    alert('Erro ao salvar treino:\n' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TELA 4 — APARELHOS
// ═══════════════════════════════════════════════════════════
let formOpen = false;

$('btn-toggle-form').addEventListener('click', () => {
  formOpen = !formOpen;
  $('form-aparelho-wrap').classList.toggle('hidden', !formOpen);
  $('btn-toggle-form').classList.toggle('open', formOpen);
});

$('btn-cancel-form').addEventListener('click', () => {
  formOpen = false;
  $('form-aparelho-wrap').classList.add('hidden');
  $('btn-toggle-form').classList.remove('open');
  $('form-aparelho').reset();
  $('preview-foto').style.display = 'none';
  $('upload-icon-label').textContent = '📷';
  $('upload-text-label').innerHTML = 'Toque para <strong>fotografar</strong> o aparelho';
  $('upload-progress-wrap').classList.add('hidden');
});

$('foto-aparelho').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const prev = $('preview-foto');
  prev.src = URL.createObjectURL(file);
  prev.style.display = 'block';
  $('upload-icon-label').textContent = '✅';
  $('upload-text-label').innerHTML = `<strong>${file.name}</strong>`;
});

$('form-aparelho').addEventListener('submit', async e => {
  e.preventDefault();
  const nome   = $('input-nome-aparelho').value.trim();
  const numero = $('input-num-aparelho').value.trim();
  const file   = $('foto-aparelho').files[0];

  if (!nome || !numero) { toast('Preencha nome e número.', 'error'); return; }

  const btn = $('btn-submit-aparelho');
  btn.disabled = true;
  $('submit-label').textContent = 'Salvando...';
  showLoader();

  try {
    const uid = S.user.uid;
    let url_foto = '';

    if (file) url_foto = await uploadFoto(file, uid);

    await addDoc(collection(db, 'aparelhos'), {
      usuario_id: uid, nome, numero_aparelho: numero, url_foto
    });

    $('form-aparelho').reset();
    $('preview-foto').style.display = 'none';
    $('upload-icon-label').textContent = '📷';
    $('upload-text-label').innerHTML = 'Toque para <strong>fotografar</strong> o aparelho';
    $('upload-progress-wrap').classList.add('hidden');
    formOpen = false;
    $('form-aparelho-wrap').classList.add('hidden');
    $('btn-toggle-form').classList.remove('open');

    toast('Aparelho cadastrado! ✅');
    await carregarAparelhos();
  } catch(err) {
    console.error('aparelho:', err);
    toast('Erro ao cadastrar: ' + err.message, 'error');
    alert('Erro:\n' + err.message);
  } finally {
    btn.disabled = false;
    $('submit-label').textContent = 'Salvar Aparelho';
    hideLoader();
  }
});

function uploadFoto(file, uid) {
  return new Promise((resolve, reject) => {
    const name   = `${Date.now()}_${file.name.replace(/[^\w.-]/g,'_')}`;
    const ref    = sRef(storage, `aparelhos/${uid}/${name}`);
    const task   = uploadBytesResumable(ref, file);
    const wrap   = $('upload-progress-wrap');
    const bar    = $('upload-bar');
    const pctEl  = $('upload-percent');
    wrap.classList.remove('hidden');

    task.on('state_changed',
      snap => {
        const p = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        bar.style.width   = p + '%';
        pctEl.textContent = p + '%';
      },
      err  => { console.error('upload:', err); reject(err); },
      async () => { resolve(await getDownloadURL(task.snapshot.ref)); }
    );
  });
}

async function carregarAparelhos() {
  try {
    const uid  = S.user.uid;
    const snap = await getDocs(query(collection(db,'aparelhos'), where('usuario_id','==',uid)));
    S.aparelhos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $('perfil-total-aparelhos').textContent = S.aparelhos.length;
    renderAparelhos(S.aparelhos);
  } catch(err) { console.error('carregarAparelhos:', err); }
}

function renderAparelhos(list) {
  const grid = $('aparelhos-grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🏋️</span>
      <p class="empty-title">Sem aparelhos</p>
      <p class="empty-text">Cadastre o primeiro aparelho usando o botão + acima.</p>
    </div>`;
    return;
  }
  const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect fill="#1b1f2c" width="120" height="90"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="32" fill="#c9ff00">🏋️</text></svg>`)}`;
  list.forEach(ap => {
    const item = document.createElement('div');
    item.className = 'aparelho-item';
    item.innerHTML = `
      <img class="aparelho-img" src="${ap.url_foto || fallback}" alt="${ap.nome}"
           onerror="this.src='${fallback}'">
      <div class="aparelho-info">
        <div class="aparelho-num">#${ap.numero_aparelho}</div>
        <div class="aparelho-nome">${ap.nome}</div>
      </div>`;
    grid.appendChild(item);
  });
}

// Busca local
$('aparelhos-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderAparelhos(S.aparelhos.filter(a =>
    a.nome.toLowerCase().includes(q) || a.numero_aparelho.toLowerCase().includes(q)
  ));
});

// ═══════════════════════════════════════════════════════════
// TELA 5 — HISTÓRICO
// ═══════════════════════════════════════════════════════════
async function carregarHistorico() {
  const list = $('historico-list');
  list.innerHTML = '<p style="color:var(--text3);font-size:14px;padding:20px 0">Carregando...</p>';
  try {
    const uid  = S.user.uid;
    const snap = await getDocs(query(
      collection(db,'historico_treinos'),
      where('usuario_id','==',uid),
      orderBy('data','desc'),
      limit(30)
    ));
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">
        <span class="empty-icon">📊</span>
        <p class="empty-title">Sem histórico</p>
        <p class="empty-text">Complete seu primeiro treino para ver o histórico aqui.</p>
      </div>`;
      return;
    }
    list.innerHTML = '';
    snap.docs.forEach(d => {
      const h    = d.data();
      const card = document.createElement('div');
      card.className = 'historico-card';
      const tags = [];
      if (h.cardio?.minutos > 0)
        tags.push(`<span class="h-tag cardio">❤️ ${h.cardio.aparelho} · ${h.cardio.minutos}min</span>`);
      (h.forca || []).forEach(ex => {
        if (ex.carga > 0 || ex.reps > 0)
          tags.push(`<span class="h-tag">${ex.nome_aparelho} · ${ex.carga}kg × ${ex.reps}</span>`);
      });
      card.innerHTML = `
        <div class="historico-header">
          <span class="historico-tipo">${h.tipo_treino}</span>
          <span class="historico-data">${fmtDate(h.data)}</span>
        </div>
        <div class="historico-tags">${tags.join('') || '<span class="h-tag">Sem detalhes</span>'}</div>`;
      list.appendChild(card);
    });
  } catch(err) {
    console.error('historico:', err);
    list.innerHTML = `<p style="color:var(--red);font-size:14px;padding:20px 0">Erro ao carregar histórico.</p>`;
  }
}

// ═══════════════════════════════════════════════════════════
// BOTTOM NAV
// ═══════════════════════════════════════════════════════════
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    S.activeTab = tab;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'treino') {
      showScreen(S.checkinOk ? 'selecao' : 'checkin');
    } else if (tab === 'historico') {
      showScreen('historico');
      showLoader();
      await carregarHistorico();
      hideLoader();
    } else if (tab === 'aparelhos') {
      showScreen('aparelhos');
      showLoader();
      await carregarAparelhos();
      hideLoader();
    } else if (tab === 'perfil') {
      showScreen('perfil');
    }
  });
});
