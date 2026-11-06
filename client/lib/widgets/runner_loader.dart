import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A stick figure running on a ground line: the loader shown while a screen's data arrives. Drawn with a painter
/// (no files), in the foreground colour so it follows both themes. With reduced motion it holds one pose.
class RunnerLoader extends StatefulWidget {
  const RunnerLoader({super.key, this.fullScreen = false, this.label = 'Loading…'});

  final bool fullScreen;
  final String label;

  @override
  State<RunnerLoader> createState() => _RunnerLoaderState();
}

class _RunnerLoaderState extends State<RunnerLoader> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _controller.stop();
      _controller.value = 0.15;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final body = Semantics(
      label: widget.label,
      liveRegion: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 160,
            height: 107,
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) => CustomPaint(painter: _RunnerPainter(_controller.value, c.foreground, c.mutedForeground)),
            ),
          ),
          const SizedBox(height: 12),
          Text(widget.label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: c.mutedForeground)),
        ],
      ),
    );
    if (widget.fullScreen) return ColoredBox(color: c.background, child: Center(child: body));
    return Padding(padding: const EdgeInsets.symmetric(vertical: 64), child: Center(child: body));
  }
}

class _RunnerPainter extends CustomPainter {
  _RunnerPainter(this.t, this.color, this.groundColor);

  final double t; // 0..1 per stride
  final Color color;
  final Color groundColor;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 120; // the drawing is laid out on a 120 x 80 grid
    canvas.scale(s);

    final line = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final ground = Paint()
      ..color = groundColor.withValues(alpha: 0.5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;

    canvas.drawLine(const Offset(8, 70), const Offset(112, 70), ground);
    // dashes slide backwards under the runner
    final shift = (t * 16) % 16;
    for (double x = 8 - shift; x < 112; x += 16) {
      final a = math.max(x, 8.0);
      final b = math.min(x + 8, 112.0);
      if (b > a) canvas.drawLine(Offset(a, 76), Offset(b, 76), ground);
    }

    final phase = t * 2 * math.pi;
    final bounce = (math.sin(phase * 2)).abs() * -2.5;
    canvas.save();
    canvas.translate(60, 42 + bounce);

    // torso leans forward, head on top
    const hip = Offset(0, 0);
    final shoulder = Offset(3, -16);
    canvas.drawLine(hip, shoulder, line);
    canvas.drawCircle(Offset(6, -23), 6, line);

    void leg(double p) {
      final thigh = math.sin(p) * 0.9; // radians from vertical
      final knee = hip + Offset(math.sin(thigh) * 14, math.cos(thigh) * 14);
      final shin = thigh - 0.2 - (math.cos(p) + 1) * 0.45; // knee bends as the leg swings through
      final foot = knee + Offset(math.sin(shin) * 14, math.cos(shin) * 14);
      canvas.drawPath(
        Path()
          ..moveTo(hip.dx, hip.dy)
          ..lineTo(knee.dx, knee.dy)
          ..lineTo(foot.dx, foot.dy),
        line,
      );
    }

    void arm(double p) {
      final upper = math.sin(p) * 0.9;
      final elbow = shoulder + Offset(math.sin(upper) * 9, math.cos(upper) * 9);
      final fore = upper + 1.3 + math.cos(p) * 0.3;
      final hand = elbow + Offset(math.sin(fore) * 8, math.cos(fore) * 8);
      canvas.drawPath(
        Path()
          ..moveTo(shoulder.dx, shoulder.dy)
          ..lineTo(elbow.dx, elbow.dy)
          ..lineTo(hand.dx, hand.dy),
        line,
      );
    }

    leg(phase);
    leg(phase + math.pi);
    arm(phase + math.pi);
    arm(phase);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_RunnerPainter old) => old.t != t || old.color != color || old.groundColor != groundColor;
}
