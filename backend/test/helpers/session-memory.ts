/** Unit-only Redis replacement. Real Redis/Lua behavior is tested separately. */
export function sessionMemory() {
  const values = new Map<string, string>()
  const redis = {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { values.set(key, value); return 'OK' as const }),
    del: jest.fn(async (key: string) => Number(values.delete(key))),
    eval: jest.fn(async (script: string, count: number, ...args: any[]): Promise<number> => {
      const keys = args.slice(0, count), argv = args.slice(count)
      if (script.includes('-- auth-status-rate-v1')) {
        const next = Number(values.get(keys[0]) || 0) + 1
        values.set(keys[0], String(next)); return next
      }
      if (script.includes('-- auth-session-rotate-v1')) {
        if (values.get(keys[0]) !== argv[0]) return 0
        values.set(keys[0], argv[1]); return 1
      }
      if (script.includes('-- auth-session-upgrade-v1')) {
        if (values.get(keys[0]) !== argv[0] || values.has(keys[1])) return 0
        values.delete(keys[0]); values.set(keys[1], '1'); values.set(keys[2], argv[1]); return 1
      }
      if (script.includes('-- auth-session-revoke-legacy-v1')) {
        values.delete(keys[0]); values.set(keys[1], '1'); return 1
      }
      if (script.includes('-- auth-session-revoke-v1')) { values.delete(keys[0]); return 1 }
      throw new Error('Unknown unit Redis script')
    })
  }
  return { values, redis }
}
