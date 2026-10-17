// Satu pintu ke backend. Token disimpan di localStorage (dibungkus try/catch: mode privat bisa menolak).
const KEY = 'telur_erp_token';
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* abaikan */ } },
};
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const getToken = store.get;
export const setToken = store.set;

export async function api(method, path, body) {
  const token = store.get();
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    // Tanpa body JSON = bukan dari API kita (mis. proxy Vite saat server API mati).
    const err = new Error(data?.error || (res.status >= 500
      ? 'Server API tidak merespons. Tutup jendela server lalu jalankan ulang "Jalankan Telur ERP.bat", dan pastikan MySQL80 menyala.'
      : `Gagal (${res.status})`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const put = (p, b) => api('PUT', p, b ?? {});
export const del = (p) => api('DELETE', p);
export const qs = (o) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};
