// Messages between the Gmail content script and the background worker.

export type Message =
  | { type: "compose-state"; to: string[] }
  | { type: "prepare-send"; to: string[]; subject: string; sentAt: string; trackingOn: boolean }
  | { type: "record-send"; record: SendRecord }
  | { type: "self-views"; tokens: string[]; ts: string }
  | { type: "get-config" }
  | { type: "start-split"; to: string[]; subject: string; bodyText: string } // replies "all" | "partial" | "none"
  | { type: "sent-chips" }
  | { type: "sync-now" }
  | { type: "gmail-connect" };

/** Whether a compose window would be tracked, and why not. */
export interface ComposeState {
  track: boolean;
  reason: "on" | "never-track" | "not-set-up";
}

export type PrepareSendResult =
  | { ok: true; token: string; pixelUrl: string; seedTest: boolean; groupId?: string }
  | { ok: false; reason: "off" | "never-track" | "not-set-up" | "tracker-unreachable"; seedTest: boolean };

export interface SendRecord {
  token: string | null;
  to: string[];
  subject: string;
  sentAt: string;
  seedTest: boolean;
  groupId?: string;
}

export interface ContentConfig {
  trackerHost: string;
}

/** Background → extension pages: local data changed, so re-render. */
export interface DataChanged {
  type: "data-changed";
}

export function send<T>(message: Message): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
