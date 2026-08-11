import type { IO } from "../src/io.ts";
import { parseKeys } from "../src/io.ts";

/** Scripted IO: answers are consumed in order, everything printed is kept. */
export class FakeIO implements IO {
  readonly colorEnabled = false;
  output = "";
  private readonly answers: string[];

  constructor(answers: string[]) {
    this.answers = [...answers];
  }

  write(text: string): void {
    this.output += text;
  }

  async question(prompt: string): Promise<string> {
    this.output += prompt;
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error(`Ran out of scripted answers at: ${prompt}`);
    return answer;
  }

  close(): void {}
}

/**
 * Scripted IO with raw key input: selects and confirms consume key chunks
 * (as a real terminal would deliver them), text prompts consume answers.
 */
export class KeyedFakeIO extends FakeIO {
  private readonly keyChunks: string[];

  constructor(answers: string[], keyChunks: string[]) {
    super(answers);
    this.keyChunks = [...keyChunks];
  }

  readKeys = async (): Promise<string[]> => {
    const chunk = this.keyChunks.shift();
    if (chunk === undefined) throw new Error("Ran out of scripted key chunks");
    return parseKeys(chunk);
  };
}
