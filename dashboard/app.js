// Token Launch Radar dashboard: renders window.RADAR (written by
// main.ts beside this page) as a sortable, filterable board with a
// detail view per protocol. No network, no framework.

(function () {
  'use strict';
  var D = window.RADAR;
  var boardEl = document.getElementById('board');
  var detailEl = document.getElementById('detail');
  var countEl = document.getElementById('count');
  if (!D) {
    boardEl.innerHTML = '<p>No data: run the radar program first.</p>';
    return;
  }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ageText(days) {
    if (days === null) return 'untracked';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }

  document.getElementById('summary').textContent =
    'Snapshot of ' + D.counts.protocols + ' protocols (DefiLlama, as of ' + D.as_of + '). ' +
    'The board ranks ' + D.counts.board + ' that record no token: all ' + D.counts.watchlist +
    ' on the $' + (D.floor_usd / 1e6) + 'M watchlist plus ' + D.counts.early +
    ' early finds the watchlist leaves out. Each value is calibrated on the protocols in the same snapshot whose token already trades.';

  // --- controls -----------------------------------------------------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var scopeEl = document.getElementById('scope');
  var sortEl = document.getElementById('sort');

  var categories = {};
  var chains = {};
  D.rows.forEach(function (r) {
    if (r.category) categories[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(categories).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  function visibleRows() {
    var q = qEl.value.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (catEl.value && r.category !== catEl.value) return false;
      if (chainEl.value && r.chains.indexOf(chainEl.value) === -1) return false;
      if (scopeEl.value === 'watchlist' && !r.on_watchlist) return false;
      if (scopeEl.value === 'early' && r.on_watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    };
    return rows.sort(by[sortEl.value] || by.rank);
  }

  function renderBoard() {
    var rows = visibleRows();
    countEl.textContent = 'Showing ' + rows.length + ' of ' + D.rows.length + ' ranked protocols. Select a row for its detail and farm plan.';
    var html = '<table><thead><tr>' +
      '<th>#</th><th>Protocol</th><th>Status</th><th class="num">Implied value</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="hide-sm">Category</th>' +
      '<th class="hide-sm">Chains</th><th class="num hide-sm">No token for</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="badge ' + (r.on_watchlist ? 'watch' : 'early') + '">' + (r.on_watchlist ? 'Watchlist' : 'Early radar') + '</span></td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="hide-sm">' + esc(r.category || '—') + '</td>' +
        '<td class="chains hide-sm">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num hide-sm">' + ageText(r.age_days) + '</td></tr>';
    });
    boardEl.innerHTML = html + '</tbody></table>';
    var trs = boardEl.querySelectorAll('tbody tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { showDetail(this.getAttribute('data-slug')); });
    }
  }

  // --- detail -------------------------------------------------------
  function showDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var m = r.model;
    var base = Math.round(r.tvl_usd * m.base_multiple);
    detailEl.innerHTML =
      '<button class="back" id="backBtn">← Back to the board</button>' +
      '<h2>' + esc(r.name) + ' <span class="badge ' + (r.on_watchlist ? 'watch' : 'early') + '">' + (r.on_watchlist ? 'Watchlist' : 'Early radar') + '</span></h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + D.rows.length + ' · ' + esc(r.category || 'Uncategorised') + ' · records no token in the snapshot</p>' +
      '<div class="facts">' +
      '<div class="fact"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="n">the radar\'s claim</div></div>' +
      '<div class="fact"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div><div class="n">snapshot record</div></div>' +
      '<div class="fact"><div class="k">7d TVL change</div><div class="v">' + pct(r.change_7d) + '</div><div class="n">momentum input</div></div>' +
      '<div class="fact"><div class="k">No token for</div><div class="v">' + ageText(r.age_days) + '</div><div class="n">tracked since ' + esc(r.listed_at || 'unknown') + '</div></div>' +
      '<div class="fact"><div class="k">Chains</div><div class="v">' + r.chains.length + '</div><div class="n">' + esc(r.chains.join(', ') || 'none named') + '</div></div>' +
      '</div>' +
      '<h3>How this value is derived</h3>' +
      '<p class="formula">TVL ' + money(r.tvl_usd) + ' × category multiple ' + m.base_multiple.toFixed(2) +
      ' (median of ' + (m.comps > 0 ? m.comps + ' live-token ' + esc(r.category || '') + ' protocols' : 'all live-token protocols, no category median') + ') = ' + money(base) +
      '<br>× growth ×' + m.growth_multiplier.toFixed(2) + ' (' + pct(m.growth_pct) + ' in 7d) × maturity ×' + m.maturity_multiplier.toFixed(2) +
      ' × breadth ×' + m.breadth_multiplier.toFixed(2) + ' (' + r.chains.length + ' chains)' +
      '<br>= <strong>' + money(r.implied_value_usd) + '</strong> implied value</p>' +
      '<h3>Farm plan</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    detailEl.hidden = false;
    boardEl.hidden = true;
    countEl.textContent = '';
    document.getElementById('backBtn').addEventListener('click', function () {
      detailEl.hidden = true;
      boardEl.hidden = false;
      renderBoard();
    });
    detailEl.scrollIntoView();
  }

  // --- method -------------------------------------------------------
  var calibRows = D.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.comps + '</td><td class="num">' + c.multiple.toFixed(2) + '×</td></tr>';
  }).join('');
  document.getElementById('method').innerHTML =
    '<h2>How the radar prices a launch that has not happened</h2>' +
    '<p>Start from the market, not from a guess. In this same snapshot, ' + 'the protocols whose token already trades show what a dollar of TVL is worth in each category: the radar takes the median market-cap/TVL ratio per category (global median ' + D.global_multiple.toFixed(2) + '×) and applies it to each pre-token protocol\'s TVL. It then adjusts for momentum (the 7-day TVL change, weighted ×' + D.weights.growth_weight + ', clamped between ' + D.weights.growth_floor_pct + '% and +' + D.weights.growth_cap_pct + '%), for maturity (a protocol that has run longer with no token earns up to ×' + (D.weights.maturity_base + D.weights.maturity_span).toFixed(2) + '), and for breadth (each extra chain adds ' + (D.weights.breadth_per_chain * 100) + '%). Protocols whose token already trades are never ranked: they are listed below at the market\'s own value. Model version ' + esc(D.model_version) + '.</p>' +
    '<table><thead><tr><th>Category</th><th class="num">Live comps</th><th class="num">Median value per $1 TVL</th></tr></thead><tbody>' + calibRows + '</tbody></table>';

  // --- live tokens ----------------------------------------------------
  document.getElementById('live').innerHTML =
    '<h2>Already trading — shown, never ranked</h2>' +
    '<p>These protocols\' tokens exist, so the radar does not price them; it shows the market\'s own capitalisation and uses them only as the calibration set above.</p>' +
    '<table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>' +
    D.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span> <span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : '') + '">' + pct(r.change_7d) + '</td></tr>';
    }).join('') + '</tbody></table>';

  [qEl, catEl, chainEl, scopeEl, sortEl].forEach(function (el) {
    el.addEventListener('input', renderBoard);
    el.addEventListener('change', renderBoard);
  });
  renderBoard();
})();
