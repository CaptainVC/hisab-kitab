export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      // Session expired / not logged in
      try { localStorage.setItem('hk:sessionExpired', '1'); } catch {}
      window.location.href = '/';
    }
    const err = new Error(j?.error || 'request_failed');
    (err as any).data = j;
    (err as any).status = res.status;
    throw err;
  }
  return j as T;
}

export async function apiPost<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'include'
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      try { localStorage.setItem('hk:sessionExpired', '1'); } catch {}
      window.location.href = '/';
    }
    const err = new Error(j?.error || 'request_failed');
    (err as any).data = j;
    (err as any).status = res.status;
    throw err;
  }
  return j as T;
}

export async function apiPut<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'include'
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      try { localStorage.setItem('hk:sessionExpired', '1'); } catch {}
      window.location.href = '/';
    }
    const err = new Error(j?.error || 'request_failed');
    (err as any).data = j;
    (err as any).status = res.status;
    throw err;
  }
  return j as T;
}
