import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Light, dark or follow the system. Remembered per browser.
class ThemeController extends ChangeNotifier {
  static const _key = 'theme_mode';
  ThemeMode mode = ThemeMode.system;

  Future<void> load() async {
    try {
      final saved = (await SharedPreferences.getInstance()).getString(_key);
      mode = ThemeMode.values.firstWhere((m) => m.name == saved, orElse: () => ThemeMode.system);
      notifyListeners();
    } catch (_) {
      // storage blocked: stay on system
    }
  }

  Future<void> toggle(Brightness current) async {
    mode = current == Brightness.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
    try {
      await (await SharedPreferences.getInstance()).setString(_key, mode.name);
    } catch (_) {
      // not remembered
    }
  }
}
