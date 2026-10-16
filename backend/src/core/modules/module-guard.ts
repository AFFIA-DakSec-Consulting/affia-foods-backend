import { NextFunction, Request, Response } from 'express';
import { isEnabled } from './module-registry.service';
import { fail } from '../../utils/http';

/** Express guard: the route only answers while the module is effectively ON (403 MODULE_DISABLED otherwise). */
export const requireModule = (code: string) => async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await isEnabled(code))) return res.status(403).json({ success: false, code: 'MODULE_DISABLED', message: 'This feature is switched off right now.', module: code });
    return next();
  } catch (err) {
    return fail(res, err, 'module guard');
  }
};
