const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_URL = 'https://registration.basketballconnect.com/liveScoreSeasonFixture' +
  '?organisationKey=155fb981-71f6-48a0-a53f-1da7ee78fb39' +
  '&yearId=8' +
  '&competitionUniqueKey=ae31672b-fa16-475f-b569-deda015aba60' +
  '&divisionId=All' +
  '&teamId=-1';

const FIXTURE_API = /api-basketball\.squadi\.com\/livescores\/round\/matches/;
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

  // Store promises so we can await them BEFORE closing the browser
  const responsePromises = [];

  page.on('response', response => {
    const url = response.url();

    if (FIXTURE_API.test(url)) {
      console.log(`Intercepted fixture response: ${url}`);
      // Capture body as text immediately — do NOT await here (event handler is sync)
      const p = response.text()
        .then(text => ({ type: 'fixture', url, text }))
        .catch(e => ({ type: 'fixture', url, error: e.message }));
      responsePromises.push(p);
    }

    if (TEAMS_API.test(url)) {
      console.log(`Intercepted teams response: ${url}`);
      const p = response.text()
        .then(text => ({ type: 'teams', url, text }))
        .catch(e => ({ type: 'teams', url, error: e.message }));
      responsePromises.push(p);
    }
  });

  console.log('Navigating to BasketballConnect...');
  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 90000 });
  } catch (e) {
    console.log(`Navigation note: ${e.message} — checking if data was captured anyway`);
  }

  // Give delayed API calls a moment to fire and be captured
  await page.waitForTimeout(3000);

  // ── Await ALL response bodies BEFORE closing the browser ─────────────────
  console.log(`Awaiting ${responsePromises.length} captured response(s)...`);
  const results = await Promise.all(responsePromises);

  // Now safe to close
  await browser.close();
  console.log('Browser closed.');

  // ── Process captured responses ────────────────────────────────────────────
  let fixtureData = null;
  let teamsData   = null;

  for (const r of results) {
    if (r.error) {
      console.log(`ERROR reading ${r.type} response from ${r.url}: ${r.error}`);
      continue;
    }
    try {
      const parsed = JSON.parse(r.text);
      if (r.type === 'fixture') {
        if (parsed?.rounds) {
          fixtureData = parsed;
          console.log(`Parsed fixture data: ${parsed.rounds.length} rounds`);
        } else {
          console.log(`Fixture response unexpected shape — keys: ${Object.keys(parsed).join(', ')}`);
        }
      } else if (r.type === 'teams') {
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Prefer the larger teams response (the first call returns 0 teams)
          if (!teamsData || parsed.length > teamsData.length) {
            teamsData = parsed;
            console.log(`Parsed teams data: ${parsed.length} teams`);
          }
        } else {
          console.log(`Teams response was empty array or unexpected — skipping`);
        }
      }
    } catch (e) {
      console.log(`ERROR parsing ${r.type} JSON from ${r.url}: ${e.message}`);
      console.log(`Raw response (first 200 chars): ${r.text.slice(0, 200)}`);
    }
  }

  const now = new Date().toISOString();

  // ── teams.json ─────────────────────────────────────────────────────────────
  let redbacks = [];
  if (Array.isArray(teamsData)) {
    redbacks = teamsData
      .filter(t => typeof t.name === 'string' && t.name.startsWith('Redbacks'))
      .map(t => t.name.trim())
      .sort();
    console.log(`Extracted ${redbacks.length} Redbacks teams from teams API`);
  } else if (fixtureData?.rounds) {
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
    console.log(`OK: written teams.json`);
  } else {
    console.log('WARNING: no Redbacks teams found — teams.json not updated');
  }

  // ── fixtures.json ───────────────────────────────────────────────────────────
  if (!fixtureData?.rounds) {
    console.log('ERROR: no fixture data captured — fixtures.json not updated');
    console.log('Diagnosis: ' + (responsePromises.length === 0
      ? 'No fixture API calls were intercepted at all. The page may not have loaded correctly.'
      : 'Fixture API calls were intercepted but data could not be parsed. See errors above.'));
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
        if (division && !fixturesByTeam[teamName].division) {
          fixturesByTeam[teamName].division = division;
        }

        if (startTime) {
          const gameDate = new Date(startTime);
          const gameInfo = { date: startTime, venue, court, opponent, isHome, roundName, status };
          if (gameDate > nowDate) {
            const existing = fixturesByTeam[teamName].nextGame;
            if (!existing || new Date(existing.date) > gameDate) {
              fixturesByTeam[teamName].nextGame = gameInfo;
            }
          } else {
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

  for (const [team, data] of Object.entries(fixturesByTeam)) {
    const next = data.nextGame ? `next: ${data.nextGame.date.substring(0, 10)}` : 'no upcoming game';
    const last = data.lastGame ? `, last: ${data.lastGame.date.substring(0, 10)}` : '';
    console.log(`  ${team} [${data.division}] — ${next}${last}`);
  }
})();
