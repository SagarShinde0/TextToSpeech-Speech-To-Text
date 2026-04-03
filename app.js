/* ========================================
   Voice Assistant Pro - Production JavaScript
   Long-Form TTS Version
   ======================================== */

(function() {
  'use strict';

  /* ========================================
     Chunking Engine - Smart text splitting
     ======================================== */
  const ChunkingEngine = {
    MAX_CHUNK_SIZE: 5000,
    MIN_CHUNK_SIZE: 500,
    
    chunk(text) {
      if (!text || typeof text !== 'string' || text.length === 0) return [];
      
      text = this.preprocessText(text);
      if (!text) return [];
      
      const cleanText = text.trim();
      if (cleanText.length === 0) return [];
      
      if (cleanText.length <= this.MAX_CHUNK_SIZE) {
        return [cleanText];
      }
      
      const chunks = [];
      const paragraphs = this.splitByParagraphs(text);
      
      for (const para of paragraphs) {
        if (!para || !para.trim()) continue;
        
        if (para.length <= this.MAX_CHUNK_SIZE) {
          chunks.push(para.trim());
        } else {
          const subChunks = this.splitLargeParagraph(para);
          for (const sc of subChunks) {
            if (sc && sc.trim().length > 0) {
              chunks.push(sc.trim());
            }
          }
        }
      }
      
      const validChunks = chunks.filter(c => c && c.trim().length > 0);
      
      if (validChunks.length === 0 && cleanText.length > 0) {
        return [cleanText.substring(0, this.MAX_CHUNK_SIZE)];
      }
      
      return validChunks;
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
    
    splitByParagraphs(text) {
      if (!text) return [];
      const parts = text.split(/\n\n+/);
      return parts.map(p => p.trim()).filter(p => p && p.length > 0);
    },
    
    splitLargeParagraph(para) {
      if (!para) return [];
      const chunks = [];
      
      const sentences = this.splitBySentences(para);
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if (!sentence) continue;
        
        const testChunk = currentChunk ? (currentChunk + '. ' + sentence) : sentence;
        
        if (testChunk.length > this.MAX_CHUNK_SIZE && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = sentence;
        } else {
          currentChunk = testChunk;
        }
      }
      
      if (currentChunk && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      
      if (chunks.length === 0) {
        return this.hardSplit(para);
      }
      
      if (chunks.some(c => c.length > this.MAX_CHUNK_SIZE)) {
        return chunks.map(c => c.length > this.MAX_CHUNK_SIZE ? this.hardSplit(c)[0] : c).filter(c => c);
      }
      
      return chunks;
    },
    
    splitBySentences(text) {
      if (!text) return [];
      
      const sentenceMatches = text.match(/[^.!?]+[.!?]+[\s\n]+|[^.!?]+$/g);
      
      if (!sentenceMatches || sentenceMatches.length === 0) {
        return [text];
      }
      
      return sentenceMatches.map(s => s.trim()).filter(s => s);
    },
    
    hardSplit(text) {
      if (!text) return [];
      const chunks = [];
      let remaining = text;
      
      while (remaining.length > this.MAX_CHUNK_SIZE) {
        const splitAt = remaining.lastIndexOf(' ', this.MAX_CHUNK_SIZE);
        
        if (splitAt > this.MIN_CHUNK_SIZE) {
          chunks.push(remaining.substring(0, splitAt).trim());
          remaining = remaining.substring(splitAt).trim();
        } else {
          chunks.push(remaining.substring(0, this.MAX_CHUNK_SIZE).trim());
          remaining = remaining.substring(this.MAX_CHUNK_SIZE).trim();
        }
        
        if (!remaining) break;
      }
      
      if (remaining && remaining.trim()) {
        chunks.push(remaining.trim());
      }
      
      return chunks.filter(c => c && c.trim().length > 0);
    }
  };

  /* ========================================
     Speech Manager - Queue-based playback
     ======================================== */
  const SpeechManager = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    isCancelled: false,
    currentUtterance: null,
    
    init() {
      this.loadVoices();
      this.bindEvents();
      this.loadPreferences();
    },

    loadVoices() {
      let voices = speechSynthesis.getVoices() || [];
      
      if (voices.length === 0) {
        voices = window.speechSynthesis?.getVoices() || [];
      }
      
      if (voices.length > 0) {
        state.tts.voices = voices;
        state.tts.isLoaded = true;
        state.tts.retryCount = 0;
        this.populateVoiceList(voices);
        return;
      }
      
      if (state.tts.retryCount < state.tts.maxRetries) {
        state.tts.retryCount++;
        setTimeout(() => this.loadVoices(), 300);
      }
    },

    populateVoiceList(voices) {
      const select = elements.voiceSelect;
      const savedVoice = localStorage.getItem('tts_voice');
      let selectedIndex = 0;
      
      select.innerHTML = '';
      
      const sortedVoices = [...voices].sort((a, b) => {
        const aLang = a.lang.split('-')[0];
        const bLang = b.lang.split('-')[0];
        if (aLang !== bLang) return aLang.localeCompare(bLang);
        return a.name.localeCompare(b.name);
      });
      
      sortedVoices.forEach((voice, index) => {
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
        
        if (savedVoice && parseInt(savedVoice) === voiceIndex) {
          selectedIndex = index;
        }
        
        select.appendChild(option);
      });
      
      if (select.options.length > 0) {
        select.selectedIndex = selectedIndex;
      }
    },

    bindEvents() {
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }

      elements.ttsPlay.addEventListener('click', () => this.play());
      elements.ttsPause.addEventListener('click', () => this.pause());
      elements.ttsResume.addEventListener('click', () => this.resume());
      elements.ttsStop.addEventListener('click', () => this.stop());
      elements.ttsPrev.addEventListener('click', () => this.skipPrev());
      elements.ttsNext.addEventListener('click', () => this.skipNext());
      elements.ttsRestart.addEventListener('click', () => this.restart());
      
      elements.speedControl.addEventListener('input', (e) => {
        elements.speedValue.textContent = e.target.value + 'x';
        try {
          localStorage.setItem('tts_speed', e.target.value);
        } catch (e) {}
      });

      elements.voiceSelect.addEventListener('change', (e) => {
        try {
          localStorage.setItem('tts_voice', e.target.value);
        } catch (e) {}
      });

      elements.ttsText.addEventListener('input', () => {
        updateCharCount(elements.ttsText, elements.ttsCharCount);
        this.updateTextInfo();
      });

      elements.ttsClear.addEventListener('click', () => {
        elements.ttsText.value = '';
        updateCharCount(elements.ttsText, elements.ttsCharCount);
        this.updateTextInfo();
        showToast('Text cleared', 'info', 2000);
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
          elements.speedControl.value = savedSpeed;
          elements.speedValue.textContent = savedSpeed + 'x';
        }
        
        const savedLang = localStorage.getItem('tts_lang');
        if (savedLang) {
          elements.ttsLanguage.value = savedLang;
        }
      } catch (e) {
        console.warn('Could not load TTS preferences:', e);
      }
    },

    updateTextInfo() {
      const text = elements.ttsText.value;
      const chunks = ChunkingEngine.chunk(text);
      const totalChunks = chunks.length;
      
      elements.ttsChunkCount.textContent = totalChunks + ' chunk' + (totalChunks !== 1 ? 's' : '');
      
      if (text.length > 50000) {
        elements.ttsWarning.textContent = 'Very large text detected';
        elements.ttsWarning.hidden = false;
      } else if (text.length > 30000) {
        elements.ttsWarning.textContent = 'Large text - processing...';
        elements.ttsWarning.hidden = false;
      } else {
        elements.ttsWarning.hidden = true;
      }
    },

    play() {
      const text = elements.ttsText.value.trim();
      
      if (!text) {
        showToast('Please enter some text to speak', 'info');
        return;
      }

      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      try {
        if (!state.tts.isLoaded || state.tts.voices.length === 0) {
          showToast('Loading voices, please wait...', 'info');
          this.loadVoices();
          setTimeout(() => this.play(), 1500);
          return;
        }
      } catch (e) {
        console.warn('Voice loading error, retrying:', e);
        showToast('Loading voices...', 'info');
        setTimeout(() => this.play(), 1500);
        return;
      }

      let chunks;
      try {
        chunks = ChunkingEngine.chunk(text);
      } catch (e) {
        console.error('Chunking error:', e);
        chunks = [text.substring(0, 4000)];
      }
      
      if (!chunks || chunks.length === 0) {
        showToast('No valid text to speak', 'error');
        return;
      }

      this.queue = chunks;
      this.isCancelled = false;
      this.currentIndex = 0;
      this.isPlaying = true;
      this.isPaused = false;
      
      showToast('Preparing ' + chunks.length + ' chunk(s)...', 'info', 2000);
      
      try {
        this.speakCurrentChunk();
      } catch (e) {
        console.error('Speak error:', e);
        showToast('Error: ' + e.message, 'error');
        this.isPlaying = false;
        this.updateControlButtons();
      }
    },

    speakCurrentChunk() {
      if (this.isCancelled) return;
      if (this.currentIndex >= this.queue.length) {
        this.onPlaybackComplete();
        return;
      }

      const chunk = this.queue[this.currentIndex];
      
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }

      const utter = new SpeechSynthesisUtterance(chunk);
      
      const selectedIndex = elements.voiceSelect.value;
      const selectedVoice = state.tts.voices[selectedIndex];
      
      if (selectedVoice) {
        utter.voice = selectedVoice;
        utter.lang = selectedVoice.lang;
      }
      
      utter.rate = parseFloat(elements.speedControl.value);
      utter.pitch = 1;
      utter.volume = 1;

      this.currentUtterance = utter;

      utter.onstart = () => {
        if (this.isCancelled) return;
        this.isPlaying = true;
        this.updateProgressUI();
      };

      utter.onend = () => {
        if (this.isCancelled) return;
        
        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => this.speakCurrentChunk(), 100);
        } else {
          this.onPlaybackComplete();
        }
      };

      utter.onerror = (event) => {
        console.error('TTS Error:', event.error);
        
        if (this.isCancelled) return;
        if (event.error === 'canceled' || event.error === 'interrupted') return;
        
        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => this.speakCurrentChunk(), 200);
        } else {
          this.onPlaybackComplete();
        }
      };

      try {
        speechSynthesis.speak(utter);
      } catch (e) {
        console.error('Failed to speak:', e);
        if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          setTimeout(() => this.speakCurrentChunk(), 200);
        } else {
          this.onPlaybackComplete();
        }
      }
    },

    pause() {
      if (!this.isPlaying || this.isPaused) return;
      
      this.isPaused = true;
      this.isPlaying = false;
      speechSynthesis.pause();
      this.updateControlButtons();
      this.updateProgressUI();
      showToast('Paused', 'info', 1500);
    },

    resume() {
      if (!this.isPaused) return;
      
      this.isPaused = false;
      this.isPlaying = true;
      speechSynthesis.resume();
      this.updateControlButtons();
      this.updateProgressUI();
      showToast('Resuming...', 'info', 1500);
    },

    stop() {
      this.isCancelled = true;
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = 0;
      this.currentUtterance = null;
      
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
      }
      
      this.updateControlButtons();
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
      this.play();
    },

    onPlaybackComplete() {
      this.isPlaying = false;
      this.isPaused = false;
      this.currentIndex = 0;
      this.updateControlButtons();
      this.updateProgressUI();
      showToast('Finished speaking', 'success', 2000);
    },

    updateProgressUI() {
      const total = this.queue.length;
      const current = this.currentIndex;
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      
      elements.ttsProgress.textContent = (current + 1) + ' / ' + total;
      elements.ttsProgressPercent.textContent = percent + '%';
      
      if (this.isPlaying) {
        elements.ttsStatusBadge.innerHTML = '<span class="status-dot speaking"></span><span class="status-text">Playing ' + (current + 1) + '/' + total + '</span>';
      } else if (this.isPaused) {
        elements.ttsStatusBadge.innerHTML = '<span class="status-dot ready"></span><span class="status-text">Paused</span>';
      } else {
        elements.ttsStatusBadge.innerHTML = '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
      }
    },

    updateControlButtons() {
      const hasQueue = this.queue.length > 0;
      const canPlay = hasQueue && !this.isPlaying;
      const canPause = this.isPlaying && !this.isPaused;
      const canResume = this.isPaused;
      const canStop = this.isPlaying || this.isPaused;
      const canPrev = hasQueue && this.currentIndex > 0;
      const canNext = hasQueue && this.currentIndex < this.queue.length - 1;
      
      elements.ttsPlay.disabled = !canPlay;
      elements.ttsPause.disabled = !canPause;
      elements.ttsResume.disabled = !canResume;
      elements.ttsStop.disabled = !canStop;
      elements.ttsPrev.disabled = !canPrev;
      elements.ttsNext.disabled = !canNext;
      elements.ttsRestart.disabled = !hasQueue;

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
      elements.sttStatusBadge.innerHTML = '<span class="status-dot" style="background: var(--accent-danger)"></span><span class="status-text">Unsupported</span>';
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
        elements.sttStatusBadge.innerHTML = '<span class="status-dot listening"></span><span class="status-text">Listening...</span>';
      } else {
        elements.sttStatusBadge.innerHTML = '<span class="status-dot idle"></span><span class="status-text">Idle</span>';
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
        elements.recStatusBadge.innerHTML = '<span class="status-dot" style="background: var(--accent-danger)"></span><span class="status-text">Unsupported</span>';
        elements.recStart.disabled = true;
        return;
      }
      
      if (!window.MediaRecorder) {
        state.recorder.isSupported = false;
        elements.recStatusBadge.innerHTML = '<span class="status-dot" style="background: var(--accent-danger)"></span><span class="status-text">Unsupported</span>';
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
        elements.recStatusBadge.innerHTML = '<span class="status-dot recording"></span><span class="status-text">Recording...</span>';
      } else {
        elements.recStatusBadge.innerHTML = '<span class="status-dot ready"></span><span class="status-text">Ready</span>';
      }
    }
  };

  /* ========================================
     Initialization
     ======================================== */
  async function init() {
    SpeechToText.init();
    SpeechManager.init();
    Recorder.init();
    
    updateCharCount(elements.sttText, elements.sttCharCount);
    updateCharCount(elements.ttsText, elements.ttsCharCount);
    SpeechManager.updateTextInfo();
    SpeechManager.updateControlButtons();
    
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
    
    console.log('Voice Assistant Pro initialized - Long Form TTS');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();