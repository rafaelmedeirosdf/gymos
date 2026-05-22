import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/9.x.x/firebase-firestore.js";

import { 
  getStorage, 
  ref, 
  uploadBytesResumable, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/9.x.x/firebase-storage.js";

// --- Referências do DOM ---
const btnToggleForm = document.getElementById('btn-toggle-form');
const formAparelhoWrap = document.getElementById('form-aparelho-wrap');
const formAparelho = document.getElementById('form-aparelho');
const formAparelhoTitle = document.getElementById('form-aparelho-title');
const submitLabel = document.getElementById('submit-label');
const btnCancelForm = document.getElementById('btn-cancel-form');

const inputIdAparelho = document.getElementById('input-id-aparelho');
const inputNomeAparelho = document.getElementById('input-nome-aparelho');
const inputNumAparelho = document.getElementById('input-num-aparelho');
const inputFotoAparelho = document.getElementById('foto-aparelho');
const previewFoto = document.getElementById('preview-foto');

const uploadProgressWrap = document.getElementById('upload-progress-wrap');
const uploadBar = document.getElementById('upload-bar');
const uploadPercent = document.getElementById('upload-percent');
const aparelhosGrid = document.getElementById('aparelhos-grid');
const aparelhosSearch = document.getElementById('aparelhos-search');

// --- Estado da Aplicação ---
let listaAparelhosLocal = [];
let urlFotoSelecionada = ""; 
// const userId = firebase.auth().currentUser.uid; // Certifique-se de obter o UID do usuário ativo

// --- Funções Auxiliares de Interface ---
function exibirToast(mensagem) {
  const toast = document.getElementById('toast');
  toast.textContent = mensagem;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function abrirFormulario() {
  formAparelhoWrap.classList.remove('hidden');
}

function fecharEResetarFormulario() {
  formAparelhoWrap.classList.add('hidden');
  formAparelho.reset();
  inputIdAparelho.value = "";
  urlFotoSelecionada = "";
  previewFoto.src = "";
  previewFoto.style.display = "none";
  formAparelhoTitle.textContent = "Cadastrar Aparelho";
  submitLabel.textContent = "Salvar Aparelho";
  uploadProgressWrap.classList.add('hidden');
}

// --- Preview de Imagem Local ---
inputFotoAparelho.addEventListener('change', (e) => {
  const file = e.target.getFiles ? e.target.getFiles()[0] : e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      previewFoto.src = event.target.result;
      previewFoto.style.display = "block";
    };
    reader.readAsDataURL(file);
  }
});

// --- Controle de Visibilidade do Formulário ---
btnToggleForm.addEventListener('click', () => {
  if (formAparelhoWrap.classList.contains('hidden')) {
    abrirFormulario();
  } else {
    fecharEResetarFormulario();
  }
});

btnCancelForm.addEventListener('click', fecharEResetarFormulario);

// --- Renderização dos Aparelhos com Botão de Edição ---
function renderizarAparelhos(aparelhos) {
  aparelhosGrid.innerHTML = "";
  
  if (aparelhos.length === 0) {
    aparelhosGrid.innerHTML = `<p class="empty-msg">Nenhum aparelho encontrado.</p>`;
    return;
  }

  aparelhos.forEach(aparelho => {
    const card = document.createElement('div');
    card.className = 'aparelho-card';
    
    // Fallback caso o aparelho não possua foto cadastrada
    const imagemSrc = aparelho.fotoUrl ? aparelho.fotoUrl : 'assets/default-equipment.png';

    card.innerHTML = `
      <div class="aparelho-img-container">
        <img src="${imagemSrc}" alt="${aparelho.nome}" class="aparelho-img" />
        <span class="aparelho-badge">Nº ${aparelho.numero}</span>
      </div>
      <div class="aparelho-info">
        <h4 class="aparelho-name">${aparelho.nome}</h4>
        <button class="btn-edit-aparelho" data-id="${aparelho.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
      </div>
    `;
    
    // Evento de clique para o botão Editar gerado dinamicamente
    card.querySelector('.btn-edit-aparelho').addEventListener('click', (e) => {
      e.stopPropagation();
      prepararEdicao(aparelho.id);
    });

    aparelhosGrid.appendChild(card);
  });
}

// --- Preparação dos dados para Edição ---
function prepararEdicao(id) {
  const aparelho = listaAparelhosLocal.find(item => item.id === id);
  if (!aparelho) return;

  // Popula o formulário com dados existentes
  inputIdAparelho.value = aparelho.id;
  inputNomeAparelho.value = aparelho.nome;
  inputNumAparelho.value = aparelho.numero;
  
  if (aparelho.fotoUrl) {
    urlFotoSelecionada = aparelho.fotoUrl;
    previewFoto.src = aparelho.fotoUrl;
    previewFoto.style.display = "block";
  } else {
    previewFoto.style.display = "none";
  }

  // Modifica os textos da interface para contexto de modificação
  formAparelhoTitle.textContent = "Alterar Aparelho";
  submitLabel.textContent = "Atualizar Dados";
  
  abrirFormulario();
  formAparelhoWrap.scrollIntoView({ behavior: 'smooth' });
}

// --- Upload de Arquivo para o Firebase Storage ---
function executarUploadFoto(file) {
  return new Promise((resolve, reject) => {
    const storage = getStorage();
    const nomeArquivo = `${Date.now()}_${file.name}`;
    const storageRef = ref(storage, `users/${userId}/aparelhos/${nomeArquivo}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadProgressWrap.classList.remove('hidden');

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progresso = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        uploadBar.style.width = `${progresso}%`;
        uploadPercent.textContent = `${Math.round(progresso)}%`;
      }, 
      (error) => {
        exibirToast("Erro no envio da imagem.");
        reject(error);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadURL);
      }
    );
  });
}

// --- Envio do Formulário (Salvar / Alterar) ---
formAparelho.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nome = inputNomeAparelho.value.trim();
  const numero = inputNumAparelho.value.trim();
  const idAparelho = inputIdAparelho.value;

  if (!nome || !numero) {
    exibirToast("Por favor, preencha os campos obrigatórios (*)");
    return;
  }

  try {
    document.getElementById('btn-submit-aparelho').disabled = true;
    let fotoUrlFinal = urlFotoSelecionada;

    // Se o usuário selecionou um arquivo de imagem novo
    const file = inputFotoAparelho.files[0];
    if (file) {
      fotoUrlFinal = await executarUploadFoto(file);
    }

    const payload = {
      nome: nome,
      numero: numero,
      fotoUrl: fotoUrlFinal,
      userId: userId,
      updatedAt: new Date()
    };

    const db = getFirestore();

    if (idAparelho) {
      // MODO EDIÇÃO: Atualiza o documento existente
      const docRef = doc(db, "aparelhos", idAparelho);
      await updateDoc(docRef, payload);
      exibirToast("Aparelho atualizado com sucesso!");
    } else {
      // MODO CADASTRO: Insere um novo documento
      payload.createdAt = new Date();
      await addDoc(collection(db, "aparelhos"), payload);
      exibirToast("Aparelho cadastrado com sucesso!");
    }

    fecharEResetarFormulario();
  } catch (error) {
    console.error("Erro na transação:", error);
    exibirToast("Ocorreu um erro operacional ao salvar.");
  } finally {
    document.getElementById('btn-submit-aparelho').disabled = false;
  }
});

// --- Mecanismo de Busca Dinâmica ---
aparelhosSearch.addEventListener('input', (e) => {
  const termo = e.target.value.toLowerCase().trim();
  const filtrados = listaAparelhosLocal.filter(aparelho => 
    aparelho.nome.toLowerCase().includes(termo) || 
    aparelho.numero.toLowerCase().includes(termo)
  );
  renderizarAparelhos(filtrados);
});

// --- Escuta Ativa do Banco de Dados (Real-time Firestore) ---
function inicializarEscutaAparelhos() {
  const db = getFirestore();
  const q = query(collection(db, "aparelhos"), where("userId", "==", userId));

  onSnapshot(q, (snapshot) => {
    listaAparelhosLocal = [];
    snapshot.forEach((doc) => {
      listaAparelhosLocal.push({ id: doc.id, ...doc.data() });
    });
    // Aplica a renderização imediata com os dados atualizados
    renderizarAparelhos(listaAparelhosLocal);
  }, (error) => {
    console.error("Erro ao sincronizar aparelhos:", error);
  });
}

// Chame inicializarEscutaAparelhos() logo após a confirmação de login bem-sucedido
