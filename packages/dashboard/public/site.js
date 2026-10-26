/* Metrona: one site's page. Tabs, "All N" lists, CSV downloads and sign-out; the page itself is
   rendered on the server (src/site-view.js), so everything here is an enhancement. */
(function () {
  'use strict';

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.mtr-tabs [role="tab"]'));

  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    var name = tab.id.replace('tab-', '');
    if (history.replaceState) history.replaceState(null, '', name === 'summary' ? location.pathname + location.search : '#' + name);
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(tab); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      select(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });
  // A static page is written hourly, so "updated N min ago" is worked out here, at reading time.
  var updated = document.querySelector('[data-updated]');
  if (updated) {
    var t = Date.parse(updated.getAttribute('data-updated'));
    var minutes = Math.round((Date.now() - t) / 60000);
    if (!isNaN(t) && minutes >= 0) {
      updated.textContent = minutes < 2 ? 'Updated just now'
        : minutes < 90 ? 'Updated ' + minutes + ' min ago'
        : minutes < 48 * 60 ? 'Updated ' + Math.round(minutes / 60) + ' h ago'
        : 'Updated ' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  var start = document.getElementById('tab-' + location.hash.slice(1));
  if (start) select(start);

  document.addEventListener('click', function (e) {
    var expand = e.target.closest('[data-expand]');
    if (expand) {
      var box = expand.closest('[data-list]');
      Array.prototype.forEach.call(box.querySelectorAll('.mtr-more-row'), function (row) { row.hidden = false; });
      expand.remove();
      return;
    }
    var csv = e.target.closest('[data-csv]');
    if (csv) download(csv.getAttribute('data-csv'));
    if (e.target.closest('[data-logout]')) {
      fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () { location.href = '/login'; });
    }
  });

  var data;
  try {
    data = JSON.parse(document.getElementById('metrona-data').textContent);
  } catch (err) {
    data = null;
  }

  function cell(value) {
    var s = String(value == null ? '' : value);
    // Quote when needed; a leading = + - @ would run as a formula in a spreadsheet.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function rows(type) {
    if (type === 'pages') return [['Page', 'Pageviews', 'Visitors']].concat(data.pages.map(function (p) { return [p.path, p.pageviews, p.visitors]; }));
    if (type === 'referrers') return [['Site', 'Visits', 'Visitors', 'Kind']].concat(data.referrers.map(function (r) { return [r.domain, r.visits, r.visitors, r.kind]; }));
    if (type === 'days') return [['Date (UTC)', 'Pageviews', 'Visitors']].concat(data.daily.map(function (d) { return [d.date, d.pageviews, d.visitors]; }));
    var s = data.summary;
    return [['Measure', 'Value'], ['Site', data.domain || data.site], ['From', s.period.start], ['To', s.period.end], ['Pageviews', s.pageviews], ['Visitors', s.visitors], ['Came directly', s.direct], ['Updated', s.updated]];
  }

  function download(type) {
    if (!data) return;
    var text = rows(type).map(function (r) { return r.map(cell).join(','); }).join('\n') + '\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = (data.site || 'site') + '-' + type + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
})();
