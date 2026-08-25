#!/usr/bin/env python3
"""
generate_assets.py
Generates pixel-perfect icons and promotional images for VoiceBridge Chrome Extension
using pure Python standard library (zlib, struct, math) - zero external dependencies required.
"""

import os
import struct
import zlib
import math

def create_png(width, height, rgba_data):
    """Creates a valid PNG byte string from raw RGBA buffer."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + rgba_data[y*width*4:(y+1)*width*4] for y in range(height))
    idat = zlib.compress(raw, 9)
    return header + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

class Canvas:
    def __init__(self, width, height, bg_color=(255, 255, 255, 255)):
        self.width = width
        self.height = height
        self.pixels = [list(bg_color) for _ in range(width * height)]

    def set_pixel(self, x, y, color):
        if 0 <= x < self.width and 0 <= y < self.height:
            idx = y * self.width + x
            sr, sg, sb, sa = color
            if sa == 255:
                self.pixels[idx] = [sr, sg, sb, 255]
            elif sa > 0:
                dr, dg, db, da = self.pixels[idx]
                alpha = sa / 255.0
                inv = 1.0 - alpha
                nr = int(sr * alpha + dr * inv)
                ng = int(sg * alpha + dg * inv)
                nb = int(sb * alpha + db * inv)
                self.pixels[idx] = [nr, ng, nb, 255]

    def fill_rect(self, x0, y0, x1, y1, color):
        for y in range(max(0, int(y0)), min(self.height, int(y1))):
            for x in range(max(0, int(x0)), min(self.width, int(x1))):
                self.set_pixel(x, y, color)

    def fill_gradient_vertical(self, color_top, color_bottom):
        for y in range(self.height):
            ratio = y / max(1, self.height - 1)
            r = int(color_top[0] * (1 - ratio) + color_bottom[0] * ratio)
            g = int(color_top[1] * (1 - ratio) + color_bottom[1] * ratio)
            b = int(color_top[2] * (1 - ratio) + color_bottom[2] * ratio)
            for x in range(self.width):
                self.set_pixel(x, y, (r, g, b, 255))

    def fill_rounded_rect(self, x0, y0, x1, y1, radius, color):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                in_corner = False
                cx, cy = 0, 0
                if x < x0 + radius and y < y0 + radius:
                    cx, cy = x0 + radius, y0 + radius
                    in_corner = True
                elif x > x1 - radius and y < y0 + radius:
                    cx, cy = x1 - radius, y0 + radius
                    in_corner = True
                elif x < x0 + radius and y > y1 - radius:
                    cx, cy = x0 + radius, y1 - radius
                    in_corner = True
                elif x > x1 - radius and y > y1 - radius:
                    cx, cy = x1 - radius, y1 - radius
                    in_corner = True
                
                if in_corner:
                    dist = math.hypot(x - cx, y - cy)
                    if dist <= radius:
                        self.set_pixel(x, y, color)
                else:
                    self.set_pixel(x, y, color)

    def fill_circle(self, cx, cy, radius, color):
        r_int = int(radius + 1)
        for y in range(int(cy - r_int), int(cy + r_int + 1)):
            for x in range(int(cx - r_int), int(cx + r_int + 1)):
                dist = math.hypot(x - cx, y - cy)
                if dist <= radius:
                    self.set_pixel(x, y, color)

    def draw_line(self, x0, y0, x1, y1, thickness, color):
        dx = x1 - x0
        dy = y1 - y0
        dist = math.hypot(dx, dy)
        if dist < 0.001:
            self.fill_circle(x0, y0, thickness / 2.0, color)
            return
        steps = max(1, int(dist * 2))
        for s in range(steps + 1):
            t = s / steps
            cx = x0 + dx * t
            cy = y0 + dy * t
            self.fill_circle(cx, cy, thickness / 2.0, color)

    def to_bytes(self):
        buf = bytearray()
        for p in self.pixels:
            buf.extend(p)
        return bytes(buf)

def render_voicebridge_icon(size):
    """Draws the VoiceBridge icon: Suspension Bridge with a golden microphone centered."""
    c = Canvas(size, size, (0, 0, 0, 0))
    scale = size / 128.0
    
    # 1. Background rounded tile
    bg_margin = max(1, int(4 * scale))
    c.fill_rounded_rect(bg_margin, bg_margin, size - bg_margin, size - bg_margin, int(24 * scale), (37, 99, 235, 255))
    
    # Inner subtle gradient overlay (lighter top)
    for y in range(bg_margin, size - bg_margin):
        factor = (1.0 - (y / size)) * 0.25
        r = int(37 + 40 * factor)
        g = int(99 + 60 * factor)
        b = int(235 + 20 * factor)
        for x in range(bg_margin + int(12 * scale), size - bg_margin - int(12 * scale)):
            c.set_pixel(x, y, (r, g, b, 255))

    # 2. Suspension Bridge Cables
    cable_color = (224, 231, 255, 220)
    tower_color = (199, 210, 254, 255)
    
    t_w = max(1.5, 3 * scale)
    c.draw_line(24 * scale, 100 * scale, 24 * scale, 35 * scale, t_w, tower_color)
    c.draw_line(104 * scale, 100 * scale, 104 * scale, 35 * scale, t_w, tower_color)
    
    deck_y = 78 * scale
    c.draw_line(12 * scale, deck_y, 116 * scale, deck_y, max(2.0, 4 * scale), (255, 255, 255, 240))
    
    steps = 40
    prev_x, prev_y = 24 * scale, 35 * scale
    for s in range(1, steps + 1):
        t = s / steps
        cur_x = 24 * scale + (104 - 24) * scale * t
        norm_x = (t - 0.5) * 2.0
        cur_y = (35 + 36 * (1.0 - norm_x * norm_x * 0.8)) * scale
        c.draw_line(prev_x, prev_y, cur_x, cur_y, max(1.2, 2.2 * scale), cable_color)
        
        if s % 6 == 0 and abs(t - 0.5) > 0.15:
            c.draw_line(cur_x, cur_y, cur_x, deck_y, max(0.8, 1.4 * scale), (199, 210, 254, 180))
        prev_x, prev_y = cur_x, cur_y

    # 3. Center Glowing Microphone
    mic_cx = 64 * scale
    mic_cy = 50 * scale
    
    wave_color = (254, 240, 138, 200)
    for angle_deg in range(-60, 61, 6):
        rad = math.radians(angle_deg)
        lx = mic_cx - 24 * scale + math.cos(rad) * 6 * scale
        ly = mic_cy + math.sin(rad) * 16 * scale
        c.fill_circle(lx, ly, max(1.0, 1.8 * scale), wave_color)
        rx = mic_cx + 24 * scale - math.cos(rad) * 6 * scale
        ly = mic_cy + math.sin(rad) * 16 * scale
        c.fill_circle(rx, ly, max(1.0, 1.8 * scale), wave_color)

    mic_w = 12 * scale
    mic_h = 22 * scale
    c.fill_rounded_rect(mic_cx - mic_w, mic_cy - mic_h, mic_cx + mic_w, mic_cy + mic_h, int(mic_w), (251, 191, 36, 255))
    
    # Mic Mesh Grille lines
    step = max(1, int(4 * scale))
    for gy in range(int(mic_cy - mic_h + 4 * scale), int(mic_cy), step):
        c.draw_line(mic_cx - mic_w + 3 * scale, gy, mic_cx + mic_w - 3 * scale, gy, max(0.8, 1.2 * scale), (217, 119, 6, 255))

    c.draw_line(mic_cx - 16 * scale, mic_cy, mic_cx - 16 * scale, mic_cy + 10 * scale, max(1.5, 2.5 * scale), (255, 255, 255, 255))
    c.draw_line(mic_cx + 16 * scale, mic_cy, mic_cx + 16 * scale, mic_cy + 10 * scale, max(1.5, 2.5 * scale), (255, 255, 255, 255))
    c.draw_line(mic_cx - 16 * scale, mic_cy + 10 * scale, mic_cx + 16 * scale, mic_cy + 10 * scale, max(1.5, 2.5 * scale), (255, 255, 255, 255))
    c.draw_line(mic_cx, mic_cy + 10 * scale, mic_cx, mic_cy + 24 * scale, max(1.5, 2.5 * scale), (255, 255, 255, 255))
    c.draw_line(mic_cx - 10 * scale, mic_cy + 24 * scale, mic_cx + 10 * scale, mic_cy + 24 * scale, max(1.5, 2.5 * scale), (255, 255, 255, 255))

    return create_png(size, size, c.to_bytes())

def render_promo_small():
    """Generates 440x280 small promotional tile for Chrome Web Store."""
    c = Canvas(440, 280)
    c.fill_gradient_vertical((15, 23, 42), (30, 58, 138))
    
    c.fill_rounded_rect(30, 70, 170, 210, 24, (37, 99, 235, 255))
    c.fill_circle(100, 140, 30, (251, 191, 36, 255))
    c.draw_line(50, 160, 150, 160, 4, (255, 255, 255, 255))
    
    c.fill_rounded_rect(190, 75, 410, 125, 12, (255, 255, 255, 240))
    c.fill_circle(215, 100, 8, (239, 68, 68, 255))
    bars = [12, 24, 32, 18, 28, 36, 20, 30, 14, 22]
    for i, h in enumerate(bars):
        c.draw_line(235 + i * 12, 100 - h//2, 235 + i * 12, 100 + h//2, 3, (37, 99, 235, 255))
        
    c.fill_rounded_rect(190, 145, 410, 205, 12, (241, 245, 249, 255))
    c.fill_circle(215, 175, 12, (34, 197, 94, 255))
    c.draw_line(240, 170, 380, 170, 4, (30, 41, 59, 255))
    c.draw_line(240, 182, 340, 182, 3, (100, 116, 139, 255))
    
    c.fill_rect(0, 240, 440, 280, (15, 23, 42, 255))
    c.fill_circle(40, 260, 4, (251, 191, 36, 255))
    c.draw_line(55, 260, 390, 260, 2, (148, 163, 184, 180))
    
    return create_png(440, 280, c.to_bytes())

def render_promo_marquee():
    """Generates 1400x560 Marquee tile for Chrome Web Store."""
    c = Canvas(1400, 560)
    c.fill_gradient_vertical((15, 23, 42), (29, 78, 216))
    
    c.fill_rounded_rect(80, 130, 380, 430, 48, (37, 99, 235, 255))
    c.fill_circle(230, 280, 70, (251, 191, 36, 255))
    c.draw_line(120, 330, 340, 330, 8, (255, 255, 255, 255))
    
    c.fill_rounded_rect(440, 120, 710, 440, 20, (255, 255, 255, 245))
    c.fill_rect(440, 120, 710, 180, (239, 246, 255, 255))
    c.fill_circle(480, 150, 12, (239, 68, 68, 255))
    for i in range(16):
        h = 10 + (i % 5) * 8
        c.draw_line(470 + i * 14, 250 - h, 470 + i * 14, 250 + h, 4, (37, 99, 235, 255))
    c.fill_rounded_rect(470, 340, 680, 400, 10, (34, 197, 94, 255))
    
    c.fill_rounded_rect(750, 120, 1030, 440, 20, (255, 255, 255, 245))
    c.fill_rect(750, 120, 1030, 180, (243, 244, 246, 255))
    c.draw_line(780, 150, 950, 150, 6, (30, 41, 59, 255))
    c.fill_rounded_rect(780, 220, 1000, 300, 12, (239, 246, 255, 255))
    c.fill_circle(815, 260, 16, (37, 99, 235, 255))
    c.draw_line(845, 252, 970, 252, 5, (30, 41, 59, 255))
    c.draw_line(845, 268, 930, 268, 4, (100, 116, 139, 255))
    
    c.fill_rounded_rect(1070, 120, 1340, 440, 20, (255, 255, 255, 245))
    c.fill_rect(1070, 120, 1340, 180, (254, 243, 199, 255))
    c.fill_circle(1110, 150, 12, (217, 119, 6, 255))
    c.fill_rounded_rect(1100, 210, 1310, 250, 8, (224, 231, 255, 255))
    c.fill_rounded_rect(1100, 270, 1310, 310, 8, (254, 226, 226, 255))
    c.fill_rounded_rect(1100, 330, 1310, 370, 8, (220, 252, 231, 255))
    
    return create_png(1400, 560, c.to_bytes())

def render_screenshot(title_type):
    """Generates 1280x800 high-res mock screenshots for Chrome Web Store."""
    c = Canvas(1280, 800)
    c.fill_rect(0, 0, 1280, 800, (241, 245, 249, 255))
    
    c.fill_rect(0, 0, 1280, 70, (226, 232, 240, 255))
    c.fill_circle(30, 35, 6, (239, 68, 68, 255))
    c.fill_circle(50, 35, 6, (234, 179, 8, 255))
    c.fill_circle(70, 35, 6, (34, 197, 94, 255))
    c.fill_rounded_rect(110, 18, 1150, 52, 17, (255, 255, 255, 255))
    c.draw_line(140, 35, 360, 35, 4, (100, 116, 139, 255))
    c.fill_rounded_rect(1170, 20, 1205, 50, 8, (37, 99, 235, 255))
    
    if title_type == 1:
        c.fill_rect(80, 110, 1200, 200, (22, 101, 52, 255))
        c.draw_line(120, 155, 450, 155, 8, (255, 255, 255, 255))
        
        c.fill_rounded_rect(80, 230, 800, 720, 12, (255, 255, 255, 255))
        for y in range(270, 480, 30):
            c.draw_line(120, y, 740, y, 5, (203, 213, 225, 255))
            
        c.fill_rounded_rect(840, 230, 1200, 720, 12, (255, 255, 255, 255))
        c.draw_line(870, 270, 1020, 270, 6, (30, 41, 59, 255))
        c.fill_rounded_rect(870, 320, 1170, 370, 8, (37, 99, 235, 255))
        
        c.fill_rounded_rect(870, 440, 1170, 680, 10, (248, 250, 252, 255))
        c.draw_line(890, 470, 1060, 470, 5, (71, 85, 105, 255))
        
        c.fill_rounded_rect(320, 420, 960, 640, 24, (15, 23, 42, 255))
        c.fill_circle(380, 480, 14, (239, 68, 68, 255))
        c.draw_line(420, 480, 520, 480, 8, (255, 255, 255, 255))
        
        for i in range(24):
            h = 8 + int(math.sin(i * 0.5) * 24 + 20)
            c.draw_line(560 + i * 15, 480 - h, 560 + i * 15, 480 + h, 4, (96, 165, 250, 255))
            
        c.fill_rounded_rect(380, 540, 520, 600, 12, (234, 179, 8, 255))
        c.fill_rounded_rect(550, 540, 900, 600, 12, (34, 197, 94, 255))
        
    elif title_type == 2:
        c.fill_rounded_rect(120, 110, 1160, 740, 12, (255, 255, 255, 255))
        c.draw_line(160, 160, 500, 160, 10, (30, 41, 59, 255))
        for y in range(220, 400, 28):
            c.draw_line(160, y, 800, y, 5, (203, 213, 225, 255))
            
        c.fill_rounded_rect(160, 440, 1000, 620, 16, (239, 246, 255, 255))
        c.draw_line(160, 440, 160, 620, 8, (37, 99, 235, 255))
        
        c.fill_circle(220, 490, 22, (37, 99, 235, 255))
        c.draw_line(260, 480, 460, 480, 6, (30, 41, 59, 255))
        c.draw_line(260, 505, 380, 505, 4, (100, 116, 139, 255))
        
        c.fill_circle(220, 565, 20, (34, 197, 94, 255))
        c.draw_line(270, 565, 750, 565, 6, (148, 163, 184, 255))
        c.fill_circle(440, 565, 10, (37, 99, 235, 255))
        c.fill_rounded_rect(780, 545, 860, 585, 8, (219, 234, 254, 255))
        c.fill_circle(900, 565, 12, (71, 85, 105, 255))
        
    else:
        c.fill_rect(80, 110, 1200, 740, (255, 255, 255, 255))
        
        c.fill_rounded_rect(140, 160, 620, 400, 16, (248, 250, 252, 255))
        c.draw_line(180, 210, 440, 210, 8, (30, 41, 59, 255))
        c.draw_line(180, 260, 560, 260, 5, (71, 85, 105, 255))
        c.fill_rounded_rect(180, 310, 380, 360, 8, (37, 99, 235, 255))
        
        c.fill_rounded_rect(660, 160, 1140, 400, 16, (15, 23, 42, 255))
        c.draw_line(700, 210, 980, 210, 8, (254, 240, 138, 255))
        c.draw_line(700, 260, 1080, 260, 5, (226, 232, 240, 255))
        c.fill_rounded_rect(700, 310, 900, 360, 8, (234, 179, 8, 255))
        
        c.fill_rounded_rect(140, 440, 1140, 680, 16, (239, 246, 255, 255))
        c.fill_circle(200, 510, 30, (37, 99, 235, 255))
        c.draw_line(260, 495, 620, 495, 8, (30, 41, 59, 255))
        c.draw_line(260, 525, 880, 525, 5, (100, 116, 139, 255))
        
        c.fill_rounded_rect(260, 570, 480, 630, 10, (220, 252, 231, 255))
        c.fill_rounded_rect(510, 570, 730, 630, 10, (254, 243, 199, 255))
        c.fill_rounded_rect(760, 570, 1020, 630, 10, (224, 231, 255, 255))
        
    return create_png(1280, 800, c.to_bytes())

def main():
    root = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(root, "..", "icons")
    store_dir = os.path.join(root, "..", "store-assets")
    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(store_dir, exist_ok=True)
    
    print("Generating icons...")
    for size in [16, 48, 128]:
        png_data = render_voicebridge_icon(size)
        path = os.path.join(icons_dir, f"icon-{size}.png")
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"  -> Created {path} ({size}x{size})")
        
    with open(os.path.join(store_dir, "icon-128.png"), "wb") as f:
        f.write(render_voicebridge_icon(128))
    print("  -> Created store-assets/icon-128.png")
    
    print("Generating promo images...")
    with open(os.path.join(store_dir, "promo-small-440x280.png"), "wb") as f:
        f.write(render_promo_small())
    print("  -> Created store-assets/promo-small-440x280.png")
    
    with open(os.path.join(store_dir, "promo-marquee-1400x560.png"), "wb") as f:
        f.write(render_promo_marquee())
    print("  -> Created store-assets/promo-marquee-1400x560.png")
    
    print("Generating screenshots...")
    for idx, name in [(1, "screenshot-1-recording-1280x800.png"), 
                      (2, "screenshot-2-teacher-player-1280x800.png"), 
                      (3, "screenshot-3-accessibility-1280x800.png")]:
        with open(os.path.join(store_dir, name), "wb") as f:
            f.write(render_screenshot(idx))
        print(f"  -> Created store-assets/{name}")
        
    print("All graphics assets generated successfully!")

if __name__ == "__main__":
    main()
