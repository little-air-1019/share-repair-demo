/* LINE entry bootstrap, shared by miniapp.html (Published) and developing.html (Developing).
   index.html never loads this file or the LIFF SDK.
   The page itself declares its stage in <html data-liff-env="...">. The stage is never read from
   the URL, so a query string or a liff.state redirect cannot switch the LIFF ID.
   SDK use: liff.init(), liff.isInClient(), and for the nickname/avatar card liff.isLoggedIn(),
   liff.permission.query('profile') and liff.getProfile(). No login call, no tokens, no all-scope consent request.
   Only displayName and pictureUrl are kept, in page memory only (window.ShareRepairLine): never stored,
   logged, or sent anywhere. Profile problems never block the app. */
'use strict';

// Public LIFF IDs (line-channel-settings.md). Review is deliberately absent: not enabled.
const LIFF_IDS = { published: '2012566276-GSc0s3dD', developing: '2012566272-IizF9Fvz' };
const SDK_URL = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; // official CDN, edge path for major v2
const TIMEOUT_MS = 15000;
const PROFILE_TIMEOUT_MS = 8000; // automatic read after init
const ASK_TIMEOUT_MS = 60000; // user tapped the button: LINE may be showing its consent screen
const NAME_MAX = 40;

const liffIdFor = (env) => (Object.prototype.hasOwnProperty.call(LIFF_IDS, env) ? LIFF_IDS[env] : null);
const miniAppUrl = (env) => 'https://miniapp.line.me/' + liffIdFor(env);
// app.js URL with the page's release (cache busting, see stamp-release.js). The release comes only from the page's
// own <meta name="share-repair-release">, never from the URL; anything but 10 hex chars is ignored.
const appSrc = (release) => (/^[0-9a-f]{10}$/.test(release || '') ? 'app.js?v=' + release : 'app.js');

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, bad) => { t = setTimeout(() => bad({ timeout: true }), ms); })])
    .finally(() => clearTimeout(t));
}

// Load SDK, then call liff.init() exactly once. Resolves to { state, ... }; never rejects.
// state: 'ready' | 'config' (unknown stage) | 'sdk' (SDK failed or timed out) | 'init' | 'timeout'.
async function startLiff(env, loadSdk, timeoutMs = TIMEOUT_MS) {
  const liffId = liffIdFor(env);
  if (!liffId) return { state: 'config' };
  let liff;
  try { liff = await withTimeout(loadSdk(), timeoutMs); } catch (error) { return { state: 'sdk', error }; }
  if (!liff || typeof liff.init !== 'function') return { state: 'sdk' };
  // No external-browser auto login option and no login call: in LINE, init logs in by itself;
  // outside LINE the service must work without login (LINE MINI App external-browser guide).
  try { await withTimeout(liff.init({ liffId }), timeoutMs); } catch (error) {
    return { state: error && error.timeout ? 'timeout' : 'init', error };
  }
  return { state: 'ready', inClient: liff.isInClient() };
}

// Avatar URL: absolute https only, no credentials. Anything else falls back to the default avatar.
function safePicture(u) {
  if (typeof u !== 'string' || !u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch (e) { return null; }
}
const clampName = (v) => Array.from(typeof v === 'string' ? v.trim() : '').slice(0, NAME_MAX).join('').trim();
// Keep only the two fields this demo shows; everything else in the SDK response is dropped here.
function cleanProfile(p) {
  return { displayName: clampName(p && p.displayName), pictureUrl: safePicture(p && p.pictureUrl) };
}

// Read nickname + avatar after init. Resolves to { state, profile? }; never rejects.
// state: 'ready' | 'prompt' (not consented: offer an optional button) | 'unavailable' (no profile scope / no API)
//      | 'guest' (outside LINE, not logged in) | 'failed' (denied, error or timeout).
// ask=false: getProfile only when permission.query says granted. ask=true (user tapped): call getProfile and
// let LINE show its own consent screen if needed. Never logs in and never asks for every channel scope.
async function readProfile(liff, inClient, { ask = false, timeoutMs = PROFILE_TIMEOUT_MS } = {}) {
  try {
    if (!liff || typeof liff.getProfile !== 'function') return { state: 'unavailable' };
    const loggedIn = inClient || (typeof liff.isLoggedIn === 'function' && liff.isLoggedIn() === true);
    if (!loggedIn) return { state: 'guest' };
    if (!ask) {
      const query = liff.permission && liff.permission.query;
      if (typeof query !== 'function') return { state: 'prompt' };
      const st = ((await withTimeout(Promise.resolve(query.call(liff.permission, 'profile')), timeoutMs)) || {}).state;
      if (st === 'unavailable' || st === 'prompt') return { state: st };
      if (st !== 'granted') return { state: 'failed' };
    }
    return { state: 'ready', profile: cleanProfile(await withTimeout(Promise.resolve(liff.getProfile()), timeoutMs)) };
  } catch (e) { return { state: 'failed' }; }
}

const MESSAGES = {
  config: ['入口設定錯誤', '此頁面沒有可用的 LINE 環境設定。'],
  sdk: ['無法載入 LINE 元件', '可能是網路不穩或 LINE 服務暫時無法連線。'],
  init: ['LINE 初始化失敗', '此入口可能尚未在 LINE Developers Console 完成設定。'],
  timeout: ['LINE 連線逾時', '等待 LINE 回應超過 15 秒。'],
};

if (typeof module !== 'undefined') module.exports = { LIFF_IDS, SDK_URL, liffIdFor, miniAppUrl, appSrc, startLiff, MESSAGES, safePicture, cleanProfile, readProfile };

if (typeof document !== 'undefined') (function () {
  const env = document.documentElement.dataset.liffEnv;
  const gate = document.getElementById('liff-gate');
  const h = (tag, props, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids); return el; };

  function loadSdk() {
    return new Promise((ok, bad) => {
      const s = h('script', { src: SDK_URL, charset: 'utf-8' });
      s.onload = () => ok(window.liff);
      s.onerror = () => bad(new Error('sdk load error'));
      document.head.append(s);
    });
  }

  function showError(r) {
    const [title, text] = MESSAGES[r.state];
    const code = r.error && r.error.code ? '錯誤代碼：' + r.error.code : '';
    const retry = h('button', { type: 'button', className: 'btn btn-primary', textContent: '重新載入' });
    retry.dataset.act = 'liff-retry';
    // Manual only: never reload or redirect by itself, so a failing init cannot loop.
    retry.onclick = () => { retry.disabled = true; location.reload(); };
    const web = h('a', { className: 'btn btn-outline', href: './', textContent: '改用網頁展示版' });
    web.dataset.act = 'liff-web';
    gate.dataset.state = r.state;
    gate.replaceChildren(h('div', { className: 'liff-gate-box' },
      h('h1', { className: 'liff-gate-title', textContent: title }),
      h('p', { textContent: text + '網頁展示版不需 LINE，可直接操作相同內容。' }),
      code ? h('p', { className: 'caption', textContent: code }) : '',
      h('div', { className: 'liff-gate-actions' }, retry, web)));
  }

  function showReady(r) {
    gate.hidden = true;
    gate.dataset.state = 'ready';
    document.querySelector('.preview-text').textContent = (env === 'developing' ? 'LINE 開發版・' : 'LINE 版・') + '情境資料・示範金額';
    if (!r.inClient) {
      // External browser: usable as-is (no login); point to LINE without forcing anything.
      const a = h('a', { href: miniAppUrl(env), textContent: '在 LINE 中開啟' });
      a.dataset.act = 'open-in-line';
      document.querySelector('.preview-notice').after(h('p', { className: 'liff-note', role: 'note' },
        '目前在 LINE 以外的瀏覽器，可直接操作展示內容。', a));
    }
    shareProfile(r.inClient);
    const meta = document.querySelector('meta[name="share-repair-release"]');
    document.body.append(h('script', { src: appSrc(meta && meta.content) }));
  }

  // Bridge to app.js: current LINE card state in page memory, plus an opt-in request for the button.
  // The app reads get() at start and listens for 'share-repair-line'. Gone on reload.
  function shareProfile(inClient) {
    let cur = { state: 'loading', inClient, profile: null };
    let busy = false;
    const set = (r) => {
      cur = Object.freeze({ state: r.state, inClient, profile: r.profile ? Object.freeze({ ...r.profile }) : null });
      document.dispatchEvent(new Event('share-repair-line'));
    };
    const run = (ask) => {
      if (busy) return;
      busy = true;
      set({ state: 'loading' });
      readProfile(window.liff, inClient, ask ? { ask, timeoutMs: ASK_TIMEOUT_MS } : undefined).then((r) => { busy = false; set(r); });
    };
    window.ShareRepairLine = Object.freeze({ get: () => cur, request: () => { if (cur.state === 'prompt') run(true); } });
    run(false);
  }

  startLiff(env, loadSdk).then((r) => (r.state === 'ready' ? showReady(r) : showError(r)));
})();
