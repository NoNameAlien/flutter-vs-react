// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:html' as html;
import 'dart:js_util' as jsu;

import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

void main() {
  runApp(const PerfApp());
}

class PerfApp extends StatefulWidget {
  const PerfApp({super.key});

  @override
  State<PerfApp> createState() => _PerfAppState();
}

class _PerfAppState extends State<PerfApp> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late List<Offset> _points;
  bool running = false;
  String currentTestId = '';
  Timer? _progressTimer;
  int frames = 0;
  late int startMs;
  int durationMs = 5000;

  @override
  void initState() {
    super.initState();
    _points = List.generate(
        400,
        (i) =>
            Offset(Random().nextDouble() * 400, Random().nextDouble() * 400));
    _controller = AnimationController(
        vsync: this, duration: const Duration(hours: 1))
      ..addListener(() {
        setState(() {
          for (var i = 0; i < _points.length; i++) {
            final p = _points[i];
            _points[i] = Offset(
                (p.dx +
                        sin(i +
                            _controller.lastElapsedDuration!.inMilliseconds /
                                10)) %
                    400,
                (p.dy +
                        cos(i +
                            _controller.lastElapsedDuration!.inMilliseconds /
                                10)) %
                    400);
          }
        });
        frames++;
      });

    html.window.onMessage.listen((event) {
      final data = jsu.dartify(event.data);
      if (data is! Map) return;

      if (data['type'] == 'PING') {
        _send({'type': 'READY', 'app': 'flutter'});
      }
      if (data['type'] == 'START_TEST') {
        _startTest(data['testId'] as String, (data['payload'] as Map));
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _send({'type': 'READY', 'app': 'flutter'});
    });
  }

  void _startTest(String testId, Map payload) {

    
    if (running) return;
    running = true;
    currentTestId = testId;
    durationMs = (payload['durationMs'] as num?)?.toInt() ?? 5000;
    frames = 0;
    startMs = DateTime.now().millisecondsSinceEpoch;
    _controller.repeat();

    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(milliseconds: 100), (t) {
      final elapsed = DateTime.now().millisecondsSinceEpoch - startMs;
      final p = (elapsed / durationMs).clamp(0, 1).toDouble();
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

  Map<String, dynamic> _metrics(int elapsedMs) {
    double? memMb;
    try {
      final perf = html.window.performance as dynamic;
      if (perf?.memory != null) {
        memMb = (perf.memory.usedJSHeapSize as num) / (1024 * 1024);
      }
    } catch (_) {}
    final fps = frames * 1000 / max(1, elapsedMs);
    return {
      'fps': fps,
      'memoryMB': memMb,
      'renderTimeMs': elapsedMs.toDouble(),
    };
  }

  void _finish() {
    final total = DateTime.now().millisecondsSinceEpoch - startMs;
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
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: CustomPaint(
            size: const Size(400, 400),
            painter: _DotsPainter(_points),
          ),
        ),
      ),
    );
  }
}

class _DotsPainter extends CustomPainter {
  final List<Offset> points;
  _DotsPainter(this.points);
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.blueAccent
      ..style = PaintingStyle.fill;
    for (final p in points) {
      canvas.drawCircle(
          Offset(p.dx % size.width, p.dy % size.height), 2.0, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _DotsPainter oldDelegate) => true;
}
