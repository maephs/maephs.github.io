const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // 1. Launch browser with a real desktop viewport size
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  
  const targetUrl = 'https://registration.basketballconnect.com/livescoreSeasonFixture?organisationKey=155fb981-71f6-48a0-a53f-1da7ee78fb39&yearId=8&competitionUniqueKey=ae31672b-fa16-475f-b569-deda015aba60&divisionId=All';

  console.log("Navigating and waiting for API requests to complete...");
  
  // 2. Wait until the network activity goes quiet for 500ms
  await page.goto(targetUrl, { 
    waitUntil: 'networkidle',
    timeout: 60000 // Bump timeout to 60 seconds for slow APIs
  });

  // 3. (Optional Safety Buffer) Wait an extra 2 seconds if the page uses delayed layout rendering
  await page.waitForTimeout(2000);

  // 4. Capture the fully populated HTML
  const content = await page.content();
  fs.writeFileSync('copy.html', content);
  console.log("HTML captured successfully.");

  // 5. Take a screenshot
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  console.log("Screenshot taken successfully.");

  await browser.close();
})();
