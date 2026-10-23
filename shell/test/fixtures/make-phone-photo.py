"""Builds phone-exif6.jpg and print-cmyk.jpg for shell/test/designer.e2e.mjs: a 300 x 200 picture (red top-left
quarter, blue bottom-right) stored the way a phone stores a photo taken upright, as the pixels
turned a quarter left plus EXIF Orientation 6 saying to turn them back. Placed without the turn,
it prints sideways. print-cmyk.jpg is the same picture saved as a CMYK JPEG, as a print-ready
export from Photoshop is.

    python3 shell/test/fixtures/make-phone-photo.py      (from the repo root; needs Pillow)
"""
from PIL import Image

shown = Image.new('RGB', (300, 200), (240, 240, 240))
shown.paste((220, 20, 20), (0, 0, 150, 100))
shown.paste((20, 40, 220), (150, 100, 300, 200))
exif = Image.Exif()
exif[274] = 6
shown.rotate(90, expand=True).save('shell/test/fixtures/phone-exif6.jpg', quality=92, exif=exif.tobytes())
shown.convert('CMYK').save('shell/test/fixtures/print-cmyk.jpg', quality=90)

# phone-48mp-like.jpg: an 8000 x 6000 photo (48 MP, as recent phones take), a plain gradient so the
# file stays small. Far more than a postcard can use: the designer scales it down when placing it.
from PIL import Image
Image.linear_gradient('L').resize((8000, 6000)).convert('RGB').save('shell/test/fixtures/phone-48mp-like.jpg', quality=40)
