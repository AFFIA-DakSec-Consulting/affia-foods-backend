import 'dart:async';

import 'package:flutter/material.dart';
import 'package:kraveo_ui/kraveo_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../models/delivery_address.dart';
import '../providers/location_provider.dart';
import 'ui/sheet_chrome.dart';

/// Map pin that pulses (soft ring growing and fading) while [active].
class PulsePin extends StatefulWidget {
  const PulsePin({super.key, required this.active, this.size = 14, this.color});

  final bool active;
  final double size;
  final Color? color;

  @override
  State<PulsePin> createState() => _PulsePinState();
}

class _PulsePinState extends State<PulsePin> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300));

  @override
  void initState() {
    super.initState();
    if (widget.active) _c.repeat();
  }

  @override
  void didUpdateWidget(covariant PulsePin old) {
    super.didUpdateWidget(old);
    if (widget.active && !_c.isAnimating) _c.repeat();
    if (!widget.active && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? context.k.brand;
    final box = widget.size * 2;
    return SizedBox(
      width: box,
      height: box,
      child: Stack(alignment: Alignment.center, children: [
        if (widget.active)
          AnimatedBuilder(
            animation: _c,
            builder: (_, __) => Container(
              width: box * (0.5 + _c.value * 0.5),
              height: box * (0.5 + _c.value * 0.5),
              decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.28 * (1 - _c.value))),
            ),
          ),
        Icon(LucideIcons.mapPin, size: widget.size, color: color),
      ]),
    );
  }
}

/// Home header: "DELIVERING TO" over the geolocated address. Tapping opens the address sheet.
class LocatedAddressButton extends StatelessWidget {
  const LocatedAddressButton({super.key, required this.onChooseDropPoint});

  /// Fallback when location is not available: pick one of the drop points by hand.
  final VoidCallback onChooseDropPoint;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final loc = context.watch<DeliveryLocationProvider>();
    final address = loc.address;
    final locating = loc.isLocating;
    final String label;
    if (address != null) {
      label = address.title;
    } else if (locating) {
      label = 'Localisation en cours…';
    } else {
      label = 'Définir votre adresse';
    }
    return KPressable(
      semanticLabel: address == null ? '$label. Changer l\'adresse de livraison' : 'Livrer à ${address.title}. Changer l\'adresse de livraison',
      onTap: () => showDeliveryAddressSheet(context, onChooseDropPoint: onChooseDropPoint),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('LIVRER À', style: KraveoType.caption.copyWith(color: k.inkMuted, letterSpacing: 0.6, fontSize: 10)),
        const SizedBox(height: 2),
        Row(mainAxisSize: MainAxisSize.min, children: [
          PulsePin(active: locating, size: 14),
          const SizedBox(width: 2),
          Flexible(
            child: AnimatedSwitcher(
              duration: KMotion.base,
              transitionBuilder: (c, a) => FadeTransition(
                opacity: a,
                child: SlideTransition(position: Tween(begin: const Offset(0, 0.3), end: Offset.zero).animate(a), child: c),
              ),
              child: Text(
                label,
                key: ValueKey(label),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: KraveoType.titleMd.copyWith(color: address == null ? k.inkMuted : k.ink),
              ),
            ),
          ),
          const SizedBox(width: 4),
          Icon(LucideIcons.chevronDown, size: 15, color: k.ink),
        ]),
      ]),
    );
  }
}

/// "Delivery address" sheet: the located address on a small map-like card, a button to locate
/// again (or to fix permissions / turn location on), and a way to pick a drop point instead.
Future<void> showDeliveryAddressSheet(BuildContext context, {required VoidCallback onChooseDropPoint}) {
  return showKSheet<void>(
    context,
    builder: (ctx) => _AddressSheet(onChooseDropPoint: () {
      Navigator.of(ctx).pop();
      onChooseDropPoint();
    }),
  );
}

class _AddressSheet extends StatelessWidget {
  const _AddressSheet({required this.onChooseDropPoint});

  final VoidCallback onChooseDropPoint;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final loc = context.watch<DeliveryLocationProvider>();
    final address = loc.address;
    final status = loc.status;

    final (String? problem, String actionLabel, IconData actionIcon, VoidCallback action) = switch (status) {
      LocationStatus.deniedForever => (
          'La localisation est désactivée pour Kraveo. Activez-la dans les réglages de l\'app pour être livré là où vous êtes.',
          'Ouvrir les réglages',
          LucideIcons.settings,
          () => unawaited(loc.openAppSettings()),
        ),
      LocationStatus.serviceOff => (
          'La localisation de votre téléphone est désactivée.',
          'Activer la localisation',
          LucideIcons.locateFixed,
          () => unawaited(loc.openLocationSettings()),
        ),
      LocationStatus.denied => (
          'Autorisez la localisation pour que nous trouvions votre adresse.',
          'Utiliser ma position actuelle',
          LucideIcons.locateFixed,
          () => unawaited(loc.locate()),
        ),
      LocationStatus.failed => (
          'Impossible de trouver votre position. Rapprochez-vous d\'une fenêtre ou réessayez.',
          'Réessayer',
          LucideIcons.rotateCcw,
          () => unawaited(loc.locate()),
        ),
      _ => (null, 'Utiliser ma position actuelle', LucideIcons.locateFixed, () => unawaited(loc.locate())),
    };

    return KSheetFrame(
      title: 'Adresse de livraison',
      subtitle: Text('Nous utilisons votre position pour savoir où livrer votre commande.', style: KraveoType.bodySm.copyWith(color: k.inkMuted)),
      children: [
        _AddressCard(address: address, locating: loc.isLocating),
        if (problem != null) ...[
          const SizedBox(height: 14),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(padding: const EdgeInsets.only(top: 1), child: Icon(LucideIcons.info, size: 16, color: k.inkMuted)),
            const SizedBox(width: 8),
            Expanded(child: Text(problem, style: KraveoType.bodySm.copyWith(color: k.inkMuted))),
          ]),
        ],
        const SizedBox(height: 20),
        KButton(label: actionLabel, icon: actionIcon, loading: loc.isLocating, onPressed: action),
        const SizedBox(height: 10),
        KButton(label: 'Choisir un point de livraison', kind: KButtonKind.ghost, icon: LucideIcons.mapPinned, onPressed: onChooseDropPoint),
      ],
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({required this.address, required this.locating});

  final DeliveryAddress? address;
  final bool locating;

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    final a = address;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: k.surface,
        borderRadius: BorderRadius.circular(KRadius.lg),
        border: Border.all(color: k.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // A light "map" band: grid lines and the pulsing pin in the middle.
        SizedBox(
          height: 110,
          child: Stack(fit: StackFit.expand, children: [
            CustomPaint(painter: _GridPainter(line: k.line, fill: k.surfaceAlt)),
            Center(child: PulsePin(active: locating || a == null, size: 30)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: AnimatedSwitcher(
            duration: KMotion.base,
            child: Column(
              key: ValueKey('${a?.title}|${a?.subtitle}|$locating'),
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  a?.title ?? (locating ? 'Localisation en cours…' : 'Aucune adresse pour l\'instant'),
                  style: KraveoType.titleLg.copyWith(color: a == null ? k.inkMuted : k.ink),
                ),
                if (a != null && a.subtitle.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(a.subtitle, style: KraveoType.body.copyWith(color: k.inkMuted)),
                ],
                if (a?.accuracyMeters != null) ...[
                  const SizedBox(height: 6),
                  Text('Précision d\'environ ${a!.accuracyMeters!.round()} m', style: KraveoType.caption.copyWith(color: k.inkFaint)),
                ],
              ],
            ),
          ),
        ),
      ]),
    );
  }
}

class _GridPainter extends CustomPainter {
  const _GridPainter({required this.line, required this.fill});

  final Color line;
  final Color fill;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = fill);
    final p = Paint()
      ..color = line
      ..strokeWidth = 1;
    const step = 22.0;
    for (var x = 0.0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), p);
    }
    for (var y = 0.0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
    }
    // Two "roads" for a map feel.
    final road = Paint()
      ..color = line
      ..strokeWidth = 7;
    canvas.drawLine(Offset(0, size.height * 0.68), Offset(size.width, size.height * 0.4), road);
    canvas.drawLine(Offset(size.width * 0.3, 0), Offset(size.width * 0.42, size.height), road);
  }

  @override
  bool shouldRepaint(covariant _GridPainter old) => old.line != line || old.fill != fill;
}
