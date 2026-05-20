// firebase-config.js
// SDK Firebase v10 Modular — Credenciais do projeto gymos-app

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDrycyaWFGrnZ0fHzYjYcC8MDFpSsmrwqI",
  authDomain:        "gymos-app.firebaseapp.com",
  projectId:         "gymos-app",
  storageBucket:     "gymos-app.firebasestorage.app",
  messagingSenderId: "128500011082",
  appId:             "1:128500011082:web:eacf8270fd4e2435b0d6b3"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
