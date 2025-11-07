# Wildpoptart Survey Bot - Clean Install Package

This is a stable version of the Wildpoptart extension with recent bug fixes reverted.

## What's Changed (Reverted)
- ✅ Removed `all_frames: true` - fixes intermittent fill button issue
- ✅ Removed visibility check code - fixes detection issues
- ✅ Kept phantom test field skip - protects against Ipsos test fields
- ✅ Kept database export feature - you can still export your question database

## Installation Steps

1. **Remove old version**:
   - Go to `chrome://extensions/`
   - Find "Wildpoptart Survey Bot"
   - Click "Remove"

2. **Install this version**:
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked"
   - Select this folder: `/Users/home/wildpoptart-clean/`

3. **Verify it loaded**:
   - Should see "Wildpoptart Survey Bot" version 1.1.0
   - Click the extension icon to open popup
   - Add your Claude API key if needed

4. **Test on a survey**:
   - Navigate to any survey
   - Click the 🍰 button that appears
   - Fill button should work on FIRST click (not second)

## If You Need to Go Back
Your original version is still at `/Users/home/wildpoptart/`
