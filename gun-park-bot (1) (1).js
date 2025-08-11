
import { Telegraf, Markup } from 'telegraf';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const BOT_TOKEN = '7324266903:AAHifYM9GXHoFS6sVSZrsRxwOoEENOOxw98';
const COMET_API_KEY = 'sk-PjyB8KrbRq4rL0gNxAJagCNW7nJoqVW9mnCmFq7soQ5LIkjP';
const COMET_BASE_URL = 'https://api.cometapi.com/v1';

// HTMLCSStoImage API Configuration with rotation
const API_CREDENTIALS = [
  {
    userId: 'eed5798f-9c3d-48b5-9410-51dc9c2d2877',
    apiKey: 'cc48adec-15bb-4a8a-9ca4-170b3605df96'
  },
  {
    userId: 'e84ad231-97cd-4161-9e2c-af89b5330887',
    apiKey: 'b9a71775-e010-4399-9b9c-014b2c4832a7'
  },
  {
    userId: '8a8b4b94-44ae-4e6c-bb21-da065e2ec0f3',
    apiKey: '22ec3a2f-4d6e-43f4-87ee-2c1058ff6bde'
  },
  {
    userId: '6f27826a-74eb-4e35-97e9-4ba63e6aa315',
    apiKey: 'bda89df6-a6d3-4daf-b3a0-0b72c4d31189'
  }
];

let currentCredentialIndex = 0;

// Function to make HTMLCSStoImage API request with credential rotation
async function makeImageRequest(htmlContent, ctx = null) {
  let attempts = 0;
  const maxAttempts = API_CREDENTIALS.length;
  
  while (attempts < maxAttempts) {
    const credentials = API_CREDENTIALS[currentCredentialIndex];
    
    try {
      console.log(`Attempting image generation with credential set ${currentCredentialIndex + 1}/${API_CREDENTIALS.length}`);
      
      const response = await fetch('https://hcti.io/v1/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${credentials.userId}:${credentials.apiKey}`).toString('base64')
        },
        body: JSON.stringify({
          html: htmlContent,
          viewport_width: 700,
          viewport_height: 400,
          device_scale: 2,
          selector: '.business-card'
        })
      });

      if (response.ok) {
        const imageData = await response.json();
        console.log(`Image generation successful with credential set ${currentCredentialIndex + 1}`);
        return imageData;
      }

      // Check if it's a quota/limit error
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429 || (errorData.message && errorData.message.includes('limit'))) {
        console.log(`Credential set ${currentCredentialIndex + 1} quota exceeded, rotating to next`);
        if (ctx) {
          await ctx.reply('⏳ Génération en cours, veuillez patienter quelques secondes...');
        }
        
        // Rotate to next credential
        currentCredentialIndex = (currentCredentialIndex + 1) % API_CREDENTIALS.length;
        attempts++;
        continue;
      }

      // Other API errors
      throw new Error(`API error ${response.status}: ${errorData.message || response.statusText}`);
      
    } catch (error) {
      console.log(`Error with credential set ${currentCredentialIndex + 1}:`, error.message);
      
      if (ctx && attempts === 0) {
        await ctx.reply('⏳ Un petit problème technique, je réessaie avec un autre serveur...');
      }
      
      // Rotate to next credential
      currentCredentialIndex = (currentCredentialIndex + 1) % API_CREDENTIALS.length;
      attempts++;
      
      // If it's the last attempt, throw the error
      if (attempts >= maxAttempts) {
        throw error;
      }
      
      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error('All API credentials exhausted');
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// In-memory storage for user data and test sessions
const users = new Map();
const testSessions = new Map();
const userStates = new Map();

// Data persistence functions
async function ensureDataDir() {
  try {
    await fs.access('data');
  } catch {
    await fs.mkdir('data', { recursive: true });
  }
}

async function loadUsers() {
  try {
    await ensureDataDir();
    const data = await fs.readFile('data/users.json', 'utf8');
    const userData = JSON.parse(data);
    for (const [key, value] of Object.entries(userData)) {
      users.set(key, value);
    }
  } catch (error) {
    console.log('No existing user data found, starting fresh');
  }
}

async function saveUsers() {
  try {
    await ensureDataDir();
    const userData = Object.fromEntries(users);
    await fs.writeFile('data/users.json', JSON.stringify(userData, null, 2));
  } catch (error) {
    console.error('Error saving user data:', error);
  }
}

// Image cache management
async function ensureImagesDir() {
  try {
    await fs.access('data/images');
  } catch {
    await fs.mkdir('data/images', { recursive: true });
  }
}

async function loadCards() {
  try {
    await ensureDataDir();
    const data = await fs.readFile('data/cards.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveCards(cardsData) {
  try {
    await ensureDataDir();
    await fs.writeFile('data/cards.json', JSON.stringify(cardsData, null, 2));
  } catch (error) {
    console.error('Error saving cards data:', error);
  }
}

// Generate a hash from user data to detect changes
function generateUserHash(user) {
  const hashData = {
    username: user.username,
    rank: user.rank,
    bestScore: user.bestScore,
    averageScore: user.averageScore,
    minScore: user.minScore,
    errorRate: user.errorRate,
    profilePhotoUrl: user.profilePhotoUrl || ''
  };
  return Buffer.from(JSON.stringify(hashData)).toString('base64').replace(/[/+=]/g, '');
}

async function getCachedImage(userId, userHash) {
  try {
    await ensureImagesDir();
    const cards = await loadCards();
    const userCard = cards[userId];
    
    if (userCard && userCard.hash === userHash && userCard.imageUrl) {
      // Verify the image still exists
      try {
        const response = await fetch(userCard.imageUrl, { method: 'HEAD' });
        if (response.ok) {
          return userCard.imageUrl;
        }
      } catch (error) {
        console.log('Cached image no longer accessible:', error.message);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking cached image:', error);
    return null;
  }
}

async function saveCachedImage(userId, userHash, imageUrl) {
  try {
    const cards = await loadCards();
    
    // Delete old cached image if it exists and is different
    const oldCard = cards[userId];
    if (oldCard && oldCard.hash !== userHash && oldCard.imageUrl) {
      // Clean up old cached reference
      console.log('Replacing old cached image for user:', userId);
    }
    
    cards[userId] = {
      hash: userHash,
      imageUrl: imageUrl,
      createdAt: new Date().toISOString()
    };
    
    await saveCards(cards);
    console.log('Image cached for user:', userId);
  } catch (error) {
    console.error('Error saving cached image:', error);
  }
}

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

// CometAPI functions
async function generateSentences() {
  try {
    const response = await fetch(`${COMET_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COMET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'Génère exactement 20 phrases en français TOTALEMENT ALÉATOIRES et UNIQUES. Aucun thème, aucun biais, aucune limite de sujet. Mélange tous les domaines : science, histoire, cuisine, sport, technologie, nature, art, politique, médecine, voyage, architecture, musique, littérature, géographie, astronomie, biologie, chimie, physique, psychologie, sociologie, économie, philosophie, etc. VARIE ÉNORMÉMENT LES LONGUEURS et n\'hésite pas à faire des phrases COURTES : certaines très courtes (3-6 mots), d\'autres courtes (7-10 mots), quelques moyennes (11-16 mots), et parfois longues (17-25 mots). Privilégie la variété avec un bon mélange de phrases courtes et moyennes. Varie les styles : déclaratif, interrogatif, exclamatif, conditionnel. Sois complètement imprévisible et créatif. Une phrase par ligne, pas de numérotation.'
          },
          {
            role: 'user',
            content: `Génère 20 phrases françaises complètement aléatoires sur des sujets totalement différents et imprévisibles. Utilise ce timestamp pour garantir l'unicité: ${Date.now()}`
          }
        ],
        max_tokens: 1000,
        temperature: 0.9
      })
    });

    if (!response.ok) {
      console.error(`CometAPI error: ${response.status}`);
      throw new Error(`CometAPI error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.error('No content returned from CometAPI');
      throw new Error('No content returned from CometAPI');
    }

    // Split sentences by newlines and filter empty lines
    const sentences = content
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\d+\.?\s*/))
      .slice(0, 20);

    return sentences.length >= 5 ? sentences : [];
    
  } catch (error) {
    console.error('Error generating sentences:', error);
    throw error;
  }
}

async function analyzeResponse(originalSentence, userResponse, timeSpent) {
  try {
    const response = await fetch(`${COMET_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COMET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
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

IMPORTANT pour le calcul d'erreur :
- Compare uniquement le contenu, ignore les espaces en début/fin
- Un caractère manquant = 1 erreur
- Un caractère supplémentaire = 1 erreur  
- Un caractère différent = 1 erreur
- La ponctuation compte (point, virgule, etc.)
- Calcule: (nombre_erreurs / longueur_phrase_originale) * 100
- Si la phrase est identique, errorRate = 0`
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
      console.error(`CometAPI error: ${response.status}`);
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

// New function to calculate time needed for a sentence at a specific WPM
async function calculateTargetTime(sentence, targetWPM) {
  try {
    const response = await fetch(`${COMET_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COMET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `Tu es un expert en calcul de vitesse de frappe. Calcule le temps nécessaire pour écrire une phrase à une vitesse WPM donnée.

Instructions:
1. Compte le nombre de mots dans la phrase (séparés par des espaces)
2. Calcule le temps en secondes: (nombre_de_mots / WPM) * 60
3. Retourne uniquement le nombre de secondes au format décimal (exemple: 45.5)

Ne retourne que le nombre, rien d'autre.`
          },
          {
            role: 'user',
            content: `Phrase: "${sentence}"\nWPM cible: ${targetWPM}`
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error(`CometAPI error for time calculation: ${response.status}`);
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return (wordCount / targetWPM) * 60;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return (wordCount / targetWPM) * 60;
    }

    const timeSeconds = parseFloat(content);
    if (isNaN(timeSeconds)) {
      // Fallback calculation
      const wordCount = sentence.trim().split(/\s+/).length;
      return (wordCount / targetWPM) * 60;
    }

    return timeSeconds;

  } catch (error) {
    console.error('Error calculating target time:', error);
    // Fallback calculation
    const wordCount = sentence.trim().split(/\s+/).length;
    return (wordCount / targetWPM) * 60;
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

// Function removed - all sentences now generated by AI

// Profile card generation with caching
async function generateProfileCard(user, userId, ctx = null) {
  try {
    // Generate hash from user data to detect changes
    const userHash = generateUserHash(user);
    
    // Check if we have a cached image
    const cachedImageUrl = await getCachedImage(userId, userHash);
    if (cachedImageUrl) {
      console.log('Using cached profile card for user:', userId);
      // Download cached image and return as buffer
      const imageResponse = await fetch(cachedImageUrl);
      if (imageResponse.ok) {
        const imageBuffer = await imageResponse.arrayBuffer();
        return Buffer.from(imageBuffer);
      } else {
        console.log('Cached image no longer available, generating new one');
      }
    }
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

    // Use HTMLCSStoImage API with credential rotation
    const imageData = await makeImageRequest(htmlTemplate, ctx);
    
    // Save the image URL to cache
    await saveCachedImage(userId, userHash, imageData.url);
    
    // Download the image from the returned URL
    const imageResponse = await fetch(imageData.url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    console.log('Generated new profile card for user:', userId);
    return Buffer.from(imageBuffer);
    
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
    this.targetTime = null; // For challenge mode
    this.isChallenge = false;
  }

  async start(targetTime = null) {
    this.targetTime = targetTime;
    this.isChallenge = targetTime !== null;
    
    try {
      // Send initial chronometer message
      const message = await this.ctx.reply('⏱️ CHRONOMÈTRE\n\n00:00.000\n\n⏳ Démarrage dans 0.5s...');
      this.messageId = message.message_id;

      // Wait 0.5s before starting the actual chronometer
      setTimeout(() => {
        this.startActualChronometer();
      }, 500);

    } catch (error) {
      console.error('Error starting chronometer:', error);
    }
  }

  startActualChronometer() {
    this.startTime = Date.now();
    this.isRunning = true;

    // Update chronometer every 1000ms to avoid Telegram rate limits while maintaining precision
    this.intervalId = setInterval(() => {
      this.updateChronometer();
    }, 1000);

    // Auto-stop after 5 minutes for safety
    setTimeout(() => {
      if (this.isRunning) {
        this.stop();
      }
    }, 300000);

    // For challenge mode, auto-stop when target time + tolerance is reached
    if (this.isChallenge && this.targetTime) {
      const toleranceTime = this.targetTime + 0.33; // 0.33s tolerance
      setTimeout(() => {
        if (this.isRunning) {
          this.timeUp();
        }
      }, toleranceTime * 1000);
    }
  }

  async updateChronometer() {
    if (!this.isRunning || !this.messageId) return;

    const elapsed = Date.now() - this.startTime;
    const seconds = Math.floor(elapsed / 1000);
    const milliseconds = elapsed % 1000;
    
    const timeString = `${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(3, '0')}`;

    let message = `⏱️ CHRONOMÈTRE\n\n${timeString}\n\nEn cours...`;
    
    // For challenge mode, show target time
    if (this.isChallenge && this.targetTime) {
      const targetSeconds = Math.floor(this.targetTime);
      const targetMs = Math.floor((this.targetTime % 1) * 1000);
      const targetString = `${targetSeconds.toString().padStart(2, '0')}:${targetMs.toString().padStart(3, '0')}`;
      message = `⏱️ CHRONOMÈTRE CHALLENGE\n\n${timeString}\n🎯 Objectif: ${targetString}\n\nEn cours...`;
    }

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        message
      );
    } catch (error) {
      // Handle rate limiting and other Telegram errors gracefully
      if (error.code === 429 || error.description?.includes('Too Many Requests')) {
        console.log('Rate limited, skipping this chronometer update');
        return;
      }
      if (error.description?.includes('message is not modified')) {
        return; // Ignore duplicate content errors
      }
      if (error.description?.includes('message to edit not found')) {
        this.isRunning = false; // Stop if message was deleted
        return;
      }
      // Log other errors but don't stop the chronometer
      console.error('Chronometer update error (continuing):', error.description || error.message);
    }
  }

  async timeUp() {
    if (!this.isRunning) return 0;

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const elapsed = Date.now() - this.startTime;
    const timeSpent = elapsed / 1000;

    // Update final message for timeout
    if (this.messageId) {
      const seconds = Math.floor(elapsed / 1000);
      const milliseconds = elapsed % 1000;
      const timeString = `${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(3, '0')}`;

      this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        undefined,
        `⏱️ CHRONOMÈTRE\n\n${timeString}\n\n⏰ TEMPS ÉCOULÉ!`
      ).catch(() => {
        // Ignore errors
      });
    }

    return timeSpent;
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

// Bot commands and handlers

console.log('Starting GUN PARK bot...');

// Load user data on startup
loadUsers().then(() => {
  console.log('User data loaded successfully');
}).catch(error => {
  console.error('Error loading user data:', error);
});

// Auto-save user data every 5 minutes
setInterval(async () => {
  await saveUsers();
}, 5 * 60 * 1000);

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

// Removed old photo handler - using newer comprehensive handler below

// Handle skip photo
bot.action('skip_photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  const userState = userStates.get(telegramId);
  if (!userState) return;

  userStates.set(telegramId, { ...userState, step: 'awaiting_name', photoUrl: null });
  await ctx.editMessageText('✏️ ÉTAPE 2/2 : Nom d\'utilisateur\n\nChoisis ton nom d\'utilisateur pour ton profil :');
});

// Removed old text handler - using newer comprehensive handler below

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

    await ctx.reply('🎨 Génération de ta carte de profil en cours...');

    // Generate profile card
    const profileCardBuffer = await generateProfileCard(user, telegramId, ctx);
    
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

async function showMainMenu(ctx, user) {
  try {
    console.log('Showing main menu for user:', user.telegramId);
    const profileCardBuffer = await generateProfileCard(user, user.telegramId, ctx);
    
    const menuText = `⚡ Salut ${user.username} ! ⚡\n\n🏆 Rang actuel: ${user.rank} (${getRankDescription(user.rank)})\n🚀 Meilleur score: ${user.bestScore} WPM\n\nQue veux-tu faire aujourd'hui ?`;
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: menuText,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
          [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
          [Markup.button.callback('📊 Mes statistiques', 'view_stats')],
          [Markup.button.callback('🔄 Nouvelle carte', 'refresh_card'), Markup.button.callback('ℹ️ Aide', 'help')]
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

// Handle speed test
bot.action('speed_test', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User starting speed test:', telegramId);

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

    // Start chronometer
    const chronometer = new ChronometerService(ctx);
    const userState = userStates.get(telegramId);
    if (userState) {
      userState.chronometer = chronometer;
      userStates.set(telegramId, userState);
    }
    
    await chronometer.start();
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

  // Stop chronometer IMMEDIATELY when message is received
  const timeSpent = userState.chronometer.stop();
  console.log('Bot: Test time spent:', timeSpent);
  
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
    console.log('Bot: Analysis result:', analysis);

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
  console.log(`Bot: Handling ${command} command for user ${telegramId}`);

  const userState = userStates.get(telegramId);

  // Stop chronometer if active
  if (userState?.chronometer && userState.chronometer.isActive()) {
    userState.chronometer.stop();
    console.log('Bot: Chronometer stopped by command');
  }

  if (command === 'stop') {
    // Clear user state
    userStates.set(telegramId, { step: 'ready' });
    
    await ctx.reply('⏹️ Test arrêté.', 
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Nouveau test', 'speed_test')],
        [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
        [Markup.button.callback('📊 Voir mes stats', 'view_stats')]
      ])
    );
  } else if (command === 'restart') {
    // Generate completely new sentences for restart
    if (userState?.currentSession) {
      const session = testSessions.get(userState.currentSession);
      if (session) {
        try {
          console.log('Bot: Generating new sentences for restart');
          
          // Generate fresh sentences
          const newSentences = await generateSentences();
          session.sentences = newSentences;
          session.currentSentenceIndex = 0;
          session.results = [];
          session.challengeResults = [];
          
          testSessions.set(session.id, session);
          
          if (session.type === 'speed_test') {
            await startTestSentence(ctx, session, newSentences[0]);
          } else if (session.type === 'challenge') {
            await startChallengeSentence(ctx, session, newSentences[0]);
          }
        } catch (error) {
          console.error('Error restarting with new sentences:', error);
          await ctx.reply('❌ Erreur lors du redémarrage. Utilise /start pour recommencer.');
        }
      }
    }
  }
}

// Handle view stats
bot.action('view_stats', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User viewing stats:', telegramId);

  try {
    const user = users.get(telegramId);
    if (!user) return;

    const profileCardBuffer = await generateProfileCard(user, telegramId, ctx);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `📊 Tes statistiques actuelles, ${user.username} !`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
          [Markup.button.callback('⚡ Mode Challenge', 'challenge_mode')],
          [Markup.button.callback('✏️ Modifier la carte', 'edit_card')],
          [Markup.button.callback('🏠 Menu principal', 'main_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error showing stats:', error);
    await ctx.reply('❌ Erreur lors de l\'affichage des statistiques.');
  }
});

// New card creation action
bot.action('new_card', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    const user = users.get(telegramId);
    if (!user) return;

    const profileCardBuffer = await generateProfileCard(user, telegramId, ctx);
    
    await ctx.replyWithPhoto(
      { source: profileCardBuffer },
      { 
        caption: `🎨 Nouvelle carte générée pour ${user.username} !`,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Modifier la carte', 'edit_card')],
          [Markup.button.callback('🏠 Menu principal', 'main_menu')]
        ])
      }
    );
  } catch (error) {
    console.error('Error generating new card:', error);
    await ctx.reply('❌ Erreur lors de la génération de la carte.');
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

// Challenge mode - Full implementation
bot.action('challenge_mode', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  console.log('User starting challenge mode:', telegramId);

  const user = users.get(telegramId);
  if (!user) return;

  try {
    await ctx.editMessageText('⚡ MODE CHALLENGE ⚡\n\n🎯 Choisis le nombre de phrases pour ton défi :\n\n💡 Par défaut : 5 phrases', 
      Markup.inlineKeyboard([
        [Markup.button.callback('1️⃣ 1 phrase', 'challenge_1')],
        [Markup.button.callback('3️⃣ 3 phrases', 'challenge_3')],
        [Markup.button.callback('5️⃣ 5 phrases (défaut)', 'challenge_5')],
        [Markup.button.callback('🔢 Personnalisé', 'challenge_custom')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );
  } catch (error) {
    await ctx.reply('⚡ MODE CHALLENGE ⚡\n\n🎯 Choisis le nombre de phrases pour ton défi :', 
      Markup.inlineKeyboard([
        [Markup.button.callback('1️⃣ 1 phrase', 'challenge_1')],
        [Markup.button.callback('3️⃣ 3 phrases', 'challenge_3')],
        [Markup.button.callback('5️⃣ 5 phrases (défaut)', 'challenge_5')],
        [Markup.button.callback('🔢 Personnalisé', 'challenge_custom')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );
  }
});

// Challenge sentence count handlers
bot.action('challenge_1', async (ctx) => { await startChallengeWPMSelection(ctx, 1); });
bot.action('challenge_3', async (ctx) => { await startChallengeWPMSelection(ctx, 3); });
bot.action('challenge_5', async (ctx) => { await startChallengeWPMSelection(ctx, 5); });

bot.action('challenge_custom', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  userStates.set(telegramId, { step: 'awaiting_sentence_count' });
  
  await ctx.editMessageText('🔢 NOMBRE PERSONNALISÉ\n\nTape le nombre de phrases que tu veux (entre 1 et 20) :', 
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Retour', 'challenge_mode')]
    ])
  );
});

async function startChallengeWPMSelection(ctx, sentenceCount) {
  const telegramId = ctx.from.id.toString();
  const user = users.get(telegramId);
  if (!user) return;

  userStates.set(telegramId, { step: 'challenge_wpm_selection', sentenceCount });

  try {
    await ctx.editMessageText(`⚡ MODE CHALLENGE - ${sentenceCount} phrase${sentenceCount > 1 ? 's' : ''}\n\n🎯 Maintenant choisis ta vitesse cible (WPM) :\n\n💡 Ta meilleure performance : ${user.bestScore} WPM`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🐌 20 WPM', 'wpm_20'), Markup.button.callback('🚶 30 WPM', 'wpm_30')],
        [Markup.button.callback('🏃 40 WPM', 'wpm_40'), Markup.button.callback('⚡ 50 WPM', 'wpm_50')],
        [Markup.button.callback('🚀 60 WPM', 'wpm_60'), Markup.button.callback('💨 70 WPM', 'wpm_70')],
        [Markup.button.callback('🔥 80+ WPM', 'wpm_80')],
        [Markup.button.callback('🔢 Personnalisé', 'wpm_custom')],
        [Markup.button.callback('🔙 Retour', 'challenge_mode')]
      ])
    );
  } catch (error) {
    await ctx.reply(`⚡ MODE CHALLENGE - ${sentenceCount} phrase${sentenceCount > 1 ? 's' : ''}\n\n🎯 Choisis ta vitesse cible (WPM) :`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🐌 20 WPM', 'wpm_20'), Markup.button.callback('🚶 30 WPM', 'wpm_30')],
        [Markup.button.callback('🏃 40 WPM', 'wpm_40'), Markup.button.callback('⚡ 50 WPM', 'wpm_50')],
        [Markup.button.callback('🚀 60 WPM', 'wpm_60'), Markup.button.callback('💨 70 WPM', 'wpm_70')],
        [Markup.button.callback('🔥 80+ WPM', 'wpm_80')],
        [Markup.button.callback('🔢 Personnalisé', 'wpm_custom')],
        [Markup.button.callback('🔙 Retour', 'challenge_mode')]
      ])
    );
  }
}

// WPM selection handlers
bot.action('wpm_20', async (ctx) => { await startChallenge(ctx, 20); });
bot.action('wpm_30', async (ctx) => { await startChallenge(ctx, 30); });
bot.action('wpm_40', async (ctx) => { await startChallenge(ctx, 40); });
bot.action('wpm_50', async (ctx) => { await startChallenge(ctx, 50); });
bot.action('wpm_60', async (ctx) => { await startChallenge(ctx, 60); });
bot.action('wpm_70', async (ctx) => { await startChallenge(ctx, 70); });
bot.action('wpm_80', async (ctx) => { await startChallenge(ctx, 80); });

bot.action('wpm_custom', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId) || {};
  userState.step = 'awaiting_wpm';
  userStates.set(telegramId, userState);
  
  await ctx.editMessageText('🔢 VITESSE PERSONNALISÉE\n\nTape ta vitesse cible en WPM (entre 10 et 150) :', 
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Retour', 'challenge_mode')]
    ])
  );
});

async function startChallenge(ctx, targetWPM) {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId) || {};
  const sentenceCount = userState.sentenceCount || 5;

  try {
    await ctx.editMessageText('⚡ PRÉPARATION DU CHALLENGE ⚡\n\n🔄 Génération de phrases aléatoires par IA...\n⏱️ Calcul des temps cibles...\n🎯 Configuration du défi...', 
      Markup.inlineKeyboard([])
    );

    // Generate sentences
    const sentences = await generateSentences();
    if (!sentences || sentences.length < sentenceCount) {
      throw new Error('Insufficient sentences generated');
    }
    
    const selectedSentences = sentences.slice(0, sentenceCount);

    // Create challenge session
    const sessionId = Date.now().toString();
    const session = {
      id: sessionId,
      userId: telegramId,
      telegramId,
      type: 'challenge',
      sentences: selectedSentences,
      totalSentences: sentenceCount,
      targetWPM,
      currentSentenceIndex: 0,
      startTime: new Date(),
      status: 'pending',
      results: null,
      testResults: [],
      challengeResults: [],
      createdAt: new Date()
    };

    testSessions.set(sessionId, session);
    userStates.set(telegramId, { step: 'in_challenge', currentSession: sessionId });

    // Start the challenge
    await startChallengeSentence(ctx, session, selectedSentences[0]);
    
  } catch (error) {
    console.error('Error starting challenge:', error);
    await ctx.reply('❌ Erreur lors de la préparation du challenge. Réessaie.');
  }
}

async function startChallengeSentence(ctx, session, sentence) {
  const telegramId = session.telegramId;
  
  try {
    // Calculate target time for this sentence
    await ctx.editMessageText('🔄 Calcul en cours...\n\nAnalyse de la phrase et calcul du temps cible...', 
      Markup.inlineKeyboard([])
    );

    const targetTime = await calculateTargetTime(sentence, session.targetWPM);
    
    // Update session with target time for current sentence
    session.currentTargetTime = targetTime;
    testSessions.set(session.id, session);

    const sentenceNumber = session.currentSentenceIndex + 1;
    const totalSentences = session.totalSentences;
    const targetSeconds = Math.floor(targetTime);
    const targetMs = Math.floor((targetTime % 1) * 1000);
    const targetString = `${targetSeconds.toString().padStart(2, '0')}:${targetMs.toString().padStart(3, '0')}`;

    await ctx.editMessageText(`📝 CHALLENGE - Phrase ${sentenceNumber}/${totalSentences}\n🎯 Objectif : ${session.targetWPM} WPM en max ${targetString}\n\n"${sentence}"\n\n⌨️ Recopie cette phrase exactement :`);

    // Start chronometer with target time
    const chronometer = new ChronometerService(ctx);
    await chronometer.start(targetTime);

    const userState = userStates.get(telegramId) || {};
    userState.chronometer = chronometer;
    userStates.set(telegramId, userState);

  } catch (error) {
    console.error('Error starting challenge sentence:', error);
    await ctx.reply('❌ Erreur lors du démarrage de la phrase. Réessaie.');
  }
}

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

// Text message handler
bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const message = ctx.message.text.trim();
  const userState = userStates.get(telegramId);

  console.log(`Bot: Text message received from ${telegramId}: "${message}"`);
  console.log(`Bot: Current user state:`, userState);

  // Check for stop/restart commands first - PRIORITY over everything else, but only during tests
  const lowerMessage = message.toLowerCase().trim();
  
  // Only process stop/restart commands if user is in a test state
  if (userState && (userState.step === 'in_test' || userState.step === 'in_challenge')) {
    if (lowerMessage === 'stop' || lowerMessage === '/stop' || lowerMessage === 'arrêter' || lowerMessage === 'arret') {
      console.log('Bot: Processing STOP command');
      await handleTestControl(ctx, 'stop');
      return;
    }

    if (lowerMessage === 'restart' || lowerMessage === '/restart' || lowerMessage === 'recommencer' || lowerMessage === 'redémarrer') {
      console.log('Bot: Processing RESTART command');
      await handleTestControl(ctx, 'restart');
      return;
    }
  }

  // Handle different states
  if (!userState) {
    console.log('Bot: No user state found, asking to start');
    await ctx.reply('👋 Utilise /start pour commencer !');
    return;
  }

  console.log(`Bot: Processing message for state: ${userState.step}`);

  switch (userState.step) {
    case 'awaiting_username':
      console.log('Bot: Handling username input');
      await handleUsernameInput(ctx, message);
      break;
    
    case 'awaiting_name':
      console.log('Bot: Handling name input (legacy)');
      await handleNameInput(ctx, message);
      break;
    
    case 'awaiting_sentence_count':
      console.log('Bot: Handling sentence count input');
      await handleSentenceCountInput(ctx, message);
      break;
    
    case 'awaiting_wpm':
      console.log('Bot: Handling WPM input');
      await handleWPMInput(ctx, message);
      break;
    
    case 'awaiting_edit_name':
      console.log('Bot: Handling name edit input');
      console.log('Bot: Message content:', message);
      console.log('Bot: Message length:', message.length);
      await handleEditNameInput(ctx, message);
      break;
    
    case 'in_test':
      console.log('Bot: Handling test response');
      await handleTestResponse(ctx, message);
      break;
    
    case 'in_challenge':
      console.log('Bot: Handling challenge response');
      await handleChallengeResponse(ctx, message);
      break;
    
    default:
      console.log(`Bot: Unknown state: ${userState.step}`);
      await ctx.reply('🤔 Je n\'ai pas compris. Utilise les boutons pour naviguer ou tape /start pour recommencer.');
  }
});

async function handleSentenceCountInput(ctx, message) {
  const telegramId = ctx.from.id.toString();
  const count = parseInt(message);
  
  if (isNaN(count) || count < 1 || count > 20) {
    await ctx.reply('❌ Nombre invalide. Entre un nombre entre 1 et 20 :');
    return;
  }
  
  await startChallengeWPMSelection(ctx, count);
}

async function handleWPMInput(ctx, message) {
  const telegramId = ctx.from.id.toString();
  const wpm = parseInt(message);
  
  if (isNaN(wpm) || wpm < 10 || wpm > 150) {
    await ctx.reply('❌ Vitesse invalide. Entre un nombre entre 10 et 150 WPM :');
    return;
  }
  
  await startChallenge(ctx, wpm);
}

async function handleUsernameInput(ctx, message) {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);
  
  console.log(`Bot: Handling username input for user ${telegramId}: "${message}"`);
  
  try {
    if (message.length < 2 || message.length > 20) {
      console.log(`Bot: Invalid username length: ${message.length}`);
      await ctx.reply('❌ Le nom doit faire entre 2 et 20 caractères. Réessaie :');
      return;
    }
    
    console.log('Creating user:', telegramId, message);
    
    // Create user
    const user = {
      telegramId,
      username: message,
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
    await saveUsers();
    userStates.set(telegramId, { step: 'ready' });

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

async function handleEditNameInput(ctx, message) {
  const telegramId = ctx.from.id.toString();
  console.log(`Bot: Handling name edit for user ${telegramId}: "${message}"`);
  
  try {
    const user = users.get(telegramId);
    
    if (!user) {
      console.log('Bot: User not found for name edit');
      await ctx.reply('❌ Utilisateur introuvable. Utilise /start pour recommencer.');
      return;
    }
    
    if (message.length < 2 || message.length > 20) {
      console.log(`Bot: Invalid name length: ${message.length}`);
      await ctx.reply('❌ Le nom doit faire entre 2 et 20 caractères. Réessaie :');
      return;
    }
    
    const oldName = user.username;
    user.username = message;
    users.set(telegramId, user);
    await saveUsers();
    
    userStates.set(telegramId, { step: 'ready' });
    
    console.log(`Bot: Name changed from "${oldName}" to "${message}"`);
    
    await ctx.reply(`✅ Nom modifié avec succès : ${message}`, 
      Markup.inlineKeyboard([
        [Markup.button.callback('🎨 Nouvelle carte', 'new_card')],
        [Markup.button.callback('📊 Voir ma carte', 'view_stats')],
        [Markup.button.callback('🏠 Menu principal', 'main_menu')]
      ])
    );
  } catch (error) {
    console.error('Error in handleEditNameInput:', error);
    await ctx.reply('❌ Erreur lors de la modification du nom. Réessaie ou retourne au menu principal.');
    userStates.set(telegramId, { step: 'ready' });
  }
}

async function handleChallengeResponse(ctx, message) {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);
  
  if (!userState?.currentSession) return;
  
  const session = testSessions.get(userState.currentSession);
  if (!session || session.type !== 'challenge') return;
  
  const currentSentence = session.sentences[session.currentSentenceIndex];
  
  // Stop chronometer IMMEDIATELY when message is received
  let timeSpent = 0;
  if (userState.chronometer && userState.chronometer.isActive()) {
    timeSpent = userState.chronometer.stop();
  }
  
  const targetTime = session.currentTargetTime || 30;
  const tolerance = 0.33;
  
  // Analyze response
  try {
    const analysis = await analyzeResponse(currentSentence, message, timeSpent);
    
    // Determine success criteria
    const timeSuccess = timeSpent <= (targetTime + tolerance);
    const accuracySuccess = analysis.type === 'valid' && analysis.errorRate <= 10;
    const overallSuccess = timeSuccess && accuracySuccess;
    
    // Store result
    const result = {
      sentence: currentSentence,
      userResponse: message,
      timeSpent,
      targetTime,
      analysis,
      success: overallSuccess,
      timestamp: new Date()
    };
    
    session.challengeResults.push(result);
    session.currentSentenceIndex++;
    
    // Show detailed result
    const wpm = Math.round(calculateWPM(currentSentence, timeSpent));
    const errorRate = analysis.type === 'valid' ? analysis.errorRate : 100;
    const timeStatus = timeSuccess ? '✅' : '❌';
    const accuracyStatus = accuracySuccess ? '✅' : '❌';
    
    // Check if more sentences
    if (session.currentSentenceIndex < session.totalSentences) {
      await ctx.reply(`${overallSuccess ? '🎉' : '😔'} RÉSULTAT PHRASE ${session.currentSentenceIndex}/${session.totalSentences}

⏱️ Temps: ${timeSpent.toFixed(2)}s ${timeStatus} (objectif: ${targetTime.toFixed(2)}s)
🎯 Vitesse: ${wpm} WPM
📝 Précision: ${errorRate.toFixed(1)}% erreurs ${accuracyStatus}

${overallSuccess ? '🔥 RÉUSSI!' : '💪 Continue!'} Prêt pour la phrase suivante ?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('▶️ Phrase suivante', 'next_challenge_sentence')],
          [Markup.button.callback('⏹️ Arrêter le challenge', 'stop_challenge')]
        ])
      );
    } else {
      // Challenge complete
      await finishChallenge(ctx, session);
    }
  } catch (error) {
    console.error('Error analyzing challenge response:', error);
    await ctx.reply('❌ Erreur lors de l\'analyse. Réessaie.');
  }
}

async function handleChallengeTimeout(ctx, session, message, timeSpent) {
  const telegramId = session.telegramId;
  
  await ctx.reply('⏰ TEMPS ÉCOULÉ!\n\nTu n\'as pas réussi à terminer dans les temps. Que veux-tu faire ?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Réessayer cette phrase', 'retry_challenge_sentence')],
      [Markup.button.callback('▶️ Phrase suivante', 'next_challenge_sentence')],
      [Markup.button.callback('⏹️ Arrêter le challenge', 'stop_challenge')]
    ])
  );
}

// Challenge action handlers
bot.action('next_challenge_sentence', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);
  
  if (!userState?.currentSession) return;
  
  const session = testSessions.get(userState.currentSession);
  if (!session) return;
  
  if (session.currentSentenceIndex < session.totalSentences) {
    const nextSentence = session.sentences[session.currentSentenceIndex];
    await startChallengeSentence(ctx, session, nextSentence);
  } else {
    await finishChallenge(ctx, session);
  }
});

bot.action('retry_challenge_sentence', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);
  
  if (!userState?.currentSession) return;
  
  const session = testSessions.get(userState.currentSession);
  if (!session) return;
  
  const currentSentence = session.sentences[session.currentSentenceIndex];
  await startChallengeSentence(ctx, session, currentSentence);
});

bot.action('stop_challenge', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  userStates.set(telegramId, { step: 'ready' });
  await ctx.reply('⏹️ Challenge arrêté.',
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ Nouveau challenge', 'challenge_mode')],
      [Markup.button.callback('🚀 Test de vitesse', 'speed_test')],
      [Markup.button.callback('🏠 Menu principal', 'main_menu')]
    ])
  );
});

async function finishChallenge(ctx, session) {
  const telegramId = session.telegramId;
  const user = users.get(telegramId);
  
  if (!user) return;
  
  // Calculate overall results
  const results = session.challengeResults;
  const successCount = results.filter(r => r.success).length;
  const avgWPM = results.reduce((sum, r) => sum + calculateWPM(r.sentence, r.timeSpent), 0) / results.length;
  const avgErrorRate = results.reduce((sum, r) => sum + r.analysis.errorRate, 0) / results.length;
  
  const challengeSuccess = successCount >= Math.ceil(session.totalSentences * 0.6); // 60% success rate needed
  
  // Update user stats if successful
  if (challengeSuccess) {
    user.totalTests++;
    user.totalSentences += session.totalSentences;
    
    if (Math.round(avgWPM) > user.bestScore) {
      user.bestScore = Math.round(avgWPM);
    }
    
    // Add to test scores for average calculation
    if (!user.testScores) user.testScores = [];
    user.testScores.push(Math.round(avgWPM));
    
    // Keep only last 10 scores for average
    if (user.testScores.length > 10) {
      user.testScores = user.testScores.slice(-10);
    }
    
    user.averageScore = Math.round(user.testScores.reduce((a, b) => a + b, 0) / user.testScores.length);
    user.currentRank = getRankFromWPM(user.bestScore);
    
    users.set(telegramId, user);
    await saveUsers();
  }
  
  const emoji = challengeSuccess ? '🎉' : '😔';
  const status = challengeSuccess ? 'RÉUSSI' : 'ÉCHOUÉ';
  
  await ctx.reply(`${emoji} CHALLENGE ${status}!\n\n📊 Résultats:\n• ${successCount}/${session.totalSentences} phrases réussies\n• Moyenne: ${Math.round(avgWPM)} WPM\n• Erreurs: ${Math.round(avgErrorRate)}%\n• Objectif: ${session.targetWPM} WPM\n\n${challengeSuccess ? '🔥 Bravo! Objectif atteint!' : '💪 Continue à t\'entraîner!'}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⚡ Nouveau challenge', 'challenge_mode')],
      [Markup.button.callback('📊 Voir ma carte', 'view_stats')],
      [Markup.button.callback('🏠 Menu principal', 'main_menu')]
    ])
  );
  
  userStates.set(telegramId, { step: 'ready' });
}

// Add card editing functionality
bot.action('edit_card', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    // Send new message instead of editing photo message
    await ctx.reply('✏️ MODIFIER LA CARTE\n\nQue veux-tu modifier ?',
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Changer le nom', 'edit_name')],
        [Markup.button.callback('📸 Changer la photo', 'edit_photo')],
        [Markup.button.callback('🗑️ Supprimer profil', 'delete_profile')],
        [Markup.button.callback('🔙 Retour aux stats', 'view_stats')]
      ])
    );
  } catch (error) {
    console.error('Error showing edit card menu:', error);
    await ctx.reply('❌ Erreur lors de l\'affichage du menu de modification.');
  }
});

bot.action('edit_name', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  console.log(`Bot: Setting edit name state for user ${telegramId}`);
  userStates.set(telegramId, { step: 'awaiting_edit_name' });
  console.log(`Bot: User state after setting:`, userStates.get(telegramId));
  
  await ctx.reply('📝 CHANGER LE NOM\n\nTape ton nouveau nom (2-20 caractères) :',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Annuler', 'edit_card')]
    ])
  );
});

bot.action('edit_photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  userStates.set(telegramId, { step: 'awaiting_edit_photo' });
  
  await ctx.reply('📸 CHANGER LA PHOTO\n\nEnvoie ta nouvelle photo de profil :',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Annuler', 'edit_card')]
    ])
  );
});

// Photo message handler
bot.on('photo', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const userState = userStates.get(telegramId);

  if (!userState) {
    await ctx.reply('👋 Utilise /start pour commencer !');
    return;
  }

  console.log(`Bot: Photo received from user ${telegramId}, state: ${userState?.step}`);
  
  if (userState.step === 'awaiting_photo' || userState.step === 'awaiting_edit_photo') {
    try {
      console.log('Bot: Processing photo for profile');
      console.log('Bot: User state step:', userState.step);
      
      // Get largest photo size
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      console.log('Bot: Got photo object, file_id:', photo.file_id);
      
      const photoFile = await ctx.telegram.getFile(photo.file_id);
      console.log('Bot: Got photo file info:', photoFile.file_path);
      
      const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${photoFile.file_path}`;
      console.log('Bot: Photo URL constructed:', photoUrl);

      // Download and save photo
      console.log('Bot: Downloading photo...');
      const response = await fetch(photoUrl);
      console.log('Bot: Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      console.log('Bot: Downloaded photo, size:', arrayBuffer.byteLength, 'bytes');
      
      const buffer = Buffer.from(arrayBuffer);
      console.log('Bot: Created buffer, size:', buffer.length, 'bytes');
      
      // Save to cards data
      console.log('Bot: Loading cards data...');
      const cardsData = await loadCards();
      console.log('Bot: Loaded cards data, existing entries:', Object.keys(cardsData).length);
      
      cardsData[telegramId] = {
        photoBuffer: buffer.toString('base64'),
        uploadTime: new Date()
      };
      console.log('Bot: Added photo to cards data');
      
      await saveCards(cardsData);
      console.log('Bot: Saved cards data successfully');

      if (userState.step === 'awaiting_photo') {
        // Continue with username setup
        userStates.set(telegramId, { step: 'awaiting_username' });
        await ctx.reply('✅ Photo enregistrée !\n\n📝 ÉTAPE 2/2 : Nom d\'utilisateur\n\nTape ton nom pour ta carte de profil (2-20 caractères) :');
      } else {
        // Edit photo complete
        console.log('Bot: Photo edit completed');
        const user = users.get(telegramId);
        if (user) {
          user.profilePhotoUrl = photoUrl; // Update user photo reference (using correct field name)
          users.set(telegramId, user);
          await saveUsers();
          console.log('Bot: User photo updated in database');
        } else {
          console.log('Bot: Warning - User not found when updating photo');
        }
        
        userStates.set(telegramId, { step: 'ready' });
        console.log('Bot: User state reset to ready after photo edit');
        
        await ctx.reply('✅ Photo modifiée avec succès !', 
          Markup.inlineKeyboard([
            [Markup.button.callback('📊 Voir ma carte', 'view_stats')],
            [Markup.button.callback('🏠 Menu principal', 'main_menu')]
          ])
        );
      }
    } catch (error) {
      console.error('Error processing photo:', error);
      await ctx.reply('❌ Erreur lors du traitement de la photo. Réessaie.');
    }
  } else {
    console.log(`Bot: Photo ignored, wrong state: ${userState?.step}`);
    await ctx.reply('🤔 Je n\'attends pas de photo en ce moment. Utilise les boutons pour naviguer.');
  }
});

// Delete profile functionality
bot.action('delete_profile', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  await ctx.reply('⚠️ SUPPRIMER LE PROFIL\n\n🚨 Cette action est irréversible !\n\nTous tes tests, statistiques et ta carte de profil seront supprimés définitivement.\n\nEs-tu sûr de vouloir continuer ?',
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ CONFIRMER LA SUPPRESSION', 'confirm_delete_profile')],
      [Markup.button.callback('🔙 Annuler', 'edit_card')]
    ])
  );
});

bot.action('confirm_delete_profile', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    console.log(`Bot: Deleting profile for user ${telegramId}`);
    
    // Remove user data
    users.delete(telegramId);
    await saveUsers();
    
    // Remove user cards
    const cardsData = await loadCards();
    delete cardsData[telegramId];
    await saveCards(cardsData);
    
    // Clear user state
    userStates.delete(telegramId);
    
    // Clear any active sessions
    for (const [sessionId, session] of testSessions.entries()) {
      if (session.telegramId === telegramId) {
        testSessions.delete(sessionId);
      }
    }
    
    console.log(`Bot: Profile deleted for user ${telegramId}`);
    
    await ctx.reply('🗑️ Profil supprimé avec succès !\n\nTous tes données ont été effacées.\n\n👋 Tu peux créer un nouveau profil en utilisant /start si tu veux recommencer.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🆕 Créer un nouveau profil', 'start_setup')]
      ])
    );
    
  } catch (error) {
    console.error('Error deleting profile:', error);
    await ctx.reply('❌ Erreur lors de la suppression du profil. Réessaie.');
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Telegram bot error:', err);
  try {
    ctx.reply('❌ Une erreur est survenue. Réessaie avec /start');
  } catch (replyError) {
    console.error('Error sending error message:', replyError);
  }
});

// Start the bot
bot.launch().then(() => {
  console.log('GUN PARK bot is running!');
}).catch(err => {
  console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
