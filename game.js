/*
  Detective Raccoon - minimal scene system
  - Outside: background = assets/outside_house.jpg
    - Raccoon idles by default (idle.gif). On movement, switches to walking.gif.
    - Move with WASD or Arrow keys.
    - When near the house door, show an "Enter house" prompt that can be activated by Enter or click.
  - Inside: background = assets/static_downstairs.jpg (wide). Camera scrolls horizontally following the raccoon.
*/

// -------- Config (tweak as needed) --------
const CONFIG = {
  // Asset version for cache busting - increment when assets change
  assetVersion: '4',
  // Reference dimensions for consistent scaling (based on a standard laptop screen)
  reference: {
    width: 1440,
    height: 900
  },
  raccoon: {
    width: 540,            // px (mirrors styles.css)
    speed: 350,            // px per second (faster walking)
    get idleSrc() { return versionedAsset('assets/idle.gif'); },
    get walkSrc() { return versionedAsset('assets/walking.gif'); },
    // Start on the left side of the screen
    spawnOutside: { xPct: 20, yPct: 78 },   // starting point on outside image
    spawnInside: { x: 140, yFromBottom: 40 } // starting point inside (pixels)
  },
  outside: {
    get bgSrc() { return versionedAsset('assets/outside_house.jpg'); },
    // Door hotspot on the outside image (as percentages of bg natural size for easy tuning)
    door: {
      xPct: 74,     // approximate door horizontal location in percent of width
      yPct: 66,     // approximate door vertical location in percent of height
      radius: 300   // proximity in pixels to show the prompt (wider range)
    }
  },
  inside: {
    get bgSrc() { return versionedAsset('assets/static_downstairs.jpg'); },
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
let fatherFigureOverlayOpen = false; // father figure overlay state
let designOverlayOpen = false; // design overlay state
let designtoOverlayOpen = false; // designto overlay state
let jamOverlayOpen = false; // jam overlay state
let lucyOverlayOpen = false; // lucy overlay state
let revisionOverlayOpen = false; // revision overlay state
let currentFatherFigurePage = 1; // track current page (1 or 2)
let suitcaseWorld = { x: 0, y: 0 };

// DOM elements
const gameEl = document.getElementById('game');
const bgEl = document.getElementById('bg');
const racEl = document.getElementById('raccoon');
const worldEl = document.getElementById('world');
const interactBtn = document.getElementById('interact');
const fadeEl = document.getElementById('fade');
const chatEl = document.getElementById('chat');
const spotlightEl = document.getElementById('spotlight-overlay');
// dynamically created elements
let suitcaseHotspot = null;
let inventoryOverlay = null;
let fatherFigureOverlay = null;
let designOverlay = null;
let designtoOverlay = null;
let jamOverlay = null;
let lucyOverlay = null;
let revisionOverlay = null;
let mouseOverSuitcase = false;

// -------- Utilities --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setRaccoonImage(src) { if (racEl.src.endsWith(src)) return; racEl.src = src; }

// Helper function to add version parameter to asset URLs
function versionedAsset(path) {
  return `${path}?v=${CONFIG.assetVersion}`;
}

function viewportSize() {
  // Use game container's client size to honor the screenshot aspect ratio
  const rect = gameEl.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function getConsistentScale() {
  const { w, h } = viewportSize();
  // Calculate scale based on reference dimensions to maintain consistency
  const scaleX = w / CONFIG.reference.width;
  const scaleY = h / CONFIG.reference.height;
  // Use the smaller scale to ensure everything fits
  return Math.min(scaleX, scaleY);
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
  // Place suitcase at static viewport position (doesn't move with camera)
  const wasHidden = el.classList.contains('hidden');
  if (wasHidden) el.classList.remove('hidden');
  const w = el.offsetWidth || 0;
  const h = el.offsetHeight || 0;
  
  // Calculate static position as percentage of viewport
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const staticX = viewportW * 0.22 + 100; // 22% from left edge + 100px right
  const staticY = viewportH * 0.85 + 60;  // 85% from top + 60px down
  
  el.style.left = `${staticX - w / 2}px`;
  el.style.top = `${staticY - h}px`;
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
  
  // Reset world position for inside scene
  worldEl.style.left = '0px';
  worldEl.style.top = '0px';
  
  // Set CSS scale factor for consistent positioning
  document.body.style.setProperty('--scale-factor', scale);
}

function fitBackgroundToViewportContain(imgEl) {
  const { w, h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  
  // Use contain scaling - fit entire image within viewport
  const scaleX = w / natW;
  const scaleY = h / natH;
  const scale = Math.min(scaleX, scaleY); // use smaller scale to ensure entire image fits
  
  const dispW = Math.round(natW * scale);
  const dispH = Math.round(natH * scale);
  worldW = dispW;
  worldH = dispH;
  
  bgEl.style.width = `${dispW}px`;
  bgEl.style.height = `${dispH}px`;
  worldEl.style.width = `${dispW}px`;
  worldEl.style.height = `${dispH}px`;
  
  // Center the world if it's smaller than viewport
  const offsetX = Math.max(0, (w - dispW) / 2);
  const offsetY = Math.max(0, (h - dispH) / 2);
  worldEl.style.left = `${offsetX}px`;
  worldEl.style.top = `${offsetY}px`;
  
  // Set CSS scale factor for consistent positioning
  document.body.style.setProperty('--scale-factor', scale);
}

function fitBackgroundToViewportCover(imgEl) {
  const { w, h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  
  // Use cover scaling - fill entire viewport, may crop image
  const scaleX = w / natW;
  const scaleY = h / natH;
  const scale = Math.max(scaleX, scaleY); // use larger scale to fill viewport completely
  
  const dispW = Math.round(natW * scale);
  const dispH = Math.round(natH * scale);
  worldW = dispW;
  worldH = dispH;
  
  bgEl.style.width = `${dispW}px`;
  bgEl.style.height = `${dispH}px`;
  worldEl.style.width = `${dispW}px`;
  worldEl.style.height = `${dispH}px`;
  
  // Don't center - allow normal scrolling behavior
  // Reset world position to allow camera movement
  worldEl.style.left = '0px';
  worldEl.style.top = '0px';
  
  // Set CSS scale factor for consistent positioning
  document.body.style.setProperty('--scale-factor', scale);
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
  // Use cover scaling to fill entire viewport without black bars
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
  
  // Enable spotlight effect for outside scene
  enableSpotlight();
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

  // Disable spotlight effect for inside scene
  disableSpotlight();

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
  if (overlayOpen || fatherFigureOverlayOpen || designtoOverlayOpen || revisionOverlayOpen) return; // ignore while any overlay is open
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
  document.body.classList.add('overlay-open');
}

function closeInventory() {
  if (!overlayOpen) return;
  overlayOpen = false;
  inventoryOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Reset interaction state and check if we should show exit prompt
  canInteract = false;
  canOpenSuitcase = false;
  
  // Check if we're near the exit after closing inventory
  if (scene === 'inside') {
    const e = CONFIG.inside.exit;
    const exitDist = distance({ x: racX, y: racY }, exitWorld);
    const nearExit = e ? exitDist <= e.radius : false;
    
    if (nearExit) {
      canInteract = true;
      show(interactBtn);
      interactBtn.textContent = 'Exit house ⏎';
      placeInteractButtonAtWorld(exitWorld.x, exitWorld.y);
    }
  }
}

// Cache DOM elements to avoid repeated queries
let cachedFatherFigureElements = null;

function updateFatherFigurePage() {
  // Cache elements on first call
  if (!cachedFatherFigureElements) {
    cachedFatherFigureElements = {
      notebookStage: fatherFigureOverlay?.querySelector('.notebook-stage'),
      prevBtn: fatherFigureOverlay?.querySelector('#prevPageBtn'),
      nextBtn: fatherFigureOverlay?.querySelector('#nextPageBtn'),
      youtubeContainer: fatherFigureOverlay?.querySelector('#youtubeContainer'),
      githubLink: fatherFigureOverlay?.querySelector('#githubLink')
    };
  }
  
  const { notebookStage, prevBtn, nextBtn, youtubeContainer, githubLink } = cachedFatherFigureElements;
  
  if (notebookStage) {
    const backgroundImage = currentFatherFigurePage === 1 
      ? versionedAsset('assets/fatherfigureNote.png')
      : versionedAsset('assets/fatherfigureNote2.png');
    notebookStage.style.backgroundImage = `url('${backgroundImage}')`;
  }
  
  // Show/hide navigation buttons based on current page
  if (prevBtn) {
    prevBtn.style.display = currentFatherFigurePage === 1 ? 'none' : 'flex';
  }
  if (nextBtn) {
    nextBtn.style.display = currentFatherFigurePage === 2 ? 'none' : 'flex';
  }
  
  // Show YouTube video only on page 1 (where the dad's photo is)
  if (youtubeContainer) {
    if (currentFatherFigurePage === 1) {
      youtubeContainer.style.display = 'block';
    } else {
      youtubeContainer.style.display = 'none';
      // Pause video when navigating away from page 1
      const youtubeIframe = youtubeContainer.querySelector('#youtubeVideo');
      if (youtubeIframe) {
        youtubeIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
      }
    }
  }
  
  // Position GitHub link differently on each page
  if (githubLink) {
    githubLink.style.display = 'block'; // Show on both pages
    if (currentFatherFigurePage === 1) {
      // Page 1: Next to "father figure" title
      githubLink.style.left = '45%';
      githubLink.style.top = '9%';
      githubLink.style.right = 'auto';
    } else {
      // Page 2: Top right corner
      githubLink.style.left = 'auto';
      githubLink.style.right = '17%';
      githubLink.style.top = '8%';
    }
  }
}

function goToNextPage() {
  if (currentFatherFigurePage < 2) {
    currentFatherFigurePage++;
    updateFatherFigurePage();
  }
}

function goToPrevPage() {
  if (currentFatherFigurePage > 1) {
    currentFatherFigurePage--;
    updateFatherFigurePage();
  }
}

function openFatherFigureOverlay() {
  if (fatherFigureOverlayOpen) return;
  fatherFigureOverlayOpen = true;
  currentFatherFigurePage = 1; // Reset to first page when opening
  fatherFigureOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  updateFatherFigurePage();
}

function closeFatherFigureOverlay() {
  if (!fatherFigureOverlayOpen) return;
  
  // Pause YouTube video when closing overlay
  const youtubeIframe = fatherFigureOverlay?.querySelector('#youtubeVideo');
  if (youtubeIframe) {
    // Send pause command to YouTube iframe
    youtubeIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
  }
  
  fatherFigureOverlayOpen = false;
  fatherFigureOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing father figure overlay
  openInventory();
}

function openDesignOverlay() {
  if (designOverlayOpen) return;
  designOverlayOpen = true;
  designOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDesignOverlay() {
  if (!designOverlayOpen) return;
  designOverlayOpen = false;
  designOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing design overlay
  openInventory();
}

function openJamOverlay() {
  if (jamOverlayOpen) return;
  jamOverlayOpen = true;
  jamOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeJamOverlay() {
  if (!jamOverlayOpen) return;
  jamOverlayOpen = false;
  jamOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing jam overlay
  openInventory();
}

function openDesigntoOverlay() {
  if (designtoOverlayOpen) return;
  designtoOverlayOpen = true;
  designtoOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDesigntoOverlay() {
  if (!designtoOverlayOpen) return;
  designtoOverlayOpen = false;
  designtoOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing designto overlay
  openInventory();
}

function openLucyOverlay() {
  if (lucyOverlayOpen) return;
  lucyOverlayOpen = true;
  lucyOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeLucyOverlay() {
  if (!lucyOverlayOpen) return;
  
  // Pause YouTube video when closing overlay
  const youtubeIframe = lucyOverlay?.querySelector('#lucyYoutubeVideo');
  if (youtubeIframe) {
    // Send pause command to YouTube iframe
    youtubeIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
  }
  
  lucyOverlayOpen = false;
  lucyOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing lucy overlay
  openInventory();
}

function openRevisionOverlay() {
  if (revisionOverlayOpen) return;
  revisionOverlayOpen = true;
  revisionOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeRevisionOverlay() {
  if (!revisionOverlayOpen) return;
  revisionOverlayOpen = false;
  revisionOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  // Return to inventory when closing revision overlay
  openInventory();
}

// -------- Input --------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (overlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeInventory(); }
    return;
  }
  if (fatherFigureOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeFatherFigureOverlay(); }
    if (k === 'arrowleft') { e.preventDefault(); goToPrevPage(); }
    if (k === 'arrowright') { e.preventDefault(); goToNextPage(); }
    return;
  }
  if (designOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeDesignOverlay(); }
    return;
  }
  if (designtoOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeDesigntoOverlay(); }
    return;
  }
  if (jamOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeJamOverlay(); }
    return;
  }
  if (lucyOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeLucyOverlay(); }
    return;
  }
  if (revisionOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeRevisionOverlay(); }
    return;
  }
  if (['arrowleft','arrowright','a','d'].includes(k)) {
    keys.add(k);
  }
  if (k === 'enter') {
    if (scene === 'outside') tryEnterHouse();
    else if (scene === 'inside') {
      if (canOpenSuitcase) openInventory();
      else tryExitHouse();
    }
  }
  // Jump: spacebar or up arrow
  if ((k === ' ' || k === 'spacebar' || k === 'space' || k === 'arrowup' || k === 'w') && onGround) {
    vy = -CONFIG.physics.jumpSpeed;
    onGround = false;
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
});

interactBtn.addEventListener('click', () => {
  if (!canInteract) return;
  
  if (scene === 'outside') {
    tryEnterHouse();
  } else if (scene === 'inside') {
    if (canOpenSuitcase) {
      openInventory();
    } else {
      tryExitHouse();
    }
  }
});

// -------- Touch Controls --------
let touchControls = null;
let touchState = {
  left: false,
  right: false,
  up: false,
  down: false,
  interact: false
};

function createTouchControls() {
  // Only create touch controls on mobile devices
  if (!('ontouchstart' in window)) return;
  
  touchControls = document.createElement('div');
  touchControls.id = 'touch-controls';
  touchControls.innerHTML = `
    <div class="touch-dpad">
      <button class="touch-btn touch-up" data-key="up">↑</button>
      <div class="touch-middle">
        <button class="touch-btn touch-left" data-key="left">←</button>
        <button class="touch-btn touch-right" data-key="right">→</button>
      </div>
      <button class="touch-btn touch-down" data-key="down">↓</button>
    </div>
    <button class="touch-btn touch-interact" data-key="interact">⏎</button>
  `;
  
  document.body.appendChild(touchControls);
  
  // Add touch event listeners
  const touchButtons = touchControls.querySelectorAll('.touch-btn');
  touchButtons.forEach(btn => {
    const key = btn.getAttribute('data-key');
    
    // Touch start
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchState[key] = true;
      btn.classList.add('active');
      
      if (key === 'interact') {
        if (canInteract) {
          if (scene === 'outside') tryEnterHouse();
          else if (scene === 'inside') {
            if (canOpenSuitcase) openInventory();
            else tryExitHouse();
          }
        }
      }
    });
    
    // Touch end
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      touchState[key] = false;
      btn.classList.remove('active');
    });
    
    // Touch cancel (when finger moves off button)
    btn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      touchState[key] = false;
      btn.classList.remove('active');
    });
    
    // Prevent context menu on long press
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  });
}

function hideTouchControls() {
  if (touchControls) {
    touchControls.style.display = 'none';
  }
}

function showTouchControls() {
  if (touchControls) {
    touchControls.style.display = 'flex';
  }
}

// Create overlay and suitcase button in UI
function createSuitcaseUI() {
  const ui = document.getElementById('ui');
  // hotspot image (briefcase under window) - append to world so it's behind raccoon
  suitcaseHotspot = document.createElement('img');
  suitcaseHotspot.id = 'suitcaseHotspot';
  suitcaseHotspot.className = 'hotspot-img hidden';
  suitcaseHotspot.src = versionedAsset('assets/suitcaseAsset.png');
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
    <button class="overlay-close" data-close aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="suitcase-stage">
        <!-- Individual positioned images matching reference layout exactly -->
        <img class="inv-asset hoverable-asset" id="design-asset" src="${versionedAsset('assets/designAsset.png')}" style="position: absolute; left: 25%; top: 56%; width: 18%; z-index: 6;" alt="design" />
        <img class="inv-asset hoverable-asset" id="designto-asset" src="${versionedAsset('assets/designtoAsset.png')}" style="position: absolute; left: 26%; top: 30%; width: 18%; z-index: 2;" alt="designto" />
        <img class="inv-asset hoverable-asset" id="lucy-asset" src="${versionedAsset('assets/lucyAsset.png')}" style="position: absolute; left: 39%; top: 55%; width: 16%; z-index: 5;" alt="lucy" />
        <img class="inv-asset hoverable-asset" id="jam-asset" src="${versionedAsset('assets/jamAsset.png')}" style="position: absolute; left: 63%; top: 30%; width: 11%; z-index: 1;" alt="jam" />
        <img class="inv-asset hoverable-asset" id="revision-asset" src="${versionedAsset('assets/revisionAsset.png')}" style="position: absolute; left: 41%; top: 32%; width: 27%; z-index: 3;" alt="revision" />
        <img class="inv-asset hoverable-asset" id="fatherfigure-asset" src="${versionedAsset('assets/fatherfigureAsset.png')}" style="position: absolute; left: 53%; top: 54%; width: 21%; z-index: 4;" alt="fatherfigure" />
      </div>
    </div>`;
  ui.appendChild(inventoryOverlay);

  // close on backdrop click
  inventoryOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close')) closeInventory();
  });

  // Enable hover on all individual assets and add image swapping
  const assets = inventoryOverlay.querySelectorAll('.inv-asset');
  assets.forEach(asset => {
    asset.style.pointerEvents = 'auto';
    
    // Store original src for hover effect
    const originalSrc = asset.src;
    const assetId = asset.id;
    
    // Define hover image mappings (only for assets that have #2 versions)
    const hoverImages = {
      'fatherfigure-asset': 'assets/fatherfigureAsset2.png',
      'design-asset': 'assets/designAsset2.png',
      'designto-asset': 'assets/designtoAsset2.png',
      'lucy-asset': 'assets/lucyAsset2.png',
      'revision-asset': 'assets/revisionAsset2.png',
      'jam-asset': 'assets/jamAsset2.png' // Add this when jamAsset2.png is uploaded
    };
    
    // Add hover effect if #2 version exists
    if (hoverImages[assetId]) {
      asset.addEventListener('mouseenter', () => {
        asset.src = versionedAsset(hoverImages[assetId]);
      });
      
      asset.addEventListener('mouseleave', () => {
        asset.src = originalSrc;
      });
    }
  });
  
  // Add click handler for father figure asset
  const fatherFigureAsset = inventoryOverlay.querySelector('#fatherfigure-asset');
  if (fatherFigureAsset) {
    fatherFigureAsset.addEventListener('click', () => {
      closeInventory();
      openFatherFigureOverlay();
    });
  }
  
  // Add click handler for design asset
  const designAsset = inventoryOverlay.querySelector('#design-asset');
  if (designAsset) {
    designAsset.addEventListener('click', () => {
      closeInventory();
      openDesignOverlay();
    });
  }
  
  // Add click handler for designto asset
  const designtoAsset = inventoryOverlay.querySelector('#designto-asset');
  if (designtoAsset) {
    designtoAsset.addEventListener('click', () => {
      closeInventory();
      openDesigntoOverlay();
    });
  }
  
  // Add click handler for jam asset
  const jamAsset = inventoryOverlay.querySelector('#jam-asset');
  if (jamAsset) {
    jamAsset.addEventListener('click', () => {
      closeInventory();
      openJamOverlay();
    });
  }
  
  // Add click handler for lucy asset
  const lucyAsset = inventoryOverlay.querySelector('#lucy-asset');
  if (lucyAsset) {
    lucyAsset.addEventListener('click', () => {
      closeInventory();
      openLucyOverlay();
    });
  }
  
  // Add click handler for revision asset
  const revisionAsset = inventoryOverlay.querySelector('#revision-asset');
  if (revisionAsset) {
    revisionAsset.addEventListener('click', () => {
      closeInventory();
      openRevisionOverlay();
    });
  }
  
  // Create father figure overlay
  fatherFigureOverlay = document.createElement('div');
  fatherFigureOverlay.id = 'fatherFigureOverlay';
  fatherFigureOverlay.className = 'overlay hidden';
  fatherFigureOverlay.setAttribute('aria-hidden', 'true');
  fatherFigureOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-father></div>
    <button class="overlay-close" data-close-father aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="notebook-stage">
        <!-- Father figure notebook content will be styled with CSS background -->
        <div class="youtube-embed-container" id="youtubeContainer">
          <iframe 
            id="youtubeVideo"
            src="https://www.youtube.com/embed/rnDSdft8QbM?enablejsapi=1&rel=0&modestbranding=1" 
            title="Father Figure Demo Video" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
            allowfullscreen>
          </iframe>
        </div>
        <a href="https://github.com/fiof25/father-figure-htn" target="_blank" class="github-link" id="githubLink">
          <img src="${versionedAsset('assets/githubblack.png')}" alt="GitHub Repository" title="View on GitHub">
        </a>
        <button class="nav-arrow prev" id="prevPageBtn" aria-label="Previous page">
          <img src="${versionedAsset('assets/arrow.png')}" alt="Previous">
        </button>
        <button class="nav-arrow next" id="nextPageBtn" aria-label="Next page">
          <img src="${versionedAsset('assets/arrow.png')}" alt="Next">
        </button>
      </div>
    </div>`;
  ui.appendChild(fatherFigureOverlay);
  
  // Close on backdrop click
  fatherFigureOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-father')) closeFatherFigureOverlay();
  });
  
  // Add navigation button event listeners
  const prevBtn = fatherFigureOverlay.querySelector('#prevPageBtn');
  const nextBtn = fatherFigureOverlay.querySelector('#nextPageBtn');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToPrevPage();
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToNextPage();
    });
  }
  
  // Create design overlay
  designOverlay = document.createElement('div');
  designOverlay.id = 'designOverlay';
  designOverlay.className = 'overlay hidden';
  designOverlay.setAttribute('aria-hidden', 'true');
  designOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-design></div>
    <button class="overlay-close" data-close-design aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="design-stage">
        <img src="${versionedAsset('assets/designNote.png')}" alt="Design Note" class="design-note-image">
      </div>
    </div>`;
  ui.appendChild(designOverlay);
  
  // Close on backdrop click
  designOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-design')) closeDesignOverlay();
  });
  
  // Create jam overlay
  jamOverlay = document.createElement('div');
  jamOverlay.id = 'jamOverlay';
  jamOverlay.className = 'overlay hidden';
  jamOverlay.setAttribute('aria-hidden', 'true');
  jamOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-jam></div>
    <button class="overlay-close" data-close-jam aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="jam-notebook-stage">
        <!-- Jam notebook content will be styled with CSS background -->
        <div class="jam-video-container" id="jamVideoContainer">
          <img src="${versionedAsset('assets/jamVid.png')}" alt="Jam Demo Thumbnail" class="jam-video-thumbnail">
          <button class="jam-watch-button" id="jamWatchButton">
            <span class="play-icon">▶</span>
            Watch Demo
          </button>
        </div>
        <button class="jam-launch-button" id="jamLaunchButton">
          <img src="${versionedAsset('assets/jamLaunchIcon.png')}" alt="Try Demo" class="jam-launch-icon">
        </button>
        <a href="https://github.com/justinwuzijin/eye-tester-app" target="_blank" class="jam-github-link" id="jamGithubLink">
          <img src="${versionedAsset('assets/githubblack.png')}" alt="GitHub Repository" title="View on GitHub">
        </a>
      </div>
    </div>`;
  ui.appendChild(jamOverlay);
  
  // Close on backdrop click
  jamOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-jam')) closeJamOverlay();
  });
  
  // Add click handler for watch demo button
  const jamWatchButton = jamOverlay.querySelector('#jamWatchButton');
  if (jamWatchButton) {
    jamWatchButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent overlay from closing
      window.open('https://www.youtube.com/watch?v=G-rITGNKfxI', '_blank');
    });
  }
  
  // Make the entire video container clickable
  const jamVideoContainer = jamOverlay.querySelector('#jamVideoContainer');
  if (jamVideoContainer) {
    jamVideoContainer.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent overlay from closing
      window.open('https://www.youtube.com/watch?v=G-rITGNKfxI', '_blank');
    });
  }
  
  // Add click handler for jam launch button
  const jamLaunchButton = jamOverlay.querySelector('#jamLaunchButton');
  if (jamLaunchButton) {
    jamLaunchButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent overlay from closing
      window.open('https://eye-tester-app.vercel.app', '_blank');
    });
  }
  
  // Create designto overlay
  designtoOverlay = document.createElement('div');
  designtoOverlay.id = 'designtoOverlay';
  designtoOverlay.className = 'overlay hidden';
  designtoOverlay.setAttribute('aria-hidden', 'true');
  designtoOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-designto></div>
    <button class="overlay-close" data-close-designto aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="designto-stage">
        <img src="${versionedAsset('assets/designtoNote.png')}" alt="DesignTO Note" class="designto-note-image">
        <img src="${versionedAsset('assets/designtoIcon.png')}" alt="DesignTO Icon" class="designto-icon">
      </div>
    </div>`;
  ui.appendChild(designtoOverlay);
  
  // Close on backdrop click
  designtoOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-designto')) closeDesigntoOverlay();
  });
  
  // Add click handler for designto icon
  const designtoIcon = designtoOverlay.querySelector('.designto-icon');
  if (designtoIcon) {
    designtoIcon.addEventListener('mouseenter', () => {
      // Change to pressed state on hover
      designtoIcon.src = versionedAsset('assets/designtoIconPressed.png');
    });
    
    designtoIcon.addEventListener('mouseleave', () => {
      // Change back to normal state when not hovering
      designtoIcon.src = versionedAsset('assets/designtoIcon.png');
    });
    
    designtoIcon.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent overlay from closing
      // Open PDF in new tab
      window.open(versionedAsset('assets/DesignTO Marketing Campaign-FionaFang.pdf'), '_blank');
    });
  }
  
  // Create lucy overlay
  lucyOverlay = document.createElement('div');
  lucyOverlay.id = 'lucyOverlay';
  lucyOverlay.className = 'overlay hidden';
  lucyOverlay.setAttribute('aria-hidden', 'true');
  lucyOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-lucy></div>
    <button class="overlay-close" data-close-lucy aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="lucy-notebook-stage">
        <!-- Lucy notebook content will be styled with CSS background -->
        <div class="lucy-youtube-embed-container" id="lucyYoutubeContainer">
          <iframe 
            id="lucyYoutubeVideo"
            src="https://www.youtube.com/embed/GRENRaAo0oI?start=1&enablejsapi=1&rel=0&modestbranding=1" 
            title="Lucy Demo Video" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
            allowfullscreen>
          </iframe>
        </div>
        <a href="https://refreshmiami.com/news/miami-hack-week-2024-parties-meetups-and-innovative-tech-that-won-over-the-judges/" target="_blank" class="lucy-news-link" id="lucyNewsLink">
          <img src="${versionedAsset('assets/lucyArticle.png')}" alt="Miami Hack Week News Article" title="Read Miami Hack Week Article">
        </a>
        <a href="https://devpost.com/software/lucy-0v6lpm" target="_blank" class="lucy-project-link" id="lucyDemoLink">
          <img src="${versionedAsset('assets/lucyProjectIcon.png')}" alt="Lucy Full Demo on Devpost" title="View Lucy Project on Devpost">
        </a>
      </div>
    </div>`;
  ui.appendChild(lucyOverlay);
  
  // Close on backdrop click
  lucyOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-lucy')) closeLucyOverlay();
  });
  
  // Create revision overlay
  revisionOverlay = document.createElement('div');
  revisionOverlay.id = 'revisionOverlay';
  revisionOverlay.className = 'overlay hidden';
  revisionOverlay.setAttribute('aria-hidden', 'true');
  revisionOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-revision></div>
    <button class="overlay-close" data-close-revision aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="revision-stage">
        <img src="${versionedAsset('assets/revisionNote.png')}" alt="Revision Note" class="revision-note-image">
        <a href="https://devpost.com/software/revision-v9y65g" target="_blank" class="revision-project-link" id="revisionDemoLink">
          <img src="${versionedAsset('assets/revisionProjectIcon.png')}" alt="Revision Full Demo on Devpost" title="View Revision Project on Devpost">
        </a>
      </div>
    </div>`;
  ui.appendChild(revisionOverlay);
  
  // Close on backdrop click
  revisionOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-revision')) closeRevisionOverlay();
  });
}

// -------- Game Loop --------
function tick(ts) {
  const dt = lastTime ? (ts - lastTime) / 1000 : 0;
  lastTime = ts;

  // Movement intent (keyboard + touch)
  let vx = 0;
  let vControl = 0; // -1 up, +1 down
  if (!overlayOpen && !fatherFigureOverlayOpen && !designOverlayOpen && !designtoOverlayOpen && !jamOverlayOpen && !lucyOverlayOpen && !revisionOverlayOpen) {
    // Keyboard controls
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vControl -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vControl += 1;
    
    // Touch controls
    if (touchState.left) vx -= 1;
    if (touchState.right) vx += 1;
    if (touchState.up) vControl -= 1;
    if (touchState.down) vControl += 1;
  }

  const moving = !overlayOpen && !fatherFigureOverlayOpen && !designOverlayOpen && !designtoOverlayOpen && !jamOverlayOpen && !lucyOverlayOpen && !revisionOverlayOpen && (vx !== 0 || vControl !== 0 || !onGround || vy !== 0);
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
          // Show briefcase interaction prompt
          if (!canInteract) {
            canInteract = true;
            show(interactBtn);
          }
          interactBtn.textContent = 'Open briefcase ⏎';
          placeInteractButtonAtWorld(suitcaseWorld.x, suitcaseWorld.y);
        } else {
          suitcaseHotspot.classList.remove('hover-active');
          canOpenSuitcase = false;
          // Hide briefcase prompt if not near exit either
          const e = CONFIG.inside.exit;
          const exitDist = distance({ x: racX, y: racY }, exitWorld);
          const nearExit = e ? exitDist <= e.radius : false;
          if (canInteract && !nearExit) {
            canInteract = false;
            hide(interactBtn);
          }
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

  // Update spotlight position to follow raccoon
  updateSpotlight();

  requestAnimationFrame(tick);
}

// -------- Spotlight Effect --------
function updateSpotlight() {
  if (scene !== 'outside' || !spotlightEl || !spotlightEl.classList.contains('spotlight') || !racEl) return;
  
  // Get the actual raccoon PNG element's position on screen
  const raccoonRect = racEl.getBoundingClientRect();
  const raccoonCenterX = raccoonRect.left + raccoonRect.width / 2;
  const raccoonCenterY = raccoonRect.top + raccoonRect.height / 2;
  
  // Update the spotlight position to follow the actual raccoon PNG
  spotlightEl.style.setProperty('--spotlight-x', `${raccoonCenterX}px`);
  spotlightEl.style.setProperty('--spotlight-y', `${raccoonCenterY}px`);
}

function enableSpotlight() {
  if (spotlightEl) {
    console.log('Enabling spotlight'); // Debug
    spotlightEl.classList.add('active', 'spotlight');
  } else {
    console.log('Spotlight element not found!'); // Debug
  }
}

function disableSpotlight() {
  if (spotlightEl) {
    spotlightEl.classList.remove('active', 'spotlight');
  }
}

// -------- Custom Floating Cursor --------
function createCustomCursor() {
  // Create cursor element
  const cursor = document.createElement('div');
  cursor.id = 'custom-cursor';
  document.body.appendChild(cursor);
  
  let mouseX = 0;
  let mouseY = 0;
  let isVisible = false;
  
  // Update cursor position
  function updateCursor() {
    cursor.style.left = mouseX + 'px';
    cursor.style.top = mouseY + 'px';
    requestAnimationFrame(updateCursor);
  }
  
  // Mouse move handler
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    
    if (!isVisible) {
      cursor.classList.add('active');
      isVisible = true;
    }
  });
  
  // Mouse enter/leave handlers for hover effects
  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    // Check if element or its parent is clickable
    const clickableElement = target.closest('.inv-asset, .hotspot-img, #interact, .overlay-close, .nav-arrow, .github-link, .jam-github-link, .jam-launch-button, .jam-watch-button, .jam-video-container, .lucy-news-link, .lucy-project-link, .revision-project-link, .designto-icon, .touch-btn, .nav-link, a, button, [onclick], .clickable');
    
    if (clickableElement) {
      cursor.classList.add('hover');
    }
  });
  
  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    // Check if element or its parent is clickable
    const clickableElement = target.closest('.inv-asset, .hotspot-img, #interact, .overlay-close, .nav-arrow, .github-link, .jam-github-link, .jam-launch-button, .jam-watch-button, .jam-video-container, .lucy-news-link, .lucy-project-link, .revision-project-link, .designto-icon, .touch-btn, .nav-link, a, button, [onclick], .clickable');
    
    if (clickableElement) {
      cursor.classList.remove('hover');
    }
  });
  
  // Hide cursor when mouse leaves window
  document.addEventListener('mouseleave', () => {
    cursor.classList.remove('active');
    isVisible = false;
  });
  
  // Click effects
  document.addEventListener('mousedown', (e) => {
    cursor.classList.add('click');
  });
  
  document.addEventListener('mouseup', (e) => {
    cursor.classList.remove('click');
  });
  
  // Ensure cursor stays hidden on all elements
  document.addEventListener('selectstart', (e) => {
    e.preventDefault(); // Prevent text selection cursor
  });
  
  // Start animation loop
  updateCursor();
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
  // create touch controls for mobile
  createTouchControls();
  // create custom floating cursor
  createCustomCursor();
  // Recompute layout on resize to keep full image height visible
  window.addEventListener('resize', () => {
    // Re-fit current scene
    if (!bgEl.naturalWidth || !bgEl.naturalHeight) return;
    if (scene === 'outside') {
      fitBackgroundToViewportContain(bgEl);
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
