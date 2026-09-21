export const ROLES = ['dispenser', 'manager', 'admin', 'md'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  dispenser: '/dispenser',
  manager: '/manager',
  admin: '/admin',
  md: '/md',
};

/**
 * Which route prefixes each role may open at all. Enforced in middleware and
 * again on the server for every page — and, for the data behind those pages,
 * a third time by RLS, which is the boundary that actually protects the money.
 */
const ROUTE_ACCESS: Record<Role, string[]> = {
  dispenser: ['/dispenser'],
  manager: ['/manager', '/stock', '/shift', '/refill', '/cash', '/dues', '/expenses', '/lubricants', '/reports'],
  admin: ['/admin', '/manager', '/stock', '/shift', '/refill', '/cash', '/dues', '/expenses', '/lubricants', '/reports', '/people', '/settings', '/audit'],
  md: ['/md', '/reports'],
};

export function canAccess(role: Role, pathname: string): boolean {
  return ROUTE_ACCESS[role].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** MD is read-only everywhere; nothing in the UI may offer it a mutating control. */
export function isReadOnly(role: Role): boolean {
  return role === 'md';
}

export function canSeeMoney(role: Role): boolean {
  return role !== 'dispenser';
}

export function canSeeProfit(role: Role): boolean {
  return role === 'admin' || role === 'md';
}

export function canWriteOps(role: Role): boolean {
  return role === 'manager' || role === 'admin';
}

export function canManageEquipment(role: Role): boolean {
  return role === 'admin';
}
