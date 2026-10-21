"""App Store screenshot frames: brand background + headline + tilted phone.

Run:  python3 -m venv .venv && .venv/bin/pip install pillow
      .venv/bin/python appstore/make.py
Edit SLIDES to swap screenshots or headlines; output lands in appstore/out/.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "node_modules/@expo-google-fonts/karla/800ExtraBold/Karla_800ExtraBold.ttf")
W, H = 1290, 2796
BG, AMBER, CREAM = (0x16, 0x10, 0x0D), (0xEF, 0x8A, 0x3C), (0xF7, 0xF0, 0xE8)

# (screenshot, headline lines, words drawn in amber, tilt: -1 left / 1 right)
SLIDES = [
    ("website/01-home.png", ["Never go to the", "movies alone again."], {"alone"}, 1),
    ("website/03-explore.png", ["Pick a showtime.", "Meet your crew."], {"crew."}, -1),
    ("website/04-space.png", ["See movies with", "people, not alone."], {"people,"}, 1),
    ("website/02-my-spaces.png", ["Plans that", "actually happen."], {"happen."}, -1),
    ("website/05-cinemind.png", ["A new movie", "puzzle every day."], {"puzzle"}, 1),
]


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    img.putalpha(mask)
    return img


def phone(shot_path, width):
    """Screenshot inside a dark bezel, as RGBA."""
    shot = Image.open(os.path.join(ROOT, shot_path)).convert("RGBA")
    bezel = round(width * 0.035)
    inner_w = width - 2 * bezel
    shot = shot.resize((inner_w, round(shot.height * inner_w / shot.width)), Image.LANCZOS)
    body = Image.new("RGBA", (width, shot.height + 2 * bezel), (10, 8, 7, 255))
    body = rounded(body, round(width * 0.13))
    body.alpha_composite(rounded(shot, round(inner_w * 0.11)), (bezel, bezel))
    # Thin warm rim so the frame separates from the dark background.
    ImageDraw.Draw(body).rounded_rectangle(
        (1, 1, body.width - 2, body.height - 2), round(width * 0.13), outline=(70, 52, 42, 255), width=3)
    return body


def perspective(img, tilt):
    """Fake 3D turn: shrink one vertical edge, then rotate slightly."""
    w, h = img.size
    k = 0.06  # how far the far edge shrinks
    pad = round(h * k)
    out = Image.new("RGBA", (w, h + 2 * pad), (0, 0, 0, 0))
    out.paste(img, (0, pad))
    # Coefficients map output -> input; solve for a trapezoid.
    if tilt > 0:   # right edge farther away
        quad = (0, 0, 0, h + 2 * pad, w, h + pad + pad * 2, w, -pad)
    else:          # left edge farther away
        quad = (0, -pad, 0, h + 3 * pad, w, h + 2 * pad, w, 0)
    out = out.transform(out.size, Image.QUAD, quad, Image.BICUBIC)
    return out.rotate(-4 * tilt, resample=Image.BICUBIC, expand=True)


def headline(draw, lines, accent, font, top):
    y = top
    for line in lines:
        words = line.split(" ")
        space = draw.textlength(" ", font=font)
        total = sum(draw.textlength(wd, font=font) for wd in words) + space * (len(words) - 1)
        x = (W - total) / 2
        for wd in words:
            draw.text((x, y), wd, font=font, fill=AMBER if wd in accent else CREAM)
            x += draw.textlength(wd, font=font) + space
        y += font.size * 1.12


def slide(shot, lines, accent, tilt, out_path):
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    # Amber shape: a big circle, mostly off-canvas, on the side the phone leans toward.
    shape = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx = W * (0.95 if tilt > 0 else 0.05)
    r = W * 0.78
    ImageDraw.Draw(shape).ellipse((cx - r, 1500 - r, cx + r, 1500 + r), fill=AMBER + (255,))
    canvas.alpha_composite(shape)
    # Soft glow behind the phone ties it to the shape.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((W * 0.15, 1100, W * 0.85, 2500), fill=(255, 170, 90, 90))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(160)))

    draw = ImageDraw.Draw(canvas)
    headline(draw, lines, accent, ImageFont.truetype(FONT, 118), 210)

    p = perspective(phone(shot, 1000), tilt)
    x, y = (W - p.width) // 2, 640
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 170), (x + 30 * tilt, y + 50), p.getchannel("A"))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(45)))
    canvas.alpha_composite(p, (x, y))
    canvas.convert("RGB").save(out_path, optimize=True)


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "appstore/out"), exist_ok=True)
    for i, (shot, lines, accent, tilt) in enumerate(SLIDES, 1):
        name = os.path.splitext(os.path.basename(shot))[0].split("-", 1)[1]
        out = os.path.join(ROOT, f"appstore/out/{i:02d}-{name}.png")
        slide(shot, lines, accent, tilt, out)
        print("wrote", out)
