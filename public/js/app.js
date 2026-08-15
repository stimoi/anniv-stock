(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Constantes / éléments DOM
  // ---------------------------------------------------------------------
  const STORAGE_KEY = 'clemence_anniv_prenom';

  const nameModalOverlay = document.getElementById('nameModalOverlay');
  const nameForm = document.getElementById('nameForm');
  const nameInput = document.getElementById('nameInput');

  const currentUserBadge = document.getElementById('currentUserBadge');
  const currentUserName = document.getElementById('currentUserName');
  const changeNameBtn = document.getElementById('changeNameBtn');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileListEl = document.getElementById('fileList');
  const uploadForm = document.getElementById('uploadForm');
  const submitBtn = document.getElementById('submitBtn');
  const uploadStatus = document.getElementById('uploadStatus');

  const summaryGrid = document.getElementById('summaryGrid');
  const summaryEmpty = document.getElementById('summaryEmpty');
  const feedList = document.getElementById('feedList');
  const feedItemTemplate = document.getElementById('feedItemTemplate');
  const previewModalOverlay = document.getElementById('previewModalOverlay');
  const previewModalImage = document.getElementById('previewModalImage');
  const previewModalVideo = document.getElementById('previewModalVideo');
  const previewModalAudio = document.getElementById('previewModalAudio');
  const previewDownloadLink = document.getElementById('previewDownloadLink');
  const closePreviewBtn = document.getElementById('closePreviewBtn');

  let selectedFiles = [];
  const previewUrls = new Map();
  const localPreviewById = new Map();

  const AVATAR_COLORS = ['#F2A6B0', '#E8B23D', '#3E8983', '#C97B84', '#D9A441', '#5AA39C'];

  // ---------------------------------------------------------------------
  // Identification (prénom / surnom en localStorage)
  // ---------------------------------------------------------------------
  function getStoredName() {
    return (localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function setStoredName(name) {
    localStorage.setItem(STORAGE_KEY, name.trim());
  }

  function showNameModal() {
    nameModalOverlay.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 50);
  }

  function hideNameModal() {
    nameModalOverlay.classList.add('hidden');
  }

  function refreshUserBadge() {
    const name = getStoredName();
    if (name) {
      currentUserName.textContent = name;
      currentUserBadge.classList.remove('hidden');
      currentUserBadge.classList.add('flex');
    } else {
      currentUserBadge.classList.add('hidden');
      currentUserBadge.classList.remove('flex');
    }
  }

  function initIdentification() {
    const existing = getStoredName();
    if (!existing) {
      showNameModal();
    }
    refreshUserBadge();
  }

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = nameInput.value.trim();
    if (!value) return;
    setStoredName(value);
    refreshUserBadge();
    hideNameModal();
  });

  changeNameBtn.addEventListener('click', () => {
    nameInput.value = getStoredName();
    showNameModal();
  });

  // ---------------------------------------------------------------------
  // Sélection des fichiers (drag & drop + input classique)
  // ---------------------------------------------------------------------
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  function addFiles(fileListObj) {
    const newFiles = Array.from(fileListObj);
    selectedFiles = selectedFiles.concat(newFiles);
    renderFileList();
  }

  function getFilePreviewKey(file) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  function getFilePreviewUrl(file) {
    if (!file || (!file.type.startsWith('image/') && !file.type.startsWith('video/'))) return null;

    const key = getFilePreviewKey(file);
    if (!previewUrls.has(key)) {
      previewUrls.set(key, URL.createObjectURL(file));
    }
    return previewUrls.get(key);
  }

  function revokeFilePreviewUrl(file) {
    if (!file) return;

    const key = getFilePreviewKey(file);
    const url = previewUrls.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrls.delete(key);
    }
  }

  function removeFile(index) {
    const file = selectedFiles[index];
    revokeFilePreviewUrl(file);
    selectedFiles.splice(index, 1);
    renderFileList();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  function fileEmoji(file) {
    if (file.type.startsWith('image/')) return '🖼️';
    if (file.type.startsWith('video/')) return '🎬';
    if (file.type === 'application/pdf') return '📄';
    return '💌';
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    selectedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-chip';

      const previewUrl = getFilePreviewUrl(file);
      const previewMarkup = previewUrl
        ? (file.type.startsWith('image/')
          ? `<img src="${previewUrl}" alt="${escapeHtml(file.name)}" class="file-thumb" />`
          : `<video src="${previewUrl}" muted playsinline class="file-thumb video-thumb"></video>`)
        : `<span class="file-thumb file-thumb--fallback">${fileEmoji(file)}</span>`;

      li.innerHTML = `
        <span class="file-chip__content">
          <span class="file-preview">${previewMarkup}</span>
          <span class="file-meta min-w-0">
            <span class="truncate">${escapeHtml(file.name)}</span>
            <span class="text-plum/40 flex-shrink-0">(${formatBytes(file.size)})</span>
          </span>
        </span>
        <button type="button" data-index="${index}" aria-label="Retirer ce fichier">✕</button>
      `;
      li.querySelector('button').addEventListener('click', () => removeFile(index));
      fileListEl.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // Envoi des fichiers au backend
  // ---------------------------------------------------------------------
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const prenom = getStoredName();
    if (!prenom) {
      showNameModal();
      return;
    }

    if (selectedFiles.length === 0) {
      showStatus('Choisis au moins un fichier avant d\'envoyer 🙂', 'warn');
      return;
    }

    const formData = new FormData();
    formData.append('prenom', prenom);
    selectedFiles.forEach((file) => formData.append('files', file));

    setSubmitting(true);
    showStatus('Envoi en cours… merci de patienter, les vidéos peuvent prendre un peu de temps.', 'info');

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Une erreur est survenue pendant l\'envoi.');
      }

      showStatus(data.message || 'Souvenir(s) envoyé(s) avec succès ✦', 'success');

      (data.contributions || []).forEach((entry, index) => {
        const file = selectedFiles[index];
        if (file) {
          const previewUrl = getFilePreviewUrl(file);
          if (previewUrl && (entry.categorie === 'photo' || entry.categorie === 'video')) {
            localPreviewById.set(entry.id, previewUrl);
          }
        }
      });

      selectedFiles.forEach((file) => revokeFilePreviewUrl(file));
      selectedFiles = [];
      previewUrls.clear();
      renderFileList();
      await loadContributions();
    } catch (err) {
      console.error(err);
      showStatus(err.message || 'Impossible d\'envoyer les fichiers pour le moment.', 'error');
    } finally {
      setSubmitting(false);
    }
  });

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting ? 'Envoi en cours…' : 'Envoyer mes souvenirs';
  }

  function showStatus(message, type) {
    uploadStatus.classList.remove('hidden');
    uploadStatus.textContent = message;
    const colors = {
      success: 'text-teal-dark',
      error: 'text-[#9A4C55]',
      warn: 'text-[#9A6C1D]',
      info: 'text-plum/70',
    };
    uploadStatus.className = `mt-4 text-sm ${colors[type] || 'text-plum/70'}`;
  }

  // ---------------------------------------------------------------------
  // Registre / galerie communautaire
  // ---------------------------------------------------------------------
  function initialsOf(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function categoryLabel(category, count) {
    const plural = count > 1 ? 's' : '';
    const labels = {
      photo: `photo${plural}`,
      video: `vidéo${plural}`,
      pdf: `document${plural}`,
      autre: `fichier${plural}`,
    };
    return labels[category] || labels.autre;
  }

  function categoryEmoji(category) {
    return { photo: '🖼️', video: '🎬', pdf: '📄', autre: '💌' }[category] || '💌';
  }

  function buildSummary(contributions) {
    const byPerson = new Map();
    contributions.forEach((c) => {
      if (!byPerson.has(c.prenom)) byPerson.set(c.prenom, {});
      const cats = byPerson.get(c.prenom);
      cats[c.categorie] = (cats[c.categorie] || 0) + 1;
    });
    return byPerson;
  }

  function renderSummary(contributions) {
    const byPerson = buildSummary(contributions);
    summaryGrid.innerHTML = '';

    if (byPerson.size === 0) {
      summaryEmpty.classList.remove('hidden');
      return;
    }
    summaryEmpty.classList.add('hidden');

    // Trie par nombre total décroissant de contributions
    const entries = Array.from(byPerson.entries()).sort((a, b) => {
      const totalA = Object.values(a[1]).reduce((s, n) => s + n, 0);
      const totalB = Object.values(b[1]).reduce((s, n) => s + n, 0);
      return totalB - totalA;
    });

    entries.forEach(([prenom, cats]) => {
      const parts = Object.entries(cats)
        .map(([cat, count]) => `${count} ${categoryLabel(cat, count)}`)
        .join(', ');

      const card = document.createElement('div');
      card.className = 'summary-card flex items-center gap-4';
      card.innerHTML = `
        <div class="avatar" style="background:${colorForName(prenom)}">${escapeHtml(initialsOf(prenom))}</div>
        <div class="min-w-0">
          <p class="font-semibold text-cream truncate">${escapeHtml(prenom)}</p>
          <p class="text-cream/60 text-sm">${escapeHtml(parts)}</p>
        </div>
      `;
      summaryGrid.appendChild(card);
    });
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function openPreviewModal(url, type, downloadUrl) {
    previewModalImage.classList.add('hidden');
    previewModalVideo.classList.add('hidden');
    previewModalAudio.classList.add('hidden');
    previewModalAudio.pause();
    previewModalAudio.removeAttribute('src');
    previewDownloadLink.classList.add('hidden');

    if (type === 'image') {
      previewModalImage.src = url;
      previewModalImage.classList.remove('hidden');
    } else if (type === 'video') {
      previewModalVideo.src = url;
      previewModalVideo.classList.remove('hidden');
      previewModalVideo.play().catch(() => {});
    } else if (type === 'audio') {
      previewModalAudio.src = url;
      previewModalAudio.classList.remove('hidden');
      previewModalAudio.load();
    }

    if (downloadUrl) {
      previewDownloadLink.href = downloadUrl;
      previewDownloadLink.setAttribute('download', downloadUrl.split('/').pop());
      previewDownloadLink.classList.remove('hidden');
    }

    previewModalOverlay.classList.remove('hidden');
  }

  function closePreviewModal() {
    previewModalOverlay.classList.add('hidden');
    previewModalImage.src = '';
    previewModalVideo.pause();
    previewModalVideo.src = '';
    previewModalAudio.pause();
    previewModalAudio.src = '';
    previewDownloadLink.href = '#';
    previewDownloadLink.classList.add('hidden');
  }

  function getMediaCandidates(c) {
    const rawCandidates = [localPreviewById.get(c.id), c.proxyUrl, c.url, c.previewUrl].filter(Boolean);
    const candidates = [];
    const seen = new Set();

    rawCandidates.forEach((candidate) => {
      const variants = [candidate, candidate.replace(/^https:\/\//i, 'http://'), candidate.replace(/^http:\/\//i, 'https://')];
      variants.forEach((variant) => {
        if (!variant || seen.has(variant)) return;
        seen.add(variant);
        candidates.push(variant);
      });
    });

    return candidates;
  }

  function attachMediaFallback(element, candidates, type) {
    let currentIndex = 0;

    const tryNextSource = () => {
      if (currentIndex >= candidates.length - 1) return;
      currentIndex += 1;
      if (type === 'image') {
        element.src = candidates[currentIndex];
      } else {
        element.src = candidates[currentIndex];
        element.load();
      }
    };

    element.addEventListener('error', () => {
      tryNextSource();
    });

    return candidates[0];
  }

  function getContributionPreview(c) {
    const candidates = getMediaCandidates(c);
    if (candidates.length === 0) return null;

    if (c.categorie === 'photo' || c.categorie === 'video') {
      const tag = c.categorie === 'photo' ? 'img' : 'video';
      const extra = c.categorie === 'video' ? 'muted playsinline preload="metadata"' : 'alt="Miniature"';
      const firstUrl = candidates[0];
      const html = `<${tag} src="${firstUrl}" ${extra} class="feed-preview-${c.categorie === 'photo' ? 'image' : 'video'}" />`;
      return {
        html,
        url: firstUrl,
        type: c.categorie === 'photo' ? 'image' : 'video',
        candidates,
        downloadUrl: c.proxyUrl || c.url || firstUrl,
      };
    }

    if (c.categorie === 'audio') {
      const firstUrl = candidates[0];
      const html = `<audio src="${firstUrl}" controls preload="metadata" class="feed-preview-audio"></audio>`;
      return {
        html,
        url: firstUrl,
        type: 'audio',
        candidates,
        downloadUrl: c.proxyUrl || c.url || firstUrl,
      };
    }

    return null;
  }

  function renderFeed(contributions) {
    feedList.innerHTML = '';

    if (contributions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-center text-cream/50 italic';
      empty.textContent = "Le fil est vide pour l'instant… le premier souvenir n'attend que toi ✦";
      feedList.appendChild(empty);
      return;
    }

    contributions.forEach((c) => {
      const node = feedItemTemplate.content.cloneNode(true);
      const iconEl = node.querySelector('.feed-icon');
      const preview = getContributionPreview(c);

      if (preview) {
        iconEl.classList.add('feed-preview-shell');
        iconEl.innerHTML = preview.html;
        iconEl.setAttribute('role', 'button');
        iconEl.setAttribute('tabindex', '0');

        const mediaEl = iconEl.querySelector(preview.type === 'photo' ? 'img' : 'video');
        if (mediaEl && preview.candidates && preview.candidates.length > 1) {
          attachMediaFallback(mediaEl, preview.candidates, preview.type);
        }

        const clickHandler = () => openPreviewModal(preview.url, preview.type, preview.downloadUrl);
        iconEl.addEventListener('click', clickHandler);
        iconEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            clickHandler();
          }
        });
      } else {
        iconEl.textContent = categoryEmoji(c.categorie);
      }

      node.querySelector('.feed-author').textContent = c.prenom;
      node.querySelector('.feed-filename').textContent = c.nom_fichier_original;
      node.querySelector('.feed-date').textContent = formatDate(c.date);

      const downloadLink = node.querySelector('.feed-download');
      const downloadUrl = c.proxyUrl || c.url || '#';
      downloadLink.href = downloadUrl;
      downloadLink.setAttribute('download', c.nom_fichier_original || 'souvenir');
      downloadLink.setAttribute('title', `Télécharger ${c.nom_fichier_original || 'le fichier'}`);

      feedList.appendChild(node);
    });
  }

  async function loadContributions() {
    try {
      const res = await fetch('/api/contributions');
      const data = await res.json();
      if (!data.success) throw new Error('Réponse invalide du serveur.');
      renderSummary(data.contributions);
      renderFeed(data.contributions);
    } catch (err) {
      console.error('Erreur de chargement du registre :', err);
      feedList.innerHTML = '<p class="text-center text-cream/50">Impossible de charger le registre pour le moment.</p>';
    }
  }

  closePreviewBtn.addEventListener('click', closePreviewModal);

  previewModalOverlay.addEventListener('click', (event) => {
    if (event.target === previewModalOverlay) closePreviewModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !previewModalOverlay.classList.contains('hidden')) {
      closePreviewModal();
    }
  });

  // ---------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------
  initIdentification();
  loadContributions();
  // Rafraîchit le fil régulièrement pour voir les dépôts des autres
  setInterval(loadContributions, 20000);
})();
