const offline = "Can't reach the Grain server. Start it with `grain` in a terminal, then try again."

/** JSON request to the local Grain server; errors carry the server's message. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init }).catch(() => {
    throw new Error(offline)
  })
  if (r.status === 502 || r.status === 504) throw new Error(offline)
  const body = r.status === 202 || r.status === 204 ? null : await r.json().catch(() => null)
  if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`)
  return body as T
}

export const post = <T>(url: string, body: unknown) => request<T>(url, { method: 'POST', body: JSON.stringify(body) })
export const put = <T>(url: string, body: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(body) })
