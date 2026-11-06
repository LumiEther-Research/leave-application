enum Role { admin, employee }

class User {
  const User({required this.id, required this.name, required this.email, required this.role});

  final String id;
  final String name;
  final String email;
  final Role role;

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        name: json['name'] as String,
        email: json['email'] as String,
        role: json['role'] == 'admin' ? Role.admin : Role.employee,
      );
}

class Admin {
  const Admin({required this.id, required this.name, required this.email});

  final String id;
  final String name;
  final String email;

  factory Admin.fromJson(Map<String, dynamic> json) =>
      Admin(id: json['id'] as String, name: json['name'] as String, email: json['email'] as String);
}

/// "Priya Sharma" is "PS"; one word is its first letter.
String initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  final first = parts.first.isEmpty ? '' : String.fromCharCode(parts.first.runes.first);
  final last = parts.length > 1 ? String.fromCharCode(parts.last.runes.first) : '';
  return (first + last).toUpperCase();
}

String plural(num n, String one, [String? many]) => '${_fmt(n)} ${n == 1 ? one : (many ?? '${one}s')}';

String _fmt(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();
