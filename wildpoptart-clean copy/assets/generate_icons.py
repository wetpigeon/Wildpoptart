#!/usr/bin/env python3
"""Generate PNG icons for Wildpoptart Chrome extension"""

from PIL import Image, ImageDraw
import os

def create_gradient(width, height):
    """Create a purple gradient background"""
    image = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(image)

    # Gradient colors (purple gradient)
    start_color = (102, 126, 234)  # #667eea
    end_color = (118, 75, 162)     # #764ba2

    for y in range(height):
        ratio = y / height
        r = int(start_color[0] + (end_color[0] - start_color[0]) * ratio)
        g = int(start_color[1] + (end_color[1] - start_color[1]) * ratio)
        b = int(start_color[2] + (end_color[2] - start_color[2]) * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    return image

def create_icon(size, filename):
    """Create a single icon of given size"""
    # Create gradient background
    img = create_gradient(size, size)
    draw = ImageDraw.Draw(img)

    if size == 16:
        # For 16x16, draw a simple pink rectangle (pop-tart)
        draw.rectangle([3, 5, 13, 11], fill=(255, 105, 180), outline=(212, 132, 76))

    elif size == 48:
        # For 48x48, draw a more detailed pop-tart
        # Pastry body (tan rectangle)
        draw.rectangle([10, 16, 38, 32], fill=(244, 164, 96), outline=(212, 132, 76), width=1)

        # Frosting (pink top portion)
        draw.rectangle([10, 16, 38, 24], fill=(255, 105, 180))

        # Sprinkles
        sprinkle_colors = [(255, 0, 0), (0, 255, 0), (255, 255, 0), (0, 255, 255), (255, 0, 255)]
        for i, color in enumerate(sprinkle_colors):
            x = 12 + i * 5
            draw.rectangle([x, 18, x + 1, 22], fill=color)

        # AI sparkle
        draw.ellipse([36, 8, 40, 12], fill='white')

    elif size == 128:
        # For 128x128, draw a detailed pop-tart
        # Pastry body (tan rectangle)
        draw.rectangle([26, 42, 102, 86], fill=(244, 164, 96), outline=(212, 132, 76), width=3)

        # Frosting (pink top portion)
        draw.rectangle([26, 42, 102, 64], fill=(255, 105, 180))

        # Sprinkles (more of them)
        sprinkle_colors = [
            (255, 0, 0), (0, 255, 0), (255, 255, 0),
            (0, 255, 255), (255, 0, 255), (255, 128, 0), (128, 0, 255)
        ]
        for i, color in enumerate(sprinkle_colors):
            x = 32 + i * 10
            draw.rectangle([x, 46, x + 3, 58], fill=color)

        # AI sparkles (multiple)
        draw.ellipse([100, 24, 108, 32], fill='white', outline=None)
        draw.ellipse([108, 30, 114, 36], fill='white', outline=None)
        draw.ellipse([94, 30, 98, 34], fill='white', outline=None)

    # Save the icon
    img.save(filename, 'PNG')
    print(f"✓ Created {filename} ({size}x{size})")

def main():
    """Generate all required icon sizes"""
    print("Generating Wildpoptart icons...")

    sizes = {
        'icon16.png': 16,
        'icon48.png': 48,
        'icon128.png': 128
    }

    for filename, size in sizes.items():
        create_icon(size, filename)

    print("\n✅ All icons generated successfully!")
    print("\nGenerated files:")
    for filename in sizes.keys():
        if os.path.exists(filename):
            file_size = os.path.getsize(filename)
            print(f"  - {filename} ({file_size:,} bytes)")

if __name__ == '__main__':
    main()
