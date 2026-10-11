"""Generate fixtures/p0/photo.jpg: the placed image for the P0 postcard.

Original, generated in code (CC0). A dusk gradient with hills, and a solid red square in the
TOP-LEFT corner and a green one TOP-RIGHT, so an image that comes out flipped or rotated in the
PDF is caught by looking at which corner the red square lands in.

Run: python3 fixtures/p0/make-photo.py
"""
import math
import pathlib

from PIL import Image, ImageDraw

W, H = 1800, 1200  # 6" x 4" at 300 dpi
img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    t = y / H
    sky = (int(40 + 180 * t), int(60 + 90 * t), int(140 - 40 * t))
    for x in range(W):
        px[x, y] = sky
d = ImageDraw.Draw(img)
d.ellipse((W * 0.62, H * 0.18, W * 0.62 + 300, H * 0.18 + 300), fill=(250, 228, 170))
for i, (amp, base, col) in enumerate([(70, 0.62, (70, 50, 110)), (90, 0.72, (50, 35, 85)), (60, 0.84, (30, 22, 55))]):
    pts = [(x, H * base + amp * math.sin(x / (180 + 60 * i) + i)) for x in range(0, W + 1, 10)]
    d.polygon(pts + [(W, H), (0, H)], fill=col)
m = 120  # corner markers
d.rectangle((0, 0, m, m), fill=(230, 20, 20))
d.rectangle((W - m, 0, W, m), fill=(20, 200, 60))
out = pathlib.Path(__file__).with_name("photo.jpg")
img.save(out, quality=85, dpi=(300, 300))
print(out, out.stat().st_size, "bytes")
