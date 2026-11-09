// scripts/generate-benchmark-image-assets.mjs
// Generate static asset imports for benchmark images
// Also copies images to assets/ directory with prefix for Metro compatibility
// Run: node scripts/generate-benchmark-image-assets.mjs

import fs from 'fs'
import path from 'path'

const manifestPath = path.join(process.cwd(), 'assets/benchmark-images/manifest.json')
const outputPath = path.join(process.cwd(), 'src/vision/benchmarkImageAssets.ts')
const assetsDir = path.join(process.cwd(), 'assets')

// Read manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

// Generate asset imports and export
const imports = []
const exports = []

for (const video of manifest.videos) {
  // Extract video name from output_dir which has the correct path format
  const videoName = video.output_dir.split(/[/\\]/).pop() || 'unknown'

  for (const frame of video.frames) {
    const varName = `BENCHMARK_IMAGE_${videoName.replace(/[^a-zA-Z0-9]/g, '_')}_${frame.filename.replace(/[^a-zA-Z0-9]/g, '_')}`
    // Use flat structure in assets/ directory with prefix
    const assetPath = `../../assets/benchmark_${videoName.replace(/[^a-zA-Z0-9]/g, '_')}_${frame.filename}`

    imports.push(`import ${varName} from '${assetPath}'`)
    exports.push(`  '${videoName}/${frame.filename}': ${varName},`)

    // Copy image to assets/ directory with prefix
    const sourcePath = path.join(process.cwd(), 'assets/benchmark-images', videoName, frame.filename)
    const destPath = path.join(assetsDir, `benchmark_${videoName.replace(/[^a-zA-Z0-9]/g, '_')}_${frame.filename}`)

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath)
      console.log(`Copied: ${frame.filename}`)
    } else {
      console.error(`Source not found: ${sourcePath}`)
    }
  }
}

// Generate TypeScript file
const content = `// src/vision/benchmarkImageAssets.ts
// GENERATED FILE - do not edit manually
// Run: node scripts/generate-benchmark-image-assets.mjs

${imports.join('\n')}

export const BENCHMARK_IMAGE_ASSETS = {
${exports.join('\n')}
}
`

// Write output
fs.writeFileSync(outputPath, content, 'utf8')
console.log(`Generated ${outputPath}`)
console.log(`Total images: ${imports.length}`)
