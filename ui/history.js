/**
 * Event History Page Controller
 */

import { formatDhakaDateTime } from '../lib/timestamps.js';
import { ObservationState } from '../lib/constants.js';

// DOM Elements
const accountSubtitle = document.getElementById('account-subtitle');
const statTotal = document.getElementById('stat-total');
const statVisible = document.getElementById('stat-visible');
const statUnavailable = document.getElementById('stat-unavailable');
const statUnknown = document.getElementById('stat-unknown');
const statTransitions = document.getElementById('stat-transitions');

const filterState = document.getElementById('filter-state');
const filterTransitionsOnly = document.getElementById('filter-transitions-only');
const searchInput = document.getElementById('search-input');
const btnRefresh = document.getElementById('btn-refresh');
const btnExportCsv = document.getElementById('btn-export-csv');
const historyTbody = document.getElementById('history-tbody');
const footerCount = document.getElementById('footer-count');

let allEvents = [];

/**
 * Loads history from background service worker
 */
async function loadHistory() {
  try {
    const statusResp = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (statusResp?.config?.targetUsername) {
      accountSubtitle.textContent = `Account: @${statusResp.config.targetUsername}`;
    }

    const historyResp = await chrome.runtime.sendMessage({ action: 'GET_HISTORY' });
    if (historyResp?.success && Array.isArray(historyResp.history)) {
      allEvents = historyResp.history;
      updateStats();
      renderTable();
    } else {
      showEmpty('No observation events recorded yet.');
    }
  } catch (err) {
    showEmpty(`Failed to load history: ${err.message}`);
  }
}

/**
 * Computes and updates metrics cards
 */
function updateStats() {
  const total = allEvents.length;
  let visible = 0;
  let unavailable = 0;
  let unknown = 0;
  let transitions = 0;

  for (const e of allEvents) {
    if (e.observedState === ObservationState.VISIBLE) visible++;
    else if (e.observedState === ObservationState.UNAVAILABLE) unavailable++;
    else unknown++;

    if (e.isTransition) transitions++;
  }

  statTotal.textContent = total;
  statVisible.textContent = visible;
  statUnavailable.textContent = unavailable;
  statUnknown.textContent = unknown;
  statTransitions.textContent = transitions;
}

/**
 * Filters and renders history table
 */
function renderTable() {
  const selectedState = filterState.value;
  const transitionsOnly = filterTransitionsOnly.checked;
  const searchQuery = searchInput.value.trim().toLowerCase();

  const filtered = allEvents.filter((e) => {
    if (selectedState !== 'ALL' && e.observedState !== selectedState) return false;
    if (transitionsOnly && !e.isTransition) return false;
    if (searchQuery) {
      const matchReason = (e.reason || '').toLowerCase().includes(searchQuery);
      const matchState = (e.observedState || '').toLowerCase().includes(searchQuery);
      const matchId = (e.id || '').toLowerCase().includes(searchQuery);
      if (!matchReason && !matchState && !matchId) return false;
    }
    return true;
  });

  // Display newest first
  const displayList = [...filtered].reverse();

  historyTbody.innerHTML = '';

  if (displayList.length === 0) {
    showEmpty('No events match the selected filters.');
    footerCount.textContent = 'Showing 0 events';
    return;
  }

  footerCount.textContent = `Showing ${displayList.length} of ${allEvents.length} events`;

  for (const item of displayList) {
    const tr = document.createElement('tr');
    if (item.isTransition) {
      tr.classList.add('transition-row');
    }

    // 1. Time (Asia/Dhaka)
    const tdTime = document.createElement('td');
    tdTime.textContent = formatDhakaDateTime(item.timestampUtc, { includeSeconds: true });
    tr.appendChild(tdTime);

    // 2. Observation
    const tdObs = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = item.observedState;
    if (item.observedState === ObservationState.VISIBLE) badge.classList.add('badge-visible');
    else if (item.observedState === ObservationState.UNAVAILABLE) badge.classList.add('badge-unavailable');
    else badge.classList.add('badge-unknown');
    tdObs.appendChild(badge);
    tr.appendChild(tdObs);

    // 3. Previous State
    const tdPrev = document.createElement('td');
    tdPrev.textContent = item.previousReliableState || '—';
    tr.appendChild(tdPrev);

    // 4. Result (Baseline / Changed / Unchanged)
    const tdResult = document.createElement('td');
    const resultSpan = document.createElement('span');
    resultSpan.className = 'result-badge';
    if (item.isTransition) {
      resultSpan.classList.add('result-changed');
      resultSpan.textContent = 'Changed';
    } else if (!item.previousReliableState && item.observedState !== ObservationState.UNKNOWN) {
      resultSpan.classList.add('result-baseline');
      resultSpan.textContent = 'Baseline';
    } else {
      resultSpan.classList.add('result-unchanged');
      resultSpan.textContent = 'Unchanged';
    }
    tdResult.appendChild(resultSpan);
    tr.appendChild(tdResult);

    // 5. Confidence
    const tdConf = document.createElement('td');
    tdConf.textContent = item.confidence || 'HIGH';
    tr.appendChild(tdConf);

    // 6. Duration
    const tdDuration = document.createElement('td');
    tdDuration.textContent = item.checkDurationMs ? `${item.checkDurationMs} ms` : '—';
    tr.appendChild(tdDuration);

    // 7. Reason
    const tdReason = document.createElement('td');
    tdReason.textContent = item.reason || '—';
    tr.appendChild(tdReason);

    historyTbody.appendChild(tr);
  }
}

function showEmpty(message) {
  historyTbody.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 7;
  td.className = 'empty-state';
  td.textContent = message;
  tr.appendChild(td);
  historyTbody.appendChild(tr);
}

// Event Listeners
filterState.addEventListener('change', renderTable);
filterTransitionsOnly.addEventListener('change', renderTable);
searchInput.addEventListener('input', renderTable);
btnRefresh.addEventListener('click', loadHistory);

// Export CSV
btnExportCsv.addEventListener('click', async () => {
  btnExportCsv.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'EXPORT_CSV' });
    if (res?.success && res.csv) {
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `instagram_visibility_history_${new Date().toISOString().slice(0, 10)}.csv`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    alert(`CSV export failed: ${err.message}`);
  } finally {
    btnExportCsv.disabled = false;
  }
});

loadHistory();
