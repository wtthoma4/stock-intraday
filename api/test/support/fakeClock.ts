import type { Clock } from '../../src/core/clock.js';

/** A clock that a test controls. The time changes only when the test calls `advance`. */
export class FakeClock implements Clock {
  private time: number;

  constructor(start: Date) {
    this.time = start.getTime();
  }

  now(): Date {
    return new Date(this.time);
  }

  /** Moves the time forward by a number of milliseconds. */
  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}
