/*
 * Bates Digital pricing configuration: the single source of truth for every price on the site.
 *
 * Every page that shows a price (pricing.html, index.html, the work-*.html pages) and the
 * visitor calculator read these numbers through pricing-engine.js. Change a value here and
 * every price updates.
 *
 * Status markers:
 *   CONFIRMED  - a rule or cost you have supplied.
 *   ASSUMPTION - a starting value chosen to make the calculator work. Replace it with your
 *                own numbers. Nothing marked ASSUMPTION is a verified cost.
 *   null       - an unknown cost (vendor quotes, rentals, shipping, hosting). Any selection
 *                that depends on a null value shows "Request a quote" instead of a price.
 *
 * Pricing method (CONFIRMED):
 *   labor cost     = hours x laborRate
 *   total cost     = labor + materials + vendor/printing + software/AI allocation + other direct costs
 *   customer price = total cost / (1 - target margin), rounded UP to a whole dollar ending in 9
 *
 * Volume margin (CONFIRMED shape, per-category thresholds are ASSUMPTIONS except AI video):
 *   units 1..threshold : margin = start - (units - 1) x (start - volumeFloor) / (threshold - 1)
 *   above threshold    : the threshold price is kept, and only the extra units are priced
 *                        at the additional-volume margin.
 *
 * NOTE: this site has no server, so this file is downloaded by visitors' browsers along with
 * the calculator. Anyone who opens the page source can read it. See the summary for options.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BD_PRICING = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    version: '2026-10-05',
    currency: 'USD',

    laborRate: 30, // CONFIRMED: internal cost per hour, not a billing rate

    margins: {
      start: 0.50,        // CONFIRMED: small projects
      volumeFloor: 0.20,  // CONFIRMED: standard volume pricing declines toward this
      additional: 0.15,   // CONFIRMED: only for units beyond a category's threshold
      recurring: 0.50     // ASSUMPTION: margin on monthly services
    },

    promotion: {
      enabled: false, // Keep off until eligible services and economics are confirmed.
      label: 'STARTUP PRICES — 50% OFF FOR NEW CUSTOMERS',
      percentOff: 50,
      eligibleCategories: [], // e.g. ['graphic']. Empty = no service is eligible.
      // If the discounted price would fall below total project cost, the offer is not shown
      // for that estimate. It is never replaced with a smaller discount.
      allowBelowCost: false,
      // Whether Manual Polish is discounted when Instant Editing is eligible. Disclosed to visitors.
      manualPolishEligible: false
    },

    categories: {
      /* ------------------------------------------------------------------ AI VIDEO */
      ai: {
        label: 'AI video',
        blurb: 'Generated scenes, b-roll and commercials without a shoot.',
        unit: 'finished minutes',
        renderCostPer30s: 10,   // CONFIRMED
        editHoursPer30s: 3,     // CONFIRMED
        threshold: 60,          // CONFIRMED: 50% at 1 minute down to 20% at 60 minutes
        roundExtraUnitRate: true, // CONFIRMED: published +$239 per minute beyond 60
        maxMinutes: 240,        // ASSUMPTION: longer projects -> request a quote
        softwarePerProject: 0,  // the $10 per 30 s rendering cost already covers AI usage
        fields: [
          { id: 'length', label: 'Length', type: 'select', default: 'minutes', options: [
            { value: '30s', label: '30-second spot' },
            { value: 'minutes', label: 'Whole minutes' }
          ] },
          { id: 'minutes', label: 'Finished minutes', type: 'int', min: 1, max: 240, default: 1,
            help: 'Whole minutes of finished video.', showIf: { field: 'length', equals: 'minutes' } }
        ],
        from: { length: '30s' },
        publishedRates: [ '30s', 1, 2, 5, 10, 30, 60, 61, 90, 120 ]
      },

      /* ---------------------------------------------- INSTANT EDITING (Insta-Video Edit) */
      // Standardized instant music video built with the automated editing workflow.
      // Standard price per video = existing Instant Editing price + project setup charge
      // (setup added once per video, never per clip, scene or minute), rounded up to end in 9.
      instant: {
        label: 'Instant Editing',
        blurb: 'Insta-Video Edit: an instant music video assembled from your footage and music.',
        // The existing Instant Editing price (customer price per video, before setup).
        // NOT FOUND in this project: enter it here. While null, the service shows "Request a quote".
        existingPrice: null,
        existingPriceIncludesSetup: false, // true = the existing price already covers setup; don't add it again
        existingInternalCost: null,        // internal cost behind existingPrice (used only for the promotion's below-cost check)
        setup: { hours: 0.5, margin: 0.50 }, // CONFIRMED: $15 cost -> $30 customer charge per video
        // Optional Manual Polish: an allowance of manual editing LABOR (not finished-video length).
        manualPolish: {
          margin: 0.50,              // CONFIRMED: $30/h cost -> $60/h before rounding
          incrementMinutes: 30,      // CONFIRMED
          minimumPrice: 39,          // CONFIRMED
          maxMinutes: 240,           // ASSUMPTION: larger requests -> custom editing quote
          includes: ['Replacing selected shots', 'Adjusting cuts', 'Changing effect intensity', 'Simple titles',
                     'Basic color adjustments within the existing edit'],
          customQuote: ['Major restructuring', 'Extensive footage review', 'Advanced effects', 'New creative concepts',
                        'Substantial resynchronization']
        },
        // Fixed at no charge, without a Manual Polish purchase.
        technicalIssues: ['A corrupt export', 'A missing purchased deliverable', 'Failure to apply a confirmed supported selection'],
        // Customer-facing terms, word for word. instant-editing-terms.html must match (checked by verify.js).
        // Change the version whenever the wording changes.
        terms: {
          title: 'Instant Editing Service Terms', version: '2026-10-05', url: 'instant-editing-terms.html',
          paragraphs: [
            'Instant Editing is a standardized service that uses an automated editing workflow optimized for this product. Your video is assembled from the footage, music, and supported options you provide.',
            'The standard price includes project setup and one delivered edit. Creative choices\u2014including shot selection, pacing, transitions, effects, and color treatment\u2014follow the service\u2019s preset workflow.',
            'The delivered edit is provided as-is for creative preferences. Custom revisions and manual creative adjustments are not included unless purchased separately.',
            'The service works best when your files follow our upload instructions and footage requirements. Poor lighting, blurry footage, missing coverage, unsuitable audio, or incomplete uploads may limit the result.',
            'A corrupt export, missing purchased deliverable, or failure to apply a confirmed supported selection is a technical delivery issue. We will correct these issues without requiring a Manual Polish purchase.',
            'Optional Manual Polish starts at $39 for up to 30 minutes of additional editing labor. We confirm the requested changes and price before starting. Work beyond the purchased allowance requires a separate approved quote.',
            'You must have permission to use the footage, music, logos, and other materials you submit. You retain your rights to your submitted materials.',
            'These terms do not limit rights or remedies that cannot be waived under applicable law.'
          ]
        },
        notice: 'One preset-based edit included. Custom creative revisions are available through optional Manual Polish.',
        acknowledgment: 'I understand that Instant Editing delivers one preset-based edit and that custom creative revisions cost extra.',
        fields: [
          { id: 'polish', label: 'Manual Polish (optional)', type: 'select', default: '0', help:
            'Extra manual editing time on top of your preset edit, priced in 30-minute steps. It is editing labor, not video length.',
            options: [
              { value: '0', label: 'No Manual Polish' },
              { value: '30', label: 'Up to 30 minutes of editing' },
              { value: '60', label: 'Up to 1 hour of editing' },
              { value: '90', label: 'Up to 1.5 hours of editing' },
              { value: '120', label: 'Up to 2 hours of editing' },
              { value: '150', label: 'Up to 2.5 hours of editing' },
              { value: '180', label: 'Up to 3 hours of editing' },
              { value: '210', label: 'Up to 3.5 hours of editing' },
              { value: '240', label: 'Up to 4 hours of editing' },
              { value: 'custom', label: 'Bigger changes: custom editing quote' }
            ] }
        ],
        from: { polish: '0' }
      },

      /* ------------------------------------------------------------- VIDEO EDITING */
      editing: {
        label: 'Video editing',
        blurb: 'Your footage, edited into a finished video.',
        unit: 'finished minutes',
        threshold: 30,              // ASSUMPTION
        setupHours: 2,              // ASSUMPTION: ingest, organize, project setup
        reviewHoursPerFootageHour: 1, // ASSUMPTION: watching and logging raw footage
        editHoursPerMinute: { basic: 2, standard: 3, advanced: 5 }, // ASSUMPTION
        captionHoursPerMinute: 0.5,   // ASSUMPTION
        audioCleanupHoursPerMinute: 0.5, // ASSUMPTION
        musicLicenseCost: null,       // unknown vendor cost -> quote
        revision: { includedRounds: 2, fixedHours: 1, hoursPerMinute: 0.25 }, // ASSUMPTION
        softwarePerProject: 0,        // ASSUMPTION: set your editing software allocation
        fields: [
          { id: 'minutes', label: 'Finished length (minutes)', type: 'int', min: 1, max: 120, default: 2 },
          { id: 'footageHours', label: 'Raw footage to review (hours)', type: 'number', min: 0.5, max: 50, step: 0.5, default: 1 },
          { id: 'effects', label: 'Editing style', type: 'select', default: 'standard', options: [
            { value: 'basic', label: 'Basic: cuts, titles, color correction' },
            { value: 'standard', label: 'Standard: graphics, transitions, color grade' },
            { value: 'advanced', label: 'Advanced: heavy graphics and effects' }
          ] },
          { id: 'captions', label: 'Captions', type: 'bool', default: false },
          { id: 'audio', label: 'Audio', type: 'select', default: 'mix', options: [
            { value: 'mix', label: 'Basic mix' },
            { value: 'cleanup', label: 'Noise cleanup and full mix' },
            { value: 'music', label: 'Licensed music track' }
          ] },
          { id: 'extraRevisions', label: 'Extra revision rounds', type: 'int', min: 0, max: 5, default: 0,
            help: '2 rounds of changes are included.' }
        ],
        from: { minutes: 1, footageHours: 0.5, effects: 'basic', captions: false, audio: 'mix', extraRevisions: 0 }
      },

      /* --------------------------------------------------------------- VIDEOGRAPHY */
      // Video shooting. Priced as:
      //   equipment and media (at equipment.margin, once per item per rental window)
      // + shared preparation (once per booking)
      // + each operator's own booking, priced through operatorTiers on that operator's hours only
      // + selected add-ons (and multicamera editing)
      // Only the final total is rounded up to a dollar amount ending in 9.
      videography: {
        label: 'Videography',
        blurb: 'Professional 4K Camera Package, one camera or multicamera, with optional editing.',
        unit: 'filming hours',
        maxHours: 80,              // per operator; longer bookings -> request a quote
        // Filming hours, filming days and rental days are separate inputs. Rental days come only
        // from the pickup and return dates; they are never inferred from filming hours.
        maxRentalDays: 30,         // longer rentals -> request a quote

        /* Operators. You are operator 1; additional operators = total operators - 1. */
        operatorCostPerHour: 30,   // CONFIRMED: internal cost for every operator, including you
        // Per-operator cost overrides when a crew member's actual quote differs, e.g. { 2: 35 }.
        operatorCostOverrides: {},
        // CONFIRMED: progressive margins, applied separately to each operator's booked hours.
        operatorTiers: [
          { upTo: 2, margin: 0.50 },
          { upTo: 4, margin: 0.40 },
          { upTo: 8, margin: 0.30 },
          { upTo: 16, margin: 0.20 },
          { upTo: Infinity, margin: 0.15 }
        ],
        // PROPOSED POLICY (not confirmed): each operator is billed at least this many hours.
        crewMinimumHours: 2,
        // Overtime: hours beyond `afterHours` in one operator's booking cost `actualCostPerHour`
        // (the operator's real overtime cost) instead of the normal hourly cost. Both still pass
        // through the progressive margins. afterHours: null = no overtime rule.
        // If afterHours is set but actualCostPerHour is null, overtime shows "Request a quote".
        overtime: { afterHours: null, actualCostPerHour: null },

        /* Shared preparation, once per booking. */
        // Shared work only (planning, rental pickup/return, data transfer, backup, coordination).
        // Each operator's own setup and breakdown is billed in that operator's booking, never here.
        prep: {
          includedHours: 2,        // CONFIRMED: prep and rental handling ($60 cost, $120 charge)
          margin: 0.50,            // CONFIRMED
          extraHoursMargin: 0.50   // CONFIRMED: additional shared preparation at the same 50% margin
        },

        /* Equipment and media: Aperturent three-day reference rates, 5 October 2026.
           Confirm rates and availability before final booking. */
        equipment: {
          margin: 0.50,            // CONFIRMED
          rentalWindowDays: 3,     // CONFIRMED: full rental charged once per item per window
          // Rental days = return date - pickup date (a same-day return counts as 1 day).
          // ASSUMPTION about Aperturent's counting rule: confirm how they count pickup/return days.
          referenceDate: '2026-10-05',
          source: 'Aperturent three-day rates. Confirm rates and availability before final booking.'
        },
        /* Camera package. Visitors only ever see the generic package and lens-kit names below;
           camera and lens models stay internal. The cost basis decides which internal rental
           costs price the package. Switching the basis is a manual decision: the FX30 allowance
           is never substituted for the FX3 costs automatically. */
        cameraPackage: {
          label: 'Professional 4K Camera Package',
          customerNote: 'Camera and lens selection is matched to your project. Final equipment is confirmed before booking.',
          costBasis: 'fx3'      // 'fx3' (confirmed rental costs) or 'fx30' (internal estimate)
        },
        costBases: {
          // CONFIRMED Aperturent three-day costs with listed protection. Camera + lens per kit.
          fx3: {
            status: 'confirmed',
            body: 'fx3',
            kits: {
              standard: { internal: 'Sony FX3 + Sigma 24–70mm', costPerWindow: 250 },
              premium:  { internal: 'Sony FX3 + Sony 24–70mm GM II', costPerWindow: 280 },
              prime:    { internal: 'Sony FX3 + Sigma zoom + Sony 35mm f/1.4 GM', costPerWindow: 299 }
            }
          },
          // ESTIMATE: Sony FX30 used only as an internal reference for camera rental costs, not a
          // promise of the camera used. Enter the allowances to use this basis; while any amount
          // is null, packages priced on this basis show "Request a quote".
          fx30: {
            status: 'estimate',
            body: 'fx30',
            cameraAllowancePerWindow: null,      // ESTIMATE, editable
            protectionAllowancePerWindow: null,  // ESTIMATE, editable
            lensAllowancePerWindow: { standard: null, premium: null, prime: null } // ESTIMATE, editable
          }
        },
        // Lens kits visitors choose per camera (no model names).
        lensKits: {
          standard: { label: 'Standard zoom lens' },
          premium:  { label: 'Premium zoom lens' },
          prime:    { label: 'Zoom lens plus fast prime lens' },
          other:    { label: 'Specialty camera or lens (quoted)' }
        },
        cameraBodies: {
          fx3:  { slots: 2, slotTypes: ['sd', 'cfa'], mediaVerified: true },  // Sony FX3 Help Guide, checked 2026-10-05
          fx30: { slots: 2, slotTypes: ['sd', 'cfa'], mediaVerified: false }  // not checked: media confirmed per quote
        },
        defaultCard: 'cfa320',
        defaultCardQty: 2,          // CONFIRMED starting allowance, not a guaranteed recording time
        cards: {
          // CONFIRMED costs. Speed ratings must match the EXACT rented card model.
          // Sony CEA-G320T (320GB CFexpress Type A Tough) is rated VPG400 by Sony.
          // ASSUMPTION: Aperturent's 320GB card is the CEA-G320T. Confirm the model.
          // Rented models: Sony CEA-G320T (320GB) and SanDisk Extreme PRO 128GB UHS-II.
          'cfa320': { label: '320GB CFexpress Type A card', type: 'cfa', gb: 320, vpg: 400, model: 'CEA-G320T (confirm)', costPerWindow: 30 },
          // SanDisk sells 128GB Extreme PRO UHS-II cards in more than one speed rating (V90 and V60
          // versions exist), so UHS-II alone does not mean V90. videoClass stays null until the
          // exact rented model is confirmed; until then this card cannot be booked for any
          // recording format that needs a speed rating.
          'sd128':  { label: '128GB SDXC UHS-II card', type: 'sd', gb: 128, videoClass: null, model: null, costPerWindow: 16 }
        },
        // One shared reader per booking (charged per rental window). The listed CFexpress Type A
        // reader also reads SD cards, so a second reader is charged only when the visitor chooses
        // a second offload station.
        reader: { label: 'CFexpress Type A / SD reader', costPerWindow: 5, readsTypes: ['cfa', 'sd'] }, // CONFIRMED $5
        // Recording modes and the cards each needs, from Sony's ILME-FX3 Help Guide (Ver.2 or later),
        // "Memory cards that can be used" and "Movie Settings":
        //   https://helpguide.sony.net/ilc/2210/v1/en/contents/TP1000867593.html
        //   XAVC S-I 4K (all frame rates): CFexpress Type A VPG200+ or SDXC V90+
        //   XAVC S / XAVC HS 4K up to 280 Mbps: CFexpress Type A VPG200+ or SDXC V60+
        //   119.88p/100p: Sony notes SDXC V90 "may" be needed, so V90 is required here.
        // Checked 5 October 2026. Re-check if the camera's firmware or rented cards change.
        recordModes: {
          'si-4k-24':  { label: '4K 24p, highest quality (All-Intra)', internal: 'XAVC S-I 4K 23.98p 240M', mbps: 240, cfaMinVpg: 200, sdMinClass: 90 },
          'si-4k-30':  { label: '4K 30p, highest quality (All-Intra)', internal: 'XAVC S-I 4K 29.97p 300M', mbps: 300, cfaMinVpg: 200, sdMinClass: 90 },
          'si-4k-60':  { label: '4K 60p, highest quality (All-Intra)', internal: 'XAVC S-I 4K 59.94p 600M', mbps: 600, cfaMinVpg: 200, sdMinClass: 90 },
          's-4k-30':   { label: '4K 30p, standard (10-bit)', internal: 'XAVC S 4K 29.97p 140M 4:2:2 10bit', mbps: 140, cfaMinVpg: 200, sdMinClass: 60 },
          'hs-4k-60':  { label: '4K 60p, efficient (10-bit)', internal: 'XAVC HS 4K 59.94p 200M 4:2:2 10bit', mbps: 200, cfaMinVpg: 200, sdMinClass: 60 },
          's-4k-120':  { label: '4K 120p slow motion (10-bit)', internal: 'XAVC S 4K 119.88p 280M 4:2:2 10bit', mbps: 280, cfaMinVpg: 200, sdMinClass: 90 }
        },
        // ESTIMATE: share of a card's marketed capacity available for recording. Recording-time
        // figures shown to visitors are estimates from bit rate and this share, not guarantees.
        usableShare: 0.92,
        // Per-camera accessories. null cost = not yet priced -> request a quote when selected or
        // required. Never treated as free.
        accessories: {
          support:   { label: 'Tripod and fluid head', costPerWindow: null },
          batteries: { label: 'Extra batteries', costPerWindow: null },
          monitor:   { label: 'On-camera monitor', costPerWindow: null }
        },
        // A locked-off camera still needs its own support and batteries.
        lockedOffRequires: ['support', 'batteries'],
        // Shared add-ons, once per booking. null cost = request a quote.
        audioTechCostPerHour: null,
        lightingRentalPerWindow: null,
        droneCostPerDay: null,
        localRadiusMiles: 25,          // ASSUMPTION
        travelCostOutsideLocal: null,

        /* Multicamera editing estimate. Separate from AI video editing (which uses the confirmed
           3 hours per 30 seconds). Every value below is an ESTIMATING ASSUMPTION, priced at the
           $30/hour labor cost through the volume margin (50% -> 20% over `threshold` minutes).

           editing hours =
               setupHours                                   project setup, ingest, organizing
             + syncHoursPerCamera x (cameras - 1)           syncing angles
             + reviewHoursPerFootageHour x footage hours    footage hours = filming hours x cameras x recordedShareOfFilming
             + colorMatchHoursPerCamera x (cameras - 1)     if color matching is chosen
             + deliveryHoursPerExtraFormat x (formats - 1)  extra aspect ratios or versions
             + per finished minute:
                 editHoursPerMinute[style]
               + switchHoursPerMinutePerCamera x (cameras - 1)
               + captionHoursPerMinute (if captions)
               + audioCleanupHoursPerMinute (if audio cleanup) */
        multicamEdit: {
          threshold: 30,
          setupHours: 2,
          syncHoursPerCamera: 0.5,
          reviewHoursPerFootageHour: 0.75,
          recordedShareOfFilming: 0.6,
          editHoursPerMinute: { basic: 2, standard: 3, advanced: 5 },
          switchHoursPerMinutePerCamera: 0.5,
          colorMatchHoursPerCamera: 1,
          captionHoursPerMinute: 0.5,
          audioCleanupHoursPerMinute: 0.5,
          deliveryHoursPerExtraFormat: 0.5
        },

        softwarePerProject: 0, // ASSUMPTION

        fields: (function () {
          var f = [
            { id: 'cameras', label: 'Cameras', type: 'select', default: '1', group: 'Cameras and crew', options: [
              { value: '1', label: 'One camera' }, { value: '2', label: 'Multicamera: 2 cameras' },
              { value: '3', label: 'Multicamera: 3 cameras' }, { value: 'custom', label: 'Custom setup (quote)' } ] },
            { id: 'pickupDate', label: 'Equipment pickup date', type: 'date', default: null, group: 'Dates',
              showIf: { field: 'cameras', notEquals: 'custom' } },
            { id: 'returnDate', label: 'Equipment return date', type: 'date', default: null, group: 'Dates',
              showIf: { field: 'cameras', notEquals: 'custom' } },
            { id: 'filmingDays', label: 'Filming days', type: 'int', min: 1, max: 30, default: 1, group: 'Dates',
              showIf: { field: 'cameras', notEquals: 'custom' } },
            { id: 'hours', label: 'Filming hours per operator', type: 'number', min: 1, max: 80, step: 0.5, default: 4, group: 'Cameras and crew',
              help: 'Total across all filming days. Applies to every operator unless you change it below. 2-hour minimum per operator.',
              showIf: { field: 'cameras', notEquals: 'custom' } },
            { id: 'recordMode', label: 'Recording format', type: 'select', default: 'si-4k-24', group: 'Cameras and crew',
              optionsFrom: 'recordModes', showIf: { field: 'cameras', notEquals: 'custom' } },
            { id: 'recording', label: 'Card recording', type: 'select', default: 'relay', group: 'Cameras and crew',
              showIf: { field: 'cameras', notEquals: 'custom' }, options: [
              { value: 'relay', label: 'One card after another' },
              { value: 'backup', label: 'Backup: record to two cards at once' } ] },
            { id: 'setup1', label: 'Lead operator setup and breakdown hours', type: 'number', min: 0, max: 16, step: 0.5, default: 0,
              group: 'Cameras and crew', showIf: { field: 'cameras', notEquals: 'custom' } }
          ];
          [1, 2, 3].forEach(function (i) {
            var show = i === 1 ? [{ field: 'cameras', notEquals: 'custom' }] : [{ field: 'cameras', in: i === 2 ? ['2', '3'] : ['3'] }];
            var g = 'Camera ' + i;
            if (i > 1) {
              f.push({ id: 'cam' + i + 'Mode', label: 'Operation', type: 'select', default: 'operated', group: g, showIf: show, options: [
                { value: 'operated', label: 'With its own operator' },
                { value: 'locked', label: 'Locked-off, no operator' } ] });
              var opShow = show.concat([{ field: 'cam' + i + 'Mode', equals: 'operated' }]);
              f.push({ id: 'cam' + i + 'Hours', label: 'Operator filming hours', type: 'number', min: 1, max: 80, step: 0.5,
                       optional: true, default: null, group: g, showIf: opShow, help: 'Leave blank to match the filming hours.' });
              f.push({ id: 'cam' + i + 'Setup', label: 'Operator setup and breakdown hours', type: 'number', min: 0, max: 16, step: 0.5,
                       default: 0, group: g, showIf: opShow });
            }
            f.push({ id: 'cam' + i + 'Lens', label: 'Lens kit', type: 'select', default: 'standard', group: g,
                     optionsFrom: 'lensKits', showIf: show, help: 'Each camera is a Professional 4K Camera Package.' });
            f.push({ id: 'cam' + i + 'Card', label: 'Memory card', type: 'select', default: 'cfa320', group: g,
                     optionsFrom: 'cards', showIf: show });
            f.push({ id: 'cam' + i + 'CardQty', label: 'Number of cards', type: 'int', min: 1, max: 8, default: 2, group: g, showIf: show,
                     help: 'A starting allowance, not a guaranteed recording time.' });
            f.push({ id: 'cam' + i + 'Support', label: 'Tripod and fluid head', type: 'bool', default: false, group: g, showIf: show });
            f.push({ id: 'cam' + i + 'Batteries', label: 'Extra batteries', type: 'bool', default: false, group: g, showIf: show });
            f.push({ id: 'cam' + i + 'Monitor', label: 'On-camera monitor', type: 'bool', default: false, group: g, showIf: show });
          });
          var notCustom = { field: 'cameras', notEquals: 'custom' };
          f.push(
            { id: 'prepExtra', label: 'Extra prep, data transfer and backup hours', type: 'number', min: 0, max: 40, step: 0.5, default: 0,
              group: 'Shared', showIf: notCustom, help: 'Shared work for the whole shoot. 2 hours of prep are included.' },
            { id: 'extraReader', label: 'Second card reader (two offload stations)', type: 'bool', default: false, group: 'Shared', showIf: notCustom },
            { id: 'audioTech', label: 'Dedicated sound recordist', type: 'bool', default: false, group: 'Shared', showIf: notCustom },
            { id: 'lighting', label: 'Large lighting package', type: 'bool', default: false, group: 'Shared', showIf: notCustom },
            { id: 'drone', label: 'Drone footage', type: 'bool', default: false, group: 'Shared', showIf: notCustom },
            { id: 'travel', label: 'Location', type: 'select', default: 'local', group: 'Shared', showIf: notCustom, options: [
              { value: 'local', label: 'Local (within 25 miles)' }, { value: 'travel', label: 'Outside the local area' } ] },
            { id: 'edit', label: 'Editing', type: 'select', default: 'none', group: 'Editing', showIf: notCustom, options: [
              { value: 'none', label: 'Footage only, no editing' },
              { value: 'basic', label: 'Edited: basic' }, { value: 'standard', label: 'Edited: standard' },
              { value: 'advanced', label: 'Edited: advanced' } ] },
            { id: 'editMinutes', label: 'Finished length (minutes)', type: 'int', min: 1, max: 60, default: 2, group: 'Editing',
              showIf: [notCustom, { field: 'edit', notEquals: 'none' }] },
            { id: 'colorMatch', label: 'Match color between cameras', type: 'bool', default: true, group: 'Editing',
              showIf: [{ field: 'cameras', in: ['2', '3'] }, { field: 'edit', notEquals: 'none' }] },
            { id: 'captions', label: 'Captions', type: 'bool', default: false, group: 'Editing',
              showIf: [notCustom, { field: 'edit', notEquals: 'none' }] },
            { id: 'audioCleanup', label: 'Noise cleanup and full audio mix', type: 'bool', default: false, group: 'Editing',
              showIf: [notCustom, { field: 'edit', notEquals: 'none' }] },
            { id: 'formats', label: 'Delivery formats', type: 'int', min: 1, max: 6, default: 1, group: 'Editing',
              showIf: [notCustom, { field: 'edit', notEquals: 'none' }], help: 'For example 16:9, 9:16 and 1:1 versions.' }
          );
          return f;
        })(),
        // Starting price: one camera, 2 hours, one 3-day rental window.
        from: { cameras: '1', hours: 2, pickupDate: '2026-10-05', returnDate: '2026-10-08', filmingDays: 1 }
      },

      /* ----------------------------------------------------------- GRAPHIC DESIGN */
      graphic: {
        label: 'Graphic design',
        blurb: 'Logos, social graphics, print pieces, decks, signage and motion titles.',
        complexity: { simple: 0.75, standard: 1, complex: 1.5 }, // ASSUMPTION: multiplies hours per unit
        revision: { includedRounds: 2, fixedHours: 0.5, unitShare: 0.15 }, // ASSUMPTION
        softwarePerProject: 0, // ASSUMPTION: set your design software allocation
        // ASSUMPTION: every hour and threshold below.
        deliverables: {
          logo:         { label: 'Logo',                      unit: 'logo concepts', setupHours: 2,   hoursPerUnit: 8,    threshold: 5,  max: 10 },
          social:       { label: 'Social or web graphic',     unit: 'graphics',      setupHours: 1,   hoursPerUnit: 0.75, threshold: 30, max: 300 },
          flyer:        { label: 'Flyer, postcard or poster', unit: 'designs',       setupHours: 0.5, hoursPerUnit: 2.5,  threshold: 10, max: 100 },
          brochure:     { label: 'Brochure',                  unit: 'brochures',     setupHours: 1,   hoursPerUnit: 5,    threshold: 10, max: 50 },
          slides:       { label: 'Presentation deck',         unit: 'slides',        setupHours: 2,   hoursPerUnit: 0.75, threshold: 60, max: 300 },
          signage:      { label: 'Banner or event sign',      unit: 'designs',       setupHours: 0.5, hoursPerUnit: 2,    threshold: 20, max: 100 },
          motion:       { label: 'Motion title or lower third', unit: 'animations',  setupHours: 1,   hoursPerUnit: 3,    threshold: 20, max: 100 }
        },
        fields: [
          { id: 'deliverable', label: 'What you need', type: 'select', default: 'social', optionsFrom: 'deliverables' },
          { id: 'quantity', label: 'How many', type: 'int', min: 1, max: 300, default: 1, maxFrom: 'deliverable' },
          { id: 'complexity', label: 'Complexity', type: 'select', default: 'standard', options: [
            { value: 'simple', label: 'Simple' },
            { value: 'standard', label: 'Standard' },
            { value: 'complex', label: 'Complex' }
          ] },
          { id: 'extraRevisions', label: 'Extra revision rounds', type: 'int', min: 0, max: 5, default: 0,
            help: '2 rounds of changes are included.' }
        ],
        from: { deliverable: 'social', quantity: 1, complexity: 'simple', extraRevisions: 0 }
      },

      /* -------------------------------------------------------------------- PRINT */
      // Print orders, priced from confirmed Zoo Printing quotes only. No volume tiers.
      //
      //   total internal cost = vendor printing + vendor shipping + applicable vendor tax + fees
      //                         + laborRate x (prep hours + design hours + revision hours)
      //   selling price       = total internal cost / (1 - margin), rounded up once to end in 9
      //
      // If no confirmed quote matches the exact specification (and deadline), printing shows
      // "Request quote". Design can still be estimated on its own.
      print: {
        label: 'Print',
        blurb: 'Business cards, flyers, postcards, brochures, posters and vinyl banners, with optional design.',
        margin: 0.50,                                   // internal setting: one of allowedMargins
        allowedMargins: [0.50, 0.40, 0.30, 0.20, 0.15],
        minMargin: 0.15,                                // never priced below this
        prepHoursPerOrder: 0.5,  // ASSUMPTION: file check, ordering, proofing per print order
        // Design labor is separate from prep (prep is never inside these hours).
        // ASSUMPTION: hours per design, by product.
        designHours: {
          cards: 2, flyers: 3, postcards: 3, brochures: 6, posters: 3, banners: 2.5
        },
        fileFixHours: 1,          // ASSUMPTION: minor fixes to a customer's file
        revisionHoursPerRound: 1, // ASSUMPTION: each extra design revision round (2 included)
        includedRevisionRounds: 2,

        // Product options. Dimensions are stored in inches (w x h).
        // ASSUMPTION: option lists are a starting set; confirm each against Zoo Printing's catalog.
        products: {
          cards: {
            label: 'Business cards',
            sizes: [{ id: '3.5x2', w: 3.5, h: 2, label: '3.5 × 2 in (standard)' }],
            quantities: [250, 500, 1000, 2500, 5000],
            stockLabel: 'Paper stock',
            stocks: [{ id: '14pt', label: '14 pt cardstock' }, { id: '16pt', label: '16 pt cardstock' }, { id: '100c-unc', label: '100 lb uncoated cover' }],
            sides: [{ id: 'one', label: 'One side' }, { id: 'two', label: 'Both sides' }],
            coatings: [{ id: 'none', label: 'No coating' }, { id: 'uv', label: 'Gloss UV' }, { id: 'matte', label: 'Matte' }],
            finishing: [{ id: 'none', label: 'None' }, { id: 'round', label: 'Rounded corners' }]
          },
          flyers: {
            label: 'Flyers',
            sizes: [
              { id: '4.25x5.5', w: 4.25, h: 5.5, label: '4.25 × 5.5 in (quarter-page flyer)' },
              { id: '5.5x8.5', w: 5.5, h: 8.5, label: '5.5 × 8.5 in (half-page flyer)' },
              { id: '8.5x11', w: 8.5, h: 11, label: '8.5 × 11 in (full-page flyer)' }
            ],
            quantities: [100, 250, 500, 1000, 2500, 5000],
            stockLabel: 'Paper stock',
            stocks: [{ id: '100t-gloss', label: '100 lb gloss text' }, { id: '100c-gloss', label: '100 lb gloss cover' }, { id: '70t-unc', label: '70 lb uncoated text' }],
            sides: [{ id: 'one', label: 'One side' }, { id: 'two', label: 'Both sides' }],
            coatings: [{ id: 'none', label: 'No coating' }, { id: 'aq', label: 'Aqueous gloss' }, { id: 'matte', label: 'Matte' }],
            finishing: [{ id: 'none', label: 'None' }]
          },
          postcards: {
            label: 'Postcards',
            sizes: [
              { id: '4x6', w: 4, h: 6, label: '4 × 6 in' },
              { id: '5x7', w: 5, h: 7, label: '5 × 7 in' },
              { id: '6x9', w: 6, h: 9, label: '6 × 9 in' }
            ],
            quantities: [100, 250, 500, 1000, 2500, 5000],
            stockLabel: 'Paper stock',
            stocks: [{ id: '14pt', label: '14 pt cardstock' }, { id: '16pt', label: '16 pt cardstock' }],
            sides: [{ id: 'one', label: 'One side' }, { id: 'two', label: 'Both sides' }],
            coatings: [{ id: 'none', label: 'No coating' }, { id: 'uv', label: 'Gloss UV' }, { id: 'matte', label: 'Matte' }],
            finishing: [{ id: 'none', label: 'None' }, { id: 'round', label: 'Rounded corners' }]
          },
          brochures: {
            label: 'Brochures',
            sizes: [
              { id: '8.5x11', w: 8.5, h: 11, label: '8.5 × 11 in flat' },
              { id: '11x17', w: 11, h: 17, label: '11 × 17 in flat' }
            ],
            quantities: [100, 250, 500, 1000, 2500, 5000],
            stockLabel: 'Paper stock',
            stocks: [{ id: '100t-gloss', label: '100 lb gloss text' }, { id: '80t-gloss', label: '80 lb gloss text' }],
            sides: [{ id: 'two', label: 'Both sides' }],
            coatings: [{ id: 'none', label: 'No coating' }, { id: 'aq', label: 'Aqueous gloss' }, { id: 'matte', label: 'Matte' }],
            folds: [{ id: 'tri', label: 'Tri-fold' }, { id: 'half', label: 'Half-fold (bi-fold)' }, { id: 'z', label: 'Z-fold' }],
            finishing: [{ id: 'none', label: 'None' }]
          },
          posters: {
            label: 'Posters',
            sizes: [
              { id: '11x17', w: 11, h: 17, label: '11 × 17 in' },
              { id: '18x24', w: 18, h: 24, label: '18 × 24 in' },
              { id: '24x36', w: 24, h: 36, label: '24 × 36 in' }
            ],
            quantities: [10, 25, 50, 100, 250],
            stockLabel: 'Paper stock',
            stocks: [{ id: '100t-gloss', label: '100 lb gloss text' }, { id: '80c-gloss', label: '80 lb gloss cover' }],
            sides: [{ id: 'one', label: 'One side' }],
            coatings: [{ id: 'none', label: 'No coating' }, { id: 'aq', label: 'Aqueous gloss' }],
            finishing: [{ id: 'none', label: 'None' }]
          },
          banners: {
            label: 'Vinyl banners',
            sizes: [
              { id: '24x72', w: 24, h: 72, label: '24 × 72 in (2 × 6 ft)' },
              { id: '36x96', w: 36, h: 96, label: '36 × 96 in (3 × 8 ft)' },
              { id: '48x120', w: 48, h: 120, label: '48 × 120 in (4 × 10 ft)' }
            ],
            quantities: [1, 2, 5, 10, 25],
            stockLabel: 'Banner material',
            stocks: [{ id: '13oz', label: '13 oz vinyl' }, { id: '15oz-block', label: '15 oz blockout vinyl' }, { id: 'mesh', label: 'Mesh vinyl (wind-resistant)' }],
            // Printed sides depend on the material: only blockout vinyl is offered double-sided.
            sidesByStock: {
              '13oz': [{ id: 'one', label: 'One side' }],
              '15oz-block': [{ id: 'one', label: 'One side' }, { id: 'two', label: 'Both sides' }],
              'mesh': [{ id: 'one', label: 'One side' }]
            },
            finishing: [{ id: 'hem-grommet', label: 'Hems and grommets' }, { id: 'hem', label: 'Hems only' },
                        { id: 'pole', label: 'Pole pockets' }, { id: 'none', label: 'No finishing (cut to size)' }]
          }
        },

        // Confirmed Zoo Printing quotes. One record per exact specification, quantity and method.
        // Leave a value null when it is not confirmed; a null vendorCost never produces a price.
        //   shipping:       vendor shipping to Bates Digital (for local pickup orders)
        //   shippingDirect: vendor shipping straight to the customer (for "ship to me")
        //   tax:            vendor tax that applies to this order (0 if none applies), null = pending
        //   deliveryDays:   production + transit, used to check the customer's deadline
        // Example of a record (copy, fill in from a real quote, and remove the //):
        // { product: 'flyers', size: '4.25x5.5', quantity: 500, stock: '100t-gloss', sides: 'two',
        //   coating: 'aq', finishing: 'none', method: 'digital',
        //   vendorCost: null, shipping: null, shippingDirect: null, tax: null, fees: 0,
        //   deliveryDays: null, source: 'Zoo Printing', quoteRef: '', quoteDate: '2026-10-05' },
        vendorQuotes: [],

        fields: [
          { id: 'product', label: 'Product', type: 'select', default: 'flyers', optionsFrom: 'products' },
          { id: 'size', label: 'Size', type: 'select', default: null, productOptions: 'sizes' },
          { id: 'quantity', label: 'Quantity', type: 'select', default: null, productOptions: 'quantities' },
          { id: 'stock', label: 'Paper stock or material', type: 'select', default: null, productOptions: 'stocks', labelFromProduct: 'stockLabel' },
          { id: 'sides', label: 'Printed sides', type: 'select', default: 'two', productOptions: 'sides' },
          { id: 'coating', label: 'Coating', type: 'select', default: 'none', productOptions: 'coatings' },
          { id: 'fold', label: 'Folding', type: 'select', default: null, productOptions: 'folds' },
          { id: 'finishing', label: 'Finishing', type: 'select', default: null, productOptions: 'finishing' },
          { id: 'design', label: 'Design', type: 'select', default: 'design', options: [
            { value: 'design', label: 'Design it for me' },
            { value: 'fix', label: 'Check and fix my file' },
            { value: 'ready', label: 'I have print-ready files' } ] },
          { id: 'extraRevisions', label: 'Extra design revision rounds', type: 'int', min: 0, max: 5, default: 0,
            help: '2 rounds of changes are included.', showIf: { field: 'design', equals: 'design' } },
          { id: 'delivery', label: 'Delivery', type: 'select', default: 'pickup', options: [
            { value: 'pickup', label: 'Local pickup' }, { value: 'ship', label: 'Ship to me' } ] },
          { id: 'deadlineDays', label: 'Needed within (days)', type: 'int', min: 1, max: 90, optional: true, default: null,
            help: 'Leave blank if there is no deadline.' }
        ],
        from: null // no starting price until confirmed vendor quotes exist
      },

      /* --------------------------------------------------------------- WEB DESIGN */
      web: {
        label: 'Web design',
        blurb: 'Websites and landing pages for launches, campaigns and small businesses.',
        unit: 'pages',
        threshold: 30,          // ASSUMPTION
        setupHours: 6,          // ASSUMPTION: discovery, design system, site setup
        pageHours: { template: 2.5, custom: 5 }, // ASSUMPTION
        contentPrepHoursPerPage: 1.5, // ASSUMPTION
        featureHours: { contactForm: 2, blog: 6, booking: 4, newsletter: 2 }, // ASSUMPTION
        storeCost: null,        // e-commerce scope varies too much -> quote
        revision: { includedRounds: 2, fixedHours: 2, hoursPerPage: 0.25 }, // ASSUMPTION
        hostingCostPerMonth: null, // unknown vendor cost -> quote
        maintenanceHoursPerMonth: { basic: 1, standard: 3 }, // ASSUMPTION
        softwarePerProject: 0,
        fields: [
          { id: 'pages', label: 'Number of pages', type: 'int', min: 1, max: 100, default: 5 },
          { id: 'pageType', label: 'Design approach', type: 'select', default: 'template', options: [
            { value: 'template', label: 'Built from a customized template' },
            { value: 'custom', label: 'Fully custom design' }
          ] },
          { id: 'contactForm', label: 'Contact form', type: 'bool', default: true },
          { id: 'blog', label: 'Blog or news section', type: 'bool', default: false },
          { id: 'booking', label: 'Booking or scheduling integration', type: 'bool', default: false },
          { id: 'newsletter', label: 'Newsletter sign-up integration', type: 'bool', default: false },
          { id: 'store', label: 'Online store', type: 'bool', default: false },
          { id: 'content', label: 'Page content', type: 'select', default: 'client', options: [
            { value: 'client', label: 'I will provide text and images' },
            { value: 'prepare', label: 'Prepare and edit content for me' }
          ] },
          { id: 'extraRevisions', label: 'Extra revision rounds', type: 'int', min: 0, max: 5, default: 0,
            help: '2 rounds of changes are included.' },
          { id: 'hosting', label: 'Hosting', type: 'select', default: 'own', recurring: true, options: [
            { value: 'own', label: 'I will arrange my own hosting' },
            { value: 'managed', label: 'Host it for me' }
          ] },
          { id: 'maintenance', label: 'Monthly updates', type: 'select', default: 'none', recurring: true, options: [
            { value: 'none', label: 'None' },
            { value: 'basic', label: 'Basic: small updates each month' },
            { value: 'standard', label: 'Standard: regular updates each month' }
          ] }
        ],
        from: { pages: 1, pageType: 'template', contactForm: false, blog: false, booking: false, newsletter: false,
                store: false, content: 'client', extraRevisions: 0, hosting: 'own', maintenance: 'none' }
      },

      /* ------------------------------------------------------- PUBLICATION DESIGN */
      publication: {
        label: 'Publication design',
        blurb: 'Reports, booklets, catalogs, books and magazines.',
        unit: 'pages',
        threshold: 200,         // ASSUMPTION
        minPages: 4,
        setupHours: 4,          // ASSUMPTION: grid, styles, templates
        layoutHoursPerPage: { text: 0.5, mixed: 1, design: 2 }, // ASSUMPTION
        photoPrepHours: 0.25,   // ASSUMPTION per image
        chartHours: 1,          // ASSUMPTION per chart or table
        coverHours: 4,          // ASSUMPTION
        revision: { includedRounds: 2, fixedHours: 1, hoursPerPage: 0.1 }, // ASSUMPTION
        printingCost: null,     // unknown vendor cost -> quote
        softwarePerProject: 0,
        fields: [
          { id: 'pages', label: 'Interior pages', type: 'int', min: 4, max: 600, default: 16 },
          { id: 'layout', label: 'Layout', type: 'select', default: 'mixed', options: [
            { value: 'text', label: 'Mostly text' },
            { value: 'mixed', label: 'Text with images' },
            { value: 'design', label: 'Design-heavy' }
          ] },
          { id: 'photos', label: 'Photos to prepare', type: 'int', min: 0, max: 1000, default: 0 },
          { id: 'charts', label: 'Charts or tables to build', type: 'int', min: 0, max: 200, default: 0 },
          { id: 'cover', label: 'Cover design', type: 'bool', default: true },
          { id: 'extraRevisions', label: 'Extra revision rounds', type: 'int', min: 0, max: 5, default: 0,
            help: '2 rounds of changes are included.' },
          { id: 'printing', label: 'Printing', type: 'select', default: 'none', options: [
            { value: 'none', label: 'Design and print-ready files only' },
            { value: 'print', label: 'Print copies for me' }
          ] }
        ],
        from: { pages: 4, layout: 'text', photos: 0, charts: 0, cover: false, extraRevisions: 0, printing: 'none' }
      }
    },

    // Work pages -> calculator category and the smallest standard selection shown as "From $X".
    // null = no published price on that page.
    workPages: {
      'commercial':      { category: 'videography' },
      'corporate':       { category: 'videography' },
      'educational':     { category: 'editing' },
      'ai-video':        { category: 'ai' },
      'logos-brand':     { category: 'graphic', from: { deliverable: 'logo', quantity: 1, complexity: 'simple' } },
      'motion-graphics': { category: 'graphic', from: { deliverable: 'motion', quantity: 1, complexity: 'simple' } },
      'presentations':   { category: 'graphic', from: { deliverable: 'slides', quantity: 1, complexity: 'simple' } },
      'social-web':      { category: 'graphic', from: { deliverable: 'social', quantity: 1, complexity: 'simple' } },
      'signage-events':  { category: 'graphic', from: { deliverable: 'signage', quantity: 1, complexity: 'simple' } },
      'print':           { category: 'publication' },
      'websites':        { category: 'web' },
      'ai-images':       null
    },

    // Calculator categories mapped to the contact form's "Project type" options.
    contactProjectType: {
      instant: 'Not sure yet', ai: 'AI video', editing: 'Not sure yet', videography: 'Commercial video', graphic: 'Graphic design',
      print: 'Graphic design', web: 'Graphic design', publication: 'Graphic design'
    }
  };
});
