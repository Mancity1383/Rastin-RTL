import asyncio
from playwright.async_api import async_playwright
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Navigating to QuillBot via Playwright...")
        text_to_translate = "subsidies"
        await page.goto(f"https://quillbot.com/translate?sl=en&tl=fa&tone=auto&text={text_to_translate}", wait_until="networkidle")
        
        print("Waiting 5 seconds for QuillBot AI translation generation...")
        await page.wait_for_timeout(5000)
        
        # Extract textareas and DOM nodes
        data = await page.evaluate('''() => {
            const boxes = Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], textarea, [data-testid="translated-text"]'));
            return boxes.map(b => b.innerText || b.value || b.textContent);
        }''')
        
        print("Textboxes found:", data)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
