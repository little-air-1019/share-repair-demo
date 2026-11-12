/* Share Repair customer UI, v1 (static preview).
   In-memory only: no network, no storage, no LIFF SDK yet.
   The pure core (top half) is DOM-free so selftest.js can run it in Node. */
'use strict';

/* ================= Pure core ================= */

const SERVICE_FEE = 600; // Sample value carried over from the demo; not a decided price.
const SAMPLE_PRICE_NOTE = '示範金額，非正式報價';

const STAGES = {
  domestic: [
    ['已受理', '平台窗口'], ['專人遠端判讀', '平台窗口'], ['確認方案與費用', '您與商家'],
    ['寄出商品', '您'], ['維修點收件', '在地維修團隊'], ['檢測與維修', '在地維修團隊'],
    ['寄回', '在地維修團隊'], ['簽收結案', '您'],
  ],
  overseas: [
    ['已受理', '平台窗口'], ['原廠遠端判讀', '原廠技術人員'], ['確認報價', '您與付款方'],
    ['寄送至國內集運點', '您'], ['集運點收件', '集運商'], ['出口至原廠', '集運商'],
    ['原廠維修站收件', '原廠維修站'], ['原廠維修', '原廠維修站'], ['回程國際運輸', '集運商'],
    ['台灣進口', '集運商'], ['國內配送', '集運商'], ['簽收結案', '您'],
  ],
  tbd: [
    ['已送出申請', '您'], ['專人判讀', '平台窗口'], ['確認保固與處理方式', '商家／原廠'], ['寄件前報價', '您與付款方'],
  ],
};
const SHIP_STAGE = { domestic: 3, overseas: 3 };

const STATUS = {
  awaitShip: { label: '待寄件', tone: 'todo', todo: true, next: '依寄件方式寄出商品' },
  awaitQuote: { label: '待確認報價', tone: 'todo', todo: true, next: '確認費用項目與付款方' },
  awaitDocs: { label: '待補充資料', tone: 'todo', todo: true, next: '提供購買證明，以便商家認定保固' },
  awaitWarranty: { label: '保固認定中', tone: 'wait', todo: false, next: '商家認定期間不需寄件或先行付款' },
  reviewing: { label: '專人處理中', tone: 'wait', todo: false, next: '平台窗口確認後將通知您' },
  inTransit: { label: '運送中', tone: 'ok', todo: false, next: '各段交接由合作方回報後更新' },
};

const WARRANTY = { in: '保固內', out: '保固外', pending: '保固待認定' };
const ROUTE = { domestic: '國內維修', overseas: '原廠海外維修', tbd: '處理方式待確認' };
const PAYER = { buyer: '消費者負擔', merchant: '商家負擔', pending: '待保固認定', tbd: '待確認' };

// Screen titles and the screen a back button returns to. Tab roots have no parent.
const VIEW_META = {
  home: { title: '售後共享車', parent: null },
  cases: { title: '維修案件', parent: null },
  about: { title: '服務說明', parent: null },
  lookup: { title: '維修據點查詢', parent: 'home' },
  triage: { title: '問題排查', parent: 'home' },
  consent: { title: '服務內容與費用', parent: 'triage' },
  submitted: { title: '申請已送出', parent: 'home' },
  case: { title: '案件詳情', parent: 'cases' },
  quote: { title: '確認報價', parent: 'case' },
  ship: { title: '寄件方式', parent: 'case' },
  docs: { title: '補充資料', parent: 'case' },
};
const TABS = ['home', 'cases', 'about'];
// Which bottom tab is highlighted for a view: walk up parents to a root.
function tabOf(view) {
  let v = view;
  for (let i = 0; i < 10 && VIEW_META[v] && VIEW_META[v].parent; i++) v = VIEW_META[v].parent;
  return TABS.includes(v) ? v : 'home';
}

// Who pays a fee line. Service fee: consumer. Exceptions: never auto-assigned.
function payerOf(warranty, key) {
  if (key === 'service') return 'buyer';
  if (key === 'exception') return 'tbd';
  if (warranty === 'in') return 'merchant';
  if (warranty === 'out') return 'buyer';
  return 'pending';
}

// Amount the consumer is asked to approve in this quote (service fee was approved earlier, separately).
function quoteDueFromBuyer(c) {
  return c.lines.reduce((sum, l) =>
    l.key !== 'service' && l.amount != null && payerOf(c.warranty, l.key) === 'buyer' ? sum + l.amount : sum, 0);
}

function line(key, label, amount) { return { key, label, amount }; }
const EXCEPTION_LINE = line('exception', '檢測、清關、保險、退回等例外費用', null);

// Scenario cases (pitch): overseas-bought products Taiwan service may not accept. Categories only, no real brands.
// SR-D101 assumes a partner-brand arrangement for local repair; it does not claim any real brand cooperates.
function seedCases() {
  return [
    {
      id: 'SR-D101', product: '無線耳機（日本購入）', ill: 'buds', origin: '日本購入', local: '合作維修點可處理（合作品牌情境）',
      route: 'domestic', warranty: 'in', status: 'awaitShip', stage: 3, quoteReady: true, quoteConsented: true, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', 1200), line('shipping', '國內來回運費', 300), EXCEPTION_LINE],
      events: [
        ['11/08 10:12', '您', '排查後左耳仍無聲音，確認服務費，申請專人處理'],
        ['11/08 15:40', '平台窗口', '遠端判讀：左耳單元故障，充電與配對正常；國內合作維修點可處理'],
        ['11/09 09:05', '商家', '確認保固內，維修費與運費由商家負擔'],
        ['11/09 09:30', '您', '確認寄件前報價'],
      ],
    },
    {
      id: 'SR-D102', product: '遊戲主機（日版）', ill: 'console', origin: '日本購入（日版）', local: '國內無受理據點，需送日本原廠',
      route: 'overseas', warranty: 'out', status: 'awaitQuote', stage: 2, quoteReady: true, quoteConsented: false, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '原廠維修費', 3800), line('shipping', '寄送至國內集運點運費', 150),
        line('intl', '國際來回運輸（集運）', 2400), EXCEPTION_LINE],
      events: [
        ['11/06 20:18', '您', '主機無法讀取遊戲片，確認服務費，申請專人處理'],
        ['11/07 11:02', '原廠技術人員', '影片判讀：讀取模組異常，需由日本原廠維修站處理'],
        ['11/09 16:45', '平台窗口', '原廠報價已送達；寄件只需寄到國內集運點，不需自備日本收件地址'],
      ],
    },
    {
      id: 'SR-D103', product: '吹風機（日本購入）', ill: 'dryer', origin: '日本購入（日本規格）', local: '待商家確認',
      route: 'tbd', warranty: 'pending', status: 'awaitDocs', stage: 1, quoteReady: false, quoteConsented: false, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', null), line('shipping', '運費', null), EXCEPTION_LINE],
      events: [
        ['11/10 13:20', '您', '吹風機運轉中自動斷電，確認服務費，申請專人處理'],
        ['11/10 18:02', '平台窗口', '商家需要購買證明以認定保固；認定前不需寄件或付款'],
      ],
    },
  ];
}

function freshTriage() { return { step: 'product', issue: null, photo: false, idx: 0, log: [], caseId: null }; }

function createState() {
  return {
    view: 'home', caseId: null, cases: seedCases(), triage: freshTriage(),
    lookup: { brand: 'A', model: '', region: 'abroad', result: null }, consentChecked: false, open: {}, seq: 104, chats: {},
  };
}

const todos = (s) => s.cases.filter((c) => STATUS[c.status].todo);
const findCase = (s, id) => s.cases.find((c) => c.id === id);
const addEvent = (c, who, text) => c.events.push(['剛剛', who, text]);

// Second consent: quote before shipping. Gated by checkbox.
function consentQuote(s, id, checked) {
  const c = findCase(s, id);
  if (!c || !checked || c.status !== 'awaitQuote' || c.warranty === 'pending') return false;
  c.quoteConsented = true;
  c.status = 'awaitShip';
  c.stage = SHIP_STAGE[c.route];
  addEvent(c, '您', '確認寄件前報價');
  return true;
}

function markShipped(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitShip' || !c.quoteConsented || c.warranty === 'pending') return false;
  c.status = 'inTransit';
  c.stage += 1;
  c.tracking = 'EX-' + id.slice(-3) + '-01';
  addEvent(c, '您', '登記寄件，追蹤號 ' + c.tracking);
  return true;
}

function submitDocs(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitDocs') return false;
  c.status = 'awaitWarranty';
  c.stage = 2;
  addEvent(c, '您', '提供購買證明（示範圖片）');
  return true;
}

// Preview-tools only (operator, not a buyer action): merchant confirms in-warranty; Japan-spec unit goes to the Japanese factory.
function simulateWarrantyResult(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitWarranty') return false;
  c.warranty = 'in';
  c.route = 'overseas';
  c.lines = [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '原廠維修費', 2600), line('shipping', '寄送至國內集運點運費', 150),
    line('intl', '國際來回運輸（集運）', 2200), EXCEPTION_LINE];
  c.quoteReady = true;
  c.status = 'awaitQuote';
  c.stage = 2;
  c.local = '國內無受理據點，需送日本原廠';
  addEvent(c, '商家', '認定為保固內，維修費與運費由商家負擔；日本規格機種送日本原廠');
  return true;
}

// First consent: service fee before a human takes the case. Returns new case id, or null.
function submitHandoff(s) {
  if (!s.consentChecked || s.triage.caseId) return null;
  const id = 'SR-D' + s.seq++;
  const danger = s.triage.issue === 'danger';
  s.cases.unshift({
    id, product: '無線耳機（日本購入）', ill: 'buds', origin: '日本購入', local: '待確認',
    route: 'tbd', warranty: 'pending', status: 'reviewing', stage: 1, quoteReady: false, quoteConsented: false, tracking: null,
    lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', null), line('shipping', '運費', null), EXCEPTION_LINE],
    events: [['剛剛', '您', danger ? '回報安全疑慮，申請專人評估' : '確認服務費，申請專人處理'],
      ['剛剛', '系統', '已附上排查紀錄']],
  });
  s.triage.caseId = id;
  return id;
}

/* Troubleshooting scripts: scenario content for the preview, not a real manual or a brand's instructions. */
const ISSUES = [
  { key: 'oneside', label: '只有單邊耳機有聲音' },
  { key: 'pair', label: '無法與手機配對' },
  { key: 'charge', label: '放入充電盒後無法充電' },
  { key: 'danger', label: '耳機或充電盒發燙、膨脹或有焦味', danger: true },
];
const SCRIPTS = {
  oneside: [
    { text: '請將兩耳放回充電盒充電 10 分鐘，確認充電盒指示燈亮起後再取出試聽。', src: '情境手冊・第 2 章 充電' },
    { text: '請在手機的聲音設定確認左右聲道平衡位於中間；再於藍牙設定刪除此耳機，重新配對一次。', src: '情境手冊・第 3 章 配對與聲道' },
  ],
  pair: [
    { text: '請關閉後再開啟手機藍牙，並確認耳機沒有同時連著其他裝置。', src: '情境手冊・第 3 章 配對' },
    { text: '請在手機刪除此耳機的配對紀錄。將耳機放回充電盒並開蓋，長按充電盒按鈕約 10 秒重設，再重新配對。', src: '情境手冊・第 3.2 節 重設' },
  ],
  charge: [
    { text: '請更換充電線與插座，確認充電盒指示燈是否亮起。', src: '情境手冊・第 2 章 充電' },
    { text: '請以乾燥棉花棒輕拭耳機與充電盒的金屬接點，並確認耳機確實放入定位。', src: '情境手冊・第 2.3 節 接點清潔' },
  ],
};

function chooseIssue(s, key) {
  s.triage.issue = key;
  s.triage.step = key === 'danger' ? 'safety' : 'photo';
}

function startChat(s) {
  const t = s.triage;
  t.step = 'chat';
  t.idx = 0;
  t.log = [{ from: 'ai', ...SCRIPTS[t.issue][0] }];
}

// answer: 'solved' | 'notyet' | 'human' | 'danger'
function replyTriage(s, answer) {
  const t = s.triage;
  if (t.step !== 'chat') return;
  if (answer === 'solved') { t.step = 'resolved'; return; }
  if (answer === 'danger') { t.issue = 'danger'; t.step = 'safety'; return; }
  if (answer === 'human') { t.step = 'handoff'; return; }
  t.log.push({ from: 'me', text: '已完成此步驟，問題尚未排除。' });
  t.idx += 1;
  const next = SCRIPTS[t.issue][t.idx];
  if (next) t.log.push({ from: 'ai', ...next });
  else t.step = 'handoff';
}

/* Fictional lookup data. No real store, certification, or contact. */
const BRANDS = { A: '無線耳機', B: '遊戲主機', C: '吹風機' };
function lookupPoints(brand, region) {
  const overseasNote = region === 'abroad' ? '海外購買的商品，是否受理須由店家確認。' : null;
  const points = {
    A: [{ name: '示範代理商服務窗口', scope: '耳機類（以店家公告為準）', abroad: '海外購買品：資料待店家確認', checked: '資料查核日：示範資料' }],
    B: [],
    C: [{ name: '示範家電維修點・北區', scope: '吹風機等美容家電（以店家公告為準）', abroad: '海外購買品：不同電壓規格可能無法受理，請先洽詢', checked: '資料查核日：示範資料' }],
  }[brand] || [];
  return { points, overseasNote };
}

/* Case conversation: scripted replies shown in the case panel. In-memory only; no real person or message. */
function contactTopics(c) {
  const t = [{ key: 'progress', q: '目前處理到哪裡？', a: '目前為「' + STATUS[c.status].label + '」。下一步：' + STATUS[c.status].next + '。' }];
  if (c.status === 'awaitQuote') t.push({ key: 'quote', q: '報價包含哪些項目？', a: '報價列出維修費、運費與付款方。例外費用發生時會先報價，未經您同意不收取；同意前不會寄件或施工。' });
  if (c.status === 'awaitDocs' || c.status === 'awaitWarranty') t.push({ key: 'docs', q: '購買證明可以用什麼？', a: '收據、電子發票或訂單截圖皆可，需看得到購買日期與店家。保固認定前不需寄件，也不需先行付款。' });
  if (c.route === 'overseas') t.push({ key: 'address', q: '需要自己準備日本的收件地址嗎？', a: '不需要。您只要寄到國內集運點，出口、日本原廠維修與運回台灣由平台與集運商交接，每段都會更新進度。' });
  if (c.route === 'domestic') t.push({ key: 'ship', q: '寄件時要注意什麼？', a: '請標示案件編號並妥善包裝；保固內運費由商家負擔，不需先行支付。' });
  return t;
}
function askContact(s, id, key) {
  const c = findCase(s, id);
  const topic = c && contactTopics(c).find((x) => x.key === key);
  const log = (s.chats[id] = s.chats[id] || []);
  if (!topic || log.some((m) => m.key === key)) return false; // each question once per case
  log.push({ key, q: topic.q, a: topic.a });
  return true;
}

// The screen actually allowed for the current state. Guards navigation (incl. browser/native Back)
// so stale history can't reopen a consent form, a finished quote, or a confirmation without a case.
function resolveView(s, view) {
  if (!VIEW_META[view]) return 'home';
  const c = s.caseId ? findCase(s, s.caseId) : null;
  if (['case', 'quote', 'ship', 'docs'].includes(view) && !c) return 'cases';
  if (view === 'quote' && c.status !== 'awaitQuote') return 'case';
  if (view === 'ship' && !(c.status === 'awaitShip' && c.quoteConsented)) return 'case';
  if (view === 'docs' && c.status !== 'awaitDocs') return 'case';
  if (view === 'submitted' && !s.triage.caseId) return 'home';
  if (view === 'consent' && !['handoff', 'safety'].includes(s.triage.step)) return 'triage';
  return view;
}

const money = (n) => 'NT$ ' + n.toLocaleString('en-US');

if (typeof module !== 'undefined') {
  module.exports = { createState, payerOf, quoteDueFromBuyer, todos, consentQuote, markShipped, submitDocs,
    simulateWarrantyResult, submitHandoff, chooseIssue, contactTopics, askContact, startChat, replyTriage, lookupPoints, STAGES, SCRIPTS, findCase,
    STATUS, PAYER, VIEW_META, TABS, tabOf, resolveView, SAMPLE_PRICE_NOTE };
}

/* ================= UI ================= */

if (typeof document !== 'undefined') (function () {
  let S = createState();
  let timer = null;
  let snackTimer = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const screen = document.getElementById('screen');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Element builder: strings become text nodes, never HTML.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c);
    return el;
  }
  function svg(id, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', cls || 'ic');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  }
  // act: stable hook for tests (data-act), independent of copy.
  const btn = (label, onclick, cls, act, extra) => h('button', { type: 'button', class: cls || 'btn', onclick, 'data-act': act, ...extra }, label);
  const sampleTag = (text) => h('span', { class: 'sample-tag' }, text || SAMPLE_PRICE_NOTE);

  function snack(msg) {
    const t = document.getElementById('snackbar');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  // Each navigation pushes a history entry so LINE's native Return button
  // (MINI App header) steps back through screens instead of leaving the app.
  // history.state = { view, caseId, gen, stack }: stack is this app's entries from the
  // first one up to this one, so in-page Back can pop to the real parent entry.
  let gen = Date.now(); // new per load, bumped on reset: older entries never restore old screens
  let backing = false; // a history.go() is in flight; ignore repeat Back taps until popstate
  function go(view, extra, mode) {
    clearTimeout(timer);
    closeChat(false); // any navigation (incl. native Back) closes the case conversation
    Object.assign(S, extra || {});
    S.view = resolveView(S, view);
    const cur = history.state || {};
    const stack = cur.stack || [];
    const entry = { view: S.view, caseId: S.caseId };
    if (mode === 'replace') history.replaceState({ ...entry, gen, stack: stack.slice(0, -1).concat(entry) }, '');
    else if (!(cur.view === S.view && cur.caseId === S.caseId)) history.pushState({ ...entry, gen, stack: stack.concat(entry) }, '');
    render(true);
  }
  window.addEventListener('popstate', (e) => {
    backing = false;
    const st = e.state;
    if (!st || st.gen !== gen) { // pre-reset entry: show home, never the old case
      history.replaceState({ view: 'home', caseId: null, gen, stack: [{ view: 'home', caseId: null }] }, '');
      go('home', { caseId: null, consentChecked: false }, 'replace');
      return;
    }
    go(st.view, { caseId: st.caseId, consentChecked: false }, 'replace'); // replace: record any resolveView redirect
  });
  // In-page Back / "done" actions: same history as native Return. Pop to the nearest
  // parent entry; with no parent below (e.g. todo → case detail), swap this entry for the parent.
  function back(parent, extra) {
    if (backing) return;
    Object.assign(S, extra || {});
    const stack = (history.state || {}).stack || [];
    for (let i = stack.length - 2; i >= 0; i--) {
      if (stack[i].view === parent && (parent !== 'case' || stack[i].caseId === S.caseId)) { backing = true; return history.go(i - (stack.length - 1)); }
    }
    go(parent, null, 'replace');
  }
  function openCase(id) { go('case', { caseId: id }); }

  function reset() {
    clearTimeout(timer);
    S = createState();
    gen++;
    history.replaceState({ view: 'home', caseId: null, gen, stack: [{ view: 'home', caseId: null }] }, '');
    closeSheet(false);
    render(true);
    snack('已重設為初始展示資料');
  }

  // In-page navigation row. In LINE the MINI App's native header sits above this,
  // so we never draw a close button or repeat the app name here.
  function subnav(title, onBack) {
    return h('div', { class: 'subnav' },
      onBack ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': '返回', 'data-act': 'back', onclick: onBack }, svg('i-back')) : h('span', { class: 'icon-spacer' }),
      h('h1', { class: 'subnav-title', tabindex: '-1' }, title),
      h('span', { class: 'icon-spacer' }));
  }
  const backTo = (view) => () => back(view);

  function statusTag(c) {
    const st = STATUS[c.status];
    return h('span', { class: 'tag tag-' + st.tone }, st.label);
  }
  const warrantyTag = (c) => h('span', { class: 'tag ' + (c.warranty === 'pending' ? 'tag-pending' : 'tag-plain') }, WARRANTY[c.warranty]);
  const routeTag = (c) => h('span', { class: 'tag tag-plain' }, ROUTE[c.route]);

  // Expand/collapse that updates the DOM directly so focus stays on the button.
  function toggle(key, label, body, act) {
    const id = 'panel-' + key.replace(/[^a-z0-9]/gi, '');
    const open = !!S.open[key];
    const panel = h('div', { class: 'panel', id, hidden: !open }, body);
    const b = h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(open), 'aria-controls': id, 'data-act': act }, h('span', {}, label), svg('i-down', 'ic chev'));
    b.addEventListener('click', () => {
      S.open[key] = !S.open[key];
      b.setAttribute('aria-expanded', String(S.open[key]));
      panel.hidden = !S.open[key];
    });
    return [b, panel];
  }

  const listRow = ({ icon, ill, title, sub, right, onclick, act, cls }) => h('li', {},
    h('button', { type: 'button', class: 'row' + (cls ? ' ' + cls : ''), onclick, 'data-act': act },
      ill ? svg('ill-' + ill, 'row-thumb') : icon ? h('span', { class: 'row-icon' }, svg(icon)) : null,
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
      right ? h('span', { class: 'row-right' }, right) : null,
      svg('i-chev', 'ic chev')));

  /* ---------- Views ---------- */

  function viewHome() {
    const list = todos(S);
    return [
      h('header', { class: 'home-head' },
        h('p', { class: 'brand' }, svg('ill-mark', 'brand-mark'), h('span', {}, '售後共享車 Share Repair')),
        h('h1', { class: 'home-title', tabindex: '-1' }, '產品售後服務'),
        h('p', { class: 'home-desc' }, '海外購入商品的維修查詢、問題排查與跨境送修')),
      h('section', { class: 'block block-cta' },
        btn([svg('i-spark'), '開始問題排查'], () => go('triage', { triage: freshTriage() }), 'btn btn-primary', 'start-triage'),
        h('p', { class: 'caption' }, '問題排查免費。需要專人處理時，會先說明服務內容與費用。')),
      list.length ? h('section', { class: 'block', 'aria-labelledby': 'todo-h' },
        h('h2', { class: 'list-header', id: 'todo-h' }, '待處理事項', h('span', { class: 'count-badge', 'aria-label': list.length + ' 件' }, String(list.length))),
        h('ul', { class: 'list' }, list.map((c) => listRow({
          ill: c.ill, title: c.product + '・' + STATUS[c.status].label, sub: c.id + '｜' + STATUS[c.status].next,
          onclick: () => openCase(c.id), act: 'todo-' + c.id,
        })))) : null,
      h('section', { class: 'block', 'aria-labelledby': 'svc-h' },
        h('h2', { class: 'list-header', id: 'svc-h' }, '服務'),
        h('ul', { class: 'list' },
          listRow({ icon: 'i-cases', title: '維修案件', sub: '查看處理進度、報價與寄件方式', right: S.cases.length + ' 件', onclick: () => go('cases'), act: 'go-cases' }),
          listRow({ icon: 'i-search', title: '維修據點查詢', sub: '查詢台灣是否有可處理的據點', onclick: () => go('lookup'), act: 'go-lookup' }))),
      h('section', { class: 'block', 'aria-labelledby': 'flow-h' },
        h('h2', { class: 'list-header', id: 'flow-h' }, '海外購入商品如何送修'),
        h('ol', { class: 'tiers' }, [
          ['標示購買地與版本', '先查台灣是否受理；海外版是否受理，由店家確認後告知您'],
          ['說明故障並排查', '依手冊逐步排查（免費），照片與紀錄供專人遠端判讀'],
          ['寄到國內單一收件點', '需送原廠時寄到國內集運點，不需自備海外地址或託親友代寄'],
          ['跨境交接逐段追蹤', '出口、原廠維修、運回台灣，每段由合作方回報'],
          ['一個平台窗口', '與商家、原廠、維修團隊及集運商的溝通統一處理'],
        ].map(([a, b]) => h('li', {}, h('span', { class: 'row-title' }, a), h('p', { class: 'caption' }, b))))),
    ];
  }

  function viewLookup() {
    const L = S.lookup;
    const brandSel = h('select', { id: 'f-brand', class: 'field' },
      Object.entries(BRANDS).map(([k, v]) => h('option', { value: k, selected: L.brand === k }, v)));
    const model = h('input', { id: 'f-model', class: 'field', type: 'text', maxlength: '40', placeholder: '商品銘牌上的型號', autocomplete: 'off', 'aria-describedby': 'f-model-help' });
    model.value = L.model;
    const region = (val, label) => h('label', { class: 'seg' },
      h('input', { type: 'radio', name: 'region', value: val, checked: L.region === val, 'data-act': 'region-' + val }), h('span', {}, label));
    const form = h('form', { class: 'block form', onsubmit: (e) => {
      e.preventDefault();
      L.brand = brandSel.value;
      L.model = model.value.trim();
      L.region = form.querySelector('input[name=region]:checked').value;
      L.result = lookupPoints(L.brand, L.region);
      render(false);
      const r = document.getElementById('lookup-result');
      if (r) r.focus();
    } },
      h('label', { for: 'f-brand', class: 'label' }, '商品類別'), brandSel,
      h('label', { for: 'f-model', class: 'label' }, '型號'), model,
      h('p', { class: 'help', id: 'f-model-help' }, '選填。可在商品銘牌或說明書找到。'),
      h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, '購買地區'),
        h('div', { class: 'seg-row' }, region('tw', '台灣'), region('abroad', '海外'))),
      h('button', { type: 'submit', class: 'btn btn-primary', 'data-act': 'lookup-submit' }, '查詢'));

    let result = null;
    if (L.result) {
      const { points, overseasNote } = L.result;
      result = h('section', { class: 'block', id: 'lookup-result', tabindex: '-1', 'aria-live': 'polite', 'aria-labelledby': 'res-h' },
        h('h2', { class: 'list-header', id: 'res-h' }, '查詢結果'),
        h('div', { class: 'block-body' },
          h('p', { class: 'caption' }, '以下為虛構的示範資料。'),
          L.model ? h('p', { class: 'caption' }, '輸入型號：', h('b', {}, L.model)) : null,
          overseasNote ? h('p', { class: 'note note-warn' }, svg('i-alert'), overseasNote) : null),
        points.length ? h('ul', { class: 'list points' }, points.map((p, i) => h('li', { class: 'point' },
          h('p', { class: 'point-name' }, svg('i-pin'), p.name),
          h('p', {}, '可處理：' + p.scope), h('p', {}, p.abroad), h('p', { class: 'caption' }, p.checked),
          btn('洽詢此據點', () => snack('洽詢時請說明購買地區與型號，並確認海外購買品是否受理'), 'btn btn-outline btn-sm', 'point-ask-' + i))))
          : h('div', { class: 'block-body empty' }, h('p', { class: 'row-title' }, '查無台灣據點資料'), h('p', { class: 'caption' }, '可先進行問題排查，或由專人確認是否需送原廠處理。')),
        h('div', { class: 'block-body' },
          h('p', { class: 'caption' }, '列出的據點不代表一定受理，也不代表已取得任何認證；實際以店家回覆為準。'),
          btn('開始問題排查', () => go('triage', { triage: freshTriage() }), 'btn btn-outline', 'lookup-to-triage')));
    }
    return [subnav(VIEW_META.lookup.title, backTo('home')),
      h('p', { class: 'intro' }, '先確認台灣是否已有可處理的店家。可直接處理時，不需使用付費服務。'), form, result];
  }

  function viewTriage() {
    const t = S.triage;
    const title = VIEW_META.triage.title;
    const step = (n) => h('ol', { class: 'progress', 'aria-label': '排查步驟' },
      ['商品', '問題', '照片', '排查'].map((x, i) => h('li', { class: i < n ? 'done' : i === n ? 'now' : '', 'aria-current': i === n ? 'step' : null }, x)));
    const actions = (...b) => h('div', { class: 'actions' }, b);

    if (t.step === 'product') {
      return [subnav(title, backTo('home')), step(0),
        h('section', { class: 'block' },
          h('h2', { class: 'list-header' }, '確認商品'),
          h('div', { class: 'product' }, svg('ill-buds', 'product-ill'),
            h('div', {}, h('p', { class: 'row-title' }, '無線耳機'), h('p', { class: 'caption' }, '購買地區：日本・海外版'),
              h('span', { class: 'tags' }, h('span', { class: 'tag tag-pending' }, '台灣受理待確認')))),
          h('p', { class: 'block-body caption' }, '請確認商品資訊，後續將依型號與購買地區確認受理方式。')),
        actions(btn('確認商品', () => { t.step = 'issue'; render(true); }, 'btn btn-primary', 'confirm-product'))];
    }
    if (t.step === 'issue') {
      return [subnav(title, () => { t.step = 'product'; render(true); }), step(1),
        h('section', { class: 'block' },
          h('h2', { class: 'list-header' }, '請選擇目前的狀況'),
          h('ul', { class: 'list' }, ISSUES.map((o) => h('li', {},
            h('button', { type: 'button', class: 'row' + (o.danger ? ' row-danger' : ''), 'data-act': 'issue-' + o.key, onclick: () => { chooseIssue(S, o.key); render(true); } },
              h('span', { class: 'row-icon' }, svg(o.danger ? 'i-alert' : 'i-chat')),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, o.label)), svg('i-chev', 'ic chev'))))))];
    }
    if (t.step === 'photo') {
      return [subnav(title, () => { t.step = 'issue'; render(true); }), step(2),
        h('section', { class: 'block' },
          h('h2', { class: 'list-header' }, '上傳照片（選填）'),
          h('div', { class: 'block-body' },
            h('p', { class: 'caption' }, '照片有助於專人遠端判讀。'),
            h('button', { type: 'button', class: 'photo' + (t.photo ? ' photo-on' : ''), 'aria-pressed': String(t.photo), 'data-act': 'photo', onclick: () => { t.photo = !t.photo; render(false); } },
              t.photo ? [svg('ill-buds', 'photo-ill'), h('span', { class: 'photo-cap' }, svg('i-check'), '已附上照片（再按一次可移除）')]
                : [svg('i-camera', 'ic photo-ic'), h('span', { class: 'row-title' }, '使用示範照片'), h('span', { class: 'caption' }, '以內建插圖代替實際拍攝')]))),
        actions(btn(t.photo ? '開始排查' : '略過，開始排查', () => { startChat(S); render(true); }, 'btn btn-primary', 'start-chat'))];
    }
    if (t.step === 'chat') {
      const typing = !!t.typing;
      return [subnav(title, backTo('home')), step(3),
        h('div', { class: 'chat', role: 'log', 'aria-label': '排查紀錄' },
          h('p', { class: 'chat-meta' }, ISSUES.find((i) => i.key === t.issue).label + (t.photo ? '・已附照片' : '')),
          t.log.map((m, i) => (typing && i === t.log.length - 1 && m.from === 'ai')
            ? h('div', { class: 'bubble ai typing', 'aria-label': '正在查詢手冊' }, h('span'), h('span'), h('span'))
            : h('div', { class: 'bubble ' + m.from }, m.from === 'ai' ? h('span', { class: 'bubble-who' }, '排查建議') : null,
              h('p', {}, m.text), m.src ? h('span', { class: 'src' }, '參考：' + m.src) : null))),
        typing ? null : h('div', { class: 'actions' },
          h('p', { class: 'caption' }, '完成上述步驟後，請選擇結果。'),
          h('div', { class: 'two' },
            btn('問題尚未排除', () => { replyTriage(S, 'notyet'); typeIn(); }, 'btn btn-outline', 'not-yet'),
            btn('問題已排除', () => { replyTriage(S, 'solved'); render(true); }, 'btn btn-primary', 'solved')),
          h('div', { class: 'two' },
            btn('改由專人處理', () => { replyTriage(S, 'human'); render(true); }, 'btn btn-ghost btn-sm', 'to-human'),
            btn([svg('i-alert'), '發燙、膨脹或焦味'], () => { replyTriage(S, 'danger'); render(true); }, 'btn btn-ghost-danger btn-sm', 'danger')))];
    }
    if (t.step === 'resolved') {
      return [subnav('排查完成', backTo('home')),
        h('section', { class: 'result-panel' }, h('span', { class: 'result-ic' }, svg('i-check')),
          h('h2', {}, '問題已排除'), h('p', {}, '本次排查不收取費用，也未建立付費案件。'),
          h('p', { class: 'caption' }, '若同一問題再次發生，可重新開始排查。')),
        actions(btn('回到首頁', backTo('home'), 'btn btn-primary', 'home'))];
    }
    if (t.step === 'safety') {
      return [subnav('安全提示', backTo('home')),
        h('section', { class: 'safety', role: 'alert' },
          h('h2', {}, svg('i-alert'), '請立即停止使用'),
          h('ol', {}, h('li', {}, '停止充電並拔除充電線，不要再配戴。'), h('li', {}, '請勿拆開、擠壓或刺破耳機與充電盒。'),
            h('li', {}, '將商品放在遠離可燃物的不燃表面，例如磁磚地面。'), h('li', {}, '如持續冒煙或起火，請撥打 119。')),
          h('p', { class: 'free' }, svg('i-shield'), '安全提示不收取費用。')),
        h('p', { class: 'intro' }, '如需後續處理，專人會先評估能否安全運送；評估完成前不會安排寄件。'),
        actions(btn('查看服務內容與費用', () => go('consent', { consentChecked: false }), 'btn btn-outline', 'to-consent'),
          btn('回到首頁', backTo('home'), 'btn btn-ghost', 'home'))];
    }
    // handoff
    return [subnav(title, backTo('home')),
      h('section', { class: 'block' },
        h('h2', { class: 'list-header' }, '建議由專人處理'),
        h('p', { class: 'block-body' }, '手冊建議的步驟已完成。專人會依排查紀錄聯繫原廠並安排後續處理，不需重新說明問題。')),
      actions(btn('查看服務內容與費用', () => go('consent', { consentChecked: false }), 'btn btn-primary', 'to-consent'),
        btn('暫不需要', backTo('home'), 'btn btn-ghost', 'home'))];
  }

  // Simulated lookup delay; cancelled by any navigation or reset.
  function typeIn() {
    const t = S.triage;
    if (t.step !== 'chat' || reduceMotion) { render(false); return; }
    t.typing = true;
    render(false);
    clearTimeout(timer);
    timer = setTimeout(() => { t.typing = false; render(false); }, 900);
  }

  const feeRow = (label, note, value, payer, payerKey) => h('div', { class: 'fee' },
    h('div', { class: 'fee-main' }, h('span', {}, label), note ? h('span', { class: 'caption' }, note) : null),
    h('div', { class: 'fee-side' }, h('b', {}, value), payer ? h('span', { class: 'tag payer-' + payerKey }, payer) : null));

  function viewConsent() {
    const already = S.triage.caseId;
    const submit = btn('申請專人處理', () => {
      const id = submitHandoff(S);
      if (id) go('submitted');
    }, 'btn btn-primary', 'submit-handoff', { disabled: !S.consentChecked || !!already });
    const box = h('input', { type: 'checkbox', id: 'agree', checked: S.consentChecked, disabled: !!already, 'data-act': 'agree' });
    box.addEventListener('change', () => { S.consentChecked = box.checked; submit.disabled = !box.checked; });

    return [subnav(VIEW_META.consent.title, backTo('triage')),
      S.triage.issue === 'danger' ? h('p', { class: 'note note-warn' }, svg('i-alert'), '您回報了安全疑慮：專人會先評估能否安全運送，確認前不安排寄件。') : null,
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '服務內容'),
        h('ul', { class: 'ticks' }, ['平台窗口整理排查紀錄與照片', '聯繫商家或原廠進行遠端判讀', '確認保固狀態與後續處理方式'].map((x) => h('li', {}, svg('i-check'), x)))),
      h('section', { class: 'block' },
        h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '本階段費用'), sampleTag()),
        h('div', { class: 'fees' },
          feeRow('平台服務費', '專人處理本階段的費用', money(SERVICE_FEE), PAYER.buyer, 'buyer'),
          feeRow('維修費、物流費', '判讀後另行報價；寄件前會再次請您確認', '另行報價'),
          feeRow('例外費用', '檢測、清關、保險、退回等，不會自動由您負擔', '另行報價'))),
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '維修費與運費的負擔方式'),
        h('dl', { class: 'rules' },
          h('dt', {}, '保固內'), h('dd', {}, '消費者負擔服務費；維修費與運費由商家負擔。'),
          h('dt', {}, '保固外'), h('dd', {}, '消費者負擔服務費、維修費與運費，確認報價後才寄件。'),
          h('dt', {}, '保固待認定'), h('dd', {}, '不視為保固外；認定前不寄件，也不需先行付款。'))),
      h('section', { class: 'block' }, toggle('refund', '取消與退款規則', h('p', { class: 'block-body caption' }, '正式規則尚未訂定。展示版本不會收款，也不會建立實際訂單。'), 'refund')),
      h('div', { class: 'agree' }, box, h('label', { for: 'agree' }, '我已了解本階段的服務內容與費用；維修費與物流費將另行報價。')),
      already ? h('p', { class: 'note' }, '本次排查已送出申請（' + already + '），不會重複建立。') : null,
      h('div', { class: 'actions sticky' }, submit)];
  }

  function viewSubmitted() {
    const id = S.triage.caseId;
    return [subnav(VIEW_META.submitted.title, backTo('home')),
      h('section', { class: 'result-panel' }, h('span', { class: 'result-ic' }, svg('i-check')),
        h('h2', {}, '申請已建立'),
        h('p', {}, '案件 ' + id + ' 已加入維修案件。目前保固待認定，確認前不需寄件或付款。'),
        h('p', { class: 'caption' }, '平台窗口會依排查紀錄處理，進度可在案件中查看。')),
      h('div', { class: 'actions' }, btn('查看案件', () => openCase(id), 'btn btn-primary', 'open-new-case'), btn('回到首頁', backTo('home'), 'btn btn-ghost', 'home'))];
  }

  function viewCases() {
    return [h('header', { class: 'page-head' }, h('h1', { class: 'page-title', tabindex: '-1' }, VIEW_META.cases.title),
      h('p', { class: 'caption' }, '每個案件都有平台窗口負責，可隨時查看目前進度與待辦。')),
      h('section', { class: 'block' },
        h('ul', { class: 'list' }, S.cases.map((c) => h('li', {},
          h('button', { type: 'button', class: 'row case-row', 'data-act': 'case-' + c.id, onclick: () => openCase(c.id) },
            svg('ill-' + c.ill, 'row-thumb'),
            h('span', { class: 'row-main' },
              h('span', { class: 'case-top' }, h('span', { class: 'row-title' }, c.product), h('span', { class: 'case-id' }, c.id)),
              h('span', { class: 'tags' }, statusTag(c), warrantyTag(c), routeTag(c)),
              h('span', { class: 'row-sub' }, '下一步：' + STATUS[c.status].next)),
            svg('i-chev', 'ic chev')))))),
    ];
  }

  function feeTable(c) {
    return h('div', { class: 'fees' }, c.lines.map((l) => {
      const p = payerOf(c.warranty, l.key);
      const note = l.key === 'service' ? '申請專人處理時已確認' : l.key === 'exception' ? '發生時先報價，未經同意不收取' : null;
      return feeRow(l.label, note, l.amount != null ? money(l.amount) : p === 'pending' ? '待認定' : '另行報價', PAYER[p], p);
    }));
  }

  function timeline(c) {
    const stages = STAGES[c.route];
    const cur = c.stage;
    const key = c.id + ':tl';
    const open = !!S.open[key];
    const visible = open ? stages : stages.slice(0, Math.min(stages.length, cur + 2));
    const list = h('ol', { class: 'timeline' }, visible.map(([name, who], i) => {
      const st = i < cur ? 'done' : i === cur ? 'now' : 'next';
      return h('li', { class: 'tl tl-' + st, 'aria-current': st === 'now' ? 'step' : null },
        h('span', { class: 'tl-dot' }, st === 'done' ? svg('i-check') : null),
        h('span', { class: 'tl-body' }, h('span', { class: 'tl-name' }, name),
          h('span', { class: 'caption' }, st === 'done' ? '已完成・' + who + '回報' : st === 'now' ? '目前步驟・' + who : '待' + who + '回報')));
    }));
    const more = stages.length > visible.length || open;
    const b = more ? h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(open), 'data-act': 'timeline' },
      h('span', {}, open ? '收合' : '顯示完整進度（' + stages.length + ' 個階段）'), svg('i-down', 'ic chev')) : null;
    if (b) b.addEventListener('click', () => {
      S.open[key] = !S.open[key];
      render(false);
      const again = document.querySelector('[data-act=timeline]');
      if (again) again.focus();
    });
    return [list, b];
  }

  function viewCase() {
    const c = findCase(S, S.caseId);
    if (!c) return viewCases();
    const st = STATUS[c.status];
    let action = null;
    if (c.status === 'awaitShip') action = btn('查看寄件方式', () => go('ship'), 'btn btn-primary', 'go-ship');
    if (c.status === 'awaitQuote') action = btn('確認報價', () => go('quote'), 'btn btn-primary', 'go-quote');
    if (c.status === 'awaitDocs') action = btn('補充購買證明', () => go('docs'), 'btn btn-primary', 'go-docs');

    return [subnav(VIEW_META.case.title, backTo('cases')),
      h('section', { class: 'block status' },
        h('div', { class: 'status-top' }, svg('ill-' + c.ill, 'status-ill'),
          h('div', { class: 'status-text' },
            h('p', { class: 'caption' }, c.product + '｜' + c.id),
            h('p', { class: 'status-now' }, st.label),
            h('span', { class: 'tags' }, warrantyTag(c), routeTag(c)))),
        h('dl', { class: 'kvs case-facts' },
          h('div', { class: 'kv' }, h('dt', {}, '購買地'), h('dd', {}, c.origin)),
          h('div', { class: 'kv' }, h('dt', {}, '台灣受理'), h('dd', {}, c.local))),
        h('p', { class: 'status-next' }, '下一步：' + st.next),
        action ? h('div', { class: 'status-action' }, action) : null,
        c.tracking ? h('p', { class: 'note' }, svg('i-truck'), '追蹤號 ' + c.tracking) : null),
      // Buyers can't approve warranty; the presenter advances the scene from the preview tools.
      c.status === 'awaitWarranty' ? h('section', { class: 'block preview-ctrl' },
        h('p', { class: 'caption' }, '等待商家認定保固。展示時可由展示工具推進情境。'),
        btn('推進展示情境', openSheet, 'btn btn-ghost btn-sm', 'advance-scene')) : null,

      h('section', { class: 'block' },
        h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '費用與付款方'), sampleTag()),
        h('p', { class: 'block-body caption' }, c.warranty === 'in' ? '保固內：消費者負擔服務費；維修費與運費由商家負擔。'
          : c.warranty === 'out' ? '保固外：服務費、維修費與運費由消費者負擔，逐項確認。'
            : '保固待認定：不視為保固外；認定前不寄件，也不需先行付款。'),
        toggle(c.id + ':fees', '費用明細', feeTable(c), 'fees')),

      h('section', { class: 'block' },
        h('h2', { class: 'list-header' }, c.route === 'overseas' ? '處理進度：國內集運 → 原廠維修 → 運回台灣' : '處理進度'),
        timeline(c),
        toggle(c.id + ':log', '案件紀錄（' + c.events.length + '）',
          h('ul', { class: 'events' }, c.events.slice().reverse().map(([t, who, text]) =>
            h('li', {}, h('span', { class: 'caption' }, t + '・' + who), h('p', {}, text)))), 'log')),

      h('section', { class: 'block contact' },
        h('span', { class: 'row-icon' }, svg('i-user')),
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '平台窗口'), h('span', { class: 'row-sub' }, '與商家、原廠、維修團隊及集運商的溝通，由平台窗口統一處理。')),
        btn('聯絡窗口', (e) => openChat(c.id, e.currentTarget), 'btn btn-outline btn-sm', 'contact'))];
  }

  function viewQuote() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitQuote') return viewCase();
    const due = quoteDueFromBuyer(c);
    const box = h('input', { type: 'checkbox', id: 'agree-q', 'data-act': 'agree-quote' });
    const ok = btn('同意報價', () => {
      if (consentQuote(S, c.id, box.checked)) { back('case'); snack('已確認報價，可查看寄件方式'); }
    }, 'btn btn-primary', 'consent-quote', { disabled: true });
    box.addEventListener('change', () => { ok.disabled = !box.checked; });
    return [subnav(VIEW_META.quote.title, backTo('case')),
      h('p', { class: 'intro' }, c.product + '｜' + c.id + '・' + WARRANTY[c.warranty] + '・' + ROUTE[c.route]),
      h('section', { class: 'block' },
        h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '寄件前報價'), sampleTag()),
        feeTable(c),
        h('div', { class: 'due' }, h('span', {}, '本次報價消費者負擔'), h('b', {}, money(due))),
        h('p', { class: 'block-body caption' }, due === 0 ? '保固內：維修費與運費由商家負擔，請確認處理方式。' : '服務費已於申請專人處理時確認，不含在本次報價。')),
      c.route === 'overseas' ? h('p', { class: 'note' }, svg('i-globe'), '路線：寄送至國內集運點 → 出口至原廠維修 → 以集運方式運回台灣。不需自備海外收件地址；預估時間待合作方回報。') : null,
      h('div', { class: 'agree' }, box, h('label', { for: 'agree-q' }, '我已確認報價項目、金額與付款方；同意前不會寄件或施工。')),
      h('div', { class: 'actions sticky' }, ok,
        btn('暫不同意，先聯絡窗口', (e) => openChat(c.id, e.currentTarget), 'btn btn-ghost', 'quote-later'))];
  }

  const PACKING = {
    buds: '請將耳機放回充電盒一併寄送；充電線不需寄送',
    console: '僅寄送主機本體；手把、電源線與遊戲片請自行保留',
    dryer: '請附上吹風嘴等配件，並先清除進風口濾網的灰塵',
  };

  function viewShip() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitShip' || !c.quoteConsented) return viewCase();
    const overseas = c.route === 'overseas';
    const item = (k, v) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v));
    return [subnav(VIEW_META.ship.title, backTo('case')),
      h('p', { class: 'intro' }, overseas ? '請寄送至國內集運點，由集運商安排出口至原廠。不需自備海外收件地址或託親友代寄。' : '請寄送至國內合作維修點，維修完成後寄回。'),
      h('section', { class: 'block' },
        h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, overseas ? '國內集運點' : '合作維修點'), sampleTag('展示收件資訊，請勿寄送實物')),
        h('dl', { class: 'kvs' },
          item('收件單位', overseas ? '示範集運點' : '示範合作維修點・北區'),
          item('地址', '○○市○○區示範路 1 號'),
          item('案件編號', c.id + '（請標示於外箱）'),
          item('寄件方式', '自行至超商或宅配寄件，取得追蹤號後於此登記'))),
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '包裝與配件'),
        h('ul', { class: 'ticks' }, [
          '請使用原廠紙箱或緩衝材妥善包裝',
          PACKING[c.ill],
          '請勿放入現金、證件或個人物品',
          overseas ? '含電池等受限品項，寄送前請先洽詢窗口' : null,
          c.warranty === 'in' ? '保固內運費由商家負擔，不需先行支付' : '運費已列於您同意的報價中',
        ].filter(Boolean).map((x) => h('li', {}, svg('i-check'), x)))),
      h('div', { class: 'actions sticky' },
        btn('登記已寄出', () => { markShipped(S, c.id); back('case', { open: { ...S.open, [c.id + ':tl']: true } }); snack('已登記寄件，可在處理進度中追蹤'); }, 'btn btn-primary', 'mark-shipped'))];
  }

  function viewDocs() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitDocs') return viewCase();
    return [subnav(VIEW_META.docs.title, backTo('case')),
      h('p', { class: 'intro' }, '商家需要購買日期與地點，才能認定是否在保固期內。認定前不需寄件，也不需先行付款。'),
      h('section', { class: 'block' },
        h('h2', { class: 'list-header' }, '購買證明'),
        h('div', { class: 'product' }, svg('ill-receipt', 'product-ill'),
          h('div', {}, h('p', { class: 'row-title' }, '購買收據'), h('p', { class: 'caption' }, '以內建插圖代替上傳檔案。')))),
      h('div', { class: 'actions sticky' },
        btn('送出購買證明', () => { submitDocs(S, c.id); back('case'); snack('已送出購買證明，等待商家認定保固'); }, 'btn btn-primary', 'submit-docs'),
        btn('稍後再補', backTo('case'), 'btn btn-ghost', 'docs-later'))];
  }

  function viewAbout() {
    return [h('header', { class: 'page-head' }, h('h1', { class: 'page-title', tabindex: '-1' }, VIEW_META.about.title)),
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '服務項目'),
        h('ol', { class: 'tiers' },
          h('li', {}, h('span', { class: 'row-title' }, '維修據點查詢（免費）'), h('p', { class: 'caption' }, '查詢台灣是否有可處理的維修據點或代理商。')),
          h('li', {}, h('span', { class: 'row-title' }, '問題排查（免費）'), h('p', { class: 'caption' }, '依商家授權的使用手冊逐步排查，簡單問題可直接排除。')),
          h('li', {}, h('span', { class: 'row-title' }, '專人處理（付費）'), h('p', { class: 'caption' }, '專人聯繫原廠並安排維修與物流；開始前先說明費用。')))),
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '費用負擔方式'),
        h('div', { class: 'block-body' },
          h('table', { class: 'grid' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '費用項目'), h('th', { scope: 'col' }, '保固內'), h('th', { scope: 'col' }, '保固外'))),
            h('tbody', {},
              h('tr', {}, h('th', { scope: 'row' }, '服務費'), h('td', {}, '消費者'), h('td', {}, '消費者')),
              h('tr', {}, h('th', { scope: 'row' }, '維修費'), h('td', {}, '商家'), h('td', {}, '消費者')),
              h('tr', {}, h('th', { scope: 'row' }, '運費'), h('td', {}, '商家'), h('td', {}, '消費者')),
              h('tr', {}, h('th', { scope: 'row' }, '例外費用'), h('td', { colspan: '2' }, '另行報價，不自動由消費者負擔')))),
          h('p', { class: 'caption' }, '保固待認定時不視為保固外。金額、收費時點與退款規則尚未訂定。'))),
      h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '關於展示版本'),
        h('div', { class: 'block-body' },
          h('p', { class: 'caption' }, '目前為互動情境展示。商品、案件、據點、排查步驟與窗口回覆都是情境資料，參考公開社群討論中常見的海外購入維修困擾，不指涉特定品牌，也不代表任何品牌已合作或拒修。金額皆為示範金額，非正式報價。所有操作只在您的畫面中進行，不會產生付款、寄件、通知或訂單，也不讀取 LINE 個人資料。重新整理頁面會回到初始展示資料。'),
          btn('展示工具', openSheet, 'btn btn-outline btn-sm', 'tools-about'),
          h('a', { class: 'btn btn-ghost btn-sm', href: 'start.html', 'data-act': 'start-guide' }, '開始操作指引與 QR Code')))];
  }

  const VIEWS = { home: viewHome, lookup: viewLookup, triage: viewTriage, consent: viewConsent, submitted: viewSubmitted,
    cases: viewCases, case: viewCase, quote: viewQuote, ship: viewShip, docs: viewDocs, about: viewAbout };

  function render(navigated) {
    const scrollTop = screen.scrollTop;
    const wrap = h('div', { class: 'view' + (navigated ? ' enter' : '') }, VIEWS[S.view]());
    // The MINI App native header shows <title>, so keep it short and per screen.
    document.title = S.view === 'home' ? '售後共享車 Share Repair' : VIEW_META[S.view].title + '｜售後共享車';
    screen.replaceChildren(wrap);
    const tab = tabOf(S.view);
    document.querySelectorAll('.bnav-item').forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    const n = todos(S).length;
    const badge = document.getElementById('bnav-badge');
    badge.hidden = !n;
    badge.textContent = String(n);
    document.getElementById('bnav-cases-label').textContent = n ? '維修案件，' + n + ' 件待處理' : '維修案件';
    if (navigated) {
      screen.scrollTop = 0;
      const title = screen.querySelector('h1');
      if (title) title.focus({ preventScroll: true });
    } else {
      screen.scrollTop = scrollTop;
    }
  }

  /* ---------- Chrome: bottom nav, preview tools sheet ---------- */
  document.querySelectorAll('.bnav-item').forEach((t) => t.addEventListener('click', () => go(t.dataset.tab)));
  const sheet = document.getElementById('sheet');
  const toolsBtn = document.getElementById('btn-tools');
  let sheetReturn = null;
  function openSheet() {
    sheetReturn = document.activeElement;
    renderAdvance();
    sheet.hidden = false;
    sheet.querySelector('.sheet-close').focus();
  }
  function closeSheet(restore = true) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    if (restore && sheetReturn && document.contains(sheetReturn)) sheetReturn.focus();
  }
  toolsBtn.addEventListener('click', openSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  sheet.querySelector('.sheet-close').addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  const SCENES = [
    ['維修據點查詢', '商品類別／購買地區', () => go('lookup')],
    ['問題排查後排除', '日本購入耳機，排查後已解決', () => go('triage', { triage: freshTriage() })],
    ['安全疑慮', '充電盒發燙，立即停止使用', () => { const t = freshTriage(); chooseIssue({ triage: t }, 'danger'); go('triage', { triage: t }); }],
    ['轉專人前確認費用', '服務費與維修物流費分開', () => { const t = freshTriage(); t.issue = 'oneside'; t.step = 'handoff'; go('triage', { triage: t }); }],
    ['保固內・國內維修', 'SR-D101 耳機寄件方式', () => openCase('SR-D101')],
    ['保固外・日本原廠維修', 'SR-D102 日版主機確認報價', () => openCase('SR-D102')],
    ['待補充資料・保固待認定', 'SR-D103 吹風機補充購買證明', () => openCase('SR-D103')],
  ];
  const sceneList = document.getElementById('scene-list');
  SCENES.forEach(([title, sub, fn], i) => sceneList.append(h('li', {},
    h('button', { type: 'button', class: 'row', 'data-act': 'scene-' + (i + 1), onclick: () => { closeSheet(false); fn(); } },
      h('span', { class: 'scene-n' }, String(i + 1)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, sub)),
      svg('i-chev', 'ic chev')))));
  document.getElementById('btn-reset').addEventListener('click', reset);

  // Operator-only scene advance (not a buyer action): merchant's warranty decision for a case awaiting it.
  const advance = h('div', { class: 'sheet-advance' });
  sheet.querySelector('.sheet-foot').before(advance);
  function renderAdvance() {
    const c = S.cases.find((x) => x.status === 'awaitWarranty');
    advance.replaceChildren(...(c ? [h('p', { class: 'sheet-desc' }, '推進情境（' + c.id + '）'),
      h('div', { class: 'sheet-foot' }, btn('商家回覆：認定為保固內', () => {
        simulateWarrantyResult(S, c.id);
        closeSheet(false);
        openCase(c.id);
        snack('商家已認定保固內，請確認寄件前報價');
      }, 'btn btn-outline', 'sim-warranty'))] : []));
  }

  /* ---------- Case conversation: bottom sheet with scripted topics (no free text, no real message) ---------- */
  const chat = h('div', { class: 'sheet-dim', hidden: true },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chat-title', 'aria-describedby': 'chat-sub' }));
  document.getElementById('app').append(chat);
  let chatCase = null; let chatReturn = null;
  function renderChat(focusKey) {
    const c = findCase(S, chatCase);
    const log = S.chats[c.id] || [];
    const asked = new Set(log.map((m) => m.key));
    const box = chat.firstChild;
    box.replaceChildren(
      h('div', { class: 'sheet-head' },
        h('h2', { class: 'sheet-title', id: 'chat-title' }, '案件對話'),
        h('button', { type: 'button', class: 'icon-btn chat-close', 'aria-label': '關閉案件對話', 'data-act': 'chat-close', onclick: () => closeChat() }, svg('i-close'))),
      h('p', { class: 'sheet-desc', id: 'chat-sub' }, '情境對話・' + c.product + '｜' + c.id),
      h('div', { class: 'chat chat-panel', role: 'log', 'aria-live': 'polite', 'aria-label': '對話紀錄' },
        h('div', { class: 'bubble ai' }, h('span', { class: 'bubble-who' }, '平台窗口'), h('p', {}, '您好，我是此案件的平台窗口。請選擇想詢問的事項。')),
        log.map((m) => [h('div', { class: 'bubble me' }, h('p', {}, m.q)),
          h('div', { class: 'bubble ai' }, h('span', { class: 'bubble-who' }, '平台窗口'), h('p', {}, m.a))])),
      h('div', { class: 'chat-topics' }, contactTopics(c).map((t) => btn(t.q, () => { askContact(S, c.id, t.key); renderChat(t.key); },
        'btn btn-outline btn-sm', 'ask-' + t.key, { disabled: asked.has(t.key) }))));
    const logEl = box.querySelector('.chat-panel');
    logEl.scrollTop = logEl.scrollHeight;
    if (focusKey) { // the tapped topic is now disabled: keep focus inside the dialog
      const next = box.querySelector('.chat-topics button:not(:disabled)');
      (next || box.querySelector('.chat-close')).focus();
    }
  }
  function openChat(id, opener) {
    chatCase = id; chatReturn = opener || document.activeElement;
    renderChat();
    chat.hidden = false;
    chat.querySelector('.chat-close').focus();
  }
  function closeChat(restore = true) {
    if (chat.hidden) return;
    chat.hidden = true;
    if (restore && chatReturn && document.contains(chatReturn)) chatReturn.focus();
  }
  chat.addEventListener('click', (e) => { if (e.target === chat) closeChat(); });
  document.addEventListener('keydown', (e) => {
    if (chat.hidden) return;
    if (e.key === 'Escape') { closeChat(); return; }
    if (e.key !== 'Tab') return;
    // aria-modal: keep Tab / Shift+Tab cycling inside the dialog's enabled controls.
    const f = [...chat.querySelectorAll('button:not(:disabled)')];
    const i = f.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? f[f.length - 1] : null) : (i === -1 || i === f.length - 1 ? f[0] : null);
    if (next) { e.preventDefault(); next.focus(); }
  });

  history.replaceState({ view: 'home', caseId: null, gen, stack: [{ view: 'home', caseId: null }] }, '');
  render(false);
})();
