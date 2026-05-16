const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://registration.basketballconnect.com/livescoreSeasonFixture?organisationKey=155fb981-71f6-48a0-a53f-1da7ee78fb39&yearId=8&competitionUniqueKey=ae31672b-fa16-475f-b569-deda015aba60&divisionId=All');
  
  // Get full HTML content
  const content = await page.content();
  fs.writeFileSync('copy.html', content);

  // Optional: Take a screenshot
  await page.screenshot({ path: 'screenshot.png', fullPage: true });

  await browser.close();
})();
