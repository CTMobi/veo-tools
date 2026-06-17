// image-helpers.ts — synchronous validation + encoding of ImageInput to VertexImage.
// validateImage does NOT verify GCS object existence (no async API calls).
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Storage } from '@google-cloud/storage'
import type { ImageInput, VertexImage } from '@veo-core/types'

const EXT_TO_MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
}

function sniffMime(p: string): string {
  const ext = path.extname(p).toLowerCase()
  const mime = EXT_TO_MIME[ext]
  if (!mime) throw new Error(`Cannot sniff MIME type from extension: ${p}`)
  return mime
}

function parseGcsUri(uri: string): { bucket: string; object: string } {
  if (!uri.startsWith('gs://')) {
    throw new Error(`Image gcsUri must start with gs:// — got: ${uri}`)
  }
  const rest = uri.slice(5)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Malformed gs:// URI (no object path): ${uri}`)
  const bucket = rest.slice(0, slash)
  const object = rest.slice(slash + 1)
  if (!bucket) throw new Error(`Malformed gs:// URI (empty bucket): ${uri}`)
  if (!object) throw new Error(`Malformed gs:// URI (empty object): ${uri}`)
  return { bucket, object }
}

export function validateImage(img: ImageInput): void {
  if ('path' in img) {
    if (!fs.existsSync(img.path)) {
      throw new Error(`Image file not found: ${img.path}`)
    }
    if (!img.mimeType) sniffMime(img.path) // throws on unknown ext
    return
  }
  if ('buffer' in img) {
    if (!img.mimeType) throw new Error('Buffer image requires explicit mimeType')
    return
  }
  if ('gcsUri' in img) {
    parseGcsUri(img.gcsUri) // throws on malformed
    return
  }
  throw new Error('Unrecognized ImageInput variant')
}

export function encodeImage(img: ImageInput): VertexImage {
  validateImage(img)
  if ('path' in img) {
    const mimeType = img.mimeType ?? sniffMime(img.path)
    const bytes = fs.readFileSync(img.path)
    return { bytesBase64Encoded: bytes.toString('base64'), mimeType }
  }
  if ('buffer' in img) {
    return { bytesBase64Encoded: img.buffer.toString('base64'), mimeType: img.mimeType }
  }
  // gcsUri variant
  return { gcsUri: img.gcsUri, mimeType: img.mimeType }
}

export async function uploadImageToGcs(localPath: string, gcsUri: string): Promise<string> {
  const { bucket, object } = parseGcsUri(gcsUri)
  const storage = new Storage()
  await storage.bucket(bucket).upload(localPath, { destination: object })
  return gcsUri
}
