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
    speed: 220,            // px per second
    idleSrc: 'assets/idle.gif',
    walkSrc: 'assets/walking.gif',
    // Start closer to the house so the door is reachable without scrolling outside
    spawnOutside: { xPct: 60, yPct: 78 },   // starting point on outside image
    spawnInside: { x: 140, yFromBottom: 40 } // starting point inside (pixels)
  },
  outside: {
    bgSrc: 'assets/outside_house.jpg',
    // Door hotspot on the outside image (as percentages of bg natural size for easy tuning)
    // Adjust these if the prompt doesn't show in the right place.
    door: {
      xPct: 74,     // approximate door horizontal location in percent of width
      yPct: 66,     // approximate door vertical location in percent of height
      radius: 180   // proximity in pixels to show the prompt (increased)
    }
  },
  inside: {
    bgSrc: 'assets/static_downstairs.png'
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
let doorWorld = { x: 0, y: 0 };
let canInteract = false;
let lastFacing = 1; // 1 = facing right, -1 = facing left

// DOM elements
const gameEl = document.getElementById('game');
const bgEl = document.getElementById('bg');
const racEl = document.getElementById('raccoon');
const worldEl = document.getElementById('world');
const interactBtn = document.getElementById('interact');
const fadeEl = document.getElementById('fade');

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

function placeInteractButtonAtWorld(x, y) {
  // Convert world coords to viewport coords using camera offset
  const vx = x - cameraX;
  const vy = y - cameraY - 40; // lift above door a bit
  // Ensure measurements available by temporarily making it visible
  const wasHidden = interactBtn.classList.contains('hidden');
  if (wasHidden) interactBtn.classList.remove('hidden');
  const w = interactBtn.offsetWidth || 0;
  const h = interactBtn.offsetHeight || 0;
  interactBtn.style.left = `${vx - w / 2}px`;
  interactBtn.style.top = `${vy - h}px`;
  if (wasHidden && !canInteract) interactBtn.classList.add('hidden');
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
  setRaccoonImage(CONFIG.raccoon.idleSrc);
  placeRaccoon();
  centerCameraOn(racX, racY);
}

async function enterInside() {
  scene = 'inside';
  const img = await loadImage(CONFIG.inside.bgSrc);
  bgEl.src = CONFIG.inside.bgSrc;
  await img.decode?.();
  fitBackgroundToViewportHeight(img);

  spawnRaccoonInside();
  setRaccoonImage(CONFIG.raccoon.idleSrc);
  placeRaccoon();
  centerCameraOn(racX, racY);
}

function tryEnterHouse() {
  if (scene !== 'outside' || !canInteract) return;
  fadeOutIn(async () => {
    await enterInside();
  });
}

// -------- Input --------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)) {
    keys.add(k);
  }
  if (k === 'enter') {
    tryEnterHouse();
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
});

interactBtn.addEventListener('click', () => tryEnterHouse());

// -------- Game Loop --------
function tick(ts) {
  const dt = lastTime ? (ts - lastTime) / 1000 : 0;
  lastTime = ts;

  // Movement intent
  let vx = 0, vy = 0;
  if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
  if (keys.has('arrowright') || keys.has('d')) vx += 1;
  if (keys.has('arrowup') || keys.has('w')) vy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) vy += 1;

  const moving = vx !== 0 || vy !== 0;
  setRaccoonImage(moving ? CONFIG.raccoon.walkSrc : CONFIG.raccoon.idleSrc);

  if (moving) {
    const inv = 1 / Math.hypot(vx || 1, vy || 1);
    vx *= inv; vy *= inv;
    racX += vx * CONFIG.raccoon.speed * dt;
    racY += vy * CONFIG.raccoon.speed * dt;
    // Clamp to world bounds for both scenes
    racX = clamp(racX, 0, worldW);
    racY = clamp(racY, 0, worldH);
    placeRaccoon();
    // Update facing by horizontal intent
    if (vx > 0.0001) lastFacing = 1;
    else if (vx < -0.0001) lastFacing = -1;
    racEl.style.setProperty('--facing', String(lastFacing));
  }

  // Camera behaviour
  if (scene === 'inside' || scene === 'outside') {
    // follow raccoon horizontally; minor vertical follow to keep feet in view
    const { w, h } = viewportSize();
    const targetCamX = clamp(racX - w / 2, 0, Math.max(0, worldW - w));
    const targetCamY = clamp(racY - h * 0.75, 0, Math.max(0, worldH - h));
    cameraX = lerp(cameraX, targetCamX, 0.15);
    cameraY = lerp(cameraY, targetCamY, 0.15);
    worldEl.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
  } 

  // Door interaction visibility
  if (scene === 'outside') {
    const dist = distance({ x: racX, y: racY }, doorWorld);
    const near = dist <= CONFIG.outside.door.radius;
    if (near && !canInteract) {
      canInteract = true; show(interactBtn);
    } else if (!near && canInteract) {
      canInteract = false; hide(interactBtn);
    }
    if (canInteract) placeInteractButtonAtWorld(doorWorld.x, doorWorld.y);
  } else {
    canInteract = false; hide(interactBtn);
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
      centerCameraOn(racX, racY);
    }
  });
})();
