# Kalchat 💬✨

Une messagerie style **WhatsApp** (chat 1:1, groupes, temps réel) fusionnée avec des **Stories** façon Instagram (visuelles, expirent après 24h).

## Fonctionnalités

- **Authentification** : inscription / connexion avec mot de passe hashé (bcrypt) + session par JWT
- **Chat en temps réel** (Socket.io) : messages 1:1, groupes, indicateur "en train d'écrire..."
- **Partage de médias** dans les messages (images / vidéos)
- **Stories** : publication de photo/vidéo, expiration automatique après 24h, liste des personnes qui ont vu ta story, anneau de couleur façon Instagram pour les stories non vues
- **Vraie base de données** SQLite (fichier local, aucun service externe à configurer)
- Recherche de contacts, création de groupes avec plusieurs membres

## Installation

```bash
cd backend
npm install
cp .env.example .env   # personnalise JWT_SECRET si tu veux
npm start
```

Le serveur démarre sur **http://localhost:4000** et sert aussi le frontend directement (pas besoin de serveur séparé pour le front — ouvre simplement `http://localhost:4000` dans ton navigateur).

## Structure du projet

```
kalchat/
├── backend/
│   ├── server.js          # Serveur Express + Socket.io + upload
│   ├── db.js               # Schéma SQLite (better-sqlite3)
│   ├── routes/
│   │   ├── auth.js         # Inscription / connexion / recherche
│   │   ├── chat.js         # Conversations, groupes, messages
│   │   └── stories.js      # Publication / consultation des stories
│   └── middleware/auth.js  # Vérification du JWT
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js            # Logique client (fetch + Socket.io)
```

## Déploiement en ligne (Render — gratuit)

1. Mets ton projet sur GitHub (crée un repo, push le dossier `kalchat/`).
2. Va sur [render.com](https://render.com) → crée un compte gratuit (avec GitHub).
3. **New +** → **Web Service** → connecte ton repo.
4. Render détecte automatiquement `render.yaml` à la racine et pré-remplit tout. Sinon configure manuellement :
   - **Root Directory** : `backend`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
5. Ajoute la variable d'environnement `JWT_SECRET` (Render peut la générer automatiquement).
6. Clique **Create Web Service**. Après le build, ton app est en ligne sur une URL du type `https://kalchat.onrender.com`.

### ⚠️ Limites du plan gratuit Render à connaître

- **Le service "s'endort"** après 15 min d'inactivité, puis redémarre (quelques secondes de délai) à la prochaine visite.
- **Pas de disque persistant sur le plan gratuit** : la base SQLite et les fichiers uploadés (`backend/data/`, `backend/uploads/`) sont **réinitialisés à chaque redéploiement ou redémarrage**. Bien pour tester/montrer l'app, pas pour une vraie mise en production avec des données qui durent.
- Pour une vraie persistance plus tard, deux options : passer sur un plan payant Render avec disque persistant, ou migrer la base vers un service géré gratuit comme **Render Postgres** (gratuit 30 jours puis payant) ou **Supabase**.



- Feed de posts type Instagram (au-delà des stories)
- Notifications push
- Appels audio/vidéo (WebRTC)
- App mobile (React Native) réutilisant les mêmes routes API
- Chiffrement de bout en bout des messages

## Notes techniques

- Les fichiers uploadés sont stockés dans `backend/uploads/` et servis statiquement.
- Les stories expirées sont nettoyées automatiquement à chaque appel de `/api/stories/feed`.
- Pense à changer `JWT_SECRET` dans `.env` avant de mettre en ligne.
