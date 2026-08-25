/**
 * VoiceBridge — Interactive Teacher Audio Player Demo Widget
 */

document.addEventListener('DOMContentLoaded', () => {
  const playBtn = document.getElementById('demoPlayBtn');
  const scrubberFill = document.getElementById('demoScrubberFill');
  const scrubberTrack = document.getElementById('demoScrubberTrack');
  const timeDisplay = document.getElementById('demoTimeDisplay');
  const speedPills = document.querySelectorAll('.speed-pill');

  let isPlaying = false;
  let progress = 0.35; // 35% default
  let speed = 1.0;
  let interval = null;

  function updateDisplay() {
    if (scrubberFill) scrubberFill.style.width = (progress * 100) + '%';
    const totalSecs = 48; // 00:48 total duration
    const currentSecs = Math.floor(progress * totalSecs);
    const m = Math.floor(currentSecs / 60);
    const s = currentSecs % 60;
    if (timeDisplay) {
      timeDisplay.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ' / 00:48';
    }
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.innerHTML = isPlaying
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

      if (isPlaying) {
        interval = setInterval(() => {
          progress += (0.015 * speed);
          if (progress >= 1) {
            progress = 0;
            isPlaying = false;
            clearInterval(interval);
            playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
          }
          updateDisplay();
        }, 100);
      } else {
        if (interval) clearInterval(interval);
      }
    });
  }

  if (scrubberTrack) {
    scrubberTrack.addEventListener('click', (e) => {
      const rect = scrubberTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      progress = Math.max(0, Math.min(1, clickX / rect.width));
      updateDisplay();
    });
  }

  speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      speedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      speed = parseFloat(pill.getAttribute('data-speed')) || 1.0;
    });
  });

  updateDisplay();
});
