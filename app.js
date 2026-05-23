// app.js — GymOS v3 — Completo com edição, deleção, vídeo, relatório
import { auth, db, storage } from './firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc, setDoc, addDoc, getDocs, collection, query, where, updateDoc, increment, serverTimestamp, orderBy, limit, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref as sRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ── STATE ──────────────────────────────────────────────────
const S = {
  user: null, userData: null,
  tipoSel: null, treinoAtual: null,
  aparelhos: [], checkinOk: false,
  activeTab: 'treino', timerInterval: null, timerSecs: 0,
  montarTipo: 'A',
  montarExs: { A:[], B:[], C:[] },
  montarIds: { A:null, B:null, C:null },
  apAtual: null,
  editExIdx: null,
  // Check-in / Check-out
  checkinTime: null,       // Date do check-in
  checkinCoords: null,     // {lat, lng, acc} do check-in
  checkoutCoords: null,    // {lat, lng, acc} do check-out
};

// ── DOM ────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = s  => document.querySelectorAll(s);
const SCREENS = ['login','checkin','selecao','execucao','montar','aparelhos','relatorio','perfil'];
const FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="#1b1f2c" width="64" height="64"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="28" fill="#c9ff00">🏋️</text></svg>')}`;

// Retorna a melhor foto disponível para o aparelho
function fotoAp(ap) {
  if (ap.url_foto) return ap.url_foto;
  if (ap.video_url) {
    const vid = ytId(ap.video_url);
    if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
  }
  return FALLBACK;
}

function showScreen(name) {
  SCREENS.forEach(n => { const el=$(`screen-${n}`); if(el) el.classList.toggle('hidden', n!==name); });
  $('bottom-nav').classList.toggle('hidden', name==='login');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab===S.activeTab));
}

let toastT;
function toast(msg, type='success') {
  const el=$('toast'); el.textContent=msg;
  el.className=`toast toast-${type} visible`;
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('visible'),3200);
}

function showLoader() { $('global-loader').classList.remove('hidden'); }
function hideLoader() { $('global-loader').classList.add('hidden'); }
function fmtDate(ts) { if(!ts) return '—'; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}); }
function greet() { const h=new Date().getHours(); return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'; }
function ytId(url) { const m=url.match(/(?:v=|youtu\.be\/|embed\/)([^&?\/]+)/); return m?m[1]:null; }

// ── AUTH ───────────────────────────────────────────────────
$('btn-google-login').addEventListener('click', async ()=>{ try{ showLoader(); await signInWithPopup(auth,new GoogleAuthProvider()); }catch(e){ hideLoader(); toast('Erro: '+e.message,'error'); }});
$('btn-logout').addEventListener('click', async ()=>{ try{ await signOut(auth); }catch(e){ console.error(e); }});

onAuthStateChanged(auth, async user=>{
  if(user){ S.user=user; showLoader(); try{ await initApp(); }catch(e){ console.error(e); toast('Erro: '+e.message,'error'); hideLoader(); } }
  else{ S.user=null; S.userData=null; showScreen('login'); hideLoader(); }
});

// ── INIT ───────────────────────────────────────────────────
async function initApp() {
  const uid=S.user.uid, name=(S.user.displayName||'Atleta').split(' ')[0], photo=S.user.photoURL||'';
  ['user-avatar','perfil-avatar'].forEach(id=>{ const el=$(id); if(el){el.src=photo; el.onerror=()=>el.style.display='none';}});
  $('user-name').textContent=$('greeting-name').textContent=name;
  $('greeting-time').textContent=greet();
  $('perfil-name').textContent=S.user.displayName||'Atleta';
  $('perfil-email').textContent=S.user.email||'';

  const uRef=doc(db,'usuarios',uid), snap=await getDoc(uRef);
  if(!snap.exists()){ await setDoc(uRef,{usuario_id:uid,contador_treinos:0}); S.userData={usuario_id:uid,contador_treinos:0}; }
  else S.userData=snap.data();

  const ct=S.userData.contador_treinos??0, pct=Math.min((ct/30)*100,100);
  $('stat-treinos').textContent=ct;
  $('stat-progress-fill').style.width=pct+'%';
  $('stat-progress-label').textContent=`${ct} / 30`;
  $('perfil-total-treinos').textContent=ct;

  try{
    const hs=await getDocs(query(collection(db,'historico_treinos'),where('usuario_id','==',uid),limit(50)));
    if(!hs.empty){
      const sorted=hs.docs.sort((a,b)=>(b.data().data?.toMillis?.()??0)-(a.data().data?.toMillis?.()??0));
      $('stat-ultima').textContent=fmtDate(sorted[0].data().data);
    }
  }catch(_){}

  await carregarAparelhos();
  carregarDescricoesTreinos();

  if(ct>=30){ showModal30(); hideLoader(); return; }
  S.activeTab='treino'; showScreen('checkin'); hideLoader();
}

// ── MODAL 30 ───────────────────────────────────────────────
function showModal30(){ $('modal-30').classList.remove('hidden'); SCREENS.forEach(n=>{const el=$(`screen-${n}`);if(el)el.classList.add('hidden');}); $('bottom-nav').classList.add('hidden'); }
$('btn-zerar-contador').addEventListener('click', async ()=>{
  showLoader();
  try{ await updateDoc(doc(db,'usuarios',S.user.uid),{contador_treinos:0}); S.userData.contador_treinos=0; $('stat-treinos').textContent=0; $('stat-progress-fill').style.width='0%'; $('stat-progress-label').textContent='0 / 30'; $('modal-30').classList.add('hidden'); toast('Contador zerado! 💪'); S.activeTab='treino'; showScreen('checkin'); }
  catch(e){ toast('Erro: '+e.message,'error'); }
  hideLoader();
});

// ── CHECK-IN ───────────────────────────────────────────────
function setupCheckin(){
  const btn=$('btn-checkin'), btnR=$('btn-refazer-checkin');
  function doCheckin(){
    if(!navigator.geolocation){ toast('Geolocalização indisponível.','error'); return; }
    btn.disabled=true; btn.innerHTML='📍 Localizando...';
    navigator.geolocation.getCurrentPosition(
      pos=>{
        S.checkinOk=true;
        S.checkinTime=new Date();
        S.checkinCoords={lat:pos.coords.latitude, lng:pos.coords.longitude, acc:Math.round(pos.coords.accuracy)};
        btn.disabled=false; btn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Fazer Check-in';
        toast(`✅ Check-in OK! ±${Math.round(pos.coords.accuracy)}m`);
        $('checkin-icon').textContent='✅';
        $('checkin-ring').style.borderColor='rgba(0,229,201,.4)';
        $('checkin-title').textContent='Check-in realizado!';
        $('checkin-sub').textContent=`Entrada: ${S.checkinTime.toLocaleTimeString('pt-BR')} · ±${S.checkinCoords.acc}m`;
        btn.style.display='none'; btnR.style.display='flex';
        setTimeout(()=>{ S.activeTab='treino'; showScreen('selecao'); }, 1000);
      },
      err=>{
        btn.disabled=false; btn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Fazer Check-in';
        const msgs={1:'Permissão negada. Ative o GPS.',2:'Posição indisponível.',3:'Tempo esgotado.'};
        toast(msgs[err.code]||'Erro de GPS.','error'); alert(msgs[err.code]||'Erro de GPS.');
      },
      {enableHighAccuracy:true,timeout:12000,maximumAge:0}
    );
  }
  btn.addEventListener('click', doCheckin);
  btnR.addEventListener('click', ()=>{ S.checkinOk=false; $('checkin-icon').textContent='📍'; $('checkin-ring').style.borderColor=''; $('checkin-title').textContent='Pronto para treinar?'; $('checkin-sub').textContent='Confirme sua localização para fazer o check-in.'; btn.style.display='flex'; btnR.style.display='none'; doCheckin(); });
}
setupCheckin();

// Botão refazer check-in na tela de seleção
$('btn-ir-checkin').addEventListener('click',()=>{ S.checkinOk=false; S.activeTab='treino'; showScreen('checkin'); });

// ── CHECK-OUT ──────────────────────────────────────────────
function fmtHora(date) { return date ? date.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '—'; }
function fmtDuracao(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}
function fmtCoords(coords) { return coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} (±${coords.acc}m)` : '—'; }

function abrirModalCheckout() {
  // Preenche dados de entrada
  $('co-hora-entrada').textContent = S.checkinTime ? fmtHora(S.checkinTime) : 'Sem check-in';
  $('co-entrada').textContent      = S.checkinCoords ? fmtCoords(S.checkinCoords) : 'Sem localização';
  $('co-saida').textContent        = '📡 Obtendo localização...';
  $('co-hora-saida').textContent   = '—';
  $('co-duracao').textContent      = '—';
  $('btn-confirmar-checkout').disabled = true;
  $('modal-checkout').classList.remove('hidden');

  // Obtém localização de saída
  if (!navigator.geolocation) {
    $('co-saida').textContent = 'GPS indisponível';
    preencherCheckoutSemGPS();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const saida = new Date();
      S.checkoutCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
      $('co-saida').textContent     = fmtCoords(S.checkoutCoords);
      $('co-hora-saida').textContent = fmtHora(saida);
      if (S.checkinTime) {
        $('co-duracao').textContent = fmtDuracao(saida - S.checkinTime);
      }
      $('btn-confirmar-checkout').disabled = false;
    },
    err => { $('co-saida').textContent = 'GPS indisponível'; preencherCheckoutSemGPS(); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function preencherCheckoutSemGPS() {
  const saida = new Date();
  $('co-hora-saida').textContent = fmtHora(saida);
  if (S.checkinTime) $('co-duracao').textContent = fmtDuracao(saida - S.checkinTime);
  $('btn-confirmar-checkout').disabled = false;
}

// Botões checkout nas duas telas
['btn-checkout', 'btn-checkout-exec'].forEach(id => {
  const btn = $(id);
  if (btn) btn.addEventListener('click', abrirModalCheckout);
});

$('btn-cancel-checkout').addEventListener('click', () => $('modal-checkout').classList.add('hidden'));

$('btn-confirmar-checkout').addEventListener('click', async () => {
  showLoader();
  try {
    const saidaTime = new Date();
    const uid = S.user.uid;
    await addDoc(collection(db, 'historico_treinos'), {
      usuario_id:   uid,
      data:         serverTimestamp(),
      tipo_treino:  '🚪 Check-out',
      cardio:       { aparelho: '', minutos: 0 },
      forca:        [],
      checkin: {
        horario:    S.checkinTime ? S.checkinTime.toISOString() : null,
        lat:        S.checkinCoords?.lat ?? null,
        lng:        S.checkinCoords?.lng ?? null,
        precisao:   S.checkinCoords?.acc ?? null,
      },
      checkout: {
        horario:    saidaTime.toISOString(),
        lat:        S.checkoutCoords?.lat ?? null,
        lng:        S.checkoutCoords?.lng ?? null,
        precisao:   S.checkoutCoords?.acc ?? null,
      },
      duracao_minutos: S.checkinTime ? Math.round((saidaTime - S.checkinTime) / 60000) : null,
    });

    $('modal-checkout').classList.add('hidden');
    hideLoader();

    // Reseta estado de check-in
    S.checkinOk = false;
    S.checkinTime = null;
    S.checkinCoords = null;
    S.checkoutCoords = null;

    // Feedback visual
    toast(`🏁 Checkout registrado! Bom descanso, ${(S.user.displayName||'Atleta').split(' ')[0]}! 💪`);
    setTimeout(() => { S.activeTab = 'treino'; showScreen('checkin'); }, 1200);
  } catch(e) {
    hideLoader();
    console.error('checkout:', e);
    toast('Erro ao registrar checkout: ' + e.message, 'error');
  }
});

// ── SELEÇÃO ────────────────────────────────────────────────
async function carregarDescricoesTreinos(){
  try{
    const snap=await getDocs(query(collection(db,'treinos_base'),where('usuario_id','==',S.user.uid)));
    ['A','B','C'].forEach(t=>{
      const el=$(`desc-treino-${t}`); if(!el) return;
      const d=snap.docs.find(d=>d.data().nome===`Treino ${t}`);
      const exs=d?d.data().exercicios||[]:[];
      el.textContent=exs.length?`${exs.length} exercício${exs.length>1?'s':''}`: 'Sem exercícios — monte na aba Montar';
    });
  }catch(e){ console.error(e); }
}

$$('.treino-card').forEach(card=>{
  card.addEventListener('click',()=>selecionarTreino(card.dataset.tipo));
  card.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') selecionarTreino(card.dataset.tipo); });
});

async function selecionarTreino(tipo){
  S.tipoSel=tipo; showLoader();
  try{
    const snap=await getDocs(query(collection(db,'treinos_base'),where('usuario_id','==',S.user.uid),where('nome','==',`Treino ${tipo}`)));
    S.treinoAtual=snap.empty?{nome:`Treino ${tipo}`,exercicios:[]}:snap.docs[0].data();
    renderExecucao(); startTimer(); S.activeTab='treino'; showScreen('execucao');
  }catch(e){ toast('Erro ao carregar treino: '+e.message,'error'); }
  hideLoader();
}

// ── EXECUÇÃO ───────────────────────────────────────────────
function startTimer(){ S.timerSecs=0; clearInterval(S.timerInterval); S.timerInterval=setInterval(()=>{ S.timerSecs++; const m=String(Math.floor(S.timerSecs/60)).padStart(2,'0'),s=String(S.timerSecs%60).padStart(2,'0'); const el=$('exec-timer'); if(el) el.textContent=`${m}:${s}`; },1000); }
function stopTimer(){ clearInterval(S.timerInterval); }

function renderExecucao(){
  $('exec-title').textContent=`Treino ${S.tipoSel}`;
  const list=$('exercicio-list'); list.innerHTML='';
  const exs=S.treinoAtual?.exercicios||[];
  $('ex-counter').textContent=`${exs.length} exercício${exs.length!==1?'s':''}`;
  if(!exs.length){ list.innerHTML=`<div class="empty-state"><span class="empty-icon">📋</span><p class="empty-title">Treino vazio</p><p class="empty-text">Monte esse treino na aba <strong style="color:var(--accent)">Montar</strong>.</p></div>`; return; }
  exs.forEach((ex,i)=>{
    const card=document.createElement('div'); card.className='exercicio-card'; card.dataset.index=i;
    card.innerHTML=`
      <div class="ex-top">
        <img class="ex-thumb" src="${ex.url_foto||(ex.video_url?`https://img.youtube.com/vi/${ytId(ex.video_url)||''}/hqdefault.jpg`:FALLBACK)}" alt="${ex.nome}" onerror="this.src='${FALLBACK}'" style="cursor:${ex.video_url?'pointer':'default'}" data-video="${ex.video_url||''}">
        <div class="ex-num-badge"><span class="ex-num">${ex.numero_aparelho||'—'}</span></div>
        <div class="ex-info">
          <div class="ex-name">${ex.nome}</div>
          <div class="ex-meta">${ex.series_meta||3}x${ex.reps_meta||12} reps · meta</div>
          ${ex.video_url?`<div class="ex-video-badge">🎬 Ver tutorial</div>`:''}
        </div>
      </div>
      <div class="ex-inputs">
        <div class="ex-input-cell"><span class="field-label">Carga (kg)</span><input type="number" class="input-carga" placeholder="0" min="0" step="0.5" inputmode="decimal"></div>
        <div class="ex-input-cell"><span class="field-label">Reps realizadas</span><input type="number" class="input-reps" placeholder="${ex.reps_meta||12}" min="0" inputmode="numeric"></div>
      </div>`;
    // Clique na foto/tutorial abre vídeo
    card.querySelector('.ex-thumb').addEventListener('click',()=>{ if(ex.video_url) abrirVideoModal(ex.video_url, ex.nome); });
    card.querySelector('.ex-info').addEventListener('click',()=>{ if(ex.video_url) abrirVideoModal(ex.video_url, ex.nome); });
    list.appendChild(card);
  });
}

// Modal de vídeo rápido durante execução
function abrirVideoModal(url, nome){
  const vid=ytId(url); if(!vid){ toast('URL de vídeo inválida.','error'); return; }
  const overlay=document.createElement('div'); overlay.className='modal-overlay'; overlay.style.zIndex='5000'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
  overlay.innerHTML=`<div style="background:var(--surface);border-radius:20px;padding:20px;width:calc(100% - 40px);max-width:440px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-family:var(--font-d);font-size:20px">${nome}</span>
      <button id="close-vid" style="background:var(--surface2);border:1px solid var(--border2);border-radius:50%;width:32px;height:32px;color:var(--text2);font-size:14px;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;">
      <iframe src="https://www.youtube.com/embed/${vid}?autoplay=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen allow="autoplay"></iframe>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#close-vid').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });
}

$('btn-voltar').addEventListener('click',()=>{ stopTimer(); S.activeTab='treino'; showScreen('selecao'); });
$('btn-finalizar').addEventListener('click', finalizarTreino);

async function finalizarTreino(){
  stopTimer();
  const uid=S.user.uid, cardioAp=$('cardio-aparelho').value, cardioMin=parseInt($('cardio-min').value)||0, forca=[];
  $$('.exercicio-card').forEach(card=>{ const i=parseInt(card.dataset.index),ex=S.treinoAtual.exercicios[i]; forca.push({nome_aparelho:ex.nome,numero_aparelho:ex.numero_aparelho||'',series:ex.series_meta||3,reps:parseInt(card.querySelector('.input-reps').value)||0,carga:parseFloat(card.querySelector('.input-carga').value)||0}); });
  showLoader();
  try{
    await addDoc(collection(db,'historico_treinos'),{usuario_id:uid,data:serverTimestamp(),tipo_treino:`Treino ${S.tipoSel}`,cardio:{aparelho:cardioAp,minutos:cardioMin},forca});
    await updateDoc(doc(db,'usuarios',uid),{contador_treinos:increment(1)});
    S.userData.contador_treinos=(S.userData.contador_treinos??0)+1;
    const ct=S.userData.contador_treinos, pct=Math.min((ct/30)*100,100);
    $('stat-treinos').textContent=ct; $('stat-progress-fill').style.width=pct+'%'; $('stat-progress-label').textContent=`${ct} / 30`; $('perfil-total-treinos').textContent=ct;
    hideLoader(); toast('🎉 Treino finalizado e salvo!');
    if(ct>=30) setTimeout(showModal30,900); else setTimeout(()=>{ S.activeTab='treino'; showScreen('checkin'); },1400);
  }catch(e){ hideLoader(); toast('Erro ao salvar: '+e.message,'error'); alert('Erro:\n'+e.message); }
}

// ── MONTAR TREINOS ─────────────────────────────────────────
$$('.montar-tab').forEach(btn=>{ btn.addEventListener('click',()=>{ $$('.montar-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); S.montarTipo=btn.dataset.treino; renderMontarLista(); }); });

async function carregarMontarTreinos(){
  const snap=await getDocs(query(collection(db,'treinos_base'),where('usuario_id','==',S.user.uid)));
  ['A','B','C'].forEach(t=>{ const d=snap.docs.find(d=>d.data().nome===`Treino ${t}`); if(d){ S.montarExs[t]=d.data().exercicios||[]; S.montarIds[t]=d.id; }else{ S.montarExs[t]=[]; S.montarIds[t]=null; } });
  renderMontarLista();
}

function renderMontarLista(){
  const t=S.montarTipo, exs=S.montarExs[t]||[], list=$('montar-exercicios-list');
  $('montar-letra').textContent=t; $('montar-nome-treino').textContent=`Treino ${t}`; $('montar-count').textContent=`${exs.length} exercício${exs.length!==1?'s':''}`;
  list.innerHTML='';
  if(!exs.length){ list.innerHTML=`<div class="montar-tip"><span class="montar-tip-icon">💡</span><span class="montar-tip-text">Nenhum exercício. Toque em <strong>"Adicionar Exercício"</strong> para montar o <strong>Treino ${t}</strong>.</span></div>`; return; }
  exs.forEach((ex,i)=>{
    const item=document.createElement('div'); item.className='montar-ex-item';
    // Thumb: foto do aparelho ou thumbnail do YouTube
    const thumbSrc = ex.url_foto || (ex.video_url ? `https://img.youtube.com/vi/${ytId(ex.video_url)||''}/hqdefault.jpg` : FALLBACK);
    const hasVideo = !!ex.video_url;

    item.innerHTML=`
      <img class="montar-ex-thumb" src="${thumbSrc}" alt="${ex.nome}" onerror="this.src='${FALLBACK}'">
      <div class="montar-ex-num">${ex.numero_aparelho||'—'}</div>
      <div class="montar-ex-info">
        <div class="montar-ex-name">${ex.nome}</div>
        <div class="montar-ex-meta">${ex.series_meta||3} séries × ${ex.reps_meta||12} reps</div>
        ${hasVideo ? '<div class="montar-ex-video-badge">🎬 Ver tutorial</div>' : '<div class="montar-ex-video-badge montar-sem-video">Sem vídeo</div>'}
      </div>
      <div class="montar-ex-btns">
        <button class="montar-ex-edit" data-index="${i}" title="Editar">✏️</button>
        <button class="montar-ex-del" data-index="${i}" title="Remover">✕</button>
      </div>`;

    // Clique na thumb ou nome abre o vídeo
    item.querySelector('.montar-ex-thumb').addEventListener('click', () => {
      if (hasVideo) abrirVideoModal(ex.video_url, ex.nome);
      else toast('Sem vídeo. Edite o exercício e adicione um link do YouTube.', 'info');
    });
    item.querySelector('.montar-ex-info').addEventListener('click', () => {
      if (hasVideo) abrirVideoModal(ex.video_url, ex.nome);
      else toast('Sem vídeo. Edite o exercício e adicione um link do YouTube.', 'info');
    });

    item.querySelector('.montar-ex-edit').addEventListener('click', e => { e.stopPropagation(); abrirEditarEx(i); });
    item.querySelector('.montar-ex-del').addEventListener('click', e => { e.stopPropagation(); if(confirm(`Remover "${ex.nome}"?`)){ S.montarExs[S.montarTipo].splice(i,1); renderMontarLista(); toast('Exercício removido.','info'); } });
    list.appendChild(item);
  });
}

// Editar exercício do treino
function abrirEditarEx(idx){
  const ex=S.montarExs[S.montarTipo][idx]; S.editExIdx=idx;
  $('edit-ex-nome').value=ex.nome||''; $('edit-ex-num').value=ex.numero_aparelho||''; $('edit-ex-series').value=ex.series_meta||3; $('edit-ex-reps').value=ex.reps_meta||12;
  const editVidEl=$('edit-ex-video'); if(editVidEl) editVidEl.value=ex.video_url||'';
  $('modal-editar-ex').classList.remove('hidden');
}
$('btn-close-editar-ex').addEventListener('click',()=>$('modal-editar-ex').classList.add('hidden'));
$('btn-cancel-editar-ex').addEventListener('click',()=>$('modal-editar-ex').classList.add('hidden'));
$('btn-salvar-editar-ex').addEventListener('click',()=>{
  const idx=S.editExIdx, ex=S.montarExs[S.montarTipo][idx];
  ex.nome=$('edit-ex-nome').value.trim()||ex.nome;
  ex.numero_aparelho=$('edit-ex-num').value.trim();
  ex.series_meta=parseInt($('edit-ex-series').value)||3;
  ex.reps_meta=parseInt($('edit-ex-reps').value)||12;
  const editVidSave=$('edit-ex-video'); if(editVidSave) ex.video_url=editVidSave.value.trim();
  $('modal-editar-ex').classList.add('hidden'); renderMontarLista(); toast('Exercício atualizado!');
});

$('btn-salvar-treino').addEventListener('click', async ()=>{
  const t=S.montarTipo, uid=S.user.uid; showLoader();
  try{
    const data={usuario_id:uid,nome:`Treino ${t}`,exercicios:S.montarExs[t]};
    if(S.montarIds[t]) await updateDoc(doc(db,'treinos_base',S.montarIds[t]),data);
    else{ const ref=await addDoc(collection(db,'treinos_base'),data); S.montarIds[t]=ref.id; }
    toast(`✅ Treino ${t} salvo!`); carregarDescricoesTreinos();
  }catch(e){ toast('Erro: '+e.message,'error'); }
  hideLoader();
});

$('btn-add-ex').addEventListener('click',()=>{ popularSelectAp(); limparFormEx(); $('modal-add-ex-title').textContent='Adicionar Exercício'; $('modal-add-ex').classList.remove('hidden'); });
$('btn-close-add-ex').addEventListener('click',()=>$('modal-add-ex').classList.add('hidden'));
$('modal-add-ex').addEventListener('click',e=>{ if(e.target===$('modal-add-ex')) $('modal-add-ex').classList.add('hidden'); });
$('select-aparelho-ex').addEventListener('change',e=>{ const ap=S.aparelhos.find(a=>a.id===e.target.value); if(ap){ $('ex-nome').value=ap.nome; $('ex-num').value=ap.numero_aparelho; } });

function popularSelectAp(){ const sel=$('select-aparelho-ex'); sel.innerHTML='<option value="">-- Escolha um aparelho --</option>'; S.aparelhos.forEach(ap=>{ const o=document.createElement('option'); o.value=ap.id; o.textContent=`#${ap.numero_aparelho} · ${ap.nome}`; sel.appendChild(o); }); }
function limparFormEx(){ ['select-aparelho-ex','ex-nome','ex-num','ex-series','ex-reps'].forEach(id=>{ const el=$(id); if(el) el.value=''; }); }

$('btn-confirmar-ex').addEventListener('click',()=>{
  const nome=$('ex-nome').value.trim(); if(!nome){ toast('Digite o nome.','error'); return; }
  const selVal=$('select-aparelho-ex').value, ap=S.aparelhos.find(a=>a.id===selVal);
  S.montarExs[S.montarTipo].push({ aparelho_id:selVal||'', nome, numero_aparelho:$('ex-num').value.trim(), url_foto:ap?.url_foto||'', video_url:ap?.video_url||'', series_meta:parseInt($('ex-series').value)||3, reps_meta:parseInt($('ex-reps').value)||12 });
  $('modal-add-ex').classList.add('hidden'); renderMontarLista(); toast(`"${nome}" adicionado 💪`);
});

// ── APARELHOS ──────────────────────────────────────────────
let formOpen=false;
$('btn-toggle-form').addEventListener('click',()=>{ formOpen=!formOpen; $('form-aparelho-wrap').classList.toggle('hidden',!formOpen); $('btn-toggle-form').classList.toggle('open',formOpen); });
$('btn-cancel-form').addEventListener('click',resetFormAp);

function resetFormAp(){ formOpen=false; $('form-aparelho-wrap').classList.add('hidden'); $('btn-toggle-form').classList.remove('open'); $('form-aparelho').reset(); $('preview-foto').style.display='none'; $('upload-icon-label').textContent='📷'; $('upload-text-label').innerHTML='Toque para <strong>fotografar</strong>'; $('upload-progress-wrap').classList.add('hidden'); }

$('foto-aparelho').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f) return; const p=$('preview-foto'); p.src=URL.createObjectURL(f); p.style.display='block'; $('upload-icon-label').textContent='✅'; $('upload-text-label').innerHTML=`<strong>${f.name}</strong>`; });

$('form-aparelho').addEventListener('submit', async e=>{
  e.preventDefault();
  const nome=$('input-nome-aparelho').value.trim(), numero=$('input-num-aparelho').value.trim(), video=$('input-video-aparelho').value.trim(), file=$('foto-aparelho').files[0];
  if(!nome||!numero){ toast('Preencha nome e número.','error'); return; }
  const btn=$('btn-submit-aparelho'); btn.disabled=true; $('submit-label').textContent='Salvando...'; showLoader();
  try{
    let url_foto=''; if(file) url_foto=await uploadFoto(file,S.user.uid);
    await addDoc(collection(db,'aparelhos'),{usuario_id:S.user.uid,nome,numero_aparelho:numero,url_foto,video_url:video});
    resetFormAp(); toast('Aparelho cadastrado! ✅'); await carregarAparelhos();
  }catch(e){ toast('Erro: '+e.message,'error'); alert('Erro:\n'+e.message); }
  finally{ btn.disabled=false; $('submit-label').textContent='Salvar'; hideLoader(); }
});

async function uploadFoto(file, uid) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Arquivo não é uma imagem.')); return; }
    if (file.size > 5 * 1024 * 1024) { reject(new Error('Imagem muito grande. Máximo 5MB.')); return; }

    const ext  = file.name.split('.').pop() || 'jpg';
    const name = `${Date.now()}.${ext}`;
    const ref  = sRef(storage, `aparelhos/${uid}/${name}`);
    const task = uploadBytesResumable(ref, file);

    const wrap  = $('upload-progress-wrap');
    const bar   = $('upload-bar');
    const pctEl = $('upload-percent');
    if (wrap) wrap.classList.remove('hidden');

    task.on('state_changed',
      snap => {
        const p = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        if (bar)   bar.style.width   = p + '%';
        if (pctEl) pctEl.textContent = p + '%';
      },
      err => { console.error('Upload erro:', err.code, err.message); reject(err); },
      async () => {
        try { resolve(await getDownloadURL(task.snapshot.ref)); }
        catch(e) { reject(e); }
      }
    );
  });
}

async function uploadFotoGenerico(file, uid) {
  return new Promise((resolve, reject) => {
    // Valida tipo
    if (!file.type.startsWith('image/')) {
      reject(new Error('Arquivo não é uma imagem.')); return;
    }
    // Valida tamanho (máx 5MB)
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Imagem muito grande. Máximo 5MB.')); return;
    }

    const ext  = file.name.split('.').pop() || 'jpg';
    const name = `${Date.now()}.${ext}`;
    const path = `aparelhos/${uid}/${name}`;
    console.log('Upload iniciando:', path, file.size, 'bytes', file.type);

    const ref  = sRef(storage, path);
    const task = uploadBytesResumable(ref, file);

    const wrap  = $('nova-foto-progress-wrap');
    const bar   = $('nova-foto-bar');
    const pctEl = $('nova-foto-pct');
    if (wrap) wrap.classList.remove('hidden');

    task.on(
      'state_changed',
      snapshot => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        console.log('Upload progresso:', pct + '%');
        if (bar)   bar.style.width   = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
      },
      error => {
        console.error('Erro no upload Storage:', error.code, error.message);
        reject(error);
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          console.log('Upload concluído. URL:', url);
          resolve(url);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function carregarAparelhos(){
  try{ const snap=await getDocs(query(collection(db,'aparelhos'),where('usuario_id','==',S.user.uid))); S.aparelhos=snap.docs.map(d=>({id:d.id,...d.data()})); $('perfil-total-aparelhos').textContent=S.aparelhos.length; renderAparelhos(S.aparelhos); }
  catch(e){ console.error(e); }
}

function renderAparelhos(list){
  const grid=$('aparelhos-grid'); if(!grid) return; grid.innerHTML='';
  if(!list.length){ grid.innerHTML=`<div class="empty-state"><span class="empty-icon">🏋️</span><p class="empty-title">Sem aparelhos</p><p class="empty-text">Cadastre o primeiro usando o botão + acima.</p></div>`; return; }
  list.forEach(ap=>{
    const item=document.createElement('div'); item.className='aparelho-item'; item.style.cursor='pointer';
    item.innerHTML=`
      <img class="aparelho-img" src="${fotoAp(ap)}" alt="${ap.nome}" onerror="this.src='${FALLBACK}'">
      ${ap.video_url?'<div class="aparelho-video-badge">🎬</div>':''}
      <div class="aparelho-info"><div class="aparelho-num">#${ap.numero_aparelho}</div><div class="aparelho-nome">${ap.nome}</div></div>`;
    item.addEventListener('click',()=>abrirModalAparelho(ap));
    grid.appendChild(item);
  });
}

$('aparelhos-search').addEventListener('input',e=>{ const q=e.target.value.toLowerCase(); renderAparelhos(S.aparelhos.filter(a=>a.nome.toLowerCase().includes(q)||a.numero_aparelho.toLowerCase().includes(q))); });

// ── MODAL APARELHO ─────────────────────────────────────────
function abrirModalAparelho(ap){
  S.apAtual=ap;
  $('modal-ap-nome').textContent=ap.nome;
  $('modal-ap-num').textContent=`#${ap.numero_aparelho}`;
  const fotoSrc=fotoAp(ap);
  const foto=$('modal-ap-foto'); foto.src=fotoSrc; foto.style.display='block';
  // Vídeo
  $('youtube-player-wrap').innerHTML=''; $('youtube-player-wrap').classList.add('hidden');
  if(ap.video_url){ const vid=ytId(ap.video_url); if(vid){ $('video-placeholder').classList.add('hidden'); $('youtube-player-wrap').classList.remove('hidden'); $('youtube-player-wrap').innerHTML=`<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;"><iframe src="https://www.youtube.com/embed/${vid}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe></div>`; }else{ $('video-placeholder').classList.remove('hidden'); } }
  else{ $('video-placeholder').classList.remove('hidden'); }
  $('modal-aparelho').classList.remove('hidden');
}

$('btn-close-ap').addEventListener('click',()=>$('modal-aparelho').classList.add('hidden'));
$('modal-aparelho').addEventListener('click',e=>{ if(e.target===$('modal-aparelho')) $('modal-aparelho').classList.add('hidden'); });

// EDITAR aparelho
$('btn-editar-ap').addEventListener('click',()=>{
  const ap=S.apAtual; $('edit-ap-nome').value=ap.nome; $('edit-ap-num').value=ap.numero_aparelho; $('edit-ap-video').value=ap.video_url||'';
  $('modal-aparelho').classList.add('hidden'); $('modal-editar-ap').classList.remove('hidden');
});
$('btn-close-editar-ap').addEventListener('click',()=>$('modal-editar-ap').classList.add('hidden'));
$('btn-cancel-editar-ap').addEventListener('click',()=>$('modal-editar-ap').classList.add('hidden'));
$('btn-salvar-editar-ap').addEventListener('click', async ()=>{
  const ap=S.apAtual, nome=$('edit-ap-nome').value.trim(), num=$('edit-ap-num').value.trim(), video=$('edit-ap-video').value.trim();
  if(!nome||!num){ toast('Preencha nome e número.','error'); return; }
  showLoader();
  try{ await updateDoc(doc(db,'aparelhos',ap.id),{nome,numero_aparelho:num,video_url:video}); ap.nome=nome; ap.numero_aparelho=num; ap.video_url=video; $('modal-editar-ap').classList.add('hidden'); toast('Aparelho atualizado! ✅'); await carregarAparelhos(); }
  catch(e){ toast('Erro: '+e.message,'error'); }
  hideLoader();
});

// TROCAR FOTO
$('btn-trocar-foto-ap').addEventListener('click',()=>{ $('modal-aparelho').classList.add('hidden'); $('modal-trocar-foto').classList.remove('hidden'); $('nova-foto-preview').style.display='none'; $('nova-foto-icon').textContent='📷'; $('nova-foto-text').innerHTML='Toque para <strong>fotografar</strong>'; $('nova-foto-progress-wrap').classList.add('hidden'); });
$('btn-close-trocar-foto').addEventListener('click',()=>$('modal-trocar-foto').classList.add('hidden'));
$('btn-cancel-trocar-foto').addEventListener('click',()=>$('modal-trocar-foto').classList.add('hidden'));
$('input-nova-foto').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f) return; $('nova-foto-preview').src=URL.createObjectURL(f); $('nova-foto-preview').style.display='block'; $('nova-foto-icon').textContent='✅'; $('nova-foto-text').innerHTML=`<strong>${f.name}</strong>`; });
$('btn-confirmar-trocar-foto').addEventListener('click', async () => {
  const fileInput = $('input-nova-foto');
  const file = fileInput.files[0];

  if (!file) { toast('Selecione uma foto antes de salvar.', 'error'); return; }
  if (!S.apAtual) { toast('Nenhum aparelho selecionado.', 'error'); return; }

  const btn = $('btn-confirmar-trocar-foto');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  showLoader();

  try {
    const url = await uploadFotoGenerico(file, S.user.uid);

    // Salva no Firestore
    await updateDoc(doc(db, 'aparelhos', S.apAtual.id), { url_foto: url });
    S.apAtual.url_foto = url;

    // Fecha modal e atualiza lista
    $('modal-trocar-foto').classList.add('hidden');
    fileInput.value = '';
    await carregarAparelhos();
    toast('✅ Foto atualizada com sucesso!');

  } catch (err) {
    console.error('Trocar foto erro:', err);
    const msg = err.code === 'storage/unauthorized'
      ? 'Sem permissão no Storage. Verifique as regras do Firebase.'
      : err.message || 'Erro desconhecido.';
    toast('Erro: ' + msg, 'error');
    alert('Erro ao salvar foto:
' + msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Foto';
    hideLoader();
  }
});

// ADD/EDITAR VÍDEO pelo modal
$('btn-add-video-ap').addEventListener('click',()=>{
  $('modal-aparelho').classList.add('hidden');
  $('edit-ap-nome').value=S.apAtual.nome; $('edit-ap-num').value=S.apAtual.numero_aparelho; $('edit-ap-video').value=S.apAtual.video_url||'';
  $('modal-editar-ap').classList.remove('hidden');
  setTimeout(()=>$('edit-ap-video').focus(),300);
});

// DELETAR aparelho
$('btn-deletar-ap').addEventListener('click', async ()=>{
  const ap=S.apAtual;
  if(!confirm(`Excluir "${ap.nome}"? Esta ação não pode ser desfeita.`)) return;
  showLoader();
  try{
    await deleteDoc(doc(db,'aparelhos',ap.id));
    if(ap.url_foto){ try{ await deleteObject(sRef(storage,ap.url_foto)); }catch(_){} }
    $('modal-aparelho').classList.add('hidden'); toast('Aparelho excluído.','info'); await carregarAparelhos();
  }catch(e){ toast('Erro: '+e.message,'error'); }
  hideLoader();
});

// ── RELATÓRIO ──────────────────────────────────────────────
async function carregarRelatorio(){
  const uid=S.user.uid;
  try{
    const snap=await getDocs(query(collection(db,'historico_treinos'),where('usuario_id','==',uid),limit(200)));
    const docs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.data?.toMillis?.()??0)-(a.data?.toMillis?.()??0));

    const now=new Date(), semanaMs=7*24*60*60*1000;
    const isMesAtual=d=>{ const dt=d.data?.toDate?.(); return dt&&dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear(); };
    const isSemana=d=>{ const dt=d.data?.toDate?.(); return dt&&(now-dt)<semanaMs; };

    const total=docs.length, semana=docs.filter(isSemana).length, mes=docs.filter(isMesAtual).length;
    $('rel-total').textContent=total; $('rel-semana').textContent=semana; $('rel-mes').textContent=mes;

    // Frequência por tipo
    const freq={};
    docs.forEach(d=>{ const t=d.tipo_treino||'?'; freq[t]=(freq[t]||0)+1; });
    const freqWrap=$('rel-freq'); freqWrap.innerHTML='';
    Object.entries(freq).sort((a,b)=>b[1]-a[1]).forEach(([tipo,n])=>{
      const pct=total?Math.round((n/total)*100):0;
      const bar=document.createElement('div'); bar.className='freq-item';
      bar.innerHTML=`<div class="freq-label"><span class="freq-tipo">${tipo}</span><span class="freq-n">${n}x</span></div><div class="freq-bar-wrap"><div class="freq-bar" style="width:${pct}%"></div></div>`;
      freqWrap.appendChild(bar);
    });
    if(!Object.keys(freq).length) freqWrap.innerHTML='<p style="color:var(--text3);font-size:13px">Nenhum treino ainda.</p>';

    // Calendário — últimos 35 dias
    const calWrap=$('rel-calendario'); calWrap.innerHTML='';
    const diasTreino=new Set(docs.map(d=>{ const dt=d.data?.toDate?.(); return dt?dt.toLocaleDateString('pt-BR'):null; }).filter(Boolean));
    const dias=['D','S','T','Q','Q','S','S'];
    const header=document.createElement('div'); header.className='cal-header';
    dias.forEach(d=>{ const s=document.createElement('span'); s.textContent=d; header.appendChild(s); });
    calWrap.appendChild(header);
    const grid=document.createElement('div'); grid.className='cal-grid';
    // Começa no domingo da semana atual - 4 semanas
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    const inicio=new Date(hoje); inicio.setDate(inicio.getDate()-34);
    const diaSemana=inicio.getDay(); if(diaSemana>0) for(let i=0;i<diaSemana;i++){ const b=document.createElement('div'); b.className='cal-day cal-empty'; grid.appendChild(b); }
    for(let i=0;i<=34;i++){
      const d=new Date(inicio); d.setDate(d.getDate()+i);
      const str=d.toLocaleDateString('pt-BR'), cell=document.createElement('div');
      const isHoje=d.getTime()===hoje.getTime(), hasTreino=diasTreino.has(str);
      cell.className=`cal-day${hasTreino?' cal-treino':''}${isHoje?' cal-hoje':''}`;
      cell.textContent=d.getDate(); cell.title=str+(hasTreino?' — Treinou':'');
      grid.appendChild(cell);
    }
    calWrap.appendChild(grid);

    // Histórico detalhado
    const list=$('historico-list'); list.innerHTML='';
    if(!docs.length){ list.innerHTML=`<div class="empty-state"><span class="empty-icon">📊</span><p class="empty-title">Sem histórico</p><p class="empty-text">Complete seu primeiro treino!</p></div>`; return; }
    docs.slice(0,30).forEach(h=>{
      const card=document.createElement('div'); card.className='historico-card';
      const tags=[];
      if(h.cardio?.minutos>0) tags.push(`<span class="h-tag cardio">❤️ ${h.cardio.aparelho} · ${h.cardio.minutos}min</span>`);
      (h.forca||[]).forEach(ex=>{ if(ex.carga>0||ex.reps>0) tags.push(`<span class="h-tag">${ex.nome_aparelho} · ${ex.carga}kg × ${ex.reps}</span>`); });
      // Se for registro de checkout, mostra dados detalhados
      let extraHtml = '';
      if (h.tipo_treino === '🚪 Check-out' && h.checkin && h.checkout) {
        const entrada = h.checkin.horario ? new Date(h.checkin.horario).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
        const saida   = h.checkout.horario ? new Date(h.checkout.horario).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
        const dur     = h.duracao_minutos != null ? (h.duracao_minutos >= 60 ? `${Math.floor(h.duracao_minutos/60)}h ${h.duracao_minutos%60}min` : `${h.duracao_minutos} min`) : '—';
        extraHtml = `<div class="checkout-historico-wrap">
          <div class="co-hist-row"><span>🕐 Entrada</span><strong>${entrada}</strong></div>
          <div class="co-hist-row"><span>🕐 Saída</span><strong>${saida}</strong></div>
          <div class="co-hist-row"><span>⏱️ Duração</span><strong class="co-dur">${dur}</strong></div>
          ${h.checkin.lat ? `<div class="co-hist-row"><span>📍 Entrada</span><a class="co-maps-link" href="https://maps.google.com/?q=${h.checkin.lat},${h.checkin.lng}" target="_blank">Ver no mapa</a></div>` : ''}
          ${h.checkout.lat ? `<div class="co-hist-row"><span>📍 Saída</span><a class="co-maps-link" href="https://maps.google.com/?q=${h.checkout.lat},${h.checkout.lng}" target="_blank">Ver no mapa</a></div>` : ''}
        </div>`;
      }
      card.innerHTML=`<div class="historico-header"><span class="historico-tipo">${h.tipo_treino}</span><span class="historico-data">${fmtDate(h.data)}</span></div>${extraHtml}<div class="historico-tags">${tags.join('')||(!extraHtml?'<span class="h-tag">Treino registrado</span>':'')}</div>`;
      list.appendChild(card);
    });
  }catch(e){ console.error(e); toast('Erro ao carregar relatório.','error'); }
}

// ── BOTTOM NAV ─────────────────────────────────────────────
$$('.nav-item').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const tab=btn.dataset.tab; S.activeTab=tab;
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    if(tab==='treino'){ showScreen(S.checkinOk?'selecao':'checkin'); }
    else if(tab==='montar'){ showScreen('montar'); showLoader(); await carregarMontarTreinos(); hideLoader(); }
    else if(tab==='aparelhos'){ showScreen('aparelhos'); showLoader(); await carregarAparelhos(); hideLoader(); }
    else if(tab==='relatorio'){ showScreen('relatorio'); showLoader(); await carregarRelatorio(); hideLoader(); }
    else if(tab==='perfil'){ showScreen('perfil'); }
  });
});
