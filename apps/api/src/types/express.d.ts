// Centralized ambient augmentation of Express's Request type.
//
// This is the standard, documented pattern for extending Express types
// (see https://blog.logrocket.com/extend-express-request-object-typescript
// and the Express + TypeScript community docs): augment the global
// `Express` namespace via `declare global`, in a dedicated .d.ts file that
// TypeScript always treats as ambient/global scope. Do NOT scatter
// `declare module 'express-serve-static-core'` blocks across multiple
// regular .ts files - cross-file merging of module augmentations declared
// that way is unreliable depending on which files the compiler visits and
// in what order, which is exactly the bug this file replaces.
import type { AuthenticatedUser } from '../common/guards/session-auth.guard';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      correlationId?: string;
    }
  }
}

export {};
