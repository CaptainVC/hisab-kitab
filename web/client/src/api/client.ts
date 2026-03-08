export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error || 'request_failed');
  return j as T;
}

export async function apiPost<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'include'
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error || 'request_failed');
  return j as T;
}
