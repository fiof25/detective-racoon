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
  assetVersion: Date.now().toString(),
  // Reference dimensions for consistent scaling (based on a standard laptop screen)
  reference: {
    width: 1440,
    height: 900
  },
  raccoon: {
    width: 609,            // px (5% smaller than 641px)
    height: 609,           // px (5% smaller than 641px)
    speed: 550,            // px per second (faster walking)
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
    exit: { xPct: 3, yPct: 68, radius: 240 },
    // Suitcase hotspot inside (under the window)
    // widthPct controls how wide the hotspot image is relative to world width
    suitcase: { xPct: 21.5, yPct: 94, radius: 220, widthPct: 27 }
  },
  upstairs: {
    get bgSrc() { return versionedAsset('assets/upstairs.jpg'); },
    lantern: { xPct: 84, yPct: 64, widthPct: 35 },
    shelf: { xPct: 62, yPct: 72, widthPct: 33, radius: 380 },
  },
  physics: {
    gravity: 1800,     // px/s^2 downward
    jumpSpeed: 900,    // initial upward speed
    groundOffsetOutside: 140, // px from bottom (raised by 100px)
    groundOffsetInside: 90, // lowered ground by 50px (from 140)
    groundOffsetUpstairs: 90,
    climbSpeed: 700,   // px/s when holding up/down (faster so up arrow feels responsive)
    ceilingOffsetOutside: 10,
    ceilingOffsetInside: 10,
    ceilingOffsetUpstairs: 10
  },
  transitionMs: 300
};

// -------- State --------
let scene = 'outside'; // 'outside' | 'inside' | 'upstairs'
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
let canGoUpstairs = false; // track if raccoon can go upstairs
let canGoDownstairs = false; // track if raccoon can go downstairs
let hasStartedMoving = false; // track if user has started moving
let overlayOpen = false; // inventory open state
let fatherFigureOverlayOpen = false; // father figure overlay state
let sceneTransitioning = false; // flag to prevent suitcase showing during transitions
let designOverlayOpen = false; // design overlay state
let designtoOverlayOpen = false; // designto overlay state
let jamOverlayOpen = false; // jam overlay state
let lucyOverlayOpen = false; // lucy overlay state
let revisionOverlayOpen = false; // revision overlay state
let uiOverlayOpen = false; // ui overlay state
let aboutMeOverlayOpen = false; // about me overlay state
let currentFatherFigurePage = 1; // track current page (1 or 2)
let suitcaseWorld = { x: 0, y: 0 };
let globalPreloader = null; // Global reference to asset preloader
let upstairsLanternEls = []; // lantern img elements in upstairs world
let upstairsShelfEl = null; // shelf img element in upstairs world
let shelfOverlay = null; // shelf overlay DOM element
let shelfOverlayOpen = false; // shelf overlay open state
let canOpenShelf = false; // raccoon is near shelf
let mouseOverShelf = false; // mouse hovering over shelf hotspot
let shelfWorld = { x: 0, y: 0 }; // shelf world-space center for proximity
let skipNextInsideGreeting = false; // suppress greeting when returning from upstairs

// DOM elements
const gameEl = document.getElementById('game');
const bgEl = document.getElementById('bg');
const racEl = document.getElementById('raccoon');
const worldEl = document.getElementById('world');
const interactBtn = document.getElementById('interact');
const fadeEl = document.getElementById('fade');
const chatEl = document.getElementById('chat');
const spotlightEl = document.getElementById('spotlight-overlay');
const movementInstructionsEl = document.getElementById('movement-instructions');

// Audio elements
const bookSound = new Audio('assets/book.mp3');
const doorSound = new Audio('assets/door.mp3');
const boxSound = new Audio('assets/box.wav');

// Set volume levels
bookSound.volume = 1.0; // Maximum volume
doorSound.volume = 0.2; // Quieter
boxSound.volume = 0.3; // Medium volume for box opening

// Function to play sound with error handling
function playSound(audio) {
  try {
    audio.currentTime = 0; // Reset to beginning
    audio.play().catch(error => {
      console.log('Audio play failed:', error);
    });
  } catch (error) {
    console.log('Audio error:', error);
  }
}

// dynamically created elements
let suitcaseHotspot = null;
let inventoryOverlay = null;
let fatherFigureOverlay = null;
let designOverlay = null;
let designtoOverlay = null;
let jamOverlay = null;
let lucyOverlay = null;
let revisionOverlay = null;
let uiOverlay = null;
let aboutMeOverlay = null;
let mouseOverSuitcase = false;

// -------- Utilities --------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setRaccoonImage(src) { 
  if (!racEl || !src) return;
  
  // Check if we're already showing this image (avoid unnecessary reloads)
  const currentSrc = racEl.src;
  if (currentSrc && (currentSrc === src || currentSrc.includes(src))) return;
  
  // Try to use cached image first for instant loading
  if (globalPreloader && globalPreloader.isImageCached(src)) {
    const cachedImg = globalPreloader.getCachedImage(src);
    if (cachedImg && cachedImg.complete) {
      racEl.src = src;
      return;
    }
  }
  
  // Set up error handler before changing src
  racEl.onerror = () => {
    console.warn(`Failed to load raccoon image: ${src}`);
    // Fallback to a basic placeholder if image fails
    racEl.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTQwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNTQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjI3MCIgeT0iMjAwIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjI0cHgiPkZhaWxlZCB0byBsb2FkPC90ZXh0Pjwvc3ZnPg==';
  };
  
  // Clear any previous error handler on successful load
  racEl.onload = () => {
    racEl.onerror = null;
  };
  
  racEl.src = src; 
}

// Helper function to add version parameter to asset URLs
function versionedAsset(path) {
  return `${path}?v=${CONFIG.assetVersion}`;
}

// Asset Preloader System
class AssetPreloader {
  constructor() {
    this.assets = [];
    this.loaded = 0;
    this.total = 0;
    this.onProgress = null;
    this.onComplete = null;
    this.imageCache = new Map(); // Cache for preloaded images
  }

  // Define all assets that need to be preloaded (essential only)
  getAssetList() {
    return [
      // Loading screen asset
      'assets/loadpusheen.gif',
      
      // Core game assets (essential for basic functionality)
      'assets/idle.gif',
      'assets/walking.gif', 
      'assets/outside_house.jpg',
      'assets/static_downstairs.jpg',
      
      // Navigation icons (visible immediately)
      'assets/email.webp',
      'assets/linkedin.webp',
      'assets/github.webp',
      'assets/projects.webp',
      'assets/aboutme.webp',
      'assets/backbutton.webp',
      'assets/searchIcon.webp',
      
      // Essential UI assets
      'assets/suitcaseAsset.webp',
      'assets/profile.webp',
      'assets/mailme.webp',
      'assets/msgme.webp',
      
      // Inventory assets (main and hover states for smooth transitions)
      'assets/designAsset.webp',
      'assets/designAsset2.webp',
      'assets/designtoAsset.webp', 
      'assets/designtoAsset2.webp',
      'assets/jamAsset.webp',
      'assets/jamAsset2.webp',
      'assets/lucyAsset.webp',
      'assets/lucyAsset2.webp',
      'assets/revisionAsset.webp',
      'assets/revisionAsset2.webp',
      'assets/fatherfigureAsset.webp',
      'assets/fatherfigureAsset2.webp',

      // Upstairs assets
      'assets/upstairs.jpg',
      'assets/shelf.webp',
      'assets/shelf_overlay.webp',
      'assets/lantern.webp',
      'assets/hirono.webp',
      'assets/chess.webp',
      'assets/mollytea.webp'

      // Note: Project detail assets (notes, etc.) will lazy-load when needed
      // This reduces initial loading time while ensuring core functionality works
    ];
  }

  preloadAssets() {
    const assetPaths = this.getAssetList();
    this.total = assetPaths.length;
    this.loaded = 0;

    return new Promise((resolve, reject) => {
      this.onComplete = resolve;
      
      assetPaths.forEach((path, index) => {
        const img = new Image();
        
        img.onload = () => {
          // Cache the loaded image for immediate access
          this.imageCache.set(versionedAsset(path), img);
          this.loaded++;
          this.updateProgress();
          
          if (this.loaded === this.total) {
            setTimeout(() => {
              this.onComplete();
            }, 500); // Small delay to show 100% completion
          }
        };
        
        img.onerror = () => {
          console.warn(`Failed to load asset: ${path}`);
          this.loaded++;
          this.updateProgress();
          
          if (this.loaded === this.total) {
            setTimeout(() => {
              this.onComplete();
            }, 500);
          }
        };
        
        // Use versioned asset URL
        img.src = versionedAsset(path);
      });
    });
  }

  updateProgress() {
    const percentage = Math.round((this.loaded / this.total) * 100);
    
    if (this.onProgress) {
      this.onProgress(percentage, this.loaded, this.total);
    }
    
    // Update loading screen
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    
    if (progressText) {
      progressText.textContent = `${percentage}%`;
    }
  }

  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  // Get a cached image if available
  getCachedImage(src) {
    return this.imageCache.get(src);
  }

  // Check if an image is cached
  isImageCached(src) {
    return this.imageCache.has(src);
  }
}

function viewportSize() {
  // Use game container's client size to honor the screenshot aspect ratio
  if (!gameEl) return { w: window.innerWidth, h: window.innerHeight };
  const rect = gameEl.getBoundingClientRect();
  return { 
    w: rect.width || window.innerWidth, 
    h: rect.height || window.innerHeight 
  };
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
  // Place suitcase at world position (scales with background, doesn't move with camera)
  const wasHidden = el.classList.contains('hidden');
  if (wasHidden) el.classList.remove('hidden');
  const w = el.offsetWidth || 0;
  const h = el.offsetHeight || 0;
  
  // Use world coordinates passed in from CONFIG (x, y are already in world pixels)
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
  // Position bubble centered on raccoon horizontally, above raccoon vertically
  chatEl.style.left = `${vx - w / 2}px`;
  chatEl.style.top = `${vyWorld - h - 16}px`;
  if (wasHidden && chatTimerId === null) chatEl.classList.add('hidden');
}

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function fadeOutIn(cb) {
  console.log('fadeOutIn called with callback:', !!cb);
  show(fadeEl);
  
  // Use CSS transitions with event listeners for better performance
  const handleFadeIn = async () => {
    console.log('fadeOutIn - handleFadeIn triggered');
    fadeEl.removeEventListener('transitionend', handleFadeIn);
    
    // Execute callback during peak fade and wait for it to complete
    if (cb) {
      try {
        console.log('fadeOutIn - executing callback...');
        await cb();
        console.log('fadeOutIn - callback completed');
      } catch (error) {
        console.error('Error during scene transition:', error);
      }
    }
    
    // Only start fade out after callback is completely finished
    requestAnimationFrame(() => {
      console.log('fadeOutIn - starting fade out');
      fadeEl.classList.remove('show');
      fadeEl.addEventListener('transitionend', handleFadeOut, { once: true });
    });
  };
  
  const handleFadeOut = () => {
    hide(fadeEl);
  };
  
  // Start fade in immediately to show black screen
  requestAnimationFrame(() => {
    fadeEl.classList.add('show');
    fadeEl.addEventListener('transitionend', handleFadeIn, { once: true });
  });
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (error) => {
      console.error(`Failed to load image: ${src}`, error);
      // Create a fallback colored rectangle
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Image failed to load', canvas.width/2, canvas.height/2);
      
      // Convert canvas to image
      const fallbackImg = new Image();
      fallbackImg.src = canvas.toDataURL();
      fallbackImg.naturalWidth = canvas.width;
      fallbackImg.naturalHeight = canvas.height;
      resolve(fallbackImg);
    };
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

function spawnRaccoonUpstairs() {
  // Spawn on the right side where the stairs are
  racX = worldW - 140;
  racY = worldH - CONFIG.raccoon.spawnInside.yFromBottom;
}

function createUpstairsLantern() {
  if (upstairsLanternEls.length > 0) return; // already created
  const el = document.createElement('img');
  el.id = 'upstairsLantern';
  el.className = 'hotspot-img hidden';
  el.src = versionedAsset('assets/lantern.webp');
  el.alt = 'lantern';
  el.draggable = false;
  el.style.pointerEvents = 'none';
  worldEl.appendChild(el);
  upstairsLanternEls.push(el);
}

function placeUpstairsLantern() {
  const el = upstairsLanternEls[0];
  if (!el) return;
  const cfg = CONFIG.upstairs.lantern;
  const w = (cfg.widthPct / 100) * worldW;
  const h = w; // lantern.webp is 2048×2048 (square)
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.left = `${(cfg.xPct / 100) * worldW - w / 2}px`;
  el.style.top = `${(cfg.yPct / 100) * worldH - h}px`;
  show(el);
}

function createUpstairsShelf() {
  if (upstairsShelfEl) return;
  const ui = document.getElementById('ui');

  upstairsShelfEl = document.createElement('img');
  upstairsShelfEl.id = 'upstairsShelf';
  upstairsShelfEl.className = 'hotspot-img hidden';
  upstairsShelfEl.src = versionedAsset('assets/shelf.webp');
  upstairsShelfEl.alt = 'shelf';
  upstairsShelfEl.draggable = false;
  worldEl.appendChild(upstairsShelfEl);
  upstairsShelfEl.addEventListener('click', () => openShelfOverlay());
  upstairsShelfEl.addEventListener('touchend', (e) => { e.preventDefault(); openShelfOverlay(); });
  upstairsShelfEl.addEventListener('mouseenter', () => { mouseOverShelf = true; });
  upstairsShelfEl.addEventListener('mouseleave', () => { mouseOverShelf = false; });

  // Shelf overlay
  shelfOverlay = document.createElement('div');
  shelfOverlay.id = 'shelfOverlay';
  shelfOverlay.className = 'overlay hidden';
  shelfOverlay.setAttribute('aria-hidden', 'true');
  shelfOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close></div>
    <button class="overlay-close" data-close aria-label="Close"></button>
    <div id="shelfItemHint" class="shelf-item-hint hidden"></div>
    <div class="overlay-panel">
      <div class="suitcase-stage">
        <div class="suitcase-container">
          <img src="${versionedAsset('assets/shelf_overlay.webp')}" alt="Shelf" class="suitcase-image">
          <img src="${versionedAsset('assets/hirono.webp')}" alt="Hirono" id="shelfHirono" class="shelf-overlay-item" data-hint="Sometimes I wish I could turn into a hirono..." style="position:absolute;top:47%;left:20%;transform:translate(-50%,-50%);width:38%;">
          <img src="${versionedAsset('assets/chess.webp')}" alt="Chess" id="shelfChess" class="shelf-overlay-item" data-hint="Fancy a game?" style="position:absolute;top:54%;left:49%;transform:translate(-50%,-50%);width:34%;">
          <img src="${versionedAsset('assets/mollytea.webp')}" alt="Molly Tea" id="shelfMollyTea" class="shelf-overlay-item" data-hint="I am 50% raccoon and 50% molly tea." style="position:absolute;top:50%;left:81%;transform:translate(-50%,-50%);width:39%;">
        </div>
      </div>
    </div>`;
  ui.appendChild(shelfOverlay);
  shelfOverlay.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.hasAttribute('data-close')) closeShelfOverlay();
  });
  const shelfHintEl = shelfOverlay.querySelector('#shelfItemHint');
  const SHELF_DEFAULT_HINT = 'My handy dandy shelf of my favourite things.';
  shelfHintEl.textContent = SHELF_DEFAULT_HINT;
  shelfOverlay.querySelectorAll('.shelf-overlay-item').forEach(img => {
    img.addEventListener('mouseenter', () => {
      shelfHintEl.textContent = img.dataset.hint;
      shelfHintEl.classList.remove('hidden');
    });
    img.addEventListener('mouseleave', () => {
      shelfHintEl.textContent = SHELF_DEFAULT_HINT;
    });
  });
  const chessEl = shelfOverlay.querySelector('#shelfChess');
  chessEl.style.cursor = 'pointer';
  chessEl.addEventListener('click', () => {
    window.open('https://www.chess.com/member/bunnycake4', '_blank');
  });
}

function placeUpstairsShelf() {
  if (!upstairsShelfEl) return;
  const cfg = CONFIG.upstairs.shelf;
  const w = (cfg.widthPct / 100) * worldW;
  const h = w * (1640 / 2360); // shelf.webp is 2360×1640
  upstairsShelfEl.style.width = `${w}px`;
  upstairsShelfEl.style.height = `${h}px`;
  upstairsShelfEl.style.left = `${(cfg.xPct / 100) * worldW - w / 2}px`;
  upstairsShelfEl.style.top = `${(cfg.yPct / 100) * worldH - h}px`;
  // Store world-space center for proximity detection
  shelfWorld.x = (cfg.xPct / 100) * worldW;
  shelfWorld.y = (cfg.yPct / 100) * worldH - h / 2;
  show(upstairsShelfEl);
}

function fitBackgroundToViewportHeight(imgEl, zoomFactor) {
  // On mobile portrait, use a larger zoom so worldH > viewport height,
  // giving the camera enough range to hide the ceiling (capped at 1.2 to keep
  // the exit hotspot within its 240px radius: 0.32*worldH-90 < 240).
  if (zoomFactor === undefined) {
    zoomFactor = ('ontouchstart' in window && window.innerWidth < 768) ? 1.15 : 1.05;
  }
  const { h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  const baseScale = h / natH; // fit height
  const scale = baseScale * zoomFactor; // Apply zoom for more immersive feel
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

function fitBackgroundToViewportCover(imgEl, zoomFactor = 1.03) {
  const { w, h } = viewportSize();
  const natW = imgEl.naturalWidth;
  const natH = imgEl.naturalHeight;
  
  // Use cover scaling - fill entire viewport, may crop image
  const scaleX = w / natW;
  const scaleY = h / natH;
  const baseScale = Math.max(scaleX, scaleY); // use larger scale to fill viewport completely
  const scale = baseScale * zoomFactor; // Apply zoom for more immersive feel
  
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
  if (scene === 'outside') return worldH - CONFIG.physics.groundOffsetOutside;
  if (scene === 'upstairs') return worldH - CONFIG.physics.groundOffsetUpstairs;
  return worldH - CONFIG.physics.groundOffsetInside;
}

function getCeilingY() {
  if (scene === 'outside') return CONFIG.physics.ceilingOffsetOutside;
  if (scene === 'upstairs') return CONFIG.physics.ceilingOffsetUpstairs;
  return CONFIG.physics.ceilingOffsetInside;
}

// -------- Scenes --------
async function enterOutside() {
  console.log('enterOutside function called');
  try {
    // On mobile, show floor bar and shrink game height BEFORE fitting world
    // so viewportSize() returns the reduced height when computing world scale.
    // Use window.innerHeight (visual viewport) not 100vh (layout viewport) so
    // Safari doesn't cut off the bottom behind its browser chrome.
    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    const floorBar = document.getElementById('mobile-floor-bar');
    if (isMobile && floorBar) {
      floorBar.style.display = 'block';
      gameEl.classList.add('inside-mobile');
      gameEl.style.height = `${window.innerHeight - floorBar.offsetHeight}px`;
      void gameEl.offsetHeight; // force reflow so viewportSize() reads reduced height
    } else if (floorBar) {
      floorBar.style.display = 'none';
      gameEl.classList.remove('inside-mobile');
      gameEl.style.height = '';
    }

    console.log('enterOutside - setting scene to outside');
    scene = 'outside';
    console.log('enterOutside - loading background image');
    const img = await loadImage(CONFIG.outside.bgSrc);
    bgEl.src = CONFIG.outside.bgSrc;

    // Hide back button when outside
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.classList.add('hidden');
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
  } catch (error) {
    console.error('Error entering outside scene:', error);
    // Fallback behavior - still set up the scene with defaults
    scene = 'outside';
    spawnRaccoonOutside();
    racY = getGroundY(); vy = 0; onGround = true;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    placeRaccoon();
  }
}

async function enterInside() {
  try {
    scene = 'inside';

    // Hide suitcase immediately to prevent glitch during transition
    if (suitcaseHotspot) {
      hide(suitcaseHotspot);
      suitcaseHotspot.classList.remove('hover-active');
    }
    
    // On mobile, show black floor bar and shrink game height BEFORE fitting world
    // so viewportSize() returns the reduced height when computing world scale.
    // Use window.innerHeight (visual viewport) not 100vh (layout viewport) so
    // Safari doesn't cut off the bottom behind its browser chrome.
    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    const floorBar = document.getElementById('mobile-floor-bar');
    if (isMobile && floorBar) {
      floorBar.style.display = 'block';
      gameEl.classList.add('inside-mobile');
      gameEl.style.height = `${window.innerHeight - floorBar.offsetHeight}px`;
      void gameEl.offsetHeight; // force reflow so viewportSize() reads reduced height
    }

    const img = await loadImage(CONFIG.inside.bgSrc);
    bgEl.src = CONFIG.inside.bgSrc;

    // Show back button when inside
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.classList.remove('hidden');
    const downstairsBtn = document.getElementById('downstairs-button');
    if (downstairsBtn) downstairsBtn.classList.add('hidden');
    await img.decode?.();
    fitBackgroundToViewportHeight(img);

    spawnRaccoonInside();
    // snap to ground on enter
    racY = getGroundY(); vy = 0; onGround = true;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    placeRaccoon();
    updateExitWorldFromScaled();
    updateSuitcaseWorldFromScaled();
    
    // Scale and position suitcase after world is properly sized
    if (suitcaseHotspot) {
      const s = CONFIG.inside.suitcase;
      if (s && s.widthPct) {
        // Set width based on new world dimensions
        suitcaseHotspot.style.width = `${(s.widthPct / 100) * worldW}px`;
        // Reset height to auto to maintain aspect ratio
        suitcaseHotspot.style.height = 'auto';
      }
    }
    centerCameraOn(racX, racY);

    // Enable spotlight effect for inside scene too
    enableSpotlight();

    // Hide upstairs assets when back inside
    upstairsLanternEls.forEach(el => hide(el));
    if (upstairsShelfEl) hide(upstairsShelfEl);
    if (shelfOverlayOpen) closeShelfOverlay();

    // Show chat bubble briefly when entering the house (not when returning from upstairs)
    if (skipNextInsideGreeting) {
      skipNextInsideGreeting = false;
    } else {
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
  } catch (error) {
    console.error('Error entering inside scene:', error);
    // Fallback behavior
    scene = 'inside';
    spawnRaccoonInside();
    racY = getGroundY(); vy = 0; onGround = true;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    placeRaccoon();
  }
}

function tryEnterHouse() {
  if (scene !== 'outside' || !canInteract) return;
  
  // Play door sound when entering house
  playSound(doorSound);
  
  // Set transition flag and hide suitcase before starting transition
  sceneTransitioning = true;
  if (suitcaseHotspot) {
    hide(suitcaseHotspot);
    suitcaseHotspot.classList.remove('hover-active');
  }
  
  fadeOutIn(async () => {
    await enterInside();
    // Clear transition flag after scene is fully loaded
    sceneTransitioning = false;
  });
}

function tryExitHouse() {
  console.log('tryExitHouse called - Scene:', scene, 'canInteract:', canInteract, 'Overlays:', {
    overlayOpen, fatherFigureOverlayOpen, designtoOverlayOpen, revisionOverlayOpen, aboutMeOverlayOpen
  });

  if (overlayOpen || fatherFigureOverlayOpen || designtoOverlayOpen || revisionOverlayOpen || aboutMeOverlayOpen) {
    console.log('Exiting early - overlay is open');
    return; // ignore while any overlay is open
  }
  if (scene !== 'inside') {
    console.log('Exiting early - scene is not inside');
    return;
  }

  console.log('Starting house exit transition...');
  playSound(doorSound);
  sceneTransitioning = true;
  fadeOutIn(async () => {
    console.log('Fade transition - calling enterOutside...');
    await enterOutside();
    sceneTransitioning = false;
    // Place raccoon just outside the door on ground
    racX = doorWorld.x;
    racY = getGroundY();
    placeRaccoon();
    centerCameraOn(racX, racY);
    console.log('House exit complete');
  });
}

async function enterUpstairs() {
  try {
    scene = 'upstairs';

    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    const floorBar = document.getElementById('mobile-floor-bar');
    if (isMobile && floorBar) {
      floorBar.style.display = 'block';
      gameEl.classList.add('inside-mobile');
      gameEl.style.height = `${window.innerHeight - floorBar.offsetHeight}px`;
      void gameEl.offsetHeight;
    }

    const img = await loadImage(CONFIG.upstairs.bgSrc);
    bgEl.src = CONFIG.upstairs.bgSrc;

    // Hide back button upstairs, show downstairs button instead
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.classList.add('hidden');
    const downstairsBtn = document.getElementById('downstairs-button');
    if (downstairsBtn) downstairsBtn.classList.remove('hidden');
    await img.decode?.();
    fitBackgroundToViewportCover(img, 1.05);

    spawnRaccoonUpstairs();
    racY = getGroundY(); vy = 0; onGround = true;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    placeRaccoon();
    centerCameraOn(racX, racY);

    enableSpotlight();

    // Place upstairs assets in scene
    createUpstairsLantern();
    placeUpstairsLantern();
    createUpstairsShelf();
    placeUpstairsShelf();
  } catch (error) {
    console.error('Error entering upstairs scene:', error);
    scene = 'upstairs';
    spawnRaccoonUpstairs();
    racY = getGroundY(); vy = 0; onGround = true;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    placeRaccoon();
  }
}

function tryEnterUpstairs() {
  if (scene !== 'inside' || !canGoUpstairs) return;
  playSound(doorSound);
  sceneTransitioning = true;
  canGoUpstairs = false;
  fadeOutIn(async () => {
    await enterUpstairs();
    sceneTransitioning = false;
  });
}

function tryExitUpstairs() {
  if (scene !== 'upstairs' || shelfOverlayOpen) return;
  playSound(doorSound);
  sceneTransitioning = true;
  canGoDownstairs = false;
  skipNextInsideGreeting = true;
  fadeOutIn(async () => {
    await enterInside();
    sceneTransitioning = false;
    // Place raccoon at right side near the stairs when coming back downstairs
    racX = worldW - 140;
    racY = getGroundY();
    placeRaccoon();
    centerCameraOn(racX, racY);
  });
}

function openInventory() {
  if (overlayOpen) return;
  playSound(boxSound);
  overlayOpen = true;
  inventoryOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');

  // Prevent ghost taps (iOS touch → click delay) from immediately closing
  // the inventory via backdrop when returning from a project overlay
  if ('ontouchstart' in window) {
    const backdrop = inventoryOverlay?.querySelector('.overlay-backdrop');
    if (backdrop) {
      backdrop.style.pointerEvents = 'none';
      setTimeout(() => { if (backdrop) backdrop.style.pointerEvents = ''; }, 350);
    }
  }
  
  // Hide back button when inventory is open to prevent confusion with close button
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeInventory() {
  if (!overlayOpen) return;
  overlayOpen = false;
  inventoryOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');

  // Show back button again when closing inventory (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }

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

function openShelfOverlay() {
  if (shelfOverlayOpen) return;
  playSound(boxSound);
  shelfOverlayOpen = true;
  shelfOverlay?.classList.remove('hidden');
  shelfOverlay?.querySelector('#shelfItemHint')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');

  if ('ontouchstart' in window) {
    const backdrop = shelfOverlay?.querySelector('.overlay-backdrop');
    if (backdrop) {
      backdrop.style.pointerEvents = 'none';
      setTimeout(() => { if (backdrop) backdrop.style.pointerEvents = ''; }, 350);
    }
  }

  if (scene !== 'upstairs') {
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.classList.add('hidden');
  }
  document.getElementById('downstairs-button')?.classList.add('hidden');
}

function closeShelfOverlay() {
  if (!shelfOverlayOpen) return;
  shelfOverlayOpen = false;
  shelfOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');

  canInteract = false;
  canOpenShelf = false;

  if (scene !== 'upstairs') {
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.classList.remove('hidden');
  }
  document.getElementById('downstairs-button')?.classList.remove('hidden');
}

let cachedFatherFigureElements = null;
let notebookImageDimensions = null;

function updateFatherFigurePage() {
  // Cache elements on first call
  if (!cachedFatherFigureElements) {
    cachedFatherFigureElements = {
      notebookContainer: fatherFigureOverlay?.querySelector('.notebook-container'),
      notebookImage: fatherFigureOverlay?.querySelector('#notebookImage'),
      prevBtn: fatherFigureOverlay?.querySelector('#prevPageBtn'),
      nextBtn: fatherFigureOverlay?.querySelector('#nextPageBtn'),
      youtubeContainer: fatherFigureOverlay?.querySelector('#youtubeContainer'),
      githubLink: fatherFigureOverlay?.querySelector('#githubLink')
    };
  }
  
  const { notebookContainer, notebookImage, prevBtn, nextBtn, youtubeContainer, githubLink } = cachedFatherFigureElements;

  if (notebookContainer) {
    notebookContainer.classList.toggle('page-2', currentFatherFigurePage === 2);
  }
  
  if (notebookImage) {
    const imageSrc = currentFatherFigurePage === 1 
      ? versionedAsset('assets/fatherfigureNote.webp')
      : versionedAsset('assets/fatherfigureNote2.webp');
    
    // Store and maintain consistent image dimensions
    const handleImageLoad = function() {
      // Wait a frame to ensure image is rendered
      requestAnimationFrame(() => {
        // Store dimensions on first load (page 1)
        if (!notebookImageDimensions) {
          const rect = notebookImage.getBoundingClientRect();
          notebookImageDimensions = {
            width: rect.width || notebookImage.offsetWidth,
            height: rect.height || notebookImage.offsetHeight
          };
        }
        
        // Apply stored dimensions to maintain alignment
        if (notebookImageDimensions) {
          notebookImage.style.width = notebookImageDimensions.width + 'px';
          notebookImage.style.height = notebookImageDimensions.height + 'px';
        }
      });
    };
    
    // Remove previous handler to avoid duplicates
    notebookImage.onload = null;
    notebookImage.onload = handleImageLoad;
    
    // Change src
    notebookImage.src = imageSrc;
    
    // If image is already cached/loaded, trigger handler after a short delay
    if (notebookImage.complete && notebookImage.naturalWidth > 0) {
      handleImageLoad();
    }
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
  
  // Position GitHub link differently on each page (hidden on mobile)
  if (githubLink) {
    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    githubLink.style.display = isMobile ? 'none' : 'block';
    if (currentFatherFigurePage === 1) {
      // Page 1: Next to "father figure" title
      githubLink.style.left = '43%';
      githubLink.style.top = '9%';
      githubLink.style.right = 'auto';
    } else {
      // Page 2: Top right corner
      githubLink.style.left = 'auto';
      githubLink.style.right = '7%';
      githubLink.style.top = '8%';
    }
  }
}

function goToNextPage() {
  if (currentFatherFigurePage < 2) {
    currentFatherFigurePage++;
    playSound(bookSound);
    updateFatherFigurePage();
  }
}

function goToPrevPage() {
  if (currentFatherFigurePage > 1) {
    currentFatherFigurePage--;
    playSound(bookSound);
    updateFatherFigurePage();
  }
}

function openFatherFigureOverlay() {
  if (fatherFigureOverlayOpen) return;
  playSound(bookSound);
  fatherFigureOverlayOpen = true;
  currentFatherFigurePage = 1; // Reset to first page when opening
  fatherFigureOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when father figure overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
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
  
  // Show back button again when closing father figure overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  // Return to inventory when closing father figure overlay
  openInventory();
}

function openDesignOverlay() {
  if (designOverlayOpen) return;
  playSound(bookSound);
  designOverlayOpen = true;
  designOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when design overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeDesignOverlay() {
  if (!designOverlayOpen) return;
  designOverlayOpen = false;
  designOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing design overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing design overlay
  openInventory();
}

function openUiOverlay() {
  if (uiOverlayOpen) return;
  playSound(bookSound);
  uiOverlayOpen = true;
  uiOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when ui overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeUiOverlay() {
  if (!uiOverlayOpen) return;
  uiOverlayOpen = false;
  uiOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing ui overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing ui overlay
  openInventory();
}

function openJamOverlay() {
  if (jamOverlayOpen) return;
  playSound(bookSound);
  jamOverlayOpen = true;
  jamOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when jam overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeJamOverlay() {
  if (!jamOverlayOpen) return;
  jamOverlayOpen = false;
  jamOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing jam overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing jam overlay
  openInventory();
}

function openDesigntoOverlay() {
  if (designtoOverlayOpen) return;
  playSound(bookSound);
  designtoOverlayOpen = true;
  designtoOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when designto overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeDesigntoOverlay() {
  if (!designtoOverlayOpen) return;
  designtoOverlayOpen = false;
  designtoOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing designto overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing designto overlay
  openInventory();
}

function openLucyOverlay() {
  if (lucyOverlayOpen) return;
  playSound(bookSound);
  lucyOverlayOpen = true;
  lucyOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when lucy overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
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
  
  // Show back button again when closing lucy overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing lucy overlay
  openInventory();
}

function openRevisionOverlay() {
  if (revisionOverlayOpen) return;
  playSound(bookSound);
  revisionOverlayOpen = true;
  revisionOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when revision overlay is open
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeRevisionOverlay() {
  if (!revisionOverlayOpen) return;
  revisionOverlayOpen = false;
  revisionOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing revision overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
  
  // Return to inventory when closing revision overlay
  openInventory();
}

function openAboutMeOverlay() {
  if (aboutMeOverlayOpen) return;
  playSound(bookSound);
  aboutMeOverlayOpen = true;
  aboutMeOverlay?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  
  // Hide back button when about me overlay is open to prevent confusion with close button
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.add('hidden');
  }
}

function closeAboutMeOverlay() {
  if (!aboutMeOverlayOpen) return;
  aboutMeOverlayOpen = false;
  aboutMeOverlay?.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  
  // Show back button again when closing about me overlay (if inside)
  const backButton = document.getElementById('back-button');
  if (backButton && scene === 'inside') {
    backButton.classList.remove('hidden');
  }
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
  if (aboutMeOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeAboutMeOverlay(); }
    return;
  }
  if (shelfOverlayOpen) {
    if (k === 'escape' || k === 'esc') { e.preventDefault(); closeShelfOverlay(); }
    return;
  }
  if (['arrowleft','arrowright','a','d'].includes(k)) {
    keys.add(k);
  }
  if (k === 'enter') {
    if (scene === 'outside') tryEnterHouse();
    else if (scene === 'inside') {
      if (canOpenSuitcase) openInventory();
      else if (canGoUpstairs) tryEnterUpstairs();
      else if (canInteract) tryExitHouse();
    } else if (scene === 'upstairs') {
      if (canOpenShelf) openShelfOverlay();
      else if (canGoDownstairs) tryExitUpstairs();
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
    } else if (canGoUpstairs) {
      tryEnterUpstairs();
    } else {
      tryExitHouse();
    }
  } else if (scene === 'upstairs') {
    if (canOpenShelf) openShelfOverlay();
    else if (canGoDownstairs) tryExitUpstairs();
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

let touchJumpTriggered = false; // Prevent continuous jumping on touch

function createTouchControls() {
  if (!('ontouchstart' in window)) return;

  touchControls = document.createElement('div');
  touchControls.id = 'touch-controls';
  touchControls.innerHTML = `
    <div class="touch-left-cluster">
      <button class="touch-btn touch-left" data-key="left">←</button>
      <button class="touch-btn touch-right" data-key="right">→</button>
    </div>
    <button class="touch-btn touch-jump" data-key="up">↑</button>
  `;

  document.body.appendChild(touchControls);

  touchControls.querySelectorAll('.touch-btn').forEach(btn => {
    const key = btn.getAttribute('data-key');

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchState[key] = true;
      btn.classList.add('active');
      if (key === 'up' && onGround && !touchJumpTriggered) {
        vy = -CONFIG.physics.jumpSpeed;
        onGround = false;
        touchJumpTriggered = true;
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      touchState[key] = false;
      btn.classList.remove('active');
      if (key === 'up') touchJumpTriggered = false;
    });

    btn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      touchState[key] = false;
      btn.classList.remove('active');
      if (key === 'up') touchJumpTriggered = false;
    });

    btn.addEventListener('contextmenu', (e) => e.preventDefault());
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
  suitcaseHotspot.src = versionedAsset('assets/suitcaseAsset.webp');
  suitcaseHotspot.alt = 'Open suitcase';
  worldEl.appendChild(suitcaseHotspot);
  suitcaseHotspot.addEventListener('click', () => openInventory());
  suitcaseHotspot.addEventListener('touchend', (e) => { e.preventDefault(); openInventory(); });
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
        <div class="suitcase-container">
          <img src="${versionedAsset('assets/suitcase.webp')}" alt="Suitcase" class="suitcase-image">
          <!-- Individual positioned images matching reference layout exactly -->
          <img class="inv-asset hoverable-asset" id="design-asset" src="${versionedAsset('assets/designAsset.webp')}" alt="design" />
          <img class="inv-asset hoverable-asset" id="designto-asset" src="${versionedAsset('assets/designtoAsset.webp')}" alt="designto" />
          <img class="inv-asset hoverable-asset" id="lucy-asset" src="${versionedAsset('assets/lucyAsset.webp')}" alt="lucy" />
          <img class="inv-asset hoverable-asset" id="jam-asset" src="${versionedAsset('assets/jamAsset.webp')}" alt="jam" />
          <img class="inv-asset hoverable-asset" id="revision-asset" src="${versionedAsset('assets/revisionAsset.webp')}" alt="revision" />
          <img class="inv-asset hoverable-asset" id="ui-asset" src="${versionedAsset('assets/uiAsset.webp')}" alt="ui" />
          <img class="inv-asset hoverable-asset" id="fatherfigure-asset" src="${versionedAsset('assets/fatherfigureAsset.webp')}" alt="fatherfigure" />
        </div>
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
      'fatherfigure-asset': 'assets/fatherfigureAsset2.webp',
      'design-asset': 'assets/designAsset2.webp',
      'designto-asset': 'assets/designtoAsset2.webp',
      'lucy-asset': 'assets/lucyAsset2.webp',
      'revision-asset': 'assets/revisionAsset2.webp',
      'jam-asset': 'assets/jamAsset2.webp', // Add this when jamAsset2.png is uploaded
      'ui-asset': 'assets/uiAsset2.webp' // Add this when uiAsset2.png is uploaded
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
  
  // Add click handler for ui asset
  const uiAsset = inventoryOverlay.querySelector('#ui-asset');
  if (uiAsset) {
    uiAsset.addEventListener('click', () => {
      closeInventory();
      openUiOverlay();
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
        <div class="notebook-container">
          <img src="${versionedAsset('assets/fatherfigureNote.webp')}" alt="Father Figure Note" class="notebook-image" id="notebookImage">
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
            <img src="${versionedAsset('assets/githubblack.webp')}" alt="GitHub Repository" title="View on GitHub">
          </a>
          <button class="nav-arrow prev" id="prevPageBtn" aria-label="Previous page">
            <img src="${versionedAsset('assets/arrow.webp')}" alt="Previous">
          </button>
          <button class="nav-arrow next" id="nextPageBtn" aria-label="Next page">
            <img src="${versionedAsset('assets/arrow.webp')}" alt="Next">
          </button>
        </div>
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

  // On mobile, replace iframe with a tap-to-open-YouTube hit area
  if ('ontouchstart' in window && window.innerWidth < 768) {
    const ytContainer = fatherFigureOverlay.querySelector('#youtubeContainer');
    if (ytContainer) {
      ytContainer.innerHTML = '';
      ytContainer.style.cursor = 'pointer';
      ytContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open('https://www.youtube.com/watch?v=rnDSdft8QbM', '_blank');
      });
    }
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
        <img src="${versionedAsset('assets/designNote.webp')}" alt="Design Note" class="design-note-image">
      </div>
    </div>`;
  ui.appendChild(designOverlay);
  
  // Close on backdrop click
  designOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-design')) closeDesignOverlay();
  });
  
  // Create ui overlay
  uiOverlay = document.createElement('div');
  uiOverlay.id = 'uiOverlay';
  uiOverlay.className = 'overlay hidden';
  uiOverlay.setAttribute('aria-hidden', 'true');
  uiOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-ui></div>
    <button class="overlay-close" data-close-ui aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="ui-stage">
        <img src="${versionedAsset('assets/uiNote.webp')}" alt="UI Note" class="ui-note-image">
      </div>
    </div>`;
  ui.appendChild(uiOverlay);
  
  // Close on backdrop click
  uiOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-ui')) closeUiOverlay();
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
        <div class="jam-notebook-container">
          <img src="${versionedAsset('assets/jamNote.webp')}" alt="Jam Note" class="jam-notebook-image">
          <div class="jam-video-container" id="jamVideoContainer">
            <img src="${versionedAsset('assets/jamVid.webp')}" alt="Jam Demo Thumbnail" class="jam-video-thumbnail">
            <button class="jam-watch-button" id="jamWatchButton">
              <span class="play-icon">▶</span>
              Watch Demo
            </button>
          </div>
          <button class="jam-launch-button" id="jamLaunchButton">
            <img src="${versionedAsset('assets/jamLaunchIcon.webp')}" alt="Try Demo" class="jam-launch-icon">
          </button>
          <a href="https://github.com/justinwuzijin/eye-tester-app" target="_blank" class="jam-github-link" id="jamGithubLink">
            <img src="${versionedAsset('assets/githubblack.webp')}" alt="GitHub Repository" title="View on GitHub">
          </a>
        </div>
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

  // On mobile, clear the sticker thumbnail/button so it's an invisible hit area
  if ('ontouchstart' in window && window.innerWidth < 768) {
    if (jamVideoContainer) jamVideoContainer.innerHTML = '';
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
        <div class="designto-container">
          <img src="${versionedAsset('assets/designtoNote.webp')}" alt="DesignTO Note" class="designto-note-image">
          <img src="${versionedAsset('assets/designtoIcon.webp')}" alt="DesignTO Icon" class="designto-icon">
        </div>
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
      designtoIcon.src = versionedAsset('assets/designtoIconPressed.webp');
    });
    
    designtoIcon.addEventListener('mouseleave', () => {
      // Change back to normal state when not hovering
      designtoIcon.src = versionedAsset('assets/designtoIcon.webp');
    });
    
    designtoIcon.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent overlay from closing
      // Open PDF in new tab
      window.open(versionedAsset('assets/designtoPortfolio-FionaFang.pdf'), '_blank');
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
        <div class="lucy-notebook-container">
          <img src="${versionedAsset('assets/lucyNote.webp')}" alt="Lucy Note" class="lucy-notebook-image">
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
            <img src="${versionedAsset('assets/lucyArticle.webp')}" alt="Miami Hack Week News Article" title="Read Miami Hack Week Article">
          </a>
          <a href="https://devpost.com/software/lucy-0v6lpm" target="_blank" class="lucy-project-link" id="lucyDemoLink">
            <img src="${versionedAsset('assets/lucyProjectIcon.webp')}" alt="Lucy Full Demo on Devpost" title="View Lucy Project on Devpost">
          </a>
        </div>
      </div>
    </div>`;
  ui.appendChild(lucyOverlay);

  // Close on backdrop click
  lucyOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-lucy')) closeLucyOverlay();
  });

  // On mobile, replace iframe with a tap-to-open-YouTube hit area
  if ('ontouchstart' in window && window.innerWidth < 768) {
    const ytContainer = lucyOverlay.querySelector('#lucyYoutubeContainer');
    if (ytContainer) {
      ytContainer.innerHTML = '';
      ytContainer.style.cursor = 'pointer';
      ytContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open('https://www.youtube.com/watch?v=GRENRaAo0oI', '_blank');
      });
    }
  }

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
        <div class="revision-container">
          <img src="${versionedAsset('assets/revisionNote.webp')}" alt="Revision Note" class="revision-note-image">
          <a href="https://devpost.com/software/revision-v9y65g" target="_blank" class="revision-project-link" id="revisionDemoLink">
            <img src="${versionedAsset('assets/revisionProjectIcon.webp')}" alt="Revision Full Demo on Devpost" title="View Revision Project on Devpost">
          </a>
        </div>
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
  if (!overlayOpen && !fatherFigureOverlayOpen && !designOverlayOpen && !designtoOverlayOpen && !jamOverlayOpen && !lucyOverlayOpen && !revisionOverlayOpen && !aboutMeOverlayOpen) {
    // Keyboard controls
    if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
    if (keys.has('arrowright') || keys.has('d')) vx += 1;
    if (keys.has('arrowup') || keys.has('w')) vControl -= 1;
    if (keys.has('arrowdown') || keys.has('s')) vControl += 1;
    
    // Touch controls
    if (touchState.left) vx -= 1;
    if (touchState.right) vx += 1;
    // Note: touchState.up is handled directly in touch events for single jump
    // Note: touchState.down removed (down button no longer exists)
  }

  const moving = !overlayOpen && !fatherFigureOverlayOpen && !designOverlayOpen && !designtoOverlayOpen && !jamOverlayOpen && !lucyOverlayOpen && !revisionOverlayOpen && !aboutMeOverlayOpen && (vx !== 0 || vControl !== 0 || !onGround || vy !== 0);
  setRaccoonImage(moving ? CONFIG.raccoon.walkSrc : CONFIG.raccoon.idleSrc);

  // Hide movement instructions when user starts moving
  if (moving && !hasStartedMoving) {
    hasStartedMoving = true;
    if (movementInstructionsEl) {
      movementInstructionsEl.style.opacity = '0';
      setTimeout(() => {
        movementInstructionsEl.style.display = 'none';
      }, 500); // Wait for fade transition to complete
    }
  }

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
  if (scene === 'inside' || scene === 'outside' || scene === 'upstairs') {
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
    if (overlayOpen || sceneTransitioning) {
      suitcaseHotspot && hide(suitcaseHotspot);
    } else {
      // Always show suitcase when inside and not in overlay or transitioning
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
    // Upstairs check (right edge of inside scene)
    if (!canOpenSuitcase && !sceneTransitioning) {
      const nearUpstairs = racX >= worldW - 400;
      canGoUpstairs = nearUpstairs;
      if (nearUpstairs) {
        canInteract = true;
        show(interactBtn);
        interactBtn.textContent = 'Go upstairs ⏎';
        placeInteractButtonAtWorld(racX, racY - 200);
      }
    } else {
      canGoUpstairs = false;
    }
  } else if (scene === 'upstairs') {
    if (shelfOverlayOpen || sceneTransitioning) {
      hide(interactBtn);
      canOpenShelf = false;
      canGoDownstairs = false;
      if (upstairsShelfEl) upstairsShelfEl.classList.remove('hover-active');
    } else {
      // Always show shelf when upstairs
      if (upstairsShelfEl) {
        show(upstairsShelfEl);
        const shelfDist = distance({ x: racX, y: racY }, shelfWorld);
        const nearShelf = shelfDist <= CONFIG.upstairs.shelf.radius;
        if (nearShelf || mouseOverShelf) {
          upstairsShelfEl.classList.add('hover-active');
          canOpenShelf = true;
          canInteract = true;
          show(interactBtn);
          interactBtn.textContent = 'Open shelf ⏎';
          placeInteractButtonAtWorld(shelfWorld.x, shelfWorld.y + 100);
        } else {
          upstairsShelfEl.classList.remove('hover-active');
          canOpenShelf = false;
        }
      }
      // Downstairs check (right edge of upstairs scene)
      const nearDownstairs = racX >= worldW - 150;
      canGoDownstairs = nearDownstairs;
      if (nearDownstairs && !canOpenShelf) {
        canInteract = true;
        show(interactBtn);
        interactBtn.textContent = 'Go downstairs ⏎';
        placeInteractButtonAtWorld(racX, racY - 200);
      } else if (!nearDownstairs && !canOpenShelf) {
        canGoDownstairs = false;
        canInteract = false;
        hide(interactBtn);
      }
    }
  } else {
    canInteract = false; hide(interactBtn);
    canOpenSuitcase = false;
    canGoUpstairs = false;
    canGoDownstairs = false;
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
  if (!spotlightEl || !spotlightEl.classList.contains('spotlight') || !racEl) return;
  
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
    spotlightEl.classList.add('active', 'spotlight');
  }
}

function disableSpotlight() {
  if (spotlightEl) {
    spotlightEl.classList.remove('active', 'spotlight');
  }
}

// Create about me overlay
function createAboutMeOverlay() {
  const ui = document.getElementById('ui');
  
  // Create about me overlay
  aboutMeOverlay = document.createElement('div');
  aboutMeOverlay.id = 'aboutMeOverlay';
  aboutMeOverlay.className = 'overlay hidden';
  aboutMeOverlay.setAttribute('aria-hidden', 'true');
  aboutMeOverlay.innerHTML = `
    <div class="overlay-backdrop" data-close-about></div>
    <button class="overlay-close" data-close-about aria-label="Close"></button>
    <div class="overlay-panel">
      <div class="about-me-stage">
        <div class="about-me-container">
          <img src="${versionedAsset('assets/profile.webp')}" alt="Profile" class="about-me-image">
          <a href="mailto:fxfang@uwaterloo.ca?subject=Your%20next%20case%3A%20JOIN%20OUR%20TEAM" class="mail-me-link" title="Send me an email">
            <img src="${versionedAsset('assets/mailme.webp')}" alt="Email Me" class="mail-me-icon">
          </a>
          <a href="https://www.linkedin.com/in/fiona-fangg/" target="_blank" class="msg-me-link" title="Message me on LinkedIn">
            <img src="${versionedAsset('assets/msgme.webp')}" alt="Message Me" class="msg-me-icon">
          </a>
        </div>
      </div>
    </div>`;
  ui.appendChild(aboutMeOverlay);

  // Close on backdrop click
  aboutMeOverlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.hasAttribute('data-close-about')) closeAboutMeOverlay();
  });
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
    
    // Always ensure cursor is visible
    cursor.classList.add('active');
    isVisible = true;
  });
  
  // Mouse enter/leave handlers for hover effects
  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    // Check if element or its parent is clickable
    const clickableElement = target.closest('.inv-asset, .hotspot-img, #interact, .overlay-close, .nav-arrow, .github-link, .jam-github-link, .jam-launch-button, .jam-watch-button, .jam-video-container, .lucy-news-link, .lucy-project-link, .revision-project-link, .designto-icon, .mail-me-link, .msg-me-link, .touch-btn, .nav-link, a, button, [onclick], .clickable');
    
    if (clickableElement) {
      cursor.classList.add('hover');
    }
  });
  
  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    // Check if element or its parent is clickable
    const clickableElement = target.closest('.inv-asset, .hotspot-img, #interact, .overlay-close, .nav-arrow, .github-link, .jam-github-link, .jam-launch-button, .jam-watch-button, .jam-video-container, .lucy-news-link, .lucy-project-link, .revision-project-link, .designto-icon, .mail-me-link, .msg-me-link, .touch-btn, .nav-link, a, button, [onclick], .clickable');
    
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
  
  // Chrome/Edge fullscreen specific: cursor resets in fullscreen mode
  // Listen for fullscreen changes and enforce cursor hiding
  const enforceFullscreenCursor = () => {
    if (document.fullscreenElement) {
      // In fullscreen - enforce cursor more aggressively
      document.documentElement.style.cursor = 'none';
      document.body.style.cursor = 'none';
    }
  };
  
  document.addEventListener('fullscreenchange', enforceFullscreenCursor);
  
  // Also enforce on click in fullscreen
  if (/Chrome|Edge/.test(navigator.userAgent)) {
    document.addEventListener('click', (e) => {
      if (document.fullscreenElement) {
        // In fullscreen, reset cursor after click
        setTimeout(() => {
          document.documentElement.style.cursor = 'none';
          document.body.style.cursor = 'none';
        }, 0);
      }
    }, true);
  }
  
  // Start animation loop
  updateCursor();
}

// -------- Loading and Init --------
async function ensureRaccoonImagesLoaded() {
  const raccoonImages = [CONFIG.raccoon.idleSrc, CONFIG.raccoon.walkSrc];
  const promises = raccoonImages.map(src => {
    return new Promise((resolve) => {
      // Check if already cached
      if (globalPreloader && globalPreloader.isImageCached(src)) {
        resolve();
        return;
      }
      
      // Load the image if not cached
      const img = new Image();
      img.onload = () => {
        if (globalPreloader) {
          globalPreloader.imageCache.set(src, img);
        }
        resolve();
      };
      img.onerror = () => {
        console.warn(`Failed to preload raccoon image: ${src}`);
        resolve(); // Don't block startup on failed image
      };
      img.src = src;
    });
  });
  
  await Promise.all(promises);
  console.log('Raccoon images preloaded successfully');
}

async function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  const gameEl = document.getElementById('game');

  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
}

async function startGame() {
  try {
    // size raccoon element from config and set initial src
    racEl.style.width = `${CONFIG.raccoon.width}px`;
    racEl.style.height = `${CONFIG.raccoon.height}px`;
    
    // Ensure raccoon images are preloaded before setting
    await ensureRaccoonImagesLoaded();
    setRaccoonImage(CONFIG.raccoon.idleSrc);

    await enterOutside();
    requestAnimationFrame(tick);
    
    // build overlay UI once DOM is ready
    createSuitcaseUI();
    createAboutMeOverlay();
    
    // Add event listener for projects link to open briefcase
    const projectsLink = document.getElementById('projects-link');
    if (projectsLink) {
      projectsLink.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior
        openInventory(); // Open the briefcase/suitcase
      });
    }
    
    // Add event listener for about link to open about me overlay
    const aboutLink = document.getElementById('about-link');
    if (aboutLink) {
      aboutLink.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior
        openAboutMeOverlay(); // Open the about me profile overlay
      });
    }
    
    // Add event listener for back button to exit house
    const backButton = document.getElementById('back-button');
    if (backButton) {
      backButton.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Back button clicked - Scene:', scene, 'Overlays:', {
          overlayOpen, fatherFigureOverlayOpen, designOverlayOpen, designtoOverlayOpen, 
          jamOverlayOpen, lucyOverlayOpen, revisionOverlayOpen, aboutMeOverlayOpen
        });
        if (scene === 'inside' && !overlayOpen && !fatherFigureOverlayOpen && !designOverlayOpen && !designtoOverlayOpen && !jamOverlayOpen && !lucyOverlayOpen && !revisionOverlayOpen && !aboutMeOverlayOpen) {
          console.log('Attempting to exit house...');
          tryExitHouse();
        } else if (scene === 'upstairs' && !shelfOverlayOpen) {
          console.log('Attempting to go downstairs...');
          tryExitUpstairs();
        } else {
          console.log('Cannot exit - conditions not met');
        }
      });
    }

    const upstairsButton = document.getElementById('upstairs-button');
    if (upstairsButton && backButton) {
      upstairsButton.addEventListener('click', () => {
        if (scene !== 'inside' || sceneTransitioning) return;
        playSound(doorSound);
        sceneTransitioning = true;
        fadeOutIn(async () => {
          await enterUpstairs();
          sceneTransitioning = false;
        });
      });
      // Mirror back button visibility but only on the inside scene
      new MutationObserver(() => {
        if (scene !== 'inside') {
          upstairsButton.classList.add('hidden');
          return;
        }
        if (backButton.classList.contains('hidden')) {
          upstairsButton.classList.add('hidden');
        } else {
          upstairsButton.classList.remove('hidden');
        }
      }).observe(backButton, { attributes: true, attributeFilter: ['class'] });
    }

    const downstairsButton = document.getElementById('downstairs-button');
    if (downstairsButton) {
      downstairsButton.addEventListener('click', () => {
        if (scene !== 'upstairs' || sceneTransitioning || shelfOverlayOpen) return;
        tryExitUpstairs();
      });
    }

    // create touch controls for mobile
    createTouchControls();
    if ('ontouchstart' in window && movementInstructionsEl) {
      movementInstructionsEl.textContent = 'please view on desktop for best experience ⋆˙⟡';
    }
    // create custom floating cursor (desktop only — skip on touch devices)
    if (!('ontouchstart' in window)) createCustomCursor();

    // Recompute layout on resize to keep full image height visible
    window.addEventListener('resize', () => {
      // Re-fit current scene
      if (!bgEl.naturalWidth || !bgEl.naturalHeight) return;
      // Re-sync game height to visual viewport on mobile (Safari 100vh != innerHeight)
      const resizeFloorBar = document.getElementById('mobile-floor-bar');
      if (resizeFloorBar && resizeFloorBar.style.display === 'block') {
        gameEl.style.height = `${window.innerHeight - resizeFloorBar.offsetHeight}px`;
        void gameEl.offsetHeight;
      }
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
            suitcaseHotspot.style.height = 'auto'; // maintain aspect ratio
          }
        }
        centerCameraOn(racX, racY);
      }
    });
    
  } catch (error) {
    console.error('Error during game initialization:', error);
    // Fallback: still try to start the game with minimal functionality
    racEl.style.width = `${CONFIG.raccoon.width}px`;
    racEl.style.height = `${CONFIG.raccoon.height}px`;
    setRaccoonImage(CONFIG.raccoon.idleSrc);
    requestAnimationFrame(tick);
  }
}

// Mobile detection function
function isMobileDevice() {
  // Check for mobile user agents
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;

  // Check user agent
  if (mobileRegex.test(userAgent.toLowerCase())) {
    return true;
  }

  // Check for touch support and small screen size
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 1024;

  return hasTouch && isSmallScreen;
}

// Show mobile warning instead of game
function showMobileWarning() {
  const loadingScreen = document.getElementById('loading-screen');
  const mobileWarning = document.getElementById('mobile-warning');

  // Hide loading screen
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }

  // Show mobile warning
  if (mobileWarning) {
    mobileWarning.style.display = 'flex';
  }

  document.body.classList.remove('loading');
}

// Main initialization with loading screen
(async function init() {
  // Mobile devices are now supported - game runs on all screen sizes

  try {
    // Initialize the asset preloader
    const preloader = new AssetPreloader();
    globalPreloader = preloader; // Store global reference

    // Set up progress callback
    preloader.setProgressCallback((percentage, loaded, total) => {
      console.log(`Loading progress: ${percentage}% (${loaded}/${total})`);
    });

    // Start preloading assets
    console.log('Starting asset preload...');
    await preloader.preloadAssets();
    console.log('All assets loaded successfully!');

    // Hide loading screen and start the game
    await hideLoadingScreen();
    await startGame();
    document.body.classList.remove('loading');
    const gameEl = document.getElementById('game');
    if (gameEl) gameEl.classList.remove('hidden');

  } catch (error) {
    console.error('Error during initialization:', error);
    // Even if preloading fails, try to start the game
    await hideLoadingScreen();
    await startGame();
    document.body.classList.remove('loading');
    const gameEl = document.getElementById('game');
    if (gameEl) gameEl.classList.remove('hidden');
  }
})();
