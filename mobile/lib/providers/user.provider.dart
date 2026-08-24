import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart';
import 'package:immich_mobile/repositories/partner_permission_api.repository.dart';

class CurrentUserProvider extends StateNotifier<UserDto?> {
  CurrentUserProvider(this._userService) : super(null) {
    state = _userService.tryGetMyUser();
    streamSub = _userService.watchMyUser().listen((user) => state = user ?? state);
  }

  final UserService _userService;
  late final StreamSubscription<UserDto?> streamSub;

  refresh() async {
    try {
      await _userService.refreshMyUser();
    } catch (_) {}
  }

  @override
  void dispose() {
    streamSub.cancel();
    super.dispose();
  }
}

final currentUserProvider = StateNotifierProvider<CurrentUserProvider, UserDto?>((ref) {
  return CurrentUserProvider(ref.watch(userServiceProvider));
});

/// Fork-only, see FORK.md. Per-partner delete grants, fetched from the fork-only
/// `/partner-permissions` endpoint.
final partnerPermissionsProvider = FutureProvider<PartnerPermissions>((ref) async {
  final userId = ref.watch(currentUserProvider)?.id;
  if (userId == null) {
    return const PartnerPermissions();
  }

  return ref.watch(partnerPermissionApiRepositoryProvider).getAll();
});

/// Ids of the users whose assets the current user is allowed to trash: themselves, plus any
/// partner that granted them delete permission.
final deletableOwnerIdsProvider = Provider<Set<String>>((ref) {
  final userId = ref.watch(currentUserProvider)?.id;
  if (userId == null) {
    return const <String>{};
  }

  return {userId, ...?ref.watch(partnerPermissionsProvider).valueOrNull?.grantedToMe};
});
