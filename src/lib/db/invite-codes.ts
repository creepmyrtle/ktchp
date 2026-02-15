import { sql } from '@vercel/postgres';
import crypto from 'crypto';
import type { InviteCode } from '@/types';

export async function createInviteCode(
  createdBy: string,
  expiresAt?: Date
): Promise<InviteCode> {
  const code = crypto.randomBytes(6).toString('hex'); // 12 char hex code
  const expiresAtStr = expiresAt ? expiresAt.toISOString() : null;
  const { rows } = await sql`
    INSERT INTO invite_codes (code, created_by, expires_at)
    VALUES (${code}, ${createdBy}, ${expiresAtStr})
    RETURNING *
  `;
  return rows[0] as InviteCode;
}

export async function getInviteCodeByCode(code: string): Promise<InviteCode | null> {
  const { rows } = await sql`SELECT * FROM invite_codes WHERE code = ${code}`;
  return (rows[0] as InviteCode) ?? null;
}

export async function redeemInviteCode(code: string, usedBy: string): Promise<boolean> {
  const invite = await getInviteCodeByCode(code);
  if (!invite) return false;
  if (invite.used_by) return false;
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return false;

  const { rowCount } = await sql`
    UPDATE invite_codes SET used_by = ${usedBy}, used_at = NOW()
    WHERE code = ${code} AND used_by IS NULL
  `;
  return (rowCount ?? 0) > 0;
}

export async function getInviteCodesByCreator(createdBy: string): Promise<InviteCode[]> {
  const { rows } = await sql`
    SELECT * FROM invite_codes WHERE created_by = ${createdBy} ORDER BY created_at DESC
  `;
  return rows as InviteCode[];
}

export async function getAllInviteCodes(): Promise<InviteCode[]> {
  const { rows } = await sql`SELECT * FROM invite_codes ORDER BY created_at DESC`;
  return rows as InviteCode[];
}

export async function deleteInviteCode(id: string): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM invite_codes WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
