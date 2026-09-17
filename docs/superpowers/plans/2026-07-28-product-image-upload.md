# Product Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the product image URL text field with an authenticated single-image upload flow backed by MinIO.

**Architecture:** The Vue admin validates the selected file and immediately sends multipart data to a NestJS upload endpoint. The backend verifies file size, MIME type, and binary signature, stores a UUID-named object under the MinIO `products/` prefix, and returns a public URL that continues to be saved through the existing `mainImageUrl` field.

**Tech Stack:** Vue 3, Element Plus, Axios, Vitest, NestJS 11, Multer, Jest, MinIO Node.js SDK, TypeScript.

**Workspace note:** The workspace root has no `.git` directory, so commit steps are intentionally omitted.

---

## File Map

- Create `backend/src/upload/product-image.validation.ts`: shared backend constants, file signature detection, and validation.
- Create `backend/src/upload/product-image-storage.service.ts`: MinIO bucket preparation, policy merge, object upload, and public URL generation.
- Create `backend/src/upload/product-image-client.provider.ts`: injectable MinIO SDK client.
- Create `backend/src/upload/upload.controller.ts`: authenticated multipart endpoint.
- Create `backend/src/upload/upload.module.ts`: upload dependency wiring.
- Modify `backend/src/app.module.ts`: register `UploadModule`.
- Modify `backend/src/config/env.validation.ts`: validate and default `MINIO_PUBLIC_URL`.
- Modify `backend/.env` and `backend/.env.example`: document local public MinIO URL.
- Modify `backend/package.json` and `backend/package-lock.json`: add the official `minio` SDK.
- Create `backend/test/product-image-upload.spec.ts`: validation and storage service unit tests.
- Create `backend/test/upload.contract.spec.ts`: upload HTTP contract tests.
- Create `admin-web/src/utils/product-image.ts`: frontend format and size validation.
- Create `admin-web/src/utils/product-image.test.ts`: frontend validation unit tests.
- Modify `admin-web/src/api/product.ts`: multipart upload API wrapper.
- Modify `admin-web/src/views/product/ProductEditView.vue`: upload, preview, replacement, removal, and save-state UI.

### Task 1: Backend Image Validation

**Files:**
- Create: `backend/test/product-image-upload.spec.ts`
- Create: `backend/src/upload/product-image.validation.ts`

- [ ] **Step 1: Write failing validation tests**

Create tests that define the supported contract:

```ts
import { validateProductImage } from '../src/upload/product-image.validation'

const file = (mimetype: string, buffer: Buffer) => ({
  buffer,
  mimetype,
  size: buffer.length,
  originalname: 'product-image'
})

it.each([
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'jpg'],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'],
  ['image/webp', Buffer.from('RIFF0000WEBP'), 'webp']
])('accepts %s with a matching signature', (mimetype, buffer, extension) => {
  expect(validateProductImage(file(mimetype, buffer))).toEqual({ mimetype, extension })
})

it('rejects a declared image whose signature does not match', () => {
  expect(() => validateProductImage(file('image/png', Buffer.from('not-an-image'))))
    .toThrow('图片文件无效')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts`

Expected: FAIL because `product-image.validation.ts` does not exist.

- [ ] **Step 3: Implement minimal validation**

Implement:

```ts
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export interface ProductImageFile {
  buffer: Buffer
  mimetype: string
  size: number
  originalname?: string
}

export function validateProductImage(file?: ProductImageFile) {
  if (!file?.buffer?.length || file.size <= 0) throw new BadRequestException('请选择商品图片')
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw new BadRequestException('图片不能超过 5MB')
  if (!PRODUCT_IMAGE_MIME_TYPES.includes(file.mimetype as never)) {
    throw new BadRequestException('仅支持 JPG、PNG、WebP 图片')
  }

  const detected = detectProductImage(file.buffer)
  if (!detected || detected.mimetype !== file.mimetype) {
    throw new BadRequestException('图片文件无效')
  }
  return detected
}
```

The private detector must recognize JPEG `FF D8 FF`, the full PNG signature, and RIFF/WEBP markers.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts`

Expected: all validation cases pass.

### Task 2: MinIO Product Image Storage

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Create: `backend/src/upload/product-image-client.provider.ts`
- Create: `backend/src/upload/product-image-storage.service.ts`
- Modify: `backend/test/product-image-upload.spec.ts`
- Modify: `backend/src/config/env.validation.ts`
- Modify: `backend/.env`
- Modify: `backend/.env.example`

- [ ] **Step 1: Install the official MinIO SDK**

Run: `npm.cmd --prefix backend install minio`

Expected: `backend/package.json` and `backend/package-lock.json` contain `minio` and installation exits 0.

- [ ] **Step 2: Add failing storage service tests**

Use an injected fake client with `bucketExists`, `makeBucket`, `getBucketPolicy`, `setBucketPolicy`, and `putObject` Jest mocks. Verify:

```ts
const result = await service.uploadProductImage(
  Buffer.from([0xff, 0xd8, 0xff]),
  'image/jpeg',
  'jpg',
  new Date('2026-07-28T12:00:00Z')
)

expect(result.objectKey).toMatch(/^products\/2026\/07\/[0-9a-f-]+\.jpg$/)
expect(result.url).toBe(`http://127.0.0.1:9000/b2b-miniapp/${result.objectKey}`)
expect(client.putObject).toHaveBeenCalledWith(
  'b2b-miniapp',
  result.objectKey,
  expect.any(Buffer),
  3,
  expect.objectContaining({ 'Content-Type': 'image/jpeg' })
)
```

Also verify a missing bucket is created and the public policy preserves unrelated existing statements while adding one statement scoped to `arn:aws:s3:::b2b-miniapp/products/*`.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts`

Expected: FAIL because the storage provider and service do not exist.

- [ ] **Step 4: Implement the MinIO provider and storage service**

The client provider must construct `new Client({ endPoint, port, useSSL, accessKey, secretKey })` from `ConfigService`.

The storage service must:

```ts
async uploadProductImage(buffer: Buffer, mimetype: string, extension: string, now = new Date()) {
  await this.ensureBucketAndProductPolicy()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const objectKey = `products/${year}/${month}/${randomUUID()}.${extension}`

  await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
    'Content-Type': mimetype,
    'Cache-Control': 'public, max-age=31536000, immutable'
  })

  return { objectKey, url: `${this.publicUrl}/${this.bucket}/${objectKey}` }
}
```

Normalize `MINIO_PUBLIC_URL` by removing trailing slashes. Treat only `NoSuchBucketPolicy` as an empty policy; rethrow other MinIO errors. Merge the named product-image public-read statement instead of replacing unrelated policy statements.

- [ ] **Step 5: Add `MINIO_PUBLIC_URL` configuration**

Add an optional string property to `EnvSchema`, development default `http://127.0.0.1:9000`, and matching entries to `.env` and `.env.example`.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts`

Expected: validation and storage tests pass.

### Task 3: Authenticated Upload Endpoint

**Files:**
- Create: `backend/test/upload.contract.spec.ts`
- Create: `backend/src/upload/upload.controller.ts`
- Create: `backend/src/upload/upload.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing HTTP contract tests**

Build a Nest test app with `UploadController`, override `JwtAuthGuard`, and inject a mocked `ProductImageStorageService`. The main success case must send a multipart attachment:

```ts
const response = await request(app.getHttpServer())
  .post('/api/v1/uploads/product-image')
  .set('Authorization', 'Bearer mock-token')
  .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
    filename: 'product.jpg',
    contentType: 'image/jpeg'
  })
  .expect(201)

expect(response.body.data.url).toContain('/products/')
expect(storage.uploadProductImage).toHaveBeenCalledWith(
  expect.any(Buffer),
  'image/jpeg',
  'jpg'
)
```

Add rejection cases for an invalid signature and missing file.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm.cmd --prefix backend test -- upload.contract.spec.ts`

Expected: FAIL because the controller and module do not exist.

- [ ] **Step 3: Implement controller and module**

Controller shape:

```ts
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  constructor(private readonly storage: ProductImageStorageService) {}

  @Post('product-image')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES },
    fileFilter: (_request, file, callback) => callback(null, true)
  }))
  async uploadProductImage(@UploadedFile() file?: ProductImageFile) {
    const image = validateProductImage(file)
    return this.storage.uploadProductImage(file!.buffer, image.mimetype, image.extension)
  }
}
```

Register the controller, service, and client provider in `UploadModule`, then import `UploadModule` from `AppModule`.

- [ ] **Step 4: Run backend contract and unit tests**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts upload.contract.spec.ts`

Expected: both suites pass with zero failures.

### Task 4: Frontend Validation and Upload API

**Files:**
- Create: `admin-web/src/utils/product-image.test.ts`
- Create: `admin-web/src/utils/product-image.ts`
- Modify: `admin-web/src/api/product.ts`

- [ ] **Step 1: Write failing frontend validation tests**

Test the pure helper with plain objects:

```ts
expect(validateProductImageFile({ type: 'image/png', size: 1024 })).toBeNull()
expect(validateProductImageFile({ type: 'image/gif', size: 1024 })).toBe('仅支持 JPG、PNG、WebP 图片')
expect(validateProductImageFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe('图片不能超过 5MB')
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `npm.cmd --prefix admin-web run test:unit -- src/utils/product-image.test.ts`

Expected: FAIL because `product-image.ts` does not exist.

- [ ] **Step 3: Implement helper and API wrapper**

Implement constants and `validateProductImageFile(file: Pick<File, 'type' | 'size'>): string | null`.

Add API wrapper:

```ts
export function uploadProductImage(file: File) {
  const data = new FormData()
  data.append('file', file)
  return http.post('/uploads/product-image', data)
}
```

Do not set a multipart boundary manually; the browser and Axios must generate it.

- [ ] **Step 4: Run the frontend test and verify GREEN**

Run: `npm.cmd --prefix admin-web run test:unit -- src/utils/product-image.test.ts`

Expected: the validation suite passes.

### Task 5: Product Edit Upload UI

**Files:**
- Modify: `admin-web/src/views/product/ProductEditView.vue`

- [ ] **Step 1: Add upload state and handlers**

Import Element Plus upload types, `uploadProductImage`, and the validation helper. Add `uploadingImage`, `beforeImageUpload`, `handleImageUpload`, and `removeImage`.

Required behavior:

```ts
function beforeImageUpload(file: UploadRawFile) {
  const message = validateProductImageFile(file)
  if (message) {
    ElMessage.warning(message)
    return false
  }
  return true
}

async function handleImageUpload(options: UploadRequestOptions) {
  const previousUrl = form.imageUrl
  uploadingImage.value = true
  try {
    const response: any = await uploadProductImage(options.file)
    const data = dataOf(response)
    if (!data.url) throw new Error('上传响应缺少图片地址')
    form.imageUrl = data.url
    ElMessage.success('商品图片上传成功')
  } catch (error: any) {
    form.imageUrl = previousUrl
    ElMessage.warning(error.message || '商品图片上传失败')
    throw error
  } finally {
    uploadingImage.value = false
  }
}
```

`saveProduct` must refuse to continue while `uploadingImage` is true.

- [ ] **Step 2: Replace the URL field with upload UI**

Use `el-upload` with `accept=image/jpeg,image/png,image/webp`, `:show-file-list=false`, `:before-upload`, and `:http-request`. Show the existing/current image through `el-image`, then render “选择图片/更换图片” and “移除图片” actions plus the JPG/PNG/WebP and 5MB hint.

- [ ] **Step 3: Add scoped styles**

Add a fixed 160px preview, neutral dashed empty state, responsive action row, and `object-fit: cover`. Reuse existing Element Plus controls rather than adding another UI dependency.

- [ ] **Step 4: Typecheck and build the admin app**

Run: `npm.cmd --prefix admin-web run typecheck`

Expected: exit 0 with no Vue or TypeScript errors.

Run: `npm.cmd --prefix admin-web run build`

Expected: Vite build exits 0 and emits the product edit chunk.

### Task 6: Full Verification and Local Integration

**Files:**
- Verify all files listed above.

- [ ] **Step 1: Run backend focused tests**

Run: `npm.cmd --prefix backend test -- product-image-upload.spec.ts upload.contract.spec.ts`

Expected: 2 suites pass, 0 failed.

- [ ] **Step 2: Run backend typecheck and build**

Run: `npm.cmd --prefix backend run typecheck`

Expected: exit 0.

Run: `npm.cmd --prefix backend run build`

Expected: Nest build exits 0.

- [ ] **Step 3: Run frontend tests, typecheck, and build**

Run: `npm.cmd --prefix admin-web run test:unit`

Expected: all Vitest suites pass.

Run: `npm.cmd --prefix admin-web run typecheck`

Expected: exit 0.

Run: `npm.cmd --prefix admin-web run build`

Expected: Vite build exits 0.

- [ ] **Step 4: Verify the live upload path when local services are available**

From `C:\Users\26381\Desktop\miniprogram`, verify the location with `Get-Location`, then check `docker compose -f docker-compose.dev.yml ps`. If MySQL, Redis, and MinIO are healthy, start the backend, authenticate through the existing development flow, upload a real PNG/JPG/WebP, and verify:

- HTTP response is successful and contains `url` plus `objectKey`.
- The object exists under the configured MinIO Bucket.
- Opening the returned URL returns the uploaded image.
- Saving a product persists the returned URL in `mainImageUrl`.

If services or credentials are unavailable, report this live path as unverified rather than treating build/test success as deployment proof.

