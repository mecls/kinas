/** Something the shell says: the reader's status line shows it, and the sidebar's foot while the panel is closed. */
export interface Notice {
  text: string;
  /** Makes a repeat of the same words a new notice. */
  seq: number;
}

/** How long a notice stays, wherever it is shown — one number, so the two places cannot drift apart. */
export const NOTICE_MS = 6000;
