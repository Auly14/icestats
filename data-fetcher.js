// data-fetcher.js — Récupère LIIGA et AHL depuis TheSportsDB
// Écrit data/liiga.json et data/ahl.json dans le format exact attendu par index.html
// Format attendu:
//   { schedule: [{date, games:[{homeTeam, awayTeam, time, status, homeScore, awayScore}]}],
//     standings: [{name, gp, wins, losses, otLosses, draws, points, gf, ga}],
//     updatedAt: ISO string }

const fs    = require('fs');
const https = require('https');
const path  = require('path');

const LEAGUES = {
  liiga: { id: '4931', name: 'LIIGA' },
  ahl:   { id: '4738', name: 'AHL'   },
};

// Pauses pour ne pas se faire bloquer
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message + ' URL: ' + url)); }
      });
    }).on('error', reject);
  });
}

// Génère les 21 derniers jours + 14 prochains jours (35 jours au total)
function getDates() {
  const dates = [];
  const today = new Date();
  for (let i = -21; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

// Parse l'heure depuis la chaîne ISO retournée par TheSportsDB
function parseTime(strTimestamp) {
  if (!strTimestamp) return '';
  // Format: "2026-02-24T18:30:00+0000"
  const m = strTimestamp.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

// Détermine le statut du match
function getStatus(event) {
  if (!event) return 'upcoming';
  const score = event.intHomeScore;
  if (score !== null && score !== undefined && score !== '') return 'final';
  return 'upcoming';
}

async function fetchLeagueData(leagueKey) {
  const league = LEAGUES[leagueKey];
  console.log(`\n📡 Récupération ${league.name} (ID: ${league.id})...`);

  const scheduleByDate = {};
  const dates = getDates();

  // --- Récupère les matchs jour par jour ---
  for (const date of dates) {
    await sleep(500); // 500ms entre chaque appel
    const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&l=${league.id}`;
    try {
      const data = await fetchJSON(url);
      const events = data.events || [];
      if (events.length > 0) {
        const games = events.map(e => ({
          homeTeam:  e.strHomeTeam  || '',
          awayTeam:  e.strAwayTeam  || '',
          time:      parseTime(e.strTimestamp || e.dateEvent),
          status:    getStatus(e),
          homeScore: e.intHomeScore !== '' && e.intHomeScore !== null ? parseInt(e.intHomeScore) : null,
          awayScore: e.intAwayScore !== '' && e.intAwayScore !== null ? parseInt(e.intAwayScore) : null,
        }));
        scheduleByDate[date] = games;
        console.log(`  ✓ ${date}: ${games.length} match(s)`);
      }
    } catch(e) {
      console.warn(`  ⚠ ${date}: ${e.message}`);
    }
  }

  // Convertit en tableau [{date, games:[]}] trié par date
  const schedule = Object.entries(scheduleByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, games]) => ({ date, games }));

  // --- Récupère les classements ---
  await sleep(1500);
  let standings = [];
  try {
    const url = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${league.id}&s=2024-2025`;
    const data = await fetchJSON(url);
    const table = data.table || [];
    standings = table.map(t => ({
      name:     t.strTeam      || '',
      gp:       parseInt(t.intPlayed)  || 0,
      wins:     parseInt(t.intWin)     || 0,
      losses:   parseInt(t.intLoss)    || 0,
      otLosses: 0,
      draws:    parseInt(t.intDraw)    || 0,
      points:   parseInt(t.intPoints)  || 0,
      gf:       parseInt(t.intGoalsFor)     || 0,
      ga:       parseInt(t.intGoalsAgainst) || 0,
    }));
    console.log(`  ✓ Classement: ${standings.length} équipes`);
  } catch(e) {
    console.warn(`  ⚠ Classement: ${e.message}`);
  }

  const result = {
    schedule,
    standings,
    updatedAt: new Date().toISOString(),
  };

  // Crée le dossier data/ si nécessaire
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${leagueKey}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  const upcomingCount = schedule.reduce((n, d) => n + d.games.filter(g => g.status === 'upcoming').length, 0);
  const finalCount    = schedule.reduce((n, d) => n + d.games.filter(g => g.status === 'final').length, 0);
  console.log(`  💾 ${outPath} — ${upcomingCount} matchs à venir, ${finalCount} résultats, ${standings.length} équipes au classement`);
}

(async () => {
  try {
    await fetchLeagueData('liiga');
    await sleep(2000);
    await fetchLeagueData('ahl');
    console.log('\n✅ Terminé !');
  } catch(e) {
    console.error('❌ Erreur fatale:', e);
    process.exit(1);
  }
})();
