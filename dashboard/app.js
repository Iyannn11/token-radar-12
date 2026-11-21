// Token Radar dashboard (model radar-quiet).
//
// Renders window.RADAR (written by main.ts into data.js beside this page).
// No network: no fetch, no external resource. Search, category and chain
// filters, sorting, a pre-token / live-token tab, and a detail view for
// every protocol with its model breakdown and farm plan.
//
// Deep links: #p=<slug> opens a protocol's detail view,
// #category=<name> opens the board filtered to that category.

(function () {
  'use strict';

  var R = window.RADAR;
  var rowsEl = document.getElementById('rows');
  var liveRowsEl = document.getElementById('liverows');
  var countEl = document.getElementById('count');
  var dialog = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');

  if (!R || !Array.isArray(R.rows)) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      '<p class="empty">No radar data found. Run main.ts first so it writes data.js beside this page.</p>');
    return;
  }

  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;
  var state = { tab: 'pre', q: '', category: '', chain: '', sort: 'implied' };

  document.getElementById('asof').textContent = 'snapshot ' + R.as_of;
  document.getElementById('asof2').textContent = R.as_of;
  document.getElementById('modelver').textContent = 'model ' + R.model_version;
  document.getElementById('modelver2').textContent = R.model_version;

  function fmtMoney(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function pctClass(v) {
    if (v === null || v === undefined) return '';
    return v >= 0 ? 'pos' : 'neg';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) {
      var y = Math.floor(days / 365);
      var m = Math.floor((days % 365) / 30);
      return y + 'y' + (m ? ' ' + m + 'm' : '');
    }
    if (days >= 30) return Math.floor(days / 30) + 'm';
    return days + 'd';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model, recomputed in the page from the row's own stored figures.
  // It must agree with board.json exactly: the multipliers are rounded
  // before they are used, in main.ts and here alike.
  function recompute(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_multiplier * row.maturity_multiplier));
  }

  // ---- stats -------------------------------------------------------------
  var statsEl = document.getElementById('stats');
  statsEl.innerHTML =
    stat(R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist protocols covered') +
    stat(String(R.board_size), 'protocols ranked') +
    stat(String(R.early_size), 'early rows below the $50M floor') +
    stat(String(R.live_size), 'live-token protocols set aside');
  function stat(b, s) {
    return '<div class="stat"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>';
  }

  // ---- filter options ----------------------------------------------------
  var categories = [];
  var chains = [];
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  var catSel = document.getElementById('category');
  var chainSel = document.getElementById('chain');
  categories.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  chains.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  });

  // ---- calibration table -------------------------------------------------
  var calibRows = document.getElementById('calibrows');
  (R.calibration || []).forEach(function (c) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(c.category) + '</td><td class="num">' + c.multiple.toFixed(4) + '</td><td class="num">' + c.n + '</td><td>' + esc(c.source) + '</td>';
    calibRows.appendChild(tr);
  });
  document.getElementById('calibnote').textContent =
    'Global median mcap / TVL across ' + R.global_n + ' live-token protocols: ' + R.global_multiple.toFixed(4) +
    '. A category with fewer than 3 live comps uses this global figure. Multiples are clamped to 0.02–2.00.';

  // ---- filtering and sorting ---------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = R.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank; },
      age: function (a, b) { return (b.age_days === null ? 365 : b.age_days) - (a.age_days === null ? 365 : a.age_days) || a.rank - b.rank; },
      name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.rank - b.rank; },
    };
    list.sort(by[state.sort] || by.implied);
    return list;
  }

  function renderBoard() {
    var list = filtered();
    var html = '';
    list.forEach(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      html += '<tr data-slug="' + esc(r.slug) + '">'
        + '<td class="num rank">' + r.rank + '</td>'
        + '<td class="name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>'
        + '<td>' + esc(r.category || '—') + '</td>'
        + '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>'
        + '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>'
        + '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>'
        + '<td class="num">' + fmtAge(r.age_days) + '</td>'
        + '<td class="num imp">' + fmtMoney(r.implied_value_usd) + '<span class="imp-bar" style="width:' + w + '%"></span></td>'
        + '</tr>';
    });
    rowsEl.innerHTML = html || '<tr><td colspan="8" class="empty">No protocols match these filters.</td></tr>';
    countEl.textContent = 'Showing ' + list.length + ' of ' + R.board_size + ' pre-token protocols · ' + R.watchlist_size + ' on the watchlist · ' + R.early_size + ' early';
  }

  function renderLive() {
    var html = '';
    R.live.forEach(function (r, i) {
      html += '<tr data-slug="' + esc(r.slug) + '">'
        + '<td class="num rank">' + (i + 1) + '</td>'
        + '<td class="name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>'
        + '<td>' + esc(r.category || '—') + '</td>'
        + '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>'
        + '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>'
        + '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>'
        + '<td class="num imp">' + fmtMoney(r.mcap_usd) + '</td>'
        + '</tr>';
    });
    liveRowsEl.innerHTML = html;
  }

  function render() {
    var pre = state.tab === 'pre';
    document.getElementById('board').hidden = !pre;
    document.getElementById('liveboard').hidden = pre;
    document.getElementById('tab-pre').setAttribute('aria-selected', pre ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', pre ? 'false' : 'true');
    if (pre) {
      renderBoard();
    } else {
      renderLive();
      countEl.textContent = R.live_size + ' live-token protocols, shown at the market\u2019s own value — not ranked, not scored';
    }
  }

  // ---- detail view -------------------------------------------------------
  function openDetail(slug) {
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var live = null;
    if (!row) R.live.forEach(function (r) { if (r.slug === slug) live = r; });
    if (!row && !live) return;
    var r = row || live;
    var html = '<h2>' + esc(r.name) + '</h2>'
      + '<p class="d-sub">' + esc(r.category || 'No category') + ' · ' + esc((r.chains || []).join(', ') || 'no chains listed')
      + ' · snapshot ' + esc(R.as_of) + '</p>';
    if (row) {
      var rec = recompute(row);
      var base = Math.round(row.tvl_usd * row.category_multiple);
      html += '<div class="kv">'
        + '<div><b>' + fmtMoney(row.implied_value_usd) + '</b><span>implied value · rank #' + row.rank + '</span></div>'
        + '<div><b>' + fmtMoney(row.tvl_usd) + '</b><span>TVL</span></div>'
        + '<div><b class="' + pctClass(row.change_7d) + '">' + fmtPct(row.change_7d) + '</b><span>TVL change, 7 days</span></div>'
        + '<div><b>' + fmtAge(row.age_days) + '</b><span>tracked since ' + esc(row.listed_at || 'unknown') + '</span></div>'
        + '</div>'
        + '<div class="model-box"><h3>How the implied value is built</h3><table>'
        + '<tr><td>TVL × ' + (R.multiple_label || 'category multiple') + ' (' + row.category_multiple.toFixed(4) + (row.category_n >= 3 ? ', ' + row.category_n + ' live comps' : ', global fallback') + ')</td><td>' + fmtMoney(base) + '</td></tr>'
        + '<tr><td>× growth multiplier (' + row.growth_multiplier.toFixed(4) + ')</td><td>' + fmtMoney(Math.round(base * row.growth_multiplier)) + '</td></tr>'
        + '<tr><td>× maturity multiplier (' + row.maturity_multiplier.toFixed(4) + ')</td><td>' + fmtMoney(row.implied_value_usd) + '</td></tr>'
        + '</table><p class="agree">' + (rec === row.implied_value_usd
          ? 'The page recomputes this from the stored figures and agrees with board.json exactly.'
          : 'Recomputed in the page: ' + fmtMoney(rec) + '.') + '</p></div>'
        + '<div class="farm"><h3>How to farm it</h3><ol>'
        + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('')
        + '</ol></div>';
    } else {
      html += '<div class="kv">'
        + '<div><b>' + fmtMoney(live.mcap_usd) + '</b><span>market cap — the market\u2019s own value</span></div>'
        + '<div><b>' + fmtMoney(live.tvl_usd) + '</b><span>TVL</span></div>'
        + '<div><b class="' + pctClass(live.change_7d) + '">' + fmtPct(live.change_7d) + '</b><span>TVL change, 7 days</span></div>'
        + '<div><b>' + fmtAge(live.age_days) + '</b><span>tracked since ' + esc(live.listed_at || 'unknown') + '</span></div>'
        + '</div>'
        + '<p class="d-sub">This protocol already has a token that trades, so it is set aside from the ranking and shown at its market cap.</p>';
    }
    detailBody.innerHTML = html;
    if (!dialog.open) dialog.showModal();
    try { history.replaceState(null, '', '#p=' + slug); } catch (e) { /* hash only */ }
  }

  dialog.addEventListener('close', function () {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* hash only */ }
  });

  // ---- events ------------------------------------------------------------
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre'; render(); });
  document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; render(); });
  document.getElementById('board').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('liveboard').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---- deep links --------------------------------------------------------
  function applyHash() {
    var h = location.hash || '';
    var m = h.match(/#p=([^&]+)/);
    if (m) { openDetail(decodeURIComponent(m[1])); return; }
    var c = h.match(/#category=([^&]+)/);
    if (c) {
      var cat = decodeURIComponent(c[1]);
      if (categories.indexOf(cat) >= 0) {
        state.category = cat;
        catSel.value = cat;
        renderBoard();
      }
    }
  }

  // Re-apply deep links when the hash changes (e.g. navigating between views).
  window.addEventListener('hashchange', applyHash);

  render();
  renderLive();
  applyHash();
})();
