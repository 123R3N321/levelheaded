/**
 * Decide whether tapping a media element with createMediaElementSource is safe.
 *
 * The Web Audio spec makes a MediaElementSourceNode output silence when the
 * media is cross-origin without CORS approval — and the connection is
 * irreversible without a reload. So we only attach when we can prove the
 * media is same-origin from the URL alone:
 *
 *  - blob: URLs (Media Source Extensions — Netflix, YouTube, Disney+, Prime,
 *    and every other DRM/adaptive streamer) are same-origin by construction.
 *  - data: URLs carry their bytes inline.
 *  - Plain URLs are safe when their origin matches the page origin.
 *
 * Cross-origin URLs served *with* CORS headers would also be safe, but we
 *can't verify headers from here, so we conservatively decline (M3 adds
 * runtime silence detection as a second line of defense).
 */
export function isSafeToTap(mediaSrc: string, pageOrigin: string): boolean {
  if (!mediaSrc) return false
  if (mediaSrc.startsWith('blob:') || mediaSrc.startsWith('data:')) return true
  try {
    return new URL(mediaSrc, pageOrigin + '/').origin === pageOrigin
  } catch {
    return false
  }
}
