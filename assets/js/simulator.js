/**
 * VoiceBridge — Interactive Sandbox Simulator
 * Real-time audio waveform visualizer & Google Classroom comment injection simulator
 */

class VoiceBridgeSimulator {
  constructor() {
    this.state = 'idle'; // 'idle' | 'recording' | 'review' | 'submitted'
    this.audioContext = null;
    this.analyser = null;
    this.mediaStream = null;
    this.animationId = null;
    this.timerInterval = null;
    this.seconds = 0;

    this.initElements();
    this.bindEvents();
    this.initCanvas();
  }

  initElements() {
    this.sandbox = document.getElementById('recordingSandbox');
    this.canvas = document.getElementById('waveformCanvas');
    this.placeholder = document.getElementById('waveformPlaceholder');
    this.timerEl = document.getElementById('simTimer');
    this.btnRecord = document.getElementById('btnSimRecord');
    this.btnStop = document.getElementById('btnSimStop');
    this.btnRedo = document.getElementById('btnSimRedo');
    this.btnInsert = document.getElementById('btnSimInsert');
    this.commentArea = document.getElementById('commentArea');
    this.injectedCard = document.getElementById('injectedAudioCard');
    this.injectedCardText = document.getElementById('injectedCardDuration');
  }

  bindEvents() {
    if (this.btnRecord) this.btnRecord.addEventListener('click', () => this.startRecording());
    if (this.btnStop) this.btnStop.addEventListener('click', () => this.stopRecording());
    if (this.btnRedo) this.btnRedo.addEventListener('click', () => this.resetToIdle());
    if (this.btnInsert) this.btnInsert.addEventListener('click', () => this.submitRecording());

    // Single-key accessibility shortcuts (Space to record/stop, Esc to cancel)
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (this.state === 'idle') {
          this.startRecording();
        } else if (this.state === 'recording') {
          this.stopRecording();
        }
      } else if (e.code === 'Escape') {
        if (this.state === 'recording' || this.state === 'review') {
          e.preventDefault();
          this.resetToIdle();
        }
      }
    });
  }

  initCanvas() {
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  async startRecording() {
    this.state = 'recording';
    this.seconds = 0;
    this.updateUI();
    this.startTimer();

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 128;
        source.connect(this.analyser);
        this.drawRealWaveform();
      } else {
        this.drawSimulatedWaveform();
      }
    } catch (err) {
      console.warn('Microphone access not granted or unavailable, using smooth visual simulator fallback:', err);
      this.drawSimulatedWaveform();
    }
  }

  stopRecording() {
    this.state = 'review';
    this.stopTimer();
    this.stopAudioStream();
    this.updateUI();
    this.drawStaticWaveform();
  }

  submitRecording() {
    this.state = 'submitted';
    this.updateUI();

    if (this.injectedCard) {
      this.injectedCard.style.display = 'flex';
      const formatted = this.formatDuration(this.seconds || 14);
      if (this.injectedCardText) {
        this.injectedCardText.textContent = 'Voice Note (' + formatted + ') • Saved to Student Drive';
      }
    }
  }

  resetToIdle() {
    this.state = 'idle';
    this.seconds = 0;
    this.stopTimer();
    this.stopAudioStream();
    this.updateUI();
    this.clearCanvas();
  }

  startTimer() {
    this.updateTimerDisplay();
    this.timerInterval = setInterval(() => {
      this.seconds++;
      this.updateTimerDisplay();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimerDisplay() {
    if (this.timerEl) {
      this.timerEl.textContent = this.formatDuration(this.seconds);
    }
  }

  formatDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  stopAudioStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  drawRealWaveform() {
    if (!this.analyser || !this.ctx) return;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (this.state !== 'recording') return;
      this.animationId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const barWidth = (this.canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * this.canvas.height * 0.85 + 4;
        const gradient = this.ctx.createLinearGradient(0, this.canvas.height, 0, 0);
        gradient.addColorStop(0, '#4f46e5');
        gradient.addColorStop(1, '#ec4899');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, (this.canvas.height - barHeight) / 2, barWidth - 2, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  }

  drawSimulatedWaveform() {
    if (!this.ctx) return;
    let step = 0;

    const draw = () => {
      if (this.state !== 'recording') return;
      this.animationId = requestAnimationFrame(draw);
      step += 0.12;

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const numBars = 32;
      const barWidth = this.canvas.width / numBars;

      for (let i = 0; i < numBars; i++) {
        const wave = Math.sin(step + i * 0.35) * 0.5 + 0.5;
        const barHeight = wave * (this.canvas.height * 0.72) + 6;

        this.ctx.fillStyle = '#4f46e5';
        this.ctx.fillRect(i * barWidth + 2, (this.canvas.height - barHeight) / 2, barWidth - 4, barHeight);
      }
    };
    draw();
  }

  drawStaticWaveform() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const numBars = 36;
    const barWidth = this.canvas.width / numBars;

    for (let i = 0; i < numBars; i++) {
      const heightFactor = Math.abs(Math.sin(i * 0.45));
      const barHeight = heightFactor * (this.canvas.height * 0.6) + 8;

      this.ctx.fillStyle = '#10b981';
      this.ctx.fillRect(i * barWidth + 2, (this.canvas.height - barHeight) / 2, barWidth - 4, barHeight);
    }
  }

  clearCanvas() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  updateUI() {
    if (this.placeholder) {
      this.placeholder.style.display = this.state === 'idle' ? 'flex' : 'none';
    }

    if (this.sandbox) {
      this.sandbox.className = 'recording-sandbox state-' + this.state;
    }

    if (this.btnRecord) this.btnRecord.style.display = this.state === 'idle' ? 'inline-flex' : 'none';
    if (this.btnStop) this.btnStop.style.display = this.state === 'recording' ? 'inline-flex' : 'none';
    if (this.btnRedo) this.btnRedo.style.display = this.state === 'review' ? 'inline-flex' : 'none';
    if (this.btnInsert) this.btnInsert.style.display = this.state === 'review' ? 'inline-flex' : 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.vbSimulator = new VoiceBridgeSimulator();
});
