// 像素风背景音乐：用 Web Audio API 程序合成一段舒缓的「八音盒华尔兹」循环，
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

  // 主旋律（音名 → 频率），舒缓的 3/4 拍大调琶音，营造温暖下午茶氛围。
  const MELODY = [
    'E5', 'G5', 'C6', 'G5', 'A5', 'G5', 'E5', 'D5',
    'F5', 'A5', 'D6', 'A5', 'B5', 'A5', 'F5', 'E5',
    'C5', 'E5', 'G5', 'E5', 'A5', 'C6', 'E6', 'D6',
    'B5', 'G5', 'D6', 'G5', 'E5', 'D5', 'C5', 'D5',
  ];
  // 低音伴奏（每个和弦一个根音，八度较低，用柔和的正弦波衬托）。
  const BASS = ['C3', 'A2', 'F2', 'G2', 'C3', 'A2', 'D3', 'G3'];

  const NOTE_FREQ = (() => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const map = {};
    names.forEach((n, i) => {
      // 以 A4 = 440Hz 为基准，覆盖 C2 ~ C7。
      for (let oct = 2; oct <= 7; oct++) {
        const midi = (oct + 1) * 12 + i; // C4 = 60
        map[`${n}${oct}`] = 440 * Math.pow(2, (midi - 69) / 12);
      }
    });
    return map;
  })();

  const STEP = 0.22;   // 每步时长（秒），较慢的八分音符，营造舒缓感
  const BASS_STEP = 8; // 低音每 8 步（一个小节）换一个和弦根音

  function ensureContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.gain.value = 0.42;
      master.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // 八音盒音色：正弦波基音 + 一个柔和的高频泛音，配较长的衰减包络，模拟音乐盒的清脆回响。
  function playMusicBox(freq, when, duration, volume) {
    // 基音（正弦波，清脆）
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);

    // 高频泛音（低音量，增加「叮」的清脆感）
    const overtone = audioCtx.createOscillator();
    const ogain = audioCtx.createGain();
    overtone.type = 'sine';
    overtone.frequency.value = freq * 2;
    ogain.gain.setValueAtTime(0.0001, when);
    ogain.gain.exponentialRampToValueAtTime(volume * 0.18, when + 0.008);
    ogain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.5);
    overtone.connect(ogain);
    ogain.connect(master);
    overtone.start(when);
    overtone.stop(when + duration * 0.5 + 0.03);
  }

  // 低音：柔和的正弦波，慢速淡入淡出，衬托和声。
  function playBass(freq, when, duration, volume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  // 循环调度器：用前瞻式调度保证节奏稳定，无 setInterval 漂移。
  function scheduleLoop() {
    const lookahead = 0.35;
    let nextStep = 0;
    let nextNoteTime = audioCtx.currentTime + 0.05;

    function tick() {
      while (nextNoteTime < audioCtx.currentTime + lookahead) {
        const step = nextStep % MELODY.length;
        const melFreq = NOTE_FREQ[MELODY[step]];
        if (melFreq) playMusicBox(melFreq, nextNoteTime, STEP * 1.4, 0.5);

        // 低音：每 BASS_STEP 步触发一次，落在每个和弦的开头。
        if (nextStep % BASS_STEP === 0) {
          const bassIdx = Math.floor(nextStep / BASS_STEP) % BASS.length;
          const bassFreq = NOTE_FREQ[BASS[bassIdx]];
          if (bassFreq) playBass(bassFreq, nextNoteTime, STEP * 7.2, 0.28);
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
