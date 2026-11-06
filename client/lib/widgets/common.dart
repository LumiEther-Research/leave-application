import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

/// A white card: 1px zinc-200 border, soft shadow, rounded-xl.
class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(24)});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.card,
        borderRadius: BorderRadius.circular(kCardRadius),
        border: Border.all(color: c.border),
        boxShadow: [BoxShadow(color: c.shadow, blurRadius: 3, offset: const Offset(0, 1))],
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

/// Section title (text-base medium) with a zinc-500 description.
class CardHeading extends StatelessWidget {
  const CardHeading({super.key, required this.title, this.description});

  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: t.titleMedium),
        if (description != null) ...[
          const SizedBox(height: 4),
          Text(description!, style: t.bodyMedium?.copyWith(color: c.mutedForeground)),
        ],
      ],
    );
  }
}

/// Label above, input, then a hint (or the server's error message in the destructive colour).
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    this.error,
    this.hint,
    this.placeholder,
    this.obscure = false,
    this.keyboardType,
    this.autofillHints,
    this.autofocus = false,
    this.onSubmitted,
    this.textInputAction,
    this.enabled = true,
  });

  final String label;
  final TextEditingController controller;
  final String? error;
  final String? hint;
  final String? placeholder;
  final bool obscure;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final bool autofocus;
  final VoidCallback? onSubmitted;
  final TextInputAction? textInputAction;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: t.labelLarge),
        const SizedBox(height: 8),
        Semantics(
          label: label,
          textField: true,
          child: TextField(
            controller: controller,
            obscureText: obscure,
            enabled: enabled,
            autofocus: autofocus,
            keyboardType: keyboardType,
            autofillHints: autofillHints,
            textInputAction: textInputAction,
            onSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
            style: t.bodyMedium,
            decoration: InputDecoration(
              hintText: placeholder,
              errorText: error,
              errorStyle: t.bodySmall?.copyWith(color: c.destructive),
            ),
          ),
        ),
        if (hint != null && error == null) ...[
          const SizedBox(height: 6),
          Text(hint!, style: t.bodySmall),
        ],
      ],
    );
  }
}

/// Inline error: a message, with a retry action when there is something to retry.
class InlineAlert extends StatelessWidget {
  const InlineAlert({super.key, required this.message, this.onRetry, this.tone = AlertTone.error});

  final String message;
  final VoidCallback? onRetry;
  final AlertTone tone;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final isError = tone == AlertTone.error;
    final color = isError ? c.destructive : c.mutedForeground;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isError ? c.destructiveSubtle : c.muted,
          borderRadius: BorderRadius.circular(kControlRadius),
          border: Border.all(color: isError ? c.destructive.withValues(alpha: 0.3) : c.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(top: 1), child: Icon(isError ? Icons.error_outline : Icons.info_outline, size: 18, color: color)),
            const SizedBox(width: 10),
            Expanded(child: Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: isError ? c.destructive : c.foreground))),
            if (onRetry != null) ...[
              const SizedBox(width: 8),
              TextButton(onPressed: onRetry, style: TextButton.styleFrom(foregroundColor: c.destructive, minimumSize: const Size(0, 28)), child: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}

enum AlertTone { error, info }

/// Centered icon in a tinted circle, a short heading, one sentence of help, and an optional primary action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.message, this.actionLabel, this.onAction});

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 48, height: 48, decoration: BoxDecoration(color: c.primarySubtle, shape: BoxShape.circle), child: Icon(icon, color: c.primary)),
            const SizedBox(height: 16),
            Text(title, style: t.titleMedium),
            const SizedBox(height: 4),
            Text(message, style: t.bodyMedium?.copyWith(color: c.mutedForeground), textAlign: TextAlign.center),
            if (actionLabel != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Initials in an accent-tinted circle.
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, required this.name, this.size = 32});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: c.primarySubtle, shape: BoxShape.circle),
      child: ExcludeSemantics(child: Text(initialsOf(name), style: Theme.of(context).textTheme.labelMedium?.copyWith(color: c.primary))),
    );
  }
}

/// A small neutral pill, such as the role or "You".
class PillBadge extends StatelessWidget {
  const PillBadge(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.muted, borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(fontSize: 11, color: c.foreground)),
    );
  }
}

/// The logo. In dark mode it sits on a light plate, because the navy lettering would vanish on a dark canvas.
class Brand extends StatelessWidget {
  const Brand({super.key, this.height = 40});

  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final image = Image.asset('assets/lumiether-logo.png', height: height, semanticLabel: 'LumiEther Research');
    if (!dark) return image;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: c.foreground, borderRadius: BorderRadius.circular(6)),
      child: image,
    );
  }
}

/// Fade and slight rise on first show. Skipped with reduced motion.
class FadeRise extends StatelessWidget {
  const FadeRise({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.of(context).disableAnimations) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
      builder: (context, v, child) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, (1 - v) * 8), child: child)),
      child: child,
    );
  }
}

/// Success/failure feedback, the counterpart of the sonner toasts.
void showToast(BuildContext context, String message, {String? description, bool error = false}) {
  final c = context.colors;
  final t = Theme.of(context).textTheme;
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(SnackBar(
    duration: const Duration(seconds: 4),
    content: Row(
      children: [
        Icon(error ? Icons.error_outline : Icons.check_circle_outline, size: 18, color: error ? c.destructive : c.approved),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message, style: t.labelLarge),
              if (description != null) Text(description, style: t.bodySmall),
            ],
          ),
        ),
      ],
    ),
  ));
}
