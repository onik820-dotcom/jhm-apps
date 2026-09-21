import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/roles';

/**
 * Who can sign in, and who has been asked to.
 *
 * Both reads are admin-only and say so twice: list_people() refuses anyone
 * else outright, and the invitations table has a select policy that names
 * is_admin(). The page checks the role as well, which makes three — the page
 * check is for a clear redirect, the other two are the ones that matter.
 */

export interface Person {
  id: string;
  fullName: string;
  fullNameBn: string | null;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

interface PersonRow {
  id: string;
  full_name: string;
  full_name_bn: string | null;
  email: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  full_name: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export async function getPeople(): Promise<Person[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_people');
  if (error) return [];

  return ((data ?? []) as PersonRow[]).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    fullNameBn: row.full_name_bn,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  }));
}

export async function getInvitations(): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_invitations')
    .select('id, email, role, full_name, status, expires_at, created_at, accepted_at, revoked_at, revoke_reason')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return [];

  return ((data ?? []) as InvitationRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
  }));
}
