/* ========================================
   Voice Assistant Pro - Production JavaScript
   Enhanced TTS with Verified Playback
   ======================================== */

(function() {
  'use strict';

  /* ========================================
     TTS State Model - Single Source of Truth
     ======================================== */
  const TtsState = {
    text: '',
    chunks: [],
    totalChunks: 0,
    currentChunkIndex: 0,
    selectedVoiceIndex: 0,
    rate: 1,
    pitch: 1,
    volume: 1,
    lastError: null,
    isBrowserSupported: false,
    areVoicesLoaded: false,
    provider: 'browser',
    
    playbackState: 'idle',
    
    init() {
      this.reset();
    },
    
    reset() {
      this.chunks = [];
      this.totalChunks = 0;
      this.currentChunkIndex = 0;
      this.playbackState = 'idle';
      this.lastError = null;
    },
    
    canPlay() {
      const hasText = this.text.trim().length > 0;
      const hasChunks = this.totalChunks > 0;
      return hasText && hasChunks && this.isBrowserSupported && this.areVoicesLoaded && 
             (this.playbackState === 'idle' || this.playbackState === 'finished');
    }
  };

  /* ========================================
     Playback State Machine
     ======================================== */
  const PlaybackState = {
    IDLE: 'idle',
    PREPARING: 'preparing',
    READY: 'ready',
    STARTING: 'starting',
    SPEAKING: 'speaking',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    FINISHED: 'finished',
    ERROR: 'error',
    
    isValidTransition(fromState, toState) {
      const validTransitions = {
        [this.IDLE]: [this.PREPARING, this.READY],
        [this.PREPARING]: [this.READY, this.STARTING, this.SPEAKING, this.ERROR, this.IDLE],
        [this.READY]: [this.STARTING, this.SPEAKING, this.IDLE],
        [this.STARTING]: [this.SPEAKING, this.ERROR, this.IDLE],
        [this.SPEAKING]: [this.PAUSED, this.STOPPING, this.FINISHED, this.ERROR],
        [this.PAUSED]: [this.SPEAKING, this.STOPPING, this.IDLE],
        [this.STOPPING]: [this.STOPPED, this.IDLE],
        [this.STOPPED]: [this.READY, this.IDLE],
        [this.FINISHED]: [this.IDLE, this.READY],
        [this.ERROR]: [this.IDLE]
      };
      return validTransitions[fromState]?.includes(toState) || false;
    },
    
    transition(newState) {
      const oldState = TtsState.playbackState;
      if (this.isValidTransition(oldState, newState)) {
        TtsState.playbackState = newState;
        console.log(`[TTS State] ${oldState} -> ${newState}`);
        return true;
      }
      console.warn(`[TTS State] Invalid transition: ${oldState} -> ${newState}`);
      return false;
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
      console.log(`[Session] New session started: ${this.currentSessionId}`);
      return this.currentSessionId;
    },
    
    isCurrentSession(sessionId) {
      return sessionId === this.currentSessionId;
    },
    
    isStale(sessionId) {
      return sessionId !== this.currentSessionId && sessionId !== null;
    }
  };

  /* ========================================
     Browser Support Detection
     ======================================== */
  function checkBrowserSupport() {
    TtsState.isBrowserSupported = 'speechSynthesis' in window;
    
    if (!TtsState.isBrowserSupported) {
      console.warn('[TTS] Browser speech synthesis not supported');
    } else {
      console.log('[TTS] Browser speech synthesis available');
    }
    
    return TtsState.isBrowserSupported;
  }

  /* ========================================
     Voice Manager - Robust Voice Handling
     ======================================== */
  const VoiceManager = {
    voices: [],
    loadAttempts: 0,
    maxAttempts: 10,
    loadingTimeout: null,
    
    init() {
      this.loadVoices();
      this.setupVoiceChangedHandler();
    },
    
    setupVoiceChangedHandler() {
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    },
    
    loadVoices() {
      let voices = speechSynthesis.getVoices() || [];
      
      if (voices.length === 0 && window.speechSynthesis?.getVoices) {
        voices = window.speechSynthesis.getVoices() || [];
      }
      
      if (voices.length > 0) {
        this.voices = voices;
        state.tts.voices = voices;
        state.tts.isLoaded = true;
        TtsState.areVoicesLoaded = true;
        state.tts.retryCount = 0;
        
        console.log(`[VoiceManager] Loaded ${voices.length} voices`);
        
        this.validateAndSelectVoice();
        SpeechController.updateControls();
        return;
      }
      
      if (state.tts.retryCount < state.tts.maxRetries) {
        state.tts.retryCount++;
        console.log(`[VoiceManager] Retry loading voices (attempt ${state.tts.retryCount})`);
        setTimeout(() => this.loadVoices(), 300);
      } else {
        console.error('[VoiceManager] Failed to load voices after max retries');
        TtsState.lastError = 'Voice loading failed';
        SpeechController.updateControls();
      }
    },
    
    validateAndSelectVoice() {
      const savedVoiceIndex = this.getSavedVoiceIndex();
      const select = elements.voiceSelect;
      
      if (select.options.length === 0) {
        this.populateVoiceList(this.voices);
      }
      
      if (savedVoiceIndex !== null && this.voices[savedVoiceIndex]) {
        const optionIndex = this.findOptionIndexByVoiceIndex(savedVoiceIndex);
        if (optionIndex !== null) {
          select.selectedIndex = optionIndex;
          TtsState.selectedVoiceIndex = savedVoiceIndex;
          console.log(`[VoiceManager] Restored saved voice: ${savedVoiceIndex}`);
          return;
        }
      }
      
      const bestVoice = this.findBestVoice();
      if (bestVoice !== null) {
        const optionIndex = this.findOptionIndexByVoiceIndex(bestVoice.index);
        if (optionIndex !== null) {
          select.selectedIndex = optionIndex;
          TtsState.selectedVoiceIndex = bestVoice.index;
          console.log(`[VoiceManager] Selected best voice: ${bestVoice.name}`);
          showToast('Using best available voice', 'info', 2000);
        }
      }
    },
    
    getSavedVoiceIndex() {
      try {
        const saved = localStorage.getItem('tts_voice');
        return saved ? parseInt(saved, 10) : null;
      } catch (e) {
        return null;
      }
    },
    
    findBestVoice() {
      const preferredNames = [
        'samantha', 'zira', 'google us english', 'microsoft david',
        'alex', 'daniel', 'mei-jia', 'tessa', 'venessa'
      ];
      
      for (const name of preferredNames) {
        const found = this.voices.find((v, i) => 
          v.name.toLowerCase().includes(name)
        );
        if (found) {
          return { index: this.voices.indexOf(found), name: found.name };
        }
      }
      
      const englishVoices = this.voices.filter(v => 
        v.lang.startsWith('en')
      );
      if (englishVoices.length > 0) {
        const defaultVoice = englishVoices.find(v => v.default) || englishVoices[0];
        const index = this.voices.indexOf(defaultVoice);
        return { index, name: defaultVoice.name };
      }
      
      if (this.voices.length > 0) {
        return { index: 0, name: this.voices[0].name };
      }
      
      return null;
    },
    
    findOptionIndexByVoiceIndex(voiceIndex) {
      const select = elements.voiceSelect;
      for (let i = 0; i < select.options.length; i++) {
        if (parseInt(select.options[i].value, 10) === voiceIndex) {
          return i;
        }
      }
      return null;
    },
    
    populateVoiceList(voices) {
      const select = elements.voiceSelect;
      select.innerHTML = '';
      
      const sortedVoices = [...voices].sort((a, b) => {
        const aLang = a.lang.split('-')[0];
        const bLang = b.lang.split('-')[0];
        if (aLang !== bLang) return aLang.localeCompare(bLang);
        return a.name.localeCompare(b.name);
      });
      
      sortedVoices.forEach(voice => {
        const option = document.createElement('option');
        let label = voice.name;
        
        const lowerName = voice.name.toLowerCase();
        if (lowerName.includes('female') || lowerName.includes('zira') || lowerName.includes('samantha')) {
          label += ' (F)';
        } else if (lowerName.includes('male') || lowerName.includes('david') || lowerName.includes('daniel')) {
          label += ' (M)';
        }
        
        const voiceIndex = voices.indexOf(voice);
        option.value = voiceIndex;
        option.textContent = label;
        
        select.appendChild(option);
      });
      
      console.log(`[VoiceManager] Populated ${voices.length} voices in dropdown`);
    },
    
    getSelectedVoice() {
      const voiceIndex = parseInt(elements.voiceSelect.value, 10);
      const voice = this.voices[voiceIndex];
      
      if (voice) {
        return voice;
      }
      
      if (this.voices.length > 0) {
        const fallback = this.findBestVoice();
        if (fallback) {
          console.warn('[VoiceManager] Selected voice not found, using fallback');
          return this.voices[fallback.index];
        }
      }
      
      return null;
    }
  };

  /* ========================================
     Chunking Engine - Enhanced for Natural Speech
     ======================================== */
  const ChunkingEngine = {
    MAX_CHUNK_SIZE: 5000,
    SAFE_LENGTH: 4500,
    MIN_CHUNK_SIZE: 300,
    
    chunk(text) {
      if (!text || typeof text !== 'string' || text.length === 0) {
        return [];
      }

      text = this.preprocessText(text);
      if (!text) return [];

      const cleanText = text.trim();
      if (cleanText.length === 0) return [];

      if (cleanText.length <= this.SAFE_LENGTH) {
        return [cleanText];
      }

      try {
        const chunks = this.naturalSplit(text);
        return this.validateChunks(chunks, cleanText);
      } catch (e) {
        console.error('Chunking failed:', e);
        return [cleanText.substring(0, this.SAFE_LENGTH)];
      }
    },

    preprocessText(text) {
      if (typeof text !== 'string') return '';
      return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/  +/g, ' ')
        .replace(/\n\n+/g, '\n\n')
        .trim();
    },

    validateChunks(chunks, originalText) {
      const valid = (chunks || []).filter(c => 
        c && typeof c === 'string' && c.trim().length > 0 && 
        c.trim().replace(/^[.,!?;:()[\]{}]+|[.,!?;:()[\]{}]+$/g, '').length > 0
      );
      if (valid.length > 0) return valid;

      if (originalText && originalText.length > 0) {
        return [originalText.substring(0, this.SAFE_LENGTH)];
      }
      return [];
    },

    naturalSplit(text) {
      const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p && p.length > 0);
      
      if (paragraphs.length === 0) {
        return this.hardSplit(text);
      }

      const chunks = [];
      
      for (const para of paragraphs) {
        if (para.length <= this.SAFE_LENGTH) {
          chunks.push(para);
        } else {
          const subChunks = this.splitParagraphNaturally(para);
          chunks.push(...subChunks);
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
    },

    estimateDuration(text, rate = 1) {
      const wordsPerMinute = 150 * rate;
      const wordCount = text.split(/\s+/).length;
      return (wordCount / wordsPerMinute) * 60;
    }
  };

  /* ========================================
     Speech Controller - Central Playback Control
     with VERIFIED playback lifecycle
     ======================================== */
  const SpeechController = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    isCancelled: false,
    currentUtterance: null,
    sessionId: null,
    
    chunkStartTime: null,
    didCurrentChunkStart: false,
    startTimeoutId: null,
    START_TIMEOUT_MS: 2000,
    
    init() {
      checkBrowserSupport();
      
      if (!TtsState.isBrowserSupported) {
        this.showUnsupportedUI();
        return;
      }
      
      VoiceManager.init();
      this.bindEvents();
      this.loadPreferences();
      this.updateControls();
      this.updateProgressUI();
    },

    showUnsupportedUI() {
      elements.ttsStatusBadge.innerHTML = 
        '<span class="status-dot" style="background: var(--accent-danger)"></span>' +
        '<span class="status-text">Unsupported</span>';
      elements.ttsPlay.disabled = true;
      showToast('Browser TTS not supported. Use Chrome or Edge.', 'error');
    },

    bindEvents() {
      elements.ttsPlay.addEventListener('click', () => this.play());
      elements.ttsPause.addEventListener('click', () => this.pause());
      elements.ttsResume.addEventListener('click', () => this.resume());
      elements.ttsStop.addEventListener('click', () => this.stop());
      elements.ttsPrev.addEventListener('click', () => this.skipPrev());
      elements.ttsNext.addEventListener('click', () => this.skipNext());
      elements.ttsRestart.addEventListener('click', () => this.restart());
      
      elements.speedControl.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        TtsState.rate = val;
        elements.speedValue.textContent = val + 'x';
        try {
          localStorage.setItem('tts_speed', val);
        } catch (e) {}
      });

      elements.voiceSelect.addEventListener('change', (e) => {
        TtsState.selectedVoiceIndex = parseInt(e.target.value, 10) || 0;
        try {
          localStorage.setItem('tts_voice', e.target.value);
        } catch (e) {}
        this.updateControls();
      });

      elements.ttsText.addEventListener('input', () => {
        updateCharCount(elements.ttsText, elements.ttsCharCount);
        this.updateTextInfo();
      });

      elements.ttsClear.addEventListener('click', () => {
        this.clearText();
      });

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
          TtsState.rate = val;
        }
        
        const savedLang = localStorage.getItem('tts_lang');
        if (savedLang) {
          elements.ttsLanguage.value = savedLang;
        }
      } catch (e) {
        console.warn('Could not load preferences:', e);
      }
    },

    updateTextInfo() {
      const text = elements.ttsText.value;
      TtsState.text = text;
      
      const chunks = ChunkingEngine.chunk(text);
      TtsState.chunks = chunks;
      TtsState.totalChunks = chunks.length;
      
      elements.ttsChunkCount.textContent = chunks.length + ' chunk' + (chunks.length !== 1 ? 's' : '');
      
      if (text.length > 50000) {
        elements.ttsWarning.textContent = 'Very large text - may take time';
        elements.ttsWarning.hidden = false;
      } else if (text.length > 30000) {
        elements.ttsWarning.textContent = 'Large text - processing...';
        elements.ttsWarning.hidden = false;
      } else {
        elements.ttsWarning.hidden = true;
      }
      
      this.updateControls();
    },

    updateControls() {
      const hasText = TtsState.text.trim().length > 0;
      const browserSupported = TtsState.isBrowserSupported;
      const voicesLoaded = TtsState.areVoicesLoaded;
      const hasChunks = TtsState.totalChunks > 0;
      const queueHasItems = this.queue.length > 0;
      
      const isIdle = TtsState.playbackState === 'idle' || TtsState.playbackState === 'finished';
      const isSpeaking = TtsState.playbackState === 'speaking' || TtsState.playbackState === 'starting';
      const isPausedState = TtsState.playbackState === 'paused';
      
      const canPlay = hasText && browserSupported && voicesLoaded && isIdle;
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

      if (canPause) {
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

    updateProgressUI() {
      const hasText = TtsState.text.trim().length > 0;
      const chunks = hasText ? (this.queue.length > 0 ? this.queue : TtsState.chunks) : [];
      const total = chunks.length;
      const current = this.currentIndex;
      
      if (total === 0 && hasText) {
        elements.ttsProgress.textContent = '0 / 0';
        elements.ttsProgressPercent.textContent = '0%';
        elements.ttsStatusBadge.innerHTML = 
          '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
      } else if (total > 0) {
        const displayCurrent = (this.isPlaying || this.isPaused) ? (current + 1) : 0;
        const percent = total > 0 ? Math.round((displayCurrent / total) * 100) : 0;
        elements.ttsProgress.textContent = displayCurrent + ' / ' + total;
        elements.ttsProgressPercent.textContent = percent + '%';
        
        const state = TtsState.playbackState;
        if (state === 'starting') {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot speaking"></span><span class="status-text">Starting...</span>';
        } else if (state === 'speaking') {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot speaking"></span>' +
            '<span class="status-text">Playing ' + displayCurrent + '/' + total + '</span>';
        } else if (state === 'paused') {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot ready"></span><span class="status-text">Paused</span>';
        } else if (state === 'finished') {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot ready"></span><span class="status-text">Finished</span>';
        } else if (state === 'error') {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot" style="background: var(--accent-danger)"></span>' +
            '<span class="status-text">Error</span>';
        } else {
          elements.ttsStatusBadge.innerHTML = 
            '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
        }
      } else {
        elements.ttsProgress.textContent = '0 / 0';
        elements.ttsProgressPercent.textContent = '0%';
        elements.ttsStatusBadge.innerHTML = 
          '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
      }
    },

    clearText() {
      this.stop();
      elements.ttsText.value = '';
      TtsState.text = '';
      TtsState.reset();
      updateCharCount(elements.ttsText, elements.ttsCharCount);
      this.updateTextInfo();
      showToast('Text cleared', 'info', 2000);
    },

    play() {
      const text = elements.ttsText.value.trim();
      
      if (!text) {
        showToast('Please enter some text to speak', 'info');
        return;
      }

      if (!TtsState.isBrowserSupported) {
        showToast('Browser TTS not supported', 'error');
        return;
      }

      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      TtsState.lastError = null;

      if (!TtsState.areVoicesLoaded || state.tts.voices.length === 0) {
        showToast('Loading voices, please wait...', 'info');
        VoiceManager.loadVoices();
        setTimeout(() => {
          if (TtsState.areVoicesLoaded) {
            this.play();
          } else {
            showToast('Voice loading failed', 'error');
          }
        }, 1500);
        return;
      }

      const chunks = ChunkingEngine.chunk(text);
      
      if (!chunks || chunks.length === 0) {
        showToast('No valid text to speak', 'error');
        TtsState.lastError = 'No valid chunks';
        this.updateControls();
        return;
      }

      const voice = VoiceManager.getSelectedVoice();
      if (!voice) {
        showToast('No voice available', 'error');
        TtsState.lastError = 'No voice';
        this.updateControls();
        return;
      }

      this.sessionId = SessionManager.startNewSession();
      this.queue = chunks;
      this.isCancelled = false;
      this.currentIndex = 0;
      this.isPlaying = true;
      this.isPaused = false;
      
      TtsState.chunks = chunks;
      TtsState.totalChunks = chunks.length;
      TtsState.currentChunkIndex = 0;
      PlaybackState.transition('starting');
      
      this.updateControls();
      this.updateProgressUI();
      
      showToast('Playing ' + chunks.length + ' chunk(s)...', 'info', 2000);
      
      try {
        this.speakCurrentChunk();
      } catch (e) {
        console.error('Speak error:', e);
        showToast('Error: ' + e.message, 'error');
        this.handleError(e.message);
      }
    },

    speakCurrentChunk() {
      const currentSession = this.sessionId;
      
      if (this.isCancelled || !SessionManager.isCurrentSession(currentSession)) {
        console.log('[TTS] Session cancelled or stale, stopping');
        PlaybackState.transition('idle');
        this.clearStartTimeout();
        return;
      }
      
      if (this.currentIndex >= this.queue.length) {
        this.onPlaybackComplete();
        return;
      }

      const chunk = this.queue[this.currentIndex];
      
      if (!this.validateChunk(chunk)) {
        console.warn('[TTS] Invalid chunk at index', this.currentIndex, chunk);
        this.currentIndex++;
        setTimeout(() => {
          if (SessionManager.isCurrentSession(currentSession) && !this.isCancelled) {
            this.speakCurrentChunk();
          }
        }, 50);
        return;
      }
      
      TtsState.currentChunkIndex = this.currentIndex;
      
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      const utter = new SpeechSynthesisUtterance(chunk);
      
      const voice = VoiceManager.getSelectedVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      }
      
      utter.rate = parseFloat(elements.speedControl.value) || TtsState.rate;
      utter.pitch = TtsState.pitch;
      utter.volume = TtsState.volume;

      this.currentUtterance = utter;
      
      this.didCurrentChunkStart = false;
      this.chunkStartTime = Date.now();
      
      this.clearStartTimeout();
      this.startTimeoutId = setTimeout(() => {
        this.handleStartTimeout(currentSession);
      }, this.START_TIMEOUT_MS);

      const sessionCheck = this.sessionId;

      utter.onstart = () => {
        this.clearStartTimeout();
        
        if (!SessionManager.isCurrentSession(sessionCheck)) {
          console.log('[TTS] onstart - stale session, ignoring');
          return;
        }
        if (this.isCancelled) return;
        
        this.didCurrentChunkStart = true;
        this.isPlaying = true;
        PlaybackState.transition('speaking');
        console.log('[TTS] Speech started for chunk', this.currentIndex + 1);
        this.updateProgressUI();
      };

      utter.onend = () => {
        this.clearStartTimeout();
        
        if (!SessionManager.isCurrentSession(sessionCheck)) {
          console.log('[TTS] onend - stale session, ignoring');
          return;
        }
        if (this.isCancelled) return;
        
        console.log('[TTS] onend fired, didStart:', this.didCurrentChunkStart);
        
        if (!this.didCurrentChunkStart) {
          console.warn('[TTS] onend fired but speech never started - treating as failure');
          this.handleChunkFailed(currentSession, 'Speech failed to start');
          return;
        }
        
        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => {
            if (SessionManager.isCurrentSession(sessionCheck) && !this.isCancelled) {
              this.speakCurrentChunk();
            }
          }, 200);
        } else {
          this.onPlaybackComplete();
        }
      };

      utter.onerror = (event) => {
        this.clearStartTimeout();
        
        if (!SessionManager.isCurrentSession(sessionCheck)) {
          console.log('[TTS] onerror - stale session, ignoring');
          return;
        }
        if (this.isCancelled) return;
        
        if (event.error === 'canceled' || event.error === 'interrupted') {
          console.log('[TTS] onerror: canceled/interrupted, ignoring');
          return;
        }
        
        console.error('[TTS] onerror:', event.error);
        TtsState.lastError = event.error;
        
        if (!this.didCurrentChunkStart) {
          console.warn('[TTS] onerror before onstart - speech failed');
          this.handleChunkFailed(currentSession, event.error);
          return;
        }
        
        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => {
            if (SessionManager.isCurrentSession(sessionCheck) && !this.isCancelled) {
              this.speakCurrentChunk();
            }
          }, 200);
        } else {
          this.onPlaybackComplete();
        }
      };

      try {
        speechSynthesis.speak(utter);
      } catch (e) {
        this.clearStartTimeout();
        console.error('[TTS] speak() threw exception:', e);
        TtsState.lastError = e.message;
        this.handleChunkFailed(currentSession, e.message);
      }
    },

    validateChunk(chunk) {
      if (!chunk || typeof chunk !== 'string') {
        return false;
      }
      
      const trimmed = chunk.trim();
      if (trimmed.length === 0) {
        return false;
      }
      
      const nonWhitespace = trimmed.replace(/^[.,!?;:()[\]{}'"]+|[.,!?;:()[\]{}'"]+$/g, '').trim();
      if (nonWhitespace.length === 0) {
        return false;
      }
      
      return true;
    },

    handleStartTimeout(sessionId) {
      if (!SessionManager.isCurrentSession(sessionId)) {
        return;
      }
      if (this.isCancelled) return;
      
      console.warn('[TTS] Start timeout - speech did not start within', this.START_TIMEOUT_MS, 'ms');
      
      if (this.didCurrentChunkStart) {
        return;
      }
      
      this.handleChunkFailed(sessionId, 'Speech failed to start');
    },

    handleChunkFailed(sessionId, errorMessage) {
      if (!SessionManager.isCurrentSession(sessionId)) {
        return;
      }
      
      console.error('[TTS] Chunk failed:', errorMessage);
      
      if (this.currentIndex < this.queue.length - 1) {
        console.log('[TTS] Trying next chunk...');
        this.currentIndex++;
        setTimeout(() => {
          if (SessionManager.isCurrentSession(sessionId) && !this.isCancelled) {
            this.speakCurrentChunk();
          }
        }, 300);
      } else {
        console.error('[TTS] All chunks failed');
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
      PlaybackState.transition('paused');
      speechSynthesis.pause();
      this.updateControls();
      this.updateProgressUI();
      showToast('Paused', 'info', 1500);
    },

    resume() {
      if (!this.isPaused) return;
      
      this.isPaused = false;
      this.isPlaying = true;
      PlaybackState.transition('speaking');
      speechSynthesis.resume();
      this.updateControls();
      this.updateProgressUI();
      showToast('Resuming...', 'info', 1500);
    },

    stop() {
      this.isCancelled = true;
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = 0;
      this.currentUtterance = null;
      this.sessionId = null;
      this.didCurrentChunkStart = false;
      this.clearStartTimeout();
      TtsState.currentChunkIndex = 0;
      PlaybackState.transition('idle');
      
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
      }
      
      this.updateControls();
      this.updateProgressUI();
      showToast('Stopped', 'info', 1500);
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
      TtsState.currentChunkIndex = 0;
      PlaybackState.transition('finished');
      this.updateControls();
      this.updateProgressUI();
      showToast('Finished speaking', 'success', 2000);
    },

    handleError(message) {
      this.isPlaying = false;
      this.isPaused = false;
      this.clearStartTimeout();
      PlaybackState.transition('error');
      TtsState.lastError = message;
      this.updateControls();
      this.updateProgressUI();
      showToast('Playback error: ' + message, 'error', 4000);
    }
  };

  /* ========================================
     Legacy SpeechManager (for compatibility)
     ======================================== */
  const SpeechManager = {
    init() {
      return SpeechController.init();
    },
    loadVoices() {
      return VoiceManager.loadVoices();
    },
    bindEvents() {
      return SpeechController.bindEvents();
    },
    loadPreferences() {
      return SpeechController.loadPreferences();
    },
    updateTextInfo() {
      return SpeechController.updateTextInfo();
    },
    updateTtsControlsState() {
      return SpeechController.updateControls();
    },
    updateProgressUI() {
      return SpeechController.updateProgressUI();
    },
    play() {
      return SpeechController.play();
    },
    pause() {
      return SpeechController.pause();
    },
    resume() {
      return SpeechController.resume();
    },
    stop() {
      return SpeechController.stop();
    },
    skipNext() {
      return SpeechController.skipNext();
    },
    skipPrev() {
      return SpeechController.skipPrev();
    },
    restart() {
      return SpeechController.restart();
    }
  };

  /* ========================================
     State Management
     ======================================== */
  const state = {
    stt: {
      recognition: null,
      isListening: false,
      isSupported: false,
      language: 'en-US'
    },
    tts: {
      voices: [],
      isLoaded: false,
      retryCount: 0,
      maxRetries: 5
    },
    recorder: {
      mediaRecorder: null,
      isRecording: false,
      chunks: [],
      stream: null,
      timerInterval: null,
      startTime: null,
      isSupported: false
    },
    ui: {
      lastToast: null
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
     Utility Functions
     ======================================== */
  function query(selector) {
    return document.querySelector(selector);
  }
  
  function queryAll(selector) {
    return document.querySelectorAll(selector);
  }

  function showToast(message, type = 'info', duration = 3500) {
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
    
    state.ui.lastToast = toast;
    
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function updateCharCount(textarea, counter) {
    if (textarea && counter) {
      const count = textarea.value.length;
      counter.textContent = count + ' character' + (count !== 1 ? 's' : '');
    }
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function generateFilename(prefix = 'recording') {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '');
    return prefix + '-' + timestamp + '.webm';
  }

  function getMimeType() {
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
  }

  /* ========================================
     Speech to Text Module
     ======================================== */
  const SpeechToText = {
    init() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      
      if (!SpeechRecognition) {
        this.showUnsupported();
        return;
      }
      
      state.stt.isSupported = true;
      state.stt.recognition = new SpeechRecognition();
      
      this.configure();
      this.loadPreferences();
      this.bindEvents();
    },

    configure() {
      const rec = state.stt.recognition;
      rec.lang = state.stt.language;
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
    },

    showUnsupported() {
      elements.sttStatusBadge.innerHTML = 
        '<span class="status-dot" style="background: var(--accent-danger)"></span>' +
        '<span class="status-text">Unsupported</span>';
      elements.sttStart.disabled = true;
      showToast('Speech recognition not supported. Use Chrome or Edge.', 'error', 6000);
    },

    loadPreferences() {
      try {
        const savedLang = localStorage.getItem('stt_language');
        if (savedLang) {
          state.stt.language = savedLang;
          elements.sttLanguage.value = savedLang;
          if (state.stt.recognition) {
            state.stt.recognition.lang = savedLang;
          }
        }
      } catch (e) {
        console.warn('Could not load preferences:', e);
      }
    },

    bindEvents() {
      const rec = state.stt.recognition;
      
      rec.onstart = () => {
        state.stt.isListening = true;
        this.updateUI(true);
        showToast('Listening started', 'info', 2000);
      };

      rec.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript.trim() + ' ';
          }
        }
        if (transcript) {
          elements.sttText.value += transcript;
          updateCharCount(elements.sttText, elements.sttCharCount);
        }
      };

      rec.onerror = (event) => {
        console.error('STT Error:', event.error);
        
        const errorMessages = {
          'no-speech': 'No speech detected. Try speaking louder.',
          'audio-capture': 'No microphone found.',
          'not-allowed': 'Microphone permission denied.',
          'network': 'Network error occurred.',
          'aborted': 'Listening was stopped.',
          'language-not-supported': 'Selected language is not supported.'
        };
        
        const message = errorMessages[event.error] || 'Error: ' + event.error;
        
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          showToast(message, 'error', 4000);
        }
        
        if (event.error === 'not-allowed') {
          this.stop();
        }
      };

      rec.onend = () => {
        if (state.stt.isListening) {
          try {
            rec.start();
          } catch (e) {
            console.error('Failed to restart recognition:', e);
            state.stt.isListening = false;
            this.updateUI(false);
          }
        }
      };

      elements.sttStart.addEventListener('click', () => this.start());
      elements.sttStop.addEventListener('click', () => this.stop());
      
      elements.sttLanguage.addEventListener('change', (e) => {
        state.stt.language = e.target.value;
        if (state.stt.recognition) {
          state.stt.recognition.lang = state.stt.language;
        }
        try {
          localStorage.setItem('stt_language', state.stt.language);
        } catch (e) {}
      });

      elements.sttCopy.addEventListener('click', () => this.copyTranscript());
      elements.sttClear.addEventListener('click', () => this.clearTranscript());
    },

    start() {
      if (!state.stt.isSupported) {
        showToast('Speech recognition is not supported', 'error');
        return;
      }
      
      if (state.stt.isListening) return;
      
      elements.sttText.value = '';
      updateCharCount(elements.sttText, elements.sttCharCount);
      
      try {
        state.stt.recognition.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
        showToast('Failed to start listening', 'error');
      }
    },

    stop() {
      if (!state.stt.isListening || !state.stt.recognition) return;
      
      state.stt.isListening = false;
      
      try {
        state.stt.recognition.stop();
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
        showToast('No transcript to copy', 'info');
        return;
      }
      
      navigator.clipboard.writeText(text).then(() => {
        showToast('Transcript copied to clipboard', 'success');
      }).catch(() => {
        showToast('Failed to copy text', 'error');
      });
    },

    clearTranscript() {
      elements.sttText.value = '';
      updateCharCount(elements.sttText, elements.sttCharCount);
      showToast('Transcript cleared', 'info', 2000);
    }
  };

  /* ========================================
     Microphone Recorder Module
     ======================================== */
  const Recorder = {
    init() {
      this.checkSupport();
      this.bindEvents();
    },

    checkSupport() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        state.recorder.isSupported = false;
        elements.recStatusBadge.innerHTML = 
          '<span class="status-dot" style="background: var(--accent-danger)"></span>' +
          '<span class="status-text">Unsupported</span>';
        elements.recStart.disabled = true;
        return;
      }
      
      if (!window.MediaRecorder) {
        state.recorder.isSupported = false;
        elements.recStatusBadge.innerHTML = 
          '<span class="status-dot" style="background: var(--accent-danger)"></span>' +
          '<span class="status-text">Unsupported</span>';
        elements.recStart.disabled = true;
        showToast('MediaRecorder is not supported', 'error');
        return;
      }
      
      state.recorder.isSupported = true;
    },

    bindEvents() {
      elements.recStart.addEventListener('click', () => this.start());
      elements.recStop.addEventListener('click', () => this.stop());
      elements.recDownload.addEventListener('click', () => this.download());
    },

    async start() {
      if (!state.recorder.isSupported) {
        showToast('Recording is not supported', 'error');
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
        
        state.recorder.stream = stream;
        state.recorder.chunks = [];
        
        const mimeType = getMimeType();
        const options = mimeType ? { mimeType } : undefined;
        
        state.recorder.mediaRecorder = new MediaRecorder(stream, options);
        
        state.recorder.mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            state.recorder.chunks.push(event.data);
          }
        };
        
        state.recorder.mediaRecorder.onstart = () => {
          state.recorder.isRecording = true;
          this.updateUI(true);
          this.startTimer();
          showToast('Recording started', 'success', 2000);
        };
        
        state.recorder.mediaRecorder.onstop = () => {
          state.recorder.isRecording = false;
          this.stopTimer();
          this.updateUI(false);
          this.createPreview();
        };
        
        state.recorder.mediaRecorder.onerror = (event) => {
          console.error('Recorder error:', event);
          showToast('Recording error occurred', 'error');
          this.cleanup();
        };
        
        state.recorder.mediaRecorder.start(100);
        
      } catch (error) {
        console.error('Failed to start recording:', error);
        
        let message = 'Failed to start recording';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          message = 'Microphone permission denied. Please allow access.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          message = 'No microphone found.';
        }
        
        showToast(message, 'error', 5000);
      }
    },

    stop() {
      if (!state.recorder.mediaRecorder || state.recorder.mediaRecorder.state === 'inactive') {
        return;
      }
      
      try {
        state.recorder.mediaRecorder.stop();
      } catch (e) {
        console.error('Failed to stop recording:', e);
        this.cleanup();
      }
    },

    createPreview() {
      if (state.recorder.chunks.length === 0) {
        showToast('No recording data available', 'error');
        return;
      }
      
      const mimeType = state.recorder.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(state.recorder.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      elements.recAudio.src = url;
      elements.recPreview.hidden = false;
      
      showToast('Recording complete', 'success', 2000);
    },

    download() {
      if (state.recorder.chunks.length === 0) {
        showToast('No recording to download', 'info');
        return;
      }
      
      const mimeType = state.recorder.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(state.recorder.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = generateFilename('voice-assistant-recording');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showToast('Recording downloaded', 'success', 2000);
    },

    cleanup() {
      if (state.recorder.stream) {
        state.recorder.stream.getTracks().forEach(track => track.stop());
        state.recorder.stream = null;
      }
      
      state.recorder.chunks = [];
      state.recorder.mediaRecorder = null;
      state.recorder.isRecording = false;
      
      this.updateUI(false);
      this.stopTimer();
    },

    startTimer() {
      state.recorder.startTime = Date.now();
      const display = elements.recTimer.querySelector('.timer-display');
      
      state.recorder.timerInterval = setInterval(() => {
        const elapsed = (Date.now() - state.recorder.startTime) / 1000;
        if (display) {
          display.textContent = formatTime(elapsed);
        }
      }, 100);
    },

    stopTimer() {
      if (state.recorder.timerInterval) {
        clearInterval(state.recorder.timerInterval);
        state.recorder.timerInterval = null;
      }
      
      const display = elements.recTimer.querySelector('.timer-display');
      if (display) {
        display.textContent = '00:00';
      }
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
     Initialization
     ======================================== */
  async function init() {
    TtsState.init();
    checkBrowserSupport();
    
    SpeechToText.init();
    SpeechController.init();
    Recorder.init();
    
    updateCharCount(elements.sttText, elements.sttCharCount);
    updateCharCount(elements.ttsText, elements.ttsCharCount);
    SpeechController.updateTextInfo();
    SpeechController.updateControls();
    
    document.addEventListener('touchstart', function onTouchStart() {
      if (speechSynthesis.state === 'suspended') {
        speechSynthesis.resume();
      }
      document.removeEventListener('touchstart', onTouchStart);
    }, { once: true });
    
    if (/Mobi|Android/i.test(navigator.userAgent)) {
      document.addEventListener('click', function onMobileClick() {
        if (speechSynthesis.state === 'suspended') {
          speechSynthesis.resume();
        }
        const dummy = new SpeechSynthesisUtterance('');
        speechSynthesis.speak(dummy);
        document.removeEventListener('click', onMobileClick);
      }, { once: true });
      
      if (navigator.wakeLock && 'wakeLock' in navigator) {
        try {
          await navigator.wakeLock.request('screen');
        } catch (e) {}
      }
    }
    
    console.log('Voice Assistant Pro initialized - Verified Playback TTS');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();