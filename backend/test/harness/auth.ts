import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'kraveo_vit_bhopal_super_secret_jwt_key_2026';

export interface TokenPayload {
  id: string;
  phone: string;
  role: Role;
  /** tokenVersion claim; a missing claim counts as 0 (tokens issued before revocation existed). */
  tv?: number;
}

export const generateTestToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
};

export const getClientToken = (id: string = 'usr-1', phone: string = '+221 776543210'): string => {
  return generateTestToken({ id, phone, role: Role.CLIENT });
};

export const getVendorToken = (id: string = 'usr-3', phone: string = '+221 776543212'): string => {
  return generateTestToken({ id, phone, role: Role.VENDOR });
};

export const getDriverToken = (id: string = 'usr-4', phone: string = '+221 776543213'): string => {
  return generateTestToken({ id, phone, role: Role.DRIVER });
};

export const getAdminToken = (id: string = 'usr-5', phone: string = '+221 776543214'): string => {
  return generateTestToken({ id, phone, role: Role.ADMIN });
};

export const getAuthHeader = (token: string) => {
  return { Authorization: `Bearer ${token}` };
};
