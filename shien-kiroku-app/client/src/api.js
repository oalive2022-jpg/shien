const TOKEN_KEY = "shien-kiroku:token";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, url, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("shien-kiroku:unauthorized"));
  }

  if (res.status === 204) return null;

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = isJson && payload && payload.error ? payload.error : "通信に失敗しました";
    throw new Error(message);
  }
  return payload;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body),
  put: (url, body) => request("PUT", url, body),
  del: (url) => request("DELETE", url),
};

export function exportCsvUrl(params) {
  const q = new URLSearchParams(params).toString();
  return `/api/export?${q}`;
}

export async function downloadExport(params) {
  const token = getToken();
  const res = await fetch(exportCsvUrl(params), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("出力に失敗しました");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export_${params.type || "records"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
