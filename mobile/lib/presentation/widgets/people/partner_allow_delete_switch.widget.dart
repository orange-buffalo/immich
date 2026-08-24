import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/partner_permission_api.repository.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

/// Fork-only, see FORK.md. Lets the sharing user decide whether a partner may move their assets to
/// the trash. Off by default, so partner sharing stays read-only until it is granted.
///
/// Deliberately built from a [Row] rather than a `SwitchListTile`, so that it does not add a
/// [ListTile] to the partner list that upstream's widget tests count.
class PartnerAllowDeleteSwitch extends ConsumerWidget {
  const PartnerAllowDeleteSwitch({super.key, required this.partner});

  final Partner partner;

  void _onChanged(BuildContext context, WidgetRef ref, bool allowDelete) async {
    try {
      await ref.read(partnerPermissionApiRepositoryProvider).setDeletePermission(partner.id, allowDelete: allowDelete);
      ref.invalidate(partnerPermissionsProvider);
    } catch (_) {
      if (context.mounted) {
        ImmichToast.show(context: context, msg: context.t.scaffold_body_error_occurred, toastType: ToastType.error);
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final permissions = ref.watch(partnerPermissionsProvider);
    final allowDelete = permissions.valueOrNull?.grantedByMe.contains(partner.id) ?? false;

    return Padding(
      padding: const EdgeInsets.only(left: 72, right: 16, bottom: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(context.t.partner_can_delete_assets(partner: partner.name), style: context.textTheme.bodyMedium),
                Text(
                  context.t.partner_can_delete_assets_description(partner: partner.name),
                  style: context.textTheme.bodySmall,
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: allowDelete,
            onChanged: permissions.isLoading ? null : (value) => _onChanged(context, ref, value),
          ),
        ],
      ),
    );
  }
}
