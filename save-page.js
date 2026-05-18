const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_URL = 'https://registration.basketballconnect.com/liveScoreSeasonFixture?organisationKey=155fb981-71f6-48a0-a53f-1da7ee78fb39&yearId=8&competitionUniqueKey=ae31672b-fa16-475f-b569-deda015aba60&divisionId=All&teamId=-1';
const API_PATTERN = /api-basketball\.squadi\.com\/livescores\/round\/matches/;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });
  const page = await context.newPage();

  let fixtureData = null;
  let teamsData = null;

  // Intercept API responses as they fire
  page.on('response', async response => {
    const url = response.url();

    // Capture fixture/match data
    if (API_PATTERN.test(url)) {
      try {
        const json = await response.json();
        console.log(`Captured fixture response from: ${url}`);
        console.log(`Type: ${typeof json}, isArray: ${Array.isArray(json)}`);
        if (Array.isArray(json)) console.log(`Length: ${json.length}`);
        if (json && (Array.isArray(json) ? json[0] : json)) {
          const sample = Array.isArray(json) ? json[0] : json;
          console.log('Sample keys:', Object.keys(sample));
          console.log('Sample (first 800 chars):', JSON.stringify(sample, null, 2).substring(0, 800));
        }
        fixtureData = json;
      } catch (e) {
        console.log(`Could not parse response from ${url}: ${e.message}`);
      }
    }

    // Also capture the teams list if it comes through
    if (url.includes('liveScoreSeasonFixture') && !url.includes('teamId')) {
      try {
        const json = await response.json();
        if (Array.isArray(json) && json[0]?.name) {
          console.log(`Captured teams response: ${json.length} teams`);
          teamsData = json;
        }
      } catch (e) { /* ignore */ }
    }
  });

  console.log('Navigating to BasketballConnect...');
  try {
    await page.goto(TARGET_URL, {
      waitUntil: 'networkidle',
      timeout: 90000  // 90 seconds — SPA needs time to load and fire API calls
    });
  } catch (e) {
    console.log(`Navigation note: ${e.message}`);
    // Even if timeout occurs, we may have already captured the API responses
  }

  // Wait a bit more for any delayed API calls
  await page.waitForTimeout(5000);

  await browser.close();

  const now = new Date().toISOString();

  // ── Write teams.json ──────────────────────────────────────────────────────
  if (teamsData) {
    const redbacks = teamsData
      .filter(t => t.name && t.name.trim().startsWith('Redbacks'))
      .map(t => t.name.trim())
      .sort();
    fs.writeFileSync('teams.json', JSON.stringify({ teams: redbacks, updatedAt: now }, null, 2));
    console.log(`Written teams.json with ${redbacks.length} Redbacks teams`);
  } else {
    console.log('WARNING: no teams data captured — teams.json not updated');
  }

  // ── Write fixtures.json ───────────────────────────────────────────────────
  if (fixtureData) {
    // Parse fixtures into per-team structure
    const fixtures = parseFixtures(fixtureData);
    fs.writeFileSync('fixtures.json', JSON.stringify({ fixtures, updatedAt: now }, null, 2));
    console.log(`Written fixtures.json with data for ${Object.keys(fixtures).length} Redbacks teams`);
  } else {
    console.log('WARNING: no fixture data captured — fixtures.json not updated');
    console.log('Raw fixture data was null — the API call may not have fired yet');
    process.exit(1);
  }
})();

function parseFixtures(data) {
  const result = {};
  const now = new Date();

  // Handle both array and wrapped object responses
  const items = Array.isArray(data) ? data : (data.matches || data.games || data.rounds || data.fixtures || []);

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    // Extract team names (try multiple field name conventions)
    const home = getTeamName(item, 'home');
    const away = getTeamName(item, 'away');
    const division = getField(item, ['divisionName','division','grade','gradeName','competitionGrade','roundName']);
    const dateStr  = getField(item, ['date','gameDate','matchDate','scheduledDate','startDate','fixtureDate','roundDate']);
    const timeStr  = getField(item, ['time','gameTime','startTime','scheduledTime','matchTime']);
    const venue    = getField(item, ['venue','venueName','court','courtName','location','address']);

    for (const [teamName, isHome] of [[home, true], [away, false]]) {
      if (!teamName || !teamName.startsWith('Redbacks')) continue;
      const opponent = isHome ? away : home;

      if (!result[teamName]) {
        result[teamName] = { division: division || '', nextGame: null };
      }
      if (division && !result[teamName].division) {
        result[teamName].division = division;
      }

      // Only keep future games, pick the soonest one
      if (dateStr) {
        const gameDate = new Date(dateStr);
        const existing = result[teamName].nextGame;
        const isFuture = gameDate >= now;
        const isEarlier = !existing || new Date(existing.date) > gameDate;

        if (isFuture && isEarlier) {
          result[teamName].nextGame = {
            date: dateStr,
            time: timeStr || '',
            venue: venue || '',
            opponent: opponent || '',
            isHome,
          };
        }
      }
    }
  }

  return result;
}

function getTeamName(item, side) {
  // Try nested object first, then flat field names
  const nested = item[`${side}Team`];
  if (nested && typeof nested === 'object') return nested.name || nested.teamName || '';
  return item[`${side}TeamName`] || item[`${side}Name`] || '';
}

function getField(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
      return String(item[key]);
    }
  }
  return '';
}
