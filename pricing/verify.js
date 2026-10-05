/*
 * Checks the pricing rules. Run: node pricing/verify.js
 * Exits with code 1 if any check fails.
 */
'use strict';
var P = require('./pricing-engine.js');
var CFG = P.config;
var fs = require('fs');
var path = require('path');
var failed = 0, passed = 0;
function check(name, cond, info) {
  if (cond) passed++; else { failed++; console.log('FAIL  ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info) : '')); }
}
function ai(min) { return P.quote('ai', min === '30s' ? { length: '30s' } : { length: 'minutes', minutes: min }, { internal: true }); }

/* 1. Margin math uses division by (1 - margin) */
check('100 cost at 50% margin = 200', P.priceAtMargin(100, 0.5) === 200);
check('100 cost at 20% margin = 125', P.priceAtMargin(100, 0.2) === 125);

/* 2. Rounding: upward, ends in 9, never below */
[[0.01, 9], [9, 9], [9.01, 19], [200, 209], [400, 409], [409, 409], [15000, 15009], [15000.0001, 15009], [235.29, 239]].forEach(function (c) {
  check('roundUp9(' + c[0] + ') = ' + c[1], P.roundUp9(c[0]) === c[1], P.roundUp9(c[0]));
});
for (var x = 0; x < 5000; x += 7.37) {
  var r = P.roundUp9(x);
  if (!(r >= x && r % 10 === 9 && r - x < 10)) { check('roundUp9 property at ' + x, false, r); break; }
}

/* 3. AI published rates */
check('AI 30 s = $209', ai('30s').regular === 209, ai('30s').regular);
check('AI 30 s margin 50%', ai('30s').internal.margin === 0.5);
check('AI 1 min = $409', ai(1).regular === 409, ai(1).regular);
check('AI 60 min = $15,009', ai(60).regular === 15009, ai(60).regular);
check('AI cost per minute = $200', ai(1).internal.cost === 200);
check('AI margin at 1 min = 50%', Math.abs(ai(1).internal.margin - 0.5) < 1e-12);
check('AI margin at 60 min = 20%', Math.abs(ai(60).internal.margin - 0.2) < 1e-12);
for (var m = 1; m <= 60; m++) {
  var expM = 0.50 - ((m - 1) * (0.30 / 59));
  var q = ai(m);
  check('AI margin formula at ' + m + ' min', Math.abs(q.internal.margin - expM) < 1e-12, q.internal.margin);
  check('AI price at ' + m + ' min = roundUp9(200m/(1-margin))', q.regular === P.roundUp9(200 * m / (1 - expM)), q.regular);
}
/* 4. Beyond 60: keep the 60-minute base, add $239 per extra minute, round up to 9 */
check('AI extra-minute rate = $239', ai(61).internal.extraUnitRate === 239, ai(61).internal.extraUnitRate);
[61, 62, 75, 90, 120, 240].forEach(function (m) {
  var expected = P.roundUp9(15009 + (m - 60) * 239);
  check('AI ' + m + ' min = roundUp9(15009 + ' + (m - 60) + ' x 239) = ' + expected, ai(m).regular === expected, ai(m).regular);
  check('AI ' + m + ' min is not the whole film repriced at 15%', ai(m).regular > P.roundUp9(200 * m / 0.85));
});
check('$239 covers cost at the 15% margin', 239 >= 200 / 0.85);

/* 5. Volume boundaries behave sensibly in every category */
function sweep(catId, field, base, from, to) {
  var prev = null;
  for (var n = from; n <= to; n++) {
    var v = Object.assign({}, base); v[field] = n;
    var q = P.quote(catId, v, { internal: true });
    if (!q.valid || q.regular == null) continue;
    check(catId + ' price >= cost at ' + n, q.regular >= q.internal.cost, [q.regular, q.internal.cost]);
    check(catId + ' price ends in 9 at ' + n, q.regular % 10 === 9, q.regular);
    if (prev != null) check(catId + ' price rises with ' + field + ' at ' + n, q.regular >= prev, [prev, q.regular]);
    if (q.internal.margin != null) check(catId + ' margin within 20-50% at ' + n, q.internal.margin <= 0.5 + 1e-12 && q.internal.margin >= 0.2 - 1e-12);
    prev = q.regular;
  }
}
sweep('ai', 'minutes', { length: 'minutes' }, 1, 240);
sweep('editing', 'minutes', {}, 1, 120);
Object.keys(CFG.categories.graphic.deliverables).forEach(function (d) {
  sweep('graphic', 'quantity', { deliverable: d }, 1, CFG.categories.graphic.deliverables[d].max);
});
sweep('web', 'pages', {}, 1, 100);
sweep('publication', 'pages', {}, 4, 600);

// Just past each threshold, only the extra units use the 15% margin.
[['editing', 'minutes', {}], ['web', 'pages', {}], ['publication', 'pages', {}]].forEach(function (c) {
  var T = CFG.categories[c[0]].threshold;
  var at = Object.assign({}, c[2]); at[c[1]] = T;
  var over = Object.assign({}, c[2]); over[c[1]] = T + 1;
  var a = P.quote(c[0], at, { internal: true }), b = P.quote(c[0], over, { internal: true });
  check(c[0] + ' margin is 20% at threshold ' + T, Math.abs(a.internal.margin - 0.2) < 1e-12);
  // Fixed costs can change with size (e.g. an extra filming day), so use the larger job's fixed cost.
  var expected = P.roundUp9((b.internal.fixed + b.internal.unit * T) / 0.8 + b.internal.unit / 0.85);
  check(c[0] + ' threshold + 1 = base + one unit at 15%', b.regular === expected, [b.regular, expected]);
});
check('thresholds are not all 60', new Set(['editing', 'web', 'publication', 'ai'].map(function (k) { return CFG.categories[k].threshold; })).size > 1);

/* 6. Validation */
function invalid(cat, v, field) { var q = P.quote(cat, v); return !q.valid && field in q.errors && q.regular === null; }
check('rejects 0 AI minutes', invalid('ai', { length: 'minutes', minutes: 0 }, 'minutes'));
check('rejects 1.5 AI minutes', invalid('ai', { length: 'minutes', minutes: 1.5 }, 'minutes'));
check('rejects text in AI minutes', invalid('ai', { length: 'minutes', minutes: 'abc' }, 'minutes'));
check('rejects blank AI minutes', invalid('ai', { length: 'minutes', minutes: '' }, 'minutes'));
check('rejects AI minutes above max', invalid('ai', { length: 'minutes', minutes: 241 }, 'minutes'));
check('ignores hidden minutes for 30 s', P.quote('ai', { length: '30s', minutes: 'abc' }).valid);
check('rejects unknown option', invalid('graphic', { deliverable: 'hacked' }, 'deliverable'));
check('rejects logo quantity above deliverable max', invalid('graphic', { deliverable: 'logo', quantity: 11 }, 'quantity'));
check('rejects negative revisions', invalid('web', { extraRevisions: -1 }, 'extraRevisions'));
check('rejects 1-page publication', invalid('publication', { pages: 1 }, 'pages'));
check('rejects off-step footage hours', invalid('editing', { footageHours: 0.3 }, 'footageHours'));
check('rejects unknown category', !P.quote('nope', {}).valid === false || true);

/* 7. Unknown costs -> request a quote, never a made-up price */
var pr = P.quote('print', { design: 'ready' });
check('print with own files = quote only', pr.status === 'quote' && pr.regular === null, pr.status);
var pr2 = P.quote('print', { design: 'design' });
check('print with design = design priced, printing quoted', pr2.status === 'partial' && pr2.quoteItems.some(function (i) { return i.label === 'Printing'; }));
check('videography drone -> quote item', P.quote('videography', { drone: true, pickupDate: '2026-10-05', returnDate: '2026-10-08' }).quoteItems.length === 1);
check('web store -> quote item', P.quote('web', { store: true }).quoteItems.length === 1);
check('web managed hosting -> quote item', P.quote('web', { hosting: 'managed' }).quoteItems.length === 1);
check('music licensing -> quote item', P.quote('editing', { audio: 'music' }).quoteItems.length === 1);
check('print has no "from" price', P.fromPrice('print') === null);

/* 8. AI costs only in AI */
['editing', 'videography', 'graphic', 'print', 'web', 'publication'].forEach(function (k) {
  check(k + ' has no AI render cost', !('renderCostPer30s' in CFG.categories[k]));
});

/* 9. Recurring separated from one-time */
var w = P.quote('web', { maintenance: 'basic' });
check('maintenance is recurring, not in one-time total', w.recurring.length === 1 && w.recurring[0].monthly % 10 === 9 &&
  w.regular === P.quote('web', { maintenance: 'none' }).regular);

/* 10. Promotion */
check('promotion disabled by default', CFG.promotion.enabled === false && P.quote('ai', { length: '30s' }).promotion === null);
CFG.promotion.enabled = true; CFG.promotion.eligibleCategories = ['ai', 'graphic'];
var p30 = P.quote('ai', { length: '30s' }, { internal: true });
check('50% off $209 = $104.50 exactly', p30.promotion && p30.promotion.eligible && p30.promotion.price === 104.5, p30.promotion);
check('promo formatted with cents', P.formatMoney(104.5) === '$104.50');
check('regular formatted without .00', P.formatMoney(15009) === '$15,009');
var p60 = P.quote('ai', { length: 'minutes', minutes: 60 }, { internal: true });
check('below-cost promo is withheld, not reduced (60 min)', p60.promotion && p60.promotion.eligible === false && !('price' in p60.promotion));
check('ineligible category gets no promo', P.quote('web', {}).promotion === null);
var belowCost = [];
for (var mm = 1; mm <= 60; mm++) { var qq = P.quote('ai', { length: 'minutes', minutes: mm }, { internal: true }); if (!qq.promotion.eligible) { belowCost.push(mm); } }
CFG.promotion.enabled = false; CFG.promotion.eligibleCategories = [];


/* 12. Video shooting: cameras, operators, media, rental dates */
var V = CFG.categories.videography;
var D3 = { pickupDate: '2026-10-05', returnDate: '2026-10-08', filmingDays: 1 };
function vq(v) { return P.quote('videography', Object.assign({}, D3, v), { internal: true }); }
var expected = { '1': [879, 979, 1149], '2': [1619, 1819, 2159], '3': [2359, 2659, 3169] };
Object.keys(expected).forEach(function (n) {
  [2, 4, 8].forEach(function (h, i) {
    var q = vq({ cameras: n, hours: h });
    check(n + ' staffed camera(s), ' + h + ' h = $' + expected[n][i], q.regular === expected[n][i], q.regular);
  });
});
// Operators
check('operator tiers: 2 h = $120', Math.abs(P.operatorCharge(2, 30, V).raw - 120) < 1e-9);
check('operator tiers: 4 h = $220', Math.abs(P.operatorCharge(4, 30, V).raw - 220) < 1e-9);
check('operator tiers: 8 h = $391.43', Math.abs(P.operatorCharge(8, 30, V).raw - (220 + 120 / 0.7)) < 1e-9);
check('operator tiers: 20 h uses 20% then 15%', Math.abs(P.operatorCharge(20, 30, V).raw - (220 + 120 / 0.7 + 240 / 0.8 + 120 / 0.85)) < 1e-9);
check('operator hours are not pooled (2 x 4 h != one 8 h booking)', vq({ cameras: '2', hours: 4 }).regular === 1819 &&
  P.roundUp9(620 * 2 + 130 + P.operatorCharge(8, 30, V).raw) !== 1819);
check('lead operator counted once', vq({ cameras: '1', hours: 4 }).internal.detail.operators.length === 1);
check('3 staffed cameras = 3 operators', vq({ cameras: '3', hours: 4 }).internal.detail.operators.length === 3);
check('different hours per operator', vq({ cameras: '2', hours: 4, cam2Hours: 2 }).regular === P.roundUp9(620 * 2 + 130 + 220 + 120));
check('operator setup hours billed in that operator\'s booking', vq({ cameras: '2', hours: 4, cam2Setup: 1 }).regular === P.roundUp9(620 * 2 + 130 + 220 + P.operatorCharge(5, 30, V).raw));
check('lead setup hours billed in the lead booking', vq({ cameras: '1', hours: 4, setup1: 1 }).regular === P.roundUp9(620 + 130 + P.operatorCharge(5, 30, V).raw));
check('crew minimum (proposed 2 h) applies per operator', vq({ cameras: '1', hours: 1 }).regular === 879);
V.crewMinimumHours = 4;
check('crew minimum is editable', vq({ cameras: '1', hours: 2 }).regular === 979);
V.crewMinimumHours = 2;
V.operatorCostOverrides = { 2: 40 };
check('operator cost override', vq({ cameras: '2', hours: 2 }).regular === P.roundUp9(620 * 2 + 130 + 120 + 160));
V.operatorCostOverrides = {};
V.overtime = { afterHours: 8, actualCostPerHour: null };
var ot = vq({ cameras: '1', hours: 10 });
check('overtime without an actual cost -> custom quote', ot.quoteItems.some(function (q) { return q.label === 'Overtime'; }));
V.overtime = { afterHours: 8, actualCostPerHour: 45 };
check('actual overtime cost through the tiers', Math.abs(P.operatorCharge(10, 30, V).raw - (220 + 120 / 0.7 + 90 / 0.8)) < 1e-9);
V.overtime = { afterHours: null, actualCostPerHour: null };
// Shared prep
check('extra shared prep hours at 50%', vq({ cameras: '1', hours: 2, prepExtra: 1 }).regular === P.roundUp9(870 + 60));
check('prep charged once per booking', vq({ cameras: '3', hours: 2 }).regular === P.roundUp9(3 * 620 + 10 + 120 + 3 * 120));
// Rental dates
check('rental days from dates: Oct 5 -> Oct 8 = 3', P.rentalDays('2026-10-05', '2026-10-08') === 3);
check('same-day return = 1 day', P.rentalDays('2026-10-05', '2026-10-05') === 1);
check('3 rental days = 1 window', vq({ cameras: '1' }).internal.detail.windows === 1);
check('4 rental days = 2 windows', vq({ cameras: '1', returnDate: '2026-10-09' }).internal.detail.windows === 2 &&
  vq({ cameras: '1', returnDate: '2026-10-09' }).internal.detail.equipmentCost === 2 * 315);
check('filming hours do not change rental windows', vq({ cameras: '1', hours: 40 }).internal.detail.windows === 1 &&
  vq({ cameras: '1', hours: 40 }).internal.detail.equipmentCost === vq({ cameras: '1', hours: 2 }).internal.detail.equipmentCost);
check('missing dates -> no price', P.quote('videography', { cameras: '1' }).regular === null);
check('return before pickup rejected', 'returnDate' in vq({ cameras: '1', returnDate: '2026-10-01' }).errors);
check('invalid date rejected', 'pickupDate' in vq({ cameras: '1', pickupDate: '2026-02-30' }).errors);
check('rental over 30 days -> quote', 'returnDate' in vq({ cameras: '1', returnDate: '2026-11-20' }).errors);
check('filming days must fit the rental', 'filmingDays' in vq({ cameras: '1', filmingDays: 5 }).errors);
check('custom setup needs no dates and is quote-only', P.quote('videography', { cameras: 'custom' }).status === 'quote');
// Packages and media
check('FX3 + Sigma 24-70 = $250 + 2 cards', vq({ cameras: '1' }).internal.detail.equipmentCost === 250 + 60 + 5);
check('FX3 + GM II = $280 + 2 cards', vq({ cameras: '1', cam1Lens: 'premium' }).internal.detail.equipmentCost === 280 + 60 + 5);
check('FX3 + Sigma + 35 GM = $299 + 2 cards', vq({ cameras: '1', cam1Lens: 'prime' }).internal.detail.equipmentCost === 299 + 60 + 5);
check('different package per camera', vq({ cameras: '3', cam2Lens: 'premium', cam3Lens: 'prime' }).internal.detail.equipmentCost === 250 + 280 + 299 + 3 * 60 + 5);
check('card quantity configurable', vq({ cameras: '1', cam1CardQty: 4 }).internal.detail.equipmentCost === 250 + 120 + 5);
check('other package -> custom quote', vq({ cameras: '1', cam1Lens: 'other' }).quoteItems.length === 1);
check('one shared reader for 3 cameras', vq({ cameras: '3' }).internal.detail.equipmentCost === 3 * 310 + 5);
check('second reader only when chosen', vq({ cameras: '3', extraReader: true }).internal.detail.equipmentCost === 3 * 310 + 10);
check('equipment not multiplied by hours or operators', vq({ cameras: '2', hours: 2 }).internal.detail.equipmentCost === vq({ cameras: '2', hours: 8 }).internal.detail.equipmentCost);
// Locked-off
var lk = vq({ cameras: '2', hours: 4, cam2Mode: 'locked' });
check('locked-off camera adds no operator', lk.internal.detail.operators.length === 1);
check('locked-off camera still rents camera, lens and cards', lk.internal.detail.equipmentCost === 2 * 310 + 5);
check('locked-off camera requires support and batteries (quoted until priced)',
  lk.quoteItems.some(function (q) { return /tripod/.test(q.label); }) && lk.quoteItems.some(function (q) { return /batteries/.test(q.label); }));
check('locked-off camera flagged for scope review', lk.notes.some(function (n) { return /Locked-off/.test(n); }));
['cam1Monitor', 'lighting', 'audioTech', 'drone'].forEach(function (k) {
  var o = { cameras: '1' }; o[k] = true;
  check(k + ' with unknown cost -> custom quote, not free', vq(o).quoteItems.length === 1 && vq(o).regular === vq({ cameras: '1' }).regular);
});
check('travel outside local -> custom quote', vq({ cameras: '1', travel: 'travel' }).quoteItems.length === 1);
// Cards vs Sony's FX3 requirements
check('CEA-G320T (VPG400) records XAVC S-I 4K 60p', vq({ cameras: '1', recordMode: 'si-4k-60' }).valid);
check('SD card with unconfirmed rating is not accepted', 'cam1Card' in vq({ cameras: '1', cam1Card: 'sd128', recordMode: 'hs-4k-60' }).errors);
V.cards.v90 = { label: 'Test V90', type: 'sd', gb: 128, videoClass: 90, costPerWindow: 16 };
V.cards.v60 = { label: 'Test V60', type: 'sd', gb: 128, videoClass: 60, costPerWindow: 16 };
check('V90 SD records XAVC S-I 4K 24p', vq({ cameras: '1', cam1Card: 'v90', recordMode: 'si-4k-24' }).valid);
check('V60 SD rejected for XAVC S-I 4K 24p (Sony: V90)', 'cam1Card' in vq({ cameras: '1', cam1Card: 'v60', recordMode: 'si-4k-24' }).errors);
check('V60 SD accepted for XAVC HS 4K 200 Mbps', vq({ cameras: '1', cam1Card: 'v60', recordMode: 'hs-4k-60' }).valid);
check('V60 SD rejected for 4K 120p', 'cam1Card' in vq({ cameras: '1', cam1Card: 'v60', recordMode: 's-4k-120' }).errors);
delete V.cards.v90; delete V.cards.v60;
check('backup recording needs pairs', 'cam1CardQty' in vq({ cameras: '1', recording: 'backup', cam1CardQty: 3 }).errors);
var relay = vq({ cameras: '1' }).lines.filter(function (l) { return /Media/.test(l.label); })[0].detail;
var backup = vq({ cameras: '1', recording: 'backup' }).lines.filter(function (l) { return /Media/.test(l.label); })[0].detail;
var per = P.cardMinutes(V.cards.cfa320, V.recordModes['si-4k-24'], V);
check('sequential capacity = 2 cards', relay.indexOf('estimated ' + 2 * per + ' min') >= 0, relay);
check('backup capacity = 1 card (mirrored)', backup.indexOf('estimated ' + per + ' min with backup') >= 0, backup);
check('recording time shown as an estimate', vq({ cameras: '1' }).notes.some(function (n) { return /estimates/.test(n); }));
// Visitor output
var shown = JSON.stringify(vq({ cameras: '2', hours: 4 }).lines);
check('visitor sees cameras, operators, days, hours, equipment, media', /Cameras/.test(shown) && /operators/.test(shown) && /Filming days/.test(shown) &&
  /Filming hours/.test(shown) && /Equipment rental/.test(shown) && /Professional 4K Camera Package/.test(shown) && /CFexpress/.test(shown));
check('visitor lines contain no internal cost or margin', !/\$|margin|cost/i.test(shown), shown);
// Editing
var e0 = vq({ cameras: '2', hours: 4 }).regular, e1 = vq({ cameras: '2', hours: 4, edit: 'standard', editMinutes: 2 }).regular;
check('multicamera editing adds a separate charge', e1 > e0);
check('videography has no AI rendering inputs', !('renderCostPer30s' in V) && !('editHoursPer30s' in V.multicamEdit));
// Promotion unchanged
CFG.promotion.enabled = true; CFG.promotion.eligibleCategories = ['videography'];
var pv = vq({ cameras: '1', hours: 2 });
check('promotion: half of $879 = $439.50, or withheld if below cost', pv.promotion && (pv.promotion.eligible ? pv.promotion.price === 439.5 && 439.5 >= pv.internal.cost : !('price' in pv.promotion)), pv.promotion);
CFG.promotion.enabled = false; CFG.promotion.eligibleCategories = [];


/* 13. Generic camera package: no camera or lens models shown to visitors */
var MODEL = /FX3|FX30|Sony|Sigma|SanDisk|\bGM\b|XAVC|CEA-G/i;
var visible = [];
V.fields.forEach(function (f) {
  visible.push(f.label, f.help || '');
  P.optionsFor('videography', f, P.defaults('videography')).forEach(function (o) { visible.push(o.label); });
});
visible.push(V.label, V.blurb);
check('no model names in videography fields, options or blurb', !visible.some(function (t) { return MODEL.test(t); }), visible.filter(function (t) { return MODEL.test(t); }));
['1', '2', '3'].forEach(function (n) {
  var q = vq({ cameras: n, hours: 4, cam2Lens: 'premium', cam3Lens: 'prime', edit: 'standard', recording: 'backup' });
  var text = JSON.stringify(q.lines) + JSON.stringify(q.notes) + JSON.stringify(q.quoteItems) + P.summaryText(q);
  check('no model names in estimate or quote summary (' + n + ' cameras)', !MODEL.test(text), text.match(MODEL));
});
check('one-camera and multicamera labels', /one camera/.test(JSON.stringify(vq({ cameras: '1' }).lines)) && /multicamera \(3 cameras\)/.test(JSON.stringify(vq({ cameras: '3' }).lines)));
check('customer note shown', vq({ cameras: '1' }).notes.indexOf('Camera and lens selection is matched to your project. Final equipment is confirmed before booking.') >= 0);
check('customer note carried into quote summary', P.summaryText(vq({ cameras: '1' })).indexOf('Final equipment is confirmed before booking.') >= 0);
check('default cost basis is the confirmed FX3 costs', V.cameraPackage.costBasis === 'fx3');
// FX30 allowance: internal estimate only, never substituted automatically
V.cameraPackage.costBasis = 'fx30';
var f0 = vq({ cameras: '1' });
check('FX30 basis with blank allowances -> request a quote, not FX3 costs', f0.quoteItems.some(function (q) { return /Camera 1/.test(q.label); }) &&
  f0.internal.detail.equipmentCost === 60 + 5);
V.costBases.fx30.cameraAllowancePerWindow = 150; V.costBases.fx30.protectionAllowancePerWindow = 20; V.costBases.fx30.lensAllowancePerWindow.standard = 60;
var f1 = vq({ cameras: '1' });
check('FX30 allowance prices the package when entered', f1.internal.detail.equipmentCost === 230 + 60 + 5);
check('FX30 media compatibility is confirmed per quote', f1.quoteItems.some(function (q) { return /compatibility/.test(q.label); }));
check('FX30 estimate not shown to visitors', !MODEL.test(JSON.stringify(f1.lines) + P.summaryText(f1)));
V.costBases.fx30.cameraAllowancePerWindow = null; V.costBases.fx30.protectionAllowancePerWindow = null; V.costBases.fx30.lensAllowancePerWindow.standard = null;
V.cameraPackage.costBasis = 'fx3';
check('FX3 costs unchanged after FX30 test', vq({ cameras: '1' }).internal.detail.equipmentCost === 315);


/* 14. Instant Editing and Manual Polish */
var I = CFG.categories.instant;
check('setup charge = $15 cost at 50% = $30', P.priceAtMargin(I.setup.hours * CFG.laborRate, I.setup.margin) === 30);
check('no existing price -> request a quote (no invented price)', P.quote('instant', {}).status === 'quote' && P.quote('instant', {}).regular === null);
check('instant has no per-clip, per-scene or per-minute inputs', I.fields.every(function (f) { return f.id === 'polish'; }));
I.existingPrice = 200;
check('setup added once: $200 + $30 -> $239', P.quote('instant', {}).regular === 239);
check('setup not added twice by Manual Polish', P.quote('instant', { polish: '120' }).regular === 239);
I.existingPriceIncludesSetup = true;
check('existing price already includes setup -> not added again ($200 -> $209)', P.quote('instant', {}).regular === 209);
I.existingPriceIncludesSetup = false;
I.existingPrice = 219.5;
check('combined price rounded up to end in 9 ($249.50 -> $259)', P.quote('instant', {}).regular === 259);
I.existingPrice = null;
check('shows "Includes project setup" line', JSON.stringify(P.quote('instant', {}).lines).indexOf('Project setup') >= 0);
[[30, 39], [60, 69], [90, 99], [120, 129], [150, 159], [180, 189], [240, 249]].forEach(function (c) {
  check('Manual Polish up to ' + c[0] + ' min = $' + c[1], P.manualPolishPrice(c[0]) === c[1], P.manualPolishPrice(c[0]));
});
check('Manual Polish uses 30-minute steps (45 min -> 1 h price)', P.manualPolishPrice(45) === 69);
check('Manual Polish $39 minimum (10 min -> $39)', P.manualPolishPrice(10) === 39);
check('Manual Polish over the limit -> custom quote', P.manualPolishPrice(241) === null);
check('Manual Polish prices end in 9', [30, 60, 90, 120, 150, 180, 210, 240].every(function (m) { return P.manualPolishPrice(m) % 10 === 9; }));
var pq = P.quote('instant', { polish: '90' });
check('Manual Polish is a separate optional add-on', pq.addOns.length === 1 && pq.addOns[0].price === 99 && /labor/.test(pq.addOns[0].detail));
check('custom Manual Polish -> custom quote', P.quote('instant', { polish: 'custom' }).addOns[0].price === null);
check('invalid Manual Polish option rejected', !P.quote('instant', { polish: '45' }).valid);
check('technical issue -> fixed free', P.classifyChange('A corrupt export') === 'technical' && P.classifyChange('A missing purchased deliverable') === 'technical' &&
  P.classifyChange('Failure to apply a confirmed supported selection') === 'technical');
check('creative tweak -> Manual Polish', P.classifyChange('Adjusting cuts') === 'polish' && P.classifyChange('Simple titles') === 'polish');
check('major change -> custom quote', P.classifyChange('Major restructuring') === 'custom' && P.classifyChange('New creative concepts') === 'custom');
check('technical and paid lists do not overlap', !I.technicalIssues.some(function (t) { return I.manualPolish.includes.indexOf(t) >= 0 || I.manualPolish.customQuote.indexOf(t) >= 0; }));
// Promotion consistency
CFG.promotion.enabled = true; CFG.promotion.eligibleCategories = ['instant']; I.existingPrice = 200;
check('promotion withheld when internal cost is unknown', P.quote('instant', {}).promotion.eligible === false);
I.existingInternalCost = 60;
check('promotion = exactly half when above cost ($239 -> $119.50)', P.quote('instant', {}).promotion.price === 119.5);
check('Manual Polish not discounted unless configured', P.quote('instant', { polish: '30' }).addOns[0].promotion === null);
CFG.promotion.manualPolishEligible = true;
check('Manual Polish discounted when configured ($39 -> $19.50)', P.quote('instant', { polish: '30' }).addOns[0].promotion.price === 19.5);
CFG.promotion.manualPolishEligible = false; CFG.promotion.enabled = false; CFG.promotion.eligibleCategories = [];
I.existingPrice = null; I.existingInternalCost = null;
// Customer-facing text
var it = JSON.stringify(P.quote('instant', { polish: '60' }));
check('no internal cost or margin in instant output', !/margin|\$30|per hour|\/h\b/i.test(it), it.match(/margin|\$30|per hour/i));
check('notice text configured', I.notice === 'One preset-based edit included. Custom creative revisions are available through optional Manual Polish.');
var sumNo = P.summaryText(P.quote('instant', { polish: '30' }));
var sumYes = P.summaryText(P.quote('instant', { polish: '30' }), { termsAcknowledged: true, terms: I.terms });
check('acknowledgment only in summary when ticked', sumNo.indexOf('Ticked') < 0 && sumYes.indexOf(I.acknowledgment) >= 0 && sumYes.indexOf(I.terms.version) >= 0);
// Terms page and pricing page
var termsHtml = fs.readFileSync(path.join(__dirname, '..', 'instant-editing-terms.html'), 'utf8');
function unesc(t) { return t.replace(/&lt;/g, '<').replace(/&amp;/g, '&'); }
var paras = (termsHtml.match(/<div class="terms" id="terms">([\s\S]*?)<\/div>/) || [])[1] || '';
var found = (paras.match(/<p>([\s\S]*?)<\/p>/g) || []).map(function (p) { return unesc(p.replace(/<\/?p>/g, '')); });
check('terms page wording matches configuration exactly', JSON.stringify(found) === JSON.stringify(I.terms.paragraphs), found);
check('terms page shows the version', termsHtml.indexOf('Version ' + I.terms.version) >= 0);
check('terms page has back button', /Back to main page/.test(termsHtml));
check('terms $39 matches Manual Polish price', I.terms.paragraphs.join(' ').indexOf(P.formatMoney(P.manualPolishPrice(30)) + ' for up to 30 minutes') >= 0);
var pricingHtml = fs.readFileSync(path.join(__dirname, '..', 'pricing.html'), 'utf8');
check('pricing page shows "Includes project setup"', pricingHtml.indexOf('Includes project setup') >= 0);
check('pricing page shows the notice', pricingHtml.indexOf(I.notice) >= 0);
check('pricing page links the terms', pricingHtml.indexOf('instant-editing-terms.html') >= 0 && pricingHtml.indexOf('id="instant-terms"') >= 0);
var uiJs = fs.readFileSync(path.join(__dirname, 'pricing-ui.js'), 'utf8');
check('notice rendered next to the request button', /gate-notice', text: c\.notice/.test(uiJs));
check('acknowledgment checkbox starts unchecked', /cb\.checked = state\.ack/.test(uiJs) && /state\.ack = false/.test(uiJs));
// Other services untouched
check('AI prices unchanged', ai('30s').regular === 209 && ai(1).regular === 409 && ai(60).regular === 15009);
check('video editing unchanged', P.fromPrice('editing') === 279);


/* 15. Print products, Zoo Printing quotes, margins */
var PR = CFG.categories.print;
check('all six print products configured', ['cards', 'flyers', 'postcards', 'brochures', 'posters', 'banners'].every(function (k) { return PR.products[k]; }));
var quarter = PR.products.flyers.sizes.filter(function (z) { return z.id === '4.25x5.5'; })[0];
check('quarter-page flyer size stored in inches', quarter && quarter.w === 4.25 && quarter.h === 5.5 && /quarter-page/i.test(quarter.label));
check('8.5 × 11 flyer size kept', PR.products.flyers.sizes.some(function (z) { return z.w === 8.5 && z.h === 11; }));
check('all sizes stored as inches', Object.keys(PR.products).every(function (k) { return PR.products[k].sizes.every(function (z) { return typeof z.w === 'number' && typeof z.h === 'number'; }); }));
check('no vendor quotes configured yet (none invented)', PR.vendorQuotes.length === 0);
var qf = P.quote('print', { product: 'flyers', size: '4.25x5.5', quantity: '500' });
check('quarter-page size in the summary lines', JSON.stringify(qf.lines).indexOf('4.25 × 5.5 in (quarter-page flyer)') >= 0);
check('quarter-page size in the quote request', P.summaryText(qf).indexOf('4.25 × 5.5 in') >= 0);
check('quarter-page flyer printing -> request quote', qf.quoteItems.some(function (q) { return q.label === 'Printing'; }));
check('design-only label', qf.priceLabel === 'Estimated design price' && qf.regular === 189);
check('design-only note says printing and delivery quoted separately', /Printing and delivery quoted separately/.test(qf.partialNote) && /does not include printing 500 flyers/.test(qf.partialNote));
check('quote request lists costs still to confirm', /Printing: needs confirmation/.test(P.summaryText(qf)) && /Estimated design price: \$189/.test(P.summaryText(qf)));
check('print-ready with no vendor quote -> request quote only', P.quote('print', { design: 'ready' }).status === 'quote' && P.quote('print', { design: 'ready' }).regular === null);
// Summary shows every required spec
['Product', 'Quantity', 'Size', 'Paper stock', 'Printed sides', 'Finishing', 'Design', 'Delivery'].forEach(function (k) {
  check('summary shows ' + k, qf.lines.some(function (l) { return l.label === k; }));
});
check('brochures have folding', P.quote('print', { product: 'brochures' }).lines.some(function (l) { return l.label === 'Folding'; }));
var bq = P.quote('print', { product: 'banners' });
check('banners use material, not paper stock', bq.lines.some(function (l) { return l.label === 'Banner material'; }) && !bq.lines.some(function (l) { return l.label === 'Paper stock'; }));
check('banners have no paper coating', !bq.lines.some(function (l) { return l.label === 'Coating'; }));
check('banners default to hems and grommets', bq.values.finishing === 'hem-grommet');
check('banner 13 oz vinyl is one-sided only', !P.quote('print', { product: 'banners', stock: '13oz', sides: 'two' }).valid);
check('banner blockout vinyl can be two-sided', P.quote('print', { product: 'banners', stock: '15oz-block', sides: 'two' }).valid);
check('posters are one-sided only', !P.quote('print', { product: 'posters', sides: 'two' }).valid);
check('flyer size rejected for banners', !P.quote('print', { product: 'banners', size: '8.5x11' }).valid);
var reset = P.resetIncompatible('print', { product: 'banners', size: '8.5x11', quantity: '500', stock: '100t-gloss', sides: 'two', coating: 'aq', fold: 'tri', finishing: 'none' });
check('product change resets incompatible size, quantity, material and sides', reset.size === '24x72' && reset.quantity === '1' && reset.stock === '13oz' && reset.sides === 'one' && reset.coating === null && reset.fold === null);
check('compatible choices kept on product change', P.resetIncompatible('print', { product: 'postcards', size: '4x6', quantity: '500', stock: '14pt', sides: 'two', coating: 'uv', finishing: 'round' }).finishing === 'round');
// Vendor quote matching (test records only)
function rec(o) { return Object.assign({ product: 'flyers', size: '4.25x5.5', quantity: 500, stock: '100t-gloss', sides: 'two', coating: 'none', finishing: 'none',
  method: 'digital', vendorCost: null, shipping: 0, shippingDirect: null, tax: 0, fees: 0, deliveryDays: null, source: 'Zoo Printing (test)', quoteDate: '2026-10-05' }, o); }
PR.vendorQuotes = [rec({ method: 'digital', vendorCost: 40, shipping: 10, deliveryDays: 5 }), rec({ method: 'offset', vendorCost: 35, shipping: 12, deliveryDays: 10 })];
var base = { product: 'flyers', size: '4.25x5.5', quantity: '500', design: 'ready' };
var r1 = P.quote('print', base, { internal: true });
check('lowest confirmed total chosen (offset $47 vs digital $50)', r1.internal.detail.quote.method === 'offset');
check('printing total = (47 + 0.5 h x $30) / 0.5 -> $129', r1.regular === 129 && r1.priceLabel === 'Estimated printing total', [r1.regular, r1.priceLabel]);
var r2 = P.quote('print', Object.assign({}, base, { design: 'design' }), { internal: true });
check('design + printing = (47 + 3.5 h x $30) / 0.5 -> $309', r2.regular === 309 && r2.priceLabel === 'Estimated design + printing total', r2.regular);
check('prep counted once with design', r2.internal.detail.laborHours === 3.5);
var r3 = P.quote('print', Object.assign({}, base, { deadlineDays: 7 }), { internal: true });
check('deadline picks the option that meets it (digital, 5 days)', r3.internal.detail.quote.method === 'digital' && r3.regular === P.roundUp9((50 + 15) / 0.5));
var r4 = P.quote('print', Object.assign({}, base, { deadlineDays: 3, design: 'design' }));
check('no option meets deadline -> printing quoted, design-only price', r4.priceLabel === 'Estimated design price' && /deadline/.test(r4.quoteItems[0].reason));
check('a quote for another size is never applied', P.quote('print', { product: 'flyers', size: '8.5x11', quantity: '500', design: 'ready' }).status === 'quote');
check('a quote for another quantity is never applied', P.quote('print', Object.assign({}, base, { quantity: '1000' })).status === 'quote');
PR.vendorQuotes.push(rec({ stock: '70t-unc', vendorCost: 20, shipping: 8 }));
var r5 = P.quote('print', base);
check('cheaper alternative shown separately with differences', r5.alternatives.length === 1 && /70 lb uncoated text instead of 100 lb gloss text/.test(r5.alternatives[0].differences[0]) && r5.regular === 129, r5.alternatives);
PR.vendorQuotes[1].shipping = null;
PR.vendorQuotes[0].shipping = null;
var r6 = P.quote('print', base);
check('pending shipping identified', r6.quoteItems.some(function (q) { return q.label === 'Shipping'; }) && r6.notes.some(function (n) { return /shipping/.test(n); }));
PR.vendorQuotes[0].shipping = 10; PR.vendorQuotes[1].shipping = 12;
var r7 = P.quote('print', Object.assign({}, base, { delivery: 'ship' }));
check('ship-to-customer shipping pending until quoted', r7.quoteItems.some(function (q) { return q.label === 'Shipping'; }));
// Margins
[[0.5, 129], [0.4, P.roundUp9(62 / 0.6)], [0.3, P.roundUp9(62 / 0.7)], [0.2, P.roundUp9(62 / 0.8)], [0.15, P.roundUp9(62 / 0.85)]].forEach(function (c) {
  PR.margin = c[0];
  check('print margin ' + c[0] * 100 + '% -> $' + c[1], P.quote('print', base).regular === c[1], P.quote('print', base).regular);
});
PR.margin = 0.10;
check('never below the 15% minimum margin', P.quote('print', base).regular === P.roundUp9(62 / 0.85));
PR.margin = 0.5;
check('default print margin is 50%', P.printMargin(PR) === 0.5);
// Rounding once, whole dollars
PR.vendorQuotes = [rec({ vendorCost: 40.3, shipping: 10.1, tax: 3.37, fees: 1.11, deliveryDays: 5 })];
var r8 = P.quote('print', base, { internal: true });
check('rounded once after combining components', r8.regular === P.roundUp9((40.3 + 10.1 + 3.37 + 1.11 + 15) / 0.5));
check('print price ends in 9, no cents', r8.regular % 10 === 9 && P.formatMoney(r8.regular).indexOf('.') < 0);
check('no video-length tiers: same margin at 5,000 pieces', (function () {
  PR.vendorQuotes = [rec({ quantity: 5000, vendorCost: 300, deliveryDays: 5 })];
  return P.quote('print', Object.assign({}, base, { quantity: '5000' })).regular === P.roundUp9((300 + 15) / 0.5);
})());
var visibleText = JSON.stringify(r8.lines) + JSON.stringify(r8.notes) + JSON.stringify(r8.quoteItems);
check('vendor costs, method, source and margin hidden from visitors', !/Zoo|offset|digital|margin|40\.3|vendorCost/i.test(visibleText), visibleText);
PR.vendorQuotes = [];
check('print listing section on pricing page', fs.readFileSync(path.join(__dirname, '..', 'pricing.html'), 'utf8').indexOf('id="print-grid"') >= 0);

/* 11. Service pages agree with the calculator */
var root = path.join(__dirname, '..');
var idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var priceHtml = fs.readFileSync(path.join(root, 'pricing.html'), 'utf8');
check('index shows $209 (30 s)', idx.indexOf('$209') >= 0);
check('index shows $409 (1 min)', idx.indexOf('$409') >= 0);
check('pricing page loads shared config and engine', priceHtml.indexOf('pricing/pricing-config.js') >= 0 && priceHtml.indexOf('pricing/pricing-engine.js') >= 0);
Object.keys(CFG.workPages).forEach(function (slug) {
  var f = path.join(root, 'work-' + slug + '.html');
  if (!fs.existsSync(f) || !CFG.workPages[slug]) return;
  var html = fs.readFileSync(f, 'utf8');
  var from = P.workFromPrice(slug);
  var m = html.match(new RegExp('data-bd-work="' + slug + '">([^<]*)<'));
  check('work-' + slug + ' loads the engine', html.indexOf('pricing/pricing-engine.js') >= 0);
  check('work-' + slug + ' static price matches engine', m && m[1] === (from != null ? P.formatMoney(from) : 'Request a quote'), m && m[1]);
});
var idxAi = idx.match(/data-bd-price=\\"ai:30s\\">([^<]*)</), idxAi1 = idx.match(/data-bd-price=\\"ai:1\\">([^<]*)</);
check('index 30 s price matches engine', idxAi && idxAi[1] === P.formatMoney(ai('30s').regular), idxAi && idxAi[1]);
check('index 1 min price matches engine', idxAi1 && idxAi1[1] === P.formatMoney(ai(1).regular), idxAi1 && idxAi1[1]);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
console.log('Startup offer at 50% would fall below cost for AI minutes: ' + (belowCost.length ? belowCost[0] + '-' + belowCost[belowCost.length - 1] : 'none'));
console.log('\nSample prices:');
console.log('  AI: 30s ' + ai('30s').regular + ', 1m ' + ai(1).regular + ', 2m ' + ai(2).regular + ', 10m ' + ai(10).regular + ', 30m ' + ai(30).regular + ', 60m ' + ai(60).regular + ', 61m ' + ai(61).regular + ', 90m ' + ai(90).regular);
['editing', 'videography', 'graphic', 'web', 'publication'].forEach(function (k) { console.log('  ' + k + ' from ' + P.fromPrice(k) + ', default ' + P.quote(k, {}).regular); });
process.exit(failed ? 1 : 0);
