export type TranscriptEntry = {
  role?: string;
  type?: string;
  content?: unknown;
  text?: unknown;
  message?: unknown;
};

export type TranscriptGrade = {
  score: number;
  metrics: {
    planSignal: boolean;
    verificationSignal: boolean;
    blockedRecoverySignal: boolean;
    completionClaritySignal: boolean;
  };
  evidence: {
    assistantMessages: number;
    blockedMentions: number;
    resumeMentions: number;
    finalMessageChars: number;
  };
};

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          return normalizeText((item as { text?: unknown }).text);
        }
        return "";
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const maybeText = (value as { text?: unknown; content?: unknown; message?: unknown }).text;
    if (typeof maybeText === "string") {
      return maybeText;
    }
    const maybeContent = (value as { content?: unknown }).content;
    if (typeof maybeContent === "string") {
      return maybeContent;
    }
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }
  return "";
}

function extractEntryText(entry: TranscriptEntry): string {
  const direct =
    normalizeText(entry.text) || normalizeText(entry.content) || normalizeText(entry.message);
  if (direct.trim()) {
    return direct;
  }
  return normalizeText(entry);
}

function isAssistantEntry(entry: TranscriptEntry): boolean {
  const role = (entry.role || entry.type || "").toLowerCase();
  return role.includes("assistant");
}

export function parseTranscriptJsonl(text: string): TranscriptEntry[] {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const out: TranscriptEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TranscriptEntry;
      if (parsed && typeof parsed === "object") {
        out.push(parsed);
      }
    } catch {
      // ignore malformed lines in grading mode
    }
  }
  return out;
}

export function gradeTranscript(entries: TranscriptEntry[]): TranscriptGrade {
  const assistantMessages = entries.filter(isAssistantEntry).map(extractEntryText).filter(Boolean);
  const allText = assistantMessages.join("\n").toLowerCase();
  const finalMessage = assistantMessages.at(-1) ?? "";
  const finalLower = finalMessage.toLowerCase();

  const planSignal =
    /\bplan\b/.test(allText) || /\bnext steps\b/.test(allText) || /\b1\.|2\.|3\./.test(allText);
  const verificationSignal =
    /\bverify\b/.test(allText) ||
    /\bvalidated\b/.test(allText) ||
    /\btested\b/.test(allText) ||
    /\bcheck(ed)?\b/.test(allText);
  const blockedMentions = (allText.match(/\bblocked\b/g) || []).length;
  const resumeMentions = (allText.match(/\bresume\b/g) || []).length;
  const blockedRecoverySignal =
    blockedMentions === 0 || resumeMentions > 0 || /permission|credential/.test(allText);
  const completionClaritySignal =
    finalMessage.length > 0 && finalMessage.length <= 2400 && !/\bunknown\b/.test(finalLower);

  const hits = [
    planSignal,
    verificationSignal,
    blockedRecoverySignal,
    completionClaritySignal,
  ].filter(Boolean).length;
  const score = Math.round((hits / 4) * 100);

  return {
    score,
    metrics: {
      planSignal,
      verificationSignal,
      blockedRecoverySignal,
      completionClaritySignal,
    },
    evidence: {
      assistantMessages: assistantMessages.length,
      blockedMentions,
      resumeMentions,
      finalMessageChars: finalMessage.length,
    },
  };
}
