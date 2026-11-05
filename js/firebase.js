// Firebase 初期化（Realtime Database）
// 個人利用のためログイン機能はありません。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, get, set, update, remove, push,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: 'AIzaSyC2mJxGSMUrbkUW4i8EEz3BseHq6T_NrMY',
  authDomain: 'y-relic.firebaseapp.com',
  databaseURL: 'https://y-relic-default-rtdb.firebaseio.com',
  projectId: 'y-relic',
  storageBucket: 'y-relic.firebasestorage.app',
  messagingSenderId: '280757229652',
  appId: '1:280757229652:web:94dabbfce252fe213075c1',
  measurementId: 'G-Z69R24RKCC',
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// Analytics は任意（読み込めない環境でもアプリは動作）
import('https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js')
  .then(async (m) => { if (await m.isSupported()) m.getAnalytics(app); })
  .catch(() => {});

export { ref, get, set, update, remove, push };

