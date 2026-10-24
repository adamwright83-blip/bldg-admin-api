/* Joystick hero — dependency-free, authored pose animation.
   Each actor atlas is a 2x2 sheet: idle / catch / reaction / payoff.
   Copy and adventure selection are deliberately independent of this timeline. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = ['mara', 'rook', 'sable', 'luma'];
  const descriptions = [
    'Mara, a dry-witted fox: an enormous key interrupts her manicure. She recovers with a conspiratorial smirk.',
    'Rook, an overconfident explorer bird: a jetpack arrives and takes him for an unexpected ride.',
    'Sable, an unimpressed cat: a stealth mask appears, she avoids a laser, then vanishes into smoke.',
    'Luma, a daydreaming rabbit: a giant cartoon bazooka arrives. She becomes alarmingly committed.'
  ];
  const positions = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'];
  const scene = $('scene'), pose = $('pose'), performer = $('performer'), prop = $('prop');
  const castButtons = [...document.querySelectorAll('[data-cast]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const atlases = names.map(name => {
    const img = new Image(); img.src = '/joystick-home/assets/acting/' + name + '.webp'; return img;
  });
  // Each dropped item is cut from the pose that catches it, so the falling item and the held item match.
  const propImages = names.map(name => { const img = new Image(); img.src = '/joystick-home/assets/acting/prop-' + name + '.webp'; return img; });
  let current = 0, elapsed = reduced.matches ? 4900 : 0, paused = reduced.matches;
  let lastTime = null, frameId = 0, ready = false, inView = true;
  const cycleLength = 8100;
  const clamp = x => Math.max(0, Math.min(1, x));
  const ease = x => 1 - Math.pow(1 - clamp(x), 3);
  const modalOpen = () => $('sample-dialog').open || $('about-dialog').open;
  function setActor(index) {
    current = index;
    scene.dataset.character = names[index];
    document.body.dataset.companion = names[index];
    pose.style.backgroundImage = 'url("/joystick-home/assets/acting/' + names[index] + '.webp")';
    performer.setAttribute('aria-label', descriptions[index]);
    castButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }
  function paint(time) {
    const beat = time < 1400 ? 'idle' : time < 1900 ? 'drop' : time < 2700 ? 'impact' : time < 4400 ? 'reaction' : 'payoff';
    scene.dataset.beat = beat;
    const cell = time < 1900 ? 0 : time < 2700 ? 1 : time < 4400 ? 2 : 3;
    pose.style.backgroundPosition = positions[cell];
    const fadeIn = clamp(time / 280);
    const fadeOut = time > 7600 ? 1 - clamp((time - 7600) / 500) : 1;
    scene.style.opacity = String(Math.min(fadeIn, fadeOut));
    let y = 0, x = 0, angle = 0, sx = 1, sy = 1;
    if (time >= 1900 && time < 2700 && current !== 2) {
      const impact = (time - 1900) / 800;
      const weight = Math.sin(impact * Math.PI) * Math.exp(-impact * 2.8);
      y = weight * 24; sx = 1 + weight * .045; sy = 1 - weight * .065;
      angle = weight * (current === 1 ? -5 : 2.5);
    }
    if (current === 1 && time >= 2700) {
      const lift = ease((time - 2700) / 900);
      y = -22 * lift + Math.sin((time - 2700) / 350) * 5;
      x = Math.sin((time - 2700) / 650) * 7 * lift;
      angle = Math.sin((time - 2700) / 570) * 3.5 * lift;
    }
    if (current === 0 && time >= 4400 && time < 4900) {
      angle = -2 * Math.sin((time - 4400) / 500 * Math.PI);
    }
    performer.style.transform = 'translateX(-50%) translate(' + x + 'px,' + y + 'px) rotate(' + angle + 'deg) scale(' + sx + ',' + sy + ')';
    prop.style.opacity = beat === 'drop' ? '1' : '0';
    if (beat === 'drop') {
      const fall = clamp((time - 1400) / 500);
      // Falls in from above the stage and lands exactly where the catch pose holds it (the jetpack lands on Rook's back).
      const drop = performer.clientHeight * 0.75;
      prop.style.transform = 'translateY(' + (-drop * (1 - fall * fall)) + 'px) rotate(' + ((1 - fall) * -12) + 'deg)';
      if (current === 2) prop.style.opacity = String(fall);
    }
    const smokeTime = current === 2 ? clamp((time - 4400) / 750) : 0;
    document.querySelectorAll('.smoke').forEach((puff, i) => {
      const active = current === 2 && time >= 4400 && time < 5150;
      puff.style.opacity = active ? String((1 - smokeTime) * .35) : '0';
      puff.style.transform = 'translate(' + ((i - 1) * smokeTime * 65) + 'px,' + (-smokeTime * 35) + 'px) scale(' + (1 + smokeTime) + ')';
    });
  }
  function running() { return ready && !paused && !document.hidden && inView && !modalOpen(); }
  function tick(now) {
    frameId = 0;
    if (!running()) { lastTime = null; return; }
    if (lastTime !== null) elapsed += Math.min(now - lastTime, 80);
    lastTime = now;
    if (elapsed >= cycleLength) { elapsed = 0; setActor((current + 1) % names.length); }
    paint(elapsed);
    frameId = requestAnimationFrame(tick);
  }
  function resumeIfNeeded() {
    if (!running()) { cancelAnimationFrame(frameId); frameId = 0; lastTime = null; }
    else if (!frameId) frameId = requestAnimationFrame(tick);
  }
  function updatePauseControl() {
    $('pause').setAttribute('aria-pressed', String(paused));
    $('pause').setAttribute('aria-label', paused ? 'Play character animation' : 'Pause character animation');
    $('pause').firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
  }
  castButtons.forEach((button, i) => button.addEventListener('click', () => {
    setActor(i); elapsed = paused ? 4900 : 280; lastTime = null; paint(elapsed); resumeIfNeeded();
  }));
  $('pause').addEventListener('click', () => { paused = !paused; updatePauseControl(); resumeIfNeeded(); });
  $('replay').addEventListener('click', () => { elapsed = 0; paused = false; lastTime = null; updatePauseControl(); paint(0); resumeIfNeeded(); });
  document.addEventListener('visibilitychange', resumeIfNeeded);
  reduced.addEventListener('change', e => {
    paused = e.matches; if (paused) { elapsed = 4900; paint(elapsed); }
    updatePauseControl(); resumeIfNeeded();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { inView = entries[0].isIntersecting; resumeIfNeeded(); }, {threshold: .05}).observe(scene);
  }
  setActor(0); updatePauseControl();
  Promise.allSettled([...atlases, ...propImages].map(img => img.decode())).then(results => {
    ready = true;
    const failed = results.some(result => result.status === 'rejected');
    if (failed) {
      paused = true; updatePauseControl();
      pose.style.backgroundImage = 'url("/joystick-home/assets/companions/mara.webp")';
      pose.style.backgroundSize = 'contain'; pose.style.backgroundPosition = 'center';
      $('pause').disabled = true; $('replay').disabled = true;
      castButtons.forEach(b => b.disabled = true);
      scene.style.opacity = '1';
      console.warn('A character sheet did not load. Showing static companion artwork.');
      return;
    }
    paint(elapsed); resumeIfNeeded();
  });

  // Adventure tabs never follow the automatic character loop.
  let world = 'cozy';
  const tabs = [...document.querySelectorAll('[data-world]')];
  function chooseWorld(value, focus = false) {
    world = value;
    tabs.forEach(tab => {
      const selected = tab.dataset.world === value;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $('panel-' + tab.dataset.world).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => chooseWorld(tab.dataset.world));
    tab.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + 1) % tabs.length;
      chooseWorld(tabs[index].dataset.world, true);
    });
  });

  // Illustrative browser-local sample. No messaging, CRM, or calendar APIs.
  const sample = $('sample-dialog'), about = $('about-dialog');
  let sampleWorld = 'cozy', draft = 'Hey Marisol! Hope your fall is going well. If you need a hand with laundry again, I’d love to help. — Adam';
  const story = $('sample-story'), actions = $('sample-actions');
  function button(label, handler, className = 'choice') {
    const b = document.createElement('button'); b.className = className; b.textContent = label; b.addEventListener('click', handler); actions.appendChild(b); return b;
  }
  function content(title, html) { $('sample-title').textContent = title; story.innerHTML = html; actions.replaceChildren(); if (sample.open) { $('sample-title').tabIndex = -1; $('sample-title').focus({preventScroll:true}); } }
  function startSample(mode) {
    sampleWorld = mode;
    $('sample-image').src = mode === 'cozy' ? '/joystick-home/assets/lantern-city.webp' : '/joystick-home/assets/adventure.webp';
    $('sample-image').alt = mode === 'cozy' ? 'Animal neighbors in a sunny Lantern City courtyard' : 'Clockhead overlooking the golden courtyard';
    $('sample-location').textContent = mode === 'cozy' ? 'LANTERN CITY · SILVER LAKE' : 'TRAILBLAZER · THE FIRST KINGDOM';
    mode === 'cozy' ? cozyErrand() : roadIntro();
    if (!sample.open) sample.showModal();
    resumeIfNeeded();
  }
  function cozyErrand() {
    content('Hazel has a very prickly problem.', '<p>“I need to write an apology to the squirrel next door. Apparently, ‘your acorns are an eyesore’ was not constructive feedback.”</p><p>There’s an ink well on the bench. Hazel has just shed a perfectly good quill.</p>');
    button('Dip the quill in the ink well.', cozyFriend);
    button('Suggest a second strongly worded complaint.', () => {
      let feedback = story.querySelector('.feedback');
      if (!feedback) { feedback = document.createElement('p'); feedback.className = 'feedback'; feedback.setAttribute('role','status'); story.appendChild(feedback); }
      feedback.textContent = '“Tempting. But I’m running out of neighbors.” Try the quill.';
    });
  }
  function cozyFriend() {
    content('“You should meet my friend.”', '<p>Hazel puts the finishing touch on her apology. A fox in a blue hat wanders over.</p><p>“Marisol! This is the person who saved me from another neighborhood meeting.”</p><p>In your own game, this is where a real past customer becomes part of the story. In this sample, Marisol hasn’t ordered laundry service in 82 days.</p>');
    button('Have a little catch-up.', cozyDraft, 'primary');
  }
  function cozyDraft() {
    content('A little hello. In your own words.', '<p>“It’s been a busy fall,” says Marisol. “Good to see you around again.”</p><p>Take a moment to make this note sound like you.</p>');
    const label = document.createElement('label'); label.htmlFor = 'draft-message'; label.textContent = 'YOUR MESSAGE TO MARISOL';
    const textarea = document.createElement('textarea'); textarea.id = 'draft-message'; textarea.maxLength = 500; textarea.value = draft;
    actions.append(label, textarea);
    const timeLabel = document.createElement('label'); timeLabel.htmlFor = 'sample-time'; timeLabel.textContent = 'WHEN WOULD YOU LIKE IT TO GO?';
    const select = document.createElement('select'); select.id = 'sample-time';
    ['Tomorrow at 10:00 AM', 'Tomorrow at 2:00 PM'].forEach(text => { const option = document.createElement('option'); option.textContent = text; select.appendChild(option); });
    actions.append(timeLabel, select);
    const approve = button('Approve this sample note ↗', () => {
      draft = textarea.value;
      const selectedTime = select.value;
      content('A little less left unsaid.', '<p>Your note is ready. In the full game, you review and approve the real message before it goes out.</p>');
      const status = document.createElement('p'); status.className = 'feedback'; status.setAttribute('role','status');
      status.textContent = 'Sample delivery time: ' + selectedTime + '. Nothing has been sent or scheduled.'; story.appendChild(status);
      button('Visit the other world ↗', () => startSample('road'), 'primary');
      button('Back to the village', cozyErrand, 'secondary');
    }, 'primary');
    textarea.addEventListener('input', () => { approve.disabled = !textarea.value.trim(); });
  }
  function roadIntro() {
    content('“Come back when the time is right.”', '<p>Clockhead would love you to wait until next week. Or the week after that.</p><p>His hologram guards six locked doors. Behind one of them is the real villain.</p>');
    button('Dodge the hologram. Look for an opening.', roadMission, 'primary');
  }
  function roadMission() {
    content('A real introduction. A way in.', '<p>In this example, there’s a gap between your afternoon deliveries and a nearby building you’ve been meaning to visit.</p><p>Your mission: meet the person who handles resident amenities. Ask whether you can send a short introduction to your laundry service.</p><p>The real game fits the visit into your route. For this sample, choose how the introduction went.</p>');
    button('Met the manager. They asked for information.', roadKey);
    button('Manager was out. Learned when to return.', roadKey);
  }
  function roadKey() {
    content('You have a name. And a key.', '<p>A useful next step in the real world opens a door in this one. The clock is still talking. You don’t have to listen.</p><p>Choose a tower door.</p>');
    const doors = document.createElement('div'); doors.className = 'doors'; doors.setAttribute('aria-label','Choose a tower door');
    for (let i = 1; i <= 6; i++) { const b = document.createElement('button'); b.textContent = String(i); b.setAttribute('aria-label','Open tower door ' + i); b.onclick = () => roadEnd(i); doors.appendChild(b); }
    actions.appendChild(doors);
  }
  function roadEnd(door) {
    content(door === 4 ? '“You weren’t supposed to find me.”' : 'Not here. But you’re getting closer.', door === 4 ? '<p>Clockhead’s hiding place is open. That introduction got you further than another week of waiting.</p><p>This is only a glimpse. The full adventure continues as you make real progress.</p>' : '<p>An empty room. One fewer place for Clockhead to hide—and a real person you can follow up with.</p><p>The next useful step brings the next key.</p>');
    button('Try Lantern City ↗', () => startSample('cozy'), 'primary');
    button('Replay this sample', roadIntro, 'secondary');
  }
  document.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => startSample(b.dataset.play || world)));
  document.querySelectorAll('[data-open-about]').forEach(b => b.addEventListener('click', () => { about.showModal(); resumeIfNeeded(); }));
  $('about-play').onclick = () => { about.close(); startSample(world); };
  document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
  [sample, about].forEach(dialog => { dialog.addEventListener('close', resumeIfNeeded); });

  // Small-screen menu: the header's three links behind one 44px pill.
  const menuButton = $('nav-menu'), menu = $('mobile-menu');
  function setMenu(open) { menu.hidden = !open; menuButton.setAttribute('aria-expanded', String(open)); }
  menuButton.addEventListener('click', () => setMenu(menu.hidden));
  menu.querySelectorAll('[data-menu-item]').forEach(item => item.addEventListener('click', () => setMenu(false)));
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuButton) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuButton.focus(); } });
  matchMedia('(min-width: 761px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
})();
