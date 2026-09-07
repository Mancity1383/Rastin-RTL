import urllib.request
import re

with open('quillbot_dump.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Look for API endpoints or json scripts in HTML
print("Length of HTML:", len(text))

# Search for any api URLs in JS code inside HTML
apis = re.findall(r'https?://[^\s"\']+/api/[^\s"\']+', text)
print("APIs found:", list(set(apis)))

# Find data-testid or textareas
editors = re.findall(r'id=["\']([^"\']*translate[^"\']*)["\']', text, re.IGNORECASE)
print("IDs with translate:", list(set(editors)))
