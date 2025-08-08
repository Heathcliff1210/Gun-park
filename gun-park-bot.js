
import { Telegraf, Markup } from 'telegraf';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const BOT_TOKEN = '7324266903:AAHifYM9GXHoFS6sVSZrsRxwOoEENOOxw98';
const OPENROUTER_API_KEY = process.env.OPENAI_API_KEY || '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';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Storage files
const USERS_FILE = 'users.json';
const TEST_SESSIONS_FILE = 'test_sessions.json';
const USER_STATES_FILE = 'user_states.json';

// In-memory storage for user data and test sessions
const users = new Map();
const testSessions = new Map();
const userStates = new Map();

// Data persistence functions
async function saveData() {
  try {
    // Clean function to remove circular references and non-serializable objects
    const cleanData = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;
      if (obj instanceof Date) return obj.toISOString();
      
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip chronometer and other non-serializable objects
        if (key === 'chronometer' || typeof value === 'function') continue;
        if (value && typeof value === 'object') {
          cleaned[key] = cleanData(value);
        } else {
          cleaned[key] = value;
        }
      }
      return cleaned;
    };

    // Clean the data before saving
    const cleanUsers = {};
    for (const [key, value] of users.entries()) {
      cleanUsers[key] = cleanData(value);
    }

    const cleanTestSessions = {};
    for (const [key, value] of testSessions.entries()) {
      cleanTestSessions[key] = cleanData(value);
    }

    const cleanUserStates = {};
    for (const [key, value] of userStates.entries()) {
      cleanUserStates[key] = cleanData(value);
    }

    await Promise.all([
      fs.writeFile(USERS_FILE, JSON.stringify(cleanUsers, null, 2)),
      fs.writeFile(TEST_SESSIONS_FILE, JSON.stringify(cleanTestSessions, null, 2)),
      fs.writeFile(USER_STATES_FILE, JSON.stringify(cleanUserStates, null, 2))
    ]);
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

async function loadData() {
  try {
    // Load users
    try {
      const usersData = await fs.readFile(USERS_FILE, 'utf8');
      const usersObj = JSON.parse(usersData);
      Object.entries(usersObj).forEach(([key, value]) => {
        // Convert date strings back to Date objects
        if (value.createdAt) value.createdAt = new Date(value.createdAt);
        if (value.updatedAt) value.updatedAt = new Date(value.updatedAt);
        users.set(key, value);
      });
      console.log(`Loaded ${users.size} users from storage`);
    } catch (error) {
      console.log('No existing users file found, starting fresh');
    }

    // Load test sessions
    try {
      const sessionsData = await fs.readFile(TEST_SESSIONS_FILE, 'utf8');
      const sessionsObj = JSON.parse(sessionsData);
      Object.entries(sessionsObj).forEach(([key, value]) => {
        if (value.startTime) value.startTime = new Date(value.startTime);
        if (value.createdAt) value.createdAt = new Date(value.createdAt);
        testSessions.set(key, value);
      });
      console.log(`Loaded ${testSessions.size} test sessions from storage`);
    } catch (error) {
      console.log('No existing test sessions file found, starting fresh');
    }

    // Load user states
    try {
      const statesData = await fs.readFile(USER_STATES_FILE, 'utf8');
      const statesObj = JSON.parse(statesData);
      Object.entries(statesObj).forEach(([key, value]) => {
        userStates.set(key, value);
      });
      console.log(`Loaded ${userStates.size} user states from storage`);
    } catch (error) {
      console.log('No existing user states file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Auto-save data every 30 seconds
setInterval(saveData, 30000);

// Helper functions
function getRankFromWPM(wpm) {
  if (wpm >= 75) return "S+";
  if (wpm >= 61) return "S";
  if (wpm >= 46) return "A";
  if (wpm >= 31) return "B";
  if (wpm >= 16) return "C";
  return "D";
}

function getRankDescription(rank) {
  switch(rank) {
    case 'S+': return 'Maître Absolu';
    case 'S': return 'Expert Confirmé';
    case 'A': return 'Utilisateur Avancé';
    case 'B': return 'Intermédiaire';
    case 'C': return 'Apprenti';
    default: return 'Débutant';
  }
}

function calculateWPM(sentence, timeInSeconds) {
  const wordCount = sentence.trim().split(/\s+/).length;
  const wpm = Math.round((wordCount / timeInSeconds) * 60);
  return Math.max(0, wpm);
}

// Utility function to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+-=|{}.!\\]/g, '\\$&');
}

// OpenRouter API functions
async function generateSentences() {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b:free',
        messages: [
          {
            role: 'system',
            content: 'Tu dois fournir exactement 10 phrases en français complètement aléatoires et très variées. Chaque phrase doit être différente et porter sur des sujets totalement distincts (vie quotidienne, nature, animaux, voyages, nourriture, sport, musique, etc.). Les phrases doivent être courtes et simples (8-15 mots). Une phrase par ligne. Assure-toi qu\'aucune phrase ne se ressemble et qu\'elles soient toutes intéressantes à taper.'
          },
          {
            role: 'user',
            content: 'Génère 10 phrases françaises aléatoires et variées pour test de frappe.'
          }
        ],
        max_tokens: 1000,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      console.error(`OpenRouter API error: ${response.status}`);
      return getDefaultSentences();
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.error('No content returned from OpenRouter');
      return getDefaultSentences();
    }

    // Split sentences by newlines and filter empty lines
    const sentences = content
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\d+\.?\s*/))
      .slice(0, 10);

    return sentences.length >= 5 ? sentences : getDefaultSentences();
    
  } catch (error) {
    console.error('Error generating sentences:', error);
    return getDefaultSentences();
  }
}

async function analyzeResponse(originalSentence, userResponse, timeSpent) {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/kimi-k2:free',
        messages: [
          {
            role: 'system',
            content: `Tu es un expert en analyse de texte. Compare la phrase originale avec la réponse de l'utilisateur et détermine:

1. Si la réponse est totalement différente de la phrase demandée (pas du tout la même phrase), retourne: "INVALID_RESPONSE"

2. Si c'est bien la même phrase (même avec des fautes), calcule le pourcentage de fautes en comparant caractère par caractère, puis retourne au format JSON:
{
  "type": "valid",
  "errorRate": [pourcentage de 0 à 100],
  "wordCount": [nombre de mots dans la phrase originale]
}

Sois précis dans le calcul des erreurs. Compare chaque caractère, y compris la ponctuation et les espaces.`
          },
          {
            role: 'user',
            content: `Phrase originale: "${originalSentence}"\nRéponse utilisateur: "${userResponse}"\nTemps pris: ${timeSpent} secondes`
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error(`OpenRouter API error: ${response.status}`);
      const errorRate = calculateBasicErrorRate(originalSentence, userResponse);
      return { type: 'valid', errorRate };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      console.error('No content returned from analysis');
      const errorRate = calculateBasicErrorRate(originalSentence, userResponse);
      return { type: 'valid', errorRate };
    }

    if (content === 'INVALID_RESPONSE') {
      return { type: 'invalid_response', errorRate: 100 };
    }

    try {
      const parsed = JSON.parse(content);
      return {
        type: 'valid',
        errorRate: Math.min(100, Math.max(0, parsed.errorRate || 0))
      };
    } catch (parseError) {
      // Fallback: calculate basic error rate
      const errorRate = calculateBasicErrorRate(originalSentence, userResponse);
      return { type: 'valid', errorRate };
    }

  } catch (error) {
    console.error('Error analyzing response:', error);
    // Fallback error rate calculation
    const errorRate = calculateBasicErrorRate(originalSentence, userResponse);
    return { type: 'valid', errorRate };
  }
}

async function calculateExpectedTime(sentence, targetWPM) {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/kimi-k2:free',
        messages: [
          {
            role: 'system',
            content: `Tu es un expert en calcul de vitesse de frappe. On te donne une phrase et un objectif de vitesse en WPM (mots par minute). 

Calcule combien de temps il faudrait pour taper cette phrase à la vitesse donnée.

Méthode de calcul:
1. Compte le nombre de mots dans la phrase (séparés par des espaces)
2. Calcule le temps en secondes: (nombre_de_mots / WPM_objectif) * 60
3. Retourne uniquement le nombre de secondes (arrondi à 1 décimale)

Réponds UNIQUEMENT avec le nombre de secondes, sans unité ni explication. Par exemple: "12.5"`
          },
          {
            role: 'user',
            content: `Phrase: "${sentence}"\nObjectif WPM: ${targetWPM}`
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error(`OpenRouter API error for time calculation: ${response.status}`);
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return Math.round((wordCount / targetWPM) * 60 * 10) / 10;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      console.error('No content returned from time calculation');
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return Math.round((wordCount / targetWPM) * 60 * 10) / 10;
    }

    const timeInSeconds = parseFloat(content);
    
    if (isNaN(timeInSeconds) || timeInSeconds <= 0) {
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return Math.round((wordCount / targetWPM) * 60 * 10) / 10;
    }

    return Math.round(timeInSeconds * 10) / 10; // Keep 1 decimal precision
    
  } catch (error) {
    console.error('Error calculating expected time:', error);
    // Fallback calculation
    const wordCount = sentence.trim().split(/\s+/).length;
    return Math.round((wordCount / targetWPM) * 60 * 10) / 10;
  }
}

function calculateBasicErrorRate(original, response) {
  const originalChars = original.toLowerCase().replace(/\s+/g, ' ').trim();
  const responseChars = response.toLowerCase().replace(/\s+/g, ' ').trim();
  
  const maxLength = Math.max(originalChars.length, responseChars.length);
  let errors = 0;

  for (let i = 0; i < maxLength; i++) {
    if (originalChars[i] !== responseChars[i]) {
      errors++;
    }
  }

  return Math.round((errors / maxLength) * 100);
}

function getDefaultSentences() {
  return [
    "Les oiseaux chantent joyeusement dans les arbres du parc.",
    "Ma grand-mère prépare toujours des gâteaux délicieux le dimanche.",
    "Le soleil brille au-dessus des montagnes enneigées ce matin.",
    "Les enfants jouent au football sur la pelouse verte.",
    "Cette voiture rouge roule très vite sur l'autoroute déserte.",
    "Mon chat noir dort paisiblement sur le canapé moelleux.",
    "Les fleurs du jardin embaument l'air de leur parfum sucré.",
    "La pluie tambourine doucement sur les vitres de la fenêtre.",
    "Les étudiants lisent attentivement leurs livres à la bibliothèque.",
    "Le train arrive en gare avec quelques minutes de retard.",
    "Les nuages blancs dansent lentement dans le ciel bleu.",
    "Cette pizza aux champignons sent vraiment très bon.",
    "Les musiciens jouent une mélodie entraînante sur la scène.",
    "La mer calme reflète les derniers rayons du soleil couchant.",
    "Mon frère collectionne les timbres anciens depuis son enfance.",
    "Les touristes visitent le musée avec beaucoup d'enthousiasme.",
    "Ce livre raconte une histoire passionnante et émouvante.",
    "Les abeilles butinent les fleurs colorées du jardin fleuri.",
    "La neige recouvre entièrement la forêt silencieuse et mystérieuse.",
    "Les amis se retrouvent chaque vendredi dans ce café sympa."
  ];
}

// Profile card generation
async function generateProfileCard(user) {
  try {
    // Create HTML template
    const htmlTemplate = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Carte de Profil - ${user.username}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Montserrat:wght@300;400;500;600&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Montserrat', sans-serif;
            background: #1a1a1a;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
        }

        .business-card {
            width: 700px;
            height: 400px;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 25%, #1f1f1f 50%, #2a2a2a 75%, #1a1a1a 100%);
            border-radius: 15px;
            box-shadow: 
                0 15px 50px rgba(0, 0, 0, 0.5),
                inset 0 1px 0 rgba(192, 192, 192, 0.2),
                inset 0 -1px 0 rgba(0, 0, 0, 0.3);
            position: relative;
            overflow: hidden;
            display: flex;
        }

        .card-background {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: 
                radial-gradient(circle at 20% 50%, rgba(255, 215, 0, 0.05) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(192, 192, 192, 0.05) 0%, transparent 50%),
                linear-gradient(45deg, transparent 48%, rgba(255, 215, 0, 0.02) 50%, transparent 52%);
            background-size: 100% 100%, 100% 100%, 20px 20px;
            opacity: 0.8;
        }

        .left-section {
            width: 35%;
            padding: 40px 30px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 2;
        }

        .profile-image {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            border: 3px solid transparent;
            background: linear-gradient(#1a1a1a, #1a1a1a) padding-box,
                        linear-gradient(45deg, #FFD700, #C0C0C0, #FFD700) border-box;
            box-shadow: 
                0 8px 25px rgba(255, 215, 0, 0.3),
                0 0 20px rgba(192, 192, 192, 0.2);
            overflow: hidden;
            margin-bottom: 20px;
        }

        .profile-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .rank-container {
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(192, 192, 192, 0.1));
            border: 1px solid rgba(255, 215, 0, 0.3);
            border-radius: 20px;
            padding: 6px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            backdrop-filter: blur(5px);
        }

        .rank-badge {
            background: linear-gradient(135deg, #FFD700, #C0C0C0, #FFD700);
            color: #1a1a1a;
            font-weight: 700;
            font-size: 16px;
            padding: 3px 10px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(255, 215, 0, 0.3);
        }

        .rank-text {
            background: linear-gradient(135deg, #FFD700, #C0C0C0, #FFD700);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .right-section {
            width: 65%;
            padding: 40px 35px;
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .name {
            font-family: 'Playfair Display', serif;
            font-size: 36px;
            font-weight: 700;
            background: linear-gradient(135deg, #FFD700, #C0C0C0, #FFD700, #FFED4E, #FFD700);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 25px;
            letter-spacing: 1px;
            text-shadow: 0 2px 10px rgba(255, 215, 0, 0.2);
        }

        .stats-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }

        .panel-hexagon {
            position: relative;
            width: 100%;
            height: 80px;
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.08), rgba(192, 192, 192, 0.05));
            clip-path: polygon(20% 0%, 80% 0%, 100% 50%, 80% 100%, 20% 100%, 0% 50%);
            padding: 15px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            border: 1px solid rgba(255, 215, 0, 0.2);
        }

        .panel-circle {
            position: relative;
            width: 100%;
            height: 80px;
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.08), rgba(192, 192, 192, 0.05));
            border-radius: 40px;
            padding: 15px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            border: 2px solid rgba(255, 215, 0, 0.3);
        }

        .panel-diamond {
            position: relative;
            width: 100%;
            height: 80px;
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.08), rgba(192, 192, 192, 0.05));
            clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
            padding: 15px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            border: 1px solid rgba(255, 215, 0, 0.2);
        }

        .panel-rounded-cut {
            position: relative;
            width: 100%;
            height: 80px;
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.08), rgba(192, 192, 192, 0.05));
            border-radius: 15px;
            padding: 15px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            border: 1px solid rgba(255, 215, 0, 0.2);
            clip-path: polygon(15px 0, calc(100% - 15px) 0, 100% 15px, 100% calc(100% - 15px), calc(100% - 15px) 100%, 15px 100%, 0 calc(100% - 15px), 0 15px);
        }

        .panel-content {
            text-align: center;
            z-index: 1;
        }

        .panel-icon {
            font-size: 18px;
            background: linear-gradient(135deg, #FFD700, #C0C0C0);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 4px;
        }

        .panel-label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 3px;
            font-weight: 500;
        }

        .panel-value {
            font-size: 18px;
            font-weight: 700;
            background: linear-gradient(135deg, #FFD700, #C0C0C0);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .panel-unit {
            font-size: 11px;
            color: #666;
            margin-left: 1px;
        }

        .card-corner {
            position: absolute;
            width: 60px;
            height: 60px;
            border: 2px solid rgba(255, 215, 0, 0.2);
        }

        .corner-tl {
            top: 15px;
            left: 15px;
            border-right: none;
            border-bottom: none;
        }

        .corner-br {
            bottom: 15px;
            right: 15px;
            border-left: none;
            border-top: none;
        }

        .business-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, 
                rgba(192, 192, 192, 0.1) 0%, 
                transparent 30%, 
                transparent 70%, 
                rgba(0, 0, 0, 0.2) 100%);
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="business-card">
        <div class="card-background"></div>
        
        <div class="card-corner corner-tl"></div>
        <div class="card-corner corner-br"></div>
        
        <div class="left-section">
            <div class="profile-image">
                <img src="${user.profilePhotoUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiByeD0iNjAiIGZpbGw9IiMzMzMiLz4KPHN2ZyB4PSIzMCIgeT0iMjAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI4MCI+Cjx0ZXh0IHg9IjMwIiB5PSI0NSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjI0IiBmaWxsPSIjRkZENzAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5qAPC90ZXh0Pgo8L3N2Zz4KPC9zdmc+'}" alt="Photo de profil">
            </div>
            <div class="rank-container">
                <span class="rank-badge">${user.rank}</span>
                <span class="rank-text">${getRankDescription(user.rank)}</span>
            </div>
        </div>
        
        <div class="right-section">
            <h1 class="name">${user.username.toUpperCase()}</h1>
            
            <div class="stats-container">
                <div class="panel-hexagon">
                    <div class="panel-content">
                        <div class="panel-icon">
                            <i class="fas fa-trophy"></i>
                        </div>
                        <div class="panel-label">Meilleur Score</div>
                        <div class="panel-value">${user.bestScore}<span class="panel-unit">WPM</span></div>
                    </div>
                </div>
                
                <div class="panel-circle">
                    <div class="panel-content">
                        <div class="panel-icon">
                            <i class="fas fa-chart-line"></i>
                        </div>
                        <div class="panel-label">Score Moyen</div>
                        <div class="panel-value">${Math.round(user.averageScore)}<span class="panel-unit">WPM</span></div>
                    </div>
                </div>
                
                <div class="panel-diamond">
                    <div class="panel-content">
                        <div class="panel-icon">
                            <i class="fas fa-chart-bar"></i>
                        </div>
                        <div class="panel-label">Score Min</div>
                        <div class="panel-value">${user.minScore}<span class="panel-unit">WPM</span></div>
                    </div>
                </div>
                
                <div class="panel-rounded-cut">
                    <div class="panel-content">
                        <div class="panel-icon">
                            <i class="fas fa-percentage"></i>
                        </div>
                        <div class="panel-label">Fautes Moy.</div>
                        <div class="panel-value">${user.errorRate.toFixed(1)}<span class="panel-unit">%</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;

    // Launch puppeteer with system chromium
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport to match card dimensions
    await page.setViewport({
      width: 700,
      height: 400,
      deviceScaleFactor: 2
    });

    // Set content and wait for images to load
    await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });

    // Take screenshot of the card element
    const cardElement = await page.$('.business-card');
    const screenshot = await cardElement.screenshot({
      type: 'png',
      omitBackground: false
    });

    await browser.close();

    return screenshot;
    
  } catch (error) {
    console.error('Error generating profile card:', error);
    throw error;
  }
}

// Chronometer class
class ChronometerService {
  constructor(ctx) {
    this.ctx = ctx;
    this.startTime = 0;
    this.intervalId = null;
    this.isRunning = false;
    this.messageId = null;
  }

  async start() {
    this.startTime = Date.now();
    this.isRunning = true;

    try {
      // Send initial chronometer message without MarkdownV2
      const message = await this.ctx.reply('⏱️ CHRONOMÈTRE\n\n00:00.000\n\nEn cours...');

      this.messageId = message.message_id;

      // Update chronometer every 100ms
      this.intervalId = setInterval(() => {
        this.updateChronometer();
      }, 100);

      // Auto-stop after 5 minutes for safety
      setTimeout(() => {
        if (this.isRunning) {
          this.stop();
        }
      }, 300000);
    } catch (error) {
      console.error('Error starting chronometer:', error);
    }
  }

  async updateChronometer() {
    if (!this.isRunning || !this.messageId) return;

    const elapsed = Date.now() - this.startTime;
    const seconds = Math.floor(elapsed / 1000);
    const milliseconds = elapsed % 1000;
    
    const timeString = `${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(3, '0')}`;

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHRONOMÈTRE\n\n${timeString}\n\nEn cours...`
      );
    } catch (error) {
      // Ignore edit errors (message too old, etc.)
      if (!error.description?.includes('message is not modified')) {
        console.error('Error updating chronometer:', error);
      }
    }
  }

  stop() {
    if (!this.isRunning) return 0;

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const elapsed = Date.now() - this.startTime;
    const timeSpent = elapsed / 1000; // Convert to seconds

    // Final update
    if (this.messageId) {
      const seconds = Math.floor(elapsed / 1000);
      const milliseconds = elapsed % 1000;
      const timeString = `${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(3, '0')}`;

      this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHRONOMÈTRE\n\n${timeString}\n\nArrêté`
      ).catch(() => {
        // Ignore errors
      });
    }

    return timeSpent;
  }

  isActive() {
    return this.isRunning;
  }
}

// Challenge Mode Chronometer with automatic timeout
class ChallengeChronometerService {
  constructor(ctx, maxTimeSeconds, onTimeout) {
    this.ctx = ctx;
    this.startTime = 0;
    this.intervalId = null;
    this.timeoutId = null;
    this.isRunning = false;
    this.messageId = null;
    this.maxTimeSeconds = maxTimeSeconds + 0.33; // Add tolerance margin
    this.onTimeout = onTimeout;
    this.hasTimedOut = false;
  }

  async start() {
    this.startTime = Date.now();
    this.isRunning = true;
    this.hasTimedOut = false;

    try {
      // Send initial chronometer message
      const message = await this.ctx.reply(`⏱️ CHALLENGE MODE\n\n00:00.000 / ${this.maxTimeSeconds.toFixed(1)}s\n\nEn cours...`);
      this.messageId = message.message_id;

      // Update chronometer every 100ms
      this.intervalId = setInterval(() => {
        this.updateChronometer();
      }, 100);

      // Auto-stop when time limit is reached
      this.timeoutId = setTimeout(() => {
        if (this.isRunning) {
          this.timeout();
        }
      }, this.maxTimeSeconds * 1000);

    } catch (error) {
      console.error('Error starting challenge chronometer:', error);
    }
  }

  async updateChronometer() {
    if (!this.isRunning || !this.messageId) return;

    const elapsed = Date.now() - this.startTime;
    const seconds = (elapsed / 1000).toFixed(1);
    const timeString = `${Math.floor(elapsed / 1000).toString().padStart(2, '0')}:${(elapsed % 1000).toString().padStart(3, '0')}`;

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHALLENGE MODE\n\n${timeString} / ${this.maxTimeSeconds.toFixed(1)}s\n\nEn cours...`
      );
    } catch (error) {
      if (!error.description?.includes('message is not modified')) {
        console.error('Error updating challenge chronometer:', error);
      }
    }
  }

  async timeout() {
    if (!this.isRunning) return;

    this.hasTimedOut = true;
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const elapsed = Date.now() - this.startTime;
    const timeString = `${Math.floor(elapsed / 1000).toString().padStart(2, '0')}:${(elapsed % 1000).toString().padStart(3, '0')}`;

    // Final update showing timeout
    if (this.messageId) {
      this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHALLENGE MODE\n\n${timeString} / ${this.maxTimeSeconds.toFixed(1)}s\n\n⏰ TEMPS ÉCOULÉ !`
      ).catch(() => {});
    }

    // Call timeout callback
    if (this.onTimeout) {
      this.onTimeout();
    }

    return elapsed / 1000;
  }

  stop() {
    if (!this.isRunning) return this.hasTimedOut ? 'timeout' : 0;

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    const elapsed = Date.now() - this.startTime;
    const timeSpent = elapsed / 1000;
    const timeString = `${Math.floor(elapsed / 1000).toString().padStart(2, '0')}:${(elapsed % 1000).toString().padStart(3, '0')}`;

    // Final update
    if (this.messageId) {
      this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHALLENGE MODE\n\n${timeString} / ${this.maxTimeSeconds.toFixed(1)}s\n\nArrêté`
      ).catch(() => {});
    }

    return this.hasTimedOut ? 'timeout' : timeSpent;
  }

  isActive() {
    return this.isRunning;
  }
}

// Bot commands and handlers

console.log('Starting GUN PARK bot...');

// Start command
bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User started bot:', telegramId);
  
  const welcomeText = `⚡ GUN PARK TYPING ACADEMY ⚡

🎯 Bot d'entraînement à la vitesse de frappe
👨‍💻 Créé par @Kageonightray

Améliore tes WPM avec des tests personnalisés et un suivi complet de tes performances !`;

  try {
    await ctx.reply(welcomeText, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer l\'aventure', 'start_setup')],
        [Markup.button.callback('ℹ️ Aide & Instructions', 'help')]
      ])
    );
  } catch (error) {
    console.error('Error sending welcome message:', error);
    await ctx.reply('⚡ GUN PARK TYPING ACADEMY ⚡\n\n🎯 Bot d\'entraînement à la vitesse de frappe\n👨‍💻 Créé par @Kageonightray\n\nAméliore tes WPM avec des tests personnalisés !', 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer l\'aventure', 'start_setup')],
        [Markup.button.callback('ℹ️ Aide & Instructions', 'help')]
      ])
    );
  }
});

// Handle start setup
bot.action('start_setup', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User starting setup:', telegramId);
  
  const existingUser = users.get(telegramId);
  
  if (existingUser) {
    // User already exists, show main menu
    await showMainMenu(ctx, existingUser);
    return;
  }

  userStates.set(telegramId, { step: 'awaiting_photo' });
  
  await ctx.editMessageText('📸 ÉTAPE 1/2 : Photo de profil\n\nEnvoie-moi ta photo de profil pour personnaliser ta carte :', 
    Markup.inlineKeyboard([
      Markup.button.callback('⏭️ Ignorer', 'skip_photo')
    ])
  );
});

// Handle photo upload
bot.on('photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User sent photo:', telegramId);

  const userState = userStates.get(telegramId);
  if (!userState || (userState.step !== 'awaiting_photo' && userState.step !== 'changing_photo')) return;

  try {
    // Get the largest photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    if (userState.step === 'awaiting_photo') {
      // Registration flow
      userStates.set(telegramId, { ...userState, step: 'awaiting_name', photoUrl });
      await saveData();
      await ctx.reply('✏️ ÉTAPE 2/2 : Nom d\'utilisateur\n\nChoisis ton nom d\'utilisateur pour ton profil :');
    } else if (userState.step === 'changing_photo') {
      // Profile editing flow
      await handlePhotoChange(ctx, photoUrl);
    }
  } catch (error) {
    console.error('Error processing photo:', error);
    await ctx.reply('❌ Erreur lors du traitement de la photo. Réessaie ou continue sans photo.', 
      Markup.inlineKeyboard([
        Markup.button.callback('Continuer sans photo', 'skip_photo')
      ])
    );
  }
});

// Handle skip photo
bot.action('skip_photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  const userState = userStates.get(telegramId);
  if (!userState) return;

  userStates.set(telegramId, { ...userState, step: 'awaiting_name', photoUrl: null });
  await ctx.editMessageText('✏️ ÉTAPE 2/2 : Nom d\'utilisateur\n\nChoisis ton nom d\'utilisateur pour ton profil :');
});

// Handle text messages
bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const text = ctx.message.text.toLowerCase().trim();

  const userState = userStates.get(telegramId);

  if (!userState) {
    await ctx.reply('Utilise /start pour commencer !');
    return;
  }

  // Handle special commands during test or challenge
  if ((userState.step === 'in_test' || userState.step === 'challenge_typing') && 
      (text === 'stop' || text === 'restart')) {
    await handleTestControl(ctx, text);
    return;
  }

  if (userState.step === 'awaiting_name') {
    await handleNameInput(ctx, ctx.message.text);
  } else if (userState.step === 'changing_name') {
    await handleNameChange(ctx, ctx.message.text);
  } else if (userState.step === 'in_test') {
    await handleTestResponse(ctx, ctx.message.text);
  } else if (userState.step === 'challenge_typing') {
    await handleChallengeResponse(ctx, ctx.message.text);
  } else if (userState.step === 'challenge_custom_wpm') {
    await handleCustomWPMInput(ctx, ctx.message.text);
  }
});

async function handleNameInput(ctx, username) {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);

  try {
    console.log('Creating user:', telegramId, username);
    
    // Create user
    const user = {
      telegramId,
      username,
      profilePhotoUrl: userState.photoUrl || null,
      rank: "D",
      bestScore: 0,
      averageScore: 0,
      minScore: 0,
      errorRate: 0,
      progression: 0,
      totalTests: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    users.set(telegramId, user);
    userStates.set(telegramId, { step: 'ready' });
    await saveData(); // Save after user creation

    await ctx.reply('🎨 Génération de ta carte de profil en cours...');

    // Generate profile card
    const profileCardBuffer = await generateProfileCard(user);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `🎉 Bienvenue ${user.username} !\n\nTa carte de profil est prête ! Que veux-tu faire maintenant ?`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
          [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
          [Markup.button.callback('📊 Mes statistiques', 'view_stats')],
          [Markup.button.callback('ℹ️ Aide', 'help')]
        ])
      }
    );
  } catch (error) {
    console.error('Error creating user:', error);
    await ctx.reply('❌ Erreur lors de la création du profil. Réessaie avec /start');
  }
}

async function handleNameChange(ctx, newUsername) {
  const telegramId = ctx.from.id.toString();
  
  try {
    const user = users.get(telegramId);
    if (!user) return;
    
    const oldUsername = user.username;
    user.username = newUsername;
    user.updatedAt = new Date();
    users.set(telegramId, user);
    userStates.set(telegramId, { step: 'ready' });
    await saveData();
    
    await ctx.reply(`✅ Nom modifié avec succès !\n\n👤 Ancien nom: ${oldUsername}\n👤 Nouveau nom: ${newUsername}\n\n🎨 Génération de ta nouvelle carte...`);
    
    // Generate updated profile card
    const profileCardBuffer = await generateProfileCard(user);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `🎉 Ta nouvelle carte est prête, ${user.username} !`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Menu principal', 'main_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error changing username:', error);
    await ctx.reply('❌ Erreur lors du changement de nom. Réessaie.');
    userStates.set(telegramId, { step: 'ready' });
    await saveData();
  }
}

async function handlePhotoChange(ctx, newPhotoUrl) {
  const telegramId = ctx.from.id.toString();
  
  try {
    const user = users.get(telegramId);
    if (!user) return;
    
    const oldPhotoUrl = user.profilePhotoUrl;
    user.profilePhotoUrl = newPhotoUrl;
    user.updatedAt = new Date();
    users.set(telegramId, user);
    userStates.set(telegramId, { step: 'ready' });
    await saveData();
    
    await ctx.reply(`✅ Photo modifiée avec succès !\n\n📷 ${oldPhotoUrl ? 'Photo remplacée' : 'Nouvelle photo ajoutée'}\n\n🎨 Génération de ta nouvelle carte...`);
    
    // Generate updated profile card
    const profileCardBuffer = await generateProfileCard(user);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `🎉 Ta nouvelle carte est prête, ${user.username} !`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Menu principal', 'main_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error changing photo:', error);
    await ctx.reply('❌ Erreur lors du changement de photo. Réessaie.');
    userStates.set(telegramId, { step: 'ready' });
    await saveData();
  }
}

async function handleCustomWPMInput(ctx, wpmText) {
  const telegramId = ctx.from.id.toString();
  
  try {
    const wpm = parseInt(wpmText.trim());
    
    if (isNaN(wpm) || wpm < 10 || wpm > 500) {
      await ctx.reply('❌ Valeur invalide. Entre un nombre entre 10 et 500 WPM.');
      return;
    }
    
    let state = userStates.get(telegramId) || {};
    state.challengeWPM = wpm;
    const sentences = state.challengeSentences || 5;
    userStates.set(telegramId, state);
    
    await ctx.reply(`✅ Objectif ${wpm} WPM défini !\n\n📋 Récapitulatif :\n• ${sentences} phrase${sentences > 1 ? 's' : ''}\n• ${wpm} WPM objectif\n\nPrêt pour le défi ?`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer le challenge !', `challenge_start_${sentences}_${wpm}`)],
        [Markup.button.callback('🔙 Modifier paramètres', 'challenge_mode')]
      ])
    );
    
  } catch (error) {
    console.error('Error processing custom WPM:', error);
    await ctx.reply('❌ Erreur. Réessaie avec un nombre valide.');
  }
}

async function showMainMenu(ctx, user) {
  try {
    console.log('Showing main menu for user:', user.telegramId);
    const profileCardBuffer = await generateProfileCard(user);
    
    const menuText = `⚡ Salut ${user.username} ! ⚡\n\n🏆 Rang actuel: ${user.rank} (${getRankDescription(user.rank)})\n🚀 Meilleur score: ${user.bestScore} WPM\n\nQue veux-tu faire aujourd'hui ?`;
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: menuText,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
          [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
          [Markup.button.callback('📊 Mes statistiques', 'view_stats')],
          [Markup.button.callback('✏️ Modifier profil', 'edit_profile'), Markup.button.callback('ℹ️ Aide', 'help')]
        ])
      }
    );
  } catch (error) {
    console.error('Error showing main menu:', error);
    await ctx.reply(`⚡ Salut ${user.username} ! ⚡\n\n🏆 Rang: ${user.rank} (${getRankDescription(user.rank)})\n🚀 Meilleur score: ${user.bestScore} WPM\n\nQue veux-tu faire ?`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
        [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
        [Markup.button.callback('📊 Mes statistiques', 'view_stats')],
        [Markup.button.callback('ℹ️ Aide', 'help')]
      ])
    );
  }
}

async function handleChallengeResponse(ctx, userResponse) {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);
  
  if (!userState || !userState.sessionId) {
    await ctx.reply('❌ Session challenge introuvable. Recommencez.');
    return;
  }
  
  const session = testSessions.get(userState.sessionId);
  if (!session || !session.chronometer) {
    await ctx.reply('❌ Session challenge invalide. Recommencez.');
    return;
  }
  
  try {
    // Stop the chronometer
    const timeResult = session.chronometer.stop();
    
    // Check if it was a timeout
    if (timeResult === 'timeout') {
      return; // Timeout is already handled by the chronometer callback
    }
    
    const timeSpent = timeResult;
    const originalSentence = session.currentSentence;
    
    // Analyze response with AI
    await ctx.reply('🔍 Analyse de votre réponse en cours...');
    const analysis = await analyzeResponse(originalSentence, userResponse, timeSpent);
    
    let wpm = 0;
    let errorRate = analysis.errorRate || 0;
    let success = false;
    
    if (analysis.type === 'valid') {
      wpm = calculateWPM(originalSentence, timeSpent);
      success = timeSpent <= session.expectedTime + 0.33 && errorRate <= 20; // Success criteria: within time and max 20% errors
    } else if (analysis.type === 'invalid_response') {
      errorRate = 100;
      wpm = 0;
    }
    
    // Store result
    session.results.push({
      sentence: originalSentence,
      userResponse,
      timeSpent,
      expectedTime: session.expectedTime,
      wpm,
      errorRate,
      success,
      timeout: false
    });
    
    // Show result
    let resultText = `📊 RÉSULTAT PHRASE ${session.currentSentenceIndex + 1}\n\n`;
    resultText += `⏰ Temps : ${timeSpent.toFixed(1)}s / ${session.expectedTime}s\n`;
    resultText += `🚀 Vitesse : ${wpm} WPM (objectif: ${session.targetWPM})\n`;
    resultText += `🎯 Précision : ${(100 - errorRate).toFixed(1)}%\n\n`;
    
    if (success) {
      resultText += `✅ RÉUSSI ! Phrase validée dans les temps.\n\n`;
    } else {
      if (timeSpent > session.expectedTime + 0.33) {
        resultText += `❌ ÉCHEC : Temps dépassé.\n\n`;
      } else if (errorRate > 20) {
        resultText += `❌ ÉCHEC : Trop d'erreurs (max 20%).\n\n`;
      } else {
        resultText += `❌ ÉCHEC : Vitesse insuffisante.\n\n`;
      }
    }
    
    session.currentSentenceIndex++;
    
    // Check if challenge is complete
    if (session.currentSentenceIndex >= session.sentences) {
      await ctx.reply(resultText);
      await finishChallenge(ctx, session);
    } else {
      resultText += `➡️ Phrase suivante : ${session.currentSentenceIndex + 1}/${session.sentences}`;
      await ctx.reply(resultText, 
        Markup.inlineKeyboard([
          [Markup.button.callback('➡️ Phrase suivante', 'challenge_next_sentence')],
          [Markup.button.callback('⏹️ Arrêter', 'stop_challenge')]
        ])
      );
      
      // Update state
      userStates.set(telegramId, {
        ...userState,
        step: 'challenge_waiting_next'
      });
    }
    
  } catch (error) {
    console.error('Error handling challenge response:', error);
    await ctx.reply('❌ Erreur lors de l\'analyse. Réessayez.');
  }
}

bot.action('challenge_next_sentence', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const state = userStates.get(telegramId);
  
  if (!state || !state.sessionId) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  const session = testSessions.get(state.sessionId);
  if (!session) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  await startChallengeSentence(ctx, session);
});

// Handle speed test
bot.action('speed_test', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User starting speed test:', telegramId);

  // Immediate acknowledgment for responsiveness
  try {
    await ctx.answerCbQuery('🚀 Lancement du test...');
  } catch (error) {
    console.log('Failed to answer callback query:', error);
  }

  try {
    await ctx.editMessageText('⚡ PRÉPARATION DU TEST ⚡\n\n🔄 Génération de phrases aléatoires par IA...\n⏱️ Configuration du chronométre...');
  } catch (error) {
    // If edit fails, send new message
    await ctx.reply('⚡ PRÉPARATION DU TEST ⚡\n\n🔄 Génération de phrases aléatoires par IA...\n⏱️ Configuration du chronométre...');
  }

  try {
    const user = users.get(telegramId);
    if (!user) return;

    // Generate sentences
    const sentences = await generateSentences();
    console.log('Generated sentences count:', sentences.length);
    
    // Determine number of sentences based on user's test count
    const sentenceCount = user.totalTests === 0 ? 1 : 5;
    const selectedSentences = sentences.slice(0, sentenceCount);

    // Create test session
    const sessionId = Date.now().toString();
    const session = {
      id: sessionId,
      userId: telegramId,
      telegramId,
      type: 'speed_test',
      sentences: selectedSentences,
      totalSentences: sentenceCount,
      currentSentenceIndex: 0,
      startTime: new Date(),
      status: 'pending',
      results: null,
      testResults: [],
      createdAt: new Date()
    };

    testSessions.set(sessionId, session);
    userStates.set(telegramId, { step: 'in_test', currentSession: sessionId });
    await saveData(); // Save after state change

    // Start the test
    await startTestSentence(ctx, session, selectedSentences[0]);
    
  } catch (error) {
    console.error('Error starting speed test:', error);
    await ctx.reply('❌ Erreur lors de la préparation du test. Réessaie.');
  }
});

async function startTestSentence(ctx, session, sentence) {
  const telegramId = ctx.from.id.toString();
  console.log('Starting test sentence for user:', telegramId);

  try {
    // Update session to in_progress
    session.status = 'in_progress';
    session.startTime = new Date();
    testSessions.set(session.id, session);

    const currentSentence = session.currentSentenceIndex + 1;
    const totalSentences = session.totalSentences;
    
    const testText = `⚡ TEST EN COURS ⚡\n\n📝 Phrase ${currentSentence}/${totalSentences} :\n\n"${sentence}"\n\n⌨️ Recopie cette phrase le plus vite et précisément possible !\n\n💡 Tape "stop" pour arrêter ou "restart" pour recommencer`;

    await ctx.reply(testText);

    // Start chronometer with 0.5 second delay
    const chronometer = new ChronometerService(ctx);
    const userState = userStates.get(telegramId);
    if (userState) {
      userState.chronometer = chronometer;
      userStates.set(telegramId, userState);
    }
    
    // Wait 0.5 seconds before starting the chronometer
    setTimeout(async () => {
      await chronometer.start();
      await saveData(); // Save after state change
    }, 500);
  } catch (error) {
    console.error('Error starting test sentence:', error);
    await ctx.reply(`📝 Phrase à recopier :\n\n"${sentence}"\n\nRecopie cette phrase le plus vite possible avec le moins de fautes !`);
  }
}

async function handleTestResponse(ctx, userResponse) {
  const telegramId = ctx.from.id.toString();
  console.log('User test response:', telegramId, userResponse.substring(0, 50) + '...');

  const userState = userStates.get(telegramId);
  if (!userState?.currentSession || !userState.chronometer) return;

  // Stop chronometer
  const timeSpent = userState.chronometer.stop();
  console.log('Test time spent:', timeSpent);
  
  try {
    const session = testSessions.get(userState.currentSession);
    if (!session || !session.sentences) return;

    const currentSentence = session.sentences[session.currentSentenceIndex];
    
    // Analyze response with AI
    const analysis = await analyzeResponse(
      currentSentence,
      userResponse,
      timeSpent
    );
    console.log('Analysis result:', analysis);

    if (analysis.type === 'invalid_response') {
      await ctx.reply('❌ Tu n\'as pas recopié la phrase correctement. Veux-tu recommencer ?', 
        Markup.inlineKeyboard([
          Markup.button.callback('🔄 Recommencer', 'restart_sentence'),
          Markup.button.callback('❌ Arrêter', 'stop_test')
        ])
      );
      return;
    }

    // Calculate WPM
    const wpm = calculateWPM(currentSentence, timeSpent);
    console.log('Calculated WPM:', wpm);
    
    // Save test result (in memory)
    const user = users.get(telegramId);
    if (!user) return;

    const testResult = {
      sessionId: session.id,
      userId: telegramId,
      sentence: currentSentence,
      userResponse,
      wpm,
      errorRate: analysis.errorRate,
      timeSpent,
      createdAt: new Date()
    };

    // Store result in session
    session.testResults.push(testResult);

    // Check if more sentences
    const nextIndex = session.currentSentenceIndex + 1;
    const sentences = session.sentences;
    
    if (nextIndex < sentences.length) {
      // Ask if ready for next sentence
      await ctx.reply(`✅ Phrase ${nextIndex}/${sentences.length} terminée !\n\n⏱️ Temps: ${timeSpent.toFixed(3)}s\n🚀 Vitesse: ${wpm} WPM\n❌ Fautes: ${analysis.errorRate.toFixed(1)}%\n\n🎯 Es-tu prêt pour la phrase suivante ?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('▶️ Phrase suivante', 'next_sentence')],
          [Markup.button.callback('📊 Voir les résultats finaux', 'finish_test')]
        ])
      );
      
      session.currentSentenceIndex = nextIndex;
      testSessions.set(session.id, session);
    } else {
      // Test completed
      await finishTest(ctx, session);
    }

  } catch (error) {
    console.error('Error processing test response:', error);
    await ctx.reply('❌ Erreur lors de l\'analyse. Réessaie.');
  }
}

// Handle next sentence
bot.action('next_sentence', async (ctx) => {
  const telegramId = ctx.from.id.toString();

  const userState = userStates.get(telegramId);
  if (!userState?.currentSession) return;

  const session = testSessions.get(userState.currentSession);
  if (!session || !session.sentences) return;

  const sentences = session.sentences;
  const currentSentence = sentences[session.currentSentenceIndex];

  await startTestSentence(ctx, session, currentSentence);
});

// Handle finish test
bot.action('finish_test', async (ctx) => {
  const telegramId = ctx.from.id.toString();

  const userState = userStates.get(telegramId);
  if (!userState?.currentSession) return;

  const session = testSessions.get(userState.currentSession);
  if (!session) return;

  await finishTest(ctx, session);
});

async function finishTest(ctx, session) {
  const telegramId = ctx.from.id.toString();
  console.log('Finishing test for user:', telegramId);

  try {
    // Get all test results for this session
    const results = session.testResults || [];
    
    if (results.length === 0) return;

    // Calculate averages
    const avgWpm = Math.round(results.reduce((sum, r) => sum + r.wpm, 0) / results.length);
    const avgErrorRate = results.reduce((sum, r) => sum + r.errorRate, 0) / results.length;
    const totalTime = results.reduce((sum, r) => sum + r.timeSpent, 0);

    console.log('Test results:', { avgWpm, avgErrorRate, totalTime });

    // Update user stats
    const user = users.get(telegramId);
    if (!user) return;

    const newBestScore = Math.max(user.bestScore, Math.max(...results.map(r => r.wpm)));
    const newMinScore = user.totalTests === 0 ? avgWpm : Math.min(user.minScore, Math.min(...results.map(r => r.wpm)));
    const newTotalTests = user.totalTests + 1;
    const newAverageScore = ((user.averageScore * user.totalTests) + avgWpm) / newTotalTests;
    const newErrorRate = ((user.errorRate * user.totalTests) + avgErrorRate) / newTotalTests;
    const newRank = getRankFromWPM(newAverageScore);
    const newProgression = user.totalTests > 0 ? ((newAverageScore - user.averageScore) / user.averageScore * 100) : 0;

    user.bestScore = newBestScore;
    user.minScore = newMinScore;
    user.averageScore = newAverageScore;
    user.errorRate = newErrorRate;
    user.rank = newRank;
    user.progression = newProgression;
    user.totalTests = newTotalTests;
    user.updatedAt = new Date();

    users.set(telegramId, user);
    console.log('Updated user stats:', { newRank, newAverageScore, newBestScore });

    // Mark session as completed
    session.status = 'completed';
    session.results = {
      avgWpm,
      avgErrorRate,
      totalTime,
      results: results.map(r => ({
        wpm: r.wpm,
        errorRate: r.errorRate,
        timeSpent: r.timeSpent
      }))
    };
    testSessions.set(session.id, session);
    
    // Save all data after test completion
    await saveData();

    // Send results with progression indicator
    const progressionText = newProgression > 0 ? `📈 Progression: +${newProgression.toFixed(1)}%` : 
                           newProgression < 0 ? `📉 Progression: ${newProgression.toFixed(1)}%` : 
                           '📊 Première évaluation terminée';

    const resultsText = `🎉 TEST TERMINÉ ! 🎉\n\n📊 Résultats :\n⏱️ Temps total: ${totalTime.toFixed(3)}s\n🚀 Vitesse moyenne: ${avgWpm} WPM\n❌ Taux de fautes: ${avgErrorRate.toFixed(1)}%\n🏆 Rang: ${newRank} (${getRankDescription(newRank)})\n${progressionText}`;

    await ctx.reply(resultsText, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refaire un test', 'speed_test')],
        [Markup.button.callback('📊 Voir ma carte', 'view_stats')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );

    // Clear user state
    userStates.set(telegramId, { step: 'ready' });

  } catch (error) {
    console.error('Error finishing test:', error);
    await ctx.reply('❌ Erreur lors du calcul des résultats.');
  }
}

async function handleTestControl(ctx, command) {
  const telegramId = ctx.from.id.toString();
  console.log('Test control command:', telegramId, command);

  const userState = userStates.get(telegramId);
  
  if (command === 'stop') {
    // Stop any running chronometer
    if (userState?.chronometer && userState.chronometer.isActive()) {
      userState.chronometer.stop();
    }
    
    // Stop challenge chronometer if exists
    if (userState?.sessionId) {
      const session = testSessions.get(userState.sessionId);
      if (session?.chronometer && session.chronometer.isActive()) {
        session.chronometer.stop();
      }
    }
    
    userStates.set(telegramId, { step: 'ready' });
    await ctx.reply('⏹️ Test/Challenge arrêté.', 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Nouveau test', 'speed_test')],
        [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
        [Markup.button.callback('📊 Voir mes stats', 'view_stats')]
      ])
    );
    
  } else if (command === 'restart') {
    // Stop any running chronometer first
    if (userState?.chronometer && userState.chronometer.isActive()) {
      userState.chronometer.stop();
    }
    
    // Handle speed test restart
    if (userState?.step === 'in_test' && userState.currentSession) {
      const session = testSessions.get(userState.currentSession);
      if (session && session.sentences) {
        const sentences = session.sentences;
        const currentSentence = sentences[session.currentSentenceIndex];
        await startTestSentence(ctx, session, currentSentence);
      }
    } 
    // Handle challenge restart
    else if (userState?.step === 'challenge_typing' && userState.sessionId) {
      const session = testSessions.get(userState.sessionId);
      if (session?.chronometer && session.chronometer.isActive()) {
        session.chronometer.stop();
      }
      
      await ctx.reply(`🔄 Recommence la phrase actuelle !\n\n"${session.currentSentence}"\n\nÊtes-vous prêt ?`, 
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Je suis prêt !', 'challenge_ready')],
          [Markup.button.callback('⏹️ Arrêter', 'stop_challenge')]
        ])
      );
    }
  }
}

// Handle view stats
bot.action('view_stats', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User viewing stats:', telegramId);

  // Immediate acknowledgment for responsiveness
  try {
    await ctx.answerCbQuery('📊 Chargement des statistiques...');
  } catch (error) {
    console.log('Failed to answer callback query:', error);
  }

  try {
    const user = users.get(telegramId);
    if (!user) return;

    const profileCardBuffer = await generateProfileCard(user);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `📊 Tes statistiques actuelles, ${user.username} !`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
          [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
          [Markup.button.callback('🏠 Menu principal', 'main_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error showing stats:', error);
    await ctx.reply('❌ Erreur lors de l\'affichage des statistiques.');
  }
});

// Help command
bot.action('help', async (ctx) => {
  const helpText = `ℹ️ AIDE - GUN PARK TYPING ACADEMY

🎯 Comment ça marche :
• Tests de frappe avec phrases aléatoires générées par IA
• Chronométrage précis au milliseconde près
• Analyse automatique de tes fautes par IA

📊 Système de rang :
• D : 0-15 WPM (Débutant)
• C : 16-30 WPM (Apprenti) 
• B : 31-45 WPM (Intermédiaire)
• A : 46-60 WPM (Utilisateur Avancé)
• S : 61-74 WPM (Expert Confirmé)
• S+ : 75+ WPM (Maître Absolu)

⌨️ Pendant un test :
• Tape "stop" pour arrêter
• Tape "restart" pour recommencer

💡 Astuce : Plus tu t'entraînes, plus tu progresses !`;

  try {
    await ctx.editMessageText(helpText, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer un test', 'speed_test')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );
  } catch (error) {
    await ctx.reply(helpText, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer un test', 'speed_test')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );
  }
});

// Challenge mode (simplified implementation)


// Edit profile handler
bot.action('edit_profile', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User editing profile:', telegramId);

  // Immediate acknowledgment for responsiveness
  try {
    await ctx.answerCbQuery('✏️ Chargement des options...');
  } catch (error) {
    console.log('Failed to answer callback query:', error);
  }

  try {
    const user = users.get(telegramId);
    if (!user) return;

    await ctx.editMessageText(
      `✏️ MODIFIER TON PROFIL ✏️\n\n👤 Nom actuel: ${user.username}\n📷 Photo de profil: ${user.profilePhotoUrl ? 'Définie' : 'Aucune'}\n\n🚫 Note: Les statistiques (rang, scores, tests) ne peuvent pas être modifiées manuellement.\n\nQue veux-tu modifier ?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Changer le nom', 'change_name')],
        [Markup.button.callback('📷 Changer la photo', 'change_photo')],
        [Markup.button.callback('🏠 Retour au menu', 'main_menu')]
      ])
    );
  } catch (error) {
    await ctx.reply(
      `✏️ MODIFIER TON PROFIL ✏️\n\n👤 Nom actuel: ${user.username}\n📷 Photo de profil: ${user.profilePhotoUrl ? 'Définie' : 'Aucune'}\n\n🚫 Note: Les statistiques (rang, scores, tests) ne peuvent pas être modifiées manuellement.\n\nQue veux-tu modifier ?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Changer le nom', 'change_name')],
        [Markup.button.callback('📷 Changer la photo', 'change_photo')],
        [Markup.button.callback('🏠 Retour au menu', 'main_menu')]
      ])
    );
  }
});

// Change name handler
bot.action('change_name', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    await ctx.editMessageText('📝 CHANGER TON NOM\n\n✍️ Écris ton nouveau nom d\'utilisateur :');
    userStates.set(telegramId, { step: 'changing_name' });
    await saveData();
  } catch (error) {
    await ctx.reply('📝 CHANGER TON NOM\n\n✍️ Écris ton nouveau nom d\'utilisateur :');
    userStates.set(telegramId, { step: 'changing_name' });
    await saveData();
  }
});

// Change photo handler
bot.action('change_photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    await ctx.editMessageText('📷 CHANGER TA PHOTO\n\n📤 Envoie ta nouvelle photo de profil :');
    userStates.set(telegramId, { step: 'changing_photo' });
    await saveData();
  } catch (error) {
    await ctx.reply('📷 CHANGER TA PHOTO\n\n📤 Envoie ta nouvelle photo de profil :');
    userStates.set(telegramId, { step: 'changing_photo' });
    await saveData();
  }
});

bot.action('main_menu', async (ctx) => {
  const telegramId = ctx.from.id.toString();

  const user = users.get(telegramId);
  if (user) {
    await showMainMenu(ctx, user);
  }
});

bot.action('refresh_card', async (ctx) => {
  const telegramId = ctx.from.id.toString();

  const user = users.get(telegramId);
  if (user) {
    await ctx.reply('🔄 Régénération de ta carte en cours...');
    await showMainMenu(ctx, user);
  }
});

// Restart sentence action
bot.action('restart_sentence', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  const userState = userStates.get(telegramId);
  if (!userState?.currentSession) return;

  const session = testSessions.get(userState.currentSession);
  if (!session || !session.sentences) return;

  const sentences = session.sentences;
  const currentSentence = sentences[session.currentSentenceIndex];
  
  await startTestSentence(ctx, session, currentSentence);
});

// Stop test action
bot.action('stop_test', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  userStates.set(telegramId, { step: 'ready' });
  await ctx.reply('⏹️ Test arrêté.', 
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Nouveau test', 'speed_test')],
      [Markup.button.callback('📊 Voir mes stats', 'view_stats')]
    ])
  );
});

// Challenge Mode handlers
bot.action('challenge_mode', async (ctx) => {
  await ctx.answerCbQuery();
  
  const challengeText = `⚡ MODE CHALLENGE ⚡

🎯 Configure ton défi personnalisé :

1️⃣ Choisis le nombre de phrases
2️⃣ Définis ton objectif WPM  
3️⃣ Dépasse-toi !

📋 Paramètres par défaut :
• 5 phrases
• 30 WPM objectif`;

  await ctx.reply(challengeText, 
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Nombre de phrases', 'challenge_sentences')],
      [Markup.button.callback('🎯 Objectif WPM', 'challenge_wpm')],
      [Markup.button.callback('🚀 Commencer (défaut)', 'challenge_start_5_30')],
      [Markup.button.callback('🔙 Retour', 'main_menu')]
    ])
  );
});

bot.action('challenge_sentences', async (ctx) => {
  await ctx.answerCbQuery();
  
  await ctx.reply('📝 Choisis le nombre de phrases pour ton challenge :', 
    Markup.inlineKeyboard([
      [Markup.button.callback('1 phrase', 'challenge_set_sentences_1'), Markup.button.callback('3 phrases', 'challenge_set_sentences_3')],
      [Markup.button.callback('5 phrases', 'challenge_set_sentences_5'), Markup.button.callback('7 phrases', 'challenge_set_sentences_7')],
      [Markup.button.callback('10 phrases', 'challenge_set_sentences_10'), Markup.button.callback('15 phrases', 'challenge_set_sentences_15')],
      [Markup.button.callback('🔙 Retour', 'challenge_mode')]
    ])
  );
});

bot.action('challenge_wpm', async (ctx) => {
  await ctx.answerCbQuery();
  
  await ctx.reply('🎯 Choisis ton objectif WPM :', 
    Markup.inlineKeyboard([
      [Markup.button.callback('15 WPM', 'challenge_set_wpm_15'), Markup.button.callback('20 WPM', 'challenge_set_wpm_20')],
      [Markup.button.callback('25 WPM', 'challenge_set_wpm_25'), Markup.button.callback('30 WPM', 'challenge_set_wpm_30')],
      [Markup.button.callback('40 WPM', 'challenge_set_wpm_40'), Markup.button.callback('50 WPM', 'challenge_set_wpm_50')],
      [Markup.button.callback('60 WPM', 'challenge_set_wpm_60'), Markup.button.callback('75 WPM', 'challenge_set_wpm_75')],
      [Markup.button.callback('100 WPM', 'challenge_set_wpm_100'), Markup.button.callback('✏️ Personnalisé', 'challenge_custom_wpm')],
      [Markup.button.callback('🔙 Retour', 'challenge_mode')]
    ])
  );
});

// Challenge settings handlers
for (let sentences of [1, 3, 5, 7, 10, 15]) {
  bot.action(`challenge_set_sentences_${sentences}`, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    
    let state = userStates.get(telegramId) || {};
    state.challengeSentences = sentences;
    userStates.set(telegramId, state);
    
    await ctx.reply(`✅ ${sentences} phrase${sentences > 1 ? 's' : ''} sélectionnée${sentences > 1 ? 's' : ''}.\n\nMaintenant choisis ton objectif WPM :`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('15 WPM', 'challenge_set_wpm_15'), Markup.button.callback('20 WPM', 'challenge_set_wpm_20')],
        [Markup.button.callback('25 WPM', 'challenge_set_wpm_25'), Markup.button.callback('30 WPM', 'challenge_set_wpm_30')],
        [Markup.button.callback('40 WPM', 'challenge_set_wpm_40'), Markup.button.callback('50 WPM', 'challenge_set_wpm_50')],
        [Markup.button.callback('60 WPM', 'challenge_set_wpm_60'), Markup.button.callback('75 WPM', 'challenge_set_wpm_75')],
        [Markup.button.callback('100 WPM', 'challenge_set_wpm_100'), Markup.button.callback('✏️ Personnalisé', 'challenge_custom_wpm')]
      ])
    );
  });
}

for (let wpm of [15, 20, 25, 30, 40, 50, 60, 75, 100]) {
  bot.action(`challenge_set_wpm_${wpm}`, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id.toString();
    
    let state = userStates.get(telegramId) || {};
    state.challengeWPM = wpm;
    const sentences = state.challengeSentences || 5;
    userStates.set(telegramId, state);
    
    await ctx.reply(`✅ Objectif ${wpm} WPM défini !\n\n📋 Récapitulatif :\n• ${sentences} phrase${sentences > 1 ? 's' : ''}\n• ${wpm} WPM objectif\n\nPrêt pour le défi ?`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Commencer le challenge !', `challenge_start_${sentences}_${wpm}`)],
        [Markup.button.callback('🔙 Modifier paramètres', 'challenge_mode')]
      ])
    );
  });
}

// Custom WPM handler
bot.action('challenge_custom_wpm', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  
  userStates.set(telegramId, { step: 'challenge_custom_wpm' });
  
  await ctx.reply('✏️ Tape ton objectif WPM personnalisé :\n\n(Entre 10 et 500 WPM)', 
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Retour', 'challenge_wpm')]
    ])
  );
});

// Challenge start handlers
bot.action(/challenge_start_(\d+)_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  
  const sentences = parseInt(ctx.match[1]);
  const targetWPM = parseInt(ctx.match[2]);
  
  // Initialize challenge session
  const sessionId = `challenge_${Date.now()}_${telegramId}`;
  const challengeSession = {
    sessionId,
    telegramId,
    type: 'challenge',
    sentences,
    targetWPM,
    currentSentenceIndex: 0,
    results: [],
    startTime: new Date(),
    createdAt: new Date()
  };
  
  testSessions.set(sessionId, challengeSession);
  userStates.set(telegramId, { 
    step: 'challenge_active', 
    sessionId,
    challengeSentences: sentences,
    challengeWPM: targetWPM
  });
  
  await ctx.reply(`⚡ CHALLENGE MODE ACTIVÉ ⚡\n\n🎯 Objectif : ${targetWPM} WPM\n📝 ${sentences} phrase${sentences > 1 ? 's' : ''} à taper\n\n🔄 Génération des phrases...`);
  
  // Start first sentence
  await startChallengeSentence(ctx, challengeSession);
});

async function startChallengeSentence(ctx, session) {
  try {
    // Generate sentences
    const allSentences = await generateSentences();
    
    // Select random sentence
    const randomIndex = Math.floor(Math.random() * allSentences.length);
    const selectedSentence = allSentences[randomIndex];
    
    // Store sentence in session
    session.currentSentence = selectedSentence;
    
    // Calculate expected time with AI
    await ctx.reply('⏳ Calcul du temps attendu...');
    const expectedTime = await calculateExpectedTime(selectedSentence, session.targetWPM);
    
    session.expectedTime = expectedTime;
    
    const sentenceNum = session.currentSentenceIndex + 1;
    const totalSentences = session.sentences;
    
    await ctx.reply(`📝 PHRASE ${sentenceNum}/${totalSentences}\n\n🎯 Objectif : ${session.targetWPM} WPM\n⏰ Temps alloué : ${expectedTime}s\n\nÊtes-vous prêt ? (La phrase s'affichera après validation)`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Je suis prêt !', 'challenge_ready')],
        [Markup.button.callback('⏹️ Arrêter', 'stop_challenge')]
      ])
    );
    
  } catch (error) {
    console.error('Error starting challenge sentence:', error);
    await ctx.reply('❌ Erreur lors de la génération. Réessayez.');
  }
}

bot.action('challenge_ready', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const state = userStates.get(telegramId);
  
  if (!state || !state.sessionId) {
    await ctx.reply('❌ Session introuvable. Recommencez.');
    return;
  }
  
  const session = testSessions.get(state.sessionId);
  if (!session) {
    await ctx.reply('❌ Session introuvable. Recommencez.');
    return;
  }
  
  await ctx.reply(`🚀 Voici votre phrase à taper :\n\n"${session.currentSentence}"\n\nLe chronomètre démarre dans 0.5 seconde !`);
  
  // Start chronometer with timeout callback
  setTimeout(() => {
    const chronometer = new ChallengeChronometerService(ctx, session.expectedTime, async () => {
      // Timeout callback
      await ctx.reply('⏰ TEMPS ÉCOULÉ !\n\n❌ Vous avez dépassé le temps alloué.', 
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Réessayer', 'challenge_retry')],
          [Markup.button.callback('➡️ Continuer', 'challenge_next_timeout')],
          [Markup.button.callback('⏹️ Arrêter', 'stop_challenge')]
        ])
      );
      
      // Store timeout state
      userStates.set(telegramId, { 
        ...state, 
        step: 'challenge_timeout',
        lastResult: 'timeout'
      });
    });
    
    session.chronometer = chronometer;
    chronometer.start();
    
    userStates.set(telegramId, { 
      ...state, 
      step: 'challenge_typing'
    });
  }, 500);
});

bot.action('challenge_retry', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const state = userStates.get(telegramId);
  
  if (!state || !state.sessionId) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  const session = testSessions.get(state.sessionId);
  if (!session) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  await ctx.reply(`🔄 Nouvelle tentative !\n\n"${session.currentSentence}"\n\nÊtes-vous prêt ?`, 
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Je suis prêt !', 'challenge_ready')],
      [Markup.button.callback('⏹️ Arrêter', 'stop_challenge')]
    ])
  );
});

bot.action('challenge_next_timeout', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const state = userStates.get(telegramId);
  
  if (!state || !state.sessionId) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  const session = testSessions.get(state.sessionId);
  if (!session) {
    await ctx.reply('❌ Session introuvable.');
    return;
  }
  
  // Record timeout result
  session.results.push({
    sentence: session.currentSentence,
    userResponse: '',
    timeSpent: session.expectedTime + 0.33,
    expectedTime: session.expectedTime,
    wpm: 0,
    errorRate: 100,
    success: false,
    timeout: true
  });
  
  session.currentSentenceIndex++;
  
  // Check if challenge is complete
  if (session.currentSentenceIndex >= session.sentences) {
    await finishChallenge(ctx, session);
  } else {
    await startChallengeSentence(ctx, session);
  }
});

bot.action('stop_challenge', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  
  userStates.set(telegramId, { step: 'ready' });
  
  await ctx.reply('⏹️ Challenge arrêté.', 
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ Nouveau challenge', 'challenge_mode')],
      [Markup.button.callback('🔙 Menu principal', 'main_menu')]
    ])
  );
});

async function finishChallenge(ctx, session) {
  const telegramId = session.telegramId;
  
  // Calculate challenge statistics
  const totalSentences = session.results.length;
  const successfulSentences = session.results.filter(r => r.success).length;
  const averageWPM = session.results.length > 0 ? 
    Math.round(session.results.reduce((sum, r) => sum + (r.wpm || 0), 0) / session.results.length) : 0;
  const averageErrorRate = session.results.length > 0 ? 
    Math.round(session.results.reduce((sum, r) => sum + r.errorRate, 0) / session.results.length) : 0;
  
  const challengeSuccess = averageWPM >= session.targetWPM;
  
  let resultText = `🏁 CHALLENGE TERMINÉ !\n\n`;
  resultText += `🎯 Objectif : ${session.targetWPM} WPM\n`;
  resultText += `📊 Résultat : ${averageWPM} WPM\n\n`;
  resultText += `✅ Phrases réussies : ${successfulSentences}/${totalSentences}\n`;
  resultText += `🎯 Précision moyenne : ${100 - averageErrorRate}%\n`;
  resultText += `⏰ Taux de réussite temporelle : ${Math.round((successfulSentences / totalSentences) * 100)}%\n\n`;
  
  if (challengeSuccess) {
    resultText += `🎊 OBJECTIF ATTEINT ! 🎊\n\nFélicitations ! Tu as réussi ton challenge !`;
  } else {
    resultText += `💪 OBJECTIF NON ATTEINT\n\nContinue à t'entraîner pour progresser !`;
  }
  
  await ctx.reply(resultText, 
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ Nouveau challenge', 'challenge_mode')],
      [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
      [Markup.button.callback('🔙 Menu principal', 'main_menu')]
    ])
  );
  
  // Update user stats if this was a good performance
  if (challengeSuccess && averageWPM > 0) {
    const user = users.get(telegramId);
    if (user && averageWPM > user.bestScore) {
      user.bestScore = averageWPM;
      user.rank = getRankFromWPM(averageWPM);
      user.updatedAt = new Date();
      users.set(telegramId, user);
    }
  }
  
  // Clean up
  userStates.set(telegramId, { step: 'ready' });
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Telegram bot error:', err);
  try {
    ctx.reply('❌ Une erreur est survenue. Réessaie avec /start');
  } catch (replyError) {
    console.error('Error sending error message:', replyError);
  }
});

// Load existing data and start the bot
(async () => {
  try {
    await loadData();
    await bot.launch();
    console.log('GUN PARK bot is running!');
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
})();

// Enable graceful stop with data saving
process.once('SIGINT', async () => {
  console.log('Received SIGINT, saving data and shutting down...');
  await saveData();
  bot.stop('SIGINT');
});
process.once('SIGTERM', async () => {
  console.log('Received SIGTERM, saving data and shutting down...');
  await saveData();
  bot.stop('SIGTERM');
});
