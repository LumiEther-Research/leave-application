import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../nav_config.dart';
import '../screens/admins_screen.dart';
import '../screens/change_password_screen.dart';
import '../state/session.dart';
import '../state/theme_controller.dart';
import '../theme/app_colors.dart';
import '../theme/app_theme.dart';
import 'common.dart';

const double kSidebarWidth = 256;
const double kDesktopBreakpoint = 768;

/// Sidebar (a drawer under 768 px), sticky blurred header, and the page for the selected nav item.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.session, required this.api, required this.theme});

  final Session session;
  final ApiClient api;
  final ThemeController theme;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late String _selected = firstReady(widget.session.user!.role).id;

  User get user => widget.session.user!;

  void _select(String id) => setState(() => _selected = id);

  Widget _page() {
    switch (_selected) {
      case 'admins':
        return AdminsScreen(key: const ValueKey('admins'), api: widget.api, currentUserId: user.id);
      case 'password':
        return ChangePasswordScreen(key: const ValueKey('password'), session: widget.session);
      default:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final desktop = MediaQuery.sizeOf(context).width >= kDesktopBreakpoint;
    final item = itemById(user.role, _selected);

    final main = Column(
      children: [
        _Header(
          title: item.label,
          user: user,
          showMenu: !desktop,
          onLogout: widget.session.logout,
          theme: widget.theme,
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(desktop ? 32 : 16),
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1280),
                child: FadeRise(key: ValueKey(_selected), child: _page()),
              ),
            ),
          ),
        ),
      ],
    );

    return Scaffold(
      backgroundColor: c.background,
      drawer: desktop ? null : Drawer(width: kSidebarWidth, child: SafeArea(child: _Sidebar(role: user.role, selected: _selected, onSelect: (id) { Navigator.of(context).pop(); _select(id); }))),
      body: desktop
          ? Row(
              children: [
                SizedBox(width: kSidebarWidth, child: _Sidebar(role: user.role, selected: _selected, onSelect: _select)),
                Expanded(child: main),
              ],
            )
          : main,
    );
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.role, required this.selected, required this.onSelect});

  final Role role;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(color: c.sidebar, border: Border(right: BorderSide(color: c.border))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 64,
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: const Brand(height: 32),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
              children: [
                for (final section in readySections(role)) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 16, 8, 6),
                    child: Text(section.label.toUpperCase(), style: t.labelMedium?.copyWith(fontSize: 11, letterSpacing: 0.8, color: c.mutedForeground)),
                  ),
                  for (final item in section.items) _NavTile(item: item, active: item.id == selected, onTap: () => onSelect(item.id)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NavTile extends StatefulWidget {
  const _NavTile({required this.item, required this.active, required this.onTap});

  final NavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  State<_NavTile> createState() => _NavTileState();
}

class _NavTileState extends State<_NavTile> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = Theme.of(context).textTheme;
    final active = widget.active;
    final fg = active ? c.primary : c.foreground.withValues(alpha: 0.8);
    return Semantics(
      button: true,
      selected: active,
      label: widget.item.label,
      child: MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: widget.onTap,
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            height: 40,
            margin: const EdgeInsets.symmetric(vertical: 1),
            decoration: BoxDecoration(
              color: active ? c.primarySubtle : (_hover ? c.muted : Colors.transparent),
              borderRadius: BorderRadius.circular(kControlRadius),
            ),
            child: Stack(
              children: [
                if (active)
                  Positioned(left: 0, top: 8, bottom: 8, child: Container(width: 3, decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(2)))),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      Icon(widget.item.icon, size: 18, color: fg),
                      const SizedBox(width: 10),
                      Expanded(child: Text(widget.item.label, style: t.labelLarge?.copyWith(color: fg), overflow: TextOverflow.ellipsis)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.user, required this.showMenu, required this.onLogout, required this.theme});

  final String title;
  final User user;
  final bool showMenu;
  final VoidCallback onLogout;
  final ThemeController theme;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final wide = MediaQuery.sizeOf(context).width >= 640;
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          height: 64,
          padding: EdgeInsets.symmetric(horizontal: showMenu ? 8 : 32),
          decoration: BoxDecoration(color: c.background.withValues(alpha: 0.8), border: Border(bottom: BorderSide(color: c.border))),
          child: Row(
            children: [
              if (showMenu) Builder(builder: (context) => IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: () => Scaffold.of(context).openDrawer())),
              Expanded(child: Text(title, style: t.headlineSmall, overflow: TextOverflow.ellipsis, semanticsLabel: title)),
              IconButton(
                tooltip: dark ? 'Switch to light mode' : 'Switch to dark mode',
                icon: Icon(dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined, size: 20),
                onPressed: () => theme.toggle(Theme.of(context).brightness),
              ),
              const SizedBox(width: 4),
              UserAvatar(name: user.name),
              if (wide) ...[
                const SizedBox(width: 10),
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user.name, style: t.labelLarge?.copyWith(height: 1.1)),
                    const SizedBox(height: 3),
                    PillBadge(roleLabel(user.role)),
                  ],
                ),
              ],
              const SizedBox(width: 8),
              wide
                  ? TextButton.icon(onPressed: onLogout, icon: const Icon(Icons.logout, size: 18), label: const Text('Log out'))
                  : IconButton(tooltip: 'Log out', icon: const Icon(Icons.logout, size: 20), onPressed: onLogout),
            ],
          ),
        ),
      ),
    );
  }
}
