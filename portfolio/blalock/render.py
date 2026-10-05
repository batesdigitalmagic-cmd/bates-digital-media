"""
Blalock identity: 30-second vertical portfolio video (1080 x 1920, 30 fps).

Every logo appearance is the supplied artwork (assets/), only moved, scaled, cropped,
rotated or faded. Nothing is redrawn. Colour swatches are sampled from the files.

Supplied assets: the finished circular badge and the horizontal wordmark. No brief,
sketches or concept variations were supplied, so the "exploration" stage is omitted
and the opening uses details of the finished identity.

Run:  python3 render.py      -> blalock-identity-30s.mp4
Needs Pillow and ffmpeg.
"""
import math
import os
import random
import struct
import subprocess
import wave

from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS, DUR = 1080, 1920, 30, 30.0
NFRAMES = int(DUR * FPS)

CHARCOAL = (35, 31, 32)      # badge background, sampled
BLUE = (0, 174, 239)         # brand blue, sampled
TINT = (92, 203, 246)        # wordmark highlight tint, sampled
WHITE = (255, 255, 255)

FONT = '/System/Library/Fonts/Avenir Next.ttc'
F_DEMI, F_MED = 2, 5

# --------------------------------------------------------------------------- assets
# The badge file has a 1 px edge line; trim 4 px of plain charcoal border (logo untouched).
_b = Image.open(os.path.join(HERE, 'assets/blalock-badge.png')).convert('RGB')
BADGE = _b.crop((4, 4, _b.width - 4, _b.height - 4))
WORD = Image.open(os.path.join(HERE, 'assets/blalock-wordmark.jpg')).convert('RGB')


def mip(img):
    """Pre-scaled copies so large reductions stay sharp (Lanczos), keyed by factor."""
    levels = {1.0: img}
    for f in (0.5, 0.25):
        levels[f] = img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
    return levels


BADGE_M, WORD_M = mip(BADGE), mip(WORD)


def place(levels, scale, src, dst, angle=0.0, fill=CHARCOAL):
    """Render artwork into a full frame: source point `src` lands on frame point `dst`,
    scaled by `scale` (frame px per source px) and rotated by `angle` degrees."""
    lvl = 1.0
    for f in (0.25, 0.5):
        if scale <= f * 1.4:
            lvl = f
            break
    img = levels[lvl]
    s = scale / lvl
    sx, sy = src[0] * lvl, src[1] * lvl
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    # Inverse map: frame (x, y) -> source (u, v)
    A, B = ca / s, sa / s
    D, E = -sa / s, ca / s
    C = sx - A * dst[0] - B * dst[1]
    F = sy - D * dst[0] - E * dst[1]
    return img.transform((W, H), Image.AFFINE, (A, B, C, D, E, F), resample=Image.BICUBIC, fillcolor=fill)


# --------------------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(x):  # ease-in-out cubic
    x = clamp(x)
    return 4 * x * x * x if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def lerp(a, b, k):
    return a + (b - a) * k


def window(t, t0, t1, fade=0.45):
    """0..1 visibility for something shown from t0 to t1 with fades."""
    return clamp((t - t0) / fade) * clamp((t1 - t) / fade)


# --------------------------------------------------------------------------- text
_text_cache = {}


def text_img(s, size, color, weight=F_DEMI, tracking=0.0):
    key = (s, size, color, weight, tracking)
    if key in _text_cache:
        return _text_cache[key]
    font = ImageFont.truetype(FONT, size, index=weight)
    widths = [font.getlength(ch) for ch in s]
    total = sum(widths) + tracking * size * (len(s) - 1)
    asc, desc = font.getmetrics()
    im = Image.new('RGBA', (int(total) + 8, asc + desc + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 4
    for ch, w in zip(s, widths):
        d.text((x, 4), ch, font=font, fill=color + (255,))
        x += w + tracking * size
    _text_cache[key] = im
    return im


def draw_text(frame, s, y, alpha, size=62, color=WHITE, weight=F_DEMI, rise=18, tracking=0.0, pill=False):
    """Centred caption. pill=True puts a small charcoal backing behind the words only, so
    captions stay readable over artwork without tinting the logo."""
    if alpha <= 0:
        return
    im = text_img(s, size, color, weight, tracking)
    x = (W - im.width) // 2
    yy = int(y - im.height / 2 + (1 - ease_out(alpha)) * rise)
    if pill:
        px, py = 34, 14
        box = Image.new('RGBA', (im.width + 2 * px, im.height + 2 * py), (0, 0, 0, 0))
        ImageDraw.Draw(box).rounded_rectangle((0, 0, box.width - 1, box.height - 1), radius=box.height // 2,
                                              fill=CHARCOAL + (int(225 * alpha),))
        frame.paste(box, (x - px, yy - py), box)
    if alpha < 1:
        im = im.copy()
        im.putalpha(im.getchannel('A').point(lambda v: int(v * alpha)))
    frame.paste(im, (x, yy), im)


CAP_Y = 1430  # caption centre: inside mobile-safe margins (clear of top and bottom app UI)

# --------------------------------------------------------------------------- scenes
BADGE_CENTER = (1065, 999)
FACE = (760, 640)          # face, lashes and hair strands of the symbol
TOP_ARC = (960, 330)       # "BLALOCK'S PROFESSIONAL" arc lettering
OC = (1045, 180)           # interlocking O and C in the wordmark


def scene_hook(t):
    """0-3 s: close-up of the symbol, pulling back. 'Building the Blalock identity.'"""
    k = ease(t / 3.2)
    scale = lerp(1.55, 0.62, k)
    src = (lerp(FACE[0], BADGE_CENTER[0], k), lerp(FACE[1], BADGE_CENTER[1], k))
    dst = (540, lerp(900, 820, k))
    f = place(BADGE_M, scale, src, dst)
    draw_text(f, 'Building the Blalock identity.', CAP_Y, window(t, 0.35, 3.0, 0.4), pill=True)
    return f


def scene_direction(t):
    """3-8 s: slow pan across the finished wordmark. 'Finding the direction.'"""
    k = ease((t - 3.0) / 5.4)
    scale = 1.18
    src = (lerp(430, 1310, k), 198)
    f = place(WORD_M, scale, src, (540, 800), fill=WHITE)
    draw_text(f, 'Finding the direction.', CAP_Y, window(t, 3.45, 8.0), color=CHARCOAL)
    return f


def scene_type(t):
    """8-11.5 s: the badge's arc lettering, slowly rotating into place."""
    k = ease((t - 8.0) / 3.8)
    f = place(BADGE_M, lerp(1.12, 1.22, k), TOP_ARC, (540, 700), angle=lerp(-9, 0, k))
    draw_text(f, 'Refining the details.', CAP_Y, window(t, 8.45, 18.0), pill=True)
    return f


def scene_monogram(t):
    """11.5-14.8 s: the interlocking O and C in the wordmark."""
    k = ease((t - 11.3) / 3.8)
    f = place(WORD_M, lerp(1.1, 1.32, k), OC, (540, 800), fill=WHITE)
    draw_text(f, 'Refining the details.', CAP_Y, window(t, 8.45, 18.0), color=CHARCOAL)
    return f


SWATCHES = [(BLUE, '#00AEEF', 'Brand blue'), (TINT, '#5CCBF6', 'Highlight'),
            (CHARCOAL, '#231F20', 'Charcoal'), (WHITE, '#FFFFFF', 'White')]


def scene_colour(t):
    """14.8-18.2 s: the symbol with the palette sampled from the logo files."""
    k = ease((t - 14.6) / 3.6)
    f = place(BADGE_M, lerp(0.33, 0.35, k), BADGE_CENTER, (540, 640))
    d = ImageDraw.Draw(f)
    sw, sh, gap = 200, 150, 26
    x0 = (W - (4 * sw + 3 * gap)) // 2
    for i, (col, hexv, name) in enumerate(SWATCHES):
        a = ease_out((t - 15.0 - i * 0.22) / 0.6)
        if a <= 0:
            continue
        x = x0 + i * (sw + gap)
        y = int(1070 + (1 - a) * 30)
        layer = Image.new('RGBA', (sw, sh + 90), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle((0, 0, sw - 1, sh - 1), radius=14, fill=col + (255,),
                             outline=(90, 86, 87, 255) if col == CHARCOAL else None, width=2)
        tx = text_img(hexv, 30, WHITE, F_DEMI)
        layer.paste(tx, ((sw - tx.width) // 2, sh + 10), tx)
        tn = text_img(name, 24, (183, 179, 180), F_MED)
        layer.paste(tn, ((sw - tn.width) // 2, sh + 48), tn)
        layer.putalpha(layer.getchannel('A').point(lambda v, a=a: int(v * a)))
        f.paste(layer, (x, y), layer)
    draw_text(f, 'Refining the details.', CAP_Y, window(t, 8.45, 18.0))
    return f


_card = None


def wordmark_card():
    global _card
    if _card is None:
        cw, ch = 960, 300
        card = Image.new('RGBA', (cw + 60, ch + 60), (0, 0, 0, 0))
        shadow = Image.new('RGBA', card.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((30, 40, cw + 30, ch + 40), 26, fill=(0, 0, 0, 120))
        shadow = shadow.filter(ImageFilter.GaussianBlur(14))
        card.alpha_composite(shadow)
        body = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        ImageDraw.Draw(body).rounded_rectangle((0, 0, cw - 1, ch - 1), 26, fill=WHITE + (255,))
        s = 900 / WORD.width
        wm = WORD.resize((900, round(WORD.height * s)), Image.LANCZOS)
        body.paste(wm, ((cw - wm.width) // 2, (ch - wm.height) // 2))
        mask = Image.new('L', (cw, ch), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw - 1, ch - 1), 26, fill=255)
        body.putalpha(mask)
        card.alpha_composite(body, (30, 30))
        _card = card
    return _card


def scene_reveal(t):
    """18.2-27 s: circular reveal of the full badge, then the wordmark lockup."""
    f = Image.new('RGB', (W, H), CHARCOAL)
    move = ease((t - 22.4) / 1.1)
    scale = lerp(lerp(0.42, 0.44, clamp((t - 18.2) / 4.2)), 0.30, move)
    cy = lerp(800, 560, move)
    art = place(BADGE_M, scale, BADGE_CENTER, (540, cy))
    r = ease_out((t - 18.2) / 1.3) * 760
    if r > 0:
        m = Image.new('L', (W // 4, H // 4), 0)
        rr = r / 4
        ImageDraw.Draw(m).ellipse((135 - rr, cy / 4 - rr, 135 + rr, cy / 4 + rr), fill=255)
        m = m.resize((W, H), Image.BILINEAR)
        f.paste(art, (0, 0), m)
    ca = ease_out((t - 22.7) / 0.9)
    if ca > 0:
        card = wordmark_card()
        if ca < 1:
            card = card.copy()
            card.putalpha(card.getchannel('A').point(lambda v: int(v * ca)))
        y = int(lerp(1220, 980, ca))
        f.paste(card, ((W - card.width) // 2, y), card)
    draw_text(f, 'The Blalock identity.', CAP_Y, window(t, 18.9, 27.0))
    return f


def scene_signature(t):
    """27-30 s: hold the finished logo. Closing text and call to action."""
    f = place(BADGE_M, 0.36, BADGE_CENTER, (540, 720))
    a = ease_out((t - 27.2) / 0.6)
    draw_text(f, 'Brand identity by Bates Digital.', 1290, a, size=58)
    draw_text(f, 'Let’s build your brand.', 1380, ease_out((t - 27.6) / 0.6), size=42, color=BLUE, weight=F_MED)
    return f


# (start, end, scene). Neighbouring scenes overlap for cross-dissolves.
TIMELINE = [
    (0.0, 3.25, scene_hook),
    (2.85, 8.25, scene_direction),
    (7.85, 11.75, scene_type),
    (11.35, 15.05, scene_monogram),
    (14.65, 18.45, scene_colour),
    (18.15, 27.25, scene_reveal),
    (26.85, 30.0, scene_signature),
]
XF = 0.4


def frame_at(t):
    active = [(s, e, fn) for s, e, fn in TIMELINE if s <= t < e or (fn is scene_signature and t >= s)]
    if len(active) == 1:
        return active[0][2](t)
    (s1, e1, f1), (s2, e2, f2) = active[0], active[1]
    k = ease((t - s2) / (e1 - s2))
    return Image.blend(f1(t), f2(t), k)


# --------------------------------------------------------------------------- audio
SR = 44100


def build_audio(path):
    """Original synthesized music bed and effects (no third-party audio)."""
    n = int(DUR * SR)
    L = [0.0] * n
    R = [0.0] * n
    rnd = random.Random(7)
    two_pi = 2 * math.pi

    def add(i, l, r):
        if 0 <= i < n:
            L[i] += l
            R[i] += r

    # Pad: soft chords, building toward the reveal.
    chords = [(0.0, 9.0, [220.0, 261.63, 329.63, 440.0]),          # A minor
              (8.6, 18.4, [174.61, 220.0, 261.63, 349.23]),        # F major
              (18.0, 30.0, [130.81, 196.0, 261.63, 329.63, 392.0])]  # C major
    for c0, c1, notes in chords:
        i0, i1 = int(c0 * SR), int(c1 * SR)
        for i in range(i0, min(i1, n)):
            t = i / SR
            env = min(1.0, (t - c0) / 0.6, (c1 - t) / 0.6) if c1 < 30 else min(1.0, (t - c0) / 0.6, (30 - t) / 1.6)
            env = max(0.0, env)
            level = 0.030 + 0.020 * min(1.0, t / 18.0) + (0.012 if t > 18.2 else 0.0)
            sl = sr_ = 0.0
            for j, fr in enumerate(notes):
                sl += math.sin(two_pi * fr * 0.998 * t + j)
                sr_ += math.sin(two_pi * fr * 1.002 * t + j * 1.7)
            shimmer = 0.25 * math.sin(two_pi * 4 * t)  # slow tremolo
            a = env * level * (1 + 0.15 * shimmer) / len(notes) * 2.2
            add(i, sl * a, sr_ * a)

    # Soft pulse from 8 s (110 bpm), fuller after the reveal.
    beat = 60 / 110
    t = 8.0
    while t < 29.0:
        amp = 0.16 if t < 18.2 else 0.24
        i0 = int(t * SR)
        for k in range(int(0.35 * SR)):
            tt = k / SR
            fr = 48 + 70 * math.exp(-tt * 30)
            s = math.sin(two_pi * fr * tt) * math.exp(-tt * 9) * amp
            add(i0 + k, s, s)
        t += beat

    def noise_burst(t0, dur, amp, lo, hi, pan=0.0):
        """Filtered noise swell (whoosh): cutoff sweeps lo -> hi -> lo."""
        i0 = int(t0 * SR)
        y = 0.0
        for k in range(int(dur * SR)):
            x = k / (dur * SR)
            cutoff = lo + (hi - lo) * math.sin(math.pi * x)
            alpha = 1 - math.exp(-two_pi * cutoff / SR)
            y += alpha * (rnd.uniform(-1, 1) - y)
            env = math.sin(math.pi * x) ** 2 * amp
            add(i0 + k, y * env * (1 - pan), y * env * (1 + pan))

    for t0 in (2.75, 7.75, 11.1, 14.4, 22.3, 26.7):          # scene transitions
        noise_burst(t0, 0.7, 0.22, 300, 3500, pan=rnd.uniform(-0.3, 0.3))
    noise_burst(22.6, 0.9, 0.14, 200, 1600, pan=0.2)          # card slides in (paper-like)
    # Riser into the reveal.
    i0 = int(15.6 * SR)
    y = 0.0
    for k in range(int(2.6 * SR)):
        x = k / (2.6 * SR)
        cutoff = 200 + 6000 * x * x
        y += (1 - math.exp(-two_pi * cutoff / SR)) * (rnd.uniform(-1, 1) - y)
        add(i0 + k, y * 0.16 * x * x, y * 0.16 * x * x)
    # Impact at the reveal.
    i0 = int(18.2 * SR)
    for k in range(int(1.6 * SR)):
        tt = k / SR
        s = math.sin(two_pi * (42 + 40 * math.exp(-tt * 12)) * tt) * math.exp(-tt * 3) * 0.45
        add(i0 + k, s, s)

    peak = max(max(abs(v) for v in L), max(abs(v) for v in R)) or 1.0
    g = 0.89 / peak
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        buf = bytearray()
        for a, b in zip(L, R):
            buf += struct.pack('<hh', int(a * g * 32767), int(b * g * 32767))
        wf.writeframes(bytes(buf))


# --------------------------------------------------------------------------- render
def main():
    out = os.path.join(HERE, 'blalock-identity-30s.mp4')
    video_tmp = os.path.join(HERE, '.video.mp4')
    audio_tmp = os.path.join(HERE, '.audio.wav')

    print('Building audio...')
    build_audio(audio_tmp)

    print('Rendering %d frames...' % NFRAMES)
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H),
         '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
         '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', video_tmp],
        stdin=subprocess.PIPE)
    for i in range(NFRAMES):
        enc.stdin.write(frame_at(i / FPS).tobytes())
        if i % 90 == 0:
            print('  %ds' % (i // FPS))
    enc.stdin.close()
    enc.wait()

    print('Muxing...')
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', video_tmp, '-i', audio_tmp,
         '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.82:level=disabled', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
         '-shortest', '-movflags', '+faststart', out], check=True)
    os.remove(video_tmp)
    os.remove(audio_tmp)
    print('Done:', out)


if __name__ == '__main__':
    main()
