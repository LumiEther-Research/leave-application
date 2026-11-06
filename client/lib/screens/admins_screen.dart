import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../theme/app_colors.dart';
import '../widgets/common.dart';
import '../widgets/runner_loader.dart';

/// Every admin is equal. You can remove anyone but yourself.
class AdminsScreen extends StatefulWidget {
  const AdminsScreen({super.key, required this.api, required this.currentUserId});

  final ApiClient api;
  final String currentUserId;

  @override
  State<AdminsScreen> createState() => _AdminsScreenState();
}

class _AdminsScreenState extends State<AdminsScreen> {
  List<Admin>? _admins;
  String? _loadError;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final r = await widget.api.get('/api/admin/admins');
      if (!mounted) return;
      if (r.ok) {
        setState(() {
          _admins = [for (final a in (r.json!['admins'] as List)) Admin.fromJson(a as Map<String, dynamic>)];
          _loading = false;
        });
      } else {
        setState(() {
          _loadError = r.error ?? "Couldn't load the admins.";
          _loading = false;
        });
      }
    } on NetworkFailure catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _admins == null) return const RunnerLoader();
    if (_loadError != null && _admins == null) return InlineAlert(message: _loadError!, onRetry: _load);

    final list = _AdminListCard(admins: _admins!, currentUserId: widget.currentUserId, api: widget.api, onChanged: _load);
    final form = _AddAdminCard(api: widget.api, onCreated: _load);
    return LayoutBuilder(
      builder: (context, box) {
        if (box.maxWidth >= 1100) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Expanded(flex: 2, child: list), const SizedBox(width: 24), Expanded(child: form)],
          );
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [list, const SizedBox(height: 24), form]);
      },
    );
  }
}

class _AdminListCard extends StatelessWidget {
  const _AdminListCard({required this.admins, required this.currentUserId, required this.api, required this.onChanged});

  final List<Admin> admins;
  final String currentUserId;
  final ApiClient api;
  final VoidCallback onChanged;

  Future<void> _remove(BuildContext context, Admin admin) async {
    final c = context.colors;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${admin.name} as admin?'),
        content: Text('${admin.email} will be signed out straight away and lose all admin access.'),
        actions: [
          OutlinedButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep admin')),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(backgroundColor: c.destructive),
            child: const Text('Remove admin'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      final r = await api.delete('/api/admin/admins/${admin.id}');
      if (!context.mounted) return;
      if (r.ok) {
        showToast(context, '${admin.name} is no longer an admin', description: admin.email);
      } else {
        showToast(context, r.error ?? "Couldn't remove that admin.", error: true);
      }
    } on NetworkFailure catch (e) {
      if (context.mounted) showToast(context, e.toString(), error: true);
    }
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = Theme.of(context).textTheme;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CardHeading(
            title: 'Admins',
            description: '${plural(admins.length, 'admin')}. Every admin can approve requests and manage employees and other admins.',
          ),
          const SizedBox(height: 16),
          for (var i = 0; i < admins.length; i++) ...[
            if (i > 0) const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  UserAvatar(name: admins[i].name),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(admins[i].name, style: t.labelLarge, overflow: TextOverflow.ellipsis),
                        Text(admins[i].email, style: t.bodySmall, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  if (admins[i].id == currentUserId)
                    const PillBadge('You')
                  else
                    OutlinedButton.icon(
                      onPressed: () => _remove(context, admins[i]),
                      style: OutlinedButton.styleFrom(foregroundColor: c.rejected),
                      icon: const Icon(Icons.person_remove_outlined, size: 18),
                      label: const Text('Remove'),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AddAdminCard extends StatefulWidget {
  const _AddAdminCard({required this.api, required this.onCreated});

  final ApiClient api;
  final VoidCallback onCreated;

  @override
  State<_AddAdminCard> createState() => _AddAdminCardState();
}

class _AddAdminCardState extends State<_AddAdminCard> {
  static const minLength = 8;
  final _email = TextEditingController();
  final _password = TextEditingController();
  Map<String, String> _errors = const {};
  String? _formError;
  bool _pending = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    setState(() {
      _pending = true;
      _errors = const {};
      _formError = null;
    });
    try {
      final r = await widget.api.post('/api/admin/admins', body: {'email': _email.text, 'password': _password.text});
      if (!mounted) return;
      if (r.ok) {
        final created = r.json!['created'] as Map<String, dynamic>;
        _email.clear();
        _password.clear();
        setState(() => _pending = false);
        showToast(context, '${created['name']} is now an admin', description: created['email'] as String);
        widget.onCreated();
      } else {
        setState(() {
          _pending = false;
          _errors = r.fieldErrors;
          _formError = r.fieldErrors.isEmpty ? (r.error ?? "Couldn't add the admin. Please try again.") : null;
        });
      }
    } on NetworkFailure catch (e) {
      if (!mounted) return;
      setState(() {
        _pending = false;
        _formError = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const CardHeading(title: 'Add an admin', description: 'They get the same access as you, including adding more admins.'),
            const SizedBox(height: 24),
            if (_formError != null) ...[InlineAlert(message: _formError!), const SizedBox(height: 20)],
            LabeledField(
              label: 'Email address',
              controller: _email,
              placeholder: 'name@company.com',
              error: _errors['email'],
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 20),
            LabeledField(
              label: 'Temporary password',
              controller: _password,
              hint: 'At least $minLength characters. Share it with them directly; they can change it after signing in.',
              error: _errors['password'],
              onSubmitted: _submit,
            ),
            const SizedBox(height: 24),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                onPressed: _pending ? null : _submit,
                icon: const Icon(Icons.admin_panel_settings_outlined, size: 18),
                label: Text(_pending ? 'Adding…' : 'Add admin'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
