import 'package:flutter/material.dart';

import '../state/session.dart';
import '../widgets/common.dart';

/// Any signed-in user, for their own password only.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, required this.session});

  final Session session;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  static const minLength = 8;
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  Map<String, String> _errors = const {};
  bool _pending = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    setState(() {
      _pending = true;
      _errors = const {};
    });
    Map<String, String> errors;
    try {
      errors = await widget.session.changePassword(current: _current.text, next: _next.text, confirm: _confirm.text);
    } catch (e) {
      errors = {'form': e.toString()};
    }
    if (!mounted) return;
    setState(() {
      _pending = false;
      _errors = errors;
    });
    if (errors.isEmpty) {
      _current.clear();
      _next.clear();
      _confirm.clear();
      showToast(context, 'Password changed', description: 'Other devices have been signed out.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 512),
        child: AppCard(
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const CardHeading(
                  title: 'Change password',
                  description: "Replace the temporary password your admin gave you. You'll stay signed in here; other devices are signed out.",
                ),
                const SizedBox(height: 24),
                if (_errors['form'] != null) ...[InlineAlert(message: _errors['form']!), const SizedBox(height: 20)],
                LabeledField(
                  label: 'Current password',
                  controller: _current,
                  obscure: true,
                  error: _errors['current'],
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 20),
                LabeledField(
                  label: 'New password',
                  controller: _next,
                  obscure: true,
                  hint: 'At least $minLength characters.',
                  error: _errors['next'],
                  autofillHints: const [AutofillHints.newPassword],
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 20),
                LabeledField(
                  label: 'Confirm new password',
                  controller: _confirm,
                  obscure: true,
                  error: _errors['confirm'],
                  autofillHints: const [AutofillHints.newPassword],
                  onSubmitted: _submit,
                ),
                const SizedBox(height: 24),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.icon(
                    onPressed: _pending ? null : _submit,
                    icon: const Icon(Icons.vpn_key_outlined, size: 18),
                    label: Text(_pending ? 'Saving…' : 'Change password'),
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
