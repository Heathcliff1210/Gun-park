# GUN PARK TYPING ACADEMY 

🎯 **Bot Telegram d'entraînement à la vitesse de frappe**
👨‍💻 **Créé par @Kageonightray**

## 🚀 Fonctionnalités

### ✅ Inscription et Profil
- Upload de photo de profil via Telegram  
- Choix du nom d'utilisateur
- Génération automatique de cartes de profil business style

### ✅ Tests de Vitesse
- Génération IA de phrases françaises aléatoires (OpenRouter API)
- 1 phrase pour le premier test, 5 phrases pour les tests suivants
- Chronométrage en temps réel avec précision milliseconde
- Analyse IA de précision et calcul des erreurs

### ✅ Système de Classement
- **D** : 0-15 WPM (Débutant)
- **C** : 16-30 WPM (Apprenti) 
- **B** : 31-45 WPM (Intermédiaire)
- **A** : 46-60 WPM (Utilisateur Avancé)
- **S** : 61-74 WPM (Expert Confirmé)
- **S+** : 75+ WPM (Maître Absolu)

### ✅ Cartes de Profil Dynamiques
- Design professionnel avec photo utilisateur
- Statistiques détaillées : meilleur score, moyenne, minimum, taux d'erreur
- Génération d'images avec Puppeteer

## 🛠️ Technologies

- **Node.js** + **Telegraf** (Bot Telegram)
- **OpenRouter API** (IA pour génération et analyse)
- **Puppeteer** (Génération d'images)
- **Stockage en mémoire** (Utilisateurs et sessions)

## 📁 Structure du Projet

```
├── gun-park-bot.js          # Bot principal avec toutes les fonctionnalités
├── server/index.ts           # Serveur hybrid (bot + endpoint santé)
├── package.json              # Dépendances minimales optimisées
└── README.md                 # Documentation
```

## 🎮 Utilisation

1. **Démarrage** : `/start`
2. **Photo** : Upload de la photo de profil
3. **Nom** : Choix du nom d'utilisateur  
4. **Tests** : Tests de vitesse avec chronométrage
5. **Statistiques** : Suivi des performances et progression

## ⌨️ Commandes durant les tests

- `stop` : Arrêter le test en cours
- `restart` : Recommencer la phrase actuelle

## 🔧 API et Intégrations

### OpenRouter API
- **`openai/gpt-oss-20b:free`** : Génération de 20 phrases françaises aléatoires
- **`moonshotai/kimi-k2:free`** : Analyse de précision et calcul d'erreurs

### Telegram Bot
- Token : `7324266903:AAHifYM9GXHoFS6sVSZrsRxwOoEENOOxw98`
- Interface avec boutons inline et navigation intuitive

---

**Status** : ✅ **Bot opérationnel et optimisé**