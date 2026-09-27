require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ftp = require('basic-ftp');
const SftpClient = require('ssh2-sftp-client');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const STORAGE_MODE = (process.env.STORAGE_MODE || 'SFTP').toUpperCase(); // 'FTP' | 'SFTP'
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10);

const DATA_DIR = path.join(__dirname, 'data');
const CONTRIBUTIONS_FILE = path.join(DATA_DIR, 'contributions.json');
const TMP_UPLOAD_DIR = path.join(__dirname, 'tmp_uploads');
const REMOTE_CONTRIBUTIONS_FILENAME = process.env.REMOTE_CONTRIBUTIONS_FILENAME || 'contributions.json';

// S'assure que les dossiers/fichiers nécessaires existent au démarrage
function ensureLocalStructure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TMP_UPLOAD_DIR)) fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(CONTRIBUTIONS_FILE)) {
    fs.writeFileSync(CONTRIBUTIONS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}
ensureLocalStructure();

// ---------------------------------------------------------------------------
// Registre des contributions (fichier JSON local, façon mini base de données)
// ---------------------------------------------------------------------------
// Verrou simple pour éviter les écritures concurrentes qui s'écrasent
let writeQueue = Promise.resolve();

function readContributions() {
  try {
    const raw = fs.readFileSync(CONTRIBUTIONS_FILE, 'utf-8');
    const contributions = JSON.parse(raw || '[]');
    if (!Array.isArray(contributions)) throw new Error('Le contenu doit être un tableau.');
    return contributions;
  } catch (err) {
    console.error('⚠️  contributions.json corrompu, réinitialisation.', err);
    fs.writeFileSync(CONTRIBUTIONS_FILE, '[]\n', 'utf-8');
    return [];
  }
}

function hasRemoteStorageConfiguration() {
  return STORAGE_MODE === 'FTP'
    ? Boolean(process.env.FTP_HOST && process.env.FTP_USER)
    : Boolean(process.env.SFTP_HOST && process.env.SFTP_USER);
}

function appendContribution(entry) {
  // On chaîne les écritures pour rester séquentiel même avec plusieurs uploads simultanés
  writeQueue = writeQueue.then(async () => {
    const current = readContributions();
    current.push(entry);
    await fsp.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(current, null, 2), 'utf-8');
  });
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Upload local temporaire (multer) avant transfert vers FTP/SFTP
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Nom temporaire unique, le renommage "définitif" se fait au moment du transfert
    cb(null, `${uuidv4()}__${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

// Nettoie un prénom pour un usage sûr dans un nom de fichier
function sanitizeForFilename(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40) || 'Anonyme';
}

// Construit le nom de fichier final : Prenom_Timestamp_NomOriginal.ext
function buildRemoteFilename(prenom, originalName) {
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const safePrenom = sanitizeForFilename(prenom);
  const safeBaseName = sanitizeForFilename(baseName);
  return `${safePrenom}_${timestamp}_${safeBaseName}${ext}`;
}

function getFileCategory(mimetype) {
  if (!mimetype) return 'autre';
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype === 'application/pdf') return 'pdf';
  return 'autre';
}

// ---------------------------------------------------------------------------
// Transfert vers le serveur distant (FTP ou SFTP selon la configuration)
// ---------------------------------------------------------------------------

async function ensureRemoteDirFtp(client, remoteDir) {
  await client.ensureDir(remoteDir);
  // ensureDir change le répertoire courant vers remoteDir, on remonte à la racine ensuite si besoin
}

async function uploadViaFtp(localPath, remoteFilename) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      port: parseInt(process.env.FTP_PORT || '21', 10),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: process.env.FTP_SECURE === 'true',
    });

    const remoteDir = process.env.FTP_REMOTE_DIR || '/';
    await ensureRemoteDirFtp(client, remoteDir);
    await client.uploadFrom(localPath, remoteFilename);
  } finally {
    client.close();
  }
}

async function uploadViaSftp(localPath, remoteFilename) {
  const sftp = new SftpClient();
  try {
    const connectOptions = {
      host: process.env.SFTP_HOST,
      port: parseInt(process.env.SFTP_PORT || '22', 10),
      username: process.env.SFTP_USER,
    };

    if (process.env.SFTP_PRIVATE_KEY_PATH) {
      connectOptions.privateKey = await fsp.readFile(process.env.SFTP_PRIVATE_KEY_PATH);
    } else {
      connectOptions.password = process.env.SFTP_PASSWORD;
    }

    await sftp.connect(connectOptions);

    const remoteDir = process.env.SFTP_REMOTE_DIR || '/';
    const dirExists = await sftp.exists(remoteDir);
    if (!dirExists) {
      await sftp.mkdir(remoteDir, true);
    }

    const remotePath = `${remoteDir.replace(/\/$/, '')}/${remoteFilename}`;
    await sftp.put(localPath, remotePath);
  } finally {
    await sftp.end();
  }
}

async function uploadToRemoteStorage(localPath, remoteFilename) {
  if (STORAGE_MODE === 'FTP') {
    return uploadViaFtp(localPath, remoteFilename);
  }
  return uploadViaSftp(localPath, remoteFilename);
}

async function downloadRemoteContributions() {
  if (!hasRemoteStorageConfiguration()) return null;

  const localPath = path.join(TMP_UPLOAD_DIR, `remote-${uuidv4()}.json`);
  try {
    if (STORAGE_MODE === 'FTP') {
      const client = new ftp.Client();
      client.ftp.verbose = false;
      try {
        await client.access({
          host: process.env.FTP_HOST,
          port: parseInt(process.env.FTP_PORT || '21', 10),
          user: process.env.FTP_USER,
          password: process.env.FTP_PASSWORD,
          secure: process.env.FTP_SECURE === 'true',
        });
        await ensureRemoteDirFtp(client, process.env.FTP_REMOTE_DIR || '/');
        await client.downloadTo(localPath, REMOTE_CONTRIBUTIONS_FILENAME);
      } finally {
        client.close();
      }
    } else {
      const sftp = new SftpClient();
      try {
        const connectOptions = {
          host: process.env.SFTP_HOST,
          port: parseInt(process.env.SFTP_PORT || '22', 10),
          username: process.env.SFTP_USER,
        };
        if (process.env.SFTP_PRIVATE_KEY_PATH) {
          connectOptions.privateKey = await fsp.readFile(process.env.SFTP_PRIVATE_KEY_PATH);
        } else {
          connectOptions.password = process.env.SFTP_PASSWORD;
        }
        await sftp.connect(connectOptions);
        const remoteDir = process.env.SFTP_REMOTE_DIR || '/';
        const remotePath = `${remoteDir.replace(/\/$/, '')}/${REMOTE_CONTRIBUTIONS_FILENAME}`;
        if (!(await sftp.exists(remotePath))) return null;
        await sftp.get(remotePath, localPath);
      } finally {
        await sftp.end();
      }
    }

    const remoteData = JSON.parse(await fsp.readFile(localPath, 'utf-8'));
    if (!Array.isArray(remoteData)) throw new Error('Le fichier distant doit contenir un tableau.');
    return remoteData;
  } catch (err) {
    if (err.code === 550 || /no such file|not found/i.test(err.message)) return null;
    console.error(`⚠️  Impossible de charger ${REMOTE_CONTRIBUTIONS_FILENAME} depuis ${STORAGE_MODE} :`, err.message);
    return null;
  } finally {
    await fsp.unlink(localPath).catch(() => {});
  }
}

async function saveContributionsToRemote() {
  if (!hasRemoteStorageConfiguration()) {
    console.warn(`⚠️  Sauvegarde ${STORAGE_MODE} ignorée : configuration distante absente.`);
    return;
  }

  const localPath = path.join(TMP_UPLOAD_DIR, `backup-${uuidv4()}.json`);
  try {
    await fsp.writeFile(localPath, `${JSON.stringify(readContributions(), null, 2)}\n`, 'utf-8');
    await uploadToRemoteStorage(localPath, REMOTE_CONTRIBUTIONS_FILENAME);
    console.log(`💾 Sauvegarde automatique effectuée (${STORAGE_MODE}).`);
  } catch (err) {
    console.error(`⚠️  Échec de la sauvegarde ${STORAGE_MODE} :`, err.message);
  } finally {
    await fsp.unlink(localPath).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Application Express
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Route : liste des contributions (registre public) ---
app.get('/api/contributions', (req, res) => {
  try {
    const contributions = readContributions().sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
    res.json({ success: true, contributions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Impossible de lire le registre." });
  }
});

// --- Route : upload d'un ou plusieurs fichiers ---
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  const prenom = (req.body.prenom || '').trim();
  const files = req.files || [];

  if (!prenom) {
    // Nettoyage des fichiers déjà écrits sur le disque temporaire
    await Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));
    return res.status(400).json({ success: false, message: 'Le prénom est requis.' });
  }

  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });
  }

  const results = [];
  const errors = [];

  for (const file of files) {
    const remoteFilename = buildRemoteFilename(prenom, file.originalname);
    try {
      await uploadToRemoteStorage(file.path, remoteFilename);

      const entry = {
        id: uuidv4(),
        prenom,
        nom_fichier_original: file.originalname,
        nom_fichier_serveur: remoteFilename,
        categorie: getFileCategory(file.mimetype),
        taille_octets: file.size,
        date: new Date().toISOString(),
      };

      await appendContribution(entry);
      results.push(entry);
    } catch (err) {
      console.error(`Erreur transfert ${STORAGE_MODE} pour ${file.originalname} :`, err);
      errors.push({ file: file.originalname, message: err.message });
    } finally {
      // Le fichier temporaire local n'est plus utile une fois transféré (ou en échec)
      await fsp.unlink(file.path).catch(() => {});
    }
  }

  if (results.length === 0) {
    return res.status(502).json({
      success: false,
      message: `Échec de l'envoi vers le stockage ${STORAGE_MODE}.`,
      errors,
    });
  }

  res.json({
    success: true,
    message: `${results.length} fichier(s) envoyé(s) avec succès.`,
    contributions: results,
    errors: errors.length ? errors : undefined,
  });
});

// --- Route de santé (utile pour vérifier que le serveur tourne) ---
app.get('/api/health', (req, res) => {
  res.json({ success: true, storageMode: STORAGE_MODE });
});

function listenOnAvailablePort(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve({ server, port }));
    server.once('error', (err) => {
      if (err.code !== 'EADDRINUSE') return reject(err);
      server.close();
      const nextPort = Number(port) + 1;
      console.warn(`⚠️  Le port ${port} est déjà utilisé, tentative sur ${nextPort}.`);
      listenOnAvailablePort(nextPort).then(resolve).catch(reject);
    });
  });
}

async function startServer() {
  console.log('📖 Chargement du fichier contributions.json...');
  const remoteContributions = await downloadRemoteContributions();
  if (remoteContributions !== null) {
    await fsp.writeFile(
      CONTRIBUTIONS_FILE,
      `${JSON.stringify(remoteContributions, null, 2)}\n`,
      'utf-8'
    );
    console.log(`📥 contributions.json chargé depuis ${STORAGE_MODE}.`);
  }

  const contributions = readContributions();
  console.log(`📖 contributions.json chargé (${contributions.length} contribution(s)).`);

  const { port } = await listenOnAvailablePort(Number(PORT));
  console.log(`🎉 Site anniversaire de Clémence lancé sur http://localhost:${port}`);
  console.log(`📦 Mode de stockage distant : ${STORAGE_MODE}`);
  console.log('⏱️  Première sauvegarde automatique dans 20 secondes.');
  console.log('🔁 Sauvegardes automatiques toutes les 30 secondes ensuite.');

  setTimeout(() => {
    saveContributionsToRemote();
    setInterval(saveContributionsToRemote, 30 * 1000);
  }, 20 * 1000);
}

startServer().catch((err) => {
  console.error('❌ Impossible de démarrer le serveur :', err);
  process.exitCode = 1;
});
