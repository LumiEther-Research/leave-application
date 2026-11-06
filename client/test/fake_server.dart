import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lumiether_client/api/api_client.dart';

/// A scripted stand-in for the Helidon server: routes are "METHOD /path" to a handler.
class FakeServer {
  final Map<String, http.Response Function(http.Request)> routes = {};
  final List<http.Request> requests = [];

  http.Response json(int status, Object body) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

  ApiClient client() => ApiClient(
        baseUrl: 'http://server',
        client: MockClient((request) async {
          requests.add(request);
          final handler = routes['${request.method} ${request.url.path}'];
          return handler == null ? http.Response('{"error":"no route"}', 404) : handler(request);
        }),
      );

  /// A server nobody can reach.
  ApiClient unreachable() => ApiClient(baseUrl: 'http://server', client: MockClient((request) async => throw http.ClientException('offline')));

  Map<String, dynamic> bodyOf(http.Request r) => jsonDecode(r.body) as Map<String, dynamic>;
}

Map<String, dynamic> userJson({String role = 'admin', String name = 'Boss', String email = 'boss@example.com', String id = 'u1'}) =>
    {'id': id, 'name': name, 'email': email, 'role': role};
