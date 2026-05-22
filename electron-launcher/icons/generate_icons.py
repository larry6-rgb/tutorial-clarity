import os
import subprocess
import sys

# Install Pillow if not already installed
try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

# Get current directory
icon_dir = os.path.dirname(os.path.abspath(__file__))

# PNG files to use
png_files = {
    16: os.path.join(icon_dir, 'icon-16.png'),
    32: os.path.join(icon_dir, 'icon-32.png'),
    48: os.path.join(icon_dir, 'icon-48.png'),
    64: os.path.join(icon_dir, 'icon-64.png'),
    128: os.path.join(icon_dir, 'icon-128.png'),
    256: os.path.join(icon_dir, 'icon-256.png'),
    512: os.path.join(icon_dir, 'icon-512.png'),
    1024: os.path.join(icon_dir, 'icon-1024.png')
}

print("Generating icon.ico for Windows...")
# Generate .ico (Windows)
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_images = []
for size in ico_sizes:
    if os.path.exists(png_files[size]):
        img = Image.open(png_files[size])
        ico_images.append(img)

if ico_images:
    ico_path = os.path.join(icon_dir, 'icon.ico')
    ico_images[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in ico_images])
    print(f"✅ Created: {ico_path}")

print("\nGenerating icon.icns for macOS...")
# Generate .icns (macOS) - using iconutil approach
icns_sizes = [16, 32, 64, 128, 256, 512, 1024]
iconset_dir = os.path.join(icon_dir, 'icon.iconset')
os.makedirs(iconset_dir, exist_ok=True)

for size in icns_sizes:
    if os.path.exists(png_files[size]):
        img = Image.open(png_files[size])
        # Standard size
        img.save(os.path.join(iconset_dir, f'icon_{size}x{size}.png'))
        # Retina size (@2x)
        if size <= 512:
            img_2x = Image.open(png_files[size * 2]) if size * 2 in png_files and os.path.exists(png_files[size * 2]) else img.resize((size * 2, size * 2), Image.LANCZOS)
            img_2x.save(os.path.join(iconset_dir, f'icon_{size}x{size}@2x.png'))

# Create .icns using Pillow (cross-platform)
try:
    icns_path = os.path.join(icon_dir, 'icon.icns')
    # Read all iconset images
    images = []
    for filename in sorted(os.listdir(iconset_dir)):
        if filename.endswith('.png'):
            images.append(Image.open(os.path.join(iconset_dir, filename)))
    
    if images:
        # Save as ICNS
        images[0].save(icns_path, format='ICNS', append_images=images[1:])
        print(f"✅ Created: {icns_path}")
except Exception as e:
    print(f"⚠️  Could not create .icns file: {e}")
    print("   (This is OK - .icns generation requires macOS or special tools)")

# Cleanup
import shutil
if os.path.exists(iconset_dir):
    shutil.rmtree(iconset_dir)

print("\n✅ Done! Icon files generated successfully!")