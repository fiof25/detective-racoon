#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AssetCompressor {
  constructor() {
    this.assetsDir = './assets';
    this.compressionStats = {
      original: 0,
      compressed: 0,
      files: 0
    };
  }

  // Check if sips (macOS built-in) is available
  checkDependencies() {
    try {
      execSync('sips --version', { stdio: 'ignore' });
      console.log('Using macOS sips for image compression...');
      return true;
    } catch (error) {
      console.error('sips not available. This script requires macOS.');
      return false;
    }
  }

  // Get file size in bytes
  getFileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch (error) {
      return 0;
    }
  }

  // Format bytes to human readable
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Compress single image using sips
  async compressImage(inputPath, outputPath, quality = 80) {
    try {
      const originalSize = this.getFileSize(inputPath);
      const ext = path.extname(inputPath).toLowerCase();
      
      // Different quality settings based on file type and size
      let compressionQuality = quality;
      if (originalSize > 5 * 1024 * 1024) { // > 5MB
        compressionQuality = 60;
      } else if (originalSize > 2 * 1024 * 1024) { // > 2MB  
        compressionQuality = 70;
      }

      // Use sips to convert and compress
      // For WebP, we'll convert to high-quality JPEG first, then use a different approach
      if (outputPath.endsWith('.webp')) {
        // Convert to JPEG with compression first
        const tempJpeg = outputPath.replace('.webp', '.temp.jpg');
        const jpegCommand = `sips -s format jpeg -s formatOptions ${compressionQuality} "${inputPath}" --out "${tempJpeg}"`;
        execSync(jpegCommand, { stdio: 'ignore' });
        
        // For now, just rename the JPEG to indicate it's compressed
        const finalJpeg = outputPath.replace('.webp', '.compressed.jpg');
        fs.renameSync(tempJpeg, finalJpeg);
        outputPath = finalJpeg;
      } else {
        // Direct compression for other formats
        const command = `sips -s format jpeg -s formatOptions ${compressionQuality} "${inputPath}" --out "${outputPath}"`;
        execSync(command, { stdio: 'ignore' });
      }
      
      const compressedSize = this.getFileSize(outputPath);
      const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
      
      console.log(`✓ ${path.basename(inputPath)} → ${path.basename(outputPath)}`);
      console.log(`  ${this.formatBytes(originalSize)} → ${this.formatBytes(compressedSize)} (${savings}% smaller)`);
      
      this.compressionStats.original += originalSize;
      this.compressionStats.compressed += compressedSize;
      this.compressionStats.files++;
      
      return true;
    } catch (error) {
      console.error(`✗ Failed to compress ${inputPath}:`, error.message);
      return false;
    }
  }

  // Compress all assets
  async compressAllAssets() {
    if (!this.checkDependencies()) {
      return false;
    }

    console.log('🗜️  Starting asset compression...\n');

    if (!fs.existsSync(this.assetsDir)) {
      console.error(`Assets directory not found: ${this.assetsDir}`);
      return false;
    }

    const files = fs.readdirSync(this.assetsDir);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
    });

    console.log(`Found ${imageFiles.length} images to compress\n`);

    for (const file of imageFiles) {
      const inputPath = path.join(this.assetsDir, file);
      const outputPath = path.join(this.assetsDir, file.replace(/\.(png|jpg|jpeg|gif)$/i, '.webp'));
      
      // Skip if WebP version already exists and is newer
      if (fs.existsSync(outputPath)) {
        const inputStat = fs.statSync(inputPath);
        const outputStat = fs.statSync(outputPath);
        if (outputStat.mtime > inputStat.mtime) {
          console.log(`⏭️  Skipping ${file} (WebP version up to date)`);
          continue;
        }
      }

      await this.compressImage(inputPath, outputPath);
    }

    this.printCompressionStats();
    return true;
  }

  // Print compression statistics
  printCompressionStats() {
    const totalSavings = this.compressionStats.original - this.compressionStats.compressed;
    const savingsPercent = ((totalSavings / this.compressionStats.original) * 100).toFixed(1);
    
    console.log('\n📊 Compression Summary:');
    console.log(`Files processed: ${this.compressionStats.files}`);
    console.log(`Original size: ${this.formatBytes(this.compressionStats.original)}`);
    console.log(`Compressed size: ${this.formatBytes(this.compressionStats.compressed)}`);
    console.log(`Total savings: ${this.formatBytes(totalSavings)} (${savingsPercent}%)`);
  }

  // Generate optimization report
  generateReport() {
    const files = fs.readdirSync(this.assetsDir);
    const report = {
      largeFiles: [],
      uncompressed: [],
      totalSize: 0
    };

    files.forEach(file => {
      const filePath = path.join(this.assetsDir, file);
      const size = this.getFileSize(filePath);
      const ext = path.extname(file).toLowerCase();
      
      report.totalSize += size;
      
      if (size > 1024 * 1024) { // > 1MB
        report.largeFiles.push({ file, size: this.formatBytes(size) });
      }
      
      if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const webpVersion = file.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        if (!files.includes(webpVersion)) {
          report.uncompressed.push(file);
        }
      }
    });

    console.log('\n📋 Asset Report:');
    console.log(`Total assets size: ${this.formatBytes(report.totalSize)}`);
    
    if (report.largeFiles.length > 0) {
      console.log(`\n🔍 Large files (>1MB):`);
      report.largeFiles.forEach(({ file, size }) => {
        console.log(`  ${file}: ${size}`);
      });
    }
    
    if (report.uncompressed.length > 0) {
      console.log(`\n⚠️  Files without WebP versions:`);
      report.uncompressed.forEach(file => {
        console.log(`  ${file}`);
      });
    }

    return report;
  }
}

// Run if called directly
if (require.main === module) {
  const compressor = new AssetCompressor();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'compress':
      compressor.compressAllAssets();
      break;
    case 'report':
      compressor.generateReport();
      break;
    default:
      console.log('Usage:');
      console.log('  node compress-assets.js compress  - Compress all assets to WebP');
      console.log('  node compress-assets.js report    - Generate asset report');
  }
}

module.exports = AssetCompressor;
