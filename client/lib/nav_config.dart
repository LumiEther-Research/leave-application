import 'package:flutter/material.dart';

import 'api/models.dart';

/// One entry in the sidebar. `ready` is false until the screen exists, so nothing links to a dead end.
class NavItem {
  const NavItem(this.id, this.label, this.icon, {this.ready = true});

  final String id;
  final String label;
  final IconData icon;
  final bool ready;
}

class NavSection {
  const NavSection(this.label, this.items);

  final String label;
  final List<NavItem> items;
}

const navByRole = <Role, List<NavSection>>{
  Role.admin: [
    NavSection('Overview', [NavItem('dashboard', 'Dashboard', Icons.dashboard_outlined, ready: false)]),
    NavSection('Leave', [
      NavItem('permissions', 'Permissions', Icons.schedule_outlined, ready: false),
    ]),
    NavSection('Company', [
      NavItem('employees', 'Employees', Icons.group_outlined, ready: false),
      NavItem('admins', 'Admins', Icons.shield_outlined),
      NavItem('leave-policy', 'Leave policy', Icons.tune_outlined, ready: false),
    ]),
    NavSection('Payroll', [NavItem('payslips', 'Payslips', Icons.description_outlined, ready: false)]),
    NavSection('Account', [NavItem('password', 'Change password', Icons.vpn_key_outlined)]),
  ],
  Role.employee: [
    NavSection('Overview', [NavItem('dashboard', 'Dashboard', Icons.dashboard_outlined, ready: false)]),
    NavSection('Requests', [
      NavItem('leave', 'My leave', Icons.calendar_month_outlined, ready: false),
      NavItem('comp-off', 'Comp-off', Icons.event_available_outlined, ready: false),
      NavItem('permissions', 'Permissions', Icons.schedule_outlined, ready: false),
    ]),
    NavSection('Company', [NavItem('holidays', 'Holidays', Icons.flag_outlined, ready: false)]),
    NavSection('Payroll', [NavItem('payslips', 'Payslips', Icons.description_outlined, ready: false)]),
    NavSection('Account', [NavItem('password', 'Change password', Icons.vpn_key_outlined)]),
  ],
};

/// Only the screens that exist, with empty sections dropped.
List<NavSection> readySections(Role role) => [
      for (final s in navByRole[role]!)
        if (s.items.any((i) => i.ready)) NavSection(s.label, [for (final i in s.items) if (i.ready) i]),
    ];

NavItem firstReady(Role role) => readySections(role).first.items.first;

NavItem itemById(Role role, String id) =>
    readySections(role).expand((s) => s.items).firstWhere((i) => i.id == id, orElse: () => firstReady(role));

String roleLabel(Role role) => role == Role.admin ? 'Admin' : 'Employee';
