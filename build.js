const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { transformSync } = require("@swc/core");
const { transform } = require("lightningcss");
const { Font, woff2 } = require("fonteditor-core");

const CONFIG = {
  SRC_DIR: "src",
  BUILD_DIR: "dist",
  IMAGE_EXTS: [".jpg", ".jpeg", ".png"],
  TEXT_EXTS: [".html", ".css", ".js"],
  FONT_EXTS: [".ttf", ".otf", ".woff2"],
  IMAGE_QUALITY: 60,
  IMAGE_EFFORT: 6, // AVIF effort level
  SIZE_INCREMENT: 128,
  MAX_INCREMENT_SIZE: 1024,
  MIN_QUARTER_INCREMENT: 128
};

class FileSystem {
  static findFiles(dir, extensions) {
    const files = [];
    const scan = (currentDir) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (this.shouldSkipEntry(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (this.hasValidExtension(entry.name, extensions)) {
          files.push(fullPath);
        }
      }
    };

    scan(dir);
    return files;
  }

  static shouldSkipEntry(name) {
    return name.startsWith(".") || name === "node_modules";
  }

  static hasValidExtension(filename, extensions) {
    return extensions.includes(path.extname(filename).toLowerCase());
  }

  static ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  static normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
  }
}

class PathUtils {
  static getRelativePath(from, to) {
    return FileSystem.normalizePath(path.relative(from, to));
  }

  static getBaseNameWithoutExt(filePath) {
    return path.basename(filePath, path.extname(filePath));
  }

  static changeExtension(filePath, newExt) {
    return filePath.replace(/\.[^.]+$/, newExt);
  }
}

class FileProcessor {
  constructor(buildDir) {
    this.buildDir = buildDir;
  }

  findFiles(extensions) {
    return FileSystem.findFiles(this.buildDir, extensions);
  }

  updateFileReferences(oldPath, newPath) {
    const textFiles = this.findFiles(CONFIG.TEXT_EXTS);
    const oldRef = PathUtils.getRelativePath(this.buildDir, oldPath);
    const newRef = PathUtils.getRelativePath(this.buildDir, newPath);

    textFiles.forEach(file => this.updateSingleFileReferences(file, oldRef, newRef));
  }

  updateSingleFileReferences(file, oldRef, newRef) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(oldRef)) {
      const updated = content.replaceAll(oldRef, newRef);
      fs.writeFileSync(file, updated);
      console.log(`Updated references in: ${PathUtils.getRelativePath(this.buildDir, file)}`);
    }
  }
}

class ImageSizeCalculator {
  static calculate(originalWidth) {
    const sizes = [];
    
    this.addIncrementalSizes(sizes, originalWidth);
    this.addIntermediateSizes(sizes, originalWidth);
    this.addOriginalSize(sizes, originalWidth);

    return sizes;
  }

  static addIncrementalSizes(sizes, originalWidth) {
    for (let size = CONFIG.SIZE_INCREMENT; size <= CONFIG.MAX_INCREMENT_SIZE && size <= originalWidth; size += CONFIG.SIZE_INCREMENT) {
      sizes.push({
        width: size,
        folder: `${size}`,
        type: 'increment'
      });
    }
  }

  static addIntermediateSizes(sizes, originalWidth) {
    if (originalWidth <= CONFIG.MAX_INCREMENT_SIZE) return;

    const diff = originalWidth - CONFIG.MAX_INCREMENT_SIZE;
    const quarter = Math.round(diff * 0.25);
    const half = Math.round(diff * 0.5);
    const threeQuarter = Math.round(diff * 0.75);

    if (quarter >= CONFIG.MIN_QUARTER_INCREMENT) {
      sizes.push(
        { width: CONFIG.MAX_INCREMENT_SIZE + quarter, folder: '25', type: 'intermediate' },
        { width: CONFIG.MAX_INCREMENT_SIZE + half, folder: '50', type: 'intermediate' },
        { width: CONFIG.MAX_INCREMENT_SIZE + threeQuarter, folder: '75', type: 'intermediate' }
      );
    } else {
      sizes.push({ width: CONFIG.MAX_INCREMENT_SIZE + half, folder: '50', type: 'intermediate' });
    }
  }

  static addOriginalSize(sizes, originalWidth) {
    sizes.push({
      width: originalWidth,
      folder: 'original',
      type: 'original'
    });
  }
}

class ImageVariantGenerator {
  constructor(imagePath) {
    this.imagePath = imagePath;
    this.sharpImage = sharp(imagePath);
    this.baseName = PathUtils.getBaseNameWithoutExt(imagePath);
    this.dirName = path.dirname(imagePath);
  }

  async generate() {
    const { width } = await this.sharpImage.metadata();
    if (!width) throw new Error(`Could not get width for image: ${this.imagePath}`);

    const sizes = ImageSizeCalculator.calculate(width);
    const generatedImages = [];

    console.log(`Generating ${sizes.length} sizes for ${this.baseName}: ${sizes.map(s => s.width).join(', ')}`);

    for (const sizeInfo of sizes) {
      const outputPath = await this.generateSingleVariant(sizeInfo);
      generatedImages.push({
        path: outputPath,
        width: sizeInfo.width,
        folder: sizeInfo.folder,
        type: sizeInfo.type
      });
    }

    return {
      generatedImages,
      originalWidth: width,
      originalImage: generatedImages.find(img => img.type === 'original')
    };
  }

  async generateSingleVariant(sizeInfo) {
    const folderPath = path.join(this.dirName, sizeInfo.folder);
    FileSystem.ensureDirectory(folderPath);

    const fileName = sizeInfo.type === 'original'
      ? `${this.baseName}.avif`
      : `${this.baseName}-${sizeInfo.width}w.avif`;

    const outputPath = path.join(folderPath, fileName);

    await this.sharpImage
      .clone()
      .resize(sizeInfo.width)
      .avif({ 
        quality: CONFIG.IMAGE_QUALITY,
        effort: CONFIG.IMAGE_EFFORT 
      })
      .toFile(outputPath);

    return outputPath;
  }
}

class HtmlSrcsetUpdater {
  constructor(buildDir) {
    this.buildDir = buildDir;
  }

  updateAll(originalImagePath, generatedImages) {
    const htmlFiles = FileSystem.findFiles(this.buildDir, [".html"]);
    const baseName = PathUtils.getBaseNameWithoutExt(originalImagePath);
    const baseRef = this.createBaseReference(originalImagePath, baseName);

    htmlFiles.forEach(file => this.updateSingleFile(file, baseName, baseRef, generatedImages));
  }

  createBaseReference(originalImagePath, baseName) {
    const originalRef = PathUtils.getRelativePath(this.buildDir, originalImagePath);
    return FileSystem.normalizePath(
      originalRef.replace(/\/[^\/]*\/[^\/]*$/, '').replace(/\.[^.]+$/, "") || baseName
    );
  }

  updateSingleFile(file, baseName, baseRef, generatedImages) {
    let content = fs.readFileSync(file, "utf8");
    const srcsetValues = this.generateSrcsetValues(file, generatedImages);
    let updated = false;

    const originalExts = [".jpg", ".jpeg", ".png", ".webp", ".avif"];
    
    for (const ext of originalExts) {
      const patterns = this.createPatterns(baseName, baseRef, ext);
      for (const regex of patterns) {
        const result = this.updateContentWithPattern(content, regex, srcsetValues, file, generatedImages);
        content = result.content;
        updated = updated || result.updated;
      }
    }

    if (updated) {
      fs.writeFileSync(file, content);
      console.log(`✓ Updated/added srcset in: ${PathUtils.getRelativePath(this.buildDir, file)}`);
    }
  }

  generateSrcsetValues(file, generatedImages) {
    return generatedImages
      .map(img => {
        const relativePath = FileSystem.normalizePath(
          path.relative(path.dirname(file), img.path)
        );
        return `${relativePath} ${img.width}w`;
      })
      .join(", ");
  }

  createPatterns(baseName, baseRef, ext) {
    return [
      new RegExp(`<img\\b([^>]*?)src=["']([^"']*?)${baseName}\\${ext}["']([^>]*?)>`, "gi"),
      new RegExp(`<img\\b([^>]*?)src=["']([^"']*?)${baseRef}\\${ext}["']([^>]*?)>`, "gi")
    ];
  }

  updateContentWithPattern(content, regex, srcsetValues, file, generatedImages) {
    let updated = false;
    
    const newContent = content.replace(regex, (match, before, srcPath, after) => {
      updated = true;
      const originalImg = generatedImages.find(img => img.type === 'original');
      const srcValue = FileSystem.normalizePath(
        path.relative(path.dirname(file), originalImg.path)
      );

      if (/\ssrcset\s*=/.test(match)) {
        return match.replace(/\ssrcset\s*=\s*["'][^"']*["']/i, ` srcset="${srcsetValues}"`);
      } else {
        return `<img${before}src="${srcValue}" srcset="${srcsetValues}"${after}>`;
      }
    });

    return { content: newContent, updated };
  }
}

class ImageOptimizer extends FileProcessor {
  async optimize() {
    const images = this.findFiles(CONFIG.IMAGE_EXTS);
    if (images.length === 0) {
      console.log("No images to optimize");
      return [];
    }

    console.log(`Optimizing ${images.length} images to AVIF (quality: ${CONFIG.IMAGE_QUALITY}, effort: ${CONFIG.IMAGE_EFFORT})...`);
    const processedFiles = [];
    const srcsetUpdater = new HtmlSrcsetUpdater(this.buildDir);

    for (const imagePath of images) {
      try {
        const result = await this.processImage(imagePath, srcsetUpdater);
        processedFiles.push(...result);
      } catch (error) {
        console.error(`✗ Failed to process ${PathUtils.getRelativePath(this.buildDir, imagePath)}:`, error.message);
      }
    }

    return processedFiles;
  }

  async processImage(imagePath, srcsetUpdater) {
    const generator = new ImageVariantGenerator(imagePath);
    const { generatedImages, originalImage } = await generator.generate();

    fs.unlinkSync(imagePath);
    srcsetUpdater.updateAll(originalImage.path, generatedImages);

    console.log(`✓ Processed ${PathUtils.getRelativePath(this.buildDir, imagePath)} -> ${generatedImages.length} AVIF variants`);
    
    return generatedImages.map(img => img.path);
  }
}

class FontConverter {
  constructor() {
    this.woff2Ready = woff2.init().catch(err => {
      console.error("woff2.init() failed:", err);
      throw err;
    });
  }

  async convertToWoff2(fontPath) {
    const ext = path.extname(fontPath).toLowerCase();
    if (ext === ".woff2") return fontPath;

    const outPath = PathUtils.changeExtension(fontPath, ".woff2");
    await this.woff2Ready;

    const buffer = fs.readFileSync(fontPath);
    const typeHint = ext === ".otf" ? "otf" : "ttf";

    try {
      const font = Font.create(buffer, {
        type: typeHint,
        hinting: true,
        compound2simple: true,
      });

      const allowedRanges = [
        [0x0000, 0x007F], // Basic Latin
        [0x0080, 0x00FF], // Latin-1 Supplement
        [0x0100, 0x024F], // Latin Extended-A & B
        [0x1E00, 0x1EFF], // Latin Extended Additional
        [0x0300, 0x036F], // Combining Diacritical Marks
      ];
      const allowedSingles = [0x20AB]; // Vietnamese đồng sign

      const keptGlyphs = font.find({
        filter: (glyph) => {
          if (!glyph.unicode) return false;
          const code = glyph.unicode;
          return allowedRanges.some(([start, end]) => code >= start && code <= end) ||
                allowedSingles.includes(code);
        }
      });

      const fontData = font.get();

      fontData.glyf = keptGlyphs;

      fontData.cmap = keptGlyphs.reduce((map, glyph) => {
        if (glyph.unicode) {
          map[glyph.unicode] = glyph.name;
        }
        return map;
      }, {});

      const uint8 = font.write({ type: "woff2", hinting: true });
      fs.writeFileSync(outPath, Buffer.from(uint8));

      return outPath;
    } catch (err) {
      throw new Error(`Failed to process font ${path.basename(fontPath)}: ${err.message}`);
    }
  }
}

class CSSFontUpdater {
  constructor(buildDir) {
    this.buildDir = buildDir;
  }

  updateFontFormat(oldPath, newPath) {
    const cssFiles = FileSystem.findFiles(this.buildDir, [".css"]);
    const oldRef = PathUtils.getRelativePath(this.buildDir, oldPath);
    const newRef = PathUtils.getRelativePath(this.buildDir, newPath);

    cssFiles.forEach(file => this.updateSingleCssFile(file, oldRef, newRef));
  }

  updateSingleCssFile(file, oldRef, newRef) {
    let content = fs.readFileSync(file, "utf8");
    let updated = false;

    if (content.includes(oldRef)) {
      content = content.replaceAll(oldRef, newRef);
      updated = true;
    }

    if (content.includes(newRef)) {
      const result = this.updateFontFormats(content);
      content = result.content;
      updated = updated || result.updated;
    }

    if (updated) {
      fs.writeFileSync(file, content);
      console.log(`✓ Updated CSS font formats in: ${PathUtils.getRelativePath(this.buildDir, file)}`);
    }
  }

  updateFontFormats(content) {
    let updated = false;

    const formatPatterns = [/format\s*\(\s*["'](?:truetype|opentype|ttf|otf)["']\s*\)/gi];
    
    formatPatterns.forEach(pattern => {
      const beforeReplace = content;
      content = content.replace(pattern, 'format("woff2")');
      if (content !== beforeReplace) updated = true;
    });

    const fontFaceRegex = /@font-face\s*\{[^}]*url\s*\([^)]*['"]\s*([^'"]*)\s*['"]\)[^}]*\}/gi;
    content = content.replace(fontFaceRegex, (match, urlPath) => {
      if (urlPath.includes(".woff2") && !match.includes("format(")) {
        updated = true;
        return match.replace(/(url\s*\([^)]+\))\s*;/i, '$1 format("woff2");');
      }
      return match;
    });

    return { content, updated };
  }
}

class FontOptimizer extends FileProcessor {
  constructor(buildDir) {
    super(buildDir);
    this.converter = new FontConverter();
    this.cssUpdater = new CSSFontUpdater(buildDir);
  }

  async optimize() {
    const fonts = this.findFiles(CONFIG.FONT_EXTS);
    if (fonts.length === 0) {
      console.log("No fonts to optimize");
      return [];
    }

    console.log(`Optimizing ${fonts.length} fonts...`);
    const processedFiles = [];

    for (const fontPath of fonts) {
      try {
        const result = await this.processFont(fontPath);
        if (result) processedFiles.push(result);
      } catch (error) {
        console.error(`✗ Failed to process ${PathUtils.getRelativePath(this.buildDir, fontPath)}:`, error.message);
      }
    }

    return processedFiles;
  }

  async processFont(fontPath) {
    const ext = path.extname(fontPath).toLowerCase();
    if (ext === ".woff2") return null;

    const woff2Path = await this.converter.convertToWoff2(fontPath);
    this.updateFileReferences(fontPath, woff2Path);
    this.cssUpdater.updateFontFormat(fontPath, woff2Path);
    fs.unlinkSync(fontPath);

    console.log(`✓ ${PathUtils.getRelativePath(this.buildDir, fontPath)} → ${PathUtils.getRelativePath(this.buildDir, woff2Path)}`);
    
    return woff2Path;
  }
}

class JSMinifier {
  static minify(code, filename) {
    try {
      const result = transformSync(code, {
        filename,
        minify: true,
        jsc: {
          minify: {
            compress: true,
            mangle: true,
            format: { comments: false },
          },
        },
      });
      return result.code;
    } catch (error) {
      throw new Error(`JS minification failed: ${error.message}`);
    }
  }
}

class CSSMinifier {
  static minify(code, filename) {
    try {
      const result = transform({
        filename,
        code: Buffer.from(code),
        minify: true,
      });
      return result.code.toString();
    } catch (error) {
      throw new Error(`CSS minification failed: ${error.message}`);
    }
  }
}

class CodeMinifier extends FileProcessor {
  async optimize() {
    const jsFiles = this.findFiles([".js"]);
    const cssFiles = this.findFiles([".css"]);

    console.log(`Minifying ${jsFiles.length} JS files and ${cssFiles.length} CSS files...`);
    const processedFiles = [];

    const jsResults = await this.processFiles(jsFiles, JSMinifier.minify, "JS");
    const cssResults = await this.processFiles(cssFiles, CSSMinifier.minify, "CSS");

    processedFiles.push(...jsResults, ...cssResults);
    return processedFiles;
  }

  async processFiles(files, minifyFn, type) {
    const processedFiles = [];

    for (const file of files) {
      try {
        const originalCode = fs.readFileSync(file, "utf8");
        const minifiedCode = minifyFn(originalCode, file);

        fs.writeFileSync(file, minifiedCode);
        console.log(
          `✓ Minified ${PathUtils.getRelativePath(this.buildDir, file)} (${originalCode.length} → ${minifiedCode.length} bytes)`
        );
        processedFiles.push(file);
      } catch (error) {
        console.error(`✗ Failed to minify ${PathUtils.getRelativePath(this.buildDir, file)}:`, error.message);
      }
    }

    return processedFiles;
  }
}

class BuildDirectoryManager {
  constructor(srcDir, buildDir) {
    this.srcDir = srcDir;
    this.buildDir = buildDir;
  }

  prepare() {
    console.log(`Preparing ${this.buildDir} directory...`);

    if (fs.existsSync(this.buildDir)) {
      fs.rmSync(this.buildDir, { recursive: true, force: true });
    }

    if (!fs.existsSync(this.srcDir)) {
      throw new Error(`Source directory "${this.srcDir}" does not exist`);
    }

    fs.cpSync(this.srcDir, this.buildDir, { recursive: true });
    console.log(`✓ Files copied from ${this.srcDir} to ${this.buildDir}`);
  }
}

class BuildOptimizer {
  constructor(srcDir = CONFIG.SRC_DIR, buildDir = CONFIG.BUILD_DIR) {
    this.srcDir = srcDir;
    this.buildDir = buildDir;
    this.directoryManager = new BuildDirectoryManager(srcDir, buildDir);
    this.processedFiles = [];
  }

  async optimize() {
    console.log("Starting build and optimization process...");
    this.directoryManager.prepare();

    const optimizers = [
      new ImageOptimizer(this.buildDir),
      new FontOptimizer(this.buildDir),
      new CodeMinifier(this.buildDir)
    ];

    for (const optimizer of optimizers) {
      const files = await optimizer.optimize();
      this.processedFiles.push(...files);
    }

    console.log(`\nBuild and optimization complete! Processed ${this.processedFiles.length} files.`);
    return this.processedFiles;
  }
}

async function main() {
  const optimizer = new BuildOptimizer();
  await optimizer.optimize();
}

module.exports = {
  BuildOptimizer,
  ImageOptimizer,
  FontOptimizer,
  CodeMinifier,
  FileProcessor,
};

if (require.main === module) {
  main().catch(console.error);
}