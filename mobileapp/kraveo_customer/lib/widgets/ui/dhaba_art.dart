import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';

import '../../models/dhaba.dart';
import 'food_emoji.dart';
import 'k_image.dart';

/// One of three Kraveo colourways, picked from the kitchen id so a kitchen keeps its look.
class _Art {
  const _Art(this.from, this.to, this.accent, this.ink);

  final Color from;
  final Color to;
  final Color accent;

  /// Text / initials colour on [from]-[to].
  final Color ink;

  static const _ways = [
    _Art(KraveoPalette.g700, KraveoPalette.g950, KraveoPalette.y400, Colors.white),
    _Art(KraveoPalette.y300, KraveoPalette.y500, KraveoPalette.g800, KraveoPalette.g950),
    _Art(KraveoPalette.g500, KraveoPalette.g800, KraveoPalette.y300, Colors.white),
  ];

  static _Art of(Dhaba d) {
    var h = 0;
    for (final c in (d.id.isEmpty ? d.name : d.id).codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    return _ways[h % _ways.length];
  }
}

/// The kitchen's banner photo, or a drawn default: brand gradient, soft rings and dots, and the
/// cuisine's emoji, so a kitchen without a photo still looks finished.
class DhabaBanner extends StatelessWidget {
  const DhabaBanner({super.key, required this.dhaba, this.grayscale = false});

  final Dhaba dhaba;
  final bool grayscale;

  @override
  Widget build(BuildContext context) => KImage(dhaba.bannerUrl, grayscale: grayscale, fallback: DefaultDhabaBanner(dhaba: dhaba, grayscale: grayscale));
}

class DefaultDhabaBanner extends StatelessWidget {
  const DefaultDhabaBanner({super.key, required this.dhaba, this.grayscale = false});

  final Dhaba dhaba;
  final bool grayscale;

  @override
  Widget build(BuildContext context) {
    final art = _Art.of(dhaba);
    final emoji = categoryEmoji(dhaba.category.isEmpty ? dhaba.name : dhaba.category);
    Widget body = DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [art.from, art.to]),
      ),
      child: LayoutBuilder(builder: (context, box) {
        final h = box.maxHeight.isFinite ? box.maxHeight : 180.0;
        return Stack(clipBehavior: Clip.hardEdge, fit: StackFit.expand, children: [
          CustomPaint(painter: _DotsPainter(color: art.ink.withValues(alpha: 0.10))),
          Positioned(
            right: -h * 0.25,
            top: -h * 0.35,
            child: Container(width: h * 1.1, height: h * 1.1, decoration: BoxDecoration(shape: BoxShape.circle, color: art.accent.withValues(alpha: 0.22))),
          ),
          Positioned(
            right: h * 0.05,
            bottom: -h * 0.45,
            child: Container(
              width: h * 0.9,
              height: h * 0.9,
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: art.ink.withValues(alpha: 0.14), width: 2)),
            ),
          ),
          Positioned(
            right: h * 0.14,
            top: 0,
            bottom: 0,
            child: Center(
              child: Transform.rotate(
                angle: -0.18,
                child: ExcludeSemantics(child: Text(emoji, style: TextStyle(fontSize: h * 0.46, height: 1))),
              ),
            ),
          ),
        ]);
      }),
    );
    if (grayscale) body = Opacity(opacity: 0.55, child: ColorFiltered(colorFilter: const ColorFilter.mode(Colors.grey, BlendMode.saturation), child: body));
    return body;
  }
}

class _DotsPainter extends CustomPainter {
  const _DotsPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = color;
    const step = 18.0;
    for (var y = step / 2; y < size.height; y += step) {
      for (var x = step / 2; x < size.width * 0.55; x += step) {
        canvas.drawCircle(Offset(x, y), 1.6, p);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DotsPainter old) => old.color != color;
}

/// Round kitchen logo with a white ring and a soft shadow; the default is the kitchen's
/// initials on its colourway.
class DhabaLogo extends StatelessWidget {
  const DhabaLogo({super.key, required this.dhaba, this.size = 64, this.ring = 3, this.grayscale = false});

  final Dhaba dhaba;
  final double size;
  final double ring;
  final bool grayscale;

  static String initials(String name) {
    final words = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty && RegExp(r'[A-Za-zÀ-ÿ0-9]').hasMatch(w[0])).toList();
    if (words.isEmpty) return 'K';
    String first(String w) => String.fromCharCodes(w.runes.take(1)).toUpperCase();
    return words.length == 1 ? first(words.first) : first(words[0]) + first(words[1]);
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final art = _Art.of(dhaba);
    final fallback = DecoratedBox(
      decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [art.from, art.to])),
      child: Center(
        child: Text(
          initials(dhaba.name),
          style: KraveoType.headlineSm.copyWith(color: art.ink, fontSize: size * 0.36, height: 1, letterSpacing: -0.5),
        ),
      ),
    );
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(ring),
      decoration: BoxDecoration(color: k.surface, shape: BoxShape.circle, boxShadow: KShadow.soft(k.shadowTint)),
      child: ClipOval(child: KImage(dhaba.logoUrl, grayscale: grayscale, fallback: fallback)),
    );
  }
}
