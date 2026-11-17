import { test } from "node:test";
import assert from "node:assert/strict";
import { cropRect, cleanAvatar, AVATAR_MAX } from "../picture.js";

test("the middle square of a photo", () => {
  assert.deepEqual(cropRect(4032, 3024), { x: 504, y: 0, side: 3024 }); // landscape: sides cut
  assert.deepEqual(cropRect(3024, 4032), { x: 0, y: 504, side: 3024 }); // portrait: top and bottom cut
  assert.deepEqual(cropRect(500, 500), { x: 0, y: 0, side: 500 });
  assert.deepEqual(cropRect(101, 100), { x: 0, y: 0, side: 100 }); // odd leftover rounds down
  assert.equal(cropRect(0, 100), null);
  assert.equal(cropRect(100, NaN), null);
  assert.equal(cropRect(undefined, 100), null);
});

test("only a JPEG the app made counts as a picture", () => {
  const ok = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD+/==";
  assert.equal(cleanAvatar(ok), ok);
  assert.equal(cleanAvatar(null), "");
  assert.equal(cleanAvatar(""), "");
  assert.equal(cleanAvatar(42), "");
  assert.equal(cleanAvatar("data:image/png;base64,iVBORw0KGgo="), "");
  assert.equal(cleanAvatar("https://example.com/me.jpg"), "");
  assert.equal(cleanAvatar('data:image/jpeg;base64,AAAA" onerror="alert(1)'), "");
  assert.equal(cleanAvatar("data:image/jpeg;base64," + "A".repeat(AVATAR_MAX)), "");
});
