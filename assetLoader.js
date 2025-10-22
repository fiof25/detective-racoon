class AssetLoader {
  constructor() {
    this.assets = new Map();
    this.loadedCount = 0;
    this.totalCount = 0;
    this.onProgress = null;
    this.onComplete = null;
    this.assetMap = null;
  }

  // Load asset mapping for optimized versions
  async loadAssetMap() {
    try {
      const response = await fetch('./asset-map.json');
      this.assetMap = await response.json();
      console.log('Loaded optimized asset mapping');
    } catch (error) {
      console.warn('Could not load asset map, using original assets');
      this.assetMap = {};
    }
  }

  // Get optimized asset path
  getOptimizedPath(originalPath) {
    if (!this.assetMap) return originalPath;
    return this.assetMap[originalPath] || originalPath;
  }

  // Define all assets with priorities
  getAssetManifest() {
    return {
      // Critical assets (load first)
      critical: [
        'assets/idle.gif',
        'assets/walking.gif', 
        'assets/outside_house.jpg',
        'assets/static_downstairs.jpg',
        'assets/loadpusheen.gif'
      ],
      
      // UI assets (load second)
      ui: [
        'assets/backbutton.png',
        'assets/email.png',
        'assets/linkedin.png',
        'assets/github.png',
        'assets/projects.png',
        'assets/aboutme.png',
        'assets/arrow.png',
        'assets/exitButton.png',
        'assets/searchIcon.png'
      ],
      
      // Project assets (load third)
      projects: [
        'assets/jamLaunchIcon.png',
        'assets/lucyProjectIcon.png', 
        'assets/revisionProjectIcon.png',
        'assets/designtoIcon.png',
        'assets/designtoIconPressed.png',
        'assets/suitcase.png'
      ],
      
      // Large content assets (load last, with compression)
      content: [
        'assets/jamAsset.png',
        'assets/jamAsset2.png',
        'assets/jamNote.png',
        'assets/jamVid.png',
        'assets/lucyAsset.png',
        'assets/lucyAsset2.png',
        'assets/lucyNote.png',
        'assets/lucyArticle.png',
        'assets/revisionAsset.png',
        'assets/revisionAsset2.png',
        'assets/revisionNote.png',
        'assets/designAsset.png',
        'assets/designAsset2.png',
        'assets/designNote.png',
        'assets/designtoAsset.png',
        'assets/designtoAsset2.png',
        'assets/designtoNote.png',
        'assets/fatherfigureAsset.png',
        'assets/fatherfigureAsset2.png',
        'assets/fatherfigureNote.png',
        'assets/fatherfigureNote2.png',
        'assets/suitcaseAsset.png',
        'assets/fionafang.png'
      ]
    };
  }

  // Load image with optimized version support
  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      // Use optimized version if available
      const optimizedSrc = this.getOptimizedPath(src);
      
      img.onload = () => {
        this.assets.set(src, img); // Store with original key for easy lookup
        this.loadedCount++;
        this.updateProgress();
        resolve(img);
      };
      
      img.onerror = () => {
        // Fallback to original if optimized version fails
        if (optimizedSrc !== src) {
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            this.assets.set(src, fallbackImg);
            this.loadedCount++;
            this.updateProgress();
            resolve(fallbackImg);
          };
          fallbackImg.onerror = () => {
            console.warn(`Failed to load asset: ${src}`);
            this.loadedCount++;
            this.updateProgress();
            reject(new Error(`Failed to load ${src}`));
          };
          fallbackImg.src = src;
        } else {
          console.warn(`Failed to load asset: ${src}`);
          this.loadedCount++;
          this.updateProgress();
          reject(new Error(`Failed to load ${src}`));
        }
      };
      
      img.src = optimizedSrc;
    });
  }

  // Check WebP support
  supportsWebP() {
    if (this._webpSupport !== undefined) return this._webpSupport;
    
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    this._webpSupport = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    return this._webpSupport;
  }

  // Get WebP version of asset path
  getWebPVersion(src) {
    const ext = src.split('.').pop();
    return src.replace(`.${ext}`, `.webp`);
  }

  // Update loading progress
  updateProgress() {
    const progress = Math.round((this.loadedCount / this.totalCount) * 100);
    if (this.onProgress) {
      this.onProgress(progress, this.loadedCount, this.totalCount);
    }
    
    if (this.loadedCount >= this.totalCount && this.onComplete) {
      this.onComplete();
    }
  }

  // Load assets by priority
  async loadAssetsByPriority() {
    // Load asset map first
    await this.loadAssetMap();
    
    const manifest = this.getAssetManifest();
    const allAssets = [
      ...manifest.critical,
      ...manifest.ui, 
      ...manifest.projects,
      ...manifest.content
    ];
    
    this.totalCount = allAssets.length;
    this.loadedCount = 0;

    try {
      // Load critical assets first (parallel)
      console.log('Loading critical assets...');
      await Promise.all(manifest.critical.map(src => this.loadImage(src)));
      
      // Load UI assets (parallel)
      console.log('Loading UI assets...');
      await Promise.all(manifest.ui.map(src => this.loadImage(src)));
      
      // Load project assets (parallel)
      console.log('Loading project assets...');
      await Promise.all(manifest.projects.map(src => this.loadImage(src)));
      
      // Load content assets (sequential to avoid overwhelming)
      console.log('Loading content assets...');
      for (const src of manifest.content) {
        try {
          await this.loadImage(src);
        } catch (error) {
          console.warn(`Skipping failed asset: ${src}`);
        }
      }
      
      console.log('All assets loaded successfully!');
      
    } catch (error) {
      console.error('Error loading assets:', error);
    }
  }

  // Get loaded asset
  getAsset(src) {
    return this.assets.get(src);
  }

  // Preload specific assets
  async preloadAssets(assetList) {
    const promises = assetList.map(src => this.loadImage(src));
    return Promise.allSettled(promises);
  }

  // Get loading statistics
  getStats() {
    return {
      loaded: this.loadedCount,
      total: this.totalCount,
      progress: Math.round((this.loadedCount / this.totalCount) * 100),
      cached: this.assets.size
    };
  }
}

// Export for use in other scripts
window.AssetLoader = AssetLoader;
