import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

final partnerPermissionApiRepositoryProvider = Provider(
  // any generated Api exposes the shared, already-authenticated client
  (ref) => PartnerPermissionApiRepository(ref.watch(apiServiceProvider).partnersApi.apiClient),
);

/// Fork-only, see FORK.md. `/partner-permissions` is deliberately excluded from the OpenAPI
/// document so that `mobile/openapi` stays byte-identical to upstream and never conflicts on a
/// version bump, so the two routes are invoked through [ApiClient.invokeAPI] by hand instead of
/// through a generated api class.
class PartnerPermissionApiRepository {
  final ApiClient _apiClient;

  const PartnerPermissionApiRepository(this._apiClient);

  Future<PartnerPermissions> getAll() => _request('/partner-permissions', 'GET');

  Future<PartnerPermissions> setDeletePermission(String userId, {required bool allowDelete}) =>
      _request('/partner-permissions/$userId', 'PUT', body: {'allowDelete': allowDelete});

  Future<PartnerPermissions> _request(String path, String method, {Map<String, Object?>? body}) async {
    final response = await _apiClient.invokeAPI(
      path,
      method,
      const [],
      body == null ? null : jsonEncode(body),
      <String, String>{},
      <String, String>{},
      body == null ? null : 'application/json',
    );

    if (response.statusCode >= 400) {
      throw ApiException(response.statusCode, response.body);
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return PartnerPermissions(
      grantedByMe: _ids(decoded['grantedByMe']),
      grantedToMe: _ids(decoded['grantedToMe']),
    );
  }

  Set<String> _ids(Object? value) => value is List ? value.map((id) => id.toString()).toSet() : const {};
}

class PartnerPermissions {
  /// Users the current user has allowed to delete their assets.
  final Set<String> grantedByMe;

  /// Users whose assets the current user is allowed to delete.
  final Set<String> grantedToMe;

  const PartnerPermissions({this.grantedByMe = const {}, this.grantedToMe = const {}});
}
