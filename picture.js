// His profile picture: the pure parts, tested in tests/picture.test.mjs.
// A file of its own on purpose: the service worker races each file separately, so a new export
// added to logic.js could meet an old cached logic.js once. A new file has no old copy.

// The picture is kept on the phone as a small square JPEG (about 20 KB as text).
export const AVATAR_PX = 256;
export const AVATAR_MAX = 150000; // characters; far above a real 256 px JPEG, far below storage limits

// The biggest square in the middle of a w × h photo: the part a round picture shows.
export function cropRect(w, h) {
  if (!(w > 0) || !(h > 0)) return null;
  const side = Math.min(w, h);
  return { x: Math.floor((w - side) / 2), y: Math.floor((h - side) / 2), side };
}

// Only a JPEG picture the app made itself, under the size cap. Anything else counts as no picture,
// so nothing odd stored on the phone can end up inside the page.
const JPEG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export function cleanAvatar(s) {
  return typeof s === "string" && s.length <= AVATAR_MAX && JPEG_DATA.test(s) ? s : "";
}
