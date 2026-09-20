# Kalchat 💬✨

Une application sociale complète : messagerie temps réel (chat 1:1, groupes), Stories 24h façon Instagram, fil de publications (posts, likes, commentaires, repartage), profils avec système d'abonnement, notifications en temps réel, badges et panel d'administration.

## Fonctionnalités

- **Authentification** : inscription (prénom, nom, nom d'utilisateur) / connexion, mot de passe hashé (bcrypt), session par JWT
- **Chat en temps réel** (Socket.io) : messages 1:1, groupes, indicateur "en train d'écrire..."
- **Abonnements façon Instagram** : demande d'abonnement avec acceptation requise avant de pouvoir écrire à quelqu'un
- **Stories** : photo/vidéo, expiration automatique après 24h, likes, commentaires, repartage, liste des personnes qui ont vu
- **Fil de publications** : texte et/ou média, likes, commentaires, repartage, favoris
- **Profils** : bio, avatar, compteurs abonnés/abonnements, badges
- **Notifications temps réel** : likes, commentaires, repartages, messages, demandes d'abonnement
- **Panel d'administration** : statistiques globales, gestion des utilisateurs, attribution de badges, blocage de comptes. Le tout premier compte créé devient automatiquement administrateur.
- **Base de données Postgres (Supabase)** : données persistantes, ne disparaissent pas au redéploiement

## Installation

```bash
cd backend
npm install
cp .env.example .env   # renseigne JWT_SECRET et DATABASE_URL (voir ci-dessous)
npm start
```

Le serveur démarre sur **http://localhost:4000** et sert aussi le frontend directement (ouvre `http://localhost:4000` dans ton navigateur).

### Base de données : Supabase (Postgres)

Kalchat utilise [Supabase](https://supabase.com) comme base de données Postgres externe et persistante.

1. Crée un compte gratuit sur [supabase.com](https://supabase.com) et un nouveau projet
2. Va dans **Project Settings → Database → Connection string → URI** (choisis le mode **Session pooler** si tu es sur un plan gratuit Render)
3. Copie cette URL dans `DATABASE_URL` (dans `.env` en local, ou dans les variables d'environnement Render en production)
4. Au premier démarrage, le serveur crée automatiquement toutes les tables nécessaires — rien à faire manuellement côté SQL

## Structure du projet

```
kalchat/
├── backend/
│   ├── server.js              # Serveur Express + Socket.io + upload
│   ├── db.js                  # Connexion Postgres (Supabase) + schéma
│   ├── notify.js               # Création + diffusion temps réel des notifications
│   ├── routes/
│   │   ├── auth.js            # Inscription / connexion / recherche
│   │   ├── chat.js            # Conversations, groupes, messages
│   │   ├── stories.js         # Stories (24h)
│   │   ├── posts.js           # Fil de publications
│   │   ├── users.js           # Profils, abonnements
│   │   ├── notifications.js   # Notifications
│   │   └── admin.js           # Panel admin (stats, badges, blocage)
│   └── middleware/
│       ├── auth.js            # Vérification du JWT + statut bloqué
│       └── admin.js           # Vérification du rôle admin
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js               # Logique client (fetch + Socket.io)
```

## Déploiement en ligne (Render — gratuit)

1. Mets ton projet sur GitHub (crée un repo, push le dossier `kalchat/`).
2. Va sur [render.com](https://render.com) → crée un compte gratuit (avec GitHub).
3. **New +** → **Web Service** → connecte ton repo.
4. Render détecte automatiquement `render.yaml` à la racine et pré-remplit tout.
5. Ajoute manuellement la variable d'environnement `DATABASE_URL` (chaîne de connexion Supabase) dans **Environment** — elle n'est pas générée automatiquement.
6. Clique **Create Web Service**. Après le build, ton app est en ligne sur une URL du type `https://kalchat.onrender.com`.

### ⚠️ Limites du plan gratuit Render à connaître

- **Le service "s'endort"** après 15 min d'inactivité, puis redémarre (quelques secondes de délai) à la prochaine visite.
- **Les fichiers uploadés** (`backend/uploads/`) sont stockés localement sur Render et sont **réinitialisés à chaque redéploiement** (contrairement aux données en base, qui elles sont désormais permanentes grâce à Supabase). Pour des médias qui durent, il faudrait migrer vers un stockage externe (Supabase Storage, Cloudinary...).

## Pistes d'amélioration

- Mot de passe oublié / réinitialisation
- Rôles plus fins (modérateur, etc.)
- Bloquer un utilisateur (différent de se désabonner) + signalement de contenu
- Statut lu/non lu des messages, indicateur de présence en ligne
- Stockage externe des médias (au-delà du disque local Render)
- App mobile (React Native) réutilisant les mêmes routes API
- Chiffrement de bout en bout des messages

## Notes techniques

- Les fichiers uploadés sont stockés dans `backend/uploads/` et servis statiquement.
- Les stories expirées sont nettoyées automatiquement à chaque appel de `/api/stories/feed`.
- Pense à changer `JWT_SECRET` avant de mettre en ligne (Render peut le générer automatiquement).
