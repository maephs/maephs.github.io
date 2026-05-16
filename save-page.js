const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // 1. Launch a stealthier browser instance
  const browser = await chromium.launch({
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Use an authentic, updated browser user agent
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Brisbane'
  });

  const page = await context.newPage();
  
  // Prevent headless disclosure flags
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const targetUrl = 'https://basketballconnect.com';

  console.log("Navigating to specific BasketballConnect portal link...");

  try {
    // 2. Use 'commit' strategy instead of 'domcontentloaded'. 
    // This tells Playwright to stop waiting for redirects/analytics and move to the next lines immediately.
    await page.goto(targetUrl, { 
      waitUntil: 'commit', 
      timeout: 45000 
    });

    console.log("Network connection initiated. Waiting for React layout execution...");

    // 3. Keep checking the page until the sport data container renders.
    // Instead of text, we look for standard text snippets found on BasketballConnect fixtures.
    await page.waitForSelector('text="Match ID"', { state: 'visible', timeout: 30000 });
    
    // 4. Custom safety buffer to allow AJAX matches to render fully into view
    console.log("Fixture elements located! Buffering for rendering...");
    await page.waitForTimeout(10000); 

    // 5. Capture layout
    const content = await page.content();
    fs.writeFileSync('copy.html', content);
    console.log("Success: copy.html updated.");

    // 6. Capture full fixture table screenshot
    await page.screenshot({ path: 'screenshot.png', fullPage: true });
    console.log("Success: screenshot.png saved.");

  } catch (error) {
    console.error("Pipeline Failure details:", error.message);
    
    // Fallback: Dump whatever the browser is looking at so we can diagnose via the git commit
    try {
      const fallbackContent = await page.content();
      fs.writeFileSync('copy.html', fallbackContent);
      await page.screenshot({ path: 'screenshot.png', fullPage: true });
      console.log("Saved current state to repository for debugging.");
    } catch (dumpError) {
      console.error("Could not complete emergency dump:", dumpError.message);
    }
    
    // Gracefully exit with 0 so your pipeline script saves the layout even on errors
    process.exit(0);
  }

  await browser.close();
})();
