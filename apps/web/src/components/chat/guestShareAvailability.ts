import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

/**
 * Whether this environment offers "Share with guest". Guests arrive through a T3 Connect tunnel,
 * and this privacy fork has no T3 Connect, so no environment offers it.
 */
export const canShareWithGuestAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(false).pipe(Atom.withLabel(`guest-share:available:${environmentId}`)),
);
