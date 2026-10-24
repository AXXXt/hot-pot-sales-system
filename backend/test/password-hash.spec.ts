import { hashPassword, verifyPassword } from '../src/auth/password-hash'

describe('staff password hashing', () => {
  it('uses independent salts, verifies full Unicode input, and rejects wrong or absent hashes', async () => {
    const password = '唯哆鲜的独立后台登录密码 2026'
    const first = await hashPassword(password)
    const second = await hashPassword(password)
    expect(first).not.toBe(second)
    expect(first).not.toContain(password)
    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/)
    await expect(verifyPassword(password, first)).resolves.toBe(true)
    await expect(verifyPassword(password + 'x', first)).resolves.toBe(false)
    await expect(verifyPassword(password, null)).resolves.toBe(false)
    await expect(verifyPassword(password, 'malformed')).resolves.toBe(false)
  }, 30_000)
})
