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
const http = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const STORAGE_MODE = (process.env.STORAGE_MODE || 'SFTP').toUpperCase(); // 'FTP' | 'SFTP'
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10);
const PUBLIC_FILE_BASE_URL = (process.env.PUBLIC_FILE_BASE_URL || '').replace(/\/+$/, '');

const DATA_DIR = path.join(__dirname, 'data');
const CONTRIBUTIONS_FILE = path.join(DATA_DIR, 'contributions.json');
const TMP_UPLOAD_DIR = path.join(__dirname, 'tmp_uploads');

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
  const raw = fs.readFileSync(CONTRIBUTIONS_FILE, 'utf-8');
  try {
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('⚠️  contributions.json corrompu, réinitialisation.', err);
    return [];
  }
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
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype === 'application/pdf') return 'pdf';
  return 'autre';
}

function getPublicFileUrl(remoteFilename) {
  if (!PUBLIC_FILE_BASE_URL) return null;
  return `${PUBLIC_FILE_BASE_URL}/${encodeURIComponent(remoteFilename)}`;
}

function getPublicFileUrls(remoteFilename) {
  const baseUrls = [];
  const rawBases = [];

  if (PUBLIC_FILE_BASE_URL) rawBases.push(PUBLIC_FILE_BASE_URL);
  if (rawBases.length === 0) return [];

  const seen = new Set();
  for (const base of rawBases) {
    const variants = [base, base.replace(/^https:\/\//i, 'http://'), base.replace(/^http:\/\//i, 'https://')];
    for (const variant of variants) {
      const cleaned = (variant || '').replace(/\/+$/, '');
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      baseUrls.push(cleaned);
    }
  }

  return baseUrls.map((base) => `${base}/${encodeURIComponent(remoteFilename)}`);
}

function getTemporaryMediaProxyUrl(remoteFilename) {
  return `/api/media/${encodeURIComponent(remoteFilename)}`;
}

// ---------------------------------------------------------------------------
// Transfert vers le serveur distant (FTP ou SFTP selon la configuration)
// ---------------------------------------------------------------------------

async function ensureRemoteDirFtp(client, remoteDir) {
  const dir = (remoteDir || '').trim();
  if (!dir || dir === '.' || dir === '/') return;

  try {
    await client.ensureDir(dir);
  } catch (err) {
    console.warn(`⚠️  Dossier FTP inaccessible (${dir}), utilisation du dossier par défaut du compte : ${err.message || err}`);
  }
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

    const remoteDir = process.env.FTP_REMOTE_DIR || '.';
    await ensureRemoteDirFtp(client, remoteDir);
    await client.uploadFrom(localPath, buildRemotePath(remoteDir, remoteFilename));
  } finally {
    client.close();
  }
}

function buildRemotePath(remoteDir, remoteFilename) {
  const dir = (remoteDir || '.').trim();
  if (!dir || dir === '.') return remoteFilename;
  if (dir === '/') return `/${remoteFilename}`;
  return `${dir.replace(/\/+$/, '')}/${remoteFilename}`;
}

async function resolveSftpRemoteDir(sftp, configuredRemoteDir) {
  const normalized = (configuredRemoteDir || '').trim();
  const candidates = [];

  if (normalized && normalized !== '.' && normalized !== '/') {
    candidates.push(normalized);
    if (normalized.startsWith('/')) {
      candidates.push(normalized.replace(/\/+$/, ''));
    }
  }

  candidates.push('.');

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate || '.';
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const exists = await sftp.exists(key);
      if (!exists && key !== '.') {
        await sftp.mkdir(key, true);
      }
      return key;
    } catch (err) {
      const message = String(err?.message || err || '');
      console.warn(`⚠️  Dossier SFTP inaccessible (${key}) : ${message}`);
    }
  }

  return '.';
}

async function verifyRemoteUploadSftp(sftp, remoteDir, remoteFilename) {
  const remotePath = buildRemotePath(remoteDir, remoteFilename);
  const exists = await sftp.exists(remotePath);
  if (!exists) {
    throw new Error(`Le fichier distant ${remotePath} n’a pas été trouvé après l’envoi.`);
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

    const remoteDir = await resolveSftpRemoteDir(sftp, process.env.SFTP_REMOTE_DIR || '.');
    const remotePath = buildRemotePath(remoteDir, remoteFilename);
    await sftp.put(localPath, remotePath);
    await verifyRemoteUploadSftp(sftp, remoteDir, remoteFilename);
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
        url: getPublicFileUrl(remoteFilename),
        proxyUrl: getTemporaryMediaProxyUrl(remoteFilename),
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

// --- Proxy temporaire pour servir les médias sur le site local ---
function downloadRemoteMedia(remoteUrl) {
  return new Promise((resolve, reject) => {
    const client = remoteUrl.startsWith('https://') ? https : http;
    const requestOptions = remoteUrl.startsWith('https://') ? { rejectUnauthorized: false } : {};

    const req = client.get(remoteUrl, requestOptions, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadRemoteMedia(new URL(response.headers.location, remoteUrl).toString())
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        const error = new Error(`HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        response.resume();
        reject(error);
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
  });
}

app.get('/api/media/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename || '');
  if (!filename) {
    return res.status(400).json({ success: false, message: 'Nom de fichier manquant.' });
  }

  const candidateUrls = getPublicFileUrls(filename);
  if (candidateUrls.length === 0) {
    return res.status(404).json({ success: false, message: 'Aucune base publique configurée.' });
  }

  let lastError = null;

  for (const remoteUrl of candidateUrls) {
    try {
      const mediaBuffer = await downloadRemoteMedia(remoteUrl);
      const contentType = remoteUrl.toLowerCase().endsWith('.mp4') || remoteUrl.toLowerCase().endsWith('.mov') || remoteUrl.toLowerCase().endsWith('.webm')
        ? 'video/mp4'
        : remoteUrl.toLowerCase().endsWith('.jpg') || remoteUrl.toLowerCase().endsWith('.jpeg')
          ? 'image/jpeg'
          : remoteUrl.toLowerCase().endsWith('.png')
            ? 'image/png'
            : remoteUrl.toLowerCase().endsWith('.gif')
              ? 'image/gif'
              : remoteUrl.toLowerCase().endsWith('.webp')
                ? 'image/webp'
                : 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(mediaBuffer);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  console.error('Erreur proxy média HTTP pour', filename, lastError);
  res.status(502).json({ success: false, message: 'Impossible de télécharger le média depuis le stockage distant.' });
});

// --- Route de santé (utile pour vérifier que le serveur tourne) ---
app.get('/api/health', (req, res) => {
  res.json({ success: true, storageMode: STORAGE_MODE });
});

app.listen(PORT, () => {
  console.log(`🎉 Site anniversaire de Clémence lancé sur http://localhost:${PORT}`);
  console.log(`📦 Mode de stockage distant : ${STORAGE_MODE}`);
});
