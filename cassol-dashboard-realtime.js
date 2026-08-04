const firebaseConfig = {
  apiKey: 'AIzaSyCuifhZ4I3_doR6N_2xdqMe3zUDMgjeeR0',
  authDomain: 'grupo-cassol-2.firebaseapp.com',
  projectId: 'grupo-cassol-2',
  storageBucket: 'grupo-cassol-2.firebasestorage.app',
  messagingSenderId: '265678011446',
  appId: '1:265678011446:web:3e1e7737d1e6fd5fb26c97',
};

const WATCHED_DOCUMENTS = ['gc-events', 'gc-conteudos', 'gc-livros', 'gc-projetos'];
let unsubscribeListeners = [];
let listenerStarted = false;
let changeTimer = null;
const lastTimestampByDocument = new Map();

function announceDashboardChange(documentId, timestamp) {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    if (typeof window.requestCassolDashboardRealtimePull === 'function') {
      window.requestCassolDashboardRealtimePull({ documentId, timestamp });
    }
  }, 80);
}

window.startCassolDashboardRealtime = async function startCassolDashboardRealtime() {
  if (listenerStarted) return;
  listenerStarted = true;
  try {
    const [firebaseApp, firestore] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
    ]);
    const app = firebaseApp.getApps().find(item => item.options?.projectId === firebaseConfig.projectId)
      || firebaseApp.initializeApp(firebaseConfig, 'checklist-cassol-realtime');
    const db = firestore.getFirestore(app);

    unsubscribeListeners = WATCHED_DOCUMENTS.map(documentId => firestore.onSnapshot(
      firestore.doc(db, 'dados', documentId),
      snapshot => {
        if (!snapshot.exists()) return;
        const timestamp = Number(snapshot.data()?.ts || 0);
        if (!lastTimestampByDocument.has(documentId)) {
          lastTimestampByDocument.set(documentId, timestamp);
          return;
        }
        const previousTimestamp = lastTimestampByDocument.get(documentId);
        if (timestamp === previousTimestamp) return;
        lastTimestampByDocument.set(documentId, timestamp);
        announceDashboardChange(documentId, timestamp);
      },
      error => console.warn(`[Cassol dashboard] Escuta indisponível para ${documentId}:`, error?.message || error),
    ));
  } catch (error) {
    listenerStarted = false;
    console.warn('[Cassol dashboard] Tempo real indisponível; mantendo a sincronização periódica:', error?.message || error);
  }
};

window.stopCassolDashboardRealtime = function stopCassolDashboardRealtime() {
  clearTimeout(changeTimer);
  unsubscribeListeners.forEach(unsubscribe => unsubscribe());
  unsubscribeListeners = [];
  lastTimestampByDocument.clear();
  listenerStarted = false;
};

window.dispatchEvent(new Event('cassol-dashboard-realtime-ready'));
