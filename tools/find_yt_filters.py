import os
import re

search_dir = r"d:\Python\Extension\uBlock\assets"
for root, dirs, files in os.walk(search_dir):
    for file in files:
        if file.endswith('.txt'):
            try:
                with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                    content = f.read()
                    if 'youtube.com' in content:
                        print(f"File: {file}")
                        for line in content.split('\n'):
                            if 'youtube' in line and ('js(' in line or 'playerAds' in line or 'adPlacements' in line):
                                print(line)
            except Exception as e:
                pass
