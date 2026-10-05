/*
 * Visitor-facing pricing UI. Uses BDPricing (pricing-engine.js) for every number, so the
 * calculator, starting prices and published rates always agree. Shows customer prices only.
 */
(function () {
  'use strict';
  var P = window.BDPricing;
  if (!P) return;
  var CFG = P.config;
  var money = P.formatMoney;
  var ORDER = ['instant', 'ai', 'editing', 'videography', 'graphic', 'web', 'publication', 'print'];

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  /* ------------------------------------------------------------ promotion banner */
  function renderPromoBanner() {
    var box = document.getElementById('promo-banner');
    if (!box) return;
    var p = CFG.promotion;
    if (!p.enabled || !p.eligibleCategories.length) { box.hidden = true; return; }
    var names = p.eligibleCategories.map(function (c) { return CFG.categories[c] ? CFG.categories[c].label : c; });
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('strong', { text: p.label }));
    box.appendChild(el('span', { text: 'Applies to: ' + names.join(', ') + '. Regular prices are shown alongside.' }));
  }

  /* ------------------------------------------------------------ starting prices */
  function renderFromPrices() {
    var grid = document.getElementById('from-grid');
    if (!grid) return;
    ORDER.forEach(function (id) {
      var c = CFG.categories[id];
      var from = P.fromPrice(id);
      var promo = from != null ? P.quote(id, c.from).promotion : null;
      if (promo && !promo.eligible) promo = null;
      var btn = el('button', { type: 'button', class: 'btn btn-line', 'data-pick': id, 'aria-label': 'Get an estimate for ' + c.label, text: 'Get an estimate' });
      btn.addEventListener('click', function () { pickCategory(id, true); });
      grid.appendChild(el('div', { class: 'from-card' }, [
        el('h3', { text: c.label }),
        el('p', { text: c.blurb }),
        el('div', { class: 'from-price' }, from != null
          ? (promo
            ? [el('span', { text: 'From' }), el('strong', { class: 'promo', text: money(promo.price) }), el('s', { text: money(from) })]
            : [el('span', { text: 'From' }), el('strong', { text: money(from) })])
          : [el('strong', { class: 'quote', text: 'Request a quote' })]),
        btn
      ]));
    });
  }

  /* ------------------------------------------------------------ Instant Editing section */
  function renderInstant() {
    var c = CFG.categories.instant;
    var price = document.getElementById('instant-price');
    if (price) {
      var from = P.fromPrice('instant');
      price.textContent = from != null ? money(from) + ' per video' : 'Request a quote';
    }
    var polish = document.getElementById('polish-rates');
    if (polish) [30, 60, 90, 120].forEach(function (m) {
      polish.appendChild(el('tr', null, [el('td', { text: m === 30 ? 'Up to 30 minutes' : 'Up to ' + (m / 60) + (m === 60 ? ' hour' : ' hours') }),
                                         el('td', { text: money(P.manualPolishPrice(m)) })]));
    });
    var terms = document.getElementById('instant-terms-text');
    if (terms) c.terms.paragraphs.forEach(function (t) { terms.appendChild(el('p', { text: t })); });
    var ver = document.getElementById('instant-terms-version');
    if (ver) ver.textContent = 'Version ' + c.terms.version;
    var list = function (id, items) { var u = document.getElementById(id); if (u) items.forEach(function (t) { u.appendChild(el('li', { text: t })); }); };
    list('polish-includes', c.manualPolish.includes);
    list('polish-custom', c.manualPolish.customQuote);
    list('tech-free', c.technicalIssues);
    var pr = document.getElementById('polish-promo');
    var p = CFG.promotion;
    if (pr) {
      if (p.enabled && p.eligibleCategories.indexOf('instant') >= 0) {
        pr.hidden = false;
        pr.textContent = p.manualPolishEligible ? 'Manual Polish is included in the startup offer.' : 'Manual Polish is not included in the startup offer.';
      } else pr.hidden = true;
    }
  }

  /* ------------------------------------------------------------ Print product listing */
  function renderPrintProducts() {
    var grid = document.getElementById('print-grid');
    if (!grid) return;
    var c = CFG.categories.print;
    Object.keys(c.products).forEach(function (id) {
      var p = c.products[id];
      // Lowest confirmed print-ready price for this product, if any vendor quote exists.
      var best = null;
      c.vendorQuotes.filter(function (q) { return q.product === id; }).forEach(function (q) {
        var r = P.quote('print', { product: id, size: q.size, quantity: String(q.quantity), stock: q.stock, sides: q.sides,
          coating: q.coating, fold: q.fold, finishing: q.finishing, design: 'ready', delivery: 'pickup' });
        if (r.regular != null && r.status === 'estimate' && (best == null || r.regular < best)) best = r.regular;
      });
      var sizes = el('ul', { class: 'sizes' });
      p.sizes.forEach(function (sz) { sizes.appendChild(el('li', { text: sz.label })); });
      var btn = el('a', { class: 'btn btn-line', href: '?service=print&product=' + id + '#calculator', text: 'Estimate ' + p.label.toLowerCase() });
      grid.appendChild(el('div', { class: 'from-card print-card' }, [
        el('h3', { text: p.label }),
        sizes,
        el('div', { class: 'from-price' }, best != null
          ? [el('span', { text: 'Printing from' }), el('strong', { text: money(best) })]
          : [el('strong', { class: 'quote', text: 'Request quote' })]),
        btn
      ]));
    });
  }

  /* ------------------------------------------------------------ AI rate table */
  function renderAiRates() {
    var body = document.getElementById('ai-rates');
    if (!body) return;
    CFG.categories.ai.publishedRates.forEach(function (r) {
      var q = r === '30s' ? P.quote('ai', { length: '30s' }) : P.quote('ai', { length: 'minutes', minutes: r });
      var label = r === '30s' ? '30 seconds' : r + (r === 1 ? ' minute' : ' minutes');
      body.appendChild(el('tr', null, [el('td', { text: label }), el('td', { text: money(q.regular) })]));
    });
    var extra = P.quote('ai', { length: 'minutes', minutes: CFG.categories.ai.threshold + 1 }, { internal: true });
    var note = document.getElementById('ai-extra');
    if (note && extra.internal) note.textContent = 'Over ' + CFG.categories.ai.threshold + ' minutes: the ' +
      CFG.categories.ai.threshold + '-minute price plus ' + money(extra.internal.extraUnitRate) +
      ' for each additional minute, with the total rounded up to the next dollar amount ending in 9.';
  }

  /* ------------------------------------------------------------ calculator */
  var state = { cat: null, values: {}, touched: {}, ack: false };
  var form, fieldsBox, catBox;

  function pickCategory(id, scroll) {
    if (!CFG.categories[id]) return;
    state.cat = id;
    state.values = P.defaults(id);
    state.touched = {};
    state.ack = false;
    var radio = document.getElementById('cat-' + id);
    if (radio) radio.checked = true;
    renderFields();
    update();
    if (scroll) {
      var calc = document.getElementById('calculator');
      if (calc) calc.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (radio) radio.focus({ preventScroll: true });
    }
  }

  function renderCategories() {
    catBox = document.getElementById('cat-options');
    ORDER.forEach(function (id) {
      var c = CFG.categories[id];
      var input = el('input', { type: 'radio', name: 'category', id: 'cat-' + id, value: id });
      input.addEventListener('change', function () { pickCategory(id); });
      catBox.appendChild(el('label', { class: 'cat', for: 'cat-' + id }, [input, el('span', { text: c.label })]));
    });
  }

  function renderFields() {
    fieldsBox.textContent = '';
    var cat = CFG.categories[state.cat];
    var groups = { main: el('div', { class: 'fgrid' }), recurring: null, named: [] };
    var current = null;
    cat.fields.forEach(function (f) {
      var id = 'f-' + f.id;
      var wrap = el('div', { class: 'field field-' + f.type, 'data-field': f.id });
      var errId = id + '-err', helpId = id + '-help';
      var describedBy = [f.help ? helpId : null, errId].filter(Boolean).join(' ');
      var input;
      if (f.type === 'bool') {
        input = el('input', { type: 'checkbox', id: id, name: f.id, 'aria-describedby': describedBy });
        input.checked = !!state.values[f.id];
        wrap.appendChild(el('label', { class: 'check', for: id }, [input, el('span', { text: f.label })]));
      } else {
        wrap.appendChild(el('label', { for: id, text: P.fieldLabel(state.cat, f, state.values) }));
        if (f.type === 'select') {
          input = el('select', { id: id, name: f.id, 'aria-describedby': describedBy });
          P.optionsFor(state.cat, f, state.values).forEach(function (o) {
            var opt = el('option', { value: o.value, text: o.label });
            if (o.value === state.values[f.id]) opt.selected = true;
            input.appendChild(opt);
          });
        } else if (f.type === 'date') {
          input = el('input', { type: 'date', id: id, name: f.id, required: true, 'aria-describedby': describedBy });
          input.value = state.values[f.id] || '';
        } else {
          input = el('input', { type: 'number', id: id, name: f.id, inputmode: f.type === 'int' ? 'numeric' : 'decimal',
            min: f.min, max: P.maxFor(state.cat, f, state.values), step: f.step || 1, required: !f.optional, 'aria-describedby': describedBy });
          input.value = state.values[f.id] == null ? '' : state.values[f.id];
        }
        wrap.appendChild(input);
      }
      if (f.help) wrap.appendChild(el('p', { class: 'help', id: helpId, text: f.help }));
      wrap.appendChild(el('p', { class: 'err', id: errId, 'aria-live': 'polite' }));
      input.addEventListener(f.type === 'bool' || f.type === 'select' || f.type === 'date' ? 'change' : 'input', function () {
        state.values[f.id] = f.type === 'bool' ? input.checked : input.value;
        state.touched[f.id] = true;
        if (f.type === 'select') {
          // Dependent options (sizes, materials, sides...) may change. On a product change, choices
          // the visitor never made take the new product's defaults; incompatible ones are reset.
          if (f.id === 'product') cat.fields.forEach(function (g) {
            if (g.productOptions && !state.touched[g.id]) state.values[g.id] = null;
          });
          P.resetIncompatible(state.cat, state.values);
          var focusId = document.activeElement && document.activeElement.id;
          renderFields();
          var again = focusId && document.getElementById(focusId);
          if (again) again.focus();
        }
        update();
      });
      if (f.recurring) {
        if (!groups.recurring) groups.recurring = el('div', { class: 'fgrid' });
        groups.recurring.appendChild(wrap);
      } else if (f.group) {
        if (!current || current.name !== f.group) {
          current = { name: f.group, box: el('div', { class: 'fgroup', 'data-group': f.group }, [el('h4', { text: f.group }), el('div', { class: 'fgrid' })]) };
          groups.named.push(current);
        }
        current.box.lastChild.appendChild(wrap);
      } else groups.main.appendChild(wrap);
    });
    fieldsBox.appendChild(el('h3', { class: 'step', text: '2. Choose the scope' }));
    fieldsBox.appendChild(groups.main);
    groups.named.forEach(function (g) { fieldsBox.appendChild(g.box); });
    if (groups.recurring) {
      fieldsBox.appendChild(el('h3', { class: 'step', text: 'Monthly services (optional)' }));
      fieldsBox.appendChild(groups.recurring);
    }
  }

  function update() {
    var res = P.quote(state.cat, state.values);
    var cat = CFG.categories[state.cat];
    // Visibility and errors
    cat.fields.forEach(function (f) {
      var wrap = fieldsBox.querySelector('[data-field="' + f.id + '"]');
      if (!wrap) return;
      var visible = P.fieldVisible(f, res.values, state.cat);
      wrap.hidden = !visible;
      var err = wrap.querySelector('.err');
      var input = wrap.querySelector('input, select');
      // Don't flag an empty date the visitor hasn't reached yet.
      var untouchedEmpty = f.type === 'date' && !state.touched[f.id] && !res.values[f.id];
      var msg = visible && !untouchedEmpty ? res.errors[f.id] : '';
      err.textContent = msg || '';
      if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    });
    fieldsBox.querySelectorAll('.fgroup').forEach(function (g) {
      g.hidden = !g.querySelector('.field:not([hidden])');
    });
    renderSummary(res);
  }

  function renderSummary(res) {
    var box = document.getElementById('summary-body');
    box.textContent = '';
    var quoteLink = document.getElementById('quote-btn');
    if (!res.valid) {
      var onlyDates = Object.keys(res.errors).every(function (k) { return k === 'pickupDate' || k === 'returnDate'; });
      box.appendChild(el('p', { class: 'muted', text: onlyDates
        ? 'Choose the equipment pickup and return dates to see an estimate.'
        : 'Fix the highlighted fields to see an estimate.' }));
      quoteLink.setAttribute('href', quoteHref(res, false));
      renderTermsGate(res.category === 'instant' ? res : null);
      return;
    }
    var heading, priceNode;
    if (res.status === 'quote') {
      heading = 'Price on request';
      priceNode = el('div', { class: 'total quote', text: 'Request a quote' });
    } else {
      heading = res.priceLabel || (res.status === 'partial' ? 'Estimated price for the priced items' : 'Estimated project price');
      var promo = res.promotion && res.promotion.eligible ? res.promotion : null;
      if (promo) {
        priceNode = el('div', { class: 'total-wrap' }, [
          el('div', { class: 'promo-label', text: promo.label }),
          el('div', { class: 'total promo', text: money(promo.price) }),
          el('div', { class: 'regular' }, ['Regular price ', el('s', { text: money(res.regular) })])
        ]);
      } else {
        priceNode = el('div', { class: 'total', text: money(res.regular) });
      }
    }
    box.appendChild(el('div', { class: 'total-head' }, [el('span', { text: heading }), el('span', { class: 'onetime', text: res.status === 'quote' ? '' : 'One-time' })]));
    box.appendChild(priceNode);
    if (res.promotion && res.promotion.eligible === false) {
      box.appendChild(el('p', { class: 'note', text: 'The startup offer is not available for this scope.' }));
    }
    if (res.partialNote) box.appendChild(el('p', { class: 'note', text: res.partialNote }));
    (res.notes || []).forEach(function (n) { box.appendChild(el('p', { class: 'note', text: n })); });

    var promoCfg = CFG.promotion;
    if (res.category === 'instant' && promoCfg.enabled && promoCfg.eligibleCategories.indexOf('instant') >= 0) {
      box.appendChild(el('p', { class: 'note', text: promoCfg.manualPolishEligible
        ? 'Manual Polish is included in the startup offer.' : 'Manual Polish is not included in the startup offer.' }));
    }
    var list = el('ul', { class: 'lines' });
    res.lines.forEach(function (l) { list.appendChild(el('li', null, [el('span', { text: l.label }), el('span', { text: l.detail })])); });
    box.appendChild(el('h4', { text: 'Your selections' }));
    box.appendChild(list);

    if (res.addOns && res.addOns.length) {
      var al = el('ul', { class: 'lines' });
      res.addOns.forEach(function (a) {
        var priceNode = a.price == null ? el('span', { text: 'Custom quote' })
          : a.promotion && a.promotion.eligible
            ? el('span', null, [el('strong', { class: 'promo-inline', text: money(a.promotion.price) }), ' ', el('s', { text: money(a.price) })])
            : el('strong', { text: money(a.price) });
        al.appendChild(el('li', null, [el('span', { text: a.label + ': ' + a.detail }), priceNode]));
      });
      box.appendChild(el('h4', { text: 'Optional add-on (confirmed before work starts)' }));
      box.appendChild(al);
    }
    if (res.alternatives && res.alternatives.length) {
      var alt = el('ul', { class: 'lines alts' });
      res.alternatives.forEach(function (a) {
        alt.appendChild(el('li', null, [
          el('span', { text: a.differences.join('; ') + (a.pending.length ? ' (' + a.pending.join(' and ') + ' to be confirmed)' : '') }),
          el('strong', { text: money(a.price) })]));
      });
      box.appendChild(el('h4', { text: 'Lower-cost option' + (res.alternatives.length > 1 ? 's' : '') + ' (not your exact selection)' }));
      box.appendChild(alt);
    }
    var oneTimeQuotes = res.quoteItems.filter(function (q) { return !q.recurring; });
    var monthlyQuotes = res.quoteItems.filter(function (q) { return q.recurring; });
    if (oneTimeQuotes.length) {
      var ql = el('ul', { class: 'lines quote-items' });
      oneTimeQuotes.forEach(function (q) { ql.appendChild(el('li', null, [el('span', { text: q.label }), el('span', { text: q.reason })])); });
      box.appendChild(el('h4', { text: res.category === 'print' ? 'Still to be confirmed' : 'Needs a custom quote' }));
      box.appendChild(ql);
    }
    if (res.recurring.length || monthlyQuotes.length) {
      var rl = el('ul', { class: 'lines' });
      res.recurring.forEach(function (r) { rl.appendChild(el('li', null, [el('span', { text: r.label }), el('strong', { text: money(r.monthly) + ' per month' })])); });
      monthlyQuotes.forEach(function (q) { rl.appendChild(el('li', null, [el('span', { text: q.label }), el('span', { text: 'Quoted separately' })])); });
      box.appendChild(el('h4', { text: 'Monthly (billed separately)' }));
      box.appendChild(rl);
    }
    box.appendChild(el('p', { class: 'fine', text: 'An estimate for planning, based on the scope above. The final price is confirmed in writing after we review your project.' }));
    quoteLink.setAttribute('href', quoteHref(res, true));
    renderTermsGate(res);
  }

  // Instant Editing: notice by the button, terms link, and a required (unchecked) acknowledgment.
  function renderTermsGate(res) {
    var gate = document.getElementById('terms-gate');
    var btn = document.getElementById('quote-btn');
    gate.textContent = '';
    var c = CFG.categories.instant;
    if (!res || res.category !== 'instant') {
      gate.hidden = true;
      btn.removeAttribute('aria-disabled');
      return;
    }
    gate.hidden = false;
    gate.appendChild(el('p', { class: 'gate-notice', text: c.notice }));
    var cb = el('input', { type: 'checkbox', id: 'terms-ack' });
    cb.checked = state.ack;
    cb.addEventListener('change', function () { state.ack = cb.checked; update(); document.getElementById('terms-ack').focus(); });
    gate.appendChild(el('label', { class: 'gate-check', for: 'terms-ack' }, [cb, el('span', { text: c.acknowledgment })]));
    var link = el('a', { href: c.terms.url, text: 'Read the ' + c.terms.title });
    gate.appendChild(el('p', { class: 'gate-link' }, [link, ' (version ' + c.terms.version + ')']));
    if (!state.ack) {
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-describedby', 'gate-msg');
      gate.appendChild(el('p', { class: 'gate-msg', id: 'gate-msg', text: 'Tick the box above to continue.' }));
    } else {
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-describedby');
      btn.setAttribute('href', quoteHref(res, true, true));
    }
  }

  function quoteHref(res, withSummary, acknowledged) {
    var params = new URLSearchParams();
    if (CFG.contactProjectType[res.category]) params.set('type', CFG.contactProjectType[res.category]);
    if (withSummary) params.set('brief', P.summaryText(res, acknowledged ? { termsAcknowledged: true, terms: CFG.categories.instant.terms } : {}));
    return 'index.html?' + params.toString() + '#contact';
  }

  function init() {
    renderPromoBanner();
    renderFromPrices();
    renderAiRates();
    form = document.getElementById('calc-form');
    fieldsBox = document.getElementById('calc-fields');
    if (!form) return;
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    document.getElementById('quote-btn').addEventListener('click', function (e) {
      if (this.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        var ack = document.getElementById('terms-ack');
        if (ack) ack.focus();
      }
    });
    renderInstant();
    renderPrintProducts();
    renderCategories();
    var qs = new URLSearchParams(location.search);
    var want = qs.get('service');
    pickCategory(CFG.categories[want] ? want : 'ai', false);
    var prod = qs.get('product');
    if (want === 'print' && prod && CFG.categories.print.products[prod]) {
      state.values.product = prod;
      P.resetIncompatible('print', state.values);
      renderFields();
      update();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
