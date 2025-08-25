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
        flutterConnDot: $('flutter-conn'),
        flutterConnLabel: $('flutter-conn-label'),
        // React
        reactFps: $('react-fps'),
        reactMem: $('react-memory'),
        reactRender: $('react-render'),
        reactConnDot: $('react-conn'),
        reactConnLabel: $('react-conn-label'),
        // Chart
        chartCanvas: $('performance-chart'),
        resultsSummary: $('results-summary')
    };

    const ORIGINS = {
        flutter: '*', // 'http://localhost:8081'
        react: '*',   // 'http://localhost:3000'
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
        config: null,
        metrics: {
            flutter: { fps: null, memoryMB: null, renderTimeMs: null },
            react: { fps: null, memoryMB: null, renderTimeMs: null }
        },
        completed: { flutter: false, react: false },
        chart: null
    };

    const frames = {
        flutter: $('flutter-frame'),
        react: $('react-frame'),
    };

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
        el.flutterFps.textContent = '--';
        el.flutterMem.textContent = '-- MB';
        el.flutterRender.textContent = '-- ms';
        el.reactFps.textContent = '--';
        el.reactMem.textContent = '-- MB';
        el.reactRender.textContent = '-- ms';
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

    function startTest() {
        const durationSec = Math.max(1, Math.min(60, Number(($('duration').value || 5))));
        const spec = {
            testType: $('test-type').value, // animation|list|computation|dom
            seed: 1337,
            particleCount: 600,
            width: 400,
            height: 400,
            move: { type: 'sinOrbit', speed: 0.1, amp: 1.0 }
        };
        const cfg = {
            iterations: Math.max(1, Number(($('iterations').value || 1000))),
            durationMs: durationSec * 1000,
            spec
        };

        state.testId = `${Date.now()}`;
        state.config = cfg;
        state.completed = { flutter: false, react: false };
        state.metrics = {
            flutter: { fps: null, memoryMB: null, renderTimeMs: null },
            react: { fps: null, memoryMB: null, renderTimeMs: null }
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
            if (parseFloat(el.progress.style.width) < p * 100) {
                el.progress.style.width = `${(p * 100).toFixed(1)}%`;
            }
        }, 100);
    }

    function onMessage(e) {
        const data = e.data || {};
        let app = data.app || PORT_TO_APP(e.origin);
        if (!app || !frames[app]) return;

        switch (data.type) {
            case 'READY': {
                state.ready[app] = true;
                setConn(app, true, 'Connected');
                break;
            }
            case 'PROGRESS': {
                if (data.testId !== state.testId) return;
                const p = Math.max(0, Math.min(1, Number(data.value || 0)));

                const otherApp = app === 'flutter' ? 'react' : 'flutter';
                const otherDone = state.completed[otherApp];
                const currentWidth = parseFloat(el.progress.style.width) || 0;
                const nextWidth = Math.max(currentWidth, (otherDone ? 1 : p) * 100 * 0.98);
                el.progress.style.width = `${nextWidth.toFixed(1)}%`;
                break;
            }
            case 'METRICS': {
                if (data.testId !== state.testId) return;
                const m = data.metrics || {};
                state.metrics[app] = {
                    fps: m.fps ?? state.metrics[app].fps,
                    memoryMB: m.memoryMB ?? state.metrics[app].memoryMB,
                    renderTimeMs: m.renderTimeMs ?? state.metrics[app].renderTimeMs
                };
                if (app === 'flutter') {
                    if (m.fps != null) el.flutterFps.textContent = m.fps.toFixed(1);
                    if (m.memoryMB != null) el.flutterMem.textContent = `${m.memoryMB.toFixed(1)} MB`;
                    if (m.renderTimeMs != null) el.flutterRender.textContent = `${Math.round(m.renderTimeMs)} ms`;
                } else {
                    if (m.fps != null) el.reactFps.textContent = m.fps.toFixed(1);
                    if (m.memoryMB != null) el.reactMem.textContent = `${m.memoryMB.toFixed(1)} MB`;
                    if (m.renderTimeMs != null) el.reactRender.textContent = `${Math.round(m.renderTimeMs)} ms`;
                }
                break;
            }
            case 'COMPLETE': {
                if (data.testId !== state.testId) return;
                state.completed[app] = true;

                if (data.metrics) {
                    const m = data.metrics;
                    state.metrics[app] = {
                        fps: m.fps ?? state.metrics[app].fps,
                        memoryMB: m.memoryMB ?? state.metrics[app].memoryMB,
                        renderTimeMs: m.renderTimeMs ?? state.metrics[app].renderTimeMs
                    };
                }

                if (state.completed.flutter && state.completed.react) {
                    finishTest();
                }
                break;
            }
            case 'ERROR': {
                console.error(`${app} error:`, data.message);
                setConn(app, false, 'Error');
                break;
            }
            default:
                break;
        }
    }

    function finishTest() {
        state.running = false;
        el.startBtn.classList.remove('running');
        refreshStartBtnState();
        el.progress.style.width = '100%';
        el.statusText.textContent = 'Completed';

        const f = state.metrics.flutter;
        const r = state.metrics.react;

        // Chart
        const chartData = {
            labels: ['FPS (↑)', 'Memory MB (↓)', 'Render ms (↓)'],
            datasets: [
                { label: 'Flutter', data: [f.fps || 0, f.memoryMB || 0, f.renderTimeMs || 0], backgroundColor: 'rgba(2,86,155,0.5)' },
                { label: 'React', data: [r.fps || 0, r.memoryMB || 0, r.renderTimeMs || 0], backgroundColor: 'rgba(97,218,251,0.5)' }
            ]
        };

        if (!state.chart) {
            state.chart = new Chart(el.chartCanvas, {
                type: 'bar',
                data: chartData,
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        } else {
            state.chart.data = chartData;
            state.chart.update();
        }

        // Summary
        const winnerFps = (f.fps || 0) > (r.fps || 0) ? 'Flutter' : 'React';
        const winnerMem = (f.memoryMB || Infinity) < (r.memoryMB || Infinity) ? 'Flutter' : 'React';
        const winnerRender = (f.renderTimeMs || Infinity) < (r.renderTimeMs || Infinity) ? 'Flutter' : 'React';

        el.resultsSummary.innerHTML = `
      <div><b>FPS:</b> Flutter ${f.fps?.toFixed(1) ?? '--'} vs React ${r.fps?.toFixed(1) ?? '--'} — Winner: ${winnerFps}</div>
      <div><b>Memory:</b> Flutter ${f.memoryMB?.toFixed(1) ?? '--'} MB vs React ${r.memoryMB?.toFixed(1) ?? '--'} MB — Winner: ${winnerMem}</div>
      <div><b>Render Time:</b> Flutter ${Math.round(f.renderTimeMs || 0)} ms vs React ${Math.round(r.renderTimeMs || 0)} ms — Winner: ${winnerRender}</div>
      <div class="winner">Overall: ${scoreOverall(f, r)}</div>
    `;
        el.resultsSummary.classList.add('show');
    }

    function scoreOverall(f, r) {
        let scoreF = 0, scoreR = 0;
        if ((f.fps || 0) > (r.fps || 0)) scoreF++; else if ((r.fps || 0) > (f.fps || 0)) scoreR++;
        if ((f.memoryMB || Infinity) < (r.memoryMB || Infinity)) scoreF++; else if ((r.memoryMB || Infinity) < (f.memoryMB || Infinity)) scoreR++;
        if ((f.renderTimeMs || Infinity) < (r.renderTimeMs || Infinity)) scoreF++; else if ((r.renderTimeMs || Infinity) < (f.renderTimeMs || Infinity)) scoreR++;
        if (scoreF === scoreR) return 'Tie';
        return scoreF > scoreR ? 'Flutter' : 'React';
    }

    function init() {
        window.addEventListener('message', onMessage);
        el.startBtn.addEventListener('click', startTest);

        const hello = { type: 'PING' };
        frames.flutter.addEventListener('load', () => postTo('flutter', hello));
        frames.react.addEventListener('load', () => postTo('react', hello));

        refreshStartBtnState();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
