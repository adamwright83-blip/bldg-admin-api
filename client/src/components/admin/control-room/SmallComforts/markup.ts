/** Small Comforts' DOM, mounted once into the game's root. The Game owns it after that (React never re-renders it). */
export const SMALL_COMFORTS_MARKUP = /* html */ `
<div id="app"></div>

<div id="title" class="overlay center show">
  <div class="logo">Small<br />Comforts</div>
  <p class="sub">A tiny guesthouse in a lost-property suitcase.</p>
  <button id="btn-begin" class="big">Tap to begin</button>
  <p class="fine">Sound on. Rain included.</p>
</div>

<button id="skip" class="pill">Skip ›</button>
<button id="btn-exit" aria-label="Back to Lantern City">‹ Lantern City</button>
<div id="nightlabel"></div>
<button id="btn-mute" class="round" aria-label="Sound">🔊</button>
<div id="guestline"></div>
<div id="hotelstatus"></div>
<div id="story"></div>
<div id="hint"></div>
<div id="toast"></div>

<div id="dock">
  <div id="tray">
    <button data-kind="bed"><span class="ic">🛏️</span><span class="lb">Bed</span><span class="badge">2</span></button>
    <button data-kind="blanket"><span class="ic">🧶</span><span class="lb">Blanket</span><span class="badge">2</span></button>
    <button data-kind="armchair"><span class="ic">🪑</span><span class="lb">Armchair</span><span class="badge">2</span></button>
    <button data-kind="lamp"><span class="ic">💡</span><span class="lb">Lamp</span><span class="badge">2</span></button>
    <button data-kind="table"><span class="ic">🧵</span><span class="lb">Spool</span><span class="badge">2</span></button>
    <button data-kind="rug"><span class="ic">🟥</span><span class="lb">Rug</span><span class="badge">1</span></button>
    <button data-kind="scissors"><span class="ic">✂️</span><span class="lb">Scissors</span></button>
  </div>
  <div id="anatomy" aria-label="Suitcase tricks">
    <button data-project="lining_stairs"><span class="ic">🪜</span><span><b>Fold lining</b><small>Make steps</small></span></button>
    <button data-project="strap_hammock"><span class="ic">🧷</span><span><b>Tension straps</b><small>Make a hammock</small></span></button>
    <button data-project="pocket_loft"><span class="ic">🧳</span><span><b>Open pocket</b><small>Make a loft</small></span></button>
  </div>
  <div id="actions">
    <button id="btn-undo" class="act" disabled>↶<span>Undo</span></button>
    <button id="btn-rotate" class="act">⟳<span>Rotate</span></button>
    <button id="btn-pick" class="act" disabled>✋<span>Pick up</span></button>
  </div>
  <button id="btn-bell" aria-label="Open the hotel to the next arrival"><span class="bellic">🔔</span><span>Open the hotel</span></button>
</div>

<div id="card" class="overlay center">
  <div class="paper">
    <div class="small">Morning note from</div>
    <h2 id="note-from"></h2>
    <p id="note-text"></p>
    <div id="note-tag"></div>
    <button id="btn-next" class="big">Next guest →</button>
  </div>
</div>

<div id="end" class="overlay center">
  <div class="endcard">
    <h2>The guesthouse is open.</h2>
    <img id="end-snap" alt="Your guesthouse" />
    <ul id="end-notes"></ul>
    <div class="row">
      <button id="btn-save" class="big alt">Save snapshot</button>
      <button id="btn-again" class="big alt">Play again</button>
      <button id="btn-leave" class="big">Back to Lantern City</button>
    </div>
  </div>
</div>
`;
