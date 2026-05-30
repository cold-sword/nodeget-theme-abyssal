#!/usr/bin/env node
// Generates sibling .webp and .avif variants for every PNG under public/assets/.
// Idempotent: skips conversion when both variants already exist and are newer
// than the source PNG. Run before `npm run build:release` or any deploy that
// ships public/assets/.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = resolve(__dirname, '../public/assets')
const WEBP_OPTIONS = { quality: 75, alphaQuality: 90, effort: 6 }
const AVIF_OPTIONS = { quality: 60, effort: 6, chromaSubsampling: '4:4:4' }

function isFreshOutput(outputPath, sourceMtimeMs) {
  try {
    return statSync(outputPath).mtimeMs >= sourceMtimeMs
  } catch (_) {
    return false
  }
}

function pad(value, width) {
  return String(value).padStart(width)
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB'
}

async function convertOne(pngName) {
  const sourcePath = join(ASSETS_DIR, pngName)
  const base = pngName.replace(/\.png$/i, '')
  const webpPath = join(ASSETS_DIR, base + '.webp')
  const avifPath = join(ASSETS_DIR, base + '.avif')

  const sourceStat = statSync(sourcePath)
  const sourceBytes = sourceStat.size

  let webpAction = 'skip'
  let avifAction = 'skip'

  if (!isFreshOutput(webpPath, sourceStat.mtimeMs)) {
    await sharp(sourcePath).webp(WEBP_OPTIONS).toFile(webpPath)
    webpAction = 'write'
  }
  if (!isFreshOutput(avifPath, sourceStat.mtimeMs)) {
    await sharp(sourcePath).avif(AVIF_OPTIONS).toFile(avifPath)
    avifAction = 'write'
  }

  const webpBytes = pruneIfNotSmaller(webpPath, sourceBytes)
  const avifBytes = pruneIfNotSmaller(avifPath, sourceBytes)
  if (webpBytes === null) webpAction = 'drop'
  if (avifBytes === null) avifAction = 'drop'

  return {
    name: pngName,
    webpAction,
    avifAction,
    sourceBytes,
    webpBytes,
    avifBytes,
  }
}

function pruneIfNotSmaller(outputPath, sourceBytes) {
  try {
    const size = statSync(outputPath).size
    if (size >= sourceBytes) {
      rmSync(outputPath, { force: true })
      return null
    }
    return size
  } catch (_) {
    return null
  }
}

async function main() {
  const entries = readdirSync(ASSETS_DIR)
    .filter((name) => /\.png$/i.test(name))
    .sort()

  if (!entries.length) {
    console.error('[build-assets] no PNG sources found in public/assets/')
    process.exit(1)
  }

  console.log(`[build-assets] processing ${entries.length} PNG sources`)
  console.log('  ' + pad('source', 32) + pad('png', 12) + pad('webp', 14) + pad('avif', 14) + '  actions')

  let totalPng = 0, totalWebp = 0, totalAvif = 0
  for (const name of entries) {
    const result = await convertOne(name)
    totalPng += result.sourceBytes
    totalWebp += result.webpBytes || 0
    totalAvif += result.avifBytes || 0
    const formatCell = (bytes) => bytes === null
      ? pad('— (dropped)', 14)
      : pad(kb(bytes) + ' (' + ((bytes / result.sourceBytes) * 100).toFixed(0) + '%)', 14)
    console.log(
      '  '
      + pad(result.name, 32)
      + pad(kb(result.sourceBytes), 12)
      + formatCell(result.webpBytes)
      + formatCell(result.avifBytes)
      + '  ' + result.webpAction + '/' + result.avifAction
    )
  }
  console.log('  ' + pad('TOTAL', 32) + pad(kb(totalPng), 12) + pad(kb(totalWebp), 14) + pad(kb(totalAvif), 14))
}

main().catch((error) => {
  console.error('[build-assets] ' + (error && error.message ? error.message : error))
  process.exit(1)
})
