import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lumiether_client/main.dart';
import 'package:lumiether_client/state/session.dart';
import 'package:lumiether_client/state/theme_controller.dart';
import 'package:lumiether_client/theme/app_theme.dart';
import 'package:lumiether_client/widgets/runner_loader.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_server.dart';

const adminA = {'id': 'a1', 'name': 'Boss', 'email': 'boss@example.com'};
const adminB = {'id': 'a2', 'name': 'Second Admin', 'email': 'second@example.com'};

Future<(FakeServer, Session)> boot(WidgetTester tester, {String role = 'admin', bool signedIn = true}) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues(signedIn ? {'session_token': 'tok'} : {});
  final server = FakeServer();
  server.routes['GET /api/auth/me'] = (r) => server.json(200, {'user': userJson(role: role, name: role == 'admin' ? 'Boss' : 'Priya Sharma', id: role == 'admin' ? 'a1' : 'e1')});
  server.routes['POST /api/auth/login'] = (r) => server.json(401, {'error': 'Incorrect email or password.'});
  final api = server.client();
  final session = Session(api);
  final theme = ThemeController();
  await session.restore();
  await tester.pumpWidget(LumiEtherApp(api: api, session: session, theme: theme));
  await tester.pump(const Duration(milliseconds: 300));
  return (server, session);
}

void main() {
  testWidgets('signed out: the login screen shows the generic error and keeps the typed email', (tester) async {
    await boot(tester, signedIn: false);
    expect(find.text('Sign in'), findsWidgets);
    await tester.enterText(find.byType(TextField).at(0), 'priya@gmail.com');
    await tester.enterText(find.byType(TextField).at(1), 'wrong');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Incorrect email or password.'), findsOneWidget);
    expect(find.text('priya@gmail.com'), findsOneWidget);
  });

  testWidgets('the loader holds still with reduced motion and shows its label', (tester) async {
    await tester.pumpWidget(MediaQuery(
      data: const MediaQueryData(disableAnimations: true),
      child: MaterialApp(theme: buildTheme(Brightness.light), home: const Scaffold(body: RunnerLoader(fullScreen: true))),
    ));
    // pumpAndSettle would hang if something kept animating
    await tester.pumpAndSettle();
    expect(find.text('Loading…'), findsOneWidget);
  });

  testWidgets('admin: the sidebar lists only built screens under section labels and lands on Admins', (tester) async {
    final (server, _) = await boot(tester);
    server.routes['GET /api/admin/admins'] = (r) => server.json(200, {'admins': [adminA, adminB]});
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    for (final label in ['COMPANY', 'ACCOUNT']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('Change password'), findsOneWidget);
    expect(find.text('Employees'), findsNothing); // not built yet: never a dead link
    expect(find.text('Admin'), findsOneWidget); // role badge
  });

  testWidgets('employee: only Change password exists, and there is no Admins entry', (tester) async {
    await boot(tester, role: 'employee');
    expect(find.text('Admins'), findsNothing);
    expect(find.text('Change password'), findsWidgets);
    expect(find.text('Employee'), findsOneWidget);
    expect(find.text('Priya Sharma'), findsOneWidget);
  });

  testWidgets('admins: lists everyone, marks you, offers Remove for the others', (tester) async {
    final (server, _) = await boot(tester);
    server.routes['GET /api/admin/admins'] = (r) => server.json(200, {'admins': [adminA, adminB]});
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    // landing was built before the route existed; reopen the screen
    await tester.tap(find.text('Change password').first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Admins').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('2 admins. Every admin can approve requests and manage employees and other admins.'), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Remove'), findsOneWidget);
    expect(find.text('second@example.com'), findsOneWidget);
  });

  testWidgets('admins: a failed load shows an inline error with a retry that works', (tester) async {
    final (server, _) = await boot(tester);
    var fail = true;
    server.routes['GET /api/admin/admins'] = (r) => fail ? server.json(500, {'error': 'Something went wrong. Please try again.'}) : server.json(200, {'admins': [adminA]});
    await tester.tap(find.text('Change password').first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Admins').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Something went wrong. Please try again.'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('1 admin. Every admin can approve requests and manage employees and other admins.'), findsOneWidget);
  });

  testWidgets('admins: removing asks first, then calls the server and toasts', (tester) async {
    final (server, _) = await boot(tester);
    var removed = false;
    server.routes['GET /api/admin/admins'] = (r) => server.json(200, {'admins': removed ? [adminA] : [adminA, adminB]});
    server.routes['DELETE /api/admin/admins/a2'] = (r) {
      removed = true;
      return server.json(200, {'ok': true});
    };
    await tester.tap(find.text('Change password').first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Admins').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Remove Second Admin as admin?'), findsOneWidget);
    expect(server.requests.where((r) => r.method == 'DELETE'), isEmpty); // nothing yet

    await tester.tap(find.text('Remove admin'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(server.requests.where((r) => r.method == 'DELETE').length, 1);
    expect(find.text('Second Admin is no longer an admin'), findsOneWidget);
    expect(find.text('Remove'), findsNothing);
  });

  testWidgets('admins: the add form shows the server\'s per-field errors and keeps what was typed', (tester) async {
    final (server, _) = await boot(tester);
    server.routes['GET /api/admin/admins'] = (r) => server.json(200, {'admins': [adminA]});
    server.routes['POST /api/admin/admins'] = (r) => server.json(422, {
          'errors': {'email': 'Someone already uses this email.', 'password': 'Use at least 8 characters.'},
          'values': {'email': 'boss@example.com'},
        });
    await tester.tap(find.text('Change password').first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Admins').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    await tester.enterText(find.byType(TextField).at(0), 'boss@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'short');
    await tester.tap(find.widgetWithText(FilledButton, 'Add admin'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Someone already uses this email.'), findsOneWidget);
    expect(find.text('Use at least 8 characters.'), findsOneWidget);
    expect(find.text('boss@example.com'), findsWidgets);
    expect(server.bodyOf(server.requests.last), {'email': 'boss@example.com', 'password': 'short'});
  });

  testWidgets('change password: field errors from the server appear under the fields; success toasts and clears', (tester) async {
    final (server, _) = await boot(tester, role: 'employee');
    var ok = false;
    server.routes['POST /api/account/password'] = (r) =>
        ok ? server.json(200, {'token': 'fresh'}) : server.json(422, {'errors': {'current': "That isn't your current password."}});

    await tester.enterText(find.byType(TextField).at(0), 'nope');
    await tester.enterText(find.byType(TextField).at(1), 'my-own-pass-9');
    await tester.enterText(find.byType(TextField).at(2), 'my-own-pass-9');
    await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text("That isn't your current password."), findsOneWidget);

    ok = true;
    await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Password changed'), findsOneWidget);
    expect(find.text("That isn't your current password."), findsNothing);
  });

  testWidgets('a narrow screen turns the sidebar into a drawer', (tester) async {
    await boot(tester, role: 'employee');
    tester.view.physicalSize = const Size(400, 800);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byTooltip('Open menu'), findsOneWidget);
    expect(find.text('ACCOUNT'), findsNothing);
    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    expect(find.text('ACCOUNT'), findsOneWidget);
  });
}
