// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:async';
import 'dart:math';
import 'dart:html' as html;
import 'dart:js_util' as jsu;
import 'package:flutter/material.dart';
import 'widgets/mulberry32.dart';

const _color = Color(0xFF607D8B);

void main() => runApp(const PerfApp());

class PerfApp extends StatefulWidget {
  const PerfApp({super.key});
  @override
  State<PerfApp> createState() => _PerfAppState();
}

class _PerfAppState extends State<PerfApp> with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  // Spec
  int _w = 400, _h = 400, _particleCount = 600, _seed = 1337, _cpuLoops = 0;
  double _speed = 0.001, _amp = 0.45, _phaseStep = 0.015, _radius = 2;

  List<Offset> _base = [];
  bool running = false;
  String currentTestId = '';
  Timer? _progressTimer;
  int frames = 0;
  late double startMs; // perf.now()
  int durationMs = 5000;

  final List<double> _ts = []; // frame timestamps (perf.now)
  int _longTasks = 0;
  double _longTasksTotalMs = 0;
  dynamic _po; // PerformanceObserver

  @override
  void initState() {
    super.initState();
    _controller =
        AnimationController(vsync: this, duration: const Duration(hours: 1))
          ..addListener(() {
            frames++;
            _ts.add(html.window.performance.now());
            if (_ts.length > 2000) _ts.removeRange(0, _ts.length - 1000);
            setState(() {});
          });

    // Messages
    html.window.onMessage.listen((event) {
      final data = jsu.dartify(event.data);
      if (data is! Map) return;
      if (data['type'] == 'PING') {
        _send({'type': 'READY', 'app': 'flutter'});
      } else if (data['type'] == 'START_TEST') {
        _startTest(data['testId'] as String, (data['payload'] as Map));
      }
    });

    _setupLongTasksObserver();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _send({'type': 'READY', 'app': 'flutter'});
    });
  }

  void _setupLongTasksObserver() {
    try {
      final perfObsCtor = jsu.getProperty(html.window, 'PerformanceObserver');
      if (perfObsCtor == null) return;
      _po = jsu.callConstructor(perfObsCtor, [
        jsu.allowInterop((entryList, _) {
          final entries = jsu.callMethod(entryList, 'getEntries', []);
          if (entries is List) {
            for (final e in entries) {
              final dur = jsu.getProperty(e, 'duration');
              if (dur is num) {
                _longTasks++;
                _longTasksTotalMs += dur.toDouble();
              }
            }
          }
        })
      ]);
      jsu.callMethod(_po, 'observe', [
        jsu.jsify({
          'entryTypes': ['longtask']
        })
      ]);
    } catch (_) {}
  }

  void _prepareFromSpec(Map spec) {
    _w = (spec['width'] as num?)?.toInt() ?? 400;
    _h = (spec['height'] as num?)?.toInt() ?? 400;
    _seed = (spec['seed'] as num?)?.toInt() ?? 1337;
    _particleCount = (spec['particleCount'] as num?)?.toInt() ?? 600;
    _radius = (spec['radius'] as num?)?.toDouble() ?? 2;
    _cpuLoops = (spec['cpuLoops'] as num?)?.toInt() ?? 0;
    final move = (spec['move'] as Map?) ?? {};
    _speed = (move['speed'] as num?)?.toDouble() ?? 0.001;
    _amp = (move['amp'] as num?)?.toDouble() ?? 0.45;
    _phaseStep = (move['phaseStep'] as num?)?.toDouble() ?? 0.015;

    final rng = Mulberry32(_seed);
    _base = List.generate(_particleCount,
        (_) => Offset(rng.nextDouble() * _w, rng.nextDouble() * _h));
  }

  void _startTest(String testId, Map payload) {
    if (running) return;
    running = true;
    currentTestId = testId;

    final spec = (payload['spec'] as Map?) ?? {};
    _prepareFromSpec(spec);

    durationMs = (payload['durationMs'] as num?)?.toInt() ?? 5000;
    frames = 0;
    _ts.clear();
    _longTasks = 0;
    _longTasksTotalMs = 0;
    startMs = html.window.performance.now();
    _controller.repeat();

    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(milliseconds: 100), (t) {
      final elapsed = html.window.performance.now() - startMs;
      final p = (elapsed / durationMs).clamp(0, 1);
      _send({
        'type': 'PROGRESS',
        'app': 'flutter',
        'testId': currentTestId,
        'value': p
      });
      _send({
        'type': 'METRICS',
        'app': 'flutter',
        'testId': currentTestId,
        'metrics': _metrics(elapsed)
      });
      if (p >= 1) {
        t.cancel();
        _finish();
      }
    });
  }

  Map<String, dynamic> _metrics(double elapsedMs) {
    final d = <double>[];
    for (var i = 1; i < _ts.length; i++) {
      d.add(_ts[i] - _ts[i - 1]);
    }
    d.sort();
    final p95 = d.isNotEmpty
        ? d[(d.length * 0.95).floor().clamp(0, d.length - 1)]
        : 0.0;
    final over16 =
        d.isNotEmpty ? d.where((v) => v > 16.7).length / d.length : 0.0;

    double? memMb;
    try {
      final perf = html.window.performance as dynamic;
      if (perf?.memory != null) {
        memMb = (perf.memory.usedJSHeapSize as num) / (1024 * 1024);
      }
    } catch (_) {}

    final fps = frames * 1000 / max(1.0, elapsedMs);
    return {
      'fps': fps,
      'memoryMB': memMb,
      'renderTimeMs': elapsedMs,
      'frameMsP95': p95,
      'framesOver16p': over16,
      'longTasks': _longTasks,
      'longTasksTotalMs': _longTasksTotalMs,
    };
  }

  void _finish() {
    final total = html.window.performance.now() - startMs;
    final metrics = _metrics(total);
    _controller.stop();
    running = false;
    _send({
      'type': 'COMPLETE',
      'app': 'flutter',
      'testId': currentTestId,
      'metrics': metrics
    });
  }

  void _send(Map<String, dynamic> msg) {
    final jsObj = jsu.jsify(msg);
    html.window.parent?.postMessage(jsObj, '*');
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    try {
      jsu.callMethod(_po, 'disconnect', []);
    } catch (_) {}
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: CustomPaint(
            size: Size(_w.toDouble(), _h.toDouble()),
            painter: _AnimPainter(
              base: _base,
              startMs: startMs,
              speed: _speed,
              amp: _amp,
              phaseStep: _phaseStep,
              radius: _radius,
              cpuLoops: _cpuLoops,
            ),
          ),
        ),
      ),
    );
  }
}

class _AnimPainter extends CustomPainter {
  final List<Offset> base;
  final double startMs, speed, amp, phaseStep, radius;
  final int cpuLoops;

  _AnimPainter({
    required this.base,
    required this.startMs,
    required this.speed,
    required this.amp,
    required this.phaseStep,
    required this.radius,
    required this.cpuLoops,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final t = html.window.performance.now() - startMs;
    final R = min(size.width, size.height) * amp;
    final paint = Paint()
      ..color = _color
      ..style = PaintingStyle.fill;

    for (var i = 0; i < base.length; i++) {
      final a = t * speed + i * phaseStep;
      double x = base[i].dx + cos(a) * R;
      double y = base[i].dy + sin(a) * R;

      double acc = 0;
      for (int k = 0; k < cpuLoops; k++) {
        acc += sin(x * 0.001 + k) * cos(y * 0.001 + k) * 0.5;
      }
      x += acc * 0.1;
      y += acc * 0.1;

      canvas.drawCircle(Offset(x, y), radius, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _AnimPainter old) => true;
}
