import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import 'dotenv/config'
import { buildAttestationPayload } from '../src/core/attestation/AttestationBuilder.js'
import type { AttestationInput } from '../src/blockchain/BlockchainAdapter.js'
import { CopySightClient } from './CopySightClient.js'
import { normalizeAnalysis } from './normalizeAnalysis.js'
import { SoneiumEASAdapter } from '../src/blockchain/soneium/SoneiumEASAdapter.js'
import { EnvSignerService } from '../src/blockchain/signing/SignerService.js'
import { AttestationVerifier } from '../src/core/verification/AttestationVerifier.js'
import { getEnvironmentConfig, type NetworkEnvironment } from '../src/blockchain/soneium/config.js'

/**
 * Minimal local demo server — not part of the production module, same
 * spirit as the rest of demo/. No new dependencies (plain node:http, a
 * hand-rolled JSON body reader) for a single-page demo this small.
 *
 * Talks to whatever network the usual SONEIUM_ and COPYSIGHT_ env vars
 * point at (see config.ts) — Minato by default, or a manually-run local
 * anvil devnet during a live demo, by overriding those same env vars the
 * same way test/integration/localAnvilDevnet.test.ts does.
 */

const PORT = Number(process.env.DEMO_WEB_PORT || 3000)
const ANALYSIS_VERSION = 'copysight-v1-demo'
const ENVIRONMENT: NetworkEnvironment = 'minato'
const INDEX_HTML_PATH = join(process.cwd(), 'demo', 'web', 'index.html')

const signerService = new EnvSignerService()

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? JSON.parse(raw) : {}
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse) {
  const apiKey = process.env.COPYSIGHT_API_KEY
  if (!apiKey) {
    return sendJson(res, 400, { error: 'COPYSIGHT_API_KEY is not set — copy .env.example to .env and fill it in.' })
  }

  const body = await readJsonBody(req)
  const fileBase64 = body.fileBase64 as string | undefined
  const filename = body.filename as string | undefined
  if (!fileBase64 || !filename) {
    return sendJson(res, 400, { error: 'fileBase64 and filename are required.' })
  }

  const fileBytes = Buffer.from(fileBase64, 'base64')
  const baseUrl = process.env.COPYSIGHT_API_BASE_URL || 'https://api.copysight.ai/v1'
  const client = new CopySightClient(apiKey, baseUrl)

  const response = await client.verify(fileBytes, filename)
  const { copyScore, analysis } = normalizeAnalysis(response)
  const payload = buildAttestationPayload({
    assetBytes: fileBytes,
    analysis,
    copyScore,
    analysisVersion: ANALYSIS_VERSION,
  })

  sendJson(res, 200, { payload, detectedIPs: response.detected_ips })
}

const HEX_32_BYTES = /^0x[0-9a-fA-F]{64}$/

/** Basic shape check so a malformed/incomplete request fails with a clear 400 instead of an opaque error from deep inside the adapter — this demo has one trusted local operator, not untrusted multi-tenant callers, so this is a correctness guard, not a security boundary. */
export function isValidAttestationInput(value: unknown): value is AttestationInput {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.assetHash === 'string' &&
    HEX_32_BYTES.test(payload.assetHash) &&
    typeof payload.analysisHash === 'string' &&
    HEX_32_BYTES.test(payload.analysisHash) &&
    typeof payload.analysisVersionHash === 'string' &&
    HEX_32_BYTES.test(payload.analysisVersionHash) &&
    Number.isInteger(payload.copyScore) &&
    (payload.copyScore as number) >= 0 &&
    (payload.copyScore as number) <= 100
  )
}

async function handleAttest(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody(req)
  const payload = body.payload
  const useRoyalty = Boolean(body.useRoyalty)
  const payerAddress = body.payerAddress as string | undefined
  if (!isValidAttestationInput(payload)) {
    return sendJson(res, 400, { error: 'payload is missing or malformed — expected the object returned by /api/analyze.' })
  }

  const signer = await signerService.getSigner(ENVIRONMENT)
  const adapter = new SoneiumEASAdapter(signer, ENVIRONMENT)
  const envConfig = getEnvironmentConfig(ENVIRONMENT)

  // This demo has one signer acting as both the authorized submitter and
  // (unless a payerAddress is given) the payer — a real deployment has
  // the real end user's own wallet as payer, having separately
  // approve()'d RoyaltySettlement themselves; see createAttestationWithRoyalty's
  // own doc comment.
  const result = useRoyalty
    ? await adapter.createAttestationWithRoyalty(payload, (payerAddress as `0x${string}`) ?? (await signer.getAddress()))
    : await adapter.createAttestation(payload)

  const explorerBase = envConfig.chain.blockExplorers?.default.url
  sendJson(res, 200, {
    transactionHash: result.transactionHash,
    uid: result.uid,
    explorerTxUrl: explorerBase ? `${explorerBase}tx/${result.transactionHash}` : undefined,
    viaRoyaltySettlement: useRoyalty,
  })
}

async function handleVerify(uid: string, res: ServerResponse) {
  const envConfig = getEnvironmentConfig(ENVIRONMENT)
  const signer = await signerService.getSigner(ENVIRONMENT)
  const adapter = new SoneiumEASAdapter(signer, ENVIRONMENT)

  const record = await adapter.getAttestation(uid as `0x${string}`)
  if (!record) {
    return sendJson(res, 404, { error: `No attestation found for ${uid} on ${ENVIRONMENT}.` })
  }

  const validAttesters = [envConfig.attesterAddress, envConfig.royaltySettlementAddress].filter(
    (address): address is `0x${string}` => Boolean(address)
  )
  const verifier = new AttestationVerifier(adapter, envConfig.schemaUID as `0x${string}`, validAttesters)
  sendJson(res, 200, {
    record,
    checks: {
      schema: await verifier.verifySchema(uid as `0x${string}`),
      attester: await verifier.verifyAttester(uid as `0x${string}`),
      notRevoked: await verifier.verifyNotRevoked(uid as `0x${string}`),
    },
  })
}

// Guarded the same way every scripts/*.ts entry point is: importing this
// module (e.g. to unit-test isValidAttestationInput) must not have the
// side effect of actually starting a server.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)

      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/analyze') return await handleAnalyze(req, res)
      if (req.method === 'POST' && url.pathname === '/api/attest') return await handleAttest(req, res)
      if (req.method === 'GET' && url.pathname.startsWith('/api/verify/')) {
        return await handleVerify(url.pathname.slice('/api/verify/'.length), res)
      }

      sendJson(res, 404, { error: 'Not found.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 500, { error: message })
    }
  })

  server.listen(PORT, () => {
    console.log(`CopySight × Soneium demo running at http://localhost:${PORT} (network: ${ENVIRONMENT})`)
  })
}
