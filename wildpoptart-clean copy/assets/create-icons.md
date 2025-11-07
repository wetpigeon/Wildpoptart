# Icon Creation Instructions

The `icon.svg` file has been created. To generate the required PNG sizes, use one of these methods:

## Method 1: Using ImageMagick (recommended)
```bash
cd assets
convert -background none icon.svg -resize 16x16 icon16.png
convert -background none icon.svg -resize 48x48 icon48.png
convert -background none icon.svg -resize 128x128 icon128.png
```

## Method 2: Using an online converter
1. Visit https://convertio.co/svg-png/
2. Upload `icon.svg`
3. Convert and download
4. Resize to 16x16, 48x48, and 128x128 pixels
5. Save as `icon16.png`, `icon48.png`, and `icon128.png`

## Method 3: Using Chrome DevTools (temporary solution)
The extension will work without icons, just with placeholders. Chrome will display default icons.

## Method 4: Use any graphics editor
- Open `icon.svg` in Figma, Sketch, GIMP, Photoshop, etc.
- Export at 16x16, 48x48, and 128x128 pixels
- Save as PNG files with the correct names
