"""Builds the Ridgeline icon set from icon.svg (256 by 256, rounded square, transparent corners).

Regenerate:  python3 src-tauri/icons-ridgeline/make_icons.py
Needs Python with Pillow and a headless Chromium (set WALL_CHROME to its path) to draw the SVG.
Writes 32x32.png, 128x128.png, 128x128@2x.png and icon.ico (16, 24, 32, 48, 64, 256) next to this file.
"""
import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("WALL_CHROME", "chromium")
BIG = 1024  # draw once large, then scale down with a good filter


def render_svg(svg_path, work_dir, out_png):
    svg = open(svg_path, encoding="utf-8").read()
    page = (
        '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}'
        f'svg{{display:block;width:{BIG}px;height:{BIG}px}}</style>{svg}'
    )
    html = os.path.join(work_dir, "icon.html")
    open(html, "w", encoding="utf-8").write(page)
    subprocess.run(
        [
            CHROME, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
            "--default-background-color=00000000", f"--window-size={BIG},{BIG}",
            f"--screenshot={out_png}", "file://" + html,
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def main():
    # Everything temporary stays inside this folder, which is removed when the block ends.
    with tempfile.TemporaryDirectory() as tmp:
        big_png = os.path.join(tmp, "icon-big.png")
        render_svg(os.path.join(HERE, "icon.svg"), tmp, big_png)
        big = Image.open(big_png).convert("RGBA")
        big.load()
    assert big.size == (BIG, BIG), big.size

    def at(n):
        return big.resize((n, n), Image.LANCZOS)

    at(32).save(os.path.join(HERE, "32x32.png"))
    at(128).save(os.path.join(HERE, "128x128.png"))
    at(256).save(os.path.join(HERE, "128x128@2x.png"))
    sizes = [16, 24, 32, 48, 64, 256]
    at(256).save(os.path.join(HERE, "icon.ico"), format="ICO", sizes=[(s, s) for s in sizes])


if __name__ == "__main__":
    main()
