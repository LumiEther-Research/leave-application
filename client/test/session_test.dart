import 'package:flutter_test/flutter_test.dart';
import 'package:lumiether_client/state/session.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_server.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('a failed sign-in returns the single generic message and stays signed out', () async {
    final server = FakeServer();
    server.routes['POST /api/auth/login'] = (r) => server.json(401, {'error': 'Incorrect email or password.'});
    final session = Session(server.client());
    expect(await session.login('a@b.com', 'nope'), 'Incorrect email or password.');
    expect(session.user, isNull);
  });

  test('signing in stores the token, sends it on later calls, and sets the user', () async {
    final server = FakeServer();
    server.routes['POST /api/auth/login'] = (r) => server.json(200, {'token': 't1', 'user': userJson()});
    server.routes['GET /api/auth/me'] = (r) => server.json(200, {'user': userJson()});
    final api = server.client();
    final session = Session(api);
    expect(await session.login('boss@example.com', 'pw'), isNull);
    expect(session.status, SessionStatus.signedIn);
    expect(session.user!.name, 'Boss');
    await api.get('/api/auth/me');
    expect(server.requests.last.headers['Authorization'], 'Bearer t1');
    expect((await SharedPreferences.getInstance()).getString('session_token'), 't1');
  });

  test('restore: a saved token the server accepts signs you straight in', () async {
    SharedPreferences.setMockInitialValues({'session_token': 'saved'});
    final server = FakeServer();
    server.routes['GET /api/auth/me'] = (r) => server.json(200, {'user': userJson(role: 'employee', name: 'Priya')});
    final session = Session(server.client());
    await session.restore();
    expect(session.status, SessionStatus.signedIn);
    expect(session.user!.name, 'Priya');
    expect(server.requests.single.headers['Authorization'], 'Bearer saved');
  });

  test('restore: a token the server refuses is thrown away', () async {
    SharedPreferences.setMockInitialValues({'session_token': 'stale'});
    final server = FakeServer();
    server.routes['GET /api/auth/me'] = (r) => server.json(401, {'error': 'You are signed out. Sign in again.'});
    final session = Session(server.client());
    await session.restore();
    expect(session.status, SessionStatus.signedOut);
    expect((await SharedPreferences.getInstance()).getString('session_token'), isNull);
  });

  test('restore with no token goes to the login screen without calling the server', () async {
    final server = FakeServer();
    final session = Session(server.client());
    await session.restore();
    expect(session.status, SessionStatus.signedOut);
    expect(server.requests, isEmpty);
  });

  test('restore when the server is unreachable says so instead of failing silently', () async {
    SharedPreferences.setMockInitialValues({'session_token': 'saved'});
    final api = FakeServer().unreachable();
    final broken = Session(api);
    await broken.restore();
    expect(broken.status, SessionStatus.signedOut);
    expect(broken.notice, contains("Can't reach the server"));
    expect(api.token, isNull);
  });

  test('a 401 on a signed-in call ends the session with a notice (removed account or changed password)', () async {
    final server = FakeServer();
    server.routes['POST /api/auth/login'] = (r) => server.json(200, {'token': 't1', 'user': userJson()});
    server.routes['GET /api/admin/admins'] = (r) => server.json(401, {'error': 'You are signed out. Sign in again.'});
    final api = server.client();
    final session = Session(api);
    await session.login('boss@example.com', 'pw');
    await api.get('/api/admin/admins');
    await Future<void>.delayed(Duration.zero);
    expect(session.status, SessionStatus.signedOut);
    expect(session.notice, contains('signed out'));
    expect(api.token, isNull);
  });

  test('changing the password swaps in the new token; errors come back per field', () async {
    final server = FakeServer();
    server.routes['POST /api/auth/login'] = (r) => server.json(200, {'token': 'old', 'user': userJson()});
    var ok = false;
    server.routes['POST /api/account/password'] = (r) => ok ? server.json(200, {'token': 'new'}) : server.json(422, {'errors': {'current': "That isn't your current password."}});
    final api = server.client();
    final session = Session(api);
    await session.login('boss@example.com', 'pw');

    var errors = await session.changePassword(current: 'x', next: 'new-password', confirm: 'new-password');
    expect(errors, {'current': "That isn't your current password."});
    expect(api.token, 'old');

    ok = true;
    errors = await session.changePassword(current: 'pw', next: 'new-password', confirm: 'new-password');
    expect(errors, isEmpty);
    expect(api.token, 'new');
    expect(server.bodyOf(server.requests.last), {'current': 'pw', 'next': 'new-password', 'confirm': 'new-password'});
  });

  test('logging out clears the token even if the server is unreachable', () async {
    final server = FakeServer();
    server.routes['POST /api/auth/login'] = (r) => server.json(200, {'token': 't1', 'user': userJson()});
    final api = server.client();
    final session = Session(api);
    await session.login('boss@example.com', 'pw');
    await session.logout();
    expect(session.status, SessionStatus.signedOut);
    expect(api.token, isNull);
    expect((await SharedPreferences.getInstance()).getString('session_token'), isNull);
  });
}
