#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AssetOptimizer {
  constructor() {
    this.assetsDir = './assets';
    this.optimizedDir = './assets/optimized';
    this.stats = { original: 0, optimized: 0, files: 0 };
  }

  // Ensure optimized directory exists
  ensureOptimizedDir() {
    if (!fs.existsSync(this.optimizedDir)) {
      fs.mkdirSync(this.optimizedDir, { recursive: true });
    }
  }

  // Get file size
  getFileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch (error) {
      return 0;
    }
  }

  // Format bytes
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Optimize PNG using sips
  optimizePNG(inputPath, outputPath) {
    try {
      const originalSize = this.getFileSize(inputPath);
      
      // Convert PNG to JPEG with high quality for photos, keep PNG for graphics
      const isLikelyPhoto = originalSize > 500000; // > 500KB likely a photo
      
      if (isLikelyPhoto) {
        // Convert large PNGs to JPEG
        const jpegOutput = outputPath.replace('.png', '.jpg');
        execSync(`sips -s format jpeg -s formatOptions 85 "${inputPath}" --out "${jpegOutput}"`, { stdio: 'ignore' });
        
        const optimizedSize = this.getFileSize(jpegOutput);
        const savings = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
        
        console.log(`✓ ${path.basename(inputPath)} → ${path.basename(jpegOutput)} (JPEG)`);
        console.log(`  ${this.formatBytes(originalSize)} → ${this.formatBytes(optimizedSize)} (${savings}% smaller)`);
        
        this.stats.original += originalSize;
        this.stats.optimized += optimizedSize;
        this.stats.files++;
        
        return jpegOutput;
      } else {
        // Keep as PNG but optimize
        fs.copyFileSync(inputPath, outputPath);
        console.log(`✓ ${path.basename(inputPath)} → kept as PNG (graphics)`);
        return outputPath;
      }
    } catch (error) {
      console.error(`✗ Failed to optimize ${inputPath}:`, error.message);
      return null;
    }
  }

  // Optimize JPEG
  optimizeJPEG(inputPath, outputPath) {
    try {
      const originalSize = this.getFileSize(inputPath);
      let quality = 85;
      
      // Adjust quality based on file size
      if (originalSize > 2 * 1024 * 1024) quality = 75; // > 2MB
      if (originalSize > 5 * 1024 * 1024) quality = 65; // > 5MB
      
      execSync(`sips -s formatOptions ${quality} "${inputPath}" --out "${outputPath}"`, { stdio: 'ignore' });
      
      const optimizedSize = this.getFileSize(outputPath);
      const savings = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
      
      console.log(`✓ ${path.basename(inputPath)} → ${path.basename(outputPath)}`);
      console.log(`  ${this.formatBytes(originalSize)} → ${this.formatBytes(optimizedSize)} (${savings}% smaller)`);
      
      this.stats.original += originalSize;
      this.stats.optimized += optimizedSize;
      this.stats.files++;
      
      return outputPath;
    } catch (error) {
      console.error(`✗ Failed to optimize ${inputPath}:`, error.message);
      return null;
    }
  }

  // Optimize GIF (keep as-is, they're usually small and animated)
  optimizeGIF(inputPath, outputPath) {
    fs.copyFileSync(inputPath, outputPath);
    console.log(`✓ ${path.basename(inputPath)} → kept as GIF (animated)`);
    return outputPath;
  }

  // Optimize all assets
  async optimizeAllAssets() {
    console.log('🚀 Starting asset optimization...\n');
    
    this.ensureOptimizedDir();
    
    const files = fs.readdirSync(this.assetsDir);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
    });

    console.log(`Found ${imageFiles.length} images to optimize\n`);

    const optimizedFiles = [];

    for (const file of imageFiles) {
      const inputPath = path.join(this.assetsDir, file);
      const outputPath = path.join(this.optimizedDir, file);
      const ext = path.extname(file).toLowerCase();
      
      let result = null;
      
      switch (ext) {
        case '.png':
          result = this.optimizePNG(inputPath, outputPath);
          break;
        case '.jpg':
        case '.jpeg':
          result = this.optimizeJPEG(inputPath, outputPath);
          break;
        case '.gif':
          result = this.optimizeGIF(inputPath, outputPath);
          break;
      }
      
      if (result) {
        optimizedFiles.push({
          original: file,
          optimized: path.basename(result),
          path: result
        });
      }
    }

    this.printStats();
    this.generateAssetMap(optimizedFiles);
    
    return optimizedFiles;
  }

  // Generate asset mapping file
  generateAssetMap(optimizedFiles) {
    const assetMap = {};
    
    optimizedFiles.forEach(({ original, optimized, path: filePath }) => {
      // Map original filename to optimized version
      assetMap[`assets/${original}`] = `assets/optimized/${optimized}`;
    });

    // Write asset map for the loader
    fs.writeFileSync('./asset-map.json', JSON.stringify(assetMap, null, 2));
    console.log('\n📋 Generated asset-map.json for optimized loading');
  }

  // Print optimization stats
  printStats() {
    const totalSavings = this.stats.original - this.stats.optimized;
    const savingsPercent = this.stats.original > 0 ? 
      ((totalSavings / this.stats.original) * 100).toFixed(1) : 0;
    
    console.log('\n📊 Optimization Summary:');
    console.log(`Files processed: ${this.stats.files}`);
    console.log(`Original size: ${this.formatBytes(this.stats.original)}`);
    console.log(`Optimized size: ${this.formatBytes(this.stats.optimized)}`);
    console.log(`Total savings: ${this.formatBytes(totalSavings)} (${savingsPercent}%)`);
  }

  // Analyze current assets
  analyzeAssets() {
    console.log('📊 Asset Analysis:\n');
    
    const files = fs.readdirSync(this.assetsDir);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
    });

    let totalSize = 0;
    const largeFiles = [];
    const filesByType = { png: [], jpg: [], gif: [] };

    imageFiles.forEach(file => {
      const filePath = path.join(this.assetsDir, file);
      const size = this.getFileSize(filePath);
      const ext = path.extname(file).toLowerCase();
      
      totalSize += size;
      
      if (size > 1024 * 1024) { // > 1MB
        largeFiles.push({ file, size: this.formatBytes(size) });
      }
      
      if (ext === '.png') filesByType.png.push({ file, size });
      else if (ext === '.jpg' || ext === '.jpeg') filesByType.jpg.push({ file, size });
      else if (ext === '.gif') filesByType.gif.push({ file, size });
    });

    console.log(`Total images: ${imageFiles.length}`);
    console.log(`Total size: ${this.formatBytes(totalSize)}`);
    console.log(`PNG files: ${filesByType.png.length}`);
    console.log(`JPEG files: ${filesByType.jpg.length}`);
    console.log(`GIF files: ${filesByType.gif.length}`);

    if (largeFiles.length > 0) {
      console.log('\n🔍 Large files (>1MB):');
      largeFiles.forEach(({ file, size }) => {
        console.log(`  ${file}: ${size}`);
      });
    }

    // Identify optimization opportunities
    const largePNGs = filesByType.png.filter(({ size }) => size > 500000);
    if (largePNGs.length > 0) {
      console.log('\n💡 Optimization opportunities:');
      console.log(`  ${largePNGs.length} large PNG files could be converted to JPEG`);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const optimizer = new AssetOptimizer();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'optimize':
      optimizer.optimizeAllAssets();
      break;
    case 'analyze':
      optimizer.analyzeAssets();
      break;
    default:
      console.log('Usage:');
      console.log('  node optimize-assets.js optimize  - Optimize all assets');
      console.log('  node optimize-assets.js analyze   - Analyze current assets');
  }
}

module.exports = AssetOptimizer;
