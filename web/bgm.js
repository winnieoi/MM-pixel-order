// 像素风背景音乐：用 Web Audio API 程序合成一段轻柔、缓慢、空灵的环境氛围循环，
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

  // 主旋律：稀疏、平稳、留白多的慢板，音程小步级进，营造安静放松感。
  const MELODY = [
    'C5', null, 'E5', null, 'G5', null, 'E5', null,
    'A5', null, 'G5', null, 'E5', null, 'D5', null,
    'F5', null, 'A5', null, 'C6', null, 'A5', null,
    'G5', null, 'E5', null, 'C5', null, null, null,
  ];
  // 低音：每小节一个很轻的根音，长音铺底，几乎不可察觉但撑住和声。
  const BASS = ['C3', 'A2', 'F2', 'G2'];

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

  const STEP = 0.4;    // 每步时长（秒），非常慢，约 37 BPM
  const BASS_STEP = 8; // 低音每 8 步换一个根音

  function ensureContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.gain.value = 0.4;
      master.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  // 轻柔的纯正弦波单音：慢速淡入淡出，去掉高频泛音，避免任何「叮」的脆响，听起来像远处飘来的琴声。
  function playSoftNote(freq, when, duration, volume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.15);   // 慢速淡入
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration); // 慢速淡出
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.1);
  }

  // 低音：极轻的长音，几乎不可察觉，只用来铺底。
  function playBass(freq, when, duration, volume) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.1);
  }

  // 循环调度器：用前瞻式调度保证节奏稳定，无 setInterval 漂移。
  function scheduleLoop() {
    const lookahead = 0.6;
    let nextStep = 0;
    let nextNoteTime = audioCtx.currentTime + 0.05;

    function tick() {
      while (nextNoteTime < audioCtx.currentTime + lookahead) {
        const step = nextStep % MELODY.length;
        const melFreq = NOTE_FREQ[MELODY[step]];
        // null 表示休止，制造大量留白，让音乐「呼吸」。
        if (melFreq) playSoftNote(melFreq, nextNoteTime, STEP * 2.4, 0.42);

        // 低音：每 BASS_STEP 步触发一次，落在每个和弦的开头。
        if (nextStep % BASS_STEP === 0) {
          const bassIdx = Math.floor(nextStep / BASS_STEP) % BASS.length;
          const bassFreq = NOTE_FREQ[BASS[bassIdx]];
          if (bassFreq) playBass(bassFreq, nextNoteTime, STEP * 7.5, 0.16);
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
