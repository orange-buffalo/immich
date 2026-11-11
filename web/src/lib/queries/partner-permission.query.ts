import { getBaseUrl } from '@immich/sdk';

/**
 * Fork-only, see FORK.md. These two routes are excluded from the OpenAPI document on purpose — so
 * that `packages/sdk` stays byte-identical to upstream — which is why they are called by hand
 * rather than through `@immich/sdk`.
 */
export type PartnerPermissions = {
  /** Users the current user has allowed to delete their assets. */
  grantedByMe: string[];
  /** Users whose assets the current user is allowed to delete. */
  grantedToMe: string[];
};

const request = async (path: string, init?: RequestInit): Promise<PartnerPermissions> => {
  const response = await fetch(`${getBaseUrl()}/partner-permissions${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    throw new Error(`Partner permissions request failed with status ${response.status}`);
  }

  const { grantedByMe, grantedToMe } = (await response.json()) as Partial<PartnerPermissions>;
  return { grantedByMe: grantedByMe ?? [], grantedToMe: grantedToMe ?? [] };
};

export const getPartnerPermissions = () => request('');

export const setPartnerDeletePermission = (userId: string, allowDelete: boolean) =>
  request(`/${userId}`, { method: 'PUT', body: JSON.stringify({ allowDelete }) });
