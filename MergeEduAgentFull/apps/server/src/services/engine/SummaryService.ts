import { SessionState } from "../../types/domain.js";

export class SummaryService {
  summarize(state: SessionState, recentN: number): string {
    const recent = state.messages.slice(-recentN);
    const lines = recent.map((msg) => `${msg.agent}: ${msg.contentMarkdown}`);
    return lines.join("\n").slice(0, 2000);
  }
}
