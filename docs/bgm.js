// 像素风背景音乐：用 Web Audio API 程序合成一段轻快循环的 8-bit 旋律，
// 无需外部音频文件、不产生额外下载体积，避免版权问题。
// 由用户点击音乐按钮手动开启（浏览器自动播放策略要求用户手势），默认静音。
(() => {
  const btn = document.getElementById('bgm-toggle');
  if (!btn) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let audioCtx = null;
  let master = null;
  let playing = false;
  let schedulerId = 0;

  // 主旋律（音名 → 频率），活泼的 8-bit 循环，约 4 秒一个小节。
  const MELODY = [
    'C5', 'E5', 'G5', 'E5', 'C6', 'G5', 'E5', 'C5',
    'D5', 'F5', 'A5', 'F5', 'D6', 'A5', 'F5', 'D5',
    'E5', 'G5', 'B5', 'G5', 'E6', 'B5', 'G5', 'E5',
    'F5', 'A5', 'C6', 'A5', 'F6', 'C6', 'A5', 'G5',
  ];
  // 低音伴奏（每小节两个根音，方波，营造 8-bit 底子）。
  const BASS = ['C3', 'G3', 'D3', 'A3', 'E3', 'B3', 'F3', 'C3'];

  const NOTE_FREQ = (() => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const map = {};
    names.forEach((n, i) => {
      // 以 A4 = 440Hz 为基准，覆盖 C3 ~ C7。
      for (let oct = 2; oct <= 7; oct++) {
        const midi = (oct + 1) * 12 + i; // C4 = 60
        map[`${n}${oct}`] = 440 * Math.pow(2, (midi - 69) / 12);
      }
    });
    return map;
  })();

  const STEP = 0.14;   // 每步时长（秒），约 160 BPM 的十六分音符
  const BPM_STEP = 4;  // 低音每 4 步换一个根音

  function ensureContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.gain.value = 0.5;
      master.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // 播放一个音符：主旋律用三角波（柔和），低音用方波（有 8-bit 冲击感）。
  function playNote(freq, when, duration, type, volume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.03);
  }

  // 循环调度器：用前瞻式调度保证节奏稳定，无 setInterval 漂移。
  function scheduleLoop() {
    const lookahead = 0.3;
    let nextStep = 0;
    let nextNoteTime = audioCtx.currentTime + 0.05;

    function tick() {
      while (nextNoteTime < audioCtx.currentTime + lookahead) {
        const step = nextStep % MELODY.length;
        const melFreq = NOTE_FREQ[MELODY[step]];
        if (melFreq) playNote(melFreq, nextNoteTime, STEP * 0.9, 'triangle', 0.55);

        // 低音：每 BPM_STEP 步触发一次，落在小节首拍。
        if (nextStep % BPM_STEP === 0) {
          const bassIdx = Math.floor(nextStep / BPM_STEP) % BASS.length;
          const bassFreq = NOTE_FREQ[BASS[bassIdx]];
          if (bassFreq) playNote(bassFreq, nextNoteTime, STEP * 3.6, 'square', 0.22);
        }

        nextNoteTime += STEP;
        nextStep += 1;
      }
      schedulerId = requestAnimationFrame(tick);
    }
    schedulerId = requestAnimationFrame(tick);
  }

  function start() {
    const ctx = ensureContext();
    if (!ctx || playing) return;
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    btn.classList.add('playing');
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', '暂停背景音乐');
    scheduleLoop();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if (schedulerId) cancelAnimationFrame(schedulerId);
    schedulerId = 0;
    btn.classList.remove('playing');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '播放背景音乐');
  }

  btn.addEventListener('click', () => {
    if (playing) stop();
    else start();
  });

  // 页面隐藏时暂停，避免后台继续发声；reduced-motion 时也停止（尊重偏好）。
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  reduceMotion.addEventListener?.('change', () => { if (reduceMotion.matches) stop(); });
})();
