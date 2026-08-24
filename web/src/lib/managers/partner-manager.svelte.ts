import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { getPartnerPermissions, type PartnerPermissions } from '$lib/services/partner-permission.service';

/**
 * Fork-only, see FORK.md. Tracks which partners may delete whose assets. Partner sharing itself is
 * upstream; the delete grant is a fork addition that has to be opted into per partner.
 */
class PartnerManager {
  #grantedByMe = $state<string[]>([]);
  #grantedToMe = $state<string[]>([]);
  #grantedByMeIds = $derived(new Set(this.#grantedByMe));
  #grantedToMeIds = $derived(new Set(this.#grantedToMe));
  #inFlight?: Promise<void>;

  constructor() {
    eventManager.on({
      AuthUserLoaded: () => void this.refresh(),
      AuthLogout: () => this.reset(),
    });
  }

  async init() {
    await this.refresh();
  }

  async refresh() {
    this.#inFlight ??= this.#load().finally(() => {
      this.#inFlight = undefined;
    });

    return this.#inFlight;
  }

  setPermissions({ grantedByMe, grantedToMe }: PartnerPermissions) {
    this.#grantedByMe = grantedByMe;
    this.#grantedToMe = grantedToMe;
  }

  reset() {
    this.setPermissions({ grantedByMe: [], grantedToMe: [] });
  }

  /** Whether the current user lets `userId` delete their assets. */
  hasGrantedDeleteTo(userId: string) {
    return this.#grantedByMeIds.has(userId);
  }

  /**
   * Assets shared by a partner can be trashed and restored by the recipient, the same way they
   * manage their own assets — but only once the partner has granted it.
   */
  canDelete({ ownerId }: { ownerId: string }) {
    return this.canPermanentlyDelete({ ownerId }) || (authManager.authenticated && this.#grantedToMeIds.has(ownerId));
  }

  /**
   * Permanently deleting bypasses the owner's trash, so unlike trashing it is never shared with
   * partners.
   */
  canPermanentlyDelete({ ownerId }: { ownerId: string }) {
    return authManager.authenticated && ownerId === authManager.user.id;
  }

  async #load() {
    if (!authManager.authenticated) {
      this.reset();
      return;
    }

    this.setPermissions(await getPartnerPermissions().catch(() => ({ grantedByMe: [], grantedToMe: [] })));
  }
}

export const partnerManager = new PartnerManager();
