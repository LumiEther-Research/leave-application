import 'dart:convert';

import 'package:http/http.dart' as http;

/// The server answered, with this status and JSON body (if any).
class ApiResponse {
  ApiResponse(this.status, this.json);
  final int status;
  final Map<String, dynamic>? json;

  bool get ok => status >= 200 && status < 300;

  /// The server's single error message, if it sent one.
  String? get error => json?['error'] as String?;

  /// Per-field messages ({"errors": {"email": "..."}}), or an empty map.
  Map<String, String> get fieldErrors {
    final raw = json?['errors'];
    if (raw is! Map) return const {};
    return {for (final e in raw.entries) e.key as String: e.value.toString()};
  }
}

/// The server couldn't be reached at all (offline, down, blocked).
class NetworkFailure implements Exception {
  const NetworkFailure();
  @override
  String toString() => "Can't reach the server. Check your connection and try again.";
}

/// Talks to the Helidon server. The token goes in `Authorization: Bearer`. Everything is relative to [baseUrl],
/// which is empty in production (the page and the API share one origin behind Traefik).
class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = const String.fromEnvironment('API_BASE')}) : _http = client ?? http.Client();

  final http.Client _http;
  final String baseUrl;

  String? token;

  /// Called when a signed-in request comes back 401: the session ended (removed, password changed, expired).
  void Function()? onSessionEnded;

  Uri _uri(String path) => baseUrl.isEmpty ? Uri.base.resolve(path) : Uri.parse('$baseUrl$path');

  Future<ApiResponse> send(String method, String path, {Object? body, bool auth = true}) async {
    final request = http.Request(method, _uri(path));
    request.headers['Accept'] = 'application/json';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    if (auth && token != null) request.headers['Authorization'] = 'Bearer $token';

    http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request));
    } catch (_) {
      throw const NetworkFailure();
    }

    Map<String, dynamic>? json;
    if (response.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) json = decoded;
      } catch (_) {
        // not JSON (a proxy error page, say): leave it null
      }
    }
    if (response.statusCode == 401 && auth && token != null) onSessionEnded?.call();
    return ApiResponse(response.statusCode, json);
  }

  Future<ApiResponse> get(String path) => send('GET', path);
  Future<ApiResponse> post(String path, {Object? body, bool auth = true}) => send('POST', path, body: body, auth: auth);
  Future<ApiResponse> delete(String path) => send('DELETE', path);
}
