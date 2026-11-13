/* Share Repair merchant side (brand / local repair team), front-end only.
   Shares the buyer app's in-memory state (app.js createState): no backend, no storage, no file upload, no AI.
   Role choice is a demo identity, not authorisation. Loaded before app.js; app.js binds its pricing core here.
   Top half is DOM-free (selftest.js runs it in Node); views are built from helpers app.js passes in. */
(function () {
  'use strict';

  /* ================= Pure core ================= */

  const BRAND = { id: 'aster', name: '星澄電子（虛構品牌）' };
  const TEAM = 'north'; // default repair point; the repair hub lets the user pick any point listed in the certificates
  const CATS = ['耳機', '吹風機', '遊戲主機'];
  const LICENSE = ['已授權', '待確認授權'];
  const MANUAL_KINDS = ['使用手冊', 'FAQ', '排查步驟'];
  let core = null; // { quoteComplete, line, EXCEPTION_LINE } from app.js
  const bind = (c) => { core = c; };

  function seed() {
    return {
      seq: 100, // ids for new products, manuals, messages and reports; above every seed id
      products: [
        { id: 'p1', name: '無線耳機', model: 'SE-B10', cat: '耳機', region: '日本', version: '日本版', warranty: '購買日起 12 個月', proof: '收據、電子發票或訂單截圖' },
        { id: 'p2', name: '吹風機', model: 'HD-J2', cat: '吹風機', region: '日本', version: '日本規格（100V）', warranty: '購買日起 12 個月', proof: '收據或電子發票' },
      ],
      manuals: [
        { id: 'm1', product: 'p1', title: 'SE-B10 使用手冊', kind: '使用手冊', version: '1.2', lang: '日文', region: '日本', license: '已授權', file: null },
        { id: 'm2', product: 'p1', title: '單耳無聲排查步驟', kind: '排查步驟', version: '1.0', lang: '繁體中文', region: '日本', license: '已授權', file: null },
        { id: 'm3', product: 'p2', title: 'HD-J2 常見問題', kind: 'FAQ', version: '0.9', lang: '日文', region: '日本', license: '待確認授權', file: null },
      ],
      certs: [
        { team: 'north', name: '示範合作維修點・北區', cats: ['耳機'], models: 'SE-B 系列', region: '台北市、新北市', until: '2027-06-30', scope: '檢測、單元與電池更換', active: true },
        { team: 'home', name: '示範家電維修點・北區', cats: ['吹風機'], models: 'HD 系列', region: '台北市', until: '2027-03-31', scope: '檢測、電熱與開關零件更換', active: true },
      ],
      knowledge: [],
    };
  }

  // Merchant fields added to every case (seed and new). brand: which brand owns it; mlog: brand ↔ team
  // collaboration log, never shown to the buyer; wo: the local repair work order.
  function caseExtras(c) {
    const ex = {
      'SR-D101': { brand: 'aster', cat: '耳機', info: { issue: '左耳沒有聲音', photo: true, steps: ['重新充電', '重設配對與聲道'] },
        wo: { team: 'north', status: 'approved', quote: { remote: '遠端評估：左耳單元故障，建議更換單元', labor: 900, parts: 300, shipping: 300, days: 5 }, supplements: [] },
        mlog: [['11/08 16:20', '原廠', '認定保固內，分派示範合作維修點・北區'], ['11/09 08:40', '維修點', '遠端估價：工資 900、零件 300、來回運費 300'], ['11/09 09:05', '原廠', '核准維修報價']] },
      'SR-D102': { brand: 'other', cat: '遊戲主機', info: { issue: '無法讀取遊戲片', photo: true, steps: [] }, wo: null, mlog: [] },
      'SR-D103': { brand: 'aster', cat: '吹風機', info: { issue: '運轉中自動斷電', photo: false, steps: [] }, wo: null, mlog: [] },
    }[c.id];
    return Object.assign(c, { brand: 'aster', cat: '耳機', info: null, wo: null, factory: null, mlog: [], proof: false, decision: null, danger: false }, ex || {});
  }

  const now = () => '剛剛';
  const visible = (c) => c && c.brand === BRAND.id; // brand sees only its own cases
  const myTeam = (s) => (s.m.certs.some((x) => x.team === s.team) ? s.team : TEAM);
  const teamSees = (s, c) => !!(c && c.wo && c.wo.team === myTeam(s));
  const findCase = (s, id) => s.cases.find((c) => c.id === id);
  const buyerEvent = (c, who, text) => c.events.push([now(), who, text]);
  const note = (c, who, text) => c.mlog.push([now(), who, text]);
  const text = (v, max = 300) => Array.from(typeof v === 'string' ? v.trim() : '').slice(0, max).join('');

  // Amount input: '' / null → null (unknown, not 0); otherwise a finite number ≥ 0, else invalid (NaN).
  function amount(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  }
  const isAmount = (n) => n === null || Number.isFinite(n);

  const today = () => new Date().toISOString().slice(0, 10);
  // A team may take a case only within an active, unexpired certification covering the product category.
  const certOk = (cert, cat) => !!cert && cert.active && cert.cats.includes(cat) && cert.until >= today();
  const teamsFor = (s, c) => s.m.certs.filter((x) => certOk(x, c.cat));

  /* ---- Brand ---- */

  // Warranty decision with a reason. in/out → arranging (route chosen at dispatch); docs → buyer adds proof.
  function decideWarranty(s, id, result, reason) {
    const c = findCase(s, id);
    const why = text(reason);
    if (!visible(c) || !['reviewing', 'awaitWarranty'].includes(c.status) || !['in', 'out', 'docs'].includes(result) || !why) return false;
    c.decision = { result, reason: why };
    note(c, '原廠', '保固判定：' + { in: '保固內', out: '保固外', docs: '待補購買證明' }[result] + '。依據：' + why);
    if (result === 'docs') {
      c.status = 'awaitDocs'; c.stage = 1;
      buyerEvent(c, '商家', '需要購買證明以認定保固；認定前不需寄件或付款');
      return true;
    }
    c.warranty = result; c.status = 'arranging'; c.stage = 2;
    buyerEvent(c, '商家', result === 'in' ? '認定為保固內：消費者不需付費，維修費與運費由商家負擔' : '認定為保固外：維修費與運費會先報價，經您同意才寄件或施工');
    return true;
  }

  // Route: 'domestic' to a certified team, or 'overseas' to the brand's own factory (brand then quotes itself).
  // Safety cases need the brand's explicit confirmation that the product can be shipped.
  const canDispatch = (c) => visible(c) && c.status === 'arranging' && (!c.wo || c.wo.status === 'declined') && !c.factory;
  function dispatch(s, id, { route, team, safe } = {}) {
    const c = findCase(s, id);
    if (!canDispatch(c)) return false;
    if (c.danger && safe !== true) return false;
    if (route === 'domestic') {
      const cert = s.m.certs.find((x) => x.team === team);
      if (!certOk(cert, c.cat)) return false;
      c.route = 'domestic'; c.stage = 1; c.local = '國內合作維修點處理';
      c.lines = [core.line('service', '平台服務費', null), core.line('repair', '維修費', null), core.line('shipping', '國內來回運費', null), core.EXCEPTION_LINE];
      c.wo = { team, status: 'assigned', quote: null, supplements: [] };
      note(c, '原廠', '分派 ' + cert.name + (c.danger ? '（已確認可安全運送）' : ''));
      buyerEvent(c, '商家', '已安排國內合作維修點進行遠端評估');
      return true;
    }
    if (route === 'overseas') {
      c.route = 'overseas'; c.stage = 1; c.local = '送原廠維修';
      c.lines = [core.line('service', '平台服務費', null), core.line('repair', '原廠維修費', null), core.line('shipping', '寄送至國內集運點運費', null),
        core.line('intl', '國際來回運輸（集運）', null), core.EXCEPTION_LINE];
      c.factory = { status: 'quoting' };
      note(c, '原廠', '改送原廠維修' + (c.wo ? '（維修點已婉拒）' : ''));
      buyerEvent(c, '商家', '安排送原廠維修，原廠報價中');
      return true;
    }
    return false;
  }

  // Apply an approved repair quote to the buyer's case. The platform service line is never touched here:
  // in warranty it is covered by the subscription; out of warranty it stays unpriced, so the case waits for a full quote.
  function applyQuote(c, repair, shipping, intl) {
    for (const l of c.lines) {
      if (l.key === 'repair') l.amount = repair;
      if (l.key === 'shipping') l.amount = shipping;
      if (l.key === 'intl') l.amount = intl;
    }
    c.quoteReady = true; c.stage = 2;
    c.status = core.quoteComplete(c) ? 'awaitQuote' : 'awaitPrice';
    buyerEvent(c, '商家', c.status === 'awaitQuote' ? (c.warranty === 'in' ? '處理方案已確認，請確認寄件方案（保固內不需付費）' : '報價已完整，請確認報價')
      : '維修與運費報價已送達；平台服務費尚未定價');
  }

  const quoteSum = (q) => q.labor + q.parts;
  function approveQuote(s, id) {
    const c = findCase(s, id);
    if (!visible(c) || !c.wo || c.wo.status !== 'quoted') return false;
    const q = c.wo.quote;
    if ([q.labor, q.parts, q.shipping].some((n) => n == null)) return false; // unknown ≠ 0: cannot approve
    c.wo.status = 'approved';
    note(c, '原廠', '核准維修報價');
    applyQuote(c, quoteSum(q), q.shipping);
    return true;
  }
  function returnQuote(s, id, reason) {
    const c = findCase(s, id);
    const why = text(reason);
    if (!visible(c) || !c.wo || c.wo.status !== 'quoted' || !why) return false;
    c.wo.status = 'accepted';
    note(c, '原廠', '退回報價：' + why);
    return true;
  }
  // Brand's own factory quote (overseas route). Repair and transport only; never the platform service price.
  function factoryQuote(s, id, { repair, shipping, intl } = {}) {
    const c = findCase(s, id);
    const v = [amount(repair), amount(shipping), amount(intl)];
    if (!visible(c) || !c.factory || c.factory.status !== 'quoting' || v.some((n) => n === null || !Number.isFinite(n))) return false;
    c.factory.status = 'approved';
    note(c, '原廠', '原廠報價：維修 ' + v[0] + '、國內運費 ' + v[1] + '、國際運輸 ' + v[2]);
    applyQuote(c, v[0], v[1], v[2]);
    return true;
  }
  // Supplement after inspection: in warranty only (the merchant pays; the buyer's total stays NT$0).
  function decideSupplement(s, id, ok, reason) {
    const c = findCase(s, id);
    if (!visible(c) || !c.wo || c.wo.status !== 'awaitSupplement') return false;
    const sup = c.wo.supplements[c.wo.supplements.length - 1];
    if (!ok && !text(reason)) return false;
    sup.status = ok ? 'approved' : 'returned';
    c.wo.status = 'inspected';
    if (ok) { const r = c.lines.find((l) => l.key === 'repair'); r.amount += sup.amount; }
    note(c, '原廠', (ok ? '核准追加費用 ' + sup.amount : '退回追加費用：' + text(reason)));
    return true;
  }
  // Overseas factory hand-offs after the buyer ships: one stage per step, up to domestic delivery.
  function advanceFactory(s, id, stages) {
    const c = findCase(s, id);
    if (!visible(c) || c.route !== 'overseas' || !['inTransit', 'atRepair', 'returning'].includes(c.status) || c.stage >= stages.length - 2) return false;
    c.stage += 1;
    const [name, who] = stages[c.stage];
    c.status = c.stage >= stages.length - 3 ? 'returning' : c.stage >= 6 ? 'atRepair' : 'inTransit';
    buyerEvent(c, who, name);
    return true;
  }
  // Brand message: 'buyer' goes to the buyer's case conversation; 'internal' stays in the collaboration log.
  function message(s, id, body, kind) {
    const c = findCase(s, id);
    const t = text(body);
    if (!visible(c) || !t || !['buyer', 'internal'].includes(kind)) return false;
    if (kind === 'internal') { note(c, '原廠（內部）', t); return true; }
    (s.chats[id] = s.chats[id] || []).push({ key: 'msg-' + s.m.seq++, who: '商家', a: t });
    return true;
  }

  function saveProduct(s, p) {
    const v = { name: text(p.name, 40), model: text(p.model, 40), cat: p.cat, region: text(p.region, 40), version: text(p.version, 40),
      warranty: text(p.warranty, 60), proof: text(p.proof, 60) };
    if (!v.name || !v.model || !CATS.includes(v.cat)) return null;
    const old = p.id && s.m.products.find((x) => x.id === p.id);
    if (p.id && !old) return null;
    if (old) { Object.assign(old, v); return old.id; }
    const id = 'p' + s.m.seq++;
    s.m.products.push({ id, ...v });
    return id;
  }
  // Manual / FAQ registration. A chosen file contributes only its name, type and size; its content is never read.
  function saveManual(s, m) {
    const v = { product: m.product, title: text(m.title, 60), kind: m.kind, version: text(m.version, 20), lang: text(m.lang, 20),
      region: text(m.region, 40), license: m.license,
      file: m.file ? { name: text(m.file.name, 80), type: text(m.file.type || '', 60), size: Number.isFinite(m.file.size) ? m.file.size : 0 } : null };
    if (!v.title || !s.m.products.some((x) => x.id === v.product) || !MANUAL_KINDS.includes(v.kind) || !LICENSE.includes(v.license)) return null;
    const id = 'm' + s.m.seq++;
    s.m.manuals.push({ id, ...v });
    return id;
  }
  function saveCert(s, team, c) {
    const cert = s.m.certs.find((x) => x.team === team);
    const cats = (c.cats || []).filter((x) => CATS.includes(x));
    if (!cert || !/^\d{4}-\d{2}-\d{2}$/.test(c.until || '')) return false;
    Object.assign(cert, { cats, models: text(c.models, 60), region: text(c.region, 60), until: c.until, scope: text(c.scope, 80), active: !!c.active });
    return true;
  }
  function reviewKnowledge(s, kid, ok) {
    const k = s.m.knowledge.find((x) => x.id === kid);
    if (!k || k.status !== 'pending') return false;
    k.status = ok ? 'accepted' : 'returned';
    return true;
  }

  /* ---- Local repair team (TEAM) ---- */

  // Work order transitions: action → [allowed from-states, to-state]. Anything else is refused (wrong state / double tap).
  const WO = {
    accept: [['assigned'], 'accepted'],
    decline: [['assigned', 'accepted'], 'declined'],
    quote: [['accepted'], 'quoted'],
    receive: [['approved'], 'received'],
    inspect: [['received'], 'inspected'],
    supplement: [['inspected'], 'awaitSupplement'],
    parts: [['inspected'], 'awaitParts'],
    repair: [['inspected', 'awaitParts'], 'repairing'],
    complete: [['repairing'], 'done'],
    ship: [['done'], 'returned'],
  };
  function teamAct(s, id, action, p = {}) {
    const c = findCase(s, id);
    const rule = WO[action];
    if (!rule || !teamSees(s, c) || !rule[0].includes(c.wo.status)) return false;
    const why = text(p.note);
    switch (action) {
      case 'accept':
        note(c, '維修點', '接單，開始遠端評估');
        buyerEvent(c, '在地維修團隊', '已接單，進行遠端評估');
        break;
      case 'decline':
        if (!why || !['decline', 'factory'].includes(p.kind)) return false;
        c.wo.result = p.kind;
        note(c, '維修點', (p.kind === 'factory' ? '建議轉原廠：' : '婉拒：') + why);
        break;
      case 'quote': {
        const q = { remote: text(p.remote), labor: amount(p.labor), parts: amount(p.parts), shipping: amount(p.shipping), days: amount(p.days) };
        if (!q.remote || ![q.labor, q.parts, q.shipping, q.days].every(isAmount)) return false;
        c.wo.quote = q;
        note(c, '維修點', '提交遠端估價' + ([q.labor, q.parts, q.shipping].includes(null) ? '（部分項目待確認）' : ''));
        break;
      }
      case 'receive':
        if (c.status !== 'inTransit') return false; // the buyer has not shipped yet
        c.status = 'atRepair'; c.stage = 5;
        buyerEvent(c, '在地維修團隊', '維修點已收件，開始檢測');
        break;
      case 'inspect':
        if (!why) return false;
        c.wo.inspection = why;
        note(c, '維修點', '收件後檢測：' + why);
        buyerEvent(c, '在地維修團隊', '收件後檢測完成');
        break;
      case 'supplement': {
        const n = amount(p.amount);
        if (c.warranty !== 'in' || !why || !Number.isFinite(n) || n <= 0) return false;
        c.wo.supplements.push({ amount: n, reason: why, status: 'pending' });
        note(c, '維修點', '提報追加費用 ' + n + '：' + why + '（核准前不施工）');
        break;
      }
      case 'parts':
        buyerEvent(c, '在地維修團隊', '等待零件中');
        break;
      case 'repair':
        buyerEvent(c, '在地維修團隊', '開始維修');
        break;
      case 'complete':
        if (!why) return false;
        c.wo.report = { text: why, photo: !!p.photo };
        note(c, '維修點', '完修：' + why + (p.photo ? '（附示範照片）' : ''));
        buyerEvent(c, '在地維修團隊', '維修完成，準備寄回');
        break;
      case 'ship':
        c.status = 'returning'; c.stage = 6; c.returnTracking = 'RT-' + id.slice(-3) + '-01';
        buyerEvent(c, '在地維修團隊', '已寄回，追蹤號 ' + c.returnTracking);
        break;
    }
    c.wo.status = rule[1];
    return true;
  }
  // New fault knowledge from the team: queued for the brand's confirmation; nothing is added to any AI.
  function reportKnowledge(s, product, body) {
    const t = text(body);
    if (!t || !s.m.products.some((x) => x.id === product)) return null;
    const id = 'k' + s.m.seq++;
    s.m.knowledge.push({ id, product, text: t, status: 'pending' });
    return id;
  }

  const WO_LABEL = { assigned: '待接單', accepted: '遠端評估中', quoted: '待原廠核准報價', declined: '已婉拒', received: '已收件・待檢測',
    inspected: '已檢測', awaitSupplement: '追加費用待核准', awaitParts: '待料', repairing: '維修中', done: '完修・待寄回', returned: '已寄回' };
  function woLabel(c) {
    const w = c.wo;
    if (!w) return '';
    if (w.status === 'declined') return w.result === 'factory' ? '建議轉原廠' : '已婉拒';
    if (w.status !== 'approved') return WO_LABEL[w.status];
    return c.status === 'inTransit' ? '待收件' : c.status === 'awaitShip' ? '待買家寄件' : '待買家確認';
  }
  const approvedTotal = (w) => (w && w.quote && ['approved', 'received', 'inspected', 'awaitSupplement', 'awaitParts', 'repairing', 'done', 'returned'].includes(w.status)
    ? w.quote.labor + w.quote.parts + w.quote.shipping + w.supplements.filter((x) => x.status === 'approved').reduce((a, x) => a + x.amount, 0) : 0);

  // What the brand must act on.
  function brandTodo(c) {
    if (!visible(c)) return null;
    if (['reviewing', 'awaitWarranty'].includes(c.status)) return '待判定保固';
    if (canDispatch(c)) return c.wo ? '維修點' + woLabel(c) + '，待重新分派' : '待分派處理方式';
    if (c.factory && c.factory.status === 'quoting') return '待提供原廠報價';
    if (c.wo && c.wo.status === 'quoted') return '待核准維修報價';
    if (c.wo && c.wo.status === 'awaitSupplement') return '追加費用待核准';
    return null;
  }
  function teamTodo(s, c) {
    if (!teamSees(s, c)) return null;
    const w = c.wo.status;
    if (w === 'assigned') return '待接單';
    if (w === 'accepted') return '待提交遠端估價';
    if (w === 'approved' && c.status === 'inTransit') return '待收件';
    if (['received', 'inspected', 'awaitParts', 'repairing', 'done'].includes(w)) return WO_LABEL[w];
    return null;
  }

  /* ---- Views & routing ---- */

  const VIEW_META = {
    bHome: { title: '原廠工作台', parent: 'merchant' },
    bCases: { title: '品牌案件', parent: 'bHome' },
    bCase: { title: '案件處理', parent: 'bCases' },
    bDecide: { title: '保固判定', parent: 'bCase' },
    bDispatch: { title: '分派處理方式', parent: 'bCase' },
    bFactory: { title: '原廠報價', parent: 'bCase' },
    bMessage: { title: '回覆與備註', parent: 'bCase' },
    bCatalog: { title: '商品與手冊', parent: 'bHome' },
    bProduct: { title: '商品資料', parent: 'bCatalog' },
    bManual: { title: '登錄手冊／FAQ', parent: 'bCatalog' },
    bCerts: { title: '合作維修點', parent: 'bHome' },
    bCert: { title: '認證範圍', parent: 'bCerts' },
    bBilling: { title: '訂閱與費用', parent: 'bHome' },
    rHome: { title: '維修工作台', parent: 'merchant' },
    rOrder: { title: '工作單', parent: 'rHome' },
    rDecline: { title: '婉拒或轉原廠', parent: 'rOrder' },
    rQuote: { title: '遠端估價', parent: 'rOrder' },
    rReport: { title: '檢測與完修回報', parent: 'rOrder' },
    rSupp: { title: '追加費用', parent: 'rOrder' },
    rRef: { title: '手冊與故障知識', parent: 'rHome' },
    rAccount: { title: '認證與結算', parent: 'rHome' },
  };
  const BRAND_VIEWS = Object.keys(VIEW_META).filter((v) => v[0] === 'b');

  // Screen allowed for this state (prevents stale history or tools from opening a wrong form). Not security.
  function resolve(s, view) {
    const home = s.merchantRole === 'brand' ? 'bHome' : 'rHome';
    if ((view[0] === 'b') !== (s.merchantRole === 'brand')) return home;
    const c = s.caseId ? findCase(s, s.caseId) : null;
    if (view === 'bCase' || BRAND_VIEWS.includes(view) && VIEW_META[view].parent === 'bCase') {
      if (!visible(c)) return 'bCases';
      if (view === 'bDecide' && !['reviewing', 'awaitWarranty'].includes(c.status)) return 'bCase';
      if (view === 'bDispatch' && !canDispatch(c)) return 'bCase';
      if (view === 'bFactory' && !(c.factory && c.factory.status === 'quoting')) return 'bCase';
      return view;
    }
    if (['rOrder', 'rDecline', 'rQuote', 'rReport', 'rSupp'].includes(view)) {
      if (!teamSees(s, c)) return 'rHome';
      const w = c.wo.status;
      if (view === 'rDecline' && !WO.decline[0].includes(w)) return 'rOrder';
      if (view === 'rQuote' && w !== 'accepted') return 'rOrder';
      if (view === 'rReport' && !['received', 'repairing'].includes(w)) return 'rOrder';
      if (view === 'rSupp' && !(w === 'inspected' && c.warranty === 'in')) return 'rOrder';
    }
    return view;
  }

  /* ================= Views (browser only; helpers come from app.js) ================= */

  // ui: { state, h, svg, btn, subnav, back, backTo, go, snack, listRow, toggle, feeTable, timeline, statusTag, warrantyTag,
  //       routeTag, money, STAGES, WARRANTY, switchRole }
  function views(ui) {
    const { h, svg, btn, subnav, back, backTo, go, snack, listRow, toggle, money } = ui;
    const S = () => ui.state();
    const cur = () => findCase(S(), S().caseId);
    const yen = (n) => (n == null ? '待確認' : money(n));
    const kv = (k, v) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v));
    const certName = (team) => (S().m.certs.find((x) => x.team === team) || {}).name || team;
    const productName = (id) => { const p = S().m.products.find((x) => x.id === id); return p ? p.name + '（' + p.model + '）' : '—'; };

    // Role bar under every hub: who you are acting as, and the identity switch.
    const roleBar = (label) => h('div', { class: 'role-bar' }, h('span', { class: 'row-sub' }, '目前身分：' + label),
      btn('切換身分', ui.switchRole, 'link-btn', 'switch-role'));

    /* ---- Forms: plain controls, values read with .value, errors announced ---- */
    let uid = 0;
    function field(label, el, help) {
      el.id = el.id || 'mf-' + (++uid);
      const hid = help ? el.id + '-h' : null;
      if (hid) el.setAttribute('aria-describedby', hid);
      return [h('label', { for: el.id, class: 'label' }, label), el, help ? h('p', { class: 'help', id: hid }, help) : null];
    }
    const input = (name, value, attrs) => { const el = h('input', { class: 'field', type: 'text', name, autocomplete: 'off', ...attrs }); el.value = value == null ? '' : String(value); return el; };
    const money_ = (name, value) => input(name, value, { inputmode: 'numeric', placeholder: '空白＝待確認', 'data-act': 'f-' + name });
    const area = (name, value, attrs) => { const el = h('textarea', { class: 'field', name, rows: '3', ...attrs }); el.value = value || ''; return el; };
    const select = (name, opts, value) => h('select', { class: 'field', name }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    const choices = (legend, name, opts, value) => h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, legend),
      h('div', { class: 'choices' }, opts.map(([v, l, dis]) => h('label', { class: 'choice' + (dis ? ' choice-off' : '') },
        h('input', { type: 'radio', name, value: v, checked: v === value, disabled: !!dis, 'data-act': name + '-' + v }), h('span', {}, l)))));
    const check = (name, label, checked) => h('label', { class: 'choice' }, h('input', { type: 'checkbox', name, checked: !!checked, 'data-act': 'f-' + name }), h('span', {}, label));
    function form(kids, submitLabel, act, onSubmit) {
      const err = h('p', { class: 'note note-warn', role: 'alert', hidden: true });
      let sent = false; // a second tap before navigation finishes must not save twice
      const f = h('form', { class: 'block form', novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        if (sent) return;
        const val = (n) => { const el = f.elements[n]; return el && el.type === 'checkbox' ? el.checked : el ? el.value : undefined; };
        const msg = onSubmit(val, f);
        sent = !msg;
        if (msg) { err.textContent = msg; err.hidden = false; err.setAttribute('tabindex', '-1'); err.focus(); }
      } }, kids, err, h('button', { type: 'submit', class: 'btn btn-primary', 'data-act': act }, submitLabel));
      return f;
    }
    const done = (view, msg) => { back(view); snack(msg); return null; };

    /* ---- Shared case panels ---- */
    function buyerInfo(c) {
      const i = c.info || {};
      return h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '買家提供資料'),
        h('dl', { class: 'kvs' }, kv('問題', i.issue || '—'), kv('照片', i.photo ? '已附照片（插圖）' : '未附'),
          kv('排查', i.steps && i.steps.length ? i.steps.length + ' 個步驟後仍未排除' : '未經排查步驟'),
          kv('購買證明', c.proof ? '已提供（插圖）' : c.status === 'awaitDocs' ? '等待買家補充' : '未要求')),
        i.photo ? h('div', { class: 'block-body' }, svg('ill-' + c.ill, 'status-ill')) : null);
    }
    function quoteBox(c) {
      const w = c.wo;
      if (!w || !w.quote) return null;
      const q = w.quote;
      return h('dl', { class: 'kvs' }, kv('估價', q.remote), kv('工資', yen(q.labor)), kv('零件', yen(q.parts)), kv('運費', yen(q.shipping)),
        kv('預估', q.days == null ? '待確認' : q.days + ' 天'),
        ...w.supplements.map((x) => kv('追加', money(x.amount) + '・' + x.reason + '（' + { pending: '待核准', approved: '已核准', returned: '已退回' }[x.status] + '）')));
    }
    const logPanel = (c, key) => toggle(c.id + ':' + key, '內部協作紀錄（買家不可見）（' + c.mlog.length + '）',
      h('ul', { class: 'events' }, c.mlog.slice().reverse().map(([t, who, x]) => h('li', {}, h('span', { class: 'caption' }, t + '・' + who), h('p', {}, x)))), 'mlog');
    const caseHead = (c, todo) => h('section', { class: 'block status' },
      h('div', { class: 'status-top' }, svg('ill-' + c.ill, 'status-ill'),
        h('div', { class: 'status-text' }, h('p', { class: 'caption' }, c.product + '｜' + c.id), h('p', { class: 'status-now' }, todo || ui.STATUS[c.status].label),
          h('span', { class: 'tags' }, ui.warrantyTag(c), ui.routeTag(c), c.wo ? h('span', { class: 'tag tag-plain' }, woLabel(c)) : null))),
      c.danger ? h('p', { class: 'note note-warn' }, svg('i-alert'), '買家回報安全疑慮：分派前須確認可安全運送。') : null);

    /* ---------- Brand ---------- */
    const openB = (id) => go('bCase', { caseId: id });
    function bHome() {
      const cases = S().cases.filter(visible);
      const todo = cases.filter(brandTodo);
      const pend = S().m.knowledge.filter((k) => k.status === 'pending').length;
      return [subnav(VIEW_META.bHome.title, backTo('merchant')), roleBar('品牌／原廠・' + BRAND.name),
        h('section', { class: 'block', 'aria-labelledby': 'b-todo' },
          h('h2', { class: 'list-header', id: 'b-todo' }, '待處理', todo.length ? h('span', { class: 'count-badge' }, String(todo.length)) : null),
          todo.length ? h('ul', { class: 'list' }, todo.map((c) => listRow({ ill: c.ill, title: brandTodo(c), sub: c.id + '｜' + c.product, onclick: () => openB(c.id), act: 'btodo-' + c.id })))
            : h('p', { class: 'block-body caption' }, '目前沒有需要處理的案件。')),
        h('section', { class: 'block', 'aria-labelledby': 'b-menu' }, h('h2', { class: 'list-header', id: 'b-menu' }, '管理'),
          h('ul', { class: 'list' },
            listRow({ icon: 'i-cases', title: '品牌案件', sub: '判讀、保固判定、分派與報價核准', right: cases.length + ' 件', onclick: () => go('bCases'), act: 'b-cases' }),
            listRow({ icon: 'i-info', title: '商品與手冊', sub: '商品建檔、手冊與 FAQ 登錄' + (pend ? '・' + pend + ' 則故障知識待確認' : ''), onclick: () => go('bCatalog'), act: 'b-catalog' }),
            listRow({ icon: 'i-shield', title: '合作維修點', sub: '認證品類、型號、地區與有效期限', onclick: () => go('bCerts'), act: 'b-certs' }),
            listRow({ icon: 'i-tools', title: '訂閱與費用', sub: '訂閱涵蓋範圍與商家負擔費用明細', onclick: () => go('bBilling'), act: 'b-billing' })))];
    }
    function bCases() {
      return [subnav(VIEW_META.bCases.title, backTo('bHome')), h('p', { class: 'intro' }, '僅顯示本品牌案件。'),
        h('section', { class: 'block' }, h('ul', { class: 'list' }, S().cases.filter(visible).map((c) => h('li', {},
          h('button', { type: 'button', class: 'row case-row', 'data-act': 'bcase-' + c.id, onclick: () => openB(c.id) }, svg('ill-' + c.ill, 'row-thumb'),
            h('span', { class: 'row-main' }, h('span', { class: 'case-top' }, h('span', { class: 'row-title' }, c.product), h('span', { class: 'case-id' }, c.id)),
              h('span', { class: 'tags' }, ui.statusTag(c), ui.warrantyTag(c), c.wo ? h('span', { class: 'tag tag-plain' }, woLabel(c)) : null),
              h('span', { class: 'row-sub' }, brandTodo(c) ? '待辦：' + brandTodo(c) : '買家狀態：' + ui.STATUS[c.status].next)), svg('i-chev', 'ic chev'))))))];
    }
    function bCase() {
      const c = cur();
      const todo = brandTodo(c);
      const w = c.wo;
      const acts = [];
      if (['reviewing', 'awaitWarranty'].includes(c.status)) acts.push(btn('判定保固', () => go('bDecide'), 'btn btn-primary', 'b-decide'));
      if (canDispatch(c)) acts.push(btn('分派處理方式', () => go('bDispatch'), 'btn btn-primary', 'b-dispatch'));
      if (c.factory && c.factory.status === 'quoting') acts.push(btn('提供原廠報價', () => go('bFactory'), 'btn btn-primary', 'b-factory'));
      let review = null;
      if (w && (w.status === 'quoted' || w.status === 'awaitSupplement')) {
        const sup = w.status === 'awaitSupplement';
        const unknown = !sup && [w.quote.labor, w.quote.parts, w.quote.shipping].includes(null);
        const reason = input('reason', '', { 'data-act': 'f-return-reason', maxlength: '100' });
        review = h('section', { class: 'block', 'aria-labelledby': 'b-review' }, h('h2', { class: 'list-header', id: 'b-review' }, sup ? '追加費用核准' : '維修報價核准'),
          h('div', { class: 'block-body' },
            unknown ? h('p', { class: 'note note-warn' }, svg('i-alert'), '有項目尚待確認，無法核准；可退回請維修點補齊。') : null,
            btn(sup ? '核准追加費用' : '核准報價', () => {
              if (sup ? decideSupplement(S(), c.id, true) : approveQuote(S(), c.id)) { ui.render(false); snack(sup ? '已核准追加費用' : '已核准報價，買家可確認'); }
            }, 'btn btn-primary', sup ? 'b-sup-ok' : 'b-approve', { disabled: unknown }),
            field('退回原因', reason), btn('退回', () => {
              if (sup ? decideSupplement(S(), c.id, false, reason.value) : returnQuote(S(), c.id, reason.value)) { ui.render(false); snack('已退回維修點'); }
              else { reason.focus(); snack('請填寫退回原因'); }
            }, 'btn btn-outline', sup ? 'b-sup-return' : 'b-return')));
      }
      const stages = ui.STAGES[c.route];
      const canAdvance = c.route === 'overseas' && ['inTransit', 'atRepair', 'returning'].includes(c.status) && c.stage < stages.length - 2;
      return [subnav(VIEW_META.bCase.title, backTo('bCases')), caseHead(c, todo),
        acts.length ? h('div', { class: 'actions' }, acts) : null,
        review,
        buyerInfo(c),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '判定與處理'),
          h('dl', { class: 'kvs' }, kv('保固', c.decision ? { in: '保固內', out: '保固外', docs: '待補購買證明' }[c.decision.result] : ui.WARRANTY[c.warranty]),
            c.decision ? kv('依據', c.decision.reason) : null,
            kv('處理', w ? certName(w.team) + '・' + woLabel(c) : c.factory ? '原廠維修・' + (c.factory.status === 'quoting' ? '待原廠報價' : '已報價') : '尚未分派')),
          quoteBox(c),
          toggle(c.id + ':bfees', '買家費用與付款方', ui.feeTable(c), 'b-fees')),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '處理進度'), ui.timeline(c, true),
          canAdvance ? h('div', { class: 'block-body' }, btn('更新原廠交接：' + stages[c.stage + 1][0], () => {
            if (advanceFactory(S(), c.id, stages)) { ui.render(false); snack('已更新交接進度'); }
          }, 'btn btn-outline btn-sm', 'b-advance')) : null),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '溝通'),
          h('div', { class: 'block-body' }, ...((S().chats[c.id] || []).filter((m) => m.who).map((m) => h('p', { class: 'caption' }, '已回覆買家：' + m.a))),
            btn('回覆買家或內部備註', () => go('bMessage'), 'btn btn-outline btn-sm', 'b-message')),
          logPanel(c, 'blog'))];
    }
    function bDecide() {
      const c = cur();
      return [subnav(VIEW_META.bDecide.title, backTo('bCase')), h('p', { class: 'intro' }, c.product + '｜' + c.id + '・' + (c.proof ? '已附購買證明' : '未附購買證明')),
        form([choices('判定結果', 'result', [['in', '保固內'], ['out', '保固外'], ['docs', '待補購買證明']], null),
          field('判定依據', area('reason', '', { 'data-act': 'f-reason', maxlength: '300' }), '依據留在內部協作紀錄；買家只看到判定結果。')],
        '送出判定', 'b-decide-submit', (val) => (decideWarranty(S(), c.id, val('result'), val('reason')) ? done('bCase', '已送出保固判定') : '請選擇判定結果並填寫依據。'))];
    }
    function bDispatch() {
      const c = cur();
      const ok = teamsFor(S(), c);
      const others = S().m.certs.filter((x) => !ok.includes(x)).length;
      return [subnav(VIEW_META.bDispatch.title, backTo('bCase')),
        h('p', { class: 'intro' }, c.product + '（' + c.cat + '）・' + ui.WARRANTY[c.warranty]),
        form([choices('處理方式', 'route', [...ok.map((x) => ['domestic:' + x.team, '國內維修：' + x.name]), ['overseas', '送原廠維修（由原廠報價）']], null),
          others ? h('p', { class: 'help' }, others + ' 個合作維修點的認證範圍或期限不符，無法分派。') : null,
          c.danger ? check('safe', '已評估商品可安全運送', false) : null],
        '確認分派', 'b-dispatch-submit', (val) => {
          const r = val('route') || '';
          const okd = dispatch(S(), c.id, r === 'overseas' ? { route: 'overseas', safe: val('safe') } : { route: 'domestic', team: r.split(':')[1], safe: val('safe') });
          return okd ? done('bCase', '已分派處理方式') : c.danger && !val('safe') ? '安全疑慮案件須先確認可安全運送。' : '請選擇處理方式。';
        })];
    }
    function bFactory() {
      const c = cur();
      return [subnav(VIEW_META.bFactory.title, backTo('bCase')), h('p', { class: 'intro' }, '原廠只填寫自己的維修與運輸費用；平台服務費不由原廠訂定。'),
        form([field('原廠維修費（NT$）', money_('repair')), field('寄送至國內集運點運費（NT$）', money_('shipping')), field('國際來回運輸（NT$）', money_('intl'))],
          '送出原廠報價', 'b-factory-submit', (val) => (factoryQuote(S(), c.id, { repair: val('repair'), shipping: val('shipping'), intl: val('intl') })
            ? done('bCase', '已送出原廠報價') : '請填寫所有金額（0 以上的數字）。'))];
    }
    function bMessage() {
      const c = cur();
      return [subnav(VIEW_META.bMessage.title, backTo('bCase')),
        form([choices('對象', 'kind', [['buyer', '回覆買家（顯示在買家案件對話）'], ['internal', '內部技術備註（買家不可見）']], 'buyer'),
          field('內容', area('body', '', { 'data-act': 'f-body', maxlength: '300' }))],
        '送出', 'b-message-submit', (val) => (message(S(), c.id, val('body'), val('kind')) ? done('bCase', val('kind') === 'buyer' ? '已回覆買家' : '已加入內部備註') : '請填寫內容。'))];
    }
    function bCatalog() {
      const m = S().m;
      const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
      const K = { pending: '待原廠確認', accepted: '已確認', returned: '已退回' };
      return [subnav(VIEW_META.bCatalog.title, backTo('bHome')),
        h('p', { class: 'intro' }, '資料只登錄欄位；選擇的檔案只記錄檔名、格式與大小，不讀取內容，也不建置 AI 知識。'),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '商品'),
          h('ul', { class: 'list' }, m.products.map((p) => listRow({ icon: 'i-cases', title: p.name + '（' + p.model + '）', sub: [p.cat, p.region, p.version, p.warranty].filter(Boolean).join('・'),
            onclick: () => { S().editProduct = p.id; go('bProduct'); }, act: 'bprod-' + p.id }))),
          h('div', { class: 'block-body' }, btn('新增商品', () => { S().editProduct = null; go('bProduct'); }, 'btn btn-outline btn-sm', 'b-add-product'))),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '手冊與 FAQ'),
          h('ul', { class: 'events' }, m.manuals.map((x) => h('li', { 'data-manual': x.id }, h('span', { class: 'caption' }, productName(x.product) + '・' + x.kind),
            h('p', {}, x.title), h('p', { class: 'caption' }, ['版本 ' + (x.version || '—'), x.lang, x.region, x.license].filter(Boolean).join('・')
              + (x.file ? '・檔案 ' + x.file.name + '（' + size(x.file.size) + '）' : ''))))),
          h('div', { class: 'block-body' }, btn('登錄手冊／FAQ', () => go('bManual'), 'btn btn-outline btn-sm', 'b-add-manual'))),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '維修點回報的故障知識'),
          m.knowledge.length ? h('ul', { class: 'events' }, m.knowledge.map((k) => h('li', {}, h('span', { class: 'caption' }, productName(k.product) + '・' + K[k.status]), h('p', {}, k.text),
            k.status === 'pending' ? h('div', { class: 'two' },
              btn('確認納入', () => { reviewKnowledge(S(), k.id, true); ui.render(false); snack('已確認'); }, 'btn btn-outline btn-sm', 'bk-ok-' + k.id),
              btn('退回', () => { reviewKnowledge(S(), k.id, false); ui.render(false); snack('已退回'); }, 'btn btn-ghost btn-sm', 'bk-no-' + k.id)) : null)))
            : h('p', { class: 'block-body caption' }, '目前沒有回報。'))];
    }
    function bProduct() {
      const p = S().m.products.find((x) => x.id === S().editProduct) || {};
      return [subnav(p.id ? '編輯商品' : '新增商品', backTo('bCatalog')),
        form([field('品名', input('name', p.name, { maxlength: '40', 'data-act': 'f-name' })), field('型號', input('model', p.model, { maxlength: '40', 'data-act': 'f-model' })),
          field('品類', select('cat', CATS.map((x) => [x, x]), p.cat || CATS[0])), field('販售地區', input('region', p.region, { maxlength: '40' })),
          field('版本／電壓', input('version', p.version, { maxlength: '40' })), field('保固條件', input('warranty', p.warranty, { maxlength: '60' })),
          field('購買憑證要求', input('proof', p.proof, { maxlength: '60' }))],
        '儲存商品', 'b-product-submit', (val) => (saveProduct(S(), { id: p.id, name: val('name'), model: val('model'), cat: val('cat'), region: val('region'),
          version: val('version'), warranty: val('warranty'), proof: val('proof') }) ? done('bCatalog', '已儲存商品') : '請填寫品名與型號。'))];
    }
    function bManual() {
      const file = h('input', { type: 'file', class: 'field', name: 'file', accept: '.pdf,.txt,.md,.doc,.docx', 'data-act': 'f-file' });
      return [subnav(VIEW_META.bManual.title, backTo('bCatalog')),
        form([field('商品', select('product', S().m.products.map((p) => [p.id, p.name + '（' + p.model + '）']), S().m.products[0].id)),
          field('標題', input('title', '', { maxlength: '60', 'data-act': 'f-title' })), field('類型', select('kind', MANUAL_KINDS.map((x) => [x, x]), MANUAL_KINDS[0])),
          field('版本', input('version', '', { maxlength: '20' })), field('語言', input('lang', '', { maxlength: '20' })), field('適用地區', input('region', '', { maxlength: '40' })),
          field('授權狀態', select('license', LICENSE.map((x) => [x, x]), LICENSE[1])),
          field('檔案（選填）', file, '只記錄檔名、格式與大小。')],
        '登錄', 'b-manual-submit', (val) => {
          const f = file.files && file.files[0];
          return saveManual(S(), { product: val('product'), title: val('title'), kind: val('kind'), version: val('version'), lang: val('lang'), region: val('region'),
            license: val('license'), file: f ? { name: f.name, type: f.type, size: f.size } : null }) ? done('bCatalog', '已登錄') : '請填寫標題。';
        })];
    }
    const certState = (x) => (!x.active ? '已停用' : x.until < today() ? '已過期' : '有效');
    function bCerts() {
      return [subnav(VIEW_META.bCerts.title, backTo('bHome')), h('p', { class: 'intro' }, '虛構的合作維修點，不代表任何真實店家已取得認證。'),
        ...S().m.certs.map((x) => h('section', { class: 'block' }, h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, x.name), h('span', { class: 'tag ' + (certState(x) === '有效' ? 'tag-ok' : 'tag-pending') }, certState(x))),
          h('dl', { class: 'kvs' }, kv('品類', x.cats.join('、') || '—'), kv('型號', x.models || '—'), kv('地區', x.region || '—'), kv('期限', x.until), kv('範圍', x.scope || '—')),
          h('div', { class: 'block-body' }, btn('調整認證範圍', () => { S().editCert = x.team; go('bCert'); }, 'btn btn-outline btn-sm', 'bcert-' + x.team))))];
    }
    function bCert() {
      const x = S().m.certs.find((c) => c.team === S().editCert) || S().m.certs[0];
      return [subnav(x.name, backTo('bCerts')),
        form([h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, '認證品類'), h('div', { class: 'choices' }, CATS.map((k) => check('cat-' + k, k, x.cats.includes(k))))),
          field('型號', input('models', x.models, { maxlength: '60' })), field('地區', input('region', x.region, { maxlength: '60' })),
          field('有效期限', input('until', x.until, { type: 'date', 'data-act': 'f-until' })), field('服務範圍', input('scope', x.scope, { maxlength: '80' })),
          check('active', '啟用此認證', x.active)],
        '儲存認證範圍', 'b-cert-submit', (val) => (saveCert(S(), x.team, { cats: CATS.filter((k) => val('cat-' + k)), models: val('models'), region: val('region'),
          until: val('until'), scope: val('scope'), active: val('active') }) ? done('bCerts', '已更新認證範圍') : '請填寫有效期限。'))];
    }
    function bBilling() {
      const rows = S().cases.filter((c) => visible(c) && c.warranty === 'in').flatMap((c) => c.lines
        .filter((l) => l.key !== 'service' && l.key !== 'exception' && l.amount != null).map((l) => [c.id, l.label, l.amount]));
      const total = rows.reduce((a, r) => a + r[2], 0);
      return [subnav(VIEW_META.bBilling.title, backTo('bHome')),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '商家訂閱'),
          h('dl', { class: 'kvs' }, kv('方案', '商家訂閱（情境資料）'), kv('涵蓋', '保固內平台服務；不另收單筆服務費'), kv('狀態', '有效'))),
        h('section', { class: 'block' }, h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '保固內商家負擔費用'), ui.sampleTag()),
          rows.length ? h('dl', { class: 'kvs' }, rows.map(([id, label, n]) => kv(id, label + '　' + money(n))), kv('合計', money(total)))
            : h('p', { class: 'block-body caption' }, '目前沒有已核准的費用。'),
          h('p', { class: 'block-body caption' }, '對帳明細僅供查看，不收款、不開立發票。買家於保固內應付 NT$ 0。'))];
    }

    /* ---------- Local repair team ---------- */
    const openR = (id) => go('rOrder', { caseId: id });
    const myCert = () => S().m.certs.find((x) => x.team === myTeam(S()));
    const sees = (c) => teamSees(S(), c);
    // Which certified repair point the user acts as (demo identity, like the role choice).
    const teamPick = () => h('div', { class: 'block-body' }, h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, '以哪個維修點操作'),
      h('div', { class: 'choices' }, S().m.certs.map((x) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'team', value: x.team, checked: x.team === myTeam(S()), 'data-act': 'team-' + x.team,
          onchange: () => { S().team = x.team; ui.render(false); } }), h('span', {}, x.name))))));
    function rHome() {
      const orders = S().cases.filter(sees);
      const todo = orders.filter((c) => teamTodo(S(), c));
      return [subnav(VIEW_META.rHome.title, backTo('merchant')), roleBar('在地認證維修團隊・' + myCert().name), teamPick(),
        h('section', { class: 'block', 'aria-labelledby': 'r-todo' },
          h('h2', { class: 'list-header', id: 'r-todo' }, '待處理工作單', todo.length ? h('span', { class: 'count-badge' }, String(todo.length)) : null),
          todo.length ? h('ul', { class: 'list' }, todo.map((c) => listRow({ ill: c.ill, title: teamTodo(S(), c), sub: c.id + '｜' + c.product, onclick: () => openR(c.id), act: 'rtodo-' + c.id })))
            : h('p', { class: 'block-body caption' }, '目前沒有待處理工作單。')),
        h('section', { class: 'block', 'aria-labelledby': 'r-all' }, h('h2', { class: 'list-header', id: 'r-all' }, '全部工作單'),
          orders.length ? h('ul', { class: 'list' }, orders.map((c) => listRow({ ill: c.ill, title: c.product, sub: c.id + '｜' + woLabel(c), onclick: () => openR(c.id), act: 'rorder-' + c.id })))
            : h('p', { class: 'block-body caption' }, '尚無工作單。')),
        h('section', { class: 'block' }, h('ul', { class: 'list' },
          listRow({ icon: 'i-info', title: '手冊與故障知識', sub: '查看授權資料、回報新故障知識', onclick: () => go('rRef'), act: 'r-ref' }),
          listRow({ icon: 'i-shield', title: '認證與結算', sub: '認證範圍與已核准金額', onclick: () => go('rAccount'), act: 'r-account' })))];
    }
    // Team view never shows the buyer's booking name or LINE data.
    function rOrder() {
      const c = cur();
      const w = c.wo.status;
      const act = (label, a, cls, p) => btn(label, () => { if (teamAct(S(), c.id, a, p)) { ui.render(false); snack('已更新：' + woLabel(c)); } }, cls || 'btn btn-primary', 'r-' + a);
      const acts = {
        assigned: [act('接單', 'accept'), btn('婉拒或建議轉原廠', () => go('rDecline'), 'btn btn-outline', 'r-decline')],
        accepted: [btn('提交遠端估價', () => go('rQuote'), 'btn btn-primary', 'r-quote'), btn('婉拒或建議轉原廠', () => go('rDecline'), 'btn btn-outline', 'r-decline')],
        received: [btn('收件後檢測回報', () => go('rReport'), 'btn btn-primary', 'r-inspect')],
        inspected: [act('開始維修', 'repair'), act('等待零件', 'parts', 'btn btn-outline'),
          c.warranty === 'in' ? btn('提報追加費用', () => go('rSupp'), 'btn btn-outline', 'r-supp') : null],
        awaitParts: [act('零件到貨，開始維修', 'repair')],
        repairing: [btn('完修回報', () => go('rReport'), 'btn btn-primary', 'r-complete')],
        done: [act('寄回並交接', 'ship')],
      }[w] || (w === 'approved' && c.status === 'inTransit' ? [act('登記收件', 'receive')] : []);
      const wait = { quoted: '等待原廠核准報價。', awaitSupplement: '追加費用待原廠核准，核准前不施工。', declined: '已回報原廠，等待重新分派。', returned: '已寄回，等待買家簽收。' }[w]
        || (w === 'approved' && c.status !== 'inTransit' ? '報價已核准，等待買家確認並寄件。' : null);
      const manuals = S().m.manuals.filter((x) => { const p = S().m.products.find((q) => q.id === x.product); return p && p.cat === c.cat; });
      return [subnav(VIEW_META.rOrder.title, backTo('rHome')), caseHead(c, woLabel(c)),
        acts.length ? h('div', { class: 'actions' }, acts.filter(Boolean)) : null,
        wait ? h('p', { class: 'intro' }, wait) : null,
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '故障資訊'),
          h('dl', { class: 'kvs' }, kv('品類', c.cat), kv('問題', (c.info || {}).issue || '—'), kv('照片', (c.info || {}).photo ? '已附照片（插圖）' : '未附'), kv('保固', ui.WARRANTY[c.warranty]))),
        c.wo.quote ? h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '估價與檢測'), quoteBox(c),
          c.wo.inspection ? h('p', { class: 'block-body' }, '收件後檢測：' + c.wo.inspection) : null) : null,
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '技術資料'),
          manuals.length ? h('ul', { class: 'events' }, manuals.map((x) => h('li', {}, h('p', {}, x.title), h('span', { class: 'caption' }, x.kind + '・' + (x.version || '—') + '・' + x.license))))
            : h('p', { class: 'block-body caption' }, '此品類尚無登錄資料。'),
          logPanel(c, 'rlog')),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '處理進度'), ui.timeline(c, true))];
    }
    function rDecline() {
      const c = cur();
      return [subnav(VIEW_META.rDecline.title, backTo('rOrder')),
        form([choices('類型', 'kind', [['factory', '建議轉原廠'], ['decline', '婉拒此工作單']], 'factory'), field('原因', area('note', '', { 'data-act': 'f-note', maxlength: '300' }), '原因會顯示給原廠。')],
          '送出', 'r-decline-submit', (val) => (teamAct(S(), c.id, 'decline', { kind: val('kind'), note: val('note') }) ? done('rOrder', '已回報原廠') : '請填寫原因。'))];
    }
    function rQuote() {
      const c = cur();
      return [subnav(VIEW_META.rQuote.title, backTo('rOrder')),
        h('p', { class: 'intro' }, '尚未收件，此為遠端估價。收件檢測後如需追加費用，須先提報原廠核准，不先施工。'),
        form([field('遠端評估', area('remote', '', { 'data-act': 'f-remote', maxlength: '300' })),
          field('工資（NT$）', money_('labor')), field('零件（NT$）', money_('parts')), field('來回運費（NT$）', money_('shipping')),
          field('預估天數', input('days', '', { inputmode: 'numeric', placeholder: '空白＝待確認', 'data-act': 'f-days' }), '空白代表待確認，與 0 不同；有待確認項目時原廠無法核准。')],
        '提交估價', 'r-quote-submit', (val) => (teamAct(S(), c.id, 'quote', { remote: val('remote'), labor: val('labor'), parts: val('parts'), shipping: val('shipping'), days: val('days') })
          ? done('rOrder', '已提交遠端估價') : '請填寫遠端評估，金額須為 0 以上的數字或留空。'))];
    }
    function rReport() {
      const c = cur();
      const inspect = c.wo.status === 'received';
      return [subnav(inspect ? '收件後檢測' : '完修回報', backTo('rOrder')),
        form([field(inspect ? '檢測結果' : '處置說明', area('note', '', { 'data-act': 'f-note', maxlength: '300' })), inspect ? null : check('photo', '附上完修照片（以插圖代替）', false)],
          inspect ? '送出檢測回報' : '送出完修回報', 'r-report-submit',
          (val) => (teamAct(S(), c.id, inspect ? 'inspect' : 'complete', { note: val('note'), photo: val('photo') }) ? done('rOrder', '已回報') : '請填寫內容。'))];
    }
    function rSupp() {
      const c = cur();
      return [subnav(VIEW_META.rSupp.title, backTo('rOrder')), h('p', { class: 'intro' }, '保固內追加費用由商家負擔，須原廠核准後才施工。'),
        form([field('追加金額（NT$）', money_('amount')), field('原因', area('note', '', { 'data-act': 'f-note', maxlength: '300' }))],
          '提報', 'r-supp-submit', (val) => (teamAct(S(), c.id, 'supplement', { amount: val('amount'), note: val('note') }) ? done('rOrder', '已提報追加費用') : '請填寫大於 0 的金額與原因。'))];
    }
    function rRef() {
      const cats = myCert().cats;
      const prods = S().m.products.filter((p) => cats.includes(p.cat));
      const K = { pending: '待原廠確認', accepted: '原廠已確認', returned: '原廠已退回' };
      return [subnav(VIEW_META.rRef.title, backTo('rHome')),
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '授權品類的手冊與 FAQ'),
          h('ul', { class: 'events' }, S().m.manuals.filter((x) => prods.some((p) => p.id === x.product)).map((x) =>
            h('li', {}, h('span', { class: 'caption' }, productName(x.product) + '・' + x.kind + '・' + x.license), h('p', {}, x.title))))),
        prods.length ? form([h('h2', { class: 'list-header list-header-flat' }, '回報故障知識'), field('商品', select('product', prods.map((p) => [p.id, p.name + '（' + p.model + '）']), prods[0].id)),
          field('內容', area('body', '', { 'data-act': 'f-knowledge', maxlength: '300' }), '需原廠確認後才會納入排查資料，不會直接更新 AI。')],
        '送出回報', 'r-knowledge-submit', (val, f) => {
          if (!reportKnowledge(S(), val('product'), val('body'))) return '請填寫內容。';
          ui.render(false); snack('已送出，待原廠確認'); return null;
        }) : null,
        h('section', { class: 'block' }, h('h2', { class: 'list-header' }, '我的回報'),
          S().m.knowledge.length ? h('ul', { class: 'events' }, S().m.knowledge.map((k) => h('li', {}, h('span', { class: 'caption' }, K[k.status]), h('p', {}, k.text))))
            : h('p', { class: 'block-body caption' }, '尚無回報。'))];
    }
    function rAccount() {
      const x = myCert();
      const orders = S().cases.filter(sees).filter((c) => approvedTotal(c.wo) > 0);
      return [subnav(VIEW_META.rAccount.title, backTo('rHome')),
        h('section', { class: 'block' }, h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '認證範圍'), h('span', { class: 'tag ' + (certState(x) === '有效' ? 'tag-ok' : 'tag-pending') }, certState(x))),
          h('dl', { class: 'kvs' }, kv('品類', x.cats.join('、') || '—'), kv('型號', x.models || '—'), kv('地區', x.region || '—'), kv('期限', x.until), kv('範圍', x.scope || '—')),
          h('p', { class: 'block-body caption' }, '認證範圍由原廠設定；僅能承接範圍內的品類與型號。')),
        h('section', { class: 'block' }, h('div', { class: 'list-header-row' }, h('h2', { class: 'list-header' }, '已核准金額'), ui.sampleTag()),
          orders.length ? h('dl', { class: 'kvs' }, orders.map((c) => kv(c.id, money(approvedTotal(c.wo)) + '・' + (c.wo.status === 'returned' ? '待結算' : '進行中'))))
            : h('p', { class: 'block-body caption' }, '目前沒有已核准金額。'),
          h('p', { class: 'block-body caption' }, '結算明細為唯讀；詳細帳務尚未提供。'))];
    }

    return { bHome, bCases, bCase, bDecide, bDispatch, bFactory, bMessage, bCatalog, bProduct, bManual, bCerts, bCert, bBilling,
      rHome, rOrder, rDecline, rQuote, rReport, rSupp, rRef, rAccount };
  }

  const api = { BRAND, TEAM, CATS, LICENSE, MANUAL_KINDS, VIEW_META, bind, seed, caseExtras, amount, certOk, teamsFor, decideWarranty, dispatch,
    canDispatch, approveQuote, returnQuote, factoryQuote, decideSupplement, advanceFactory, message, saveProduct, saveManual, saveCert, reviewKnowledge,
    teamAct, reportKnowledge, woLabel, approvedTotal, brandTodo, teamTodo, resolve, visible, teamSees, myTeam, views };

  if (typeof module !== 'undefined') module.exports = api;
  else window.ShareRepairMerchant = api;
})();
