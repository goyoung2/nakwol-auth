export type ConnectRole = 'owner' | 'operator' | 'developer' | null;
export type NakwolMembershipRole = 'user' | 'member' | 'admin' | string | null | undefined;

function hasGlobalConnectControl(connectRole: ConnectRole, membershipRole: NakwolMembershipRole): boolean {
  return membershipRole === 'admin' || connectRole === 'owner' || connectRole === 'operator';
}

export function canUseCli(connectRole: ConnectRole, membershipRole: NakwolMembershipRole): boolean {
  return hasGlobalConnectControl(connectRole, membershipRole) || connectRole === 'developer';
}

export function canManageApplication(
  connectRole: ConnectRole,
  membershipRole: NakwolMembershipRole,
  userId: string,
  ownerUserId: string | null | undefined,
): boolean {
  if (hasGlobalConnectControl(connectRole, membershipRole)) return true;
  return connectRole === 'developer' && Boolean(ownerUserId) && ownerUserId === userId;
}

export function canManageDeveloperRoles(connectRole: ConnectRole, membershipRole: NakwolMembershipRole): boolean {
  return hasGlobalConnectControl(connectRole, membershipRole);
}
