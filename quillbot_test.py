import sys
import urllib.request
import urllib.parse
import json

sys.stdout.reconfigure(encoding='utf-8')

def test_quillbot_direct(text, sl="auto", tl="fa"):
    url = f"https://quillbot.com/translate?sl={sl}&tl={tl}&tone=auto&text={urllib.parse.quote(text)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        html = urllib.request.urlopen(req).read().decode('utf-8')
        print(f"QuillBot HTML fetched successfully, length: {len(html)}")
        
        # Check if text is present in HTML SSR data
        if text in html:
            print("Input text found in HTML body/scripts!")
        else:
            print("Input text NOT in raw HTML (rendered via JS dynamic state).")
    except Exception as e:
        print("Error fetching QuillBot:", e)

if __name__ == "__main__":
    test_quillbot_direct("Hello world")
