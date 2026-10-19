/**
 * Gives the current time.
 * Code that needs the time gets a `Clock`, so that a test can supply a fixed time.
 */
export interface Clock {
  now(): Date;
}

/** The clock of the operating system. Use it only in the composition root. */
export const systemClock: Clock = {
  now: () => new Date(),
};
