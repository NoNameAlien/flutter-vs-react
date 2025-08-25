import { useEffect, useRef } from 'react';
import mulberry32 from './components/mulberry32';

const COLOR = '#607d8b';

function App() {
  const canvasRef = useRef(null);
  const reqRef = useRef(null);
  const startMsRef = useRef(0);
  const framesRef = useRef(0);
  const runningRef = useRef(false);
  const durationMsRef = useRef(5000);
  const testIdRef = useRef('');

  const rngRef = useRef(null);
  const particlesRef = useRef([]);
  const frameTsRef = useRef([]);      // timestamps per frame
  const longTasks = useRef({ count: 0, totalMs: 0 });
  const drawRadiusRef = useRef(2);

  useEffect(() => {
    const po = ('PerformanceObserver' in window)
      ? new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks.current.count += 1;
          longTasks.current.totalMs += e.duration;
        }
      })
      : null;
    try { po?.observe({ entryTypes: ['longtask'] }); } catch { }

    function send(msg) {
      if (window.parent) window.parent.postMessage({ app: 'react', ...msg }, '*');
    }

    function startTest(testId, payload) {
      if (runningRef.current) return;
      runningRef.current = true;
      testIdRef.current = testId;

      const spec = payload?.spec || {};
      const { seed = 1337, particleCount = 600, width = 400, height = 400, move = {}, radius = 2, cpuLoops = 0 } = spec;
      const speed = move.speed ?? 0.001;
      const amp = move.amp ?? 0.45;
      const phaseStep = move.phaseStep ?? 0.015;

      durationMsRef.current = (payload?.durationMs) || 5000;
      framesRef.current = 0;
      frameTsRef.current = [];
      longTasks.current = { count: 0, totalMs: 0 };
      startMsRef.current = performance.now();
      drawRadiusRef.current = radius;

      // prepare workload (devicePixelRatio-aware)
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      rngRef.current = mulberry32(seed);
      particlesRef.current = Array.from({ length: particleCount }, () => ({
        x0: rngRef.current() * width,
        y0: rngRef.current() * height,
      }));

      function animate() {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const w = width, h = height;
        const t = performance.now() - startMsRef.current;
        const R = Math.min(w, h) * amp;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = COLOR;
        for (let i = 0; i < particlesRef.current.length; i++) {
          const p = particlesRef.current[i];
          const a = t * speed + i * phaseStep;
          let x = p.x0 + Math.cos(a) * R;
          let y = p.y0 + Math.sin(a) * R;

          let acc = 0;
          for (let k = 0; k < cpuLoops; k++) {
            acc += Math.sin(x * 0.001 + k) * Math.cos(y * 0.001 + k) * 0.5;
          }
          x += acc * 0.1;
          y += acc * 0.1;

          ctx.beginPath(); ctx.arc(x, y, drawRadiusRef.current, 0, Math.PI * 2); ctx.fill();
        }

        framesRef.current++;
        const now = performance.now();
        frameTsRef.current.push(now);
        if (frameTsRef.current.length > 2000) frameTsRef.current.splice(0, frameTsRef.current.length - 1000);
        reqRef.current = requestAnimationFrame(animate);
      }

      function collectMetrics(elapsedMs) {
        const ts = frameTsRef.current;
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, b) => a - b);
        const p95 = d.length ? d[Math.max(0, Math.floor(d.length * 0.95) - 1)] : 0;
        const over16 = d.length ? d.filter(v => v > 16.7).length / d.length : 0;

        let memMb;
        if (performance && performance.memory) memMb = performance.memory.usedJSHeapSize / (1024 * 1024);
        const fps = (framesRef.current * 1000) / Math.max(1, elapsedMs);
        return {
          fps, memoryMB: memMb, renderTimeMs: elapsedMs,
          frameMsP95: p95, framesOver16p: over16,
          longTasks: longTasks.current.count, longTasksTotalMs: longTasks.current.totalMs,
        };
      }

      function finish() {
        if (reqRef.current) cancelAnimationFrame(reqRef.current);
        const elapsed = performance.now() - startMsRef.current;
        const metrics = collectMetrics(elapsed);
        runningRef.current = false;
        send({ type: 'COMPLETE', testId: testIdRef.current, metrics });
      }

      // start
      animate();
      const interval = setInterval(() => {
        if (!runningRef.current) { clearInterval(interval); return; }
        const elapsed = performance.now() - startMsRef.current;
        const p = Math.min(1, elapsed / durationMsRef.current);
        send({ type: 'PROGRESS', testId: testIdRef.current, value: p });
        send({ type: 'METRICS', testId: testIdRef.current, metrics: collectMetrics(elapsed) });
        if (p >= 1) { clearInterval(interval); finish(); }
      }, 100);
    }

    function onMessage(e) {
      const data = e.data || {};
      if (data.type === 'PING') send({ type: 'READY' });
      else if (data.type === 'START_TEST') startTest(data.testId, data.payload);
    }

    function send(m) { if (window.parent) window.parent.postMessage({ app: 'react', ...m }, '*'); }

    window.addEventListener('message', onMessage);
    send({ type: 'READY' });

    return () => {
      window.removeEventListener('message', onMessage);
      po?.disconnect?.();
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background: '#fff',
      overflow: 'hidden'
    }}>
      <canvas ref={canvasRef} width={400} height={400}
        style={{ border: '1px solid #eee', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }} />
    </div>
  );
}

export default App;