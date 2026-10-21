"""Builds the app icon and the connect screen's logo from the shop logo.

Run from android/:
  python tools/make_icons.py [--preview sheet.png] [--apple-icon PATH]

Reads ../web/public/ruzzco-logo.jpg (the shop's logo in the web app) and the
Bahnschrift font that comes with Windows. The icon is a badge: a white condensed "R" over the
logo's own crimson mustache, inside a thin ring, on the shop's black. The logo's lettering is
too fine to read at icon size, so the icon doesn't use it.
Writes app/src/main/res/mipmap-*/ic_launcher*.png and drawable-nodpi/ruzzco_logo.png.
--apple-icon and --pwa-icons also write the same badge for the web app (iPhone Home Screen
icon, and the installed app's icons):
  --apple-icon ../web/src/app/apple-icon.png --pwa-icons ../web/public/icons
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "app" / "src" / "main" / "res"
LOGO = ROOT.parent / "web" / "public" / "ruzzco-logo.jpg"
FONT = Path("C:/Windows/Fonts/bahnschrift.ttf")

WALL = (12, 11, 10)        # --color-wall
BONE = (245, 240, 232)     # --color-bone
CRIMSON = (196, 31, 41)    # --color-crimson

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
CANVAS = 432  # adaptive icon layer, 108 dp at 4x; the launcher mask keeps the middle 72 dp


def mustache_mask(logo: Image.Image) -> Image.Image:
    """The crimson mustache under "RUZZCO BARBERS", as a soft-edged alpha mask."""
    region = logo.crop((260, 395, 460, 475))
    r, g, b = region.split()
    redness = ImageChops.subtract(r, ImageChops.lighter(g, b))  # red minus the stronger of green and blue
    mask = redness.point(lambda v: max(0, min(255, (v - 25) * 4)))
    return mask.crop(mask.getbbox())


def emblem(logo: Image.Image, color_r=BONE, color_m=CRIMSON) -> Image.Image:
    """The badge on a transparent CANVAS x CANVAS layer, inside the launcher's safe circle."""
    big = CANVAS * 4  # draw large, shrink once, for smooth edges
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    c = big / 2

    ring_outer, ring_width = 122 * 4, 8 * 4
    draw.ellipse((c - ring_outer, c - ring_outer, c + ring_outer, c + ring_outer), outline=color_r + (255,), width=ring_width)

    font = ImageFont.truetype(str(FONT), 100)
    font.set_variation_by_name("Bold Condensed")
    left, top, right, bottom = font.getbbox("R")
    size = int(100 * (124 * 4) / (bottom - top))  # cap height 124 px on the 432 px layer
    font = ImageFont.truetype(str(FONT), size)
    font.set_variation_by_name("Bold Condensed")
    left, top, right, bottom = font.getbbox("R")
    r_top = c - 92 * 4
    draw.text((c - (left + right) / 2, r_top - top), "R", font=font, fill=color_r + (255,))

    mask = mustache_mask(logo)
    width = 132 * 4
    mask = mask.resize((width, round(mask.height * width / mask.width)), Image.LANCZOS)
    mask = mask.point(lambda v: max(0, min(255, (v - 60) * 2)))  # crisp edge after the upscale
    m_top = r_top + (bottom - top) + 18 * 4
    fill = Image.new("RGBA", mask.size, color_m + (255,))
    layer.paste(fill, (int(c - mask.width / 2), int(m_top)), mask)
    return layer.resize((CANVAS, CANVAS), Image.LANCZOS)


def legacy(foreground: Image.Image, px: int, round_shape: bool) -> Image.Image:
    """A full icon for Android 7.x launchers, which don't use adaptive icons."""
    big = px * 4
    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    shape = Image.new("L", (big, big), 0)
    inset = big * 0.04
    box = (inset, inset, big - inset, big - inset)
    if round_shape:
        ImageDraw.Draw(shape).ellipse(box, fill=255)
    else:
        ImageDraw.Draw(shape).rounded_rectangle(box, radius=big * 0.2, fill=255)
    icon.paste(Image.new("RGBA", (big, big), WALL + (255,)), (0, 0), shape)
    # Scale the badge so its ring fills about 80% of the icon.
    scale = 0.80 / (2 * 122 / CANVAS)
    fg = foreground.resize((round(big * scale), round(big * scale)), Image.LANCZOS)
    offset = (big - fg.width) // 2
    icon.alpha_composite(fg, (offset, offset))
    return icon.resize((px, px), Image.LANCZOS)


def square_icon(foreground: Image.Image, px: int, ring: float) -> Image.Image:
    """The badge on an opaque black square, its ring filling `ring` of the width."""
    icon = Image.new("RGBA", (CANVAS, CANVAS), WALL + (255,))
    size = round(CANVAS * ring / (2 * 122 / CANVAS))
    fg = foreground.resize((size, size), Image.LANCZOS)
    if size >= CANVAS:
        margin = (size - CANVAS) // 2
        icon.alpha_composite(fg.crop((margin, margin, margin + CANVAS, margin + CANVAS)))
    else:
        icon.alpha_composite(fg, ((CANVAS - size) // 2, (CANVAS - size) // 2))
    return icon.convert("RGB").resize((px, px), Image.LANCZOS)


def apple_icon(foreground: Image.Image, px: int = 180) -> Image.Image:
    """The iPhone Home Screen icon: an opaque square, since iOS rounds the corners itself and
    shows transparent pixels as black. 180 px is the iPhone's 60 pt icon at 3x."""
    return square_icon(foreground, px, 0.78)


def pwa_icons(foreground: Image.Image, folder: Path) -> None:
    """The installed web app's icons (web/public/icons, listed in web/src/app/manifest.ts).
    "any" icons are shown as they are; Android crops "maskable" ones to its own shape and
    keeps only the middle 80%, so the badge sits smaller there."""
    folder.mkdir(parents=True, exist_ok=True)
    square_icon(foreground, 192, 0.78).save(folder / "icon-192.png", optimize=True)
    square_icon(foreground, 512, 0.78).save(folder / "icon-512.png", optimize=True)
    square_icon(foreground, 512, 0.62).save(folder / "icon-maskable-512.png", optimize=True)


def logo_banner(logo: Image.Image) -> Image.Image:
    """The logo without its black margins, with the dark background made transparent."""
    rgb = logo.convert("RGB")
    brightest = ImageChops.lighter(ImageChops.lighter(*rgb.split()[:2]), rgb.split()[2])
    box = brightest.point(lambda v: 255 if v > 70 else 0).getbbox()
    pad = 18
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(rgb.width, box[2] + pad), min(rgb.height, box[3] + pad))
    banner = rgb.crop(box).convert("RGBA")
    alpha = brightest.crop(box).point(lambda v: max(0, min(255, (v - 28) * 5)))
    banner.putalpha(alpha)
    return banner


def main() -> None:
    parser = argparse.ArgumentParser(description="Builds the Ruzzco app icons from the shop logo.")
    parser.add_argument("--preview", help="also save a contact sheet of the results here")
    parser.add_argument("--apple-icon", help="also save the iPhone Home Screen icon (180 px PNG) here")
    parser.add_argument("--pwa-icons", help="also save the installed web app's icons into this folder")
    args = parser.parse_args()

    logo = Image.open(LOGO).convert("RGB")
    foreground = emblem(logo)
    monochrome = emblem(logo, (255, 255, 255), (255, 255, 255))

    for name, factor in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        layer_px = round(108 * factor)
        foreground.resize((layer_px, layer_px), Image.LANCZOS).save(folder / "ic_launcher_foreground.png", optimize=True)
        monochrome.resize((layer_px, layer_px), Image.LANCZOS).save(folder / "ic_launcher_monochrome.png", optimize=True)
        icon_px = round(48 * factor)
        legacy(foreground, icon_px, False).save(folder / "ic_launcher.png", optimize=True)
        legacy(foreground, icon_px, True).save(folder / "ic_launcher_round.png", optimize=True)

    nodpi = RES / "drawable-nodpi"
    nodpi.mkdir(parents=True, exist_ok=True)
    logo_banner(logo).save(nodpi / "ruzzco_logo.png", optimize=True)

    if args.apple_icon:
        apple_icon(foreground).save(args.apple_icon, optimize=True)
        print("iPhone icon written to", args.apple_icon)
    if args.pwa_icons:
        pwa_icons(foreground, Path(args.pwa_icons))
        print("web app icons written to", args.pwa_icons)

    if args.preview:  # a contact sheet to look at the results
        sheet = Image.new("RGBA", (1200, 760), (40, 40, 44, 255))
        full = Image.new("RGBA", (CANVAS, CANVAS), WALL + (255,))
        full.alpha_composite(foreground)
        sheet.alpha_composite(full, (20, 20))  # the whole layer; launchers show the middle 2/3
        circle = Image.new("L", (CANVAS, CANVAS), 0)
        ImageDraw.Draw(circle).ellipse((72, 72, 360, 360), fill=255)
        shown = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        shown.paste(full, (0, 0), circle)
        shown = shown.crop((72, 72, 360, 360))  # as a round launcher shows it
        x = 480
        for px in (288, 144, 96, 48):
            sheet.alpha_composite(shown.resize((px, px), Image.LANCZOS), (x, 20))
            x += px + 20
        sheet.alpha_composite(legacy(foreground, 144, False), (480, 340))
        sheet.alpha_composite(legacy(foreground, 144, True), (644, 340))
        mono = Image.new("RGBA", (CANVAS, CANVAS), (52, 72, 110, 255))  # a themed-icon tint
        mono.alpha_composite(monochrome)
        sheet.alpha_composite(mono.crop((72, 72, 360, 360)).resize((144, 144), Image.LANCZOS), (808, 340))
        banner = logo_banner(logo)
        banner = banner.resize((560, round(banner.height * 560 / banner.width)), Image.LANCZOS)
        ground = Image.new("RGBA", (600, banner.height + 40), WALL + (255,))
        ground.alpha_composite(banner, (20, 20))
        sheet.alpha_composite(ground, (20, 470))
        iphone = apple_icon(foreground).convert("RGBA")  # with roughly the corners iOS gives it
        corners = Image.new("L", iphone.size, 0)
        ImageDraw.Draw(corners).rounded_rectangle((0, 0, iphone.width - 1, iphone.height - 1), radius=40, fill=255)
        sheet.paste(iphone, (980, 340), corners)
        sheet.convert("RGB").save(args.preview)
    print("icons and logo written under", RES)


if __name__ == "__main__":
    main()
