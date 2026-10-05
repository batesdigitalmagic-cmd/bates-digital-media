/*
 * Bates Digital pricing engine.
 *
 * Pure functions shared by the visitor calculator, the service pages and pricing/verify.js.
 * All numbers come from pricing-config.js. Nothing here is customer-facing text about costs:
 * quote() returns customer-facing lines, and internal figures only when { internal: true }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing-config.js'));
  else root.BDPricing = factory(root.BD_PRICING);
})(typeof self !== 'undefined' ? self : this, function (CFG) {
  'use strict';

  var EPS = 1e-9;

  // Smallest whole-dollar amount ending in 9 that is >= x.
  function roundUp9(x) {
    if (typeof x !== 'number' || !isFinite(x) || x < 0) return NaN;
    var n = Math.ceil(x - EPS);
    return n + ((9 - (n % 10)) + 10) % 10;
  }

  // Target margin for `units` on a straight line from margins.start (1 unit) to
  // margins.volumeFloor (threshold units).
  function marginAt(units, threshold) {
    var s = CFG.margins.start, f = CFG.margins.volumeFloor;
    if (threshold <= 1) return f;
    var u = Math.min(Math.max(units, 1), threshold);
    return s - (u - 1) * (s - f) / (threshold - 1);
  }

  function priceAtMargin(cost, margin) {
    return cost / (1 - margin);
  }

  // fixed: setup costs that do not scale; unit: cost per unit; units; threshold.
  function priceByVolume(fixed, unit, units, threshold, roundExtraUnitRate) {
    if (units <= threshold) {
      var m = marginAt(units, threshold);
      var cost = fixed + unit * units;
      return { cost: cost, margin: m, raw: priceAtMargin(cost, m), regular: roundUp9(priceAtMargin(cost, m)), tier: 'standard' };
    }
    // Keep the threshold price; price only the additional units at the additional-volume margin.
    var baseCost = fixed + unit * threshold;
    var baseRaw = priceAtMargin(baseCost, CFG.margins.volumeFloor);
    var extra = units - threshold;
    var regular, raw;
    var extraUnitRate = null;
    if (roundExtraUnitRate) {
      extraUnitRate = roundUp9(priceAtMargin(unit, CFG.margins.additional));
      raw = roundUp9(baseRaw) + extra * extraUnitRate;
    } else {
      raw = baseRaw + extra * priceAtMargin(unit, CFG.margins.additional);
    }
    regular = roundUp9(raw);
    return { cost: baseCost + unit * extra, margin: null, raw: raw, regular: regular, tier: 'additional',
             baseRegular: roundUp9(baseRaw), extraUnitRate: extraUnitRate };
  }

  /* ------------------------------------------------------------ input handling */

  // showIf is one condition or an array of conditions that must all hold.
  function fieldVisible(field, values, catId) {
    if (field.productOptions && catId && !productList(catId, field.productOptions, values).length) return false;
    if (!field.showIf) return true;
    var conds = Array.isArray(field.showIf) ? field.showIf : [field.showIf];
    return conds.every(function (c) {
      var v = values[c.field];
      if ('equals' in c) return v === c.equals;
      if ('notEquals' in c) return v !== c.notEquals;
      if ('in' in c) return c.in.indexOf(v) >= 0;
      return true;
    });
  }

  function optionsFor(catId, field, values) {
    var cat = CFG.categories[catId];
    if (field.options) return field.options;
    if (field.optionsFrom) {
      var src = cat[field.optionsFrom];
      return Object.keys(src).map(function (k) { return { value: k, label: src[k].label }; });
    }
    if (field.productOptions) {
      return productList(catId, field.productOptions, values).map(function (o) {
        return typeof o === 'number' ? { value: String(o), label: o.toLocaleString('en-US') } : { value: o.id, label: o.label };
      });
    }
    if (field.optionsFromProduct) {
      var p = cat.products[values.product];
      return (p ? p[field.optionsFromProduct] : []).map(function (s) { return { value: s, label: s }; });
    }
    return [];
  }

  // A product's option list (print). Printed sides can depend on the chosen material.
  function productList(catId, key, values) {
    var cat = CFG.categories[catId];
    var p = cat && cat.products ? cat.products[values.product] : null;
    if (!p) return [];
    if (key === 'sides' && p.sidesByStock) return p.sidesByStock[values.stock] || [];
    return p[key] || [];
  }

  // Field label, which can come from the product (e.g. "Banner material").
  function fieldLabel(catId, field, values) {
    var cat = CFG.categories[catId];
    var p = cat && cat.products ? cat.products[values.product] : null;
    return field.labelFromProduct && p && p[field.labelFromProduct] ? p[field.labelFromProduct] : field.label;
  }

  // Replace any product-dependent selection the current product doesn't offer.
  function resetIncompatible(catId, values) {
    var cat = CFG.categories[catId];
    // Two passes: sides depend on stock.
    for (var pass = 0; pass < 2; pass++) cat.fields.forEach(function (f) {
      if (!f.productOptions && !f.optionsFromProduct) return;
      var opts = optionsFor(catId, f, values);
      if (!opts.length) { values[f.id] = null; return; }
      if (!opts.some(function (o) { return o.value === values[f.id]; })) {
        var pref = opts.filter(function (o) { return o.value === f.default; })[0];
        values[f.id] = (pref || opts[0]).value;
      }
    });
    return values;
  }

  function maxFor(catId, field, values) {
    var cat = CFG.categories[catId];
    if (field.maxFrom === 'deliverable' && cat.deliverables[values.deliverable]) return cat.deliverables[values.deliverable].max;
    if (field.maxFrom === 'product' && cat.products[values.product]) return cat.products[values.product].max;
    return field.max;
  }

  function defaults(catId) {
    var cat = CFG.categories[catId], v = {};
    cat.fields.forEach(function (f) { v[f.id] = f.default; });
    cat.fields.forEach(function (f) {
      if (f.optionsFrom) {
        var opts = optionsFor(catId, f, v);
        if (!opts.some(function (o) { return o.value === v[f.id]; }) && opts.length) v[f.id] = opts[0].value;
      }
    });
    resetIncompatible(catId, v);
    return v;
  }

  // Coerce and validate raw input (strings from a form or URL). Returns { values, errors }.
  function validate(catId, raw) {
    var cat = CFG.categories[catId];
    var errors = {};
    if (!cat) return { values: {}, errors: { category: 'Choose a service.' } };
    var values = defaults(catId);
    raw = raw || {};
    // Selects first, so dependent options and limits use the chosen values.
    var order = cat.fields.slice().sort(function (a, b) { return (a.type === 'select' ? 0 : 1) - (b.type === 'select' ? 0 : 1); });
    order.forEach(function (f) {
      if (!(f.id in raw)) return;
      var r = raw[f.id];
      if (f.type === 'bool') values[f.id] = (r === true || r === 'true' || r === 'on' || r === '1');
      else if (f.type === 'select') values[f.id] = String(r);
      else if (f.type === 'date') values[f.id] = r == null ? null : String(r).trim() || null;
      else if (r == null || String(r).trim() === '') values[f.id] = f.optional ? null : NaN;
      else values[f.id] = (typeof r === 'number') ? r : Number(r);
    });
    // Fill product-dependent choices the input didn't specify (e.g. a size after a product change).
    cat.fields.forEach(function (f) {
      if ((f.productOptions || f.optionsFromProduct) && !(f.id in raw)) {
        // Not chosen: use this product's own default, never a value carried over from another product.
        var opts = optionsFor(catId, f, values);
        var pref = opts.filter(function (o) { return o.value === f.default; })[0];
        values[f.id] = opts.length ? (pref || opts[0]).value : null;
      }
    });
    cat.fields.forEach(function (f) {
      if (!fieldVisible(f, values, catId)) return;
      var v = values[f.id];
      if (f.type === 'select') {
        var opts = optionsFor(catId, f, values);
        if (!opts.some(function (o) { return o.value === v; })) errors[f.id] = 'Choose an option.';
      } else if (f.type === 'date') {
        if (v == null) errors[f.id] = 'Choose a date.';
        else if (parseDate(v) == null) errors[f.id] = 'Enter a valid date.';
      } else if (f.type === 'int' || f.type === 'number') {
        if (f.optional && v === null) return;
        var max = maxFor(catId, f, values);
        if (typeof v !== 'number' || !isFinite(v)) errors[f.id] = 'Enter a number.';
        else if (f.type === 'int' && Math.floor(v) !== v) errors[f.id] = 'Enter a whole number.';
        else if (f.type === 'number' && f.step && Math.abs(Math.round(v / f.step) * f.step - v) > EPS) errors[f.id] = 'Use steps of ' + f.step + '.';
        else if (v < f.min) errors[f.id] = 'The minimum is ' + f.min + '.';
        else if (v > max) errors[f.id] = 'For more than ' + max + ', request a quote.';
      }
    });
    if (CHECKS[catId]) CHECKS[catId](values, cat, errors);
    return { values: values, errors: errors };
  }

  /* -------------------------------------------- category-specific validation */

  // 'YYYY-MM-DD' -> UTC day number, or null.
  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return t / 86400000;
  }

  // Rental days from pickup and return dates. A same-day return counts as 1 day.
  function rentalDays(pickup, ret) {
    var a = parseDate(pickup), b = parseDate(ret);
    if (a == null || b == null || b < a) return null;
    return Math.max(1, b - a);
  }

  // Cameras in use (1-3) for a videography selection; 0 for a custom setup.
  function cameraCount(v) { return v.cameras === 'custom' ? 0 : Number(v.cameras); }

  // Approximate recording minutes for one card in a recording mode.
  function cardMinutes(card, mode, c) {
    return Math.floor(card.gb * 1e9 * c.usableShare * 8 / (mode.mbps * 1e6) / 60);
  }

  // Internal rental cost and camera body for one camera's lens kit under the configured cost basis.
  // cost null = not priceable yet (request a quote). Never falls back to another basis.
  function kitInfo(c, lensId) {
    if (lensId === 'other') return { cost: null, body: null };
    var basisId = c.cameraPackage.costBasis, basis = c.costBases[basisId];
    if (!basis) return { cost: null, body: null };
    if (basisId === 'fx3') {
      var kit = basis.kits[lensId];
      return { cost: kit ? kit.costPerWindow : null, body: basis.body };
    }
    var parts = [basis.cameraAllowancePerWindow, basis.protectionAllowancePerWindow, basis.lensAllowancePerWindow[lensId]];
    var known = parts.every(function (x) { return typeof x === 'number'; });
    return { cost: known ? parts[0] + parts[1] + parts[2] : null, body: basis.body, estimate: true };
  }

  // Can this card record this mode in this camera? Returns '' or a reason.
  function cardProblem(bodyId, card, mode, c) {
    if (!bodyId || !c.cameraBodies[bodyId] || !c.cameraBodies[bodyId].mediaVerified) return '';
    var body = c.cameraBodies[bodyId];
    if (body.slotTypes.indexOf(card.type) < 0) return 'This camera does not take this card.';
    if (card.type === 'cfa') {
      if (card.vpg == null) return 'This card\'s speed rating is not confirmed yet. Choose another card or request a quote.';
      if (card.vpg < mode.cfaMinVpg) return 'This card is too slow for the chosen format (needs VPG' + mode.cfaMinVpg + ' or faster).';
    }
    if (card.type === 'sd') {
      if (card.videoClass == null) return 'This card\'s speed rating is not confirmed yet. Choose the CFexpress card or request a quote.';
      if (card.videoClass < mode.sdMinClass) return 'This card is too slow for the chosen format (needs V' + mode.sdMinClass + ' or faster).';
    }
    return '';
  }

  var CHECKS = {
    videography: function (v, c, errors) {
      var n = cameraCount(v);
      if (!n) return;
      if (!errors.pickupDate && !errors.returnDate) {
        var days = rentalDays(v.pickupDate, v.returnDate);
        if (days == null) errors.returnDate = 'The return date must be on or after the pickup date.';
        else if (days > c.maxRentalDays) errors.returnDate = 'For rentals longer than ' + c.maxRentalDays + ' days, request a quote.';
        else if (!errors.filmingDays && v.filmingDays > days + 1)
          errors.filmingDays = 'Filming days must fit between pickup and return.';
      }
      var mode = c.recordModes[v.recordMode];
      for (var i = 1; i <= n; i++) {
        var kit = c.lensKits[v['cam' + i + 'Lens']] ? kitInfo(c, v['cam' + i + 'Lens']) : null, card = c.cards[v['cam' + i + 'Card']];
        if (!kit || !card || !mode) continue;
        var problem = cardProblem(kit.body, card, mode, c);
        if (problem && !errors['cam' + i + 'Card']) errors['cam' + i + 'Card'] = problem;
        var qty = v['cam' + i + 'CardQty'];
        if (v.recording === 'backup' && typeof qty === 'number' && qty % 2 !== 0 && !errors['cam' + i + 'CardQty'])
          errors['cam' + i + 'CardQty'] = 'Backup recording uses cards in pairs. Choose an even number.';
      }
    }
  };

  /* --------------------------------------------------------- category pricing */
  // Each returns { fixed, unit, units, threshold, roundExtraUnitRate?, lines, quoteItems, recurring, flat? }

  var R = function () { return CFG.laborRate; };

  // One operator's booking priced through the progressive tiers. Never pooled across operators.
  function operatorCharge(hours, rate, c) {
    var cost = 0, raw = 0, prev = 0, overtimeUnpriced = false;
    var ot = c.overtime && c.overtime.afterHours != null ? c.overtime : null;
    if (ot && hours > ot.afterHours && ot.actualCostPerHour == null) overtimeUnpriced = true;
    c.operatorTiers.forEach(function (t) {
      var seg = Math.max(0, Math.min(hours, t.upTo) - prev);
      // Split the segment at the overtime point, if any.
      var normal = seg, over = 0;
      if (ot) { over = Math.max(0, Math.min(hours, t.upTo) - Math.max(prev, ot.afterHours)); normal = seg - over; }
      var otRate = ot && ot.actualCostPerHour != null ? ot.actualCostPerHour : rate;
      var segCost = normal * rate + over * otRate;
      cost += segCost; raw += priceAtMargin(segCost, t.margin);
      prev = t.upTo;
    });
    return { cost: cost, raw: raw, overtimeUnpriced: overtimeUnpriced };
  }

  function fmtHours(h) { return h + (h === 1 ? ' hour' : ' hours'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // Manual Polish price for an allowance of editing labor, in minutes. null = custom quote.
  function manualPolishPrice(minutes) {
    var mp = CFG.categories.instant.manualPolish;
    if (typeof minutes !== 'number' || !isFinite(minutes) || minutes <= 0) return null;
    if (minutes > mp.maxMinutes) return null;
    var billed = Math.ceil(minutes / mp.incrementMinutes - EPS) * mp.incrementMinutes; // 30-minute steps
    var cost = billed / 60 * CFG.laborRate;
    return Math.max(mp.minimumPrice, roundUp9(priceAtMargin(cost, mp.margin)));
  }

  // Sort a requested change into: 'technical' (fixed free), 'polish' (Manual Polish) or 'custom' (custom quote).
  function classifyChange(kind) {
    var c = CFG.categories.instant, k = String(kind || '').toLowerCase();
    if (c.technicalIssues.some(function (t) { return t.toLowerCase() === k; })) return 'technical';
    if (c.manualPolish.includes.some(function (t) { return t.toLowerCase() === k; })) return 'polish';
    return 'custom';
  }

  var CALC = {
    instant: function (v, c) {
      var setupCost = c.setup.hours * R();
      var setupCharge = priceAtMargin(setupCost, c.setup.margin);
      var lines = [{ label: 'Instant Editing', detail: '1 music video, one preset-based edit' },
                   { label: 'Project setup', detail: 'Included' }];
      var addOns = [];
      if (v.polish === 'custom') {
        addOns.push({ label: 'Manual Polish', detail: 'Bigger changes', price: null,
                      reason: 'Major changes need a custom editing quote, confirmed before work starts.' });
      } else if (v.polish !== '0') {
        var mins = Number(v.polish);
        addOns.push({ label: 'Manual Polish', detail: 'Up to ' + fmtHours(mins / 60).replace('0.5 hours', '30 minutes') + ' of editing labor',
                      price: manualPolishPrice(mins) });
      }
      var notes = []; // the preset-edit notice is shown next to the request button
      if (addOns.length) notes.push('Manual Polish starts after we confirm your change list and price. Work beyond the allowance needs a separate approved quote.');
      if (c.existingPrice == null) {
        return { quoteOnly: true, lines: lines, addOns: addOns, notes: notes, recurring: [],
                 quoteItems: [{ label: 'Instant Editing', reason: 'Standard price to be confirmed.' }] };
      }
      var raw = c.existingPrice + (c.existingPriceIncludesSetup ? 0 : setupCharge);
      var cost = c.existingInternalCost == null ? null : c.existingInternalCost + (c.existingPriceIncludesSetup ? 0 : setupCost);
      return { priced: { cost: cost, raw: raw }, lines: lines, addOns: addOns, notes: notes, quoteItems: [], recurring: [] };
    },

    ai: function (v, c) {
      var per30 = c.renderCostPer30s + c.editHoursPer30s * R();
      if (v.length === '30s') {
        return { flat: { cost: per30 + c.softwarePerProject, margin: CFG.margins.start },
                 lines: [{ label: 'AI video', detail: '30-second finished spot' },
                         { label: 'Generation, editing and finishing', detail: 'Included' }],
                 quoteItems: [], recurring: [] };
      }
      return { fixed: c.softwarePerProject, unit: per30 * 2, units: v.minutes, threshold: c.threshold,
               roundExtraUnitRate: c.roundExtraUnitRate,
               lines: [{ label: 'AI video', detail: plural(v.minutes, 'finished minute', 'finished minutes') },
                       { label: 'Generation, editing and finishing', detail: 'Included' }],
               quoteItems: [], recurring: [] };
    },

    editing: function (v, c) {
      var lines = [{ label: 'Video editing', detail: plural(v.minutes, 'finished minute', 'finished minutes') + ', ' + {
        basic: 'basic style', standard: 'standard style', advanced: 'advanced style' }[v.effects] },
        { label: 'Footage review', detail: v.footageHours + ' hours of raw footage' }];
      var quoteItems = [];
      var unitH = c.editHoursPerMinute[v.effects];
      if (v.captions) { unitH += c.captionHoursPerMinute; lines.push({ label: 'Captions', detail: 'Added' }); }
      if (v.audio === 'cleanup') { unitH += c.audioCleanupHoursPerMinute; lines.push({ label: 'Audio', detail: 'Noise cleanup and full mix' }); }
      else lines.push({ label: 'Audio', detail: 'Basic mix' });
      var fixed = (c.setupHours + v.footageHours * c.reviewHoursPerFootageHour) * R() + c.softwarePerProject;
      if (v.audio === 'music') {
        if (c.musicLicenseCost == null) quoteItems.push({ label: 'Licensed music track', reason: 'Licensing cost depends on the track.' });
        else fixed += c.musicLicenseCost;
      }
      if (v.extraRevisions) {
        fixed += v.extraRevisions * c.revision.fixedHours * R();
        unitH += v.extraRevisions * c.revision.hoursPerMinute;
        lines.push({ label: 'Extra revision rounds', detail: String(v.extraRevisions) });
      }
      lines.push({ label: 'Revision rounds', detail: c.revision.includedRounds + ' included' });
      return { fixed: fixed, unit: unitH * R(), units: v.minutes, threshold: c.threshold, lines: lines, quoteItems: quoteItems, recurring: [] };
    },

    videography: function (v, c) {
      var n = cameraCount(v);
      if (!n) {
        return { quoteOnly: true, lines: [{ label: 'Camera setup', detail: 'Custom' }],
                 quoteItems: [{ label: 'Custom camera setup', reason: 'Cameras, crew and equipment are planned with you.' }], recurring: [] };
      }
      var mode = c.recordModes[v.recordMode];
      var lines = [], quoteItems = [], notes = [];
      var cost = 0, raw = 0;

      // Operators: you (operator 1) plus one per additional camera that has its own operator.
      var ops = [{ name: 'Lead operator', hours: v.hours, setup: v.setup1 }];
      var locked = 0;
      for (var i = 2; i <= n; i++) {
        if (v['cam' + i + 'Mode'] === 'locked') { locked++; continue; }
        var h = v['cam' + i + 'Hours'] == null ? v.hours : v['cam' + i + 'Hours'];
        ops.push({ name: 'Camera ' + i + ' operator', hours: h, setup: v['cam' + i + 'Setup'] });
      }
      var overtimeQuoted = false;
      ops.forEach(function (op, idx) {
        var booked = Math.max(op.hours + op.setup, c.crewMinimumHours);
        var rate = c.operatorCostOverrides[idx + 1] != null ? c.operatorCostOverrides[idx + 1] : c.operatorCostPerHour;
        var p = operatorCharge(booked, rate, c);
        if (p.overtimeUnpriced) overtimeQuoted = true;
        cost += p.cost; raw += p.raw;
        op.booked = booked;
      });
      if (overtimeQuoted) quoteItems.push({ label: 'Overtime', reason: 'Overtime rates are confirmed per booking.' });

      // Equipment and media: rental days come from the pickup and return dates only.
      // Each item is charged once per rental window, never per hour or per operator.
      var days = rentalDays(v.pickupDate, v.returnDate);
      var windows = Math.ceil(days / c.equipment.rentalWindowDays);
      var eqCost = 0;
      lines.push({ label: 'Cameras', detail: n + (locked ? ' (' + locked + ' locked-off)' : '') });
      lines.push({ label: 'Camera operators', detail: ops.length === 1 ? '1 (lead)' : ops.length + ' (lead + ' + (ops.length - 1) + ' additional)' });
      var sameHours = ops.every(function (o) { return o.hours === ops[0].hours && o.setup === ops[0].setup; });
      lines.push({ label: 'Filming days', detail: String(v.filmingDays) });
      lines.push({ label: 'Equipment rental', detail: v.pickupDate + ' to ' + v.returnDate + ' (' + plural(days, 'day', 'days') + ')' });
      if (sameHours) lines.push({ label: 'Filming hours', detail: fmtHours(v.hours) + (ops.length > 1 ? ' per operator' : '') +
        (ops[0].setup ? ' + ' + fmtHours(ops[0].setup) + ' setup' : '') });
      else ops.forEach(function (o) { lines.push({ label: o.name, detail: fmtHours(o.hours) + ' filming' + (o.setup ? ' + ' + fmtHours(o.setup) + ' setup' : '') }); });
      if (ops.some(function (o) { return o.hours + o.setup < c.crewMinimumHours; }))
        notes.push('Each operator is booked for at least ' + c.crewMinimumHours + ' hours.');

      lines.push({ label: 'Camera package', detail: c.cameraPackage.label + (n === 1 ? ', one camera' : ', multicamera (' + n + ' cameras)') });
      var mediaUnverified = false;
      for (var k = 1; k <= n; k++) {
        var lensId = v['cam' + k + 'Lens'], kit = kitInfo(c, lensId), lens = c.lensKits[lensId];
        var card = c.cards[v['cam' + k + 'Card']], qty = v['cam' + k + 'CardQty'];
        var camLabel = 'Camera ' + k + (k > 1 && v['cam' + k + 'Mode'] === 'locked' ? ' (locked-off)' : '');
        var lensText = lens.label.replace(' (quoted)', '');
        if (kit.cost == null) quoteItems.push({ label: camLabel + ': ' + lensText.toLowerCase(), reason: 'Equipment is confirmed per booking.' });
        else eqCost += kit.cost * windows;
        if (kit.body && !c.cameraBodies[kit.body].mediaVerified) mediaUnverified = true;
        lines.push({ label: camLabel, detail: lensText + (kit.cost != null ? ', protection included' : '') });
        // Cards are rented separately from the package, so they are added exactly once here.
        eqCost += card.costPerWindow * qty * windows;
        var per = cardMinutes(card, mode, c);
        var usable = v.recording === 'backup' ? Math.floor(qty / 2) * per : qty * per;
        lines.push({ label: 'Media, camera ' + k, detail: qty + ' × ' + card.gb + 'GB ' + (card.type === 'cfa' ? 'CFexpress Type A' : 'SD') +
          ', estimated ' + usable + ' min' + (v.recording === 'backup' ? ' with backup' : '') });
        var lockedOff = k > 1 && v['cam' + k + 'Mode'] === 'locked';
        [['Support', 'support'], ['Batteries', 'batteries'], ['Monitor', 'monitor']].forEach(function (a) {
          // A locked-off camera always needs its own support.
          var wanted = v['cam' + k + a[0]] || (lockedOff && c.lockedOffRequires.indexOf(a[1]) >= 0);
          if (!wanted) return;
          var acc = c.accessories[a[1]];
          if (acc.costPerWindow == null) quoteItems.push({ label: 'Camera ' + k + ': ' + acc.label.toLowerCase(), reason: 'Rental cost is confirmed per booking.' });
          else { eqCost += acc.costPerWindow * windows; lines.push({ label: 'Camera ' + k + ': ' + acc.label.toLowerCase(), detail: 'Added' }); }
        });
      }
      // One shared reader per booking; it reads both card types. A second only when chosen.
      var readers = v.extraReader ? 2 : 1;
      eqCost += c.reader.costPerWindow * readers * windows;
      lines.push({ label: 'Card reader', detail: readers === 1 ? '1, shared' : '2 (two offload stations)' });
      cost += eqCost; raw += priceAtMargin(eqCost, c.equipment.margin);
      if (locked) notes.push('Locked-off camera placement is confirmed when we review the scope.');
      if (mediaUnverified) quoteItems.push({ label: 'Memory card compatibility', reason: 'Confirmed with the final camera before booking.' });
      notes.push(c.cameraPackage.customerNote);
      notes.push('Media allowance and recording times are estimates, not guaranteed recording time.');

      // Shared preparation, once per booking.
      var prepCost = c.prep.includedHours * R();
      cost += prepCost; raw += priceAtMargin(prepCost, c.prep.margin);
      lines.push({ label: 'Planning, prep and rental handling', detail: 'Included' });
      if (v.prepExtra) {
        var extraPrep = v.prepExtra * R();
        cost += extraPrep; raw += priceAtMargin(extraPrep, c.prep.extraHoursMargin);
        lines.push({ label: 'Extra prep, data transfer and backup', detail: fmtHours(v.prepExtra) });
      }

      // Shared add-ons.
      function addOn(flag, unitCost, mult, label, reason) {
        if (!flag) return;
        if (unitCost == null) quoteItems.push({ label: label, reason: reason });
        else { cost += unitCost * mult; raw += priceAtMargin(unitCost * mult, c.equipment.margin); lines.push({ label: label, detail: 'Added' }); }
      }
      addOn(v.audioTech, c.audioTechCostPerHour, v.hours, 'Sound recordist', 'Crew rates are quoted per booking.');
      addOn(v.lighting, c.lightingRentalPerWindow, windows, 'Large lighting package', 'Rental cost is quoted per booking.');
      addOn(v.drone, c.droneCostPerDay, v.filmingDays, 'Drone footage', 'Drone operation is quoted per location.');
      if (v.travel === 'travel') addOn(true, c.travelCostOutsideLocal, 1, 'Travel outside the local area', 'Travel depends on the location.');
      else lines.push({ label: 'Location', detail: 'Local' });

      // Multicamera editing, priced separately on finished minutes.
      if (v.edit !== 'none') {
        var e = c.multicamEdit, extraCams = n - 1;
        var footageHours = v.hours * n * e.recordedShareOfFilming;
        var fixedH = e.setupHours + extraCams * e.syncHoursPerCamera + footageHours * e.reviewHoursPerFootageHour +
          (v.colorMatch && extraCams ? extraCams * e.colorMatchHoursPerCamera : 0) + (v.formats - 1) * e.deliveryHoursPerExtraFormat;
        var unitH = e.editHoursPerMinute[v.edit] + extraCams * e.switchHoursPerMinutePerCamera +
          (v.captions ? e.captionHoursPerMinute : 0) + (v.audioCleanup ? e.audioCleanupHoursPerMinute : 0);
        var ed = priceByVolume(fixedH * R() + c.softwarePerProject, unitH * R(), v.editMinutes, e.threshold);
        cost += ed.cost; raw += ed.raw;
        lines.push({ label: n > 1 ? 'Multicamera editing' : 'Editing', detail: plural(v.editMinutes, 'finished minute', 'finished minutes') + ', ' + v.edit + ' style' +
          (n > 1 ? ', synced and switched' + (v.colorMatch ? ', color matched' : '') : '') });
        if (v.captions) lines.push({ label: 'Captions', detail: 'Added' });
        if (v.audioCleanup) lines.push({ label: 'Audio cleanup and mix', detail: 'Added' });
        if (v.formats > 1) lines.push({ label: 'Delivery formats', detail: String(v.formats) });
      } else lines.push({ label: 'Delivery', detail: 'Footage only' });

      return { priced: { cost: cost, raw: raw }, lines: lines, quoteItems: quoteItems, recurring: [], notes: notes,
               internal: { operators: ops.map(function (o) { return o.booked; }), rentalDays: days, windows: windows, equipmentCost: eqCost } };
    },

    graphic: function (v, c) {
      var d = c.deliverables[v.deliverable];
      var unitH = d.hoursPerUnit * c.complexity[v.complexity];
      var fixedH = d.setupHours;
      var lines = [{ label: d.label, detail: plural(v.quantity, d.unit.replace(/s$/, ''), d.unit) + ', ' + v.complexity }];
      if (v.extraRevisions) {
        fixedH += v.extraRevisions * c.revision.fixedHours;
        unitH += v.extraRevisions * c.revision.unitShare * d.hoursPerUnit * c.complexity[v.complexity];
        lines.push({ label: 'Extra revision rounds', detail: String(v.extraRevisions) });
      }
      lines.push({ label: 'Revision rounds', detail: c.revision.includedRounds + ' included' });
      return { fixed: fixedH * R() + c.softwarePerProject, unit: unitH * R(), units: v.quantity, threshold: d.threshold,
               lines: lines, quoteItems: [], recurring: [] };
    },

    print: function (v, c) {
      var p = c.products[v.product];
      var m = printMargin(c);
      var label = function (key, id) { var o = (key === 'sides' && p.sidesByStock ? p.sidesByStock[v.stock] : p[key]).filter(function (x) { return x.id === id; })[0]; return o ? o.label : id; };
      var spec = printSpec(v, p);
      var lines = [{ label: 'Product', detail: p.label },
                   { label: 'Quantity', detail: Number(v.quantity).toLocaleString('en-US') },
                   { label: 'Size', detail: label('sizes', v.size) },
                   { label: p.stockLabel, detail: label('stocks', v.stock) },
                   { label: 'Printed sides', detail: label('sides', v.sides) }];
      if (p.coatings) lines.push({ label: 'Coating', detail: label('coatings', v.coating) });
      if (p.folds) lines.push({ label: 'Folding', detail: label('folds', v.fold) });
      lines.push({ label: 'Finishing', detail: label('finishing', v.finishing) });
      lines.push({ label: 'Design', detail: { design: 'Designed for you', fix: 'Your file, checked and fixed', ready: 'Your print-ready files' }[v.design] +
        (v.design === 'design' && v.extraRevisions ? ' + ' + v.extraRevisions + ' extra revision round' + (v.extraRevisions === 1 ? '' : 's') : '') });
      lines.push({ label: 'Delivery', detail: v.delivery === 'ship' ? 'Ship to me' : 'Local pickup' });
      if (v.deadlineDays != null) lines.push({ label: 'Needed within', detail: plural(v.deadlineDays, 'day', 'days') });

      // Design labor, kept separate from the order's prep allowance.
      var designH = v.design === 'design' ? c.designHours[v.product] + v.extraRevisions * c.revisionHoursPerRound
                  : v.design === 'fix' ? c.fileFixHours : 0;
      var prepH = c.prepHoursPerOrder;
      var quoteItems = [], notes = [];
      var best = bestPrintQuote(c, spec, v);

      if (best.quote) {
        var q = best.quote, ship = v.delivery === 'ship' ? q.shippingDirect : q.shipping;
        var pending = [];
        if (ship == null) pending.push('Shipping');
        if (q.tax == null) pending.push('Vendor tax');
        if (q.fees == null) pending.push('Vendor fees');
        pending.forEach(function (x) { quoteItems.push({ label: x, reason: 'To be confirmed with the printer before your order.' }); });
        var cost = q.vendorCost + (ship || 0) + (q.tax || 0) + (q.fees || 0) + (prepH + designH) * R();
        var priceLabel = v.design === 'ready' ? 'Estimated printing total'
          : v.design === 'fix' ? 'Estimated file check + printing total' : 'Estimated design + printing total';
        if (pending.length) notes.push('Not yet included: ' + pending.join(' and ').toLowerCase() + '.');
        return { priced: { cost: cost, raw: priceAtMargin(cost, m) }, priceLabel: priceLabel, lines: lines, quoteItems: quoteItems,
                 notes: notes, recurring: [], alternatives: printAlternatives(c, spec, v, designH, m, priceAtMargin(cost, m)),
                 internal: { quote: q, margin: m, laborHours: prepH + designH } };
      }

      quoteItems.push({ label: 'Printing', reason: best.reason });
      if (v.delivery === 'ship') quoteItems.push({ label: 'Delivery', reason: 'Shipping is quoted with the printing.' });
      var alts = printAlternatives(c, spec, v, designH, m, Infinity);
      if (designH > 0) {
        var dCost = designH * R();
        return { priced: { cost: dCost, raw: priceAtMargin(dCost, m) },
                 priceLabel: v.design === 'fix' ? 'Estimated file check price' : 'Estimated design price',
                 partialNote: 'Printing and delivery quoted separately. This amount does not include printing ' +
                   Number(v.quantity).toLocaleString('en-US') + ' ' + (Number(v.quantity) === 1 ? p.label.toLowerCase().replace(/s$/, '') : p.label.toLowerCase()) + '.',
                 lines: lines, quoteItems: quoteItems, notes: notes, recurring: [], alternatives: alts,
                 internal: { margin: m, laborHours: designH } };
      }
      return { quoteOnly: true, lines: lines, quoteItems: quoteItems, notes: notes, recurring: [], alternatives: alts };
    },

    web: function (v, c) {
      var lines = [{ label: 'Web design', detail: plural(v.pages, 'page', 'pages') + ', ' + (v.pageType === 'custom' ? 'fully custom design' : 'customized template') }];
      var quoteItems = [], recurring = [];
      var fixedH = c.setupHours;
      var unitH = c.pageHours[v.pageType];
      [['contactForm', 'Contact form'], ['blog', 'Blog or news section'], ['booking', 'Booking integration'], ['newsletter', 'Newsletter sign-up']].forEach(function (f) {
        if (v[f[0]]) { fixedH += c.featureHours[f[0]]; lines.push({ label: f[1], detail: 'Added' }); }
      });
      if (v.store) quoteItems.push({ label: 'Online store', reason: 'Store scope (products, payments, shipping) needs a conversation.' });
      if (v.content === 'prepare') { unitH += c.contentPrepHoursPerPage; lines.push({ label: 'Content preparation', detail: 'Every page' }); }
      else lines.push({ label: 'Content', detail: 'Provided by you' });
      if (v.extraRevisions) {
        fixedH += v.extraRevisions * c.revision.fixedHours;
        unitH += v.extraRevisions * c.revision.hoursPerPage;
        lines.push({ label: 'Extra revision rounds', detail: String(v.extraRevisions) });
      }
      lines.push({ label: 'Revision rounds', detail: c.revision.includedRounds + ' included' });
      if (v.hosting === 'managed') {
        if (c.hostingCostPerMonth == null) quoteItems.push({ label: 'Hosting', reason: 'Hosting is quoted once the site\'s needs are known.', recurring: true });
        else recurring.push({ label: 'Hosting', monthlyCost: c.hostingCostPerMonth });
      }
      if (v.maintenance !== 'none') {
        recurring.push({ label: v.maintenance === 'basic' ? 'Basic monthly updates' : 'Standard monthly updates',
                         monthlyCost: c.maintenanceHoursPerMonth[v.maintenance] * R() });
      }
      return { fixed: fixedH * R() + c.softwarePerProject, unit: unitH * R(), units: v.pages, threshold: c.threshold,
               lines: lines, quoteItems: quoteItems, recurring: recurring };
    },

    publication: function (v, c) {
      var lines = [{ label: 'Publication design', detail: plural(v.pages, 'interior page', 'interior pages') + ', ' +
        { text: 'mostly text', mixed: 'text with images', design: 'design-heavy' }[v.layout] }];
      var quoteItems = [];
      var fixedH = c.setupHours + v.photos * c.photoPrepHours + v.charts * c.chartHours;
      var unitH = c.layoutHoursPerPage[v.layout];
      if (v.photos) lines.push({ label: 'Photo preparation', detail: plural(v.photos, 'image', 'images') });
      if (v.charts) lines.push({ label: 'Charts and tables', detail: String(v.charts) });
      if (v.cover) { fixedH += c.coverHours; lines.push({ label: 'Cover design', detail: 'Added' }); }
      if (v.extraRevisions) {
        fixedH += v.extraRevisions * c.revision.fixedHours;
        unitH += v.extraRevisions * c.revision.hoursPerPage;
        lines.push({ label: 'Extra revision rounds', detail: String(v.extraRevisions) });
      }
      lines.push({ label: 'Revision rounds', detail: c.revision.includedRounds + ' included' });
      if (v.printing === 'print') {
        if (c.printingCost == null) quoteItems.push({ label: 'Printing', reason: 'Print costs come from a current vendor quote.' });
      } else lines.push({ label: 'Delivery', detail: 'Print-ready and digital files' });
      return { fixed: fixedH * R() + c.softwarePerProject, unit: unitH * R(), units: v.pages, threshold: c.threshold,
               lines: lines, quoteItems: quoteItems, recurring: [] };
    }
  };

  /* ------------------------------------------------------------------ print */

  function printMargin(c) {
    var m = typeof c.margin === 'number' && isFinite(c.margin) ? c.margin : c.allowedMargins[0];
    return Math.max(m, c.minMargin); // never below the 15% minimum
  }

  // The keys that define an exact print specification for this product.
  function printSpec(v, p) {
    var spec = { product: v.product, size: v.size, quantity: Number(v.quantity), stock: v.stock, sides: v.sides, finishing: v.finishing };
    if (p.coatings) spec.coating = v.coating;
    if (p.folds) spec.fold = v.fold;
    return spec;
  }

  function recordTotal(q, v) {
    var ship = v.delivery === 'ship' ? q.shippingDirect : q.shipping;
    return q.vendorCost + (ship || 0) + (q.tax || 0) + (q.fees || 0);
  }

  function meetsDeadline(q, v) {
    return v.deadlineDays == null || (typeof q.deliveryDays === 'number' && q.deliveryDays <= v.deadlineDays);
  }

  // Lowest confirmed total among quotes that match the exact spec (any printing method) and deadline.
  function bestPrintQuote(c, spec, v) {
    var exact = c.vendorQuotes.filter(function (q) {
      return typeof q.vendorCost === 'number' && Object.keys(spec).every(function (k) { return q[k] === spec[k]; });
    });
    if (!exact.length) return { quote: null, reason: 'Needs a current printer quote for this exact specification.' };
    var onTime = exact.filter(function (q) { return meetsDeadline(q, v); });
    if (!onTime.length) return { quote: null, reason: 'No confirmed printing option meets your deadline yet.' };
    onTime.sort(function (a, b) { return recordTotal(a, v) - recordTotal(b, v); });
    return { quote: onTime[0], compared: onTime.length };
  }

  var SPEC_LABELS = { size: 'Size', stock: 'Stock or material', sides: 'Printed sides', coating: 'Coating', fold: 'Folding', finishing: 'Finishing' };

  // Cheaper confirmed options for the same product and quantity that differ in some way.
  function printAlternatives(c, spec, v, designH, m, currentRaw) {
    var p = c.products[spec.product];
    var nameOf = function (key, id) {
      var list = key === 'sides' && p.sidesByStock ? [].concat.apply([], Object.keys(p.sidesByStock).map(function (k) { return p.sidesByStock[k]; }))
        : p[{ size: 'sizes', stock: 'stocks', sides: 'sides', coating: 'coatings', fold: 'folds', finishing: 'finishing' }[key]] || [];
      var o = list.filter(function (x) { return x.id === id; })[0];
      return o ? o.label : id;
    };
    var out = [];
    c.vendorQuotes.forEach(function (q) {
      if (q.product !== spec.product || q.quantity !== spec.quantity || typeof q.vendorCost !== 'number' || !meetsDeadline(q, v)) return;
      var diffs = Object.keys(SPEC_LABELS).filter(function (k) { return k in spec && q[k] !== spec[k]; });
      if (!diffs.length) return;
      var cost = recordTotal(q, v) + (c.prepHoursPerOrder + designH) * R();
      var raw = priceAtMargin(cost, m);
      if (raw >= currentRaw) return;
      var ship = v.delivery === 'ship' ? q.shippingDirect : q.shipping;
      out.push({ price: roundUp9(raw), raw: raw,
                 differences: diffs.map(function (k) { return SPEC_LABELS[k] + ': ' + nameOf(k, q[k]) + ' instead of ' + nameOf(k, spec[k]); }),
                 pending: [ship == null ? 'shipping' : null, q.tax == null ? 'vendor tax' : null, q.fees == null ? 'vendor fees' : null].filter(Boolean) });
    });
    out.sort(function (a, b) { return a.raw - b.raw; });
    // One entry per distinct difference set (the cheapest), at most three.
    var seen = {};
    return out.filter(function (a) { var k = a.differences.join('|'); if (seen[k]) return false; seen[k] = true; return true; })
              .slice(0, 3).map(function (a) { return { price: a.price, differences: a.differences, pending: a.pending }; });
  }

  /* -------------------------------------------------------------- promotion */

  function promotionFor(catId, regular, cost) {
    var p = CFG.promotion;
    if (!p.enabled || p.eligibleCategories.indexOf(catId) < 0 || regular == null) return null;
    var price = Math.round(regular * (100 - p.percentOff)) / 100; // exact; cents allowed
    // An unknown cost can't be shown to stay above cost, so the offer is withheld.
    if (!p.allowBelowCost && (cost == null || price < cost)) return { eligible: false, label: p.label };
    return { eligible: true, label: p.label, price: price, percentOff: p.percentOff };
  }

  /* ------------------------------------------------------------------ quote */

  function quote(catId, raw, opts) {
    opts = opts || {};
    var cat = CFG.categories[catId];
    var res = { category: catId, categoryLabel: cat ? cat.label : '', valid: false, errors: {}, values: {}, addOns: [], notes: [],
                regular: null, promotion: null, lines: [], quoteItems: [], recurring: [], status: 'invalid' };
    var chk = validate(catId, raw);
    res.values = chk.values;
    res.errors = chk.errors;
    if (Object.keys(chk.errors).length) return res;
    res.valid = true;

    var calc = CALC[catId](chk.values, cat);
    res.lines = calc.lines;
    res.quoteItems = calc.quoteItems;
    res.partialNote = calc.partialNote || null;
    res.notes = calc.notes || [];
    res.priceLabel = calc.priceLabel || null;
    res.alternatives = calc.alternatives || [];
    res.addOns = (calc.addOns || []).map(function (a) {
      var out = { label: a.label, detail: a.detail, price: a.price, reason: a.reason || null, promotion: null };
      var p = CFG.promotion;
      if (a.price != null && p.enabled && p.eligibleCategories.indexOf(catId) >= 0 && p.manualPolishEligible)
        out.promotion = { eligible: true, label: p.label, price: Math.round(a.price * (100 - p.percentOff)) / 100 };
      return out;
    });

    var priced = null;
    if (calc.priced) priced = { cost: calc.priced.cost, margin: null, regular: roundUp9(calc.priced.raw), tier: 'itemized' };
    else if (calc.flat) priced = { cost: calc.flat.cost, margin: calc.flat.margin, regular: roundUp9(priceAtMargin(calc.flat.cost, calc.flat.margin)), tier: 'standard' };
    else if (!calc.quoteOnly) priced = priceByVolume(calc.fixed, calc.unit, calc.units, calc.threshold, calc.roundExtraUnitRate);

    res.recurring = calc.recurring.map(function (r) {
      return { label: r.label, monthly: roundUp9(priceAtMargin(r.monthlyCost, CFG.margins.recurring)) };
    });

    if (priced) {
      res.regular = priced.regular;
      res.promotion = promotionFor(catId, priced.regular, priced.cost);
      res.status = res.quoteItems.length || res.partialNote ? 'partial' : 'estimate';
    } else {
      res.status = 'quote';
    }
    if (opts.internal && priced) {
      res.internal = { detail: calc.internal || null, cost: priced.cost, margin: priced.margin, tier: priced.tier, fixed: calc.fixed, unit: calc.unit,
                       units: calc.units, threshold: calc.threshold, baseRegular: priced.baseRegular, extraUnitRate: priced.extraUnitRate };
    }
    return res;
  }

  // Lowest standard price for a category ("from" price on service pages). null = quote only.
  function fromPrice(catId) {
    var cat = CFG.categories[catId];
    if (!cat || !cat.from) return null;
    var r = quote(catId, cat.from);
    return r.status === 'estimate' ? r.regular : null;
  }

  // "From" price for a work page (see config.workPages).
  function workFromPrice(slug) {
    var w = CFG.workPages[slug];
    if (!w) return null;
    if (!w.from) return fromPrice(w.category);
    var r = quote(w.category, Object.assign({}, CFG.categories[w.category].from, w.from));
    return r.status === 'estimate' ? r.regular : null;
  }

  function formatMoney(n) {
    if (n == null || !isFinite(n)) return '';
    var whole = Math.round(n * 100) % 100 === 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  }

  // Plain-text scope summary for the contact form.
  function summaryText(res, extra) {
    extra = extra || {};
    var out = ['Service: ' + res.categoryLabel];
    res.lines.forEach(function (l) { out.push('- ' + l.label + ': ' + l.detail); });
    res.quoteItems.forEach(function (q) { out.push('- ' + q.label + ': needs confirmation (' + q.reason + ')'); });
    res.recurring.forEach(function (r) { out.push('- ' + r.label + ': ' + formatMoney(r.monthly) + ' per month'); });
    res.addOns.forEach(function (a) {
      out.push('- Optional ' + a.label + ': ' + a.detail + (a.price != null ? ', ' + formatMoney(a.price) + ' (confirmed before work starts)' : ', custom quote'));
    });
    if (res.regular != null) {
      out.push((res.priceLabel ? res.priceLabel + ': ' : res.status === 'partial' ? 'Estimated price for the priced items: ' : 'Estimated project price: ') +
        formatMoney(res.regular) + ' (one-time)');
      if (res.partialNote) out.push(res.partialNote);
      if (res.promotion && res.promotion.eligible) out.push(res.promotion.label + ': ' + formatMoney(res.promotion.price));
    }
    (res.notes || []).forEach(function (n) { out.push('Note: ' + n); });
    var cat = CFG.categories[res.category];
    if (extra.termsAcknowledged && cat && cat.terms && cat.acknowledgment)
      out.push('Ticked in the calculator: "' + cat.acknowledgment + '" (' + cat.terms.title + ', version ' + cat.terms.version + ')');
    out.push('(Estimate from the website calculator, ' + CFG.version + '. Final price confirmed after scope review.)');
    return out.join('\n');
  }

  return {
    config: CFG, roundUp9: roundUp9, marginAt: marginAt, priceAtMargin: priceAtMargin, priceByVolume: priceByVolume,
    validate: validate, operatorCharge: operatorCharge, cardMinutes: cardMinutes, rentalDays: rentalDays, cardProblem: cardProblem, kitInfo: kitInfo, fieldLabel: fieldLabel, resetIncompatible: resetIncompatible, printMargin: printMargin, manualPolishPrice: manualPolishPrice, classifyChange: classifyChange, defaults: defaults, optionsFor: optionsFor, maxFor: maxFor, fieldVisible: fieldVisible,
    quote: quote, fromPrice: fromPrice, workFromPrice: workFromPrice, formatMoney: formatMoney, summaryText: summaryText
  };
});
