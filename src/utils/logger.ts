export interface Logger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

export function createLogger(verbose = false): Logger {
  return {
    info: (...args: any[]) => console.log("[SeedSmith]", ...args),
    warn: (...args: any[]) => console.warn("[SeedSmith]", ...args),
    error: (...args: any[]) => console.error("[SeedSmith]", ...args),
    debug: (...args: any[]) => {
      if (verbose) console.debug("[SeedSmith:debug]", ...args);
    },
  };
}
