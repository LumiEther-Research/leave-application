import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'screens/login_screen.dart';
import 'state/session.dart';
import 'state/theme_controller.dart';
import 'theme/app_theme.dart';
import 'widgets/app_shell.dart';
import 'widgets/runner_loader.dart';

void main() {
  final api = ApiClient();
  final session = Session(api)..restore();
  final theme = ThemeController()..load();
  runApp(LumiEtherApp(api: api, session: session, theme: theme));
}

class LumiEtherApp extends StatelessWidget {
  const LumiEtherApp({super.key, required this.api, required this.session, required this.theme});

  final ApiClient api;
  final Session session;
  final ThemeController theme;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([session, theme]),
      builder: (context, _) => MaterialApp(
        title: 'LumiEther Research',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: theme.mode,
        home: switch (session.status) {
          SessionStatus.restoring => const Scaffold(body: RunnerLoader(fullScreen: true)),
          SessionStatus.signedOut => LoginScreen(session: session),
          SessionStatus.signedIn => AppShell(session: session, api: api, theme: theme),
        },
      ),
    );
  }
}
