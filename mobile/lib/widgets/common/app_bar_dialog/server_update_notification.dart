import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/models/server_info/server_info.model.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:url_launcher/url_launcher_string.dart';

class ServerUpdateNotification extends HookConsumerWidget {
  const ServerUpdateNotification({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final serverInfoState = ref.watch(serverInfoProvider);

    const Color errorColor = Color.fromARGB(85, 253, 97, 83);
    final Color infoColor = context.isDarkTheme
        ? context.primaryColor.withAlpha(55)
        : context.primaryColor.withAlpha(25);
    // orange-buffalo fork: the Android app is side-loaded from our own server
    // rather than installed from the Play Store, so an "update available"
    // prompt must point at the APK bundled into the server image, not at
    // Google Play (which would install the upstream app). See FORK.md.
    String forkApkUrl() {
      final endpoint = Uri.parse(Store.get(StoreKey.serverEndpoint));
      final segments = endpoint.pathSegments.where((s) => s.isNotEmpty).toList();
      // serverEndpoint points at the API root; the APK is served from the web
      // root next to it. Keeping the remaining segments supports sub-path
      // deployments.
      if (segments.isNotEmpty && segments.last == 'api') {
        segments.removeLast();
      }
      return endpoint.replace(pathSegments: [...segments, kForkApkFileName], query: null, fragment: null).toString();
    }

    Future<void> openUpdateLink() {
      String url;
      if (serverInfoState.versionStatus == VersionStatus.serverOutOfDate) {
        url = kImmichLatestRelease;
      } else {
        if (Platform.isIOS) {
          url = kImmichAppStoreLink;
        } else if (Platform.isAndroid) {
          url = forkApkUrl();
        } else {
          // Fallback to latest release for other/unknown platforms
          url = kImmichLatestRelease;
        }
      }

      return launchUrlString(url, mode: LaunchMode.externalApplication);
    }

    return SizedBox(
      width: double.infinity,
      child: Container(
        decoration: BoxDecoration(
          color: serverInfoState.versionStatus == VersionStatus.error ? errorColor : infoColor,
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          border: Border.all(
            color: serverInfoState.versionStatus == VersionStatus.error
                ? errorColor
                : context.primaryColor.withAlpha(50),
            width: 0.75,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: Text(
                serverInfoState.versionStatus.message,
                textAlign: TextAlign.start,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.labelLarge,
              ),
            ),
            if (serverInfoState.versionStatus == VersionStatus.serverOutOfDate ||
                serverInfoState.versionStatus == VersionStatus.clientOutOfDate) ...[
              const SizedBox(width: 8),
              TextButton(
                onPressed: () => unawaited(openUpdateLink()),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.all(4),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: serverInfoState.versionStatus == VersionStatus.clientOutOfDate
                    ? Text(context.t.action_common_update)
                    : Text(context.t.view),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
