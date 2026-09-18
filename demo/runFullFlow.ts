import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'
import { hashAsset } from '../src/core/hashing/AssetHashingService.js'
import { buildAttestationPayload } from '../src/core/attestation/AttestationBuilder.js'
import { CopySightClient } from './CopySightClient.js'
import { normalizeAnalysis } from './normalizeAnalysis.js'

const ANALYSIS_VERSION = 'copysight-v1-demo'
const SAMPLES_DIR = join(process.cwd(), 'test samples')

/**
 * Runs the pipeline as far as it can go without live credentials:
 *
 *   sample file -> CopySight API call -> normalize into copyScore +
 *   analysis -> hash asset + hash analysis -> build the on-chain
 *   attestation payload.
 *
 * Stops there — actual submission to Soneium needs a funded Minato
 * wallet (COPYSIGHT_ATTESTER_PRIVATE_KEY) and registered schema
 * (COPYSIGHT_SCHEMA_UID), neither of which exists yet.
 */
async function main() {
  const apiKey = process.env.COPYSIGHT_API_KEY
  if (!apiKey) {
    throw new Error('COPYSIGHT_API_KEY is not set. Copy .env.example to .env and fill it in.')
  }
  const baseUrl = process.env.COPYSIGHT_API_BASE_URL || 'https://api.copysight.ai/v1'
  const client = new CopySightClient(apiKey, baseUrl)

  const files = readdirSync(SAMPLES_DIR).filter((f) => /\.(mp4|mov|webm|mkv|jpe?g|png|webp|gif)$/i.test(f))
  if (files.length === 0) {
    console.log(`No sample media found in "${SAMPLES_DIR}".`)
    return
  }

  const succeeded: string[] = []
  const failed: { filename: string; error: string }[] = []

  for (const filename of files) {
    console.log(`\n=== ${filename} ===`)
    const fileBytes = readFileSync(join(SAMPLES_DIR, filename))

    const assetHash = hashAsset(fileBytes)
    console.log(`assetHash: ${assetHash}`)

    let response
    try {
      response = await client.verify(fileBytes, filename)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`CopySight API call failed for ${filename}:`, message)
      failed.push({ filename, error: message })
      continue
    }

    const { copyScore, analysis } = normalizeAnalysis(response)
    console.log(`copyScore (derived from max similarity): ${copyScore}/100`)
    console.log(`detected_ips: ${JSON.stringify(response.detected_ips)}`)

    const payload = buildAttestationPayload({
      assetBytes: fileBytes,
      analysis,
      copyScore,
      analysisVersion: ANALYSIS_VERSION,
    })
    console.log('attestation payload built (ready to submit, once unblocked):', {
      assetHash: payload.assetHash,
      analysisHash: payload.analysisHash,
      copyScore: payload.copyScore,
      analysisVersionHash: payload.analysisVersionHash,
    })

    console.log(
      'STOPS HERE — on-chain submission needs a funded Minato wallet + registered schemaUID (neither exists yet).'
    )
    succeeded.push(filename)
  }

  console.log(`\n=== Summary: ${succeeded.length}/${files.length} succeeded ===`)
  if (failed.length > 0) {
    console.log('Failed:')
    for (const f of failed) console.log(`  - ${f.filename}: ${f.error}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
