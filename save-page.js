const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // Launch browser with realistic screen resolution
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  const targetUrl = 'https://basketballconnect.com';

  console.log("Navigating to BasketballConnect...");
  
  // 1. Load the initial shell
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  console.log("Waiting for fixture data to render on screen...");

  try {
    // 2. FORCE Playwright to wait until the dynamic text loads.
    // BasketballConnect fixtures always display "Match ID" or "Division" when data loads.
    await page.waitForSelector('text="Match ID"', { state: 'visible', timeout: 45000 });
    
    // 3. Give the browser an extra 10 seconds to complete animations and render tables smoothly
    await page.waitForTimeout(10000);
    
    console.log("Data detected! Saving files...");

    // 4. Capture HTML layout
    const content = await page.content();
    fs.writeFileSync('copy.html', content);

    // 5. Take an accurate full-page screenshot
    await page.screenshot({ path: 'screenshot.png', fullPage: true });
    console.log("Success: Snapshot and local layout saved.");

  } catch (error) {
    console.error("Timeout Error: The fixture data took too long to load or structure changed.", error);
    
    // Emergency snapshot so you can see what went wrong in your repository
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
  }

  await browser.close();
})();
