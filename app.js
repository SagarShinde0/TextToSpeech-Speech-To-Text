/* ========================================
   Voice Assistant Pro - Production JavaScript
   Full Deep Repair - Mobile-First Robust TTS
   ======================================== */

(function() {
  'use strict';

  /* ========================================
     Constants
     ======================================== */
  const TTS_STATES = {
    IDLE: 'idle',
    LOADING_VOICES: 'loadingVoices',
    READY: 'ready',
    PREPARING: 'preparing',
    STARTING: 'starting',
    SPEAKING: 'speaking',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    FINISHED: 'finished',
    ERROR: 'error'
  };

  const MOBILE_MAX_RETRIES = 15;
  const DESKTOP_MAX_RETRIES = 10;
  const START_TIMEOUT_MS = 3000;

  /* ========================================
     App State - Single Source of Truth
     ======================================== */
  const AppState = {
    text: '',
    chunks: [],
    totalChunks: 0,
    currentChunkIndex: 0,
    selectedVoiceKey: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    lastError: null,
    isBrowserSupported: false,
    areVoicesLoaded: false,
    voiceLoadAttempts: 0,
    maxVoiceRetries: DESKTOP_MAX_RETRIES,
    isMobile: false,
    playbackState: TTS_STATES.IDLE,
    provider: 'browser',

    init() {
      this.reset();
      this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
      this.maxVoiceRetries = this.isMobile ? MOBILE_MAX_RETRIES : DESKTOP_MAX_RETRIES;
    },

    reset() {
      this.chunks = [];
      this.totalChunks = 0;
      this.currentChunkIndex = 0;
      this.playbackState = TTS_STATES.IDLE;
      this.lastError = null;
    },

    canPlay() {
      const hasText = this.text.trim().length > 0;
      const hasChunks = this.totalChunks > 0;
      return hasText && hasChunks && this.isBrowserSupported && this.areVoicesLoaded &&
             (this.playbackState === TTS_STATES.IDLE || this.playbackState === TTS_STATES.READY ||
              this.playbackState === TTS_STATES.FINISHED || this.playbackState === TTS_STATES.STOPPED);
    },

    setState(newState) {
      const oldState = this.playbackState;
      this.playbackState = newState;
      console.log(`[State] ${oldState} -> ${newState}`);
    }
  };

  /* ========================================
     Session Manager - Prevents Stale Callbacks
     ======================================== */
  const SessionManager = {
    currentSessionId: 0,
    previousSessionId: null,

    startNewSession() {
      this.previousSessionId = this.currentSessionId;
      this.currentSessionId = Date.now() + Math.random();
      console.log(`[Session] New session: ${this.currentSessionId}`);
      return this.currentSessionId;
    },

    isCurrentSession(sessionId) {
      return sessionId === this.currentSessionId;
    }
  };

  /* ========================================
     Browser Support Detection
     ======================================== */
  function checkBrowserSupport() {
    const supported = 'speechSynthesis' in window;
    AppState.isBrowserSupported = supported;

    if (!supported) {
      console.warn('[TTS] Browser speech synthesis not supported');
    } else {
      console.log('[TTS] Browser speech synthesis available');
    }

    return supported;
  }

  /* ========================================
     Voice Manager - Robust Voice Handling
     ======================================== */
  const VoiceManager = {
    voices: [],
    voiceMap: new Map(),
    isLoading: false,
    loadAttempt: 0,
    lastLoadTime: 0,

    init() {
      console.log('[VoiceManager] Initializing...');
      this.setupVoiceChangedHandler();
      this.loadVoices();

      setTimeout(() => {
        if (!AppState.areVoicesLoaded) {
          console.log('[VoiceManager] Force retry after timeout');
          this.loadVoices();
        }
      }, 1000);
    },

    setupVoiceChangedHandler() {
      if (typeof speechSynthesis.onvoiceschanged !== 'undefined') {
        speechSynthesis.onvoiceschanged = () => {
          console.log('[VoiceManager] onvoiceschanged fired');
          this.loadVoices();
        };
      }
    },

    loadVoices() {
      this.isLoading = true;
      this.loadAttempt++;

      let voices = [];
      try {
        voices = speechSynthesis.getVoices() || [];
      } catch (e) {
        console.warn('[VoiceManager] getVoices() error:', e);
      }

      if (voices.length === 0) {
        if (this.loadAttempt < AppState.maxVoiceRetries) {
          console.log(`[VoiceManager] Retry ${this.loadAttempt}/${AppState.maxVoiceRetries} - no voices yet`);
          setTimeout(() => this.loadVoices(), 300);
        } else {
          console.error('[VoiceManager] Max retries reached - no voices');
          AppState.lastError = 'No voices available';
          AppState.setState(TTS_STATES.ERROR);
          SpeechController.updateControls();
        }
        this.isLoading = false;
        return;
      }

      if (voices.length === this.voices.length && this.voices.length > 0) {
        this.isLoading = false;
        return;
      }

      console.log(`[VoiceManager] Loaded ${voices.length} voices`);

      this.voices = voices;
      this.voiceMap.clear();

      voices.forEach((voice, index) => {
        const key = this.getVoiceKey(voice, index);
        this.voiceMap.set(key, { voice, index });
      });

      AppState.areVoicesLoaded = true;
      AppState.voiceLoadAttempts = this.loadAttempt;
      this.isLoading = false;

      SpeechController.onVoicesLoaded();

      if (AppState.playbackState === TTS_STATES.LOADING_VOICES) {
        AppState.setState(TTS_STATES.READY);
      }
    },

    getVoiceKey(voice, index) {
      return `${voice.name}::${voice.lang}::${index}`;
    },

    getVoiceByKey(key) {
      return this.voiceMap.get(key);
    },

    onVoicesLoaded() {
      const savedKey = this.getSavedVoiceKey();

      if (savedKey) {
        const saved = this.voiceMap.get(savedKey);
        if (saved) {
          console.log('[VoiceManager] Restored saved voice:', savedKey);
          return saved;
        }
      }

      const best = this.findBestVoice();
      if (best) {
        console.log('[VoiceManager] Selected best voice:', best.key);
      }
      return best;
    },

    getSavedVoiceKey() {
      try {
        return localStorage.getItem('tts_voice_key');
      } catch (e) {
        return null;
      }
    },

    saveVoiceKey(key) {
      try {
        localStorage.setItem('tts_voice_key', key);
      } catch (e) {}
    },

    findBestVoice() {
      if (this.voices.length === 0) return null;

      const preferredNames = [
        'google us english', 'samantha', 'zira', 'microsoft david',
        'alex', 'daniel', 'mei-jia', 'tessa'
      ];

      for (const name of preferredNames) {
        for (let i = 0; i < this.voices.length; i++) {
          const voice = this.voices[i];
          if (voice.name.toLowerCase().includes(name.toLowerCase())) {
            return { voice, index: i, key: this.getVoiceKey(voice, i) };
          }
        }
      }

      const englishVoices = this.voices.filter(v => v.lang.startsWith('en'));
      if (englishVoices.length > 0) {
        const defaultVoice = englishVoices.find(v => v.default) || englishVoices[0];
        const index = this.voices.indexOf(defaultVoice);
        return { voice: defaultVoice, index, key: this.getVoiceKey(defaultVoice, index) };
      }

      const first = this.voices[0];
      return { voice: first, index: 0, key: this.getVoiceKey(first, 0) };
    },

    populateDropdown(preferredKey = null) {
      const select = elements.voiceSelect;
      select.innerHTML = '';

      if (!AppState.areVoicesLoaded) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Loading voices...';
        select.appendChild(option);
        select.disabled = true;
        return;
      }

      if (this.voices.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No voices available';
        select.appendChild(option);
        select.disabled = true;
        return;
      }

      const sortedVoices = [...this.voices].sort((a, b) => {
        const aLang = a.lang.split('-')[0];
        const bLang = b.lang.split('-')[0];
        if (aLang !== bLang) return aLang.localeCompare(bLang);
        return a.name.localeCompare(b.name);
      });

      let selectedIndex = 0;

      sortedVoices.forEach(voice => {
        const option = document.createElement('option');
        let label = voice.name;

        const lowerName = voice.name.toLowerCase();
        if (lowerName.includes('female') || lowerName.includes('zira') || lowerName.includes('samantha')) {
          label += ' (F)';
        } else if (lowerName.includes('male') || lowerName.includes('david') || lowerName.includes('daniel')) {
          label += ' (M)';
        }

        const voiceInfo = this.voiceMap.get(this.getVoiceKey(voice, this.voices.indexOf(voice)));
        if (voiceInfo) {
          option.value = voiceInfo.index;
        }

        option.textContent = voice.lang ? `${label} [${voice.lang}]` : label;

        if (preferredKey && this.getVoiceKey(voice, this.voices.indexOf(voice)) === preferredKey) {
          selectedIndex = sortedVoices.indexOf(voice);
        }

        select.appendChild(option);
      });

      select.disabled = false;

      if (select.options.length > 0) {
        select.selectedIndex = selectedIndex;
        AppState.selectedVoiceKey = sortedVoices[selectedIndex] ?
          this.getVoiceKey(sortedVoices[selectedIndex], this.voices.indexOf(sortedVoices[selectedIndex])) :
          null;
      }

      console.log('[VoiceManager] Dropdown populated');
    },

    getSelectedVoice() {
      const select = elements.voiceSelect;
      const selectedIndex = parseInt(select.value, 10);

      if (!isNaN(selectedIndex) && this.voices[selectedIndex]) {
        return this.voices[selectedIndex];
      }

      const fallback = this.findBestVoice();
      if (fallback) {
        console.warn('[VoiceManager] Using fallback voice');
        return fallback.voice;
      }

      return null;
    }
  };

  /* ========================================
     Chunking Engine - Natural Speech Splitting
     ======================================== */
  const ChunkingEngine = {
    SAFE_LENGTH: 4000,
    MIN_CHUNK_SIZE: 200,

    chunk(text) {
      if (!text || typeof text !== 'string' || text.length === 0) {
        return [];
      }

      const cleanText = text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ').replace(/  +/g, ' ').trim();
      if (cleanText.length === 0) return [];

      if (cleanText.length <= this.SAFE_LENGTH) {
        return [cleanText];
      }

      try {
        const chunks = this.naturalSplit(cleanText);
        return this.validateChunks(chunks);
      } catch (e) {
        console.error('Chunking failed:', e);
        return this.hardSplit(cleanText);
      }
    },

    validateChunks(chunks) {
      const valid = (chunks || []).filter(c =>
        c && typeof c === 'string' && c.trim().length > 0
      );
      if (valid.length > 0) return valid;
      return [];
    },

    naturalSplit(text) {
      const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p && p.length > 0);
      if (paragraphs.length === 0) return this.hardSplit(text);

      const chunks = [];
      for (const para of paragraphs) {
        if (para.length <= this.SAFE_LENGTH) {
          chunks.push(para);
        } else {
          chunks.push(...this.splitParagraphNaturally(para));
        }
      }

      const finalChunks = [];
      for (const chunk of chunks) {
        if (chunk && chunk.trim()) {
          const trimmed = chunk.trim();
          if (trimmed.length <= this.SAFE_LENGTH) {
            finalChunks.push(trimmed);
          } else {
            finalChunks.push(...this.hardSplit(trimmed));
          }
        }
      }

      return finalChunks.filter(c => c);
    },

    splitParagraphNaturally(para) {
      const result = [];
      let current = '';

      const sentences = this.splitBySentences(para);

      for (const sentence of sentences) {
        if (!sentence) continue;

        const testChunk = current ? current + ' ' + sentence : sentence;

        if (testChunk.length > this.SAFE_LENGTH && current) {
          result.push(current.trim());
          current = sentence;
        } else {
          current = testChunk;
        }
      }

      if (current && current.trim()) {
        result.push(current.trim());
      }

      return result.length > 0 ? result : [para.substring(0, this.SAFE_LENGTH)];
    },

    splitBySentences(text) {
      if (!text || typeof text !== 'string') return [];

      const pattern = /[^.!?]+[.!?]+(?=\s+[A-Z]|$)|[^.!?]+$/g;
      const matches = text.match(pattern);

      if (!matches || matches.length === 0) {
        return [text];
      }
      return matches.map(s => s.trim()).filter(s => s && s.length > 0);
    },

    hardSplit(text) {
      if (!text || text.length === 0) return [];
      if (text.length <= this.SAFE_LENGTH) return [text.trim()];

      const chunks = [];
      let remaining = text;

      while (remaining && remaining.length > this.SAFE_LENGTH) {
        let splitAt = remaining.lastIndexOf(' ', this.SAFE_LENGTH);

        if (splitAt < this.MIN_CHUNK_SIZE) {
          splitAt = remaining.indexOf(' ', this.SAFE_LENGTH);
        }

        if (splitAt < 0 || splitAt < this.MIN_CHUNK_SIZE) {
          splitAt = this.SAFE_LENGTH;
        }

        const chunk = remaining.substring(0, splitAt).trim();
        if (chunk) chunks.push(chunk);

        remaining = remaining.substring(splitAt).trim();
        if (!remaining) break;
      }

      if (remaining && remaining.trim()) {
        chunks.push(remaining.trim());
      }

      return chunks.filter(c => c && c.length > 0);
    }
  };

  /* ========================================
     Speech Controller - Central Playback Control
     ======================================== */
  const SpeechController = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    isCancelled: false,
    currentUtterance: null,
    sessionId: null,
    didChunkStart: false,
    startTimeoutId: null,

    init() {
      checkBrowserSupport();

      if (!AppState.isBrowserSupported) {
        this.showUnsupportedUI();
        return;
      }

      VoiceManager.init();
      this.bindEvents();
      this.loadPreferences();
      this.updateControls();
      this.updateProgressUI();

      this.setupMobileFixes();
    },

    setupMobileFixes() {
      if (!AppState.isMobile) return;

      document.addEventListener('touchstart', function unlockAudio() {
        if (speechSynthesis.state === 'suspended') {
          speechSynthesis.resume();
        }
        document.removeEventListener('touchstart', unlockAudio);
      }, { passive: true, once: true });

      let firstTap = true;
      document.addEventListener('touchstart', function initSpeech() {
        if (firstTap && speechSynthesis) {
          const dummy = new SpeechSynthesisUtterance(' ');
          dummy.volume = 0;
          speechSynthesis.speak(dummy);
          firstTap = false;
        }
        document.removeEventListener('touchstart', initSpeech);
      }, { passive: true, once: true });
    },

    showUnsupportedUI() {
      AppState.setState(TTS_STATES.ERROR);
      elements.ttsStatusBadge.innerHTML =
        '<span class="status-dot error"></span>' +
        '<span class="status-text">Unsupported</span>';
      elements.ttsPlay.disabled = true;
      UI.showToast('Browser TTS not supported. Use Chrome or Edge.', 'error');
    },

    bindEvents() {
      elements.ttsPlay.addEventListener('click', () => this.play(), { passive: true });
      elements.ttsPause.addEventListener('click', () => this.pause(), { passive: true });
      elements.ttsResume.addEventListener('click', () => this.resume(), { passive: true });
      elements.ttsStop.addEventListener('click', () => this.stop(), { passive: true });
      elements.ttsPrev.addEventListener('click', () => this.skipPrev(), { passive: true });
      elements.ttsNext.addEventListener('click', () => this.skipNext(), { passive: true });
      elements.ttsRestart.addEventListener('click', () => this.restart(), { passive: true });

      elements.speedControl.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        AppState.rate = val;
        elements.speedValue.textContent = val + 'x';
        try {
          localStorage.setItem('tts_speed', val);
        } catch (e) {}
      }, { passive: true });

      elements.ttsLanguage.addEventListener('change', (e) => {
        try {
          localStorage.setItem('tts_lang', e.target.value);
        } catch (e) {}
      }, { passive: true });

      elements.voiceSelect.addEventListener('change', (e) => {
        const selectedIndex = parseInt(e.target.value, 10);
        if (!isNaN(selectedIndex) && VoiceManager.voices[selectedIndex]) {
          AppState.selectedVoiceKey = VoiceManager.getVoiceKey(VoiceManager.voices[selectedIndex], selectedIndex);
          VoiceManager.saveVoiceKey(AppState.selectedVoiceKey);
          console.log('[VoiceManager] Selected voice:', AppState.selectedVoiceKey);
        }
        this.updateControls();
      }, { passive: true });

      elements.ttsText.addEventListener('input', () => {
        this.updateTextInfo();
      }, { passive: true });

      elements.ttsClear.addEventListener('click', () => {
        this.clearText();
      }, { passive: true });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.isPlaying) {
          this.pause();
        }
      });
    },

    loadPreferences() {
      try {
        const savedSpeed = localStorage.getItem('tts_speed');
        if (savedSpeed) {
          const val = parseFloat(savedSpeed);
          elements.speedControl.value = val;
          elements.speedValue.textContent = val + 'x';
          AppState.rate = val;
        }

        const savedLang = localStorage.getItem('tts_lang');
        if (savedLang) {
          elements.ttsLanguage.value = savedLang;
        }
      } catch (e) {
        console.warn('Could not load preferences:', e);
      }
    },

    onVoicesLoaded() {
      const bestVoice = VoiceManager.onVoicesLoaded();
      if (bestVoice) {
        AppState.selectedVoiceKey = bestVoice.key;
      }
      VoiceManager.populateDropdown(AppState.selectedVoiceKey);
      this.updateControls();
      this.updateStatusBadge();
    },

    updateTextInfo() {
      AppState.text = elements.ttsText.value;

      const chunks = ChunkingEngine.chunk(AppState.text);
      AppState.chunks = chunks;
      AppState.totalChunks = chunks.length;

      elements.ttsChunkCount.textContent = chunks.length + ' chunk' + (chunks.length !== 1 ? 's' : '');

      if (AppState.text.length > 50000) {
        elements.ttsWarning.textContent = 'Very large text - may take time';
        elements.ttsWarning.hidden = false;
      } else if (AppState.text.length > 30000) {
        elements.ttsWarning.textContent = 'Large text - processing...';
        elements.ttsWarning.hidden = false;
      } else {
        elements.ttsWarning.hidden = true;
      }

      this.updateControls();
    },

    updateControls() {
      const hasText = AppState.text.trim().length > 0;
      const browserSupported = AppState.isBrowserSupported;
      const voicesLoaded = AppState.areVoicesLoaded;
      const hasChunks = AppState.totalChunks > 0;
      const queueHasItems = this.queue.length > 0;

      const isIdle = AppState.playbackState === TTS_STATES.IDLE || AppState.playbackState === TTS_STATES.READY;
      const isSpeaking = AppState.playbackState === TTS_STATES.SPEAKING || AppState.playbackState === TTS_STATES.STARTING;
      const isPausedState = AppState.playbackState === TTS_STATES.PAUSED;
      const isLoading = AppState.playbackState === TTS_STATES.LOADING_VOICES;

      const canPlay = hasText && browserSupported && voicesLoaded && isIdle && hasChunks;
      const canPause = isSpeaking && !isPausedState;
      const canResume = isPausedState;
      const canStop = isSpeaking || isPausedState;
      const hasPrevChunk = queueHasItems && this.currentIndex > 0;
      const hasNextChunk = queueHasItems && this.currentIndex < this.queue.length - 1;
      const hasAnyChunks = hasChunks || queueHasItems;

      elements.ttsPlay.disabled = !canPlay;
      elements.ttsPause.disabled = !canPause;
      elements.ttsResume.disabled = !canResume;
      elements.ttsStop.disabled = !canStop;
      elements.ttsPrev.disabled = !hasPrevChunk;
      elements.ttsNext.disabled = !hasNextChunk;
      elements.ttsRestart.disabled = !hasAnyChunks;

      elements.voiceSelect.disabled = isLoading || !voicesLoaded;

      if (isLoading) {
        this.showLoadingStatus();
      } else if (canPause) {
        elements.ttsPlay.style.display = 'none';
        elements.ttsPause.style.display = '';
        elements.ttsResume.style.display = 'none';
      } else if (canResume) {
        elements.ttsPlay.style.display = 'none';
        elements.ttsPause.style.display = 'none';
        elements.ttsResume.style.display = '';
      } else {
        elements.ttsPlay.style.display = '';
        elements.ttsPause.style.display = 'none';
        elements.ttsResume.style.display = 'none';
      }
    },

    updateStatusBadge() {
      const state = AppState.playbackState;

      if (state === TTS_STATES.LOADING_VOICES) {
        this.showLoadingStatus();
        return;
      }

      const hasText = AppState.text.trim().length > 0;
      const chunks = hasText ? (this.queue.length > 0 ? this.queue : AppState.chunks) : [];
      const total = chunks.length;
      const current = this.currentIndex;

      if (total === 0 && hasText) {
        elements.ttsProgress.textContent = '0 / 0';
        elements.ttsProgressPercent.textContent = '0%';
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot idle"></span><span class="status-text">Ready</span>';
        return;
      }

      if (state === TTS_STATES.STARTING) {
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot speaking"></span><span class="status-text">Starting...</span>';
        return;
      }

      if (state === TTS_STATES.SPEAKING) {
        const displayCurrent = current + 1;
        const percent = total > 0 ? Math.round((displayCurrent / total) * 100) : 0;
        elements.ttsProgress.textContent = displayCurrent + ' / ' + total;
        elements.ttsProgressPercent.textContent = percent + '%';
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot speaking"></span>' +
          '<span class="status-text">Playing ' + displayCurrent + '/' + total + '</span>';
        return;
      }

      if (state === TTS_STATES.PAUSED) {
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot idle"></span><span class="status-text">Paused</span>';
        return;
      }

      if (state === TTS_STATES.FINISHED) {
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot ready"></span><span class="status-text">Finished</span>';
        return;
      }

      if (state === TTS_STATES.ERROR) {
        elements.ttsStatusBadge.innerHTML =
          '<span class="status-dot error"></span><span class="status-text">Error</span>';
        return;
      }

      elements.ttsStatusBadge.innerHTML =
        '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
    },

    showLoadingStatus() {
      const attempts = VoiceManager.loadAttempt;
      elements.ttsStatusBadge.innerHTML =
        '<span class="status-dot loading"></span><span class="status-text">Loading voices... (' + attempts + ')</span>';
      elements.ttsPlay.disabled = true;
      elements.voiceSelect.disabled = true;
    },

    updateProgressUI() {
      this.updateStatusBadge();
    },

    clearText() {
      this.stop();
      elements.ttsText.value = '';
      AppState.text = '';
      AppState.reset();
      UI.updateCharCount(elements.ttsText, elements.ttsCharCount);
      this.updateTextInfo();
      UI.showToast('Text cleared', 'info', 2000);
    },

    play() {
      const text = elements.ttsText.value.trim();

      if (!text) {
        UI.showToast('Please enter some text to speak', 'info');
        return;
      }

      if (!AppState.isBrowserSupported) {
        UI.showToast('Browser TTS not supported', 'error');
        return;
      }

      if (!AppState.areVoicesLoaded || VoiceManager.voices.length === 0) {
        AppState.setState(TTS_STATES.LOADING_VOICES);
        UI.showToast('Loading voices, please wait...', 'info');
        VoiceManager.init();
        this.updateControls();

        setTimeout(() => {
          if (AppState.areVoicesLoaded) {
            this.play();
          } else {
            UI.showToast('Voice loading failed', 'error');
            AppState.setState(TTS_STATES.ERROR);
          }
        }, 2000);
        return;
      }

      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      AppState.lastError = null;

      const chunks = ChunkingEngine.chunk(text);

      if (!chunks || chunks.length === 0) {
        UI.showToast('No valid text to speak', 'error');
        AppState.lastError = 'No valid chunks';
        this.updateControls();
        return;
      }

      const voice = VoiceManager.getSelectedVoice();
      if (!voice) {
        UI.showToast('No voice available', 'error');
        AppState.lastError = 'No voice';
        this.updateControls();
        return;
      }

      this.sessionId = SessionManager.startNewSession();
      this.queue = chunks;
      this.isCancelled = false;
      this.currentIndex = 0;
      this.isPlaying = true;
      this.isPaused = false;

      AppState.chunks = chunks;
      AppState.totalChunks = chunks.length;
      AppState.currentChunkIndex = 0;
      AppState.setState(TTS_STATES.STARTING);

      this.updateControls();
      this.updateProgressUI();

      UI.showToast('Playing ' + chunks.length + ' chunk(s)...', 'info', 2000);

      try {
        this.speakCurrentChunk();
      } catch (e) {
        console.error('Speak error:', e);
        UI.showToast('Error: ' + e.message, 'error');
        this.handleError(e.message);
      }
    },

    speakCurrentChunk() {
      const currentSession = this.sessionId;

      if (this.isCancelled || !SessionManager.isCurrentSession(currentSession)) {
        console.log('[TTS] Session cancelled');
        AppState.setState(TTS_STATES.IDLE);
        this.clearStartTimeout();
        return;
      }

      if (this.currentIndex >= this.queue.length) {
        this.onPlaybackComplete();
        return;
      }

      const chunk = this.queue[this.currentIndex];

      if (!this.validateChunk(chunk)) {
        console.warn('[TTS] Invalid chunk:', this.currentIndex);
        this.currentIndex++;
        setTimeout(() => {
          if (SessionManager.isCurrentSession(currentSession) && !this.isCancelled) {
            this.speakCurrentChunk();
          }
        }, 50);
        return;
      }

      AppState.currentChunkIndex = this.currentIndex;

      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      const utter = new SpeechSynthesisUtterance(chunk);
      const voice = VoiceManager.getSelectedVoice();

      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      }

      utter.rate = parseFloat(elements.speedControl.value) || AppState.rate;
      utter.pitch = AppState.pitch;
      utter.volume = AppState.volume;

      this.currentUtterance = utter;
      this.didChunkStart = false;

      this.clearStartTimeout();
      this.startTimeoutId = setTimeout(() => {
        this.handleStartTimeout(currentSession);
      }, START_TIMEOUT_MS);

      const sessionCheck = this.sessionId;

      utter.onstart = () => {
        this.clearStartTimeout();

        if (!SessionManager.isCurrentSession(sessionCheck)) return;
        if (this.isCancelled) return;

        this.didChunkStart = true;
        this.isPlaying = true;
        AppState.setState(TTS_STATES.SPEAKING);
        console.log('[TTS] Chunk started:', this.currentIndex + 1);
        this.updateProgressUI();
      };

      utter.onend = () => {
        this.clearStartTimeout();

        if (!SessionManager.isCurrentSession(sessionCheck)) return;
        if (this.isCancelled) return;

        console.log('[TTS] Chunk ended:', this.currentIndex + 1);

        if (!this.didChunkStart) {
          console.warn('[TTS] Ended without start');
          this.handleChunkFailed(currentSession, 'Speech failed');
          return;
        }

        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => {
            if (SessionManager.isCurrentSession(sessionCheck) && !this.isCancelled) {
              this.speakCurrentChunk();
            }
          }, 100);
        } else {
          this.onPlaybackComplete();
        }
      };

      utter.onerror = (event) => {
        this.clearStartTimeout();

        if (!SessionManager.isCurrentSession(sessionCheck)) return;
        if (this.isCancelled) return;

        if (event.error === 'canceled' || event.error === 'interrupted') {
          console.log('[TTS] Canceled:', event.error);
          return;
        }

        console.error('[TTS] Error:', event.error);
        AppState.lastError = event.error;

        if (!this.didChunkStart) {
          this.handleChunkFailed(currentSession, event.error);
          return;
        }

        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => {
            if (SessionManager.isCurrentSession(sessionCheck) && !this.isCancelled) {
              this.speakCurrentChunk();
            }
          }, 100);
        } else {
          this.onPlaybackComplete();
        }
      };

      try {
        speechSynthesis.speak(utter);
      } catch (e) {
        this.clearStartTimeout();
        console.error('[TTS] speak() exception:', e);
        AppState.lastError = e.message;
        this.handleChunkFailed(currentSession, e.message);
      }
    },

    validateChunk(chunk) {
      if (!chunk || typeof chunk !== 'string') return false;
      const trimmed = chunk.trim();
      return trimmed.length > 0;
    },

    handleStartTimeout(sessionId) {
      if (!SessionManager.isCurrentSession(sessionId)) return;
      if (this.isCancelled) return;

      console.warn('[TTS] Start timeout');

      if (!this.didChunkStart) {
        this.handleChunkFailed(sessionId, 'Speech timeout');
      }
    },

    handleChunkFailed(sessionId, errorMessage) {
      if (!SessionManager.isCurrentSession(sessionId)) return;

      console.error('[TTS] Chunk failed:', errorMessage);

      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
        setTimeout(() => {
          if (SessionManager.isCurrentSession(sessionId) && !this.isCancelled) {
            this.speakCurrentChunk();
          }
        }, 200);
      } else {
        this.handleError(errorMessage);
      }
    },

    clearStartTimeout() {
      if (this.startTimeoutId) {
        clearTimeout(this.startTimeoutId);
        this.startTimeoutId = null;
      }
    },

    pause() {
      if (!this.isPlaying || this.isPaused) return;

      this.isPaused = true;
      this.isPlaying = false;
      AppState.setState(TTS_STATES.PAUSED);
      speechSynthesis.pause();
      this.updateControls();
      this.updateProgressUI();
      UI.showToast('Paused', 'info', 1500);
    },

    resume() {
      if (!this.isPaused) return;

      this.isPaused = false;
      this.isPlaying = true;
      AppState.setState(TTS_STATES.SPEAKING);
      speechSynthesis.resume();
      this.updateControls();
      this.updateProgressUI();
      UI.showToast('Resuming...', 'info', 1500);
    },

    stop() {
      this.isCancelled = true;
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = 0;
      this.currentUtterance = null;
      this.sessionId = null;
      this.didChunkStart = false;
      this.clearStartTimeout();
      AppState.currentChunkIndex = 0;
      AppState.setState(TTS_STATES.IDLE);

      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
      }

      this.updateControls();
      this.updateProgressUI();
      UI.showToast('Stopped', 'info', 1500);
    },

    skipNext() {
      if (!this.isPlaying && !this.isPaused) return;
      if (this.currentIndex >= this.queue.length - 1) return;

      speechSynthesis.cancel();
      this.currentIndex++;
      this.speakCurrentChunk();
    },

    skipPrev() {
      if (!this.isPlaying && !this.isPaused) return;
      if (this.currentIndex <= 0) return;

      speechSynthesis.cancel();
      this.currentIndex = Math.max(0, this.currentIndex - 1);
      this.speakCurrentChunk();
    },

    restart() {
      this.stop();
      setTimeout(() => this.play(), 100);
    },

    onPlaybackComplete() {
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = 0;
      AppState.currentChunkIndex = 0;
      AppState.setState(TTS_STATES.FINISHED);
      this.updateControls();
      this.updateProgressUI();
      UI.showToast('Finished speaking', 'success', 2000);
    },

    handleError(message) {
      this.isPlaying = false;
      this.isPaused = false;
      this.clearStartTimeout();
      AppState.setState(TTS_STATES.ERROR);
      AppState.lastError = message;
      this.updateControls();
      this.updateProgressUI();
      UI.showToast('Error: ' + message, 'error', 4000);
    }
  };

  /* ========================================
     UI Helper Functions
     ======================================== */
  const UI = {
    showToast(message, type = 'info', duration = 3500) {
      const existing = elements.toastContainer.querySelector('.toast');
      if (existing) {
        existing.remove();
      }

      const toast = document.createElement('div');
      toast.className = 'toast';

      const icons = {
        success: '<svg class="toast-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg class="toast-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg class="toast-icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
      };

      toast.innerHTML = icons[type] + '<span class="toast-message">' + message + '</span>';
      elements.toastContainer.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    updateCharCount(textarea, counter) {
      if (textarea && counter) {
        const count = textarea.value.length;
        counter.textContent = count + ' character' + (count !== 1 ? 's' : '');
      }
    }
  };

  /* ========================================
     STT Module
     ======================================== */
  const SpeechToText = {
    isSupported: false,
    isListening: false,
    recognition: null,
    language: 'en-US',

    init() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        this.showUnsupported();
        return;
      }

      this.isSupported = true;
      this.recognition = new SpeechRecognition();

      this.configure();
      this.bindEvents();
      this.loadPreferences();
    },

    configure() {
      this.recognition.lang = this.language;
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
    },

    showUnsupported() {
      elements.sttStatusBadge.innerHTML =
        '<span class="status-dot error"></span>' +
        '<span class="status-text">Unsupported</span>';
      elements.sttStart.disabled = true;
      UI.showToast('Speech recognition not supported. Use Chrome.', 'error', 6000);
    },

    loadPreferences() {
      try {
        const savedLang = localStorage.getItem('stt_language');
        if (savedLang) {
          this.language = savedLang;
          elements.sttLanguage.value = savedLang;
          if (this.recognition) {
            this.recognition.lang = savedLang;
          }
        }
      } catch (e) {}
    },

    bindEvents() {
      if (!this.recognition) return;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.updateUI(true);
        UI.showToast('Listening started', 'info', 2000);
      };

      this.recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript.trim() + ' ';
          }
        }
        if (transcript) {
          elements.sttText.value += transcript;
          UI.updateCharCount(elements.sttText, elements.sttCharCount);
        }
      };

      this.recognition.onerror = (event) => {
        console.error('STT Error:', event.error);

        const errorMessages = {
          'no-speech': 'No speech detected.',
          'audio-capture': 'No microphone found.',
          'not-allowed': 'Microphone permission denied.',
          'network': 'Network error.',
          'aborted': 'Listening stopped.',
          'language-not-supported': 'Language not supported.'
        };

        const message = errorMessages[event.error] || 'Error: ' + event.error;

        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          UI.showToast(message, 'error', 4000);
        }

        if (event.error === 'not-allowed') {
          this.stop();
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
          try {
            this.recognition.start();
          } catch (e) {
            this.isListening = false;
            this.updateUI(false);
          }
        }
      };

      elements.sttStart.addEventListener('click', () => this.start(), { passive: true });
      elements.sttStop.addEventListener('click', () => this.stop(), { passive: true });
      elements.sttCopy.addEventListener('click', () => this.copyTranscript(), { passive: true });
      elements.sttClear.addEventListener('click', () => this.clearTranscript(), { passive: true });

      elements.sttLanguage.addEventListener('change', (e) => {
        this.language = e.target.value;
        this.recognition.lang = this.language;
        try {
          localStorage.setItem('stt_language', this.language);
        } catch (e) {}
      }, { passive: true });
    },

    start() {
      if (!this.isSupported) {
        UI.showToast('Speech recognition not supported', 'error');
        return;
      }

      if (this.isListening) return;

      elements.sttText.value = '';
      UI.updateCharCount(elements.sttText, elements.sttCharCount);

      try {
        this.recognition.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
        UI.showToast('Failed to start listening', 'error');
      }
    },

    stop() {
      if (!this.isListening || !this.recognition) return;

      this.isListening = false;

      try {
        this.recognition.stop();
      } catch (e) {
        console.error('Failed to stop recognition:', e);
      }

      this.updateUI(false);
    },

    updateUI(isListening) {
      elements.sttStart.disabled = isListening;
      elements.sttStop.disabled = !isListening;

      if (isListening) {
        elements.sttStatusBadge.innerHTML =
          '<span class="status-dot listening"></span><span class="status-text">Listening...</span>';
      } else {
        elements.sttStatusBadge.innerHTML =
          '<span class="status-dot idle"></span><span class="status-text">Idle</span>';
      }
    },

    copyTranscript() {
      const text = elements.sttText.value.trim();
      if (!text) {
        UI.showToast('No transcript to copy', 'info');
        return;
      }

      navigator.clipboard.writeText(text).then(() => {
        UI.showToast('Transcript copied', 'success');
      }).catch(() => {
        UI.showToast('Failed to copy', 'error');
      });
    },

    clearTranscript() {
      elements.sttText.value = '';
      UI.updateCharCount(elements.sttText, elements.sttCharCount);
      UI.showToast('Transcript cleared', 'info', 2000);
    }
  };

  /* ========================================
     Recorder Module
     ======================================== */
  const Recorder = {
    mediaRecorder: null,
    isRecording: false,
    chunks: [],
    stream: null,
    timerInterval: null,
    startTime: null,

    init() {
      this.checkSupport();
      this.bindEvents();
    },

    checkSupport() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        elements.recStatusBadge.innerHTML =
          '<span class="status-dot error"></span>' +
          '<span class="status-text">Unsupported</span>';
        elements.recStart.disabled = true;
        return;
      }

      if (!window.MediaRecorder) {
        elements.recStatusBadge.innerHTML =
          '<span class="status-dot error"></span>' +
          '<span class="status-text">Unsupported</span>';
        elements.recStart.disabled = true;
        UI.showToast('MediaRecorder not supported', 'error');
        return;
      }

      this.isSupported = true;
    },

    bindEvents() {
      elements.recStart.addEventListener('click', () => this.start(), { passive: true });
      elements.recStop.addEventListener('click', () => this.stop(), { passive: true });
      elements.recDownload.addEventListener('click', () => this.download(), { passive: true });
    },

    async start() {
      if (!this.isSupported) {
        UI.showToast('Recording not supported', 'error');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        this.stream = stream;
        this.chunks = [];

        const mimeType = this.getMimeType();
        const options = mimeType ? { mimeType } : undefined;

        this.mediaRecorder = new MediaRecorder(stream, options);

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            this.chunks.push(event.data);
          }
        };

        this.mediaRecorder.onstart = () => {
          this.isRecording = true;
          this.updateUI(true);
          this.startTimer();
          UI.showToast('Recording started', 'success', 2000);
        };

        this.mediaRecorder.onstop = () => {
          this.isRecording = false;
          this.stopTimer();
          this.updateUI(false);
          this.createPreview();
        };

        this.mediaRecorder.onerror = (event) => {
          console.error('Recorder error:', event);
          UI.showToast('Recording error', 'error');
          this.cleanup();
        };

        this.mediaRecorder.start(100);

      } catch (error) {
        console.error('Failed to start recording:', error);

        let message = 'Failed to start recording';
        if (error.name === 'NotAllowedError') {
          message = 'Microphone permission denied.';
        } else if (error.name === 'NotFoundError') {
          message = 'No microphone found.';
        }

        UI.showToast(message, 'error', 5000);
      }
    },

    stop() {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return;
      }

      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.error('Failed to stop recording:', e);
        this.cleanup();
      }
    },

    createPreview() {
      if (this.chunks.length === 0) {
        UI.showToast('No recording data', 'error');
        return;
      }

      const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);

      elements.recAudio.src = url;
      elements.recPreview.hidden = false;

      UI.showToast('Recording complete', 'success', 2000);
    },

    download() {
      if (this.chunks.length === 0) {
        UI.showToast('No recording to download', 'info');
        return;
      }

      const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = this.generateFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      UI.showToast('Recording downloaded', 'success', 2000);
    },

    cleanup() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }

      this.chunks = [];
      this.mediaRecorder = null;
      this.isRecording = false;

      this.updateUI(false);
      this.stopTimer();
    },

    startTimer() {
      this.startTime = Date.now();
      const display = elements.recTimer.querySelector('.timer-display');

      this.timerInterval = setInterval(() => {
        const elapsed = (Date.now() - this.startTime) / 1000;
        if (display) {
          display.textContent = this.formatTime(elapsed);
        }
      }, 100);
    },

    stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      const display = elements.recTimer.querySelector('.timer-display');
      if (display) {
        display.textContent = '00:00';
      }
    },

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    },

    generateFilename() {
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '');
      return 'recording-' + timestamp + '.webm';
    },

    getMimeType() {
      const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];

      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      }
      return null;
    },

    updateUI(isRecording) {
      elements.recStart.disabled = isRecording;
      elements.recStop.disabled = !isRecording;

      if (isRecording) {
        elements.recStatusBadge.innerHTML =
          '<span class="status-dot recording"></span><span class="status-text">Recording...</span>';
      } else {
        elements.recStatusBadge.innerHTML =
          '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
      }
    }
  };

  /* ========================================
     DOM Elements Cache
     ======================================== */
  const elements = {
    sttStart: document.getElementById('sttStart'),
    sttStop: document.getElementById('sttStop'),
    sttText: document.getElementById('sttText'),
    sttStatusBadge: document.getElementById('sttStatusBadge'),
    sttLanguage: document.getElementById('sttLanguage'),
    sttCharCount: document.getElementById('sttCharCount'),
    sttCopy: document.getElementById('sttCopy'),
    sttClear: document.getElementById('sttClear'),

    ttsText: document.getElementById('ttsText'),
    ttsPlay: document.getElementById('ttsPlay'),
    ttsPause: document.getElementById('ttsPause'),
    ttsResume: document.getElementById('ttsResume'),
    ttsStop: document.getElementById('ttsStop'),
    ttsPrev: document.getElementById('ttsPrev'),
    ttsNext: document.getElementById('ttsNext'),
    ttsRestart: document.getElementById('ttsRestart'),
    ttsStatusBadge: document.getElementById('ttsStatusBadge'),
    voiceSelect: document.getElementById('voiceSelect'),
    ttsLanguage: document.getElementById('ttsLanguage'),
    speedControl: document.getElementById('speedControl'),
    speedValue: document.getElementById('speedValue'),
    ttsCharCount: document.getElementById('ttsCharCount'),
    ttsChunkCount: document.getElementById('ttsChunkCount'),
    ttsWarning: document.getElementById('ttsWarning'),
    ttsProgress: document.getElementById('ttsProgress'),
    ttsProgressPercent: document.getElementById('ttsProgressPercent'),
    ttsClear: document.getElementById('ttsClear'),

    recStart: document.getElementById('recStart'),
    recStop: document.getElementById('recStop'),
    recStatusBadge: document.getElementById('recStatusBadge'),
    recTimer: document.getElementById('recTimer'),
    recPreview: document.getElementById('recPreview'),
    recAudio: document.getElementById('recAudio'),
    recDownload: document.getElementById('recDownload'),

    toastContainer: document.getElementById('toastContainer')
  };

  /* ========================================
     Initialization
     ======================================== */
  function init() {
    AppState.init();
    checkBrowserSupport();

    SpeechToText.init();
    SpeechController.init();
    Recorder.init();

    UI.updateCharCount(elements.sttText, elements.sttCharCount);
    UI.updateCharCount(elements.ttsText, elements.ttsCharCount);
    SpeechController.updateTextInfo();
    SpeechController.updateControls();

    console.log('Voice Assistant Pro initialized - Deep Repaired');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();