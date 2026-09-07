import urllib.request
import os

def download_file(url, filepath):
    print(f"Downloading {url} to {filepath}...")
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, filepath)
        print("Done!")
    except Exception as e:
        print(f"Error downloading {url}: {e}")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    fonts_dir = os.path.join(base_dir, "..", "fonts")
    
    # Fonts to download
    fonts = {
        "Vazirmatn-Regular.woff2": "https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn-Regular.woff2",
        "Vazirmatn-Medium.woff2": "https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn-Medium.woff2",
        "Vazirmatn-Bold.woff2": "https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn-Bold.woff2",
        "Vazirmatn-Black.woff2": "https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn-Black.woff2",
        "Outfit-Regular.woff2": "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-400-normal.woff2",
        "Outfit-Medium.woff2": "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-600-normal.woff2",
        "Outfit-Bold.woff2": "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-700-normal.woff2",
        "Outfit-ExtraBold.woff2": "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-800-normal.woff2"
    }
    
    for filename, url in fonts.items():
        filepath = os.path.join(fonts_dir, filename)
        download_file(url, filepath)
