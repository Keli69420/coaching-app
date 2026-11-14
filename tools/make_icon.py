# Placeholder icon until the app has its name and Keli's own logo: three rising steps.
# Standard library only. Run from the project root:  python3 -I tools/make_icon.py
# Writes icon-180.png, icon-512.png and icon.svg. Change BARS / colours here, not in the files.
import struct
import zlib

BG = (0x11, 0x12, 0x11)
VOLT = (0xD6, 0xF5, 0x4A)
SIZE = 512
R = 18  # corner radius of each step
BARS = [(118, 300, 76, 120), (218, 230, 76, 190), (318, 160, 76, 260)]  # x, y, w, h on a 512 canvas


def inside(px, py):
    for x, y, w, h in BARS:
        if x <= px <= x + w and y <= py <= y + h:
            cx = min(max(px, x + R), x + w - R)
            cy = min(max(py, y + R), y + h - R)
            if (px - cx) ** 2 + (py - cy) ** 2 <= R * R:
                return True
    return False


def render(size, ss=4):
    scale = SIZE / size
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            hits = 0
            for a in range(ss):
                for b in range(ss):
                    if inside((i + (a + 0.5) / ss) * scale, (j + (b + 0.5) / ss) * scale):
                        hits += 1
            t = hits / (ss * ss)
            row += bytes(round(BG[k] + (VOLT[k] - BG[k]) * t) for k in range(3))
        rows.append(bytes(row))
    return b"".join(rows)


def png(path, size):
    raw = render(size)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def svg(path):
    hexc = lambda c: "#%02X%02X%02X" % c
    rects = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{R}"/>' for x, y, w, h in BARS)
    with open(path, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}"><rect width="{SIZE}" height="{SIZE}" rx="96" fill="{hexc(BG)}"/><g fill="{hexc(VOLT)}">{rects}</g></svg>\n')


png("icon-180.png", 180)
png("icon-512.png", 512)
svg("icon.svg")
print("wrote icon-180.png, icon-512.png, icon.svg")
