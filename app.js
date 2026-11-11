/* Share Repair buyer-side demo. In-memory only; no network, no storage.
   The pure core (top half) is DOM-free so selftest.js can run it in Node. */
'use strict';

/* ================= Pure core ================= */

const SERVICE_FEE = 600; // Demo value, not a price.

const STAGES = {
  domestic: [
    ['已受理', '平台窗口'], ['專人遠端判讀', '平台窗口'], ['確認方案與費用', '你與商家'],
    ['你交寄包裹', '你'], ['維修點收件', '在地維修團隊'], ['檢測與維修', '在地維修團隊'],
    ['寄回給你', '在地維修團隊'], ['簽收結案', '你'],
  ],
  overseas: [
    ['已受理', '平台窗口'], ['原廠遠端判讀', '原廠技術人員'], ['確認報價', '你與付款方'],
    ['寄到國內集運點', '你'], ['集運點收件', '集運商'], ['出口運往原廠', '集運商'],
    ['原廠維修站收件', '原廠維修站'], ['原廠維修', '原廠維修站'], ['回程國際運輸', '集運商'],
    ['台灣進口', '集運商'], ['國內配送', '集運商'], ['簽收結案', '你'],
  ],
  tbd: [
    ['已送出申請', '你'], ['專人判讀', '平台窗口'], ['確認保固與處理方式', '商家／原廠'], ['寄件前報價', '你與付款方'],
  ],
};
const SHIP_STAGE = { domestic: 3, overseas: 3 };

const STATUS = {
  awaitShip: { label: '等你寄件', tone: 'todo', todo: true, next: '依寄件方式把商品寄出' },
  awaitQuote: { label: '等你確認報價', tone: 'todo', todo: true, next: '看過費目與付款方後確認' },
  awaitDocs: { label: '等你補件', tone: 'todo', todo: true, next: '補上購買證明，商家才能認定保固' },
  awaitWarranty: { label: '商家認定保固中', tone: 'wait', todo: false, next: '等商家回覆，認定前不需寄件或墊款' },
  reviewing: { label: '專人受理中', tone: 'wait', todo: false, next: '平台窗口整理資料後會通知你' },
  inTransit: { label: '寄送中', tone: 'ok', todo: false, next: '各段交接由合作方回報後更新' },
};

const WARRANTY = { in: '保固內', out: '保固外', pending: '保固待認定' };
const ROUTE = { domestic: '國內維修', overseas: '送海外原廠', tbd: '處理方式待確認' };
const PAYER = { buyer: '你支付', merchant: '商家負擔', pending: '待保固認定', tbd: '付款方待確認' };

// Who pays a fee line. Service fee: buyer. Exceptions: never auto-assigned.
function payerOf(warranty, key) {
  if (key === 'service') return 'buyer';
  if (key === 'exception') return 'tbd';
  if (warranty === 'in') return 'merchant';
  if (warranty === 'out') return 'buyer';
  return 'pending';
}

// Amount the buyer is asked to approve in this quote (service fee was approved earlier, separately).
function quoteDueFromBuyer(c) {
  return c.lines.reduce((sum, l) =>
    l.key !== 'service' && l.amount != null && payerOf(c.warranty, l.key) === 'buyer' ? sum + l.amount : sum, 0);
}

function line(key, label, amount) { return { key, label, amount }; }
const EXCEPTION_LINE = line('exception', '檢測、清關、保險、退回等例外費用', null);

function seedCases() {
  return [
    {
      id: 'SR-D101', product: '電風扇', ill: 'fan', brand: '示範品牌 A', model: 'A-30（示範型號）',
      route: 'domestic', warranty: 'in', status: 'awaitShip', stage: 3, quoteReady: true, quoteConsented: true, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', 1200), line('shipping', '國內來回運費', 300), EXCEPTION_LINE],
      events: [
        ['11/08 10:12', '你', '確認服務費，申請專人處理'],
        ['11/08 15:40', '平台窗口', '遠端判讀：馬達電容可能老化，建議送修'],
        ['11/09 09:05', '商家', '確認保固內，同意負擔維修費與運費'],
        ['11/09 09:30', '你', '確認寄件前報價'],
      ],
    },
    {
      id: 'SR-D102', product: '咖啡機', ill: 'coffee', brand: '示範品牌 B', model: 'B-7（示範型號・海外購買）',
      route: 'overseas', warranty: 'out', status: 'awaitQuote', stage: 2, quoteReady: true, quoteConsented: false, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '原廠維修費', 3800), line('shipping', '寄到國內集運點運費', 150),
        line('intl', '國際來回運輸（集運）', 2400), EXCEPTION_LINE],
      events: [
        ['11/06 20:18', '你', '確認服務費，申請專人處理'],
        ['11/07 11:02', '原廠技術人員', '看過影片：加熱模組需原廠更換'],
        ['11/09 16:45', '平台窗口', '原廠報價已送達，請你確認'],
      ],
    },
    {
      id: 'SR-D103', product: '藍牙耳機', ill: 'buds', brand: '示範品牌 C', model: 'C-Buds（示範型號）',
      route: 'tbd', warranty: 'pending', status: 'awaitDocs', stage: 1, quoteReady: false, quoteConsented: false, tracking: null,
      lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', null), line('shipping', '運費', null), EXCEPTION_LINE],
      events: [
        ['11/10 13:20', '你', '確認服務費，申請專人處理'],
        ['11/10 18:02', '平台窗口', '商家需要購買證明才能認定保固'],
      ],
    },
  ];
}

function freshTriage() { return { step: 'product', issue: null, photo: false, idx: 0, log: [], caseId: null }; }

function createState() {
  return {
    view: 'home', caseId: null, from: 'home', cases: seedCases(), triage: freshTriage(),
    lookup: { brand: 'A', model: '', region: 'tw', result: null }, consentChecked: false, open: {}, seq: 104,
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
  addEvent(c, '你', '確認寄件前報價（模擬）');
  return true;
}

function markShipped(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitShip' || !c.quoteConsented || c.warranty === 'pending') return false;
  c.status = 'inTransit';
  c.stage += 1;
  c.tracking = 'DEMO-' + id.slice(-3) + '-01';
  addEvent(c, '你', '模擬交寄，追蹤號 ' + c.tracking);
  return true;
}

function submitDocs(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitDocs') return false;
  c.status = 'awaitWarranty';
  c.stage = 2;
  addEvent(c, '你', '補上購買證明（示範圖片）');
  return true;
}

// Demo fast-forward: merchant confirms in-warranty and an overseas repair plan.
function simulateWarrantyResult(s, id) {
  const c = findCase(s, id);
  if (!c || c.status !== 'awaitWarranty') return false;
  c.warranty = 'in';
  c.route = 'overseas';
  c.lines = [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '原廠維修費', 2600), line('shipping', '寄到國內集運點運費', 150),
    line('intl', '國際來回運輸（集運）', 2200), EXCEPTION_LINE];
  c.quoteReady = true;
  c.status = 'awaitQuote';
  c.stage = 2;
  addEvent(c, '商家', '認定保固內：維修與運費由商家負擔（模擬）');
  return true;
}

// First consent: service fee before a human takes the case. Returns new case id, or null.
function submitHandoff(s) {
  if (!s.consentChecked || s.triage.caseId) return null;
  const id = 'SR-D' + s.seq++;
  const danger = s.triage.issue === 'danger';
  s.cases.unshift({
    id, product: '電風扇', ill: 'fan', brand: '示範品牌 A', model: 'A-30（示範型號）',
    route: 'tbd', warranty: 'pending', status: 'reviewing', stage: 1, quoteReady: false, quoteConsented: false, tracking: null,
    lines: [line('service', '平台服務費（專人處理）', SERVICE_FEE), line('repair', '維修費', null), line('shipping', '運費', null), EXCEPTION_LINE],
    events: [['剛剛', '你', danger ? '回報危險現象，申請專人評估（模擬）' : '確認服務費，申請專人處理（模擬）'],
      ['剛剛', '系統', '已附上免費排查紀錄，不需要從頭說明']],
  });
  s.triage.caseId = id;
  return id;
}

/* Triage scripts. Content is placeholder text for the demo, not a real manual. */
const ISSUES = [
  { key: 'nospin', label: '扇葉不轉，但電源燈有亮' },
  { key: 'noise', label: '轉動時有喀喀聲或異音' },
  { key: 'remote', label: '遙控器按了沒反應' },
  { key: 'danger', label: '有焦味、冒煙或看到火花', danger: true },
];
const SCRIPTS = {
  nospin: [
    { text: '先拔掉插頭，確認扇葉沒有被異物卡住，用手輕撥看看能不能順順轉動。', src: '示範手冊 A-30・第 4 章 故障排除' },
    { text: '插回插頭後，長按「電源」鍵 5 秒重新啟動，再選擇 1 段風速試試。', src: '示範手冊 A-30・第 4.2 節 重新啟動' },
  ],
  noise: [
    { text: '拔掉插頭，檢查前後網罩的卡扣是否都扣緊，網罩鬆動是常見的聲音來源。', src: '示範手冊 A-30・第 3 章 組裝' },
    { text: '確認扇葉中心的固定旋鈕有鎖緊，再放在平坦的地面上試轉。', src: '示範手冊 A-30・第 3.4 節 扇葉固定' },
  ],
  remote: [
    { text: '換一組新電池，並確認正負極方向正確。', src: '示範手冊 A-30・第 5 章 遙控器' },
    { text: '對準機身正面的接收窗，在 3 公尺內按「電源」鍵試試。', src: '示範手冊 A-30・第 5.1 節 接收範圍' },
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
  t.log.push({ from: 'me', text: '照做了，還是一樣。' });
  t.idx += 1;
  const next = SCRIPTS[t.issue][t.idx];
  if (next) t.log.push({ from: 'ai', ...next });
  else t.step = 'handoff';
}

/* Fictional lookup data. No real store, certification, or contact. */
const BRANDS = { A: '示範品牌 A（電風扇、小家電）', B: '示範品牌 B（咖啡機）', C: '示範品牌 C（耳機）' };
function lookupPoints(brand, region) {
  const overseasNote = region === 'abroad' ? '你選了海外購買：是否受理須由店家確認，不代表一定可以處理。' : null;
  const points = {
    A: [
      { name: '示範維修點・北區（虛構）', scope: '電風扇、空氣清淨機（以店家公告為準）', abroad: '海外購買品：須先詢問店家', checked: '查核日：Demo 資料' },
      { name: '示範維修點・南區（虛構）', scope: '電風扇（以店家公告為準）', abroad: '海外購買品：資料待店家確認', checked: '查核日：Demo 資料' },
    ],
    B: [],
    C: [{ name: '示範代理商服務窗口（虛構）', scope: '耳機類（範圍待店家確認）', abroad: '海外購買品：資料待店家確認', checked: '查核日：Demo 資料' }],
  }[brand] || [];
  return { points, overseasNote };
}

const money = (n) => 'NT$ ' + n.toLocaleString('en-US');

if (typeof module !== 'undefined') {
  module.exports = { createState, payerOf, quoteDueFromBuyer, todos, consentQuote, markShipped, submitDocs,
    simulateWarrantyResult, submitHandoff, chooseIssue, startChat, replyTriage, lookupPoints, STAGES, SCRIPTS, findCase };
}

/* ================= UI ================= */

if (typeof document !== 'undefined') (function () {
  let S = createState();
  let timer = null;
  let toastTimer = null;
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
  const btn = (label, onclick, cls, extra) => h('button', { type: 'button', class: cls || 'btn', onclick, ...extra }, label);
  const demoTag = (text) => h('span', { class: 'demo-tag' }, text || 'Demo');

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function go(view, extra) {
    clearTimeout(timer);
    S.from = S.view;
    S.view = view;
    Object.assign(S, extra || {});
    render(true);
  }
  function openCase(id) { go('case', { caseId: id }); }

  function reset() {
    clearTimeout(timer);
    S = createState();
    render(true);
    toast('Demo 已重設，所有案件回到初始狀態');
  }

  function topbar(title, backTo, backLabel) {
    return h('div', { class: 'topbar' },
      backTo ? h('button', { type: 'button', class: 'back', onclick: backTo }, svg('i-back'), backLabel || '返回') : null,
      h('h1', { class: 'page-title', tabindex: '-1' }, title));
  }

  function statusChip(c) {
    const st = STATUS[c.status];
    return h('span', { class: 'chip chip-' + st.tone }, svg(st.tone === 'todo' ? 'i-alert' : st.tone === 'ok' ? 'i-truck' : 'i-clock'), st.label);
  }
  const warrantyChip = (c) => h('span', { class: 'chip chip-plain' + (c.warranty === 'pending' ? ' chip-pending' : '') }, svg('i-shield'), WARRANTY[c.warranty]);
  const routeChip = (c) => h('span', { class: 'chip chip-plain' }, svg(c.route === 'overseas' ? 'i-globe' : c.route === 'domestic' ? 'i-wrench' : 'i-clock'), ROUTE[c.route]);

  // Toggle helper: updates DOM directly so focus stays on the button.
  function toggle(key, label, body) {
    const id = 'panel-' + key.replace(/[^a-z0-9]/gi, '');
    const open = !!S.open[key];
    const panel = h('div', { class: 'panel', id, hidden: !open }, body);
    const b = h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(open), 'aria-controls': id }, h('span', {}, label), svg('i-down', 'ic chev'));
    b.addEventListener('click', () => {
      S.open[key] = !S.open[key];
      b.setAttribute('aria-expanded', String(S.open[key]));
      panel.hidden = !S.open[key];
    });
    return [b, panel];
  }

  /* ---------- Views ---------- */

  function viewHome() {
    const list = todos(S);
    return [
      h('section', { class: 'hero' },
        h('div', { class: 'hero-text' },
          h('p', { class: 'eyebrow' }, '售後共享車 Share Repair'),
          h('h1', { class: 'hero-title', tabindex: '-1' }, '你的售後，', h('br'), '我們接著處理。'),
          h('p', { class: 'hero-sub' }, '先免費查詢、免費排查；需要專人時，會先把費用說清楚。')),
        svg('ill-fan', 'hero-ill')),
      list.length ? h('section', { class: 'card todo-card', 'aria-labelledby': 'todo-h' },
        h('h2', { id: 'todo-h', class: 'todo-h' }, svg('i-alert'), '待你處理 ', h('span', { class: 'count' }, String(list.length))),
        h('ul', { class: 'todo-list' }, list.map((c) => h('li', {},
          h('button', { type: 'button', class: 'todo-row', onclick: () => openCase(c.id) },
            svg('ill-' + c.ill, 'thumb'),
            h('span', { class: 'todo-main' }, h('b', {}, c.product + '｜' + STATUS[c.status].label), h('small', {}, c.id + '・' + STATUS[c.status].next)),
            svg('i-chev', 'ic chev')))))) : null,
      h('button', { type: 'button', class: 'cta-card', onclick: () => go('triage', { triage: freshTriage() }) },
        h('span', { class: 'cta-icon' }, svg('i-spark')),
        h('span', { class: 'cta-text' }, h('b', {}, '產品有問題，開始免費排查'), h('small', {}, '依手冊一步一步試；轉專人前會先告知費用')),
        svg('i-chev', 'ic chev')),
      h('div', { class: 'tile-row' },
        h('button', { type: 'button', class: 'tile', onclick: () => go('cases') },
          svg('i-cases', 'ic tile-ic'), h('b', {}, '我的維修'), h('small', {}, S.cases.length + ' 件案件進度')),
        h('button', { type: 'button', class: 'tile', onclick: () => go('lookup') },
          svg('i-search', 'ic tile-ic'), h('b', {}, '免費據點查詢'), h('small', {}, '台灣有沒有地方可修'))),
      h('ol', { class: 'steps' },
        [['免費查詢', '找台灣據點'], ['免費排查', '簡單問題當場解決'], ['專人處理', '確認費用後才開始']].map(([a, b], i) =>
          h('li', {}, h('span', { class: 'step-n' }, String(i + 1)), h('b', {}, a), h('small', {}, b)))),
    ];
  }

  function viewLookup() {
    const L = S.lookup;
    const brandSel = h('select', { id: 'f-brand', class: 'field' },
      Object.entries(BRANDS).map(([k, v]) => h('option', { value: k, selected: L.brand === k }, v)));
    const model = h('input', { id: 'f-model', class: 'field', type: 'text', maxlength: '40', placeholder: '例：A-30（可留空）', autocomplete: 'off' });
    model.value = L.model;
    const region = (val, label) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'region', value: val, checked: L.region === val }), h('span', {}, label));
    const form = h('form', { class: 'card form', onsubmit: (e) => {
      e.preventDefault();
      L.brand = brandSel.value;
      L.model = model.value.trim();
      L.region = form.querySelector('input[name=region]:checked').value;
      L.result = lookupPoints(L.brand, L.region);
      render(false);
      const r = document.getElementById('lookup-result');
      if (r) r.focus();
    } },
      h('label', { for: 'f-brand', class: 'label' }, '品牌'), brandSel,
      h('label', { for: 'f-model', class: 'label' }, '型號'), model,
      h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, '在哪裡買的？'),
        h('div', { class: 'radio-row' }, region('tw', '台灣購買'), region('abroad', '海外購買'))),
      h('button', { type: 'submit', class: 'btn btn-primary' }, svg('i-search'), '查詢台灣據點'));

    let result = null;
    if (L.result) {
      const { points, overseasNote } = L.result;
      result = h('section', { class: 'result', id: 'lookup-result', tabindex: '-1', 'aria-live': 'polite' },
        h('div', { class: 'result-head' }, h('h2', {}, '查詢結果'), demoTag('虛構示範資料')),
        L.model ? h('p', { class: 'muted' }, '你輸入的型號：', h('b', {}, L.model)) : null,
        overseasNote ? h('p', { class: 'note note-warn' }, svg('i-alert'), overseasNote) : null,
        points.length ? h('ul', { class: 'points' }, points.map((p) => h('li', { class: 'card point' },
          h('div', { class: 'point-head' }, svg('i-pin'), h('b', {}, p.name)),
          h('p', {}, '可處理：' + p.scope), h('p', {}, p.abroad), h('p', { class: 'muted small' }, p.checked),
          btn('詢問這個據點', () => toast('Demo：不會真的聯絡店家'), 'btn btn-ghost btn-sm'))))
          : h('div', { class: 'card empty' }, h('b', {}, '目前查無台灣據點資料'), h('p', { class: 'muted' }, '可以先做免費排查，或請專人協助確認能否送原廠。')),
        h('p', { class: 'muted small' }, '列出的據點不代表一定受理或已取得任何認證，實際以店家回覆為準。'),
        btn([svg('i-spark'), '改做免費排查'], () => go('triage', { triage: freshTriage() }), 'btn btn-secondary'));
    }
    return [topbar('免費據點查詢', () => go('home'), '首頁'),
      h('p', { class: 'lede' }, '先看看台灣是否已有能處理的店家。能直接處理，就不需要用付費服務。'), form, result];
  }

  function productCard() {
    return h('div', { class: 'card product' }, svg('ill-fan', 'product-ill'),
      h('div', {}, h('b', {}, '電風扇'), h('p', { class: 'muted' }, '示範品牌 A・A-30（示範型號）'), demoTag('示範商品')));
  }

  function viewTriage() {
    const t = S.triage;
    const back = () => go('home');
    const stepper = (n) => h('ol', { class: 'stepper', 'aria-label': '排查步驟' },
      ['商品', '問題', '照片', '排查'].map((x, i) => h('li', { class: i < n ? 'done' : i === n ? 'now' : '', 'aria-current': i === n ? 'step' : null }, x)));

    if (t.step === 'product') {
      return [topbar('免費排查', back, '首頁'), stepper(0),
        h('h2', { class: 'q' }, '是這一台商品嗎？'), productCard(),
        h('p', { class: 'muted small' }, 'Demo 固定使用示範電風扇。正式服務會請你輸入或拍下銘牌，並由你確認型號。'),
        h('div', { class: 'actions' }, btn('對，就是這台', () => { t.step = 'issue'; render(true); }, 'btn btn-primary'))];
    }
    if (t.step === 'issue') {
      return [topbar('免費排查', () => { t.step = 'product'; render(true); }), stepper(1),
        h('h2', { class: 'q' }, '哪裡不正常？'),
        h('div', { class: 'options' }, ISSUES.map((o) => h('button', { type: 'button', class: 'option' + (o.danger ? ' option-danger' : ''), onclick: () => { chooseIssue(S, o.key); render(true); } },
          o.danger ? svg('i-alert') : svg('i-chat'), h('span', {}, o.label), svg('i-chev', 'ic chev'))))];
    }
    if (t.step === 'photo') {
      return [topbar('免費排查', () => { t.step = 'issue'; render(true); }), stepper(2),
        h('h2', { class: 'q' }, '補一張照片（可略過）'),
        h('p', { class: 'muted' }, '照片能幫助判斷，但不是必要。Demo 不會讀取你的相簿。'),
        h('button', { type: 'button', class: 'photo' + (t.photo ? ' photo-on' : ''), 'aria-pressed': String(t.photo), onclick: () => { t.photo = !t.photo; render(false); } },
          t.photo ? [svg('ill-fan', 'photo-ill'), h('span', { class: 'photo-cap' }, svg('i-check'), '已附上示範照片（點一下移除）')]
            : [svg('i-camera', 'ic photo-ic'), h('b', {}, '使用示範照片'), h('small', {}, '以內建插圖代替真實拍攝')]),
        h('div', { class: 'actions' }, btn(t.photo ? '開始排查' : '略過照片，開始排查', () => { startChat(S); render(true); }, 'btn btn-primary'))];
    }
    if (t.step === 'chat') {
      const last = t.log[t.log.length - 1];
      const typing = !!t.typing;
      return [topbar('免費排查', back, '首頁'), stepper(3),
        h('div', { class: 'chat', role: 'log', 'aria-label': '排查對話' },
          h('p', { class: 'chat-meta' }, ISSUES.find((i) => i.key === t.issue).label + (t.photo ? '・已附照片' : '')),
          t.log.map((m, i) => (typing && i === t.log.length - 1 && m.from === 'ai')
            ? h('div', { class: 'bubble ai typing', 'aria-label': '正在查手冊' }, h('span'), h('span'), h('span'))
            : h('div', { class: 'bubble ' + m.from }, m.from === 'ai' ? h('span', { class: 'bubble-who' }, svg('i-spark'), '排查助手') : null,
              h('p', {}, m.text), m.src ? h('small', { class: 'src' }, svg('i-doc'), '參考：' + m.src + '（Demo 內容）') : null))),
        typing ? null : h('div', { class: 'chat-actions' },
          h('p', { class: 'chat-q' }, last && last.from === 'ai' ? '試完後，狀況如何？' : ''),
          h('div', { class: 'two' }, btn([svg('i-check'), '已解決'], () => { replyTriage(S, 'solved'); render(true); }, 'btn btn-primary'),
            btn('還是有問題', () => { replyTriage(S, 'notyet'); typeIn(); }, 'btn btn-secondary')),
          h('div', { class: 'two' }, btn('直接找專人', () => { replyTriage(S, 'human'); render(true); }, 'btn btn-ghost btn-sm'),
            btn([svg('i-alert'), '出現焦味／冒煙'], () => { replyTriage(S, 'danger'); render(true); }, 'btn btn-danger-ghost btn-sm')))];
    }
    if (t.step === 'resolved') {
      return [topbar('排查完成', back, '首頁'),
        h('div', { class: 'done-panel' }, h('span', { class: 'done-badge' }, svg('i-check')),
          h('h2', {}, '太好了，問題解決了'), h('p', {}, '這次免費排查不收任何費用，也沒有建立付費案件。'),
          h('p', { class: 'muted small' }, '如果同一個問題再出現，可以回來從這次的紀錄接著處理。')),
        h('div', { class: 'actions' }, btn('回到首頁', () => go('home'), 'btn btn-primary'))];
    }
    if (t.step === 'safety') {
      return [topbar('先停止使用', back, '首頁'),
        h('section', { class: 'safety', role: 'alert' }, h('span', { class: 'safety-ic' }, svg('i-alert')),
          h('h2', {}, '請先停止測試'),
          h('ol', {}, h('li', {}, '立即關閉電源並拔掉插頭。'), h('li', {}, '不要拆開機身，也不要再試著開機。'),
            h('li', {}, '移到通風處，遠離窗簾等可燃物。'), h('li', {}, '如有持續冒煙或起火，請撥打 119。')),
          h('p', { class: 'free' }, svg('i-shield'), '安全提示免費，不需要先付款。')),
        h('p', { class: 'muted' }, '若需要後續處理，專人會先評估能否安全運送，確認前不會產生寄件單。'),
        h('div', { class: 'actions' }, btn('請專人評估（會先說明費用）', () => go('consent', { consentChecked: false }), 'btn btn-secondary'),
          btn('先回到首頁', () => go('home'), 'btn btn-ghost'))];
    }
    // handoff
    return [topbar('免費排查先到這裡', back, '首頁'),
      h('div', { class: 'card handoff' }, h('span', { class: 'cta-icon' }, svg('i-user')),
        h('div', {}, h('h2', {}, '接下來建議由專人判讀'), h('p', {}, '手冊上的步驟都試過了。專人會看你的紀錄，聯繫原廠並安排後續；你不必從頭說明。'))),
      h('div', { class: 'actions' }, btn('看看專人處理的費用', () => go('consent', { consentChecked: false }), 'btn btn-primary'),
        btn('先不用，回到首頁', () => go('home'), 'btn btn-ghost'))];
  }

  // Simulated "looking up manual" delay; cancelled by any navigation or reset.
  function typeIn() {
    const t = S.triage;
    if (t.step !== 'chat' || reduceMotion) { render(false); return; }
    t.typing = true;
    render(false);
    clearTimeout(timer);
    timer = setTimeout(() => { t.typing = false; render(false); }, 900);
  }

  function viewConsent() {
    const backTo = () => go('triage');
    const already = S.triage.caseId;
    const submit = btn([svg('i-user'), '模擬申請專人處理'], () => {
      const id = submitHandoff(S);
      if (id) go('submitted');
    }, 'btn btn-primary', { disabled: !S.consentChecked || !!already });
    const box = h('input', { type: 'checkbox', id: 'agree', checked: S.consentChecked, disabled: !!already });
    box.addEventListener('change', () => { S.consentChecked = box.checked; submit.disabled = !box.checked; });
    const row = (label, value, payer, note) => h('div', { class: 'fee' },
      h('div', { class: 'fee-main' }, h('span', {}, label), note ? h('small', {}, note) : null),
      h('div', { class: 'fee-side' }, h('b', {}, value), payer ? h('small', {}, payer) : null));

    return [topbar('接下來由專人接手', backTo),
      S.triage.issue === 'danger' ? h('p', { class: 'note note-warn' }, svg('i-alert'), '你回報了危險現象：專人會先評估能否安全運送，未確認前不安排寄件。') : null,
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '這一步包含'),
        h('ul', { class: 'ticks' }, ['平台窗口整理你的排查紀錄與照片', '聯繫商家／原廠遠端判讀', '確認保固狀態與後續處理方式'].map((x) => h('li', {}, svg('i-check'), x)))),
      h('section', { class: 'card' },
        h('div', { class: 'card-h-row' }, h('h2', { class: 'card-h' }, '本階段費用'), demoTag('金額為 Demo 示範值，非定價')),
        row('平台服務費', money(SERVICE_FEE), '由你支付', '專人處理這一步的費用'),
        row('維修費、物流費', '另行報價', null, '判讀後才知道；寄件前會再請你確認一次'),
        row('例外費用', '另行報價', null, '檢測、清關、保險、退回等，不會自動算給你')),
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '維修與運費由誰負擔'),
        h('dl', { class: 'rules' },
          h('dt', {}, '保固內'), h('dd', {}, '你付服務費；維修費與運費由商家負擔。'),
          h('dt', {}, '保固外'), h('dd', {}, '你付服務費、維修費與運費，報價確認後才寄件。'),
          h('dt', {}, '保固待認定'), h('dd', {}, '不會當成過保處理；認定前先不寄件，也不用先墊款。'))),
      toggle('refund', '取消與退款規則', h('p', { class: 'muted' }, '正式規則尚未定案。此 Demo 不會收款，也不會建立真實訂單。')),
      h('div', { class: 'agree' }, box, h('label', { for: 'agree' }, '我已了解本階段的服務範圍與費用，維修與物流費會另外報價。')),
      already ? h('p', { class: 'note' }, '這次排查已送出申請（' + already + '），不會重複建立。') : null,
      h('div', { class: 'actions sticky' }, submit, h('small', { class: 'muted center' }, '模擬操作：不會扣款，也不會通知任何人。'))];
  }

  function viewSubmitted() {
    const id = S.triage.caseId;
    return [topbar('已送出模擬申請', () => go('home'), '首頁'),
      h('div', { class: 'done-panel' }, h('span', { class: 'done-badge' }, svg('i-check')),
        h('h2', {}, '專人申請已建立（模擬）'),
        h('p', {}, '案件 ' + id + ' 已加到「我的案件」。目前保固待認定，確認前不需寄件或付款。'),
        h('p', { class: 'muted small' }, 'Demo 未進行付款，也沒有通知任何商家或窗口。')),
      h('div', { class: 'actions' }, btn('查看這個案件', () => openCase(id), 'btn btn-primary'), btn('回到首頁', () => go('home'), 'btn btn-ghost'))];
  }

  function viewCases() {
    return [topbar('我的案件', null),
      h('p', { class: 'lede' }, '每個案件都有一位平台窗口，看得到現在在哪一步、輪到誰。'),
      h('ul', { class: 'case-list' }, S.cases.map((c) => h('li', {},
        h('button', { type: 'button', class: 'case-card' + (STATUS[c.status].todo ? ' is-todo' : ''), onclick: () => openCase(c.id) },
          svg('ill-' + c.ill, 'case-ill'),
          h('span', { class: 'case-body' },
            h('span', { class: 'case-top' }, h('b', {}, c.product), h('small', { class: 'case-id' }, c.id)),
            h('span', { class: 'chips' }, statusChip(c), warrantyChip(c), routeChip(c)),
            h('small', { class: 'case-next' }, '下一步：' + STATUS[c.status].next)),
          svg('i-chev', 'ic chev'))))),
      h('p', { class: 'muted small center' }, '案件皆為 Demo 示範資料。')];
  }

  function feeTable(c) {
    return h('div', { class: 'fees' },
      c.lines.map((l) => {
        const p = payerOf(c.warranty, l.key);
        return h('div', { class: 'fee' },
          h('div', { class: 'fee-main' }, h('span', {}, l.label),
            l.key === 'service' ? h('small', {}, '申請專人時已確認') : l.key === 'exception' ? h('small', {}, '發生時先報價，未經你同意不收') : null),
          h('div', { class: 'fee-side' }, h('b', {}, l.amount != null ? money(l.amount) : p === 'pending' ? '待認定' : '另行報價'),
            h('span', { class: 'payer payer-' + p }, PAYER[p])));
      }));
  }

  function timeline(c) {
    const stages = STAGES[c.route];
    const done = c.stage; // index of the current step
    const key = c.id + ':tl';
    const visible = S.open[key] ? stages : stages.slice(0, Math.min(stages.length, done + 2));
    const list = (arr) => h('ol', { class: 'timeline' }, arr.map(([name, who], i) => {
      const state = i < done ? 'done' : i === done ? 'now' : 'next';
      return h('li', { class: 'tl tl-' + state, 'aria-current': state === 'now' ? 'step' : null },
        h('span', { class: 'tl-dot' }, state === 'done' ? svg('i-check') : null),
        h('span', { class: 'tl-body' }, h('b', {}, name),
          h('small', {}, state === 'done' ? '已完成・' + who + '回報' : state === 'now' ? '目前・輪到' + who : '待' + who + '回報')));
    }));
    const tl = list(visible);
    const more = stages.length > visible.length || S.open[key];
    const b = more ? h('button', { type: 'button', class: 'toggle', 'aria-expanded': String(!!S.open[key]) },
      h('span', {}, S.open[key] ? '收合時間軸' : '展開完整時間軸（' + stages.length + ' 段）'), svg('i-down', 'ic chev')) : null;
    if (b) b.addEventListener('click', () => {
      S.open[key] = !S.open[key];
      render(false);
      const again = document.querySelector('.tl-toggle');
      if (again) again.focus();
    });
    if (b) b.classList.add('tl-toggle');
    return [tl, b];
  }

  function viewCase() {
    const c = findCase(S, S.caseId);
    if (!c) return viewCases();
    const st = STATUS[c.status];
    const back = () => go('cases');
    let action = null;
    if (c.status === 'awaitShip') action = btn([svg('i-box'), '查看寄件方式'], () => go('ship'), 'btn btn-primary');
    if (c.status === 'awaitQuote') action = btn([svg('i-doc'), '查看並確認報價'], () => go('quote'), 'btn btn-primary');
    if (c.status === 'awaitDocs') action = btn([svg('i-camera'), '補上購買證明'], () => go('docs'), 'btn btn-primary');

    return [topbar(c.product + '｜' + c.id, back, '我的案件'),
      h('section', { class: 'status-hero tone-' + st.tone },
        svg('ill-' + c.ill, 'status-ill'),
        h('div', { class: 'status-text' }, h('small', {}, '目前'), h('b', { class: 'status-now' }, st.label),
          h('p', {}, '下一步：' + st.next), h('span', { class: 'chips' }, warrantyChip(c), routeChip(c)))),
      action ? h('div', { class: 'actions' }, action) : null,
      c.status === 'awaitWarranty' ? h('div', { class: 'card demo-ctrl' },
        h('p', { class: 'small' }, demoTag('Demo 快轉'), ' 模擬商家回覆保固認定結果。'),
        btn('模擬：商家認定保固內', () => { simulateWarrantyResult(S, c.id); render(true); toast('商家認定保固內（模擬），請確認寄件前報價'); }, 'btn btn-ghost btn-sm')) : null,
      c.tracking ? h('p', { class: 'note' }, svg('i-truck'), '示範追蹤號 ' + c.tracking + '（不連到真實物流）') : null,

      h('section', { class: 'card' },
        h('div', { class: 'card-h-row' }, h('h2', { class: 'card-h' }, '費用與付款方'), demoTag('金額為示範值')),
        h('p', { class: 'muted small' }, c.warranty === 'in' ? '保固內：你負擔服務費；維修與運費由商家負擔。'
          : c.warranty === 'out' ? '保固外：服務費、維修費與運費由你負擔，逐項確認。'
            : '保固待認定：不當成過保，認定前不寄件、不需墊款。'),
        toggle(c.id + ':fees', '查看費目明細', feeTable(c))),

      h('section', { class: 'card' },
        h('h2', { class: 'card-h' }, c.route === 'overseas' ? '進度：國內集運 → 海外原廠 → 回台' : '進度'),
        timeline(c),
        toggle(c.id + ':log', '查看案件紀錄（' + c.events.length + '）',
          h('ul', { class: 'events' }, c.events.slice().reverse().map(([t, who, text]) =>
            h('li', {}, h('small', {}, t + '・' + who), h('p', {}, text)))))),

      h('section', { class: 'card contact' },
        h('span', { class: 'cta-icon' }, svg('i-user')),
        h('div', {}, h('b', {}, '平台窗口：小安'), h('small', { class: 'muted' }, 'Demo 角色。與商家、原廠、維修團隊、集運商的溝通都由窗口負責。')),
        btn([svg('i-chat'), '傳訊息'], () => toast('Demo：訊息不會真的送出'), 'btn btn-ghost btn-sm'))];
  }

  function viewQuote() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitQuote') return viewCase();
    const due = quoteDueFromBuyer(c);
    const ok = btn([svg('i-check'), '模擬同意報價'], () => {
      if (consentQuote(S, c.id, box.checked)) { go('case'); toast('已模擬同意報價，現在可以查看寄件方式'); }
    }, 'btn btn-primary', { disabled: true });
    const box = h('input', { type: 'checkbox', id: 'agree-q' });
    box.addEventListener('change', () => { ok.disabled = !box.checked; });
    return [topbar('寄件前報價', () => go('case'), '案件'),
      h('p', { class: 'lede' }, c.product + '｜' + c.id + '・' + WARRANTY[c.warranty] + '・' + ROUTE[c.route]),
      h('section', { class: 'card' },
        h('div', { class: 'card-h-row' }, h('h2', { class: 'card-h' }, '報價明細'), demoTag('金額為 Demo 示範值，非定價')),
        feeTable(c),
        h('div', { class: 'due' }, h('span', {}, '這次報價需要你負擔'), h('b', {}, money(due))),
        h('p', { class: 'muted small' }, due === 0 ? '保固內：維修與運費由商家負擔，你只需確認處理方式。' : '服務費已於申請專人時另外確認，不含在這次報價。')),
      c.route === 'overseas' ? h('p', { class: 'note' }, svg('i-globe'), '路線：寄到國內集運點 → 出口送原廠維修 → 以集運運回台灣。預估時間待合作方回報。') : null,
      h('div', { class: 'agree' }, box, h('label', { for: 'agree-q' }, '我已看過報價項目、金額與付款方；未同意前不會寄件或施工。')),
      h('div', { class: 'actions sticky' }, ok,
        btn('暫不同意，先問窗口', () => toast('Demo：已記下想先詢問，不會真的通知窗口'), 'btn btn-ghost'))];
  }

  const PACKING = {
    fan: '附上電源線；遙控器不用寄',
    coffee: '只寄機身與電源線；先倒掉水箱的水、清空豆槽',
    buds: '耳機放回充電盒一起寄；不用寄充電線',
  };

  function viewShip() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitShip' || !c.quoteConsented) return viewCase();
    const overseas = c.route === 'overseas';
    const item = (k, v) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v));
    return [topbar('寄件方式', () => go('case'), '案件'),
      h('p', { class: 'lede' }, overseas ? '先寄到國內集運點，由集運商安排出口送原廠。' : '寄到國內合作維修點，修好後寄回給你。'),
      h('section', { class: 'card' },
        h('div', { class: 'card-h-row' }, h('h2', { class: 'card-h' }, overseas ? '國內集運點' : '合作維修點'), demoTag('虛構地址')),
        h('dl', { class: 'kvs' },
          item('收件單位', overseas ? '示範集運點（虛構）' : '示範維修點・北區（虛構）'),
          item('地址', '○○市○○區示範路 1 號（虛構）'),
          item('案件碼', c.id + '（請寫在包裹外箱）'),
          item('交寄方式', '自行至超商或宅配交寄，取得追蹤號後回到這裡填寫'))),
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '包裝與配件'),
        h('ul', { class: 'ticks' }, [
          '用原廠箱或緩衝材包好，避免晃動',
          PACKING[c.ill],
          '不要放入現金、證件或個人物品',
          overseas ? '含電池等受限品項，寄送方式請先問窗口' : null,
          c.warranty === 'in' ? '保固內運費由商家負擔，不需要你先付運費' : '運費已含在你同意的報價中',
        ].filter(Boolean).map((x) => h('li', {}, svg('i-check'), x)))),
      h('div', { class: 'actions sticky' },
        btn([svg('i-truck'), '模擬我已交寄'], () => { markShipped(S, c.id); go('case', { open: { ...S.open, [c.id + ':tl']: true } }); toast('已模擬交寄；Demo 不會產生真實物流單'); }, 'btn btn-primary'),
        h('small', { class: 'muted center' }, '沒有串接物流：寄件指示由專人人工提供。'))];
  }

  function viewDocs() {
    const c = findCase(S, S.caseId);
    if (!c || c.status !== 'awaitDocs') return viewCase();
    return [topbar('補上購買證明', () => go('case'), '案件'),
      h('p', { class: 'lede' }, '商家需要購買日期與地點，才能認定是否在保固內。認定前不需寄件，也不用先付款。'),
      h('div', { class: 'card receipt' }, svg('ill-receipt', 'receipt-ill'),
        h('div', {}, h('b', {}, '示範收據圖'), h('p', { class: 'muted small' }, 'Demo 以內建插圖代替，不讀取你的檔案。'))),
      h('div', { class: 'actions sticky' },
        btn([svg('i-check'), '送出示範收據'], () => { submitDocs(S, c.id); go('case'); toast('已補件（模擬），等待商家認定保固'); }, 'btn btn-primary'),
        btn('稍後再補', () => go('case'), 'btn btn-ghost'))];
  }

  function viewAbout() {
    return [topbar('服務說明', null),
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '三層服務'),
        h('ol', { class: 'tiers' },
          h('li', {}, h('b', {}, '免費查詢'), h('p', {}, '台灣有沒有可以處理的維修據點或代理商。')),
          h('li', {}, h('b', {}, '免費排查'), h('p', {}, '依商家授權的手冊一步步試，簡單問題當場解決。')),
          h('li', {}, h('b', {}, '專人處理（付費）'), h('p', {}, '專人聯繫原廠、安排維修與物流；開始前先說明費用。')))),
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '誰付哪一筆'),
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '費目'), h('th', { scope: 'col' }, '保固內'), h('th', { scope: 'col' }, '保固外'))),
          h('tbody', {},
            h('tr', {}, h('th', { scope: 'row' }, '服務費'), h('td', {}, '你'), h('td', {}, '你')),
            h('tr', {}, h('th', { scope: 'row' }, '維修費'), h('td', {}, '商家'), h('td', {}, '你')),
            h('tr', {}, h('th', { scope: 'row' }, '運費'), h('td', {}, '商家'), h('td', {}, '你')),
            h('tr', {}, h('th', { scope: 'row' }, '例外費用'), h('td', { colspan: '2' }, '另行報價，不自動算給你')))),
        h('p', { class: 'muted small' }, '保固待認定時不當成過保；金額、收費時點與退款規則尚未定案。')),
      h('section', { class: 'card' }, h('h2', { class: 'card-h' }, '關於這個 Demo'),
        h('p', { class: 'muted' }, '本機示意原型：品牌、型號、據點、窗口與金額皆為虛構；不登入、不付款、不寄送通知、不保存資料。標頭只是 LINE MINI App 畫面示意，並非官方畫面。'),
        btn([svg('i-reset'), '重設 Demo'], reset, 'btn btn-ghost'))];
  }

  const VIEWS = { home: viewHome, lookup: viewLookup, triage: viewTriage, consent: viewConsent, submitted: viewSubmitted,
    cases: viewCases, case: viewCase, quote: viewQuote, ship: viewShip, docs: viewDocs, about: viewAbout };
  const TAB_OF = { home: 'home', lookup: 'home', triage: 'home', consent: 'home', submitted: 'home', about: 'about' };

  function render(navigated) {
    const scrollTop = screen.scrollTop;
    const wrap = h('div', { class: 'view' + (navigated ? ' enter' : '') }, VIEWS[S.view]());
    screen.replaceChildren(wrap);
    const tab = TAB_OF[S.view] || 'cases';
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    const n = todos(S).length;
    const badge = document.getElementById('tab-badge');
    badge.hidden = !n;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', n + ' 件待處理');
    if (navigated) {
      screen.scrollTop = 0;
      const title = screen.querySelector('h1');
      if (title) title.focus({ preventScroll: true });
    } else {
      screen.scrollTop = scrollTop;
    }
  }

  /* ---------- Chrome: tabs, header actions, sheet, desktop scenes ---------- */
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.tab)));
  const sheet = document.getElementById('sheet');
  const moreBtn = document.getElementById('btn-more');
  function closeSheet() { sheet.hidden = true; moreBtn.focus(); }
  moreBtn.addEventListener('click', () => { sheet.hidden = false; sheet.querySelector('.sheet-item').focus(); });
  document.getElementById('btn-close').addEventListener('click', () => toast('Demo：在 LINE 中這會關閉 MINI App，這裡保留畫面'));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return closeSheet();
    const item = e.target.closest('[data-sheet]');
    if (!item) return;
    const act = item.dataset.sheet;
    closeSheet();
    if (act === 'share') toast('Demo：不會真的分享');
    if (act === 'about') go('about');
    if (act === 'reset') reset();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  const SCENES = [
    ['免費據點查詢', '品牌／型號／購買地', () => go('lookup')],
    ['免費排查並解決', '電風扇 → 已解決', () => go('triage', { triage: freshTriage() })],
    ['危險現象', '立即停止，安全提示免費', () => { const t = freshTriage(); chooseIssue({ triage: t }, 'danger'); go('triage', { triage: t }); }],
    ['轉專人前確認費用', '服務費與維修物流分開', () => { const t = freshTriage(); t.issue = 'nospin'; t.step = 'handoff'; go('triage', { triage: t }); }],
    ['保固內・國內維修', 'SR-D101 寄件指示', () => openCase('SR-D101')],
    ['保固外・海外原廠', 'SR-D102 報價確認', () => openCase('SR-D102')],
    ['待補件・保固待認定', 'SR-D103 補購買證明', () => openCase('SR-D103')],
  ];
  const grid = document.getElementById('scene-grid');
  SCENES.forEach(([title, sub, fn], i) => grid.append(h('button', { type: 'button', class: 'scene', onclick: fn },
    h('span', { class: 'scene-n' }, String(i + 1)), h('span', {}, h('b', {}, title), h('small', {}, sub)))));
  grid.append(h('button', { type: 'button', class: 'scene scene-reset', onclick: reset }, svg('i-reset'), h('span', {}, h('b', {}, '重設 Demo'))));

  render(false);
})();
