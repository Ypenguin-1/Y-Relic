// Firebase 初期化（認証 + Realtime Database）
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
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
export const auth = getAuth(app);
auth.languageCode = 'ja';
export const db = getDatabase(app);

// Analytics は任意（読み込めない環境でもアプリは動作）
import('https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js')
  .then(async (m) => { if (await m.isSupported()) m.getAnalytics(app); })
  .catch(() => {});

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail,
  ref, get, set, update, remove, push,
};

/** Firebase のエラーコードを日本語メッセージに変換 */
export function authErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
    'auth/user-not-found': 'アカウントが見つかりません。',
    'auth/wrong-password': 'パスワードが違います。',
    'auth/invalid-credential': 'メールアドレスまたはパスワードが違います。',
    'auth/email-already-in-use': 'このメールアドレスは既に登録されています。',
    'auth/weak-password': 'パスワードは6文字以上にしてください。',
    'auth/too-many-requests': '試行回数が多すぎます。しばらくしてから再度お試しください。',
    'auth/popup-closed-by-user': 'ログインがキャンセルされました。',
    'auth/network-request-failed': 'ネットワークに接続できません。',
    'auth/unauthorized-domain': 'このドメインは Firebase の承認済みドメインに登録されていません。',
    'auth/operation-not-allowed': 'このログイン方法は Firebase コンソールで有効になっていません。',
  };
  return map[code] || `エラーが発生しました（${code || err?.message || 'unknown'}）`;
}
