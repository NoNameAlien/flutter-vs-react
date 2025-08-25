import { useEffect, useRef, useState } from 'react';

function App() {
  const canvasRef = useRef(null);
  const reqRef = useRef();
  const startMsRef = useRef(0);
  const framesRef = useRef(0);
  const runningRef = useRef(false);
  const durationMsRef = useRef(5000);
  const testIdRef = useRef('');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function send(msg) {
      if (window.parent) window.parent.postMessage({ app: 'react', ...msg }, '*');
    }

    function onMessage(e) {
      const data = e.data || {};
      if (data.type === 'PING') {
        setConnected(true);
        send({ type: 'READY' });
      }
      if (data.type === 'START_TEST') {
        startTest(data.testId, data.payload);
      }
    }

    window.addEventListener('message', onMessage);
    send({ type: 'READY' });

    return () => window.removeEventListener('message', onMessage);

    function startTest(testId, payload) {
      if (runningRef.current) return;
      runningRef.current = true;
      testIdRef.current = testId;
      durationMsRef.current = (payload?.durationMs) || 5000;
      framesRef.current = 0;
      startMsRef.current = performance.now();
      animate();
      const interval = setInterval(() => {
        if (!runningRef.current) { clearInterval(interval); return; }
        const elapsed = performance.now() - startMsRef.current;
        const p = Math.min(1, elapsed / durationMsRef.current);
        send({ type: 'PROGRESS', testId: testIdRef.current, value: p });
        send({ type: 'METRICS', testId: testIdRef.current, metrics: collectMetrics(elapsed) });
        if (p >= 1) {
          clearInterval(interval);
          finish();
        }
      }, 100);

      function animate() {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const { width, height } = canvasRef.current;
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < 800; i++) {
          ctx.fillStyle = i % 2 ? '#61DAFB' : '#333';
          const t = performance.now() / 10 + i;
          const x = (Math.sin(t) + 1) * 0.5 * width;
          const y = (Math.cos(t) + 1) * 0.5 * height;
          ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        }
        framesRef.current++;
        reqRef.current = requestAnimationFrame(animate);
      }

      function finish() {
        if (reqRef.current) cancelAnimationFrame(reqRef.current);
        const elapsed = performance.now() - startMsRef.current;
        const metrics = collectMetrics(elapsed);
        runningRef.current = false;
        send({ type: 'COMPLETE', testId: testIdRef.current, metrics });
      }

      function collectMetrics(elapsedMs) {
        let memMb;
        const anyPerf = performance;
        if (anyPerf && anyPerf.memory) {
          memMb = anyPerf.memory.usedJSHeapSize / (1024 * 1024);
        }
        const fps = (framesRef.current * 1000) / Math.max(1, elapsedMs);
        return { fps, memoryMB: memMb, renderTimeMs: elapsedMs };
      }
    }
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', background: '#fff' }}>
      <canvas ref={canvasRef} width={400} height={400} style={{ border: '1px solid #eee', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }} />
    </div>
  );
}

export default App;