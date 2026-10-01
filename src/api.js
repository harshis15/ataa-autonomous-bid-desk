// Development uses the original Express API, including real Azure calls.
// Production builds are self-contained demo workspaces; no API probe is made.
export const browserDemo = !import.meta.env.DEV;
export async function api(url, method = 'GET', body) {
    if (browserDemo) return (await import('./demoApi.js')).demoApi(url, method, body);
    const form = body instanceof FormData;
    const r = await fetch('/api' + url, { method, headers: body && !form ? { 'Content-Type': 'application/json' } : {}, body: body ? (form ? body : JSON.stringify(body)) : undefined });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Request failed');
    return data;
}
export async function download(url, fallback = 'Ataa-download.json') {
    let blob, name = fallback;
    if (browserDemo) ({ blob, name } = await (await import('./demoApi.js')).demoDownload(url));
    else {
        const r = await fetch('/api' + url);
        if (!r.ok) { const x = await r.json(); throw Error(x.error || 'Download failed.'); }
        blob = await r.blob();
        const disposition = r.headers.get('Content-Disposition') || '';
        const utf = disposition.match(/filename\*=UTF-8''([^;]+)/);
        const plain = disposition.match(/filename="([^"]+)"/);
        name = utf ? decodeURIComponent(utf[1]) : plain ? plain[1] : fallback;
    }
    const href = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
}
