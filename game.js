/*
  Detective Raccoon - minimal scene system
  - Outside: background = assets/outside_house.jpg
    - Raccoon idles by default (idle.gif). On movement, switches to walking.gif.
    - Move with WASD or Arrow keys.
    - When near the house door, show an "Enter house" prompt that can be activated by Enter or click.
  - Inside: background = assets/static_downstairs.png (wide). Camera scrolls horizontally following the raccoon.
*/

// -------- Config (tweak as needed) --------
const CONFIG = {
  raccoon: {
    width: 540,            // px (mirrors styles.css)
    speed: 250,            // px per second (slightly faster)
    idleSrc: 'assets/idle.gif',
    walkSrc: 'assets/walking.gif',
    // Start closer to the house so the door is reachable without scrolling outside
    spawnOutside: { xPct: 60, yPct: 78 },   // starting point on outside image
    spawnInside: { x: 140, yFromBottom: 40 } // starting point inside (pixels)
  },
  outside: {
    bgSrc: 'assets/outside_house.jpg',
    // Door hotspot on the outside image (as percentages of bg natural size for easy tuning)
    door: {
      xPct: 74,     // approximate door horizontal location in percent of width
      yPct: 66,     // approximate door vertical location in percent of height
      radius: 300   // proximity in pixels to show the prompt (wider range)
    }
  },
  inside: {
    bgSrc: 'assets/static_downstairs.png',
    // Exit hotspot location inside (percent of image). Tweak as needed.
    exit: { xPct: 3, yPct: 72, radius: 160 },
    // Suitcase hotspot inside (under the window)
    // widthPct controls how wide the hotspot image is relative to world width
    suitcase: { xPct: 22, yPct: 96, radius: 220, widthPct: 27 }
  },
  physics: {
    gravity: 1800,     // px/s^2 downward
    jumpSpeed: 900,    // initial upward speed
    groundOffsetOutside: 140, // px from bottom (raised by 100px)
    groundOffsetInside: 90, // lowered ground by 50px (from 140)
    climbSpeed: 700,   // px/s when holding up/down (faster so up arrow feels responsive)
    ceilingOffsetOutside: 10,
    ceilingOffsetInside: 10
  },
  transitionMs: 500
};

// -------- State --------
let scene = 'outside'; // 'outside' | 'inside'
let keys = new Set();
let lastTime = 0;
let worldW = 0, worldH = 0; // natural bg size per scene
let racX = 0, racY = 0;     // raccoon feet position in world coordinates
let cameraX = 0, cameraY = 0; // camera top-left in world coords
let doorWorld = { x: 0, y: 0 }; // outside door
let exitWorld = { x: 0, y: 0 }; // inside exit
let canInteract = false;
let canOpenSuitcase = false;
let lastFacing = 1; // 1 = facing right, -1 = facing left
let vy = 0;         // vertical velocity for jump/gravity
let onGround = false;
let chatTimerId = null; // auto-hide timer for chat bubble
let overlayOpen = false; // inventory open state
let suitcaseWorld = { x: 0, y: 0 };

// DOM elements
const gameEl = document.getElementById('game');
const bgEl = document.getElementById('bg');
const racEl = document.getElementById('raccoon');
const worldEl = document.getElementById('world');
const interactBtn = document.getElementById('interact');
const fadeEl = document.getElementById('fade');
const chatEl = document.getElementById('chat');
// dynamically created elements
let suitcaseHotspot = null;
let inventoryOverlay = null;
let mouseOverSuitcase = false;

// -------- Utilities --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setRaccoonImage(src) { if (racEl.src.endsWith(src)) return; racEl.src = src; }

function viewportSize() {
  // Use game container's client size to honor the screenshot aspect ratio
  const rect = gameEl.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function centerCameraOn(x, y) {
  const { w, h } = viewportSize();
  const targetX = clamp(x - w / 2, 0, Math.max(0, worldW - w));
  const targetY = clamp(y - h / 2, 0, Math.max(0, worldH - h));
  cameraX = targetX;
  cameraY = targetY;
  worldEl.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
}

function placeRaccoon() {
  racEl.style.left = `${racX}px`;
  racEl.style.top = `${racY}px`;
}

function placeBtnAtWorld(el, x, y, yOffset = -40) {
  const vx = x - cameraX;
  const vy = y - cameraY + yOffset;
  const wasHidden = el.classList.contains('hidden');
  if (wasHidden) el.classList.remove('hidden');
  const w = el.offsetWidth || 0;
  const h = el.offsetHeight || 0;
  el.style.left = `${vx - w / 2}px`;
  el.style.top = `${vy - h}px`;
  if (wasHidden) el.classList.add('hidden');
}

function placeSuitcaseAtFixedWorld(el, x, y) {
  // Place suitcase at fixed world coordinates (doesn't move with camera)
  const wasHidden = el.classList.contains('hidden');
  if (wasHidden) el.classList.remove('hidden');
  const w = el.offsetWidth || 0;
  const h = el.offsetHeight || 0;
  el.style.left = `${x - w / 2}px`;
  el.style.top = `${y - h}px`;
  if (wasHidden) el.classList.add('hidden');
}

function placeInteractButtonAtWorld(x, y) {
  // Convert world coords to viewport coords using camera offset
  const vx = x - cameraX;
  const vy = y - cameraY - 40; // lift above door a bit
  // Ensure measurements available by temporarily making it visible
  const wasHidden = interactBtn.classList.contains('hidden');
  if (wasHidden) interactBtn.classList.remove('hidden');
  const w = interactBtn.offsetWidth || 0;
  const h = interactBtn.offsetHeight || 0;
  
  // Move exit chat bubble right when at far left to keep it visible
  const leftOffset = (scene === 'inside' && interactBtn.textContent.includes('Exit')) ? 50 : 0;
  
  interactBtn.style.left = `${vx - w / 2 + leftOffset}px`;
  interactBtn.style.top = `${vy - h}px`;
  if (wasHidden && !canInteract) interactBtn.classList.add('hidden');
}

function placeChatAtWorld(x, y) {
  // place a bubble above a world position accounting for camera offset
  const vx = x - cameraX;
  const vyWorld = y - cameraY; // base point
  // Ensure we can measure size
  const wasHidden = chatEl.classList.contains('hidden');
  if (wasHidden) chatEl.classList.remove('hidden');
  const w = chatEl.offsetWidth || 0;
  const h = chatEl.offsetHeight || 0;
  // Position bubble centered horizontally with a small upward offset
  chatEl.style.left = `${vx - w / 2}px`;
  chatEl.style.top = `${vyWorld - h - 16}px`;
  if (wasHidden && chatTimerId === null) chatEl.classList.add('hidden');
}

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function fadeOutIn(cb) {
  show(fadeEl);
  // Force reflow then fade in
  requestAnimationFrame(() => {
    fadeEl.classList.add('show');
    setTimeout(() => {
      cb?.();
      // Fade out back
      requestAnimationFrame(() => {
        fadeEl.classList.remove('show');
        setTimeout(() => hide(fadeEl), CONFIG.transitionMs);
      });
    }, CONFIG.transitionMs);
  });
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function updateDoorWorldFromScaled() {
  const { xPct, yPct } = CONFIG.outside.door;
  doorWorld.x = (xPct / 100) * worldW;
  doorWorld.y = (yPct / 100) * worldH;
}

function updateExitWorldFromScaled() {
  const e = CONFIG.inside.exit;
  if (!e) return;
  exitWorld.x = (e.xPct / 100) * worldW;
  exitWorld.y = (e.yPct / 100) * worldH;
}

function updateSuitcaseWorldFromScaled() {
  const s = CONFIG.inside.suitcase;
  if (!s) return;
  suitcaseWorld.x = (s.xPct / 100) * worldW;
  suitcaseWorld.y = (s.yPct / 100) * worldH;
}

function spawnRaccoonOutside() {
  const { xPct, yPct } = CONFIG.raccoon.spawnOutside;
  racX = (xPct / 100) * worldW;
  racY = (yPct / 100) * worldH;
}

function spawnRaccoonInside() {
  racX = CONFIG.raccoon.spawnInside.x;
  // position near bottom based on scaled height
  racY = worldH - CONFIG.raccoon.spawnInside.yFromBottom;
}

function fitBackgroundToViewportHeight(imgEl) {
  const { h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  const scale = h / natH; // fit height
  const dispW = Math.round(natW * scale);
  const dispH = Math.round(natH * scale);
  worldW = dispW;
  worldH = dispH;
  bgEl.style.width = `${dispW}px`;
  bgEl.style.height = `${dispH}px`;
  worldEl.style.width = `${dispW}px`;
  worldEl.style.height = `${dispH}px`;
}

function fitBackgroundToViewportCover(imgEl) {
  const { w, h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  const scale = Math.max(w / natW, h / natH); // cover: no empty space
  const dispW = Math.round(natW * scale);
  const dispH = Math.round(natH * scale);
  worldW = dispW;
  worldH = dispH;
  bgEl.style.width = `${dispW}px`;
  bgEl.style.height = `${dispH}px`;
  worldEl.style.width = `${dispW}px`;
  worldEl.style.height = `${dispH}px`;
}

// Ground line (feet Y position)
function getGroundY() {
  const off = scene === 'outside' ? CONFIG.physics.groundOffsetOutside : CONFIG.physics.groundOffsetInside;
  return worldH - off;
}

function getCeilingY() {
  const off = scene === 'outside' ? CONFIG.physics.ceilingOffsetOutside : CONFIG.physics.ceilingOffsetInside;
  return off;
}

// -------- Scenes --------
async function enterOutside() {
  scene = 'outside';
  const img = await loadImage(CONFIG.outside.bgSrc);
  bgEl.src = CONFIG.outside.bgSrc;
  // After image is set, ensure sizes reflect fit-height scaling
  await img.decode?.();
  // Outside uses cover to ensure no empty space and allow horizontal scroll
  fitBackgroundToViewportCover(img);

  updateDoorWorldFromScaled();
  spawnRaccoonOutside();
  // snap to ground on enter
  racY = getGroundY(); vy = 0; onGround = true;
  setRaccoonImage(CONFIG.raccoon.idleSrc);
  placeRaccoon();
  centerCameraOn(racX, racY);
  
  // Ensure suitcase is hidden when outside
  mouseOverSuitcase = false;
  canOpenSuitcase = false;
  if (suitcaseHotspot) {
    hide(suitcaseHotspot);
    suitcaseHotspot.classList.remove('hover-active');
  }
}

async function enterInside() {
  scene = 'inside';
  const img = await loadImage(CONFIG.inside.bgSrc);
  bgEl.src = CONFIG.inside.bgSrc;
  await img.decode?.();
  fitBackgroundToViewportHeight(img);

  spawnRaccoonInside();
  // snap to ground on enter
  racY = getGroundY(); vy = 0; onGround = true;
  setRaccoonImage(CONFIG.raccoon.idleSrc);
  placeRaccoon();
  updateExitWorldFromScaled();
  updateSuitcaseWorldFromScaled();
  // scale hotspot image width to world size
  if (suitcaseHotspot) {
    const s = CONFIG.inside.suitcase;
    if (s && s.widthPct) {
      suitcaseHotspot.style.width = `${(s.widthPct / 100) * worldW}px`;
    }
  }
  centerCameraOn(racX, racY);

  // Show chat bubble briefly when entering the house
  if (chatTimerId) { clearTimeout(chatTimerId); chatTimerId = null; }
  chatEl.textContent = 'Not too shabby.. Eh?';
  show(chatEl);
  // initial placement above raccoon (feet are at racY)
  placeChatAtWorld(racX, racY - 220);
  chatTimerId = setTimeout(() => {
    hide(chatEl);
    chatTimerId = null;
  }, 2600);
}

function tryEnterHouse() {
  if (scene !== 'outside' || !canInteract) return;
  fadeOutIn(async () => {
    await enterInside();
  });
}

function tryExitHouse() {
  if (overlayOpen) return; // ignore while inventory is open
  if (scene !== 'inside' || !canInteract) return;
  fadeOutIn(async () => {
    await enterOutside();
    // Place raccoon just outside the door on ground
    racX = doorWorld.x;
    racY = getGroundY();
    placeRaccoon();
    centerCameraOn(racX, racY);
  });
}

function openInventory() {
  if (overlayOpen) return;
  overlayOpen = true;
  inventoryOverlay?.classList.remove('hidden');
}

function closeInventory() {
  if (!overlayOpen) return;
  overlayOpen = false;
  inventoryOverlay?.classList.add('hidden');
}

// -------- Input --------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (overlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeInventory(); }
    return;
  }
  if (['arrowleft','arrowright','a','d'].includes(k)) {
    keys.add(k);
  }
  if (k === 'enter') {
    if (scene === 'outside') tryEnterHouse();
    else if (scene === 'inside') tryExitHouse();
  }
  // Jump: spacebar only
  if ((k === ' ' || k === 'spacebar' || k === 'space') && onGround) {
    vy = -CONFIG.physics.jumpSpeed;
    onGround = false;
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
});

interactBtn.addEventListener('click', () => tryEnterHouse());

// Create overlay and suitcase button in UI
function createSuitcaseUI() {
  const ui = document.getElementById('ui');
  // hotspot image (briefcase under window) - append to world so it's behind raccoon
  suitcaseHotspot = document.createElement('img');
  suitcaseHotspot.id = 'suitcaseHotspot';
  suitcaseHotspot.className = 'hotspot-img hidden';
  suitcaseHotspot.src = 'assets/suitcaseAsset.png';
  suitcaseHotspot.alt = 'Open suitcase';
  worldEl.appendChild(suitcaseHotspot);
  suitcaseHotspot.addEventListener('click', () => openInventory());
  suitcaseHotspot.addEventListener('mouseenter', () => { mouseOverSuitcase = true; });
  suitcaseHotspot.addEventListener('mouseleave', () => { mouseOverSuitcase = false; });

  // overlay root
  inventoryOverlay = document.createElement('div');
  inventoryOverlay.id = 'inventoryOverlay';
  inventoryOverlay.className = 'overlay hidden';
  inventoryOverlay.setAttribute('aria-hidden', 'true');
  inventoryOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close></div>
    <button class="overlay-close" data-close aria-label="Close">×</button>
    <div class="overlay-panel">
      <div class="suitcase-stage">
        <!-- Individual positioned images matching reference layout exactly -->
        <img class="inv-asset hoverable-asset" id="design-asset" src="assets/designAsset.png" style="position: absolute; left: 25%; top: 56%; width: 18%; z-index: 6;" alt="design" />
        <img class="inv-asset hoverable-asset" id="designto-asset" src="assets/designtoAsset.png" style="position: absolute; left: 26%; top: 30%; width: 18%; z-index: 2;" alt="designto" />
        <img class="inv-asset hoverable-asset" id="lucy-asset" src="assets/lucyAsset.png" style="position: absolute; left: 39%; top: 55%; width: 16%; z-index: 5;" alt="lucy" />
        <img class="inv-asset hoverable-asset" id="4sight-asset" src="assets/4sightAsset.png" style="position: absolute; left: 63%; top: 30%; width: 11%; z-index: 1;" alt="4sight" />
        <img class="inv-asset hoverable-asset" id="revision-asset" src="assets/revisionAsset.png" style="position: absolute; left: 41%; top: 32%; width: 27%; z-index: 3;" alt="revision" />
        <img class="inv-asset hoverable-asset" id="fatherfigure-asset" src="assets/fatherfigureAsset.png" style="position: absolute; left: 53%; top: 54%; width: 21%; z-index: 4;" alt="fatherfigure" />
      </div>
    </div>`;
  ui.appendChild(inventoryOverlay);

  // close on backdrop click
  inventoryOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close')) closeInventory();
  });

  // Enable hover on all individual assets
  const assets = inventoryOverlay.querySelectorAll('.inv-asset');
  assets.forEach(asset => {
    asset.style.pointerEvents = 'auto';
  });
}

// -------- Game Loop --------
function tick(ts) {
  const dt = lastTime ? (ts - lastTime) / 1000 : 0;
  lastTime = ts;

  // Movement intent
  let vx = 0;
  let vControl = 0; // -1 up, +1 down
  if (!overlayOpen) {
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vControl -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vControl += 1;
  }

  const moving = !overlayOpen && (vx !== 0 || vControl !== 0 || !onGround || vy !== 0);
  setRaccoonImage(moving ? CONFIG.raccoon.walkSrc : CONFIG.raccoon.idleSrc);

  if (moving) {
    const inv = 1 / Math.hypot(vx || 1, 1);
    vx *= inv;
    // horizontal
    racX += vx * CONFIG.raccoon.speed * dt;
    // vertical physics: controlled climb overrides gravity while held
    if (vControl !== 0) {
      vy = vControl * CONFIG.physics.climbSpeed;
      onGround = false;
    } else {
      vy += CONFIG.physics.gravity * dt;
    }
    racY += vy * dt;
    // ground/ceiling collision
    const gY = getGroundY();
    const cY = getCeilingY();
    if (racY >= gY) { racY = gY; vy = 0; onGround = true; }
    if (racY <= cY) { racY = cY; vy = 0; }
    // Clamp to world bounds
    racX = clamp(racX, 0, worldW);
    racY = clamp(racY, 0, worldH);
    placeRaccoon();
    // facing by horizontal intent
    if (vx > 0.0001) lastFacing = 1;
    else if (vx < -0.0001) lastFacing = -1;
    racEl.style.setProperty('--facing', String(lastFacing));
  }

  // Camera behaviour
  if (scene === 'inside' || scene === 'outside') {
    const { w, h } = viewportSize();
    const targetCamX = clamp(racX - w / 2, 0, Math.max(0, worldW - w));
    const targetCamY = clamp(racY - h * 0.75, 0, Math.max(0, worldH - h));
    cameraX = lerp(cameraX, targetCamX, 0.15);
    cameraY = lerp(cameraY, targetCamY, 0.15);
    worldEl.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
  }

  // Interaction visibility
  if (scene === 'outside') {
    const dist = distance({ x: racX, y: racY }, doorWorld);
    const near = dist <= CONFIG.outside.door.radius;
    if (near && !canInteract) { canInteract = true; show(interactBtn); }
    else if (!near && canInteract) { canInteract = false; hide(interactBtn); }
    if (canInteract) {
      interactBtn.textContent = 'Enter house ⏎';
      placeInteractButtonAtWorld(doorWorld.x, doorWorld.y);
    }
  } else if (scene === 'inside') {
    const e = CONFIG.inside.exit;
    const dist = distance({ x: racX, y: racY }, exitWorld);
    const near = e ? dist <= e.radius : false;
    if (near && !canInteract) { canInteract = true; show(interactBtn); }
    else if (!near && canInteract) { canInteract = false; hide(interactBtn); }
    if (canInteract) {
      interactBtn.textContent = 'Exit house ⏎';
      placeInteractButtonAtWorld(exitWorld.x, exitWorld.y);
    }
    // suitcase proximity - always visible, adds hover class when near or mouse over
    const s = CONFIG.inside.suitcase;
    const sDist = distance({ x: racX, y: racY }, suitcaseWorld);
    const sNear = s ? sDist <= s.radius : false;
    if (overlayOpen) {
      suitcaseHotspot && hide(suitcaseHotspot);
    } else {
      // Always show suitcase when inside and not in overlay
      if (suitcaseHotspot) {
        show(suitcaseHotspot);
        placeSuitcaseAtFixedWorld(suitcaseHotspot, suitcaseWorld.x, suitcaseWorld.y);
        // Add hover effect when near or mouse is over
        if (sNear || mouseOverSuitcase) {
          suitcaseHotspot.classList.add('hover-active');
          canOpenSuitcase = true;
        } else {
          suitcaseHotspot.classList.remove('hover-active');
          canOpenSuitcase = false;
        }
      }
    }
  } else {
    canInteract = false; hide(interactBtn);
    canOpenSuitcase = false;
    mouseOverSuitcase = false; // reset mouse hover state
    if (suitcaseHotspot) {
      hide(suitcaseHotspot);
      suitcaseHotspot.classList.remove('hover-active');
    }
  }

  // Keep chat bubble following the raccoon while visible
  if (!chatEl.classList.contains('hidden')) {
    placeChatAtWorld(racX, racY - 220);
  }

  requestAnimationFrame(tick);
}

// -------- Init --------
(async function init() {
  // size raccoon element from config and set initial src
  racEl.style.width = `${CONFIG.raccoon.width}px`;
  setRaccoonImage(CONFIG.raccoon.idleSrc);

  await enterOutside();
  requestAnimationFrame(tick);
  // build overlay UI once DOM is ready
  createSuitcaseUI();
  // Recompute layout on resize to keep full image height visible
  window.addEventListener('resize', () => {
    // Re-fit current scene
    if (!bgEl.naturalWidth || !bgEl.naturalHeight) return;
    if (scene === 'outside') {
      fitBackgroundToViewportCover(bgEl);
      updateDoorWorldFromScaled();
      // keep outside camera frozen at new center
      centerCameraOn(racX, racY);
    } else {
      fitBackgroundToViewportHeight(bgEl);
      updateExitWorldFromScaled();
      updateSuitcaseWorldFromScaled();
      // rescale hotspot size on viewport changes
      if (suitcaseHotspot) {
        const s = CONFIG.inside.suitcase;
        if (s && s.widthPct) {
          suitcaseHotspot.style.width = `${(s.widthPct / 100) * worldW}px`;
        }
      }
      centerCameraOn(racX, racY);
    }
  });
})();
