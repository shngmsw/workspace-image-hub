/**
 * One-line JSON logs on stdout. Cloud Logging parses `severity` and `message`; docker logs stay
 * greppable. No logger dependency.
 */

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface Logger {
  log(severity: Severity, message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export const jsonLogger: Logger = {
  log(severity, message, fields) {
    process.stdout.write(`${JSON.stringify({ severity, message, time: new Date().toISOString(), ...fields })}\n`);
  },
};
