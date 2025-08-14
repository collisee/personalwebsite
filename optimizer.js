const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { transformSync } = require("@swc/core");
const { transform } = require("lightningcss");
const { Font, woff2 } = require("fonteditor-core");

const SRC_DIR = "src";
const BUILD_DIR = "dist";
const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];
const TEXT_EXTS = [".html", ".css", ".js"];
const FONT_EXTS = [".ttf", ".otf", ".woff2"];

class FileProcessor {
  constructor(buildDir) {
    this.buildDir = buildDir;
    this.woff2Ready = woff2.init().catch((err) => {
      console.error("woff2.init() failed:", err);
      throw err;
    });
  }

  findFiles(dir, extensions) {
    const files = [];
    const scan = (currentDir) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (
          extensions.includes(path.extname(entry.name).toLowerCase())
        ) {
          files.push(fullPath);
        }
      }
    };

    scan(dir);
    return files;
  }

  updateReferences(oldPath, newPath) {
    const textFiles = this.findFiles(this.buildDir, TEXT_EXTS);
    const oldRef = this.normalizePath(path.relative(this.buildDir, oldPath));
    const newRef = this.normalizePath(path.relative(this.buildDir, newPath));

    textFiles.forEach((file) => {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(oldRef)) {
        const updated = content.replaceAll(oldRef, newRef);
        fs.writeFileSync(file, updated);
        console.log(
          `Updated references in: ${path.relative(this.buildDir, file)}`
        );
      }
    });
  }

  normalizePath(filePath) {
    return filePath.replace(/\\/g, "/");
  }
}

class ImageOptimizer extends FileProcessor {
  generateResponsiveSizes(originalWidth) {
    const sizes = new Set();

    for (
      let width = 128;
      width <= Math.min(1024, originalWidth);
      width += 128
    ) {
      sizes.add(width);
    }

    if (originalWidth > 1024) {
      const gap = originalWidth - 1024;
      const incrementBetweenIntervals = gap * 0.25;

      if (incrementBetweenIntervals > 128) {
        const intervals = [0.25, 0.5, 0.75, 1.0];

        intervals.forEach((ratio) => {
          const size = Math.round(1024 + gap * ratio);
          if (size !== originalWidth) {
            sizes.add(size);
          }
        });
      } else {
        const midSize = Math.round(1024 + gap * 0.5);
        if (midSize !== originalWidth && midSize !== 1024) {
          sizes.add(midSize);
        }
      }
    }

    sizes.add(originalWidth);

    return Array.from(sizes).sort((a, b) => a - b);
  }

  async generateResponsiveImages(imagePath) {
    const sharpImage = sharp(imagePath);
    const { width } = await sharpImage.metadata();

    if (!width) throw new Error(`Could not get width for image: ${imagePath}`);

    const sizes = this.generateResponsiveSizes(width);
    const generatedImages = [];
    const baseName = path.basename(imagePath, path.extname(imagePath));
    const dirName = path.dirname(imagePath);

    console.log(
      `  Generating ${sizes.length} responsive sizes: ${sizes.join(", ")}px`
    );

    for (const targetWidth of sizes) {
      const resizedPath = path.join(dirName, `${baseName}-${targetWidth}w.png`);

      await sharpImage.clone().resize(targetWidth).png().toFile(resizedPath);

      const webpPath = resizedPath.replace(/\.png$/, ".webp");
      await sharp(resizedPath).webp({ quality: 80 }).toFile(webpPath);
      fs.unlinkSync(resizedPath);

      generatedImages.push({ path: webpPath, width: targetWidth });
    }

    // Find the original size version to use as the main image
    const originalWebpPath = generatedImages.find(
      (img) => img.width === width
    )?.path;

    return { originalWebpPath, generatedImages };
  }

  async updateHtmlSrcset(originalImagePath, generatedImages) {
    const htmlFiles = this.findFiles(this.buildDir, [".html"]);
    const baseRef = this.normalizePath(
      path.relative(this.buildDir, originalImagePath).replace(/\.[^.]+$/, "")
    );

    htmlFiles.forEach((file) => {
      let content = fs.readFileSync(file, "utf8");
      const srcsetValues = generatedImages
        .map(
          (img) =>
            `${this.normalizePath(
              path.relative(path.dirname(file), img.path)
            )} ${img.width}w`
        )
        .join(", ");

      let updated = false;
      const originalExts = [".jpg", ".jpeg", ".png", ".webp"];

      originalExts.forEach((ext) => {
        const regex = new RegExp(
          `<img\\b([^>]*?)src=["']${baseRef}\\${ext}["']([^>]*?)>`,
          "gi"
        );

        content = content.replace(regex, (match, before, after) => {
          updated = true;
          const srcValue = this.normalizePath(
            path.relative(path.dirname(file), originalImagePath)
          );

          if (/\ssrcset\s*=/.test(match)) {
            return match.replace(
              /\ssrcset\s*=\s*["'][^"']*["']/i,
              ` srcset="${srcsetValues}"`
            );
          } else {
            return `<img${before}src="${srcValue}" srcset="${srcsetValues}"${after}>`;
          }
        });
      });

      if (updated) {
        fs.writeFileSync(file, content);
        console.log(
          `✓ Updated/added srcset in: ${path.relative(this.buildDir, file)}`
        );
      }
    });
  }

  async optimize() {
    const images = this.findFiles(this.buildDir, IMAGE_EXTS);
    if (images.length === 0) {
      console.log("No images to optimize");
      return [];
    }

    console.log(`Optimizing ${images.length} images...`);
    const processedFiles = [];

    for (const imagePath of images) {
      try {
        console.log(`Processing ${path.relative(this.buildDir, imagePath)}...`);
        const { originalWebpPath, generatedImages } =
          await this.generateResponsiveImages(imagePath);
        fs.unlinkSync(imagePath);

        await this.updateHtmlSrcset(originalWebpPath, generatedImages);
        processedFiles.push(...generatedImages.map((img) => img.path));

        console.log(
          `✓ Processed ${path.relative(this.buildDir, imagePath)} (${
            generatedImages.length
          } variants)`
        );
      } catch (error) {
        console.error(
          `✗ Failed to process ${path.relative(this.buildDir, imagePath)}:`,
          error.message
        );
      }
    }

    return processedFiles;
  }
}

class FontOptimizer extends FileProcessor {
  async convertToWoff2(fontPath) {
    const ext = path.extname(fontPath).toLowerCase();
    if (ext === ".woff2") return fontPath;

    const outPath = fontPath.replace(/\.[^.]+$/, ".woff2");
    await this.woff2Ready;

    const buffer = fs.readFileSync(fontPath);
    const typeHint = ext === ".otf" ? "otf" : "ttf";

    try {
      const font = Font.create(buffer, {
        type: typeHint,
        hinting: true,
        compound2simple: true,
      });

      const uint8 = font.write({ type: "woff2", hinting: true });
      const outBuffer = Buffer.from(uint8);
      fs.writeFileSync(outPath, outBuffer);
      return outPath;
    } catch (err) {
      throw new Error(
        `Failed to process font ${path.basename(fontPath)}: ${err.message}`
      );
    }
  }

  updateCSSFontFormat(oldPath, newPath) {
    const cssFiles = this.findFiles(this.buildDir, [".css"]);
    const oldRef = this.normalizePath(path.relative(this.buildDir, oldPath));
    const newRef = this.normalizePath(path.relative(this.buildDir, newPath));

    cssFiles.forEach((file) => {
      let content = fs.readFileSync(file, "utf8");
      let updated = false;

      if (content.includes(oldRef)) {
        content = content.replaceAll(oldRef, newRef);
        updated = true;
      }

      if (content.includes(newRef)) {
        const formatPatterns = [
          /format\s*\(\s*["'](?:truetype|opentype|ttf|otf)["']\s*\)/gi,
        ];

        formatPatterns.forEach((pattern) => {
          const beforeReplace = content;
          content = content.replace(pattern, 'format("woff2")');
          if (content !== beforeReplace) updated = true;
        });

        const fontFaceRegex =
          /@font-face\s*\{[^}]*url\s*\([^)]*['"]\s*([^'"]*)\s*['"]\)[^}]*\}/gi;
        content = content.replace(fontFaceRegex, (match, urlPath) => {
          if (urlPath.includes(newRef) && !match.includes("format(")) {
            updated = true;
            return match.replace(
              /(url\s*\([^)]+\))\s*;/i,
              '$1 format("woff2");'
            );
          }
          return match;
        });
      }

      if (updated) {
        fs.writeFileSync(file, content);
        console.log(
          `✓ Updated CSS font formats in: ${path.relative(this.buildDir, file)}`
        );
      }
    });
  }

  async optimize() {
    const fonts = this.findFiles(this.buildDir, FONT_EXTS);
    if (fonts.length === 0) {
      console.log("No fonts to optimize");
      return [];
    }

    console.log(`Optimizing ${fonts.length} fonts...`);
    const processedFiles = [];

    for (const fontPath of fonts) {
      try {
        const ext = path.extname(fontPath).toLowerCase();
        if (ext === ".woff2") continue;

        const woff2Path = await this.convertToWoff2(fontPath);
        this.updateReferences(fontPath, woff2Path);
        this.updateCSSFontFormat(fontPath, woff2Path);
        fs.unlinkSync(fontPath);

        console.log(
          `✓ ${path.relative(this.buildDir, fontPath)} → ${path.relative(
            this.buildDir,
            woff2Path
          )}`
        );
        processedFiles.push(woff2Path);
      } catch (error) {
        console.error(
          `✗ Failed to process ${path.relative(this.buildDir, fontPath)}:`,
          error.message
        );
      }
    }

    return processedFiles;
  }
}

class CodeMinifier extends FileProcessor {
  minifyJS(code, filename) {
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

  minifyCSS(code, filename) {
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

  async optimize() {
    const jsFiles = this.findFiles(this.buildDir, [".js"]);
    const cssFiles = this.findFiles(this.buildDir, [".css"]);

    console.log(
      `Minifying ${jsFiles.length} JS files and ${cssFiles.length} CSS files...`
    );
    const processedFiles = [];

    const processFiles = async (files, minifyFn, type) => {
      for (const file of files) {
        try {
          const originalCode = fs.readFileSync(file, "utf8");
          const minifiedCode = minifyFn(originalCode, file);

          fs.writeFileSync(file, minifiedCode);
          console.log(
            `✓ Minified ${path.relative(this.buildDir, file)} (${
              originalCode.length
            } → ${minifiedCode.length} bytes)`
          );
          processedFiles.push(file);
        } catch (error) {
          console.error(
            `✗ Failed to minify ${path.relative(this.buildDir, file)}:`,
            error.message
          );
        }
      }
    };

    await processFiles(jsFiles, this.minifyJS.bind(this), "JS");
    await processFiles(cssFiles, this.minifyCSS.bind(this), "CSS");

    return processedFiles;
  }
}

class BuildOptimizer {
  constructor(srcDir = SRC_DIR, buildDir = BUILD_DIR) {
    this.srcDir = srcDir;
    this.buildDir = buildDir;
    this.processedFiles = [];
  }

  prepareBuild() {
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

  async optimize() {
    console.log("Starting build and optimization process...");
    this.prepareBuild();

    const imageOptimizer = new ImageOptimizer(this.buildDir);
    const fontOptimizer = new FontOptimizer(this.buildDir);
    const codeMinifier = new CodeMinifier(this.buildDir);

    const imageFiles = await imageOptimizer.optimize();
    const fontFiles = await fontOptimizer.optimize();
    const codeFiles = await codeMinifier.optimize();

    this.processedFiles = [...imageFiles, ...fontFiles, ...codeFiles];

    console.log(
      `\nBuild and optimization complete! Processed ${this.processedFiles.length} files.`
    );
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
