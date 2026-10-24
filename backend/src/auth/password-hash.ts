import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const PARAMETERS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const PREFIX = 'scrypt$32768$8$3$'

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, PARAMETERS, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `${PREFIX}${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`
}

// A fixed-format dummy performs the same expensive work for nonexistent/unconfigured accounts.
const DUMMY = `${PREFIX}${'00'.repeat(16)}$${'00'.repeat(64)}`
export async function verifyPassword(password: string, encoded?: string | null): Promise<boolean> {
  const validFormat = /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded || '')
  const parts = (validFormat ? encoded! : DUMMY).split('$')
  const actual = await derive(password, Buffer.from(parts[4], 'hex'))
  const matches = timingSafeEqual(actual, Buffer.from(parts[5], 'hex'))
  return validFormat && matches
}
