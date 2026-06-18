import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { validateImage, encodeImage } from '@veo-core/image-helpers'

let tmpDir: string
let jpgPath: string
let pngPath: string
let webpPath: string

// 1x1 PNG bytes (well-known minimal file)
const PNG_1x1 = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082',
  'hex'
)
// 1x1 JPEG bytes (minimal)
const JPG_1x1 = Buffer.from(
  'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFC0000B0801000100012200FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC400B5100002010303020403050504040000017D01020300041105122131410613516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A3435363738393A434445464748494A535455565758595A636465666768696A737475767778797A838485868788898A92939495969798999AA2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFDA0008010100003F00FBD0FFD9',
  'hex'
)
// Minimal WebP file header
const WEBP_1x1 = Buffer.from(
  '52494646260000005745425056503820180000003001009D012A0100010000C0061000B025A4006F008800000000000000',
  'hex'
)

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-img-test-'))
  jpgPath = path.join(tmpDir, 'a.jpg')
  pngPath = path.join(tmpDir, 'b.png')
  webpPath = path.join(tmpDir, 'c.webp')
  fs.writeFileSync(jpgPath, JPG_1x1)
  fs.writeFileSync(pngPath, PNG_1x1)
  fs.writeFileSync(webpPath, WEBP_1x1)
})
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

describe('validateImage (synchronous; no GCS API calls)', () => {
  it('accepts a local jpg', () => {
    expect(() => validateImage({ path: jpgPath })).not.toThrow()
  })
  it('accepts a local png', () => {
    expect(() => validateImage({ path: pngPath })).not.toThrow()
  })
  it('accepts a local webp', () => {
    expect(() => validateImage({ path: webpPath })).not.toThrow()
  })
  it('rejects a missing local file', () => {
    expect(() => validateImage({ path: '/nonexistent/file.jpg' })).toThrow(/not found|exist/i)
  })
  it('rejects malformed gs:// — empty bucket', () => {
    expect(() => validateImage({ gcsUri: 'gs:///object' })).toThrow(/gs:\/\//i)
  })
  it('rejects malformed gs:// — missing object', () => {
    expect(() => validateImage({ gcsUri: 'gs://bucket' })).toThrow(/gs:\/\//i)
  })
  it('rejects wrong scheme', () => {
    expect(() => validateImage({ gcsUri: 's3://bucket/object' })).toThrow(/gs:\/\//i)
  })
  it('accepts well-formed gs://', () => {
    expect(() => validateImage({ gcsUri: 'gs://bucket/path/object.jpg' })).not.toThrow()
  })
  it('rejects a directory path even with an explicit mimeType', () => {
    expect(() => validateImage({ path: tmpDir, mimeType: 'image/png' })).toThrow(/file|directory/i)
  })
})

describe('encodeImage', () => {
  it('path => bytesBase64Encoded variant with sniffed mimeType', () => {
    const out = encodeImage({ path: jpgPath })
    expect('bytesBase64Encoded' in out).toBe(true)
    if ('bytesBase64Encoded' in out) {
      expect(out.mimeType).toBe('image/jpeg')
      expect(Buffer.from(out.bytesBase64Encoded, 'base64').equals(JPG_1x1)).toBe(true)
    }
  })
  it('buffer => bytesBase64Encoded variant with explicit mimeType', () => {
    const out = encodeImage({ buffer: PNG_1x1, mimeType: 'image/png' })
    expect('bytesBase64Encoded' in out).toBe(true)
    if ('bytesBase64Encoded' in out) {
      expect(out.mimeType).toBe('image/png')
      expect(Buffer.from(out.bytesBase64Encoded, 'base64').equals(PNG_1x1)).toBe(true)
    }
  })
  it('gcsUri => gcsUri pass-through variant', () => {
    const out = encodeImage({ gcsUri: 'gs://bucket/obj.jpg' })
    expect('gcsUri' in out).toBe(true)
    if ('gcsUri' in out) expect(out.gcsUri).toBe('gs://bucket/obj.jpg')
  })
})
