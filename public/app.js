'use strict';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => (reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

let config;
let current;
let busy = false;
let picked = 'delivered';
let previousView = 'view-ask';

// Plain-language names for the demo situations (ids come from the server).
const SITUATIONS = {
  delivered: 'Delivered — but the customer says it wasn’t',
  lost: 'Lost in transit',
  damaged: 'Arrived damaged',
  processing: 'Still on its way',
};

const SOURCES = { MERCHANT_OMS: 'Your order system', CARRIER: 'Carrier', PAYPAL: 'PayPal' };

/* ---------- helpers ---------- */

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined && text !== null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

const money = (n) => `$${Number(n).toFixed(2)}`;
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const announce = (msg) => {
  $('live').textContent = msg;
};
const shipmentOf = (r) => r.evidence.find((e) => e.recordType === 'shipment');

async function api(path, body, review = false) {
  const tokenInput = $(review ? 'reviewer-token' : 'operator-token');
  const token = tokenInput ? tokenInput.value : '';
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Surety-CSRF': config?.csrf || '',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    /* non-JSON error body */
  }
  if (!response.ok) {
    const err = new Error(result.error || 'Something went wrong. Please try again.');
    err.status = response.status;
    throw err;
  }
  return result;
}

function friendly(e) {
  if (e.status === 401) {
    const access = $('access');
    if (!access.hidden) access.open = true;
    return 'Your access token wasn’t accepted. Check both tokens under “Sign in to your PayPal sandbox”.';
  }
  if (e.status === 403) return 'This session expired. Reload the page and try again.';
  return e.message;
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function setBusy(on) {
  busy = on;
  for (const id of ['check', 'primary-action', 'connect']) {
    const b = $(id);
    b.disabled = on;
    b.setAttribute('aria-busy', String(on));
  }
}

function showView(id, focus = true) {
  document.querySelectorAll('[data-view]').forEach((v) => (v.hidden = v.id !== id));
  if (id === 'view-ask' || id === 'view-result') previousView = id;
  if (focus) {
    window.scrollTo(0, 0);
    document.querySelector(`#${id} h1, #${id} h2`)?.focus({ preventScroll: true });
  }
}

/* ---------- step 1: the claim ---------- */

function situations() {
  const list = $('situation-list');
  list.replaceChildren();
  for (const s of config.scenarios) {
    const label = node('label', undefined, 'situation');
    const input = node('input');
    input.type = 'radio';
    input.name = 'situation';
    input.value = s.id;
    input.checked = s.id === picked;
    input.addEventListener('change', () => pick(s.id));
    label.append(input, node('span', SITUATIONS[s.id] || s.title));
    list.append(label);
  }
}

function pick(id) {
  const scenario = config.scenarios.find((s) => s.id === id);
  if (!scenario) return;
  picked = id;
  $('statement').value = scenario.statement;
  $('statement-quote').textContent = scenario.statement;
  $('amount').value = '49.00';
  $('amount-text').textContent = money(49);
  $('order-text').textContent = `SIM-ORD-${id}`;
  $('transaction').value = `SIM-ORD-${id}`;
}

function fillOrders(records) {
  const select = $('transaction');
  select.replaceChildren();
  for (const r of records) {
    const o = node('option', r.orderId);
    o.value = r.orderId;
    select.append(o);
  }
}

function payload() {
  const simulated = config.mode === 'SIMULATION';
  return {
    orderId: $('transaction').value,
    statement: $('statement').value,
    amount: Number($('amount').value),
    ...(simulated ? { scenario: picked } : {}),
    useAI: !simulated,
  };
}

/* ---------- step 2: the check ---------- */

async function runCheck(event) {
  event.preventDefault();
  if (busy) return;
  if (!$('transaction').value) {
    showError('ask-error', 'Load your orders first, then choose one to check.');
    return;
  }
  showError('ask-error', '');
  setBusy(true);
  const items = [...document.querySelectorAll('#steps li')];
  items.forEach((li) => (li.className = ''));
  const mark = (i, state) => items[i] && (items[i].className = state);

  showView('view-checking');
  announce('Checking the claim against your records.');
  const call = api('/api/cases', payload()).then(
    (record) => ({ record }),
    (error) => ({ error }),
  );
  try {
    mark(0, 'active');
    await wait(450);
    mark(0, 'done');
    mark(1, 'active');
    await wait(450);
    const out = await call;
    if (out.error) throw out.error;
    mark(1, 'done');
    mark(2, 'active');
    await wait(450);
    mark(2, 'done');
    await wait(250);
    render(out.record);
    refreshHistory();
  } catch (e) {
    showView('view-ask');
    showError('ask-error', friendly(e));
  } finally {
    setBusy(false);
  }
}

/* ---------- step 3: the decision ---------- */

function describe(r) {
  const amt = money(r.action.amount);
  const state = shipmentOf(r)?.state;
  if (r.executionState === 'SUCCEEDED') {
    return {
      tone: 'go',
      status: 'Refunded',
      title: `${amt} refunded.`,
      sub:
        r.mode === 'SIMULATION'
          ? 'This was a simulation, so no real money moved.'
          : 'PayPal’s sandbox confirmed the refund. It used test money.',
    };
  }
  if (['PENDING', 'EXECUTING'].includes(r.executionState)) {
    return {
      tone: 'hold',
      status: 'Waiting on PayPal',
      title: 'The refund was sent, but PayPal hasn’t confirmed it yet.',
      sub: 'Don’t send it again. Check its status instead.',
    };
  }
  if (r.decision === 'DENY') {
    return {
      tone: 'stop',
      status: 'Blocked',
      title:
        state === 'DELIVERED'
          ? 'Your records say this package was delivered.'
          : 'Your records don’t support this refund.',
      sub: `Nothing was paid. ${amt} stays with you.`,
    };
  }
  if (r.decision === 'REVIEW') {
    if (r.approvalId) {
      return {
        tone: 'go',
        status: 'Approved by a reviewer',
        title: 'A person approved this exact refund.',
        sub: 'It hasn’t been sent yet.',
      };
    }
    return {
      tone: 'hold',
      status: 'Needs a person',
      title:
        r.claim.claimType === 'DAMAGED_ITEM'
          ? 'Delivery records can’t show whether it’s damaged.'
          : state === 'PROCESSING'
            ? 'It’s still in transit — not lost, not delivered.'
            : 'The records can’t settle this on their own.',
      sub: 'A person has to decide. Nothing is paid until they approve this exact refund.',
    };
  }
  return {
    tone: 'go',
    status: 'Safe to refund',
    title: 'Your records confirm it was lost.',
    sub: `Refunding ${amt} matches the claim. Nothing is paid until you send it.`,
  };
}

function row(term, ...content) {
  const wrap = node('div', undefined, 'row');
  const dd = node('dd');
  dd.append(...content);
  wrap.append(node('dt', term), dd);
  return wrap;
}

function render(r) {
  current = r;
  const d = describe(r);
  const done = r.executionState === 'SUCCEEDED';
  const pending = ['PENDING', 'EXECUTING'].includes(r.executionState);
  const amt = money(r.action.amount);

  const status = $('result-status');
  status.textContent = d.status;
  status.className = `status ${d.tone}`;
  $('result-title').textContent = d.title;
  $('result-sub').textContent = d.sub;

  // Ledger: what was said, what the records say, what happens to the money.
  const ledger = $('ledger');
  ledger.replaceChildren();
  ledger.append(row('Customer said', node('span', `“${r.claim.rawStatement}”`, 'what')));

  const ship = shipmentOf(r);
  const verdict = r.verification.verdict;
  const tone = verdict === 'VERIFIED' ? 'go' : verdict === 'CONTRADICTED' ? 'stop' : 'hold';
  const verdictText =
    verdict === 'VERIFIED'
      ? 'Supports the claim'
      : verdict === 'CONTRADICTED'
        ? 'Contradicts the claim'
        : 'Can’t settle the claim';
  const recordsLine = !ship
    ? 'No delivery record found'
    : ship.state === 'DELIVERED'
      ? 'Delivered'
      : ship.state === 'LOST'
        ? 'Lost in transit'
        : ship.state === 'PROCESSING'
          ? 'Still in transit, not delivered'
          : ship.state.replaceAll('_', ' ').toLowerCase();
  const recordNodes = [node('span', recordsLine, 'what')];
  if (ship)
    recordNodes.push(
      node(
        'span',
        `${SOURCES[ship.provider] || ship.provider} · ${when(ship.timestamp)}`,
        'detail',
      ),
    );
  recordNodes.push(node('span', verdictText, `verdict ${tone}`));
  ledger.append(row('Your records say', ...recordNodes));

  const refundNodes = [];
  const blocked = r.decision === 'DENY' && !done;
  const amountEl = blocked ? node('s', amt) : node('span', amt);
  const amountWrap = node('span', undefined, 'what');
  amountWrap.append(amountEl);
  refundNodes.push(amountWrap, node('span', `Order ${r.action.orderId}`, 'detail'));
  const fate = done
    ? ['go', 'Paid']
    : blocked
      ? ['stop', 'Not paid — stays with you']
      : pending
        ? ['hold', 'Sent — awaiting confirmation']
        : r.decision === 'REVIEW' && !r.approvalId
          ? ['hold', 'On hold for a person']
          : ['go', 'Ready to send'];
  refundNodes.push(node('span', fate[1], `verdict ${fate[0]}`));
  ledger.append(row('Refund', ...refundNodes));

  const cap = r.policy.maxAutonomousAmount;
  let counter = '';
  if (!done && !pending) {
    if ((r.decision === 'DENY' || r.decision === 'REVIEW') && r.action.amount <= cap)
      counter = `An agent limited only by amount (your cap is ${money(cap)}) would have paid this ${amt} without looking.`;
    else if (r.decision === 'EXECUTE')
      counter = `The ${amt} is within your ${money(cap)} limit, and now your records agree too.`;
  }
  $('counterfactual').textContent = counter;

  showError('result-error', r.error ? `PayPal reported a problem: ${r.error}` : '');

  // One dominant action per state.
  const btn = $('primary-action');
  let handler;
  let note = '';
  if (done || r.decision === 'DENY') {
    btn.textContent = 'Check another situation';
    handler = reset;
  } else if (pending) {
    btn.textContent = 'Check refund status';
    handler = reconcile;
  } else if (r.decision === 'REVIEW' && !r.approvalId) {
    btn.textContent = `Approve this ${amt} refund`;
    handler = approve;
    note = 'You’re approving this exact refund: this order, this amount, nothing else.';
  } else {
    btn.textContent = `Send the ${amt} refund`;
    handler = execute;
    note =
      r.mode === 'SIMULATION'
        ? 'Simulation: no real money moves.'
        : 'This sends a test refund through PayPal’s sandbox.';
  }
  btn.onclick = handler;
  $('action-note').textContent = note;

  trust(r);
  showView('view-result');
  announce(`${d.status}. ${d.title}`);
}

function trust(r) {
  const sim = r.mode === 'SIMULATION';
  const items = [
    [
      'What we looked at',
      `Only the payment (${r.action.captureId}) and the delivery record for order ${r.action.orderId}.`,
    ],
    [
      'What stayed private',
      sim
        ? 'Demo mode: no AI model and no PayPal call was made.'
        : 'The AI that reads messages has no payment tools and no PayPal credentials. Your tokens stay on this server.',
    ],
    [
      'What we kept',
      'A fingerprinted record of this decision, stored on this computer. Download it any time.',
    ],
    [
      'What you control',
      'Nothing is paid until you press send. A reviewer can approve a “needs a person” case, but never one your records contradict.',
    ],
  ];
  const list = $('trust-list');
  list.replaceChildren();
  for (const [term, text] of items) {
    const wrap = node('div');
    wrap.append(node('dt', term), node('dd', text));
    list.append(wrap);
  }

  const facts = [
    ['Case', r.caseId],
    ['Mode', r.mode],
    ['Premise', r.verification.verdict],
    ['Reasons', [...r.verification.reasonCodes, ...r.policy.reasonCodes].join(', ') || 'none'],
    ['Open questions', r.verification.unresolvedFacts.join('; ') || 'none'],
    ['Autonomous cap', money(r.policy.maxAutonomousAmount)],
    ['Evidence digest', r.evidenceDigest || 'n/a'],
    ['Policy digest', r.policyDigest || 'n/a'],
  ];
  for (const e of r.evidence)
    facts.push([`${e.provider} ${e.recordType}`, `${e.state} · ${e.providerId}`]);
  if (r.refundId) facts.push(['Refund id', r.refundId]);
  if (r.requestId) facts.push(['Request id', r.requestId]);
  if (r.approvalId) facts.push(['Approval id', r.approvalId]);
  const dl = node('dl');
  for (const [k, v] of facts) dl.append(node('dt', k), node('dd', String(v)));
  $('technical').replaceChildren(dl);
}

/* ---------- actions ---------- */

async function act(fn, message) {
  if (busy) return;
  setBusy(true);
  showError('result-error', '');
  try {
    render(await fn());
    refreshHistory();
    if (message) announce(message);
  } catch (e) {
    showError('result-error', friendly(e));
  } finally {
    setBusy(false);
  }
}

const approve = () =>
  act(() => api(`/api/cases/${current.caseId}/approve`, {}, true), 'Refund approved.');
const execute = () =>
  act(
    () => api(`/api/cases/${current.caseId}/execute`, { action: current.action }),
    'Refund sent.',
  );
const reconcile = () =>
  act(() => api(`/api/cases/${current.caseId}/reconcile`, {}), 'Status updated.');

function reset() {
  showError('ask-error', '');
  showView('view-ask');
}

async function download() {
  if (busy || !current) return;
  try {
    const record = await api(`/api/cases/${current.caseId}/export`);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    );
    const a = node('a');
    a.href = url;
    a.download = `surety-proof-${record.caseId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Proof file downloaded.');
  } catch (e) {
    showError('result-error', friendly(e));
  }
}

/* ---------- past decisions ---------- */

function label(c) {
  if (c.executionState === 'SUCCEEDED') return ['go', 'Refunded'];
  if (['PENDING', 'EXECUTING'].includes(c.executionState)) return ['hold', 'Awaiting PayPal'];
  if (c.decision === 'DENY') return ['stop', 'Blocked'];
  if (c.decision === 'REVIEW')
    return c.approvalId ? ['go', 'Approved'] : ['hold', 'Needs a person'];
  return ['go', 'Safe to refund'];
}

async function refreshHistory(into = $('history')) {
  const list = await api('/api/cases');
  into.replaceChildren();
  if (!list.length) {
    into.append(node('p', 'Nothing yet. Claims you check will appear here.', 'empty'));
    return;
  }
  for (const c of list) {
    const [tone, text] = label(c);
    const item = node('button', undefined, 'history-row');
    item.type = 'button';
    const out = node('span', text, `out verdict ${tone}`);
    item.append(
      node('span', `${money(c.action.amount)} · ${c.action.orderId}`),
      out,
      node('span', c.claim.rawStatement, 'sub'),
    );
    item.addEventListener('click', () => render(c));
    into.append(item);
  }
}

async function openActivity() {
  showView('view-activity');
  try {
    await refreshHistory();
  } catch (e) {
    $('history').replaceChildren(node('p', friendly(e), 'error'));
  }
}

/* ---------- wiring ---------- */

$('case-form').addEventListener('submit', runCheck);
$('export').addEventListener('click', download);
$('open-activity').addEventListener('click', openActivity);
$('close-activity').addEventListener('click', () =>
  showView(current && previousView === 'view-result' ? 'view-result' : 'view-ask'),
);
$('connect').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  showError('ask-error', '');
  try {
    const records = await api('/api/transactions');
    fillOrders(records);
    announce(`${records.length} orders loaded.`);
    if (!records.length) showError('ask-error', 'No orders are available to check.');
  } catch (e) {
    showError('ask-error', friendly(e));
  } finally {
    setBusy(false);
  }
});

(async function init() {
  try {
    config = await api('/api/config');
  } catch (e) {
    $('loading').textContent =
      'Surety couldn’t start. Reload the page, or check that the server is running.';
    return;
  }
  const simulated = config.mode === 'SIMULATION';
  $('mode').textContent = simulated ? 'Demo · no real money' : 'PayPal sandbox · test money';
  $('loading').hidden = true;
  $('case-form').hidden = false;
  fillOrders(config.transactions);

  if (simulated) {
    $('situations').hidden = false;
    situations();
    pick(picked);
  } else {
    document.querySelector('.request').hidden = true;
    $('live-fields').hidden = false;
    $('statement').required = true;
    $('access').hidden = false;
    $('access').open = true;
    $('check-note').textContent =
      'Nothing is paid at this step. Sign in first to load your orders.';
  }
})();
