export async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Lowercase, collapse whitespace, trim, strip trailing `.,;:!` (and any whitespace they expose). */
export function normalizeClaim(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!\s]+$/, '')
}

export async function versionId(draftId: string, body: string, kbVersion: number): Promise<string> {
  return (await sha256hex(`${draftId}\n${body}\n${kbVersion}`)).slice(0, 32)
}

export async function claimHash(text: string): Promise<string> {
  return (await sha256hex(normalizeClaim(text))).slice(0, 24)
}
