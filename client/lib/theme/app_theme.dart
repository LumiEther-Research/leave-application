import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Card corner radius (rounded-xl) and control radius (rounded-lg).
const double kCardRadius = 12;
const double kControlRadius = 8;

ThemeData buildTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? AppColors.dark : AppColors.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.primary,
    onPrimary: c.onPrimary,
    secondary: c.muted,
    onSecondary: c.foreground,
    error: c.destructive,
    onError: c.onPrimary,
    surface: c.card,
    onSurface: c.foreground,
    outline: c.border,
    outlineVariant: c.border,
  );

  // Tabular figures everywhere, so counts and dates line up.
  const tabular = [FontFeature.tabularFigures()];
  TextStyle style(double size, FontWeight weight, {Color? color, double? height, double? letterSpacing}) =>
      TextStyle(fontSize: size, fontWeight: weight, color: color ?? c.foreground, height: height, letterSpacing: letterSpacing, fontFeatures: tabular);

  OutlineInputBorder border(Color color, {double width = 1}) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(kControlRadius), borderSide: BorderSide(color: color, width: width));

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.background,
    canvasColor: c.background,
    extensions: [c],
    splashFactory: NoSplash.splashFactory,
    textTheme: TextTheme(
      headlineSmall: style(24, FontWeight.w600, letterSpacing: -0.4, height: 1.2), // page title
      titleMedium: style(16, FontWeight.w500, height: 1.3), // section title
      titleSmall: style(14, FontWeight.w500),
      bodyMedium: style(14, FontWeight.w400, height: 1.45), // body text-sm
      bodySmall: style(12, FontWeight.w400, color: c.mutedForeground, height: 1.4),
      labelLarge: style(14, FontWeight.w500),
      labelMedium: style(12, FontWeight.w500),
    ),
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: c.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kCardRadius), side: BorderSide(color: c.border)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: brightness == Brightness.dark ? const Color(0x0DFFFFFF) : c.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: border(c.border),
      enabledBorder: border(c.border),
      focusedBorder: border(c.ring, width: 2),
      errorBorder: border(c.destructive),
      focusedErrorBorder: border(c.destructive, width: 2),
      hintStyle: style(14, FontWeight.w400, color: c.mutedForeground),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.primary,
        foregroundColor: c.onPrimary,
        disabledBackgroundColor: c.primary.withValues(alpha: 0.5),
        disabledForegroundColor: c.onPrimary.withValues(alpha: 0.8),
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius)),
        textStyle: style(14, FontWeight.w500),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.foreground,
        side: BorderSide(color: c.border),
        minimumSize: const Size(0, 36),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius)),
        textStyle: style(14, FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.foreground,
        minimumSize: const Size(0, 36),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius)),
        textStyle: style(14, FontWeight.w500),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.card,
      contentTextStyle: style(14, FontWeight.w500),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius), side: BorderSide(color: c.border)),
      width: 380,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kCardRadius), side: BorderSide(color: c.border)),
      titleTextStyle: style(18, FontWeight.w600),
      contentTextStyle: style(14, FontWeight.w400, color: c.mutedForeground, height: 1.45),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: c.sidebar, surfaceTintColor: Colors.transparent, shape: const RoundedRectangleBorder()),
    popupMenuTheme: PopupMenuThemeData(
      color: c.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius), side: BorderSide(color: c.border)),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: c.foreground, borderRadius: BorderRadius.circular(6)),
      textStyle: style(12, FontWeight.w500, color: c.background),
    ),
  );
}
