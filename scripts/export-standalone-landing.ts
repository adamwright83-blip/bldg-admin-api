import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function main() {
  console.log('Starting export of standalone JOYSTICK landing page...');

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const { default: JoystickLanding } = await vite.ssrLoadModule('/src/pages/JoystickLanding.tsx');
  const renderedContent = renderToStaticMarkup(React.createElement(JoystickLanding));
  await vite.close();

  // Read CSS
  const cssPath = path.resolve(process.cwd(), 'client/src/pages/joystick-landing.css');
  let cssContent = fs.readFileSync(cssPath, 'utf8');

  // Convert local images to base64 data URIs
  const imageMap: Record<string, string> = {
    '/joystick/lantern-city-diorama.jpg': 'client/public/joystick/lantern-city-diorama.jpg',
    '/joystick/gameplay/tile-cozy-silver-lake.jpg': 'client/public/joystick/gameplay/tile-cozy-silver-lake.jpg',
    '/joystick/gameplay/tile-road-colosseum.jpg': 'client/public/joystick/gameplay/tile-road-colosseum.jpg',
    '/joystick/gameplay/silver-lake.jpg': 'client/public/joystick/gameplay/silver-lake.jpg',
    '/joystick/gameplay/beverly-hills.jpg': 'client/public/joystick/gameplay/beverly-hills.jpg',
    '/joystick/gameplay/channel-382.jpg': 'client/public/joystick/gameplay/channel-382.jpg',
    '/joystick/gameplay/century-park-east.jpg': 'client/public/joystick/gameplay/century-park-east.jpg',
    '/landingfinal/founder.jpg': 'client/public/landingfinal/founder.jpg',
    '/landingfinal/owner-walkup.jpg': 'client/public/landingfinal/owner-walkup.jpg',
    '/landingfinal/collateral.jpg': 'client/public/landingfinal/collateral.jpg',
  };

  let processedHtml = renderedContent;
  for (const [webUrl, localPath] of Object.entries(imageMap)) {
    const fullPath = path.resolve(process.cwd(), localPath);
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase().replace('.', '');
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const b64 = fs.readFileSync(fullPath).toString('base64');
      const dataUri = `data:${mime};base64,${b64}`;
      processedHtml = processedHtml.split(`src="${webUrl}"`).join(`src="${dataUri}"`);
      processedHtml = processedHtml.split(`url('${webUrl}')`).join(`url('${dataUri}')`);
      processedHtml = processedHtml.split(`url("${webUrl}")`).join(`url("${dataUri}")`);
    }
  }

  // Client-side interactions script
  const clientScript = `
<script>
  (function() {
    // 1. Hero settle
    setTimeout(() => {
      const emptyCard = document.querySelector('.jl-gallery-empty-card');
      if (emptyCard) emptyCard.classList.add('is-settled');
    }, 500);

    // 2. Persona Card rotation & flips
    const personas = [
      {
        name: 'Adam',
        caption: 'Adam loves playing Tomb Raider. Shies away from lobbies.',
        game: 'Tomb Raider...',
        oneLiner: 'Three doors before noon. Rook wrote the opener.',
        clipLabel: 'Rook · Silver Lake',
        accent: '#e39b00',
        paper: '#f1e6cf'
      },
      {
        name: 'Daisy',
        caption: 'Daisy loves playing cozy games. Forgets to follow up.',
        game: 'Stardew Valley...',
        oneLiner: 'Maya first; she’s the easiest yes.',
        clipLabel: 'Sable · Los Feliz',
        accent: '#e0457b',
        paper: '#f3dde3'
      },
      {
        name: 'Shawn',
        caption: 'Shawn loves making videos. Never starts the ad.',
        game: 'Halo...',
        oneLiner: 'The ad goes up Thursday. Luma cut three openers.',
        clipLabel: 'Luma · CHANNEL 382',
        accent: '#13a39a',
        paper: '#d9ebe8'
      },
      {
        name: 'TJ',
        caption: 'TJ loves playing shooters. Starts at the wrong end of the block.',
        game: 'Animal Crossing...',
        oneLiner: 'Twenty-four doors in the flats. North end first.',
        clipLabel: 'Orren · the flats',
        accent: '#e8472a',
        paper: '#eadfd3'
      }
    ];

    let currentIdx = 0;
    const dots = document.querySelectorAll('.jl-gallery-dots button');
    const personCard = document.querySelector('.jl-gallery-person-card');
    const companionCard = document.querySelector('.jl-gallery-companion-card');
    const oneLinerEl = document.querySelector('.jl-gallery-one-liner');
    const clipTag = document.querySelector('.jl-clip-tag');
    const inputGame = document.querySelector('.jl-gallery-ruled-input');

    function updatePersona(idx) {
      currentIdx = idx;
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
      const p = personas[idx];
      if (oneLinerEl) oneLinerEl.textContent = p.oneLiner;
      if (clipTag) clipTag.textContent = p.clipLabel;
      if (inputGame) inputGame.placeholder = p.game;
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener('click', () => updatePersona(idx));
    });

    if (personCard) {
      personCard.addEventListener('click', () => {
        personCard.classList.toggle('is-flipped');
      });
    }

    if (companionCard) {
      companionCard.addEventListener('click', () => {
        companionCard.classList.toggle('is-flipped');
      });
    }

    // 3. Claire rotating words
    const words = ['books', 'orders', 'customers', 'routes', 'goals'];
    let wordIdx = 0;
    const wordEl = document.querySelector('.jl-call-word');
    setInterval(() => {
      wordIdx = (wordIdx + 1) % words.length;
      if (wordEl) wordEl.textContent = words[wordIdx];
    }, 2500);

    // 4. Claire call card flip
    const callCard = document.querySelector('.jl-call-card');
    const callChoiceBtns = document.querySelectorAll('.jl-call-choice-btn');
    const callBackBtn = document.querySelector('.jl-call-back-btn');
    if (callChoiceBtns) {
      callChoiceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (callCard) callCard.classList.add('is-flipped');
        });
      });
    }
    if (callBackBtn) {
      callBackBtn.addEventListener('click', () => {
        if (callCard) callCard.classList.remove('is-flipped');
      });
    }

    // 5. Lantern City interactive landmark switcher
    const landmarkTabs = document.querySelectorAll('.jl-landmark-tab');
    const landmarkPins = document.querySelectorAll('.jl-landmark-pin');
    const docketTag = document.querySelector('.jl-docket-tag');
    const docketComp = document.querySelector('.jl-docket-companion');
    const docketTitle = document.querySelector('.jl-docket-title');
    const docketDesc = document.querySelector('.jl-docket-desc');
    const docketMetricRow = document.querySelector('.jl-docket-metric-row');

    const landmarkData = {
      1: {
        tag: 'SILVER LAKE SECTOR · REUNION MISSION',
        comp: 'Sable (Recall) in field',
        title: 'Maya R. · 78 Days Quiet',
        desc: 'Ordered weekly for 2 years ($48 avg). Paused when the delivery window moved from Tuesday afternoons to mornings. Her porch lantern is lit.',
        metrics: '<div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Recoverable Revenue</span><span class=\"jl-metric-val\">+$2,490 / yr</span></div><div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Route Detour</span><span class=\"jl-metric-val\">0.1 mi (Tuesday loop)</span></div>'
      },
      2: {
        tag: 'WILSHIRE CORRIDOR · PROSPECT MISSION',
        comp: 'Rook (Contact) in field',
        title: 'Rise Wilshire · 24 Residential Doors',
        desc: 'Directly on your Tuesday van path. Building manager changed last month; resident flyer rack is open. Rook drafted a neighborhood intro note.',
        metrics: '<div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Target Density</span><span class=\"jl-metric-val\">24 doors / 1 stop</span></div><div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Projected Value</span><span class=\"jl-metric-val\">+$1,150 / mo</span></div>'
      },
      3: {
        tag: 'CENTURY PARK EAST · WIN-BACK',
        comp: 'Orren (Route) in field',
        title: 'Century Park East · The Velvet Gate',
        desc: '8 executive residents stopped pickups when the security desk changed concierge protocols. Orren mapped an approved ground-level delivery protocol.',
        metrics: '<div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Dormant Accounts</span><span class=\"jl-metric-val\">8 verified VIPs</span></div><div class=\"jl-docket-metric\"><span class=\"jl-metric-label\">Recoverable Revenue</span><span class=\"jl-metric-val\">+$420 / mo</span></div>'
      }
    };

    function setLandmark(num) {
      landmarkTabs.forEach((tab, i) => tab.classList.toggle('is-active', (i + 1) === num));
      landmarkPins.forEach((pin, i) => pin.classList.toggle('is-active', (i + 1) === num));
      const data = landmarkData[num];
      if (data) {
        if (docketTag) docketTag.textContent = data.tag;
        if (docketComp) docketComp.textContent = data.comp;
        if (docketTitle) docketTitle.textContent = data.title;
        if (docketDesc) docketDesc.textContent = data.desc;
        if (docketMetricRow) docketMetricRow.innerHTML = data.metrics;
      }
    }

    landmarkTabs.forEach((tab, i) => tab.addEventListener('click', () => setLandmark(i + 1)));
    landmarkPins.forEach((pin, i) => pin.addEventListener('click', () => setLandmark(i + 1)));

    // 6. The Dossier page turn
    const casefileNavBtns = document.querySelectorAll('.jl-casefile-nav-btn');
    const casefileSpread = document.querySelector('.jl-casefile-spread');
    const cluePage = document.querySelector('.jl-page-clue');
    const missionPage = document.querySelector('.jl-page-mission');
    const flipBtn = document.querySelector('.jl-casefile-flip-btn');
    const backBtn = document.querySelector('.jl-casefile-back-btn');

    function showDossierPage(page) {
      casefileNavBtns.forEach((b, idx) => b.classList.toggle('is-active', (page === 'clue' ? idx === 0 : idx === 1)));
      if (cluePage) cluePage.style.display = page === 'clue' ? 'block' : 'none';
      if (missionPage) missionPage.style.display = page === 'mission' ? 'block' : 'none';
    }

    casefileNavBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => showDossierPage(idx === 0 ? 'clue' : 'mission'));
    });
    if (flipBtn) flipBtn.addEventListener('click', () => showDossierPage('mission'));
    if (backBtn) backBtn.addEventListener('click', () => showDossierPage('clue'));

    // 7. Connectors pipeline triggers
    const pipeTriggers = document.querySelectorAll('.jl-pipeline-trigger-btn');
    const rawSlipCode = document.querySelector('.jl-slip-code code');
    const rawSlipBadge = document.querySelector('.jl-slip-badge');
    const lensQuote = document.querySelector('.jl-lens-quote');
    const questName = document.querySelector('.jl-quest-name');
    const questImpact = document.querySelector('.jl-quest-impact');

    const pipeData = [
      {
        badge: 'CleanCloud POS Event',
        code: 'ORDER_ID: 8412<br />CUSTOMER: Maya R.<br />DELTA: 78_DAYS_INACTIVE<br />HIST_SPEND: $5,450',
        lens: '“Maya didn’t leave over quality. Your van is 0.1 miles away on Tuesdays. Route overlap found.”',
        quest: 'Reunion Knock · Silver Lake',
        impact: '+$310 / mo recovered'
      },
      {
        badge: 'Stripe Webhook Event',
        code: 'EVENT: sub.canceled<br />CUSTOMER: Dr. Aris Thorne<br />PLAN: $420_MONTHLY_TIER<br />REASON: schedule_conflict',
        lens: '“Dr. Thorne canceled because his clinic opens at 8 AM. We have an open van slot at 7:45 AM.”',
        quest: 'Early Clinic Window Save',
        impact: '+$420 / mo account retained'
      },
      {
        badge: 'Square Register Event',
        code: 'INVOICE: #0194<br />CUSTOMER: Rise Commercial<br />AGING: 42_DAYS_OVERDUE<br />BALANCE: $680.00',
        lens: '“Rise property manager is on site every Thursday. Rook drafted a courteous payment docket.”',
        quest: 'Thursday Front-Desk Drop',
        impact: '+$680 overdue collected'
      }
    ];

    pipeTriggers.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        pipeTriggers.forEach((b, i) => b.classList.toggle('is-active', i === idx));
        const d = pipeData[idx];
        if (d) {
          if (rawSlipBadge) rawSlipBadge.textContent = d.badge;
          if (rawSlipCode) rawSlipCode.innerHTML = d.code;
          if (lensQuote) lensQuote.textContent = d.lens;
          if (questName) questName.textContent = d.quest;
          if (questImpact) questImpact.textContent = d.impact;
        }
      });
    });

    // 8. Seats dispatch pulse
    const dispatchBtn = document.querySelector('.jl-dispatch-action-btn');
    const handoffThreads = document.querySelectorAll('.jl-handoff-thread');
    const driverStatus = document.querySelector('.jl-driver-status-tag');
    if (dispatchBtn) {
      dispatchBtn.addEventListener('click', () => {
        dispatchBtn.textContent = '✓ Dispatched to Leo\\'s Phone';
        dispatchBtn.classList.add('is-dispatched');
        handoffThreads.forEach(t => t.classList.add('is-pulsing'));
        if (driverStatus) driverStatus.textContent = 'Stop Loaded & Route Active';
      });
    }

    // 9. Trust approval mechanical stamp
    const timeChips = document.querySelectorAll('.jl-time-chip');
    const stampBtn = document.querySelector('.jl-mechanical-stamp-btn');
    const stampActionArea = document.querySelector('.jl-stamp-action-area');
    const previewBody = document.querySelector('.jl-message-body');
    let chosenTime = '8:00 AM';

    timeChips.forEach(chip => {
      chip.addEventListener('click', () => {
        timeChips.forEach(c => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        chosenTime = chip.textContent.includes('8') ? '8:00 AM' : '9:00 AM';
        if (previewBody) {
          previewBody.textContent = '“Hi Dr. Thorne — noticed you haven’t had a pickup since our Tuesday schedule shifted. We’ve added an ' + chosenTime + ' window on your block. Would you like us to grab your linens tomorrow morning?”';
        }
      });
    });

    if (stampBtn && stampActionArea) {
      stampBtn.addEventListener('click', () => {
        stampActionArea.innerHTML = '<div class=\"jl-stamp-seal-imprint\"><div class=\"jl-seal-circle\"><span class=\"jl-seal-text\">APPROVED &amp; QUEUED FOR ' + chosenTime + ' FROM YOUR IPHONE</span><span class=\"jl-seal-date\">VERIFIED OPERATOR OK</span></div></div>';
      });
    }

    // 10. Live Proof clipboard dispatch tabs
    const dispatchTabs = document.querySelectorAll('.jl-dispatch-tab');
    const dispatchCard = document.querySelector('.jl-dispatch-typewritten-card');

    const logs = [
      {
        meta: '<span>SECTOR: Silver Lake &amp; Echo Park Loop</span><span>DATE: Verified Tuesday Sweep</span>',
        mission: 'Sable identified 14 homes with quiet porch lanterns along the existing morning van run. Founder walked the block with personalized handwritten dockets.',
        outcome: '3 inactive regular accounts reconnected on the spot. 2 new recurring pickups scheduled for Thursday. <strong>+$310 revenue recovered in 90 minutes.</strong>',
        quote: '“Maya R.: ‘I wondered where you guys went! Put me down for Tuesdays again.’”'
      },
      {
        meta: '<span>SECTOR: Century Park East (Tower B)</span><span>DATE: Verified Thursday Sweep</span>',
        mission: 'Orren routed 8 executive accounts that lapsed following a building concierge desk transition. Re-established ground-level delivery protocol with building superintendent.',
        outcome: 'Dedicated laundry drop bin re-approved by building security. 4 accounts resumed weekly service. <strong>+$420/month recurring volume secured.</strong>',
        quote: '“Concierge desk: ‘We can hold the bins at the south gate. Saves us 3 interruptions every morning.’”'
      },
      {
        meta: '<span>SECTOR: Wilshire Commercial Corridor</span><span>DATE: Verified Friday Sweep</span>',
        mission: 'Rook drafted commercial introduction dockets for 2 boutique fitness studios located directly across the avenue from existing customer stops.',
        outcome: 'Both studios signed bi-weekly towel turnover agreements on first visit. <strong>+$560/month recurring margin added with zero extra driver fuel.</strong>',
        quote: '“Studio Manager: ‘Our current service is late every Monday. If you are already on this block, we are switching.’”'
      }
    ];

    function showLog(idx) {
      dispatchTabs.forEach((t, i) => t.classList.toggle('is-active', i === idx));
      const log = logs[idx];
      if (log && dispatchCard) {
        dispatchCard.innerHTML = '<div class=\"jl-dispatch-meta-line\">' + log.meta + '</div>' +
          '<div class=\"jl-dispatch-section\"><strong class=\"jl-dispatch-label\">The Attempted Mission:</strong><p class=\"jl-dispatch-text\">' + log.mission + '</p></div>' +
          '<div class=\"jl-dispatch-section\"><strong class=\"jl-dispatch-label\">The Actual Outcome:</strong><p class=\"jl-dispatch-text\">' + log.outcome + '</p></div>' +
          '<div class=\"jl-dispatch-section\"><strong class=\"jl-dispatch-label\">The World Reaction:</strong><blockquote class=\"jl-dispatch-quote\">' + log.quote + '</blockquote></div>' +
          '<div class=\"jl-dispatch-verified-footer\"><span class=\"jl-ledger-stamp\">LOGGED TO LIVE PUBLIC OPERATOR RUN</span><span>Cohort 01: 50 active businesses in public launch</span></div>';
      }
    }

    dispatchTabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => showLog(idx));
    });

    // 11. Pricing toggle
    const billingBtns = document.querySelectorAll('.jl-billing-toggle-btn');
    const costLarge = document.querySelector('.jl-cost-large');
    const costNote = document.querySelector('.jl-cost-annual-note');

    billingBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        billingBtns.forEach((b, i) => b.classList.toggle('is-active', i === idx));
        if (idx === 0) {
          if (costLarge) costLarge.innerHTML = '$49<span class=\"jl-cost-period\">/month</span>';
          if (costNote) costNote.textContent = 'Billed monthly. Switch to annual for $468/year';
        } else {
          if (costLarge) costLarge.innerHTML = '$39<span class=\"jl-cost-period\">/month</span>';
          if (costNote) costNote.textContent = 'Billed annually at $468/year (saves $120 annually)';
        }
      });
    });
  })();
</script>
  `;

  // Full HTML document
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>JOYSTICK · Knows your business, then makes your next move a game.</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* Reset & Base */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #fbfaf6;
      color: #111111;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow-x: hidden;
    }
    /* INLINED STYLESHEET */
    ${cssContent}
  </style>
</head>
<body>
  ${processedHtml}
  ${clientScript}
</body>
</html>`;

  // Write full outputs (with base64 embedded images)
  const fullTargets = [
    path.resolve(process.cwd(), 'client/public/joystick-landing-standalone.html'),
    path.resolve(process.cwd(), 'dist/public/joystick-landing-standalone.html'),
    '/Users/adamwrightpfi/Desktop/joystick-landing-complete.html',
    '/Users/adamwrightpfi/.gemini/antigravity/brain/3de77bf6-3269-4ba2-9e10-2e225eb5ca43/joystick-landing-complete.html'
  ];

  for (const target of fullTargets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, fullHtml, 'utf8');
      console.log(`✓ Exported (Full Offline): ${target} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`✗ Error writing to ${target}:`, (err as Error).message);
    }
  }

  // Also write lightweight ChatGPT-optimized version (clean HTML with https://gojoystick.com URLs, no base64 bloat)
  let chatgptHtml = renderedContent;
  for (const webUrl of Object.keys(imageMap)) {
    chatgptHtml = chatgptHtml.split(`src="${webUrl}"`).join(`src="https://gojoystick.com${webUrl}"`);
  }

  const lightHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <title>JOYSTICK · Knows your business, then makes your next move a game.</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* Reset & Base */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #fbfaf6;
      color: #111111;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow-x: hidden;
    }
    /* INLINED STYLESHEET */
    ${cssContent}
  </style>
</head>
<body>
  ${chatgptHtml}
  ${clientScript}
</body>
</html>`;

  const lightTargets = [
    '/Users/adamwrightpfi/Desktop/joystick-landing-chatgpt.html',
    '/Users/adamwrightpfi/.gemini/antigravity/brain/3de77bf6-3269-4ba2-9e10-2e225eb5ca43/joystick-landing-chatgpt.html',
    path.resolve(process.cwd(), 'client/public/joystick-landing-chatgpt.html')
  ];

  for (const target of lightTargets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, lightHtml, 'utf8');
      console.log(`✓ Exported (ChatGPT-Optimized): ${target} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`✗ Error writing to ${target}:`, (err as Error).message);
    }
  }

  console.log('Export complete! All files generated with embedded styles and images.');
}

main().catch(err => {
  console.error('Fatal export error:', err);
  process.exit(1);
});
