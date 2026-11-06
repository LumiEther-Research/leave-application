import 'package:flutter/material.dart';

/// Every colour the app uses, in one place (the counterpart of globals.css). Widgets read these through
/// `context.colors`; no widget hard-codes a colour. Zinc surfaces, one accent: violet-600.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.background,
    required this.foreground,
    required this.card,
    required this.border,
    required this.muted,
    required this.mutedForeground,
    required this.primary,
    required this.onPrimary,
    required this.primarySubtle,
    required this.ring,
    required this.destructive,
    required this.destructiveSubtle,
    required this.sidebar,
    required this.shadow,
    required this.pending,
    required this.pendingSurface,
    required this.approved,
    required this.approvedSurface,
    required this.rejected,
    required this.rejectedSurface,
  });

  final Color background;
  final Color foreground;
  final Color card;
  final Color border;
  final Color muted;
  final Color mutedForeground;
  final Color primary;
  final Color onPrimary;
  final Color primarySubtle;
  final Color ring;
  final Color destructive;
  final Color destructiveSubtle;
  final Color sidebar;
  final Color shadow;

  /// Status colours: pending = amber, approved = emerald, rejected = rose.
  final Color pending;
  final Color pendingSurface;
  final Color approved;
  final Color approvedSurface;
  final Color rejected;
  final Color rejectedSurface;

  static const light = AppColors(
    background: Color(0xFFFAFAFA), // zinc-50
    foreground: Color(0xFF09090B), // zinc-950
    card: Color(0xFFFFFFFF),
    border: Color(0xFFE4E4E7), // zinc-200
    muted: Color(0xFFF4F4F5), // zinc-100
    mutedForeground: Color(0xFF71717A), // zinc-500
    primary: Color(0xFF7C3AED), // violet-600
    onPrimary: Color(0xFFFAFAFA),
    primarySubtle: Color(0x147C3AED), // 8%
    ring: Color(0xFF8B5CF6), // violet-500
    destructive: Color(0xFFDC2626), // red-600
    destructiveSubtle: Color(0x14DC2626),
    sidebar: Color(0xFFFFFFFF),
    shadow: Color(0x0A18181B),
    pending: Color(0xFFB45309), // amber-700
    pendingSurface: Color(0xFFFEF3C7), // amber-100
    approved: Color(0xFF047857), // emerald-700
    approvedSurface: Color(0xFFD1FAE5), // emerald-100
    rejected: Color(0xFFBE123C), // rose-700
    rejectedSurface: Color(0xFFFFE4E6), // rose-100
  );

  static const dark = AppColors(
    background: Color(0xFF09090B),
    foreground: Color(0xFFFAFAFA),
    card: Color(0xFF18181B), // zinc-900
    border: Color(0x1AFFFFFF), // white 10%
    muted: Color(0xFF27272A), // zinc-800
    mutedForeground: Color(0xFFA1A1AA), // zinc-400
    primary: Color(0xFF8B5CF6), // violet-500
    onPrimary: Color(0xFFFAFAFA),
    primarySubtle: Color(0x248B5CF6), // 14%
    ring: Color(0xFFA78BFA), // violet-400
    destructive: Color(0xFFF87171), // red-400
    destructiveSubtle: Color(0x24F87171),
    sidebar: Color(0xFF18181B),
    shadow: Color(0x4D000000),
    pending: Color(0xFFFCD34D), // amber-300
    pendingSurface: Color(0x26F59E0B),
    approved: Color(0xFF6EE7B7), // emerald-300
    approvedSurface: Color(0x2610B981),
    rejected: Color(0xFFFDA4AF), // rose-300
    rejectedSurface: Color(0x26F43F5E),
  );

  @override
  AppColors copyWith() => this;

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) => t < 0.5 ? this : (other as AppColors? ?? this);
}

extension AppColorsContext on BuildContext {
  AppColors get colors => Theme.of(this).extension<AppColors>()!;
}
