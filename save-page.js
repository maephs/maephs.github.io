const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  
  // Get full HTML content
  const content = await page.content();
  fs.writeFileSync('copy.html', content);

  // Optional: Take a screenshot
  await page.screenshot({ path: 'screenshot.png', fullPage: true });

  await browser.close();
})();
