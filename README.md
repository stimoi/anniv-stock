# 🎉 Pour Clémence — Carnet de souvenirs d'anniversaire

Site permettant aux amis de Clémence de déposer photos, vidéos et mots doux.
Les fichiers sont transférés automatiquement vers un serveur distant en **FTP ou SFTP**,
et un registre public (`data/contributions.json`) garde la trace de qui a déposé quoi.

## 📁 Structure du projet

```
anniv-clemence/
├── server.js                # Backend Express (upload, FTP/SFTP, registre JSON)
├── package.json
├── .env.example              # Modèle de configuration à copier en .env
├── data/
│   └── contributions.json    # Registre des dépôts (créé automatiquement si absent)
├── tmp_uploads/               # Zone de transit locale avant envoi FTP/SFTP (auto-nettoyée)
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 🚀 Installation

1. **Prérequis** : Node.js ≥ 18.

2. **Installer les dépendances**

   ```bash
   npm install
   ```

3. **Configurer l'environnement**

   Copie le fichier d'exemple puis renseigne tes accès FTP ou SFTP :

   ```bash
   cp .env.example .env
   ```

   Dans `.env`, choisis le mode de stockage :

   ```env
   STORAGE_MODE=SFTP     # ou FTP
   ```

   Puis complète la section correspondante (`SFTP_*` ou `FTP_*`) avec l'hôte, le port,
   l'utilisateur, le mot de passe (ou la clé privée pour SFTP) et le dossier distant cible.

4. **Lancer le serveur**

   ```bash
   npm start
   ```

   Le site est alors accessible sur **http://localhost:3000** (ou le port défini par `PORT`).

   Pour le développement avec rechargement automatique :

   ```bash
   npm run dev
   ```

## 🧠 Comment ça marche

- **Identification légère** : au premier passage, une fenêtre demande un prénom/surnom,
  stocké dans le `localStorage` du navigateur — pas de compte, pas de mot de passe.
- **Upload** : les fichiers sont d'abord reçus dans `tmp_uploads/` (via `multer`),
  renommés au format `Prenom_Timestamp_NomOriginal.ext`, envoyés vers le serveur
  FTP ou SFTP configuré, puis supprimés localement.
- **Registre** : chaque dépôt réussi ajoute une ligne dans `data/contributions.json`
  (`id`, `prenom`, `nom_fichier_original`, `nom_fichier_serveur`, `categorie`, `date`).
- **Galerie communautaire** : la page affiche un résumé par personne
  ("Alexandre a envoyé 3 photos et 1 vidéo") ainsi qu'un fil chronologique de tous les dépôts,
  actualisé automatiquement toutes les 20 secondes.

## ⚙️ Variables d'environnement principales

| Variable | Description |
|---|---|
| `STORAGE_MODE` | `FTP` ou `SFTP` |
| `PORT` | Port d'écoute du serveur Express (défaut `3000`) |
| `MAX_FILE_SIZE_MB` | Taille maximale autorisée par fichier |
| `FTP_HOST`, `FTP_PORT`, `FTP_USER`, `FTP_PASSWORD`, `FTP_SECURE`, `FTP_REMOTE_DIR` | Config FTP |
| `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_PRIVATE_KEY_PATH`, `SFTP_REMOTE_DIR` | Config SFTP |

## 🔒 Notes de sécurité / production

- Le fichier `.env` ne doit **jamais** être commité (déjà exclu via `.gitignore`).
- `data/contributions.json` n'est pas conçu pour une très forte concurrence ; pour un
  usage "entre amis" ponctuel (anniversaire), c'est largement suffisant.
- Pense à limiter `MAX_FILE_SIZE_MB` selon la bande passante de ton hébergement.
- Si tu déploies publiquement, ajoute un reverse proxy (Nginx/Caddy) avec HTTPS.
