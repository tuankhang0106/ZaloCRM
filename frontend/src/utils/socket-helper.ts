/**
 * Returns the target WebSocket server URL.
 * When running in production on omni.chuoicungung.vn / portal.chuoicungung.vn,
 * connects directly to the Node Engine VPS at https://zalo.tahomart.vn.
 * When running locally on localhost/127.0.0.1, uses relative path (vite proxy).
 */
export function getSocketServerUrl(): string {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return '';
  }
  return 'https://zalo.tahomart.vn';
}
