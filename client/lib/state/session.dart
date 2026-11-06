import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/models.dart';

enum SessionStatus { restoring, signedOut, signedIn }

/// Who is signed in. The token lives in the browser's local storage; the server re-checks it on every request.
class Session extends ChangeNotifier {
  Session(this.api) {
    api.onSessionEnded = _ended;
  }

  static const _tokenKey = 'session_token';
  static const generic = 'Incorrect email or password.';

  final ApiClient api;
  SessionStatus status = SessionStatus.restoring;
  User? user;

  /// Shown on the login screen after a session ended on its own.
  String? notice;

  Future<void> _store(String? token) async {
    api.token = token;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (token == null) {
        await prefs.remove(_tokenKey);
      } else {
        await prefs.setString(_tokenKey, token);
      }
    } catch (_) {
      // storage blocked (private window): the session just lasts until the tab closes
    }
  }

  /// Picks up a saved token, if any, and asks the server whether it is still good.
  Future<void> restore() async {
    String? saved;
    try {
      saved = (await SharedPreferences.getInstance()).getString(_tokenKey);
    } catch (_) {
      saved = null;
    }
    if (saved == null) return _setSignedOut();
    api.token = saved;
    try {
      final r = await api.get('/api/auth/me');
      if (r.ok && r.json?['user'] is Map<String, dynamic>) {
        user = User.fromJson(r.json!['user'] as Map<String, dynamic>);
        status = SessionStatus.signedIn;
        notifyListeners();
      } else {
        await _store(null);
        _setSignedOut();
      }
    } on NetworkFailure {
      // keep the token; the person can retry once the server is back
      api.token = null;
      _setSignedOut(notice: const NetworkFailure().toString());
    }
  }

  void _setSignedOut({String? notice}) {
    user = null;
    status = SessionStatus.signedOut;
    this.notice = notice;
    notifyListeners();
  }

  void _ended() {
    _store(null);
    _setSignedOut(notice: 'You were signed out. Sign in again.');
  }

  /// Null on success, otherwise the message to show.
  Future<String?> login(String email, String password) async {
    try {
      final r = await api.post('/api/auth/login', body: {'email': email, 'password': password}, auth: false);
      if (!r.ok) return r.error ?? generic;
      await _store(r.json!['token'] as String);
      user = User.fromJson(r.json!['user'] as Map<String, dynamic>);
      status = SessionStatus.signedIn;
      notice = null;
      notifyListeners();
      return null;
    } on NetworkFailure catch (e) {
      return e.toString();
    }
  }

  Future<void> logout() async {
    try {
      await api.post('/api/auth/logout');
    } catch (_) {
      // signing out locally is what matters
    }
    await _store(null);
    _setSignedOut();
  }

  /// Returns field errors (empty on success). A successful change swaps in the new token for this device.
  Future<Map<String, String>> changePassword({required String current, required String next, required String confirm}) async {
    final r = await api.post('/api/account/password', body: {'current': current, 'next': next, 'confirm': confirm});
    if (r.ok) {
      await _store(r.json!['token'] as String);
      return const {};
    }
    if (r.status == 422) return r.fieldErrors;
    return {'form': r.error ?? 'Something went wrong. Please try again.'};
  }
}
