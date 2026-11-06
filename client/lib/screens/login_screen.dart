import 'package:flutter/material.dart';

import '../state/session.dart';
import '../theme/app_colors.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});

  final Session session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
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
      _error = null;
    });
    final error = await widget.session.login(_email.text, _password.text);
    if (!mounted) return;
    // On success the session changes and this screen is replaced; on failure the typed email stays.
    setState(() {
      _pending = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final message = _error ?? widget.session.notice;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 48),
            child: FadeRise(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Brand(height: 56),
                  const SizedBox(height: 32),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 384),
                    child: AppCard(
                      child: AutofillGroup(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('Sign in', style: t.titleMedium?.copyWith(fontSize: 18)),
                            const SizedBox(height: 4),
                            Text('Use the email and password your admin gave you.', style: t.bodyMedium?.copyWith(color: context.colors.mutedForeground)),
                            const SizedBox(height: 24),
                            if (message != null) ...[
                              InlineAlert(message: message, tone: _error != null ? AlertTone.error : AlertTone.info),
                              const SizedBox(height: 16),
                            ],
                            LabeledField(
                              label: 'Email',
                              controller: _email,
                              autofocus: true,
                              keyboardType: TextInputType.emailAddress,
                              autofillHints: const [AutofillHints.username],
                              textInputAction: TextInputAction.next,
                              enabled: !_pending,
                            ),
                            const SizedBox(height: 16),
                            LabeledField(
                              label: 'Password',
                              controller: _password,
                              obscure: true,
                              autofillHints: const [AutofillHints.password],
                              onSubmitted: _submit,
                              enabled: !_pending,
                            ),
                            const SizedBox(height: 24),
                            FilledButton.icon(
                              onPressed: _pending ? null : _submit,
                              style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                              icon: const Icon(Icons.login, size: 18),
                              label: Text(_pending ? 'Signing in…' : 'Sign in'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
