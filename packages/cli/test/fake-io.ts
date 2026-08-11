import type { IO } from "../src/io.ts";

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
