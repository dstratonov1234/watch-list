"""Горящая кромка для темы «И вспыхнет пламя»: assets/burn.webp.

    python -P themes/the-hunger-games-catching-fire/burn.py

Полоса 2048×290 с прозрачностью, бесшовная по горизонтали. Сверху вниз: прозрачно (то, что ещё не сгорело) →
оранжевый отсвет → рваный тлеющий край → сплошной уголь → рваный нижний край с редкими искрами → прозрачно
(то, что открылось под сгоревшим). Строка JOIN — середина сплошного угля: по ней полосу можно резать на
«верхнюю кромку» и «нижнюю кромку» и стыковать с плашкой цвета CHAR.

Заодно доводит assets/flames.webp и assets/sparks.webp. Модель рисует огонь и искры на чёрном, а им нужно
ложиться на чужой фон: заставка — поверх главной, сполох — поверх кадра (режим наложения screen тут не помогает:
слой с z-index или transform — отдельная группа, и чёрное остаётся чёрным). Поэтому яркость точки становится её
непрозрачностью. Огонь к тому же склеивается со своим зеркалом в бесшовную полосу. После
`gen-image.py --force flames` или `--force sparks` запустить этот скрипт ещё раз.
Нужны numpy и Pillow (на macOS — окружение из CLAUDE.md).
"""
import os

import numpy as np
from PIL import Image

W, H = 2048, 290
JOIN = 170  # строка сплошного угля: выше — верхняя кромка, ниже — нижняя
CHAR = np.array([11, 8, 7], dtype=np.float32)  # тот же цвет у плашки заставки: #0b0807
rng = np.random.default_rng(75)  # 75-е Игры


def wave(freqs, amps):
    """Периодическая по ширине кривая: сумма синусоид со случайной фазой, в диапазоне примерно −1…1."""
    x = np.arange(W, dtype=np.float32) / W * 2 * np.pi
    y = np.zeros(W, dtype=np.float32)
    for f, a in zip(freqs, amps):
        y += a * np.sin(f * x + rng.uniform(0, 2 * np.pi))
    return y / sum(amps)


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# рваные края: крупные языки + мелкая бахрома
upper = 96 + 50 * wave([3, 7, 13, 29, 61, 127], [1.0, 0.8, 0.55, 0.35, 0.2, 0.1])
lower = 208 + 26 * wave([4, 9, 17, 37, 71, 149], [1.0, 0.7, 0.5, 0.35, 0.2, 0.12])
upper = np.clip(upper, 30, JOIN - 22)
lower = np.clip(lower, JOIN + 20, H - 26)
heat = 0.75 + 0.45 * wave([5, 11, 23, 53], [1, 0.7, 0.5, 0.3])  # где край тлеет ярче
speck = rng.random((H, W)).astype(np.float32)  # редкие искры

yy = np.arange(H, dtype=np.float32)[:, None]
du = yy - upper[None, :]  # > 0 — ниже верхнего края (внутри угля)
dl = lower[None, :] - yy  # > 0 — выше нижнего края (внутри угля)
ht = heat[None, :]

# уголь
a_char = smooth(-1.0, 1.5, du) * smooth(-1.5, 2.5, dl)
rgb = np.broadcast_to(CHAR, (H, W, 3)).copy()

# тлеющий верхний край: белое каление → оранжевый → тёмно-красный → уголь
g = np.clip(du / (9.0 * ht), 0, 1.6)
stops = [(0.0, (255, 240, 190)), (0.18, (255, 190, 80)), (0.45, (255, 118, 28)), (0.85, (150, 34, 10)), (1.3, tuple(CHAR))]
glow = np.zeros((H, W, 3), dtype=np.float32)
for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
    k = np.clip((g - p0) / (p1 - p0), 0, 1)[..., None]
    seg = ((g >= p0) & (g <= p1))[..., None]
    glow = np.where(seg, np.array(c0, np.float32) * (1 - k) + np.array(c1, np.float32) * k, glow)
glow = np.where((g > stops[-1][0])[..., None], CHAR, glow)
rgb = np.where((du >= 0)[..., None], glow, rgb)

# нижний край: редкие тлеющие точки у самой кромки
low_ember = (smooth(10, 0, dl) * (speck > 0.9) * (dl > 0)).astype(np.float32)
rgb = rgb * (1 - low_ember[..., None]) + np.array([225, 96, 24], np.float32) * low_ember[..., None]

# отсвет над верхним краем (ещё не сгоревшее подсвечено огнём) и дымная кайма под нижним
a_halo = np.where(du < 0, 0.62 * np.exp(du / (13.0 * ht)), 0).astype(np.float32)
a_smoke = np.where(dl < 0, 0.5 * np.exp(dl / 9.0), 0).astype(np.float32)
halo_rgb = np.array([255, 128, 36], np.float32)

alpha = 1 - (1 - a_char) * (1 - a_halo) * (1 - a_smoke)
w_char, w_halo, w_smoke = a_char, a_halo * (1 - a_char), a_smoke * (1 - a_char)
total = np.maximum(w_char + w_halo + w_smoke, 1e-6)[..., None]
out = (rgb * w_char[..., None] + halo_rgb * w_halo[..., None] + CHAR * w_smoke[..., None]) / total

img = np.dstack([np.clip(out, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "burn.webp")
os.makedirs(os.path.dirname(path), exist_ok=True)
Image.fromarray(img, "RGBA").save(path, "WEBP", quality=92, method=6)
print(path, f"{os.path.getsize(path) // 1024} КБ", f"upper {upper.min():.0f}…{upper.max():.0f}", f"lower {lower.min():.0f}…{lower.max():.0f}")


def key_black(name, width, mirror=False):
    """Картинка от модели на чёрном фоне → картинка с прозрачностью для сайта.
    Непрозрачность точки — её яркость, цвет — без примеси чёрного: огонь и искры ложатся на любой фон без
    режимов наложения. mirror — склеить кадр с его зеркальной копией: полоса вдвое длиннее и бесшовна на
    обоих стыках, при повторе не читается «забором»."""
    p = os.path.join(os.path.dirname(path), name)
    im = Image.open(p)
    if im.mode == "RGBA" and np.asarray(im)[..., 3].min() < 250:
        return print(p, "уже готов")
    a = np.asarray(im.convert("RGB")).astype(np.float32) / 255
    alpha = np.clip(a.max(axis=2) * 1.25, 0, 1)
    color = np.clip(a / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    im = Image.fromarray((np.dstack([color, alpha]) * 255).astype(np.uint8), "RGBA")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if mirror:
        strip = Image.new("RGBA", (width * 2, im.height))
        strip.paste(im, (0, 0))
        strip.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (width, 0))
        im = strip
    im.save(p, "WEBP", quality=70, alpha_quality=50, method=6)
    print(p, f"{im.width}x{im.height}", f"{os.path.getsize(p) // 1024} КБ")


key_black("flames.webp", 1024, mirror=True)
key_black("sparks.webp", 640)
key_black("bolt.webp", 640)
key_black("mist.webp", 1024, mirror=True)


def rag_edges(depth=40, length=2048, side=512):
    """Рваные края для сгоревшего лоскута (баннер просмотренного фильма): маски и тлеющая кайма.
    rag-t/rag-b — верхний и нижний край (полоса length×depth, бесшовная по ширине), rag-l/rag-r — левый и правый
    (depth×side, бесшовные по высоте). В маске непрозрачно то, что осталось от ткани. ember-t/ember-b — тлеющая
    линия ровно по тому же краю: кладётся поверх и совпадает с маской."""
    out = os.path.dirname(path)

    def curve(n, freqs, amps):
        x = np.arange(n, dtype=np.float32) / n * 2 * np.pi
        y = np.zeros(n, dtype=np.float32)
        for f, a in zip(freqs, amps):
            y += a * np.sin(f * x + rng.uniform(0, 2 * np.pi))
        y /= sum(amps)
        return depth * 0.5 + (depth * 0.5 - 5) * y  # 5 … depth − 5

    def save(arr, name, lossless=True):
        p = os.path.join(out, name)
        Image.fromarray(arr.astype(np.uint8), "RGBA").save(p, "WEBP", lossless=lossless, quality=90, method=6)
        print(p, f"{os.path.getsize(p) // 1024} КБ")

    # верхний край: непрозрачно ниже кривой
    c = curve(length, [5, 11, 23, 47, 97, 191], [1.0, 0.8, 0.6, 0.4, 0.25, 0.12])
    yy = np.arange(depth, dtype=np.float32)[:, None]
    d = yy - c[None, :]  # > 0 — внутри ткани
    a = smooth(-0.8, 0.8, d)
    mask = np.dstack([np.full((depth, length, 3), 255, np.float32), a * 255])
    save(mask, "rag-t.webp")
    save(mask[::-1], "rag-b.webp")
    # тлеющая линия по этому же краю: каление на самой кромке, отсвет наружу, уголь внутрь
    heat_ = 0.7 + 0.5 * (np.sin(np.arange(length) / length * 2 * np.pi * 9 + 1.3) * 0.5 + 0.5)[None, :]
    line = np.exp(-np.abs(d) / (1.6 * heat_))
    halo = np.where(d < 0, 0.5 * np.exp(d / (7.0 * heat_)), 0.55 * np.exp(-d / 5.0))
    al = np.clip(line + halo, 0, 1)
    col = np.where(line[..., None] > 0.55, np.array([255, 226, 150], np.float32), np.array([255, 128, 40], np.float32))
    col = np.where((d > 2.5)[..., None], np.array([120, 30, 10], np.float32), col)
    ember = np.dstack([col, al * 255])
    save(ember, "ember-t.webp", lossless=False)
    save(ember[::-1], "ember-b.webp", lossless=False)
    # левый и правый край: та же идея, кривая идёт по высоте
    c2 = curve(side, [3, 7, 13, 29, 61], [1.0, 0.8, 0.55, 0.35, 0.2])
    xx = np.arange(depth, dtype=np.float32)[None, :]
    d2 = xx - c2[:, None]
    a2 = smooth(-0.8, 0.8, d2)
    mask2 = np.dstack([np.full((side, depth, 3), 255, np.float32), a2 * 255])
    save(mask2, "rag-l.webp")
    save(mask2[:, ::-1], "rag-r.webp")


rag_edges()
