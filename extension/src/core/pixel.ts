// 128-bit random token, URL-safe base64 without padding (22 chars).
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pixelUrl(host: string, token: string): string {
  return `https://${host}/p/${token}.gif`;
}

// Returns the token if `src` points at our pixel, directly or through Gmail's
// image proxy (which keeps the original url after "#"). Otherwise null.
export function trackerTokenFromSrc(src: string, host: string): string | null {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = src.match(new RegExp(`https?://${escaped}/p/([A-Za-z0-9_-]{16,64})\\.gif`));
  return match ? match[1] : null;
}
