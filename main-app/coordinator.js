(() => {
    const $ = (id) => document.getElementById(id);

    const el = {
        startBtn: $('start-btn'),
        statusText: $('status-text'),
        progress: $('progress'),
        // Flutter
        flutterFps: $('flutter-fps'),
        flutterMem: $('flutter-memory'),
        flutterRender: $('flutter-render'),
        flutterP95: $('flutter-p95'),
        flutterOver16: $('flutter-over16'),
        flutterLT: $('flutter-longtasks'),
        flutterConnDot: $('flutter-conn'),
        flutterConnLabel: $('flutter-conn-label'),
        // React
        reactFps: $('react-fps'),
        reactMem: $('react-memory'),
        reactRender: $('react-render'),
        reactP95: $('react-p95'),
        reactOver16: $('react-over16'),
        reactLT: $('react-longtasks'),
        reactConnDot: $('react-conn'),
        reactConnLabel: $('react-conn-label'),
        // Chart/Summary
        chartCanvas: $('performance-chart'),
        resultsSummary: $('results-summary'),
    };

    const ORIGINS = {
        flutter: 'http://localhost:8081',
        react: 'http://localhost:3000',
    };

    const PORT_TO_APP = (origin) => {
        try {
            const url = new URL(origin);
            if (url.port === '8081') return 'flutter';
            if (url.port === '3000') return 'react';
        } catch { }
        return null;
    };

    const state = {
        ready: { flutter: false, react: false },
        running: false,
        testId: null,
        metrics: {
            flutter: { fps: null, memoryMB: null, renderTimeMs: null, frameMsP95: null, framesOver16p: null, longTasks: null, longTasksTotalMs: null },
            react: { fps: null, memoryMB: null, renderTimeMs: null, frameMsP95: null, framesOver16p: null, longTasks: null, longTasksTotalMs: null },
        },
        completed: { flutter: false, react: false },
        chart: null,
        handshakeTimer: null,
    };

    const frames = { flutter: $('flutter-frame'), react: $('react-frame') };

    function log(...args) {
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            console.log('[coordinator]', ...args);
        }
    }

    function setConn(app, ok, msg = '') {
        const dot = app === 'flutter' ? el.flutterConnDot : el.reactConnDot;
        const label = app === 'flutter' ? el.flutterConnLabel : el.reactConnLabel;
        dot.classList.remove('error', 'online');
        if (ok === true) dot.classList.add('online');
        if (ok === false) dot.classList.add('error');
        label.textContent = msg || (ok ? 'Connected' : 'Waiting...');
        refreshStartBtnState();
    }

    function refreshStartBtnState() {
        const canStart = state.ready.flutter && state.ready.react && !state.running;
        el.startBtn.disabled = !canStart;
        el.statusText.textContent = canStart ? 'Ready to start' : (state.running ? 'Running...' : 'Waiting apps...');
    }

    function resetUI() {
        const clear = (e, v) => (e.textContent = v);
        clear(el.flutterFps, '--'); clear(el.flutterMem, '-- MB'); clear(el.flutterRender, '-- ms');
        clear(el.reactFps, '--'); clear(el.reactMem, '-- MB'); clear(el.reactRender, '-- ms');
        clear(el.flutterP95, '--'); clear(el.reactP95, '--');
        clear(el.flutterOver16, '--%'); clear(el.reactOver16, '--%');
        clear(el.flutterLT, '--'); clear(el.reactLT, '--');
        el.progress.style.width = '0%';
        el.resultsSummary.classList.remove('show');
        el.resultsSummary.innerHTML = '';
    }

    function postTo(app, payload) {
        try {
            frames[app].contentWindow.postMessage(payload, ORIGINS[app]);
        } catch (e) {
            console.warn('postMessage failed', app, e);
        }
    }

    function startHandshakeWatchdog() {
        stopHandshakeWatchdog();
        const hello = { type: 'PING' };
        state.handshakeTimer = setInterval(() => {
            if (state.ready.flutter && state.ready.react) {
                stopHandshakeWatchdog(); return;
            }
            if (!state.ready.flutter) postTo('flutter', hello);
            if (!state.ready.react) postTo('react', hello);
        }, 1000);
    }
    function stopHandshakeWatchdog() {
        if (state.handshakeTimer) {
            clearInterval(state.handshakeTimer);
            state.handshakeTimer = null;
        }
    }

    function readSpecFromUI() {
        const num = (id, def, min = -Infinity, max = Infinity) => {
            const v = Number($(id).value ?? def);
            return isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
        };
        return {
            testType: $('test-type').value,
            seed: num('seed', 1337),
            particleCount: num('particleCount', 600, 1, 20000),
            width: num('width', 400, 50, 4000),
            height: num('height', 400, 50, 4000),
            move: {
                type: 'sinOrbit',
                speed: num('speed', 0.001, 0.00005, 0.01),
                amp: num('amp', 0.45, 0.01, 1),
                phaseStep: num('phaseStep', 0.015, 0, 2),
            },
            radius: num('radius', 2, 1, 20),
            cpuLoops: num('cpuLoops', 0, 0, 2000),
        };
    }

    function startTest() {
        const durationSec = Math.max(1, Math.min(60, Number(($('duration').value || 5))));
        const spec = readSpecFromUI();
        const cfg = { durationMs: durationSec * 1000, spec };

        state.testId = `${Date.now()}`;
        state.completed = { flutter: false, react: false };
        state.metrics = {
            flutter: { fps: null, memoryMB: null, renderTimeMs: null, frameMsP95: null, framesOver16p: null, longTasks: null, longTasksTotalMs: null },
            react: { fps: null, memoryMB: null, renderTimeMs: null, frameMsP95: null, framesOver16p: null, longTasks: null, longTasksTotalMs: null },
        };

        resetUI();
        state.running = true;
        el.startBtn.classList.add('running');
        el.startBtn.disabled = true;
        el.statusText.textContent = 'Running...';

        const startPayload = { type: 'START_TEST', testId: state.testId, payload: cfg };
        postTo('flutter', startPayload);
        postTo('react', startPayload);

        const startedAt = performance.now();
        const timer = setInterval(() => {
            if (!state.running) { clearInterval(timer); return; }
            const t = performance.now() - startedAt;
            const p = Math.min(0.95, t / cfg.durationMs);
            const current = parseFloat(el.progress.style.width) || 0;
            if (current < p * 100) el.progress.style.width = `${(p * 100).toFixed(1)}%`;
        }, 100);
    }

    function onMessage(e) {
        const data = e.data || {};
        const app = data.app || PORT_TO_APP(e.origin);
        if (!app || !frames[app]) return;

        if (app === 'flutter' && e.origin !== ORIGINS.flutter) return;
        if (app === 'react' && e.origin !== ORIGINS.react) return;

        log('msg from', app, e.origin, data.type);

        switch (data.type) {
            case 'READY':
                state.ready[app] = true;
                setConn(app, true, 'Connected');
                refreshStartBtnState();
                if (state.ready.flutter && state.ready.react) stopHandshakeWatchdog();
                break;

            case 'PROGRESS':
                if (data.testId !== state.testId) return;
                const p = Math.max(0, Math.min(1, Number(data.value || 0)));
                const other = app === 'flutter' ? 'react' : 'flutter';
                const otherDone = state.completed[other];
                const current = parseFloat(el.progress.style.width) || 0;
                const next = Math.max(current, (otherDone ? 1 : p) * 100 * 0.98);
                el.progress.style.width = `${next.toFixed(1)}%`;
                break;

            case 'METRICS':
                if (data.testId !== state.testId) return;
                applyMetrics(app, data.metrics || {});
                break;

            case 'COMPLETE':
                if (data.testId !== state.testId) return;
                state.completed[app] = true;
                if (data.metrics) applyMetrics(app, data.metrics);
                if (state.completed.flutter && state.completed.react) finishTest();
                break;

            case 'ERROR':
                console.error(`${app} error:`, data.message);
                setConn(app, false, 'Error');
                break;
        }
    }

    function applyMetrics(app, m) {
        const target = state.metrics[app];
        Object.assign(target, m);
        const setSide = (prefix, mm) => {
            if (mm.fps != null) $(prefix + 'fps').textContent = mm.fps.toFixed(1);
            if (mm.memoryMB != null) $(prefix + 'memory').textContent = `${mm.memoryMB.toFixed(1)} MB`;
            if (mm.renderTimeMs != null) $(prefix + 'render').textContent = `${Math.round(mm.renderTimeMs)} ms`;
            if (mm.frameMsP95 != null) $(prefix + 'p95').textContent = mm.frameMsP95.toFixed(2);
            if (mm.framesOver16p != null) $(prefix + 'over16').textContent = `${(mm.framesOver16p * 100).toFixed(1)}%`;
            if (mm.longTasks != null) $(prefix + 'longtasks').textContent =
                `${mm.longTasks}${mm.longTasksTotalMs != null ? ` (${mm.longTasksTotalMs.toFixed(1)}ms)` : ''}`;
        };
        if (app === 'flutter') setSide('flutter-', target); else setSide('react-', target);
    }

    function finishTest() {
        state.running = false;
        el.startBtn.classList.remove('running');
        refreshStartBtnState();
        el.progress.style.width = '100%';
        el.statusText.textContent = 'Completed';

        const f = state.metrics.flutter, r = state.metrics.react;
        const chartData = {
            labels: ['FPS (↑)', 'Memory MB (↓)', 'p95 ms (↓)'],
            datasets: [
                { label: 'Flutter', data: [f.fps || 0, f.memoryMB || 0, f.frameMsP95 || 0], backgroundColor: 'rgba(2,86,155,0.5)' },
                { label: 'React', data: [r.fps || 0, r.memoryMB || 0, r.frameMsP95 || 0], backgroundColor: 'rgba(97,218,251,0.5)' },
            ],
        };
        if (!state.chart) {
            state.chart = new Chart(el.chartCanvas, { type: 'bar', data: chartData, options: { responsive: true, scales: { y: { beginAtZero: true } } } });
        } else {
            state.chart.data = chartData; state.chart.update();
        }

        const EPS = 0.03;
        const rel = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.max(a, b));
        const maxW = (a, b) => rel(a, b) <= EPS ? 'Tie' : (a > b ? 'Flutter' : 'React');
        const minW = (a, b) => rel(a, b) <= EPS ? 'Tie' : (a < b ? 'Flutter' : 'React');
        const fmt = (x) => (typeof x === 'number' && isFinite(x)) ? (Math.abs(x) > 100 ? Math.round(x) : x.toFixed(1)) : '--';

        const winnerFps = (f.fps != null && r.fps != null) ? maxW(f.fps, r.fps) : '—';
        const winnerMem = (f.memoryMB != null && r.memoryMB != null) ? minW(f.memoryMB, r.memoryMB) : '—';
        const winnerP95 = (f.frameMsP95 != null && r.frameMsP95 != null) ? minW(f.frameMsP95, r.frameMsP95) : '—';

        el.resultsSummary.innerHTML = `
      <div><b>FPS:</b> Flutter ${fmt(f.fps)} vs React ${fmt(r.fps)} — Winner: ${winnerFps}</div>
      <div><b>Memory:</b> Flutter ${fmt(f.memoryMB)} MB vs React ${fmt(r.memoryMB)} MB — Winner: ${winnerMem}</div>
      <div><b>p95 frame:</b> Flutter ${fmt(f.frameMsP95)} ms vs React ${fmt(r.frameMsP95)} ms — Winner: ${winnerP95}</div>
    `;
        el.resultsSummary.classList.add('show');
    }

    function init() {
        window.addEventListener('message', onMessage);
        el.startBtn.addEventListener('click', startTest);

        frames.flutter.addEventListener('load', () => postTo('flutter', { type: 'PING' }));
        frames.react.addEventListener('load', () => postTo('react', { type: 'PING' }));
        startHandshakeWatchdog();

        refreshStartBtnState();
    }

    document.addEventListener('DOMContentLoaded', init);
})();