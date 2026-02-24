/**
 * data-fetcher.js — EMPIRE HOCKEY
 * Sources:
 *   LIIGA  → TheSportsDB (ID 4931) — eventsday jour par jour + lookuptable classement
 *   AHL    → TheSportsDB (ID 4738) — idem
 * 
 * Écrit : data/liiga.json  data/ahl.json
 * Format de sortie (exact, attendu par index.html) :
 * {
 *   schedule: [ { date:"YYYY-MM-DD", games:[ { homeTeam, awayTeam, time, status, homeScore, awayScore } ] } ],
 *   standings: [ { name, gp, wins, losses, otLosses, draws, points, gf, ga } ],
 *   updatedAt: "ISO"
 * }
 */

const fs    = require('fs');
const https = require('https');
const path  = require('path');

// ── Utilitaires ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EmpireHockey/1.0)',
        'Accept':     'application/json'
      },
      timeout: 10000
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`Bad JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── Génère les dates autour d'aujourd'hui ──────────────────────────────────────
function getDateRange(pastDays = 7, futureDays = 21) {
  const dates = [];
  const today = new Date();
  for (let i = -pastDays; i <= futureDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]); // YYYY-MM-DD
  }
  return dates;
}

// ── Parse l'heure depuis strTimestamp (TheSportsDB) ───────────────────────────
function extractTime(event) {
  // strTimestamp: "2026-02-24 18:30:00" ou "2026-02-24T18:30:00+0000"
  const ts = event.strTimestamp || event.dateEventLocal || '';
  const m = ts.match(/[\sT](\d{2}:\d{2})/);
  return m ? m[1] : '';
}

// ── Statut du match ───────────────────────────────────────────────────────────
function matchStatus(event) {
  const score = event.intHomeScore;
  if (score !== null && score !== undefined && score !== '' && score !== 'null') {
    return 'final';
  }
  return 'upcoming';
}

// ── Fetch complet d'une ligue ─────────────────────────────────────────────────
async function fetchLeague(key, leagueId, leagueName) {
  console.log(`\n━━━ ${leagueName} (ID:${leagueId}) ━━━`);

  // ── 1. CALENDRIER ────────────────────────────────────────────────────────────
  const dates = getDateRange(7, 21);
  const scheduleMap = {};
  let totalGames = 0;

  for (const date of dates) {
    await sleep(600); // respecte le rate-limit de TheSportsDB
    const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&l=${leagueId}`;
    try {
      const data = await get(url);
      const events = data.events || [];

      if (events.length > 0) {
        scheduleMap[date] = events.map(e => ({
          homeTeam:  e.strHomeTeam  || '',
          awayTeam:  e.strAwayTeam  || '',
          time:      extractTime(e),
          status:    matchStatus(e),
          homeScore: (e.intHomeScore !== null && e.intHomeScore !== '' && e.intHomeScore !== 'null')
                       ? parseInt(e.intHomeScore) : null,
          awayScore: (e.intAwayScore !== null && e.intAwayScore !== '' && e.intAwayScore !== 'null')
                       ? parseInt(e.intAwayScore) : null,
        }));
        totalGames += scheduleMap[date].length;
        console.log(`  ${date} : ${scheduleMap[date].length} match(s)`);
      }
    } catch(e) {
      console.warn(`  ${date} : erreur — ${e.message}`);
    }
  }

  // Convertit en tableau trié
  const schedule = Object.entries(scheduleMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, games]) => ({ date, games }));

  console.log(`  → Total calendrier : ${totalGames} match(s) sur ${schedule.length} jour(s)`);

  // ── 2. CLASSEMENT ────────────────────────────────────────────────────────────
  await sleep(1500);
  let standings = [];

  // Essaie la saison courante puis la précédente
  for (const season of ['2024-2025', '2025-2026', '2023-2024']) {
    try {
      const url = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${leagueId}&s=${season}`;
      const data = await get(url);
      const table = data.table || [];
      if (table.length > 0) {
        standings = table.map(t => ({
          name:     t.strTeam               || '',
          gp:       parseInt(t.intPlayed)   || 0,
          wins:     parseInt(t.intWin)      || 0,
          losses:   parseInt(t.intLoss)     || 0,
          otLosses: 0,
          draws:    parseInt(t.intDraw)     || 0,
          points:   parseInt(t.intPoints)   || 0,
          gf:       parseInt(t.intGoalsFor)     || 0,
          ga:       parseInt(t.intGoalsAgainst) || 0,
        }));
        console.log(`  → Classement ${season} : ${standings.length} équipes`);
        break;
      }
    } catch(e) {
      console.warn(`  Classement ${season} : ${e.message}`);
    }
    await sleep(800);
  }

  // ── 3. RÉSULTAT FINAL ────────────────────────────────────────────────────────
  const result = { schedule, standings, updatedAt: new Date().toISOString() };

  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${key}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  const upcoming = schedule.reduce((n, d) => n + d.games.filter(g => g.status === 'upcoming').length, 0);
  const final    = schedule.reduce((n, d) => n + d.games.filter(g => g.status === 'final').length, 0);
  console.log(`  ✅ ${outPath} — ${upcoming} à venir, ${final} résultats, ${standings.length} classement`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await fetchLeague('liiga', '4931', 'LIIGA (Finlande)');
    await sleep(3000);
    await fetchLeague('ahl',   '4738', 'AHL (Amérique)');
    console.log('\n✅ Tous les fichiers mis à jour !');
  } catch(e) {
    console.error('❌ FATAL:', e.message);
    process.exit(1);
  }
})();
