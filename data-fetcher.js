#!/usr/bin/env node

/**
 * IceStats Data Fetcher
 * Récupère les données NHL (via API), LIIGA et AHL (via web scraping)
 * À utiliser avec GitHub Actions pour automatisation
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_FILE = 'data.json';
const DATA_DIR = '.';

// Données stockées
let allData = {
  nhl: { calendar: [], standings: [], topScorers: [] },
  liiga: { calendar: [], standings: [], topScorers: [] },
  ahl: { calendar: [], standings: [], topScorers: [] },
  lastUpdate: new Date().toISOString()
};

/**
 * Fetch NHL Data via API officielle
 */
function fetchNHL() {
  return new Promise((resolve) => {
    console.log('📍 Récupération NHL...');
    
    // Calendrier
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const endDate = new Date(now.getTime() + 14*24*60*60*1000).toISOString().split('T')[0];
    
    const calendarUrl = `https://statsapi.web.nhl.com/api/v1/schedule?startDate=${startDate}&endDate=${endDate}`;
    
    https.get(calendarUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          allData.nhl.calendar = parsed.dates || [];
          console.log(`✅ NHL Calendrier: ${parsed.dates?.length || 0} jours chargés`);
        } catch (e) {
          console.error('❌ Erreur parsing NHL calendrier:', e.message);
        }
        resolve();
      });
    }).on('error', e => {
      console.error('❌ Erreur NHL:', e.message);
      resolve();
    });
  });
}

/**
 * Scraper LIIGA (liiga.fi)
 * Récupère calendrier et stats
 */
function fetchLIIGA() {
  return new Promise((resolve) => {
    console.log('📍 Récupération LIIGA...');
    
    // Simulation: en production, faire du web scraping avec cheerio
    allData.liiga = {
      calendar: generateMockLIIGA(),
      standings: generateMockLIIGAStandings(),
      topScorers: generateMockLIIGAScorers()
    };
    
    console.log('✅ LIIGA: Données simulées (prêt pour web scraping)');
    resolve();
  });
}

/**
 * Scraper AHL (theahl.com)
 */
function fetchAHL() {
  return new Promise((resolve) => {
    console.log('📍 Récupération AHL...');
    
    // Simulation: en production, faire du web scraping
    allData.ahl = {
      calendar: generateMockAHL(),
      standings: generateMockAHLStandings(),
      topScorers: generateMockAHLScorers()
    };
    
    console.log('✅ AHL: Données simulées (prêt pour web scraping)');
    resolve();
  });
}

/**
 * Génère données LIIGA factices
 */
function generateMockLIIGA() {
  const teams = [
    'Liiga Espoo', 'Liiga Helsinki', 'Liiga Tampere', 'Liiga Turku',
    'Liiga Jyvaskyla', 'Liiga Oulu', 'Liiga Kuopio', 'Liiga Vaasa'
  ];
  
  const matches = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    
    matches.push({
      date: date.toISOString().split('T')[0],
      away: teams[Math.floor(Math.random() * teams.length)],
      home: teams[Math.floor(Math.random() * teams.length)],
      time: `${17 + Math.floor(Math.random() * 4)}:${Math.random() > 0.5 ? '00' : '30'}`,
      venue: 'Aréna Liiga'
    });
  }
  return matches;
}

function generateMockLIIGAStandings() {
  return [
    { team: 'Liiga Espoo', gp: 42, wins: 28, losses: 14, points: 60 },
    { team: 'Liiga Helsinki', gp: 42, wins: 26, losses: 16, points: 58 },
    { team: 'Liiga Tampere', gp: 42, wins: 24, losses: 18, points: 54 }
  ];
}

function generateMockLIIGAScorers() {
  return [
    { name: 'Petri Rantanen', team: 'Liiga Espoo', goals: 32, assists: 28 },
    { name: 'Markku Kukkonen', team: 'Liiga Helsinki', goals: 30, assists: 26 },
    { name: 'Jari Virtanen', team: 'Liiga Tampere', goals: 28, assists: 24 }
  ];
}

/**
 * Génère données AHL factices
 */
function generateMockAHL() {
  const teams = [
    'Providence Bruins', 'Hershey Bears', 'Wilkes-Barre Penguins', 'Toronto Marlies',
    'Rochester Americans', 'Bridgeport Islanders', 'Hartford Wolf Pack'
  ];
  
  const matches = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    
    matches.push({
      date: date.toISOString().split('T')[0],
      away: teams[Math.floor(Math.random() * teams.length)],
      home: teams[Math.floor(Math.random() * teams.length)],
      time: `${17 + Math.floor(Math.random() * 4)}:${Math.random() > 0.5 ? '00' : '30'}`,
      venue: 'Aréna AHL'
    });
  }
  return matches;
}

function generateMockAHLStandings() {
  return [
    { team: 'Providence Bruins', gp: 44, wins: 30, losses: 14, points: 66 },
    { team: 'Hershey Bears', gp: 44, wins: 28, losses: 16, points: 62 },
    { team: 'Wilkes-Barre Penguins', gp: 44, wins: 26, losses: 18, points: 58 }
  ];
}

function generateMockAHLScorers() {
  return [
    { name: 'Jack Ahcan', team: 'Providence Bruins', goals: 18, assists: 22 },
    { name: 'Mike Vecchione', team: 'Hershey Bears', goals: 16, assists: 20 },
    { name: 'Valtteri Kemilainen', team: 'Rochester Americans', goals: 15, assists: 18 }
  ];
}

/**
 * Sauvegarde les données en JSON
 */
function saveData() {
  const filePath = path.join(DATA_DIR, OUTPUT_FILE);
  fs.writeFileSync(filePath, JSON.stringify(allData, null, 2), 'utf-8');
  console.log(`\n✅ Données sauvegardées dans: ${filePath}`);
}

/**
 * Exécute toutes les récupérations
 */
async function fetchAllData() {
  console.log('🏒 IceStats - Récupération des Données');
  console.log('=' .repeat(40));
  
  const startTime = Date.now();
  
  try {
    await fetchNHL();
    await fetchLIIGA();
    await fetchAHL();
    
    allData.lastUpdate = new Date().toISOString();
    saveData();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Durée totale: ${duration}s`);
    console.log('🎉 Synchronisation complète!');
    
  } catch (error) {
    console.error('❌ Erreur fatale:', error.message);
    process.exit(1);
  }
}

// Démarrage
fetchAllData();

// Export pour tests
module.exports = { fetchAllData, allData };
