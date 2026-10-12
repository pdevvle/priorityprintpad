"""Builds phone-exif6.jpg for shell/test/designer.e2e.mjs: a 300 x 200 picture (red top-left
quarter, blue bottom-right) stored the way a phone stores a photo taken upright, as the pixels
turned a quarter left plus EXIF Orientation 6 saying to turn them back. Placed without the turn,
it prints sideways.

    python3 shell/test/fixtures/make-phone-photo.py      (from the repo root; needs Pillow)
"""
from PIL import Image

shown = Image.new('RGB', (300, 200), (240, 240, 240))
shown.paste((220, 20, 20), (0, 0, 150, 100))
shown.paste((20, 40, 220), (150, 100, 300, 200))
exif = Image.Exif()
exif[274] = 6
shown.rotate(90, expand=True).save('shell/test/fixtures/phone-exif6.jpg', quality=92, exif=exif.tobytes())
