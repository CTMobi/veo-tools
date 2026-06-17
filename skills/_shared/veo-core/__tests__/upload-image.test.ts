import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn(async () => undefined)
const bucketMock = vi.fn(() => ({ upload: uploadMock }))
const StorageMock = vi.fn(function () {
  return { bucket: bucketMock }
})

vi.mock('@google-cloud/storage', () => ({ Storage: StorageMock }))

beforeEach(() => {
  StorageMock.mockClear()
  bucketMock.mockClear()
  uploadMock.mockClear()
})

describe('uploadImageToGcs', () => {
  it('parses bucket/object, calls upload with destination=object, returns the gcsUri', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    const result = await uploadImageToGcs('/local/x.jpg', 'gs://my-bucket/path/o.jpg')
    expect(result).toBe('gs://my-bucket/path/o.jpg')
    expect(bucketMock).toHaveBeenCalledWith('my-bucket')
    expect(uploadMock).toHaveBeenCalledWith('/local/x.jpg', { destination: 'path/o.jpg' })
  })

  it('throws on a malformed gs:// URI (no object) before any Storage call', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    await expect(uploadImageToGcs('/local/x.jpg', 'gs://bucket-only')).rejects.toThrow(/gs:\/\/|empty object/i)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('throws on a non-gs:// scheme before any Storage call', async () => {
    const { uploadImageToGcs } = await import('@veo-core/image-helpers')
    await expect(uploadImageToGcs('/local/x.jpg', 's3://bucket/o.jpg')).rejects.toThrow(/gs:\/\//i)
    expect(uploadMock).not.toHaveBeenCalled()
  })
})
