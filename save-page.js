const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_URL = 'https://registration.basketballconnect.com/liveScoreSeasonFixture' +
  '?organisationKey=155fb981-71f6-48a0-a53f-1da7ee78fb39' +
  '&yearId=8' +
  '&competitionUniqueKey=ae31672b-fa16-475f-b569-deda015aba60' +
  '&divisionId=All' +
  '&teamId=-1';

// Matches the Squadi round/matches endpoint
const FIXTURE_API = /api-basketball\.squadi\.com\/livescores\/round\/matches/;
// Matches the teams list endpoint (no teamId param)
const TEAMS_API   = /api-basketball\.squadi\.com\/livescores\/teams\/enduser\/list/;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Brisbane',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  let fixtureData = null;
  let teamsData   = null;

  // Intercept API responses as they fire
  page.on('response', async response => {
    const url = response.url();
    try {
      if (FIXTURE_API.test(url)) {
        console.log(`Intercepted fixture response: ${url}`);
        fixtureData = await response.json();
        console.log(`Fixture data type: ${typeof fixtureData}, rounds: ${fixtureData?.rounds?.length ?? 'N/A'}`);
      }
      if (TEAMS_API.test(url)) {
        console.log(`Intercepted teams response: ${url}`);
        teamsData = await response.json();
        console.log(`Teams count: ${Array.isArray(teamsData) ? teamsData.length : 'N/A'}`);
      }
    } catch (e) {
      console.log(`Could not parse response from ${url}: ${e.message}`);
    }
  });

  console.log('Navigating to BasketballConnect...');
  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 90000 });
  } catch (e) {
    console.log(`Navigation note: ${e.message} — checking if data was captured anyway`);
  }

  // Extra wait for any delayed API calls
  await page.waitForTimeout(5000);
  await browser.close();

  const now = new Date().toISOString();

  // ── teams.json ─────────────────────────────────────────────────────────────
  // Teams come from the teams list API, or fall back to extracting from fixture data
  let redbacks = [];

  if (Array.isArray(teamsData)) {
    redbacks = teamsData
      .filter(t => typeof t.name === 'string' && t.name.startsWith('Redbacks'))
      .map(t => t.name.trim())
      .sort();
    console.log(`Extracted ${redbacks.length} Redbacks teams from teams API`);
  } else if (fixtureData?.rounds) {
    // Fallback: extract unique team names from fixture data
    const teamSet = new Set();
    for (const round of fixtureData.rounds) {
      if (round.isHidden) continue;
      for (const match of round.matches || []) {
        const t1 = match.team1?.name || '';
        const t2 = match.team2?.name || '';
        if (t1.startsWith('Redbacks')) teamSet.add(t1);
        if (t2.startsWith('Redbacks')) teamSet.add(t2);
      }
    }
    redbacks = [...teamSet].sort();
    console.log(`Extracted ${redbacks.length} Redbacks teams from fixture data (fallback)`);
  }

  if (redbacks.length > 0) {
    fs.writeFileSync('teams.json', JSON.stringify({ teams: redbacks, updatedAt: now }, null, 2));
    console.log(`OK: written teams.json with ${redbacks.length} teams`);
  } else {
    console.log('WARNING: no Redbacks teams found — teams.json not updated');
  }

  // ── fixtures.json ───────────────────────────────────────────────────────────
  // Structure: data.rounds[] where isHidden=false, each round has:
  //   - name: "Round 5"
  //   - division.name: "U12 Boys Division 1"
  //   - matches[]: each match has:
  //       team1.name, team2.name
  //       startTime: ISO 8601 UTC string
  //       venueCourt.venue.name: "Northside Indoor Sports Centre"
  //       venueCourt.name: "Court 1"
  //       matchStatus: "ENDED" | "STARTED" | "SCHEDULED" etc.

  if (!fixtureData?.rounds) {
    console.log('ERROR: no fixture data captured — fixtures.json not updated');
    process.exit(1);
  }

  const nowDate = new Date();
  const fixturesByTeam = {};

  for (const round of fixtureData.rounds) {
    if (round.isHidden) continue;

    const division  = round.division?.name || '';
    const roundName = round.name || '';

    for (const match of round.matches || []) {
      const t1Name = match.team1?.name || '';
      const t2Name = match.team2?.name || '';

      for (const [teamName, isHome] of [[t1Name, true], [t2Name, false]]) {
        if (!teamName.startsWith('Redbacks')) continue;

        const opponent  = isHome ? t2Name : t1Name;
        const startTime = match.startTime || match.originalStartTime || '';
        const venue     = match.venueCourt?.venue?.name || '';
        const court     = match.venueCourt?.name || '';
        const status    = match.matchStatus || '';

        if (!fixturesByTeam[teamName]) {
          fixturesByTeam[teamName] = { division, nextGame: null, lastGame: null };
        }

        // Always update division
        if (division && !fixturesByTeam[teamName].division) {
          fixturesByTeam[teamName].division = division;
        }

        if (startTime) {
          const gameDate = new Date(startTime);
          const gameInfo = {
            date: startTime,
            venue,
            court,
            opponent,
            isHome,
            roundName,
            status,
          };

          if (gameDate > nowDate) {
            // Future game — keep the soonest
            const existing = fixturesByTeam[teamName].nextGame;
            if (!existing || new Date(existing.date) > gameDate) {
              fixturesByTeam[teamName].nextGame = gameInfo;
            }
          } else {
            // Past game — keep the most recent
            const existing = fixturesByTeam[teamName].lastGame;
            if (!existing || new Date(existing.date) < gameDate) {
              fixturesByTeam[teamName].lastGame = gameInfo;
            }
          }
        }
      }
    }
  }

  fs.writeFileSync('fixtures.json', JSON.stringify({ fixtures: fixturesByTeam, updatedAt: now }, null, 2));
  console.log(`OK: written fixtures.json with data for ${Object.keys(fixturesByTeam).length} Redbacks teams`);

  // Summary
  for (const [team, data] of Object.entries(fixturesByTeam)) {
    const next = data.nextGame ? `next: ${data.nextGame.date.substring(0,10)}` : 'no upcoming game';
    const last = data.lastGame ? `last: ${data.lastGame.date.substring(0,10)}` : '';
    console.log(`  ${team} [${data.division}] — ${next}${last ? ', ' + last : ''}`);
  }
})();
