'use strict';

const POLL_INTERVAL_MS = 700;
const FINISHED = new Set(['done', 'failed', 'cancelled']);
const STATUS_LABELS = {
  queued: 'в очереди',
  running: 'выполняется',
  done: 'готово',
  failed: 'ошибка',
  cancelled: 'отменён',
};

const $ = (id) => document.getElementById(id);
const els = {
  form: $('run-form'),
  url: $('url'),
  requests: $('requests'),
  timeout: $('timeout'),
  retries: $('retries'),
  warmup: $('warmup'),
  token: $('token'),
  start: $('start'),
  formError: $('form-error'),
  current: $('current'),
  currentUrl: $('current-url'),
  currentStatus: $('current-status'),
  currentError: $('current-error'),
  cancel: $('cancel'),
  progressBar: $('progress-bar'),
  progressText: $('progress-text'),
  stats: $('stats'),
  chart: $('chart'),
  results: $('results'),
  history: $('history'),
  historyEmpty: $('history-empty'),
};

let currentId = null;
let pollTimer = null;

// --- работа с API ------------------------------------------------------------

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  const token = els.token.value.trim() || sessionStorage.getItem('speed-0-meter-token');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Ошибка сервера (HTTP ${response.status})`);
  }
  return data;
}

// --- вспомогательные функции отрисовки --------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmtSeconds = (v) => v.toFixed(3);
const fmtMB = (bytes) => (bytes / 1e6).toFixed(2);

function showFormError(message) {
  els.formError.textContent = message || '';
  els.formError.hidden = !message;
}

function statCard(label, value, main = false) {
  const card = el('div', main ? 'stat stat-main' : 'stat');
  card.append(el('div', 'stat-label', label), el('div', 'stat-value', value));
  return card;
}

function renderStats(summary) {
  els.stats.replaceChildren();
  if (!summary || summary.ok === 0) return;
  els.stats.append(
    statCard('Скорость', `${summary.speedMbitPerSec.toFixed(2)} Мбит/с`, true),
    statCard('Скорость, МБ/с', `${summary.speedMBytePerSec.toFixed(2)} МБ/с`),
    statCard('Без учёта TTFB', `${summary.downloadSpeedMbitPerSec.toFixed(2)} Мбит/с`),
    statCard('Среднее время', `${fmtSeconds(summary.avgSeconds)} с`),
    statCard('Медиана', `${fmtSeconds(summary.medianSeconds)} с`),
    statCard('p95', `${fmtSeconds(summary.p95Seconds)} с`),
    statCard('Средний TTFB', `${fmtSeconds(summary.avgTtfbSeconds)} с`),
    statCard('Скачано', `${fmtMB(summary.totalBytes)} МБ`),
  );
}

function renderChart(results) {
  els.chart.replaceChildren();
  const times = results.filter((r) => r.ok).map((r) => r.seconds);
  const max = Math.max(...times, 0.001);
  for (const result of results) {
    const bar = el('div', result.ok ? 'chart-bar' : 'chart-bar chart-bar-failed');
    bar.style.height = result.ok ? `${Math.max(4, (result.seconds / max) * 100)}%` : '100%';
    bar.title = result.ok ? `${fmtSeconds(result.seconds)} с` : result.error;
    els.chart.append(bar);
  }
}

function renderResults(results) {
  els.results.replaceChildren();
  results.forEach((result, index) => {
    const row = el('tr');
    row.append(el('td', '', String(index + 1)));
    if (result.ok) {
      row.append(
        el('td', 'cell-ok', 'успешно'),
        el('td', '', fmtSeconds(result.seconds)),
        el('td', '', fmtSeconds(result.ttfbSeconds)),
        el('td', '', fmtMB(result.bytes)),
        el('td', '', String(result.attempts)),
      );
    } else {
      const cell = el('td', 'cell-bad', result.error);
      cell.colSpan = 4;
      row.append(cell, el('td', '', String(result.attempts)));
    }
    els.results.append(row);
  });
}

function renderRun(run) {
  els.current.hidden = false;
  els.currentUrl.textContent = run.url;
  els.currentStatus.textContent = STATUS_LABELS[run.status] || run.status;
  els.currentStatus.className = `badge badge-${run.status}`;
  els.cancel.hidden = FINISHED.has(run.status);

  const { completed, total } = run.progress;
  els.progressBar.style.width = `${total ? (completed / total) * 100 : 0}%`;
  els.progressText.textContent = `Выполнено запросов: ${completed} из ${total}`;

  els.currentError.hidden = !run.error;
  els.currentError.textContent = run.error || '';

  renderStats(run.summary);
  renderChart(run.results || []);
  renderResults(run.results || []);
}

function renderHistory(runs) {
  els.history.replaceChildren();
  els.historyEmpty.hidden = runs.length > 0;
  for (const run of runs) {
    const item = el('li');
    const button = el('button', 'history-item');
    button.type = 'button';
    const speed =
      run.summary && run.summary.ok > 0 ? `${run.summary.speedMbitPerSec.toFixed(1)} Мбит/с` : '—';
    button.append(
      el('span', 'history-url', run.url),
      el('span', 'history-meta', `${STATUS_LABELS[run.status] || run.status} · ${speed}`),
    );
    button.addEventListener('click', () => select(run.id));
    item.append(button);
    els.history.append(item);
  }
}

// --- сценарии ---------------------------------------------------------------

async function refreshHistory() {
  try {
    renderHistory((await api('/api/runs')).runs);
  } catch (err) {
    showFormError(err.message);
  }
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (!currentId) return;
  try {
    const run = await api(`/api/runs/${currentId}`);
    renderRun(run);
    if (FINISHED.has(run.status)) {
      stopPolling();
      els.start.disabled = false;
      refreshHistory();
      return;
    }
  } catch (err) {
    showFormError(err.message);
    stopPolling();
    els.start.disabled = false;
    return;
  }
  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

function select(id) {
  stopPolling();
  currentId = id;
  poll();
}

async function onSubmit(event) {
  event.preventDefault();
  showFormError('');

  if (els.token.value.trim()) sessionStorage.setItem('speed-0-meter-token', els.token.value.trim());

  els.start.disabled = true;
  try {
    const run = await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        url: els.url.value.trim(),
        requests: Number(els.requests.value),
        timeout: Number(els.timeout.value),
        retries: Number(els.retries.value),
        warmup: els.warmup.checked,
      }),
    });
    select(run.id);
    refreshHistory();
  } catch (err) {
    showFormError(err.message);
    els.start.disabled = false;
  }
}

async function onCancel() {
  if (!currentId) return;
  try {
    await api(`/api/runs/${currentId}`, { method: 'DELETE' });
  } catch (err) {
    showFormError(err.message);
  }
}

els.form.addEventListener('submit', onSubmit);
els.cancel.addEventListener('click', onCancel);
refreshHistory();
