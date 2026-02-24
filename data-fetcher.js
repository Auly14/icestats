/**
 * IceStats Data Fetcher
 * - NHL  : API officielle (api-web.nhle.com) — géré directement par le frontend
 * - LIIGA: TheSportsDB API gratuite (id 4931)
 * - AHL  : TheSportsDB API gratuite (id 4738)
 *
 * Lancé par GitHub Actions 2x/jour (8h et 20h UTC)
 * Écrit les fichiers data/liiga.json et data/ahl.json dans le repo
 */

const https = require('https');
const fs   = require('fs');
const path = require('path');

// ── Dossier de sortie ──────────────────────────────────────────────────────
if (!fs.existsSync('data')) fs.mkdirSync('data');

// ── Constantes ─────────────────────────────────────────────────────────────
const TSDB_KEY   = '123';   // clé gratuite TheSportsDB
const TSDB_BASE  = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;
const DELAY_MS   = 500;     // pause entre chaque appel (évite le rate-limit)

const LEAGUES = {
  liiga: { id: '4931', name: 'LIIGA', flag: '🇫🇮' },
  ahl:   { id: '4738', name: 'AHL',   flag: '🇨🇦' },
};

// ── Utilitaires ────────────────────────────────────────────────────────────

/** Pause */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Fetch JSON depuis une URL HTTPS */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'IceStats/1.0 (github-actions)',
        'Accept':     'application/json',
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON invalide: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

/** Sauvegarde un fichier JSON dans data/ */
function saveJSON(filename, data) {
  const filepath = path.join('data', filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  💾 Sauvegardé : ${filepath}`);
}

/** Retourne un tableau de dates au format YYYY-MM-DD (3 jours passés + 10 futurs) */
function getDates(pastDays = 3, futureDays = 10) {
  const dates = [];
  for (let i = -pastDays; i <= futureDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/** Formate une heure ISO en "HH:MM" heure de Paris */
function formatTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
    });
  } catch { return ''; }
}

// ── Calendrier jour par jour avec pause 500ms ──────────────────────────────

async function fetchSchedule(leagueId) {
  const dates    = getDates(3, 10);
  const schedule = [];
  let   totalGames = 0;

  console.log(`  📅 ${dates.length} dates à interroger (pause ${DELAY_MS}ms entre chaque)...`);

  for (const dateStr of dates) {
    try {
      const url  = `${TSDB_BASE}/eventsday.php?d=${dateStr}&l=${leagueId}`;
      const data = await fetchJSON(url);
      const events = data?.events || [];

      if (events.length > 0) {
        const games = events.map(e => ({
          id:        e.idEvent,
          date:      dateStr,
          time:      formatTime(e.strTimestamp) || e.strTime || '',
          homeTeam:  e.strHomeTeam  || 'Domicile',
          awayTeam:  e.strAwayTeam  || 'Visiteur',
          homeScore: (e.intHomeScore !== null && e.intHomeScore !== '') ? parseInt(e.intHomeScore) : null,
          awayScore: (e.intAwayScore !== null && e.intAwayScore !== '') ? parseInt(e.intAwayScore) : null,
          status:    e.strStatus === 'Match Finished' ? 'Final'
                   : e.strProgress                   ? 'Live'
                   :                                   'À venir',
          venue: e.strVenue || '',
        }));

        schedule.push({ date: dateStr, games });
        totalGames += games.length;
        console.log(`    ✅ ${dateStr} : ${games.length} match(s)`);
      } else {
        console.log(`    — ${dateStr} : aucun match`);
      }

    } catch (err) {
      console.warn(`    ⚠️  ${dateStr} : ${err.message}`);
    }

    // ← PAUSE OBLIGATOIRE pour ne pas se faire bloquer par le rate-limit
    await sleep(DELAY_MS);
  }

  console.log(`  📊 Total : ${totalGames} matchs répartis sur ${schedule.length} jours`);
  return schedule;
}

// ── Classements ────────────────────────────────────────────────────────────

async function fetchStandings(leagueId) {
  console.log('  🏆 Récupération des classements...');
  try {
    const url  = `${TSDB_BASE}/lookuptable.php?l=${leagueId}&s=2024-2025`;
    const data = await fetchJSON(url);
    const table = data?.table || [];

    if (table.length === 0) {
      console.log('  ⚠️  Classements indisponibles pour 2024-2025.');
      return [];
    }

    const standings = table.map((t, i) => ({
      rank:   i + 1,
      name:   t.strTeam    || '',
      badge:  t.strBadge   || '',
      gp:     parseInt(t.intPlayed)       || 0,
      wins:   parseInt(t.intWin)          || 0,
      losses: parseInt(t.intLoss)         || 0,
      draws:  parseInt(t.intDraw)         || 0,
      points: parseInt(t.intPoints)       || 0,
      gf:     parseInt(t.intGoalsFor)     || 0,
      ga:     parseInt(t.intGoalsAgainst) || 0,
    }));

    console.log(`  ✅ ${standings.length} équipes`);
    return standings;

  } catch (err) {
    console.warn(`  ⚠️  Classements : ${err.message}`);
    return [];
  }
}

// ── Analyse paris (basée sur les victoires récentes) ──────────────────────

function buildBettingAnalysis(schedule) {
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Compter les victoires récentes de chaque équipe
  const wins = {};
  schedule.forEach(day => {
    if (day.date >= today) return;
    day.games.forEach(g => {
      if (g.homeScore === null) return;
      const homeWon = g.homeScore > g.awayScore;
      wins[g.homeTeam] = (wins[g.homeTeam] || 0) + (homeWon ? 1 : 0);
      wins[g.awayTeam] = (wins[g.awayTeam] || 0) + (homeWon ? 0 : 1);
    });
  });

  const betting = [];

  schedule.forEach(day => {
    if (day.date !== today && day.date !== tomorrow) return;
    day.games.forEach(g => {
      if (g.status === 'Final') return;

      const hw = wins[g.homeTeam] || 0;
      const aw = wins[g.awayTeam] || 0;
      const homeScore = hw + 2; // +2 = avantage domicile
      const awayScore = aw + 1;
      const total     = homeScore + awayScore;

      const homeWinPct = Math.round((homeScore / total) * 100);
      const awayWinPct = 100 - homeWinPct;
      const favPct     = Math.max(homeWinPct, awayWinPct);
      const favorite   = homeWinPct >= awayWinPct ? g.homeTeam : g.awayTeam;
      const confidence = favPct >= 65 ? 8 : favPct >= 58 ? 6 : 4;

      betting.push({
        date:       day.date,
        match:      `${g.awayTeam} @ ${g.homeTeam}`,
        time:       g.time,
        homeTeam:   g.homeTeam,
        awayTeam:   g.awayTeam,
        homeWinPct,
        awayWinPct,
        favorite,
        confidence,
        analysis:   `Favori : ${favorite} (${favPct}%). `
                  + `Victoires récentes — ${g.homeTeam} : ${hw}, ${g.awayTeam} : ${aw}. `
                  + (confidence >= 8 ? 'Signal fort.' : confidence >= 6 ? 'Légère avance.' : 'Match très ouvert.'),
      });
    });
  });

  return betting;
}

// ── Traitement complet d'une ligue ─────────────────────────────────────────

async function fetchLeague(key) {
  const { id, name, flag } = LEAGUES[key];
  console.log(`\n${flag}  Ligue : ${name} (TheSportsDB id ${id})`);
  console.log('─'.repeat(50));

  const schedule  = await fetchSchedule(id);
  await sleep(DELAY_MS); // pause avant l'appel classements
  const standings = await fetchStandings(id);
  const betting   = buildBettingAnalysis(schedule);

  saveJSON(`${key}.json`, {
    league:    name,
    updatedAt: new Date().toISOString(),
    schedule,
    standings,
    scorers: {
      note:    'Stats joueurs non disponibles avec la clé gratuite TheSportsDB',
      points:  [],
      goals:   [],
      assists: [],
    },
    betting,
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏒  IceStats — Data Fetcher');
  console.log('══════════════════════════════════════════════════');
  console.log(`📅  ${new Date().toLocaleString('fr-FR')}`);
  console.log(`⏱️   Délai entre appels : ${DELAY_MS} ms (anti rate-limit)`);

  await fetchLeague('liiga');
  await sleep(1500); // pause d'1,5 s entre les deux ligues
  await fetchLeague('ahl');

  saveJSON('metadata.json', {
    lastUpdate:  new Date().toISOString(),
    liigaSource: 'TheSportsDB id 4931',
    ahlSource:   'TheSportsDB id 4738',
    nhlSource:   'api-web.nhle.com (chargé par le frontend)',
  });

  console.log('\n✅  Toutes les données sont à jour !');
}

main().catch(err => {
  console.error('\n❌  Erreur fatale :', err.message);
  process.exit(1);
});
