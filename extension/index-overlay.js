// Tutorial Clarity Video Indexing overlay — full-screen canvas UI injected
// into YouTube. Ported from SubTamer's overlay.js (channel organizing +
// video indexing engine), but firewalled off from ordinary SubTamer users:
// activation is validated against Tutorial Clarity's own backend using a
// TC-issued activation key, never a real SubTamer license key.

(function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────────
  const BACKEND = 'https://tutorial-clarity-production.up.railway.app';

  // ── State ──────────────────────────────────────────────────────────────────
  let allSubs = [];   // { id, name, url, avatar }
  let frames  = [];   // { id, title, x, y, width, height, channelIds[] }
  let blocked = []; // { id, name } — channels removed from the index, excluded from future re-scrapes until unblocked
  let overlayEl = null;
  let copiedChannelId = null;   // Ctrl+C clipboard
  let hoveredFrameId  = null;   // frame the mouse is currently over
  let activationKey = '';       // TC-issued key gating video indexing (empty = not activated)
  let newSubIds  = new Set();   // IDs added by the most recent re-scrape; cleared on overlay open

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TOGGLE_INDEX_OVERLAY') toggleOverlay();
  });

  // ── Toggle ─────────────────────────────────────────────────────────────────
  async function toggleOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) {
      overlayEl.remove();
      overlayEl = null;
      return;
    }
    newSubIds.clear();
    try {
      await loadData();
    } catch (e) {
      console.error('[TC Indexing] loadData failed:', e);
    }
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
    renderSubList();
    renderFrames();
    showStartupToast();
    if (allSubs.length === 0) {
      setStatus('Click ↻ to load subscriptions. First click "Subscriptions" then "Show more" (sidebar or the All Subscriptions page both work).', 'info');
    }
  }

  // ── Storage — use local (no sync quota limits) ─────────────────────────────
  async function saveData() {
    try {
      // Strip avatar URLs before saving — they're large CDN strings that expire.
      // Avatars are kept in memory (allSubs) for the current session only.
      const subsToSave = allSubs.map(({ id, name, url }) => ({ id, name, url, avatar: '' }));
      await chrome.storage.local.set({ tcxFrames: frames, tcxSubs: subsToSave, tcxActivationKey: activationKey, tcxBlocked: blocked });
    } catch (e) {
      console.error('[TC Indexing] saveData failed:', e);
      if (!e.message || !e.message.includes('Extension context invalidated')) throw e;
      // Context invalidated after extension update — silently ignore, UI still works
    }
  }

  let hintDismissed = false;

  async function loadData() {
    const data = await chrome.storage.local.get(['tcxFrames', 'tcxSubs', 'tcxActivationKey', 'tcxHintDismissed', 'tcxBlocked']);
    frames         = data.tcxFrames        || [];
    allSubs        = data.tcxSubs          || [];
    activationKey     = data.tcxActivationKey    || '';
    hintDismissed  = data.tcxHintDismissed || false;
    blocked        = data.tcxBlocked       || [];
  }

  // ── Scrape subscriptions from YouTube (sidebar + /feed/channels grid page) ─
  function parseChannelId(href) {
    const handleMatch = href.match(/\/@([^/?]+)/);
    const channelMatch = href.match(/\/channel\/([^/?]+)/);
    return handleMatch ? `@${handleMatch[1]}` : (channelMatch ? channelMatch[1] : null);
  }

  function extractFromEntries(entries, nameSelector, seen, subs) {
    entries.forEach(entry => {
      const link = entry.querySelector('a');
      if (!link) return;
      const href = link.href || '';
      if (!href.includes('/@') && !href.includes('/channel/')) return;

      const channelId = parseChannelId(href);
      if (!channelId || seen.has(channelId)) return;

      const nameEl = entry.querySelector(nameSelector);
      const name = nameEl ? nameEl.textContent.trim() : channelId;
      if (!name) return;

      seen.add(channelId);
      const img = entry.querySelector('img');
      const avatar = img ? img.src : '';
      subs.push({ id: channelId, name, url: href, avatar });
    });
  }

  function extractSubscriptions() {
    const subs = [];
    const seen = new Set();

    // Sidebar (homepage left nav — "Show more" expands inline here)
    extractFromEntries(
      document.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer'),
      'yt-formatted-string, #label, .title',
      seen, subs
    );

    // All-subscriptions grid page (youtube.com/feed/channels — "Show more" now
    // navigates here instead of expanding the sidebar inline)
    extractFromEntries(
      document.querySelectorAll('ytd-channel-renderer'),
      '#text, #channel-title, yt-formatted-string#text',
      seen, subs
    );

    return subs;
  }

  // ── Structural drift detector ───────────────────────────────────────────────
  // Compares what our specific renderer selectors found against a broad,
  // structure-agnostic scan of every channel link on the page. A large gap
  // means YouTube likely changed its markup and our selectors need updating —
  // this is how we catch breakage instead of silently under-scraping.
  function detectStructuralDrift(specificCount) {
    const seen = new Set();
    document.querySelectorAll('a[href*="/@"], a[href*="/channel/"]').forEach(a => {
      if (a.closest('.tcx-overlay')) return; // ignore this overlay's own UI
      const id = parseChannelId(a.href || '');
      if (id) seen.add(id);
    });
    const genericCount = seen.size;

    // Only flag a real gap — generic scan always finds a few extra (related
    // channels, recommendations) so require a meaningful margin.
    if (genericCount > 5 && specificCount < genericCount * 0.7) {
      return { genericCount, specificCount };
    }
    return null;
  }

  // ── Helper ─────────────────────────────────────────────────────────────────
  function mk(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls)  el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function showStartupToast() {
    const toast = document.createElement('div');
    toast.className = 'tcx-toast';
    toast.textContent = 'Tip: If you\'ve added new YouTube subscriptions since last time, go to YouTube and click "Show more" under Subscriptions (sidebar or the All Subscriptions page), then come back here and click ↻ to refresh — otherwise new channels won\'t appear.';
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('tcx-toast-fade');
      setTimeout(() => toast.remove(), 1000);
    }, 8000);
  }

  function setStatus(msg, type) {
    const el = document.getElementById('tcx-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'tcx-status' + (type ? ' ' + type : '');
  }

  // ── Build overlay skeleton ─────────────────────────────────────────────────
  function buildOverlay() {
    const overlay = mk('div', 'tcx-overlay');

    // Escape clears any stuck drag selection
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.tcx-channel-item.tcx-selected')
          .forEach(el => el.classList.remove('tcx-selected'));
        copiedChannelId = null;
      }
    });

    // ── Left panel
    const panel = mk('div', 'tcx-panel');

    const header = mk('div', 'tcx-panel-header');
    const logo = mk('div', 'tcx-logo');
    logo.innerHTML = '🎬 TC <strong>Indexing</strong>';

    const refreshBtn = mk('button', 'tcx-btn-icon', '↻');
    refreshBtn.title = 'Load subscriptions from YouTube';
    refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); fetchSubs(); });

    header.appendChild(logo);
    header.appendChild(refreshBtn);

    const statusEl = mk('div', 'tcx-status');
    statusEl.id = 'tcx-status';

    const search = mk('input', 'tcx-search');
    search.type = 'text';
    search.placeholder = 'Search channels...';
    search.addEventListener('input', () => renderSubList(search.value));
    search.addEventListener('click', e => e.stopPropagation());

    const subList = mk('div', 'tcx-sub-list');
    subList.id = 'tcx-sub-list';

    panel.appendChild(header);
    panel.appendChild(statusEl);
    panel.appendChild(search);
    panel.appendChild(subList);

    // ── Canvas
    const canvas = mk('div', 'tcx-canvas');

    const toolbar = mk('div', 'tcx-canvas-toolbar');

    const addBtn = mk('button', 'tcx-btn-primary', '＋ New Frame');
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); addFrame(); });

    const helpBtn = mk('button', 'tcx-btn-secondary', '? Help');
    helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showHelp(); });

    const settingsBtn = mk('button', 'tcx-btn-primary', '★ Indexing');
    settingsBtn.title = 'Video Indexing settings';
    settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); showSettings(); });

    const closeBtn = mk('button', 'tcx-btn-close', '✕ Close');
    closeBtn.title = 'Close (click toolbar icon to reopen)';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlayEl.remove();
      overlayEl = null;
    });

    toolbar.appendChild(addBtn);
    toolbar.appendChild(helpBtn);
    toolbar.appendChild(settingsBtn);
    toolbar.appendChild(closeBtn);

    const frameArea = mk('div', 'tcx-frame-area');
    frameArea.id = 'tcx-frame-area';

    canvas.appendChild(toolbar);
    canvas.appendChild(frameArea);

    if (!hintDismissed) {
      const hint = mk('div', 'tcx-first-run-hint');
      hint.innerHTML = `
        <strong>👋 Welcome to Video Indexing!</strong>
        <ol>
          <li>Click <strong>↻</strong> (top-left) to load your YouTube subscriptions.</li>
          <li>Drag channels into frames to organize them.</li>
          <li>Subscribed to new channels later? Click <strong>↻</strong> again to sync them — they won't appear automatically.</li>
        </ol>`;
      const dismissBtn = mk('button', 'tcx-hint-dismiss', 'Got it ✕');
      dismissBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        hint.remove();
        hintDismissed = true;
        await chrome.storage.local.set({ tcxHintDismissed: true });
      });
      hint.appendChild(dismissBtn);
      frameArea.appendChild(hint);
    }

    overlay.appendChild(panel);
    overlay.appendChild(canvas);

    return overlay;
  }

  // ── Fetch subscriptions ────────────────────────────────────────────────────
  async function fetchSubs() {
    setStatus('Reading YouTube sidebar...', 'info');
    try {
      let subs = extractSubscriptions();

      if (subs.length === 0) {
        setStatus('Retrying in 1.5s — make sure the sidebar is expanded...', 'info');
        await new Promise(r => setTimeout(r, 1500));
        subs = extractSubscriptions();
      }

      if (subs.length === 0) {
        setStatus('No channels found. Click "Show more" under Subscriptions (sidebar or the All Subscriptions page), then try again.', 'error');
        return;
      }

      const drift = detectStructuralDrift(subs.length);

      // Merge: keep existing entries, add new ones (skipping removed/blocked channels); track newly added IDs
      const existingIds = new Set(allSubs.map(s => s.id));
      const blockedIdSet = new Set(blocked.map(b => b.id));
      newSubIds.clear();
      subs.forEach(s => {
        if (blockedIdSet.has(s.id)) return;
        if (!existingIds.has(s.id)) {
          allSubs.push(s);
          newSubIds.add(s.id);
        }
      });

      await saveData();
      renderSubList();

      if (drift) {
        console.warn(`[TC Indexing] Structural drift detected: page has ${drift.genericCount} channel links but only recognized ${drift.specificCount}. YouTube may have changed its layout — extractSubscriptions() selectors likely need updating.`);
        setStatus(`⚠️ Loaded ${allSubs.length}, but this page appears to have more channels than were recognized (found ${drift.genericCount} links, matched ${drift.specificCount}). YouTube may have changed its layout — this scrape could be incomplete.`, 'error');
      } else {
        setStatus(`${allSubs.length} subscription${allSubs.length !== 1 ? 's' : ''} loaded.`, 'success');
        setTimeout(() => setStatus('', ''), 3000);
      }
    } catch (e) {
      console.error('[TC Indexing] fetchSubs error:', e);
      setStatus('Error: ' + e.message, 'error');
    }
  }

  // ── Render left panel ──────────────────────────────────────────────────────
  function renderSubList(query = '') {
    const list = document.getElementById('tcx-sub-list');
    if (!list) return;
    list.innerHTML = '';

    const q = query.toLowerCase();
    const filtered = allSubs.filter(s => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (filtered.length === 0) {
      list.appendChild(mk('div', 'tcx-hint',
        allSubs.length === 0
          ? 'Click ↻ to load your subscriptions from the YouTube sidebar.'
          : 'No channels match your search.'));
      return;
    }

    filtered.forEach(sub => list.appendChild(buildChannelItem(sub, 'panel', null)));
  }

  // ── Channel item ───────────────────────────────────────────────────────────
  function buildChannelItem(sub, source, frameId) {
    const item = mk('div', 'tcx-channel-item');
    item.dataset.channelId = sub.id;
    if (source === 'panel' && newSubIds.has(sub.id)) item.classList.add('tcx-channel-new');

    // Enable draggable only on mousedown so Chrome never shows the grab cursor at rest
    item.addEventListener('mousedown', () => { item.draggable = true; });
    item.addEventListener('mouseup', () => { item.draggable = false; });

    item.appendChild(buildAvatar(sub));

    const name = mk('span', 'tcx-channel-name', sub.name);
    name.title = sub.name;
    item.appendChild(name);

    // ↗ native anchor
    const link = document.createElement('a');
    link.className = 'tcx-channel-link';
    link.textContent = '↗';
    link.href = sub.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open channel on YouTube';
    link.draggable = false;
    item.appendChild(link);

    if (source === 'frame' && frameId && activationKey) {
      const browseBtn = mk('button', 'tcx-channel-browse', '▶');
      browseBtn.title = 'Browse all videos (Premium)';
      browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openVideoBrowser(sub);
      });
      item.appendChild(browseBtn);
    }

    if (source === 'frame' && frameId) {
      const del = mk('button', 'tcx-channel-del', '✕');
      del.title = 'Remove from this frame';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const frame = frames.find(f => f.id === frameId);
        if (!frame) return;
        frame.channelIds = frame.channelIds.filter(id => id !== sub.id);
        try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
        renderFrames();
      });
      item.appendChild(del);
    }

    if (source === 'panel') {
      const del = mk('button', 'tcx-channel-del', '✕');
      del.title = 'Remove from index (won\'t come back on next refresh)';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove "${sub.name}" from the index?\nIt will be taken out of any frames and won't reappear next time you click ↻. (Your actual YouTube subscription is unaffected — and you can undo this anytime from ★ Indexing → Removed Channels.)`)) return;
        allSubs = allSubs.filter(s => s.id !== sub.id);
        frames.forEach(f => { f.channelIds = f.channelIds.filter(id => id !== sub.id); });
        if (!blocked.some(b => b.id === sub.id)) blocked.push({ id: sub.id, name: sub.name });
        try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
        const searchEl = document.querySelector('.tcx-search');
        renderSubList(searchEl ? searchEl.value : '');
        renderFrames();
      });
      item.appendChild(del);
    }

    // Right-click → copy this channel
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyChannel(sub.id, item);
    });

    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', JSON.stringify({
        channelId: sub.id,
        source,
        fromFrameId: frameId
      }));
      e.dataTransfer.effectAllowed = 'all';
      setTimeout(() => item.classList.add('tcx-dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('tcx-dragging');
      item.classList.remove('tcx-selected');
    });

    return item;
  }

  function buildAvatar(sub) {
    if (sub.avatar) {
      const img = document.createElement('img');
      img.className = 'tcx-avatar';
      img.src = sub.avatar;
      img.alt = sub.name;
      img.onerror = () => img.replaceWith(buildAvatarPlaceholder(sub.name));
      return img;
    }
    return buildAvatarPlaceholder(sub.name);
  }

  function buildAvatarPlaceholder(name) {
    return mk('div', 'tcx-avatar-placeholder', (name || '?')[0].toUpperCase());
  }


  // ── Render frames ──────────────────────────────────────────────────────────
  function renderFrames() {
    const area = document.getElementById('tcx-frame-area');
    if (!area) { console.error('[TC Indexing] st-frame-area not found'); return; }
    area.innerHTML = '';
    frames.forEach(frame => area.appendChild(buildFrameEl(frame)));
  }

  function buildFrameEl(frame) {
    const div = mk('div', 'tcx-frame');
    div.dataset.frameId = frame.id;
    div.style.cssText = `left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;`;

    // Title bar
    const titleBar = mk('div', 'tcx-frame-titlebar');

    const titleInput = mk('input', 'tcx-frame-title');
    titleInput.type  = 'text';
    titleInput.value = frame.title;
    titleInput.addEventListener('mousedown', e => { if (document.activeElement === titleInput) e.stopPropagation(); });
    titleInput.addEventListener('dblclick', e => e.stopPropagation());
    titleInput.addEventListener('change', async () => {
      frame.title = titleInput.value.trim() || 'Untitled';
      titleInput.value = frame.title;
      try { await saveData(); } catch (e) { console.error('[TC Indexing]', e); }
    });
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

    const countEl = mk('span', 'tcx-frame-count', frame.channelIds.length.toString());

    // Collapse toggle
    const collapseBtn = mk('button', 'tcx-frame-collapse', frame.collapsed ? '▸' : '▾');
    collapseBtn.title = frame.collapsed ? 'Expand frame' : 'Collapse frame';
    collapseBtn.addEventListener('mousedown', e => e.stopPropagation());
    collapseBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      frame.collapsed = !frame.collapsed;
      collapseBtn.textContent = frame.collapsed ? '▸' : '▾';
      collapseBtn.title = frame.collapsed ? 'Expand frame' : 'Collapse frame';
      content.style.display = frame.collapsed ? 'none' : '';
      resizeHandle.style.display = frame.collapsed ? 'none' : '';
      div.style.height = frame.collapsed ? 'auto' : frame.height + 'px';
      div.classList.toggle('tcx-collapsed', frame.collapsed);
      if (!frame.collapsed) div.style.zIndex = ++_zTop;
      try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
    });

    const delBtn = mk('button', 'tcx-frame-del', '✕');
    delBtn.title = 'Delete this frame';
    delBtn.addEventListener('mousedown', e => e.stopPropagation());
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (frame.channelIds.length > 0 &&
          !confirm(`Delete frame "${frame.title}"?\n${frame.channelIds.length} channel(s) will be removed from the frame (not from YouTube).`)) return;
      frames = frames.filter(f => f.id !== frame.id);
      try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
      renderFrames();
    });

    const sortBtn = mk('button', 'tcx-frame-sort', 'A↓Z');
    sortBtn.title = 'Sort channels alphabetically';
    sortBtn.addEventListener('mousedown', e => e.stopPropagation());
    sortBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      frame.channelIds.sort((a, b) => {
        const nameA = allSubs.find(s => s.id === a)?.name.toLowerCase() ?? a;
        const nameB = allSubs.find(s => s.id === b)?.name.toLowerCase() ?? b;
        return nameA.localeCompare(nameB);
      });
      try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
      renderFrames();
    });

    titleBar.appendChild(collapseBtn);
    titleBar.appendChild(titleInput);
    titleBar.appendChild(countEl);
    titleBar.appendChild(sortBtn);
    titleBar.appendChild(delBtn);

    setupFrameDrag(div, titleBar, frame);

    // Content / drop zone
    const content = mk('div', 'tcx-frame-content');
    content.dataset.frameId = frame.id;
    if (frame.collapsed) {
      content.style.display = 'none';
      div.style.height = 'auto';
      div.classList.add('tcx-collapsed');
    }

    const frameSubs = frame.channelIds
      .map(id => allSubs.find(s => s.id === id))
      .filter(Boolean);

    if (frameSubs.length === 0) {
      content.appendChild(mk('div', 'tcx-frame-hint', 'Drag subscriptions here'));
    } else {
      frameSubs.forEach(sub => content.appendChild(buildChannelItem(sub, 'frame', frame.id)));
    }

    setupDropZone(content, frame);
    setupFrameHover(div, frame.id);

    // Resize handle
    const resizeHandle = mk('div', 'tcx-resize-handle');
    if (frame.collapsed) resizeHandle.style.display = 'none';
    setupResize(div, resizeHandle, frame);

    div.appendChild(titleBar);
    div.appendChild(content);
    div.appendChild(resizeHandle);
    return div;
  }

  // ── Frame repositioning ────────────────────────────────────────────────────
  function setupFrameDrag(frameDiv, handle, frame) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startFrameX = frame.x;
      const startFrameY = frame.y;

      frameDiv.style.zIndex = ++_zTop;

      const onMove = (e) => {
        frame.x = Math.max(0, startFrameX + e.clientX - startMouseX);
        frame.y = Math.max(0, startFrameY + e.clientY - startMouseY);
        frameDiv.style.left = frame.x + 'px';
        frameDiv.style.top  = frame.y + 'px';
      };

      const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { await saveData(); } catch (e) { console.error('[TC Indexing]', e); }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Frame resize ───────────────────────────────────────────────────────────
  function setupResize(frameDiv, handle, frame) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX, startY = e.clientY;
      const startW = frame.width, startH = frame.height;

      const onMove = (e) => {
        frame.width  = Math.max(200, startW + e.clientX - startX);
        frame.height = Math.max(150, startH + e.clientY - startY);
        frameDiv.style.width  = frame.width  + 'px';
        frameDiv.style.height = frame.height + 'px';
      };

      const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try { await saveData(); } catch (e) { console.error('[TC Indexing]', e); }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  function setupDropZone(content, frame) {
    content.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Show copy cursor when Ctrl is held
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
      content.classList.add('tcx-drag-over');
    });

    content.addEventListener('dragleave', (e) => {
      if (!content.contains(e.relatedTarget)) content.classList.remove('tcx-drag-over');
    });

    content.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      content.classList.remove('tcx-drag-over');

      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); }
      catch { return; }

      const { channelId, source, fromFrameId } = data;
      if (!channelId) return;

      if (!frame.channelIds.includes(channelId)) frame.channelIds.push(channelId);

      // Clear new-highlight once the channel is placed in a frame
      if (newSubIds.has(channelId)) {
        newSubIds.delete(channelId);
        const panelItem = document.querySelector(`#st-sub-list .tcx-channel-item[data-channel-id="${CSS.escape(channelId)}"]`);
        if (panelItem) panelItem.classList.remove('tcx-channel-new');
      }

      // Move (default) vs Copy (Ctrl held): move removes from source frame
      const isCopy = e.ctrlKey;
      if (!isCopy && source === 'frame' && fromFrameId && fromFrameId !== frame.id) {
        const src = frames.find(f => f.id === fromFrameId);
        if (src) src.channelIds = src.channelIds.filter(id => id !== channelId);
      }

      document.querySelectorAll('.tcx-channel-item.tcx-selected')
        .forEach(el => el.classList.remove('tcx-selected'));

      try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
      renderFrames();
    });
  }

  // ── Copy / paste clipboard ─────────────────────────────────────────────────
  function copyChannel(channelId, itemEl) {
    document.querySelectorAll('.tcx-channel-item.tcx-selected')
      .forEach(el => el.classList.remove('tcx-selected'));
    copiedChannelId = channelId;
    if (itemEl) itemEl.classList.add('tcx-selected');
    const sub = allSubs.find(s => s.id === channelId);
    setStatus(`Copied "${sub?.name ?? channelId}" — right-click a frame to paste.`, 'success');
  }

  async function pasteIntoFrame(frameId) {
    if (!copiedChannelId) return;
    const frame = frames.find(f => f.id === frameId);
    if (!frame) return;
    if (!frame.channelIds.includes(copiedChannelId)) {
      frame.channelIds.push(copiedChannelId);
      if (newSubIds.has(copiedChannelId)) {
        newSubIds.delete(copiedChannelId);
        const panelItem = document.querySelector(`#st-sub-list .tcx-channel-item[data-channel-id="${CSS.escape(copiedChannelId)}"]`);
        if (panelItem) panelItem.classList.remove('tcx-channel-new');
      }
      try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
      renderFrames();
      const sub = allSubs.find(s => s.id === copiedChannelId);
      setStatus(`Pasted "${sub?.name ?? copiedChannelId}" into "${frame.title}".`, 'success');
      setTimeout(() => setStatus('', ''), 2500);
    } else {
      setStatus('Already in this frame.', 'info');
      setTimeout(() => setStatus('', ''), 1500);
    }
  }

  // ── Custom context menu ────────────────────────────────────────────────────
  let ctxMenu = null;

  function showContextMenu(x, y, items) {
    dismissContextMenu();
    ctxMenu = mk('div', 'tcx-ctx-menu');
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top  = y + 'px';
    items.forEach(({ label, action, disabled }) => {
      const btn = mk('button', 'tcx-ctx-item', label);
      if (disabled) btn.disabled = true;
      else btn.addEventListener('click', () => { dismissContextMenu(); action(); });
      ctxMenu.appendChild(btn);
    });
    document.body.appendChild(ctxMenu);
  }

  function dismissContextMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }

  // Dismiss on any click or Escape outside the menu
  document.addEventListener('mousedown', (e) => {
    if (ctxMenu && !ctxMenu.contains(e.target)) dismissContextMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismissContextMenu();
  }, true);

  // Track which frame the mouse is over (for Ctrl+V fallback)
  function setupFrameHover(frameDiv, frameId) {
    frameDiv.addEventListener('mouseenter', () => { hoveredFrameId = frameId; });
    frameDiv.addEventListener('mouseleave', () => {
      if (hoveredFrameId === frameId) hoveredFrameId = null;
    });
    // Right-click inside frame → context menu with Paste
    frameDiv.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tcx-channel-item')) return; // channel handles its own
      e.preventDefault();
      e.stopPropagation();
      const sub = copiedChannelId ? allSubs.find(s => s.id === copiedChannelId) : null;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: sub ? `Paste "${sub.name}"` : 'Paste (nothing copied)',
          disabled: !copiedChannelId,
          action: () => pasteIntoFrame(frameId)
        }
      ]);
    });
  }

  // Ctrl+C / Ctrl+V keyboard fallback
  document.addEventListener('keydown', async (e) => {
    if (!overlayEl) return;
    if (e.ctrlKey && e.key === 'c' && copiedChannelId) {
      const sub = allSubs.find(s => s.id === copiedChannelId);
      setStatus(`Copied "${sub?.name ?? copiedChannelId}" — right-click a frame to paste.`, 'success');
    }
    if (e.ctrlKey && e.key === 'v' && copiedChannelId && hoveredFrameId) {
      await pasteIntoFrame(hoveredFrameId);
    }
  }, true);

  // ── Add frame ──────────────────────────────────────────────────────────────
  async function addFrame() {
    try {
      const offset = (frames.length % 12) * 24;
      const frame = {
        id: `frame_${Date.now()}`,
        title: 'New Frame',
        x: 20 + offset,
        y: 20 + offset,
        width: 280,
        height: 320,
        channelIds: []
      };
      frames.push(frame);
      renderFrames(); // render immediately (don't wait for save)
      await saveData();

      // Auto-focus title for renaming
      setTimeout(() => {
        const input = document.querySelector(`[data-frame-id="${frame.id}"] .tcx-frame-title`);
        if (input) { input.select(); input.focus(); }
      }, 50);
    } catch (e) {
      console.error('[TC Indexing] addFrame error:', e);
      if (e.message && e.message.includes('Extension context invalidated')) {
        setStatus('Extension was updated — please refresh the page to reconnect.', 'info');
      } else {
        setStatus('Could not create frame: ' + e.message, 'error');
      }
    }
  }

  // ── Z-index tracker ────────────────────────────────────────────────────────
  let _zTop = 10;

  // ── Help modal ─────────────────────────────────────────────────────────────
  function showHelp() {
    if (document.getElementById('tcx-help-backdrop')) return;

    const backdrop = mk('div', 'tcx-help-backdrop');
    backdrop.id = 'tcx-help-backdrop';
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    const modal = mk('div', 'tcx-help-modal');

    const closeBtn = mk('button', 'tcx-help-close', '✕');
    closeBtn.addEventListener('click', () => backdrop.remove());

    modal.appendChild(closeBtn);
    modal.appendChild(mk('h2', '', '🎬 How to use Video Indexing'));

    const sections = [
      {
        h: 'Accessing Your Subscriptions',
        items: [
          'This is a parallel organizer — your subscriptions still work in YouTube\'s sidebar normally.',
          'On YouTube, click <strong>"Show more"</strong> under Subscriptions (in the left sidebar, or on the All Subscriptions page it opens) to reveal all channels.',
          'Then click <strong>↻</strong> here to read them into the left panel.',
          'Channels you haven\'t loaded are still accessible via YouTube\'s sidebar as usual.'
        ]
      },
      {
        h: 'Creating & Managing Frames',
        items: [
          'Click <strong>＋ New Frame</strong> — a frame appears. Type a name (e.g. "Gaming") and press Enter.',
          'Drag the <strong>title bar</strong> to reposition a frame anywhere on the canvas.',
          'Drag the <strong>corner handle ◢</strong> to resize a frame.',
          'Click <strong>✕</strong> on the title bar to delete a frame (channels are not deleted from YouTube).'
        ]
      },
      {
        h: 'Organizing Channels',
        items: [
          '<strong>Drag</strong> from the left panel into a frame to add a channel.',
          '<strong>Drag</strong> a channel between frames to <strong>move</strong> it.',
          '<strong>Click</strong> a channel to select it (green outline), then <strong>Ctrl+C</strong> to copy. Hover over a target frame and press <strong>Ctrl+V</strong> to paste it — the channel appears in both frames. Great for refining categories (e.g. paste from "Software" into a new "Video Editing" frame).',
          'Click <strong>✕</strong> on a channel inside a frame to remove it from that frame only.',
          'Click <strong>↗</strong> on any channel to open it on YouTube.'
        ]
      }
    ];

    sections.forEach(sec => {
      modal.appendChild(mk('h4', '', sec.h));
      const ul = mk('ul', '');
      sec.items.forEach(html => {
        const li = document.createElement('li');
        li.innerHTML = html;
        ul.appendChild(li);
      });
      modal.appendChild(ul);
    });

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  // ── Settings / Premium panel ───────────────────────────────────────────────
  function showSettings() {
    if (document.getElementById('tcx-settings-backdrop')) return;

    const backdrop = mk('div', 'tcx-help-backdrop');
    backdrop.id = 'tcx-settings-backdrop';
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    const modal = mk('div', 'tcx-help-modal');
    modal.style.maxWidth = '440px';

    const closeBtn = mk('button', 'tcx-help-close', '✕');
    closeBtn.addEventListener('click', () => backdrop.remove());
    modal.appendChild(closeBtn);

    modal.appendChild(mk('h2', '', '⚙ Video Indexing'));

    // ── Activation key section
    const keySection = mk('div', 'tcx-settings-section');

    const keyLabel = mk('p', '');
    keyLabel.innerHTML = activationKey
      ? '<span style="color:#4caf50">✓ Video indexing active</span>'
      : 'Paste your Tutorial Clarity activation key to enable video indexing (found on your Tutorial Clarity account page, under the Video Indexing menu section).';
    keySection.appendChild(keyLabel);

    const keyRow = mk('div', 'tcx-settings-row');

    const keyInput = mk('input', 'tcx-settings-input');
    keyInput.type        = 'text';
    keyInput.placeholder = 'TCX-XXXXXXXXXXXXXXXXXXXXXXXX';
    keyInput.value       = activationKey;
    keyInput.addEventListener('click', e => e.stopPropagation());
    keyInput.addEventListener('mousedown', e => e.stopPropagation());

    const activateBtn = mk('button', 'tcx-btn-primary', 'Activate');
    activateBtn.style.fontSize = '13px';
    activateBtn.style.padding  = '7px 14px';
    activateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = keyInput.value.trim();
      if (!key) return;
      activateBtn.textContent = '...';
      activateBtn.disabled = true;

      try {
        const res = await fetch(`${BACKEND}/api/tc-extension/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activationKey: key }),
        });
        const data = await res.json();
        if (data.valid) {
          activationKey = key;
          await saveData();
          keyLabel.innerHTML = '<span style="color:#4caf50">✓ Video indexing active — enjoy!</span>';
          renderFrames(); // show ▶ buttons
        } else {
          keyLabel.innerHTML = '<span style="color:#f44336">✗ Invalid or inactive key. Check your Tutorial Clarity account page.</span>';
        }
      } catch {
        keyLabel.innerHTML = '<span style="color:#f44336">✗ Could not reach server. Try again.</span>';
      }

      activateBtn.textContent = 'Activate';
      activateBtn.disabled = false;
    });

    const removeBtn = mk('button', 'tcx-btn-secondary', 'Remove Key');
    removeBtn.style.fontSize = '12px';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      activationKey = '';
      keyInput.value = '';
      await saveData();
      renderFrames();
      keyLabel.innerHTML = 'Activation key removed.';
    });

    keyRow.appendChild(keyInput);
    keyRow.appendChild(activateBtn);
    if (activationKey) keyRow.appendChild(removeBtn);
    keySection.appendChild(keyRow);

    if (activationKey) {
      const manageLink = mk('a', 'tcx-btn-secondary', 'Manage subscription on tutorialclarity.com');
      manageLink.href = `${BACKEND}/dashboard`;
      manageLink.target = '_blank';
      manageLink.rel = 'noopener noreferrer';
      manageLink.style.cssText = 'display:inline-block;text-decoration:none;font-size:12px;margin-top:10px';
      keySection.appendChild(manageLink);
    }

    modal.appendChild(keySection);

    // ── Get-a-key section (shown when not active) — billing happens on
    // tutorialclarity.com, never inside this extension.
    if (!activationKey) {
      const sep = mk('hr', 'tcx-settings-sep');
      modal.appendChild(sep);

      const upgradeLabel = mk('p', '');
      upgradeLabel.innerHTML = 'Don\'t have a key? Video indexing is included with any paid <strong style="color:#ffd700">Tutorial Clarity</strong> plan:';
      modal.appendChild(upgradeLabel);

      const upgradeDesc = mk('p', '');
      upgradeDesc.style.cssText = 'color:#ccc;font-size:13px;line-height:1.6;margin:8px 0 12px';
      upgradeDesc.textContent = 'It gives you an alphabetized index of every video on a channel. You can search that index instantly by title, so finding a specific tutorial or review takes seconds — even on channels with thousands of videos. You can also sort by newest to oldest, so you\'re never reading an old review when a current one exists.';
      modal.appendChild(upgradeDesc);

      const featureList = mk('ul', '');
      ['Full video index for any channel — alphabetical or newest first',
       'Instant search by video title'
      ].forEach(f => {
        const li = mk('li', '');
        li.textContent = f;
        featureList.appendChild(li);
      });
      modal.appendChild(featureList);

      const upgradeLink = mk('a', 'tcx-btn-primary', 'Get your key on tutorialclarity.com →');
      upgradeLink.href = `${BACKEND}/watch`;
      upgradeLink.target = '_blank';
      upgradeLink.rel = 'noopener noreferrer';
      upgradeLink.style.cssText = 'display:inline-block;text-decoration:none;margin-top:12px';
      modal.appendChild(upgradeLink);
    }

    // ── Removed Channels (unblock) section
    const blockedSep = mk('hr', 'tcx-settings-sep');
    modal.appendChild(blockedSep);
    modal.appendChild(mk('h4', '', 'Removed Channels'));

    const blockedList = mk('div', 'tcx-blocked-list');
    renderBlockedList(blockedList);
    modal.appendChild(blockedList);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function renderBlockedList(container) {
    container.innerHTML = '';
    if (blocked.length === 0) {
      container.appendChild(mk('p', 'tcx-hint', 'No removed channels. Channels you remove from the left-panel list (✕) show up here so you can bring them back.'));
      return;
    }
    container.appendChild(mk('p', 'tcx-hint', 'Unblocking brings a channel back next time you click ↻ in the left panel.'));
    blocked.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(b => {
      const row = mk('div', 'tcx-settings-row');
      row.style.marginBottom = '6px';
      const nameEl = mk('span', '', b.name);
      nameEl.style.flex = '1';
      const unblockBtn = mk('button', 'tcx-btn-secondary', 'Unblock');
      unblockBtn.style.fontSize = '12px';
      unblockBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        blocked = blocked.filter(x => x.id !== b.id);
        try { await saveData(); } catch (err) { console.error('[TC Indexing]', err); }
        renderBlockedList(container);
      });
      row.appendChild(nameEl);
      row.appendChild(unblockBtn);
      container.appendChild(row);
    });
  }

  // ── Video browser panel ────────────────────────────────────────────────────
  async function openVideoBrowser(sub) {
    const existing = document.getElementById('tcx-video-panel');
    if (existing) existing.remove();

    const panel = mk('div', 'tcx-video-panel');
    panel.id = 'tcx-video-panel';

    const header = mk('div', 'tcx-video-header');

    const title = mk('span', 'tcx-video-title', sub.name);
    header.appendChild(title);

    // Sort controls
    const sortRow = mk('div', 'tcx-video-sort-row');
    ['alpha', 'newest', 'oldest'].forEach(s => {
      const btn = mk('button', 'tcx-video-sort-btn', s === 'alpha' ? 'A–Z' : s === 'newest' ? 'Newest' : 'Oldest');
      btn.dataset.sort = s;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        panel.querySelectorAll('.tcx-video-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await loadVideos(sub.id, s, list, statusEl, searchInput.value);
      });
      sortRow.appendChild(btn);
    });
    sortRow.querySelector('[data-sort="alpha"]').classList.add('active');
    header.appendChild(sortRow);

    const closeBtn = mk('button', 'tcx-video-close', '✕');
    closeBtn.title = 'Close video browser';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.remove(); });
    header.appendChild(closeBtn);

    const statusEl = mk('div', 'tcx-video-status', 'Loading videos...');

    const searchInput = mk('input', 'tcx-search');
    searchInput.placeholder = 'Search videos...';
    searchInput.style.margin = '6px 10px';
    searchInput.style.width  = 'calc(100% - 20px)';
    searchInput.addEventListener('click', e => e.stopPropagation());
    searchInput.addEventListener('input', () => filterVideos(searchInput.value, list, statusEl));

    const list = mk('div', 'tcx-video-list');

    panel.appendChild(header);
    panel.appendChild(statusEl);
    panel.appendChild(searchInput);
    panel.appendChild(list);
    document.getElementById('tcx-frame-area').appendChild(panel);

    await loadVideos(sub.id, 'alpha', list, statusEl);
  }

  async function loadVideos(channelId, sort, listEl, statusEl, query = '') {
    listEl.innerHTML = '';
    statusEl.textContent = 'Loading...';
    try {
      const res  = await fetch(`${BACKEND}/api/tc-extension/videos?channelId=${encodeURIComponent(channelId)}&activationKey=${encodeURIComponent(activationKey)}&sort=${sort}`);
      const data = await res.json();
      if (data.error) { statusEl.textContent = '✗ ' + data.error; return; }

      listEl.dataset.all = JSON.stringify(data.videos);
      if (query) {
        filterVideos(query, listEl, statusEl);
      } else {
        statusEl.textContent = `${data.total} videos`;
        renderVideoList(data.videos, listEl);
      }
    } catch (err) {
      statusEl.textContent = '✗ Network error: ' + err.message;
    }
  }

  function renderVideoList(videos, listEl) {
    listEl.innerHTML = '';
    videos.forEach(v => {
      const item = mk('a', 'tcx-video-item');
      item.href   = `https://www.youtube.com/watch?v=${v.id}`;
      item.target = '_blank';
      item.rel    = 'noopener noreferrer';

      if (v.thumbnail) {
        const img = document.createElement('img');
        img.className = 'tcx-video-thumb';
        img.src = v.thumbnail;
        img.alt = '';
        item.appendChild(img);
      }

      const info = mk('div', 'tcx-video-info');
      const titleEl = mk('div', 'tcx-video-name', v.title);
      titleEl.title = v.title;
      const dateEl  = mk('div', 'tcx-video-date', new Date(v.date).toLocaleDateString());
      info.appendChild(titleEl);
      info.appendChild(dateEl);
      item.appendChild(info);

      listEl.appendChild(item);
    });
  }

  function filterVideos(query, listEl, statusEl) {
    const all = JSON.parse(listEl.dataset.all || '[]');
    const q   = query.toLowerCase();
    const filtered = q ? all.filter(v => v.title.toLowerCase().includes(q)) : all;
    renderVideoList(filtered, listEl);
    if (statusEl) statusEl.textContent = q ? `${filtered.length} of ${all.length} videos` : `${all.length} videos`;
  }

  console.log('[TC Indexing] Overlay v2 loaded');
})();
