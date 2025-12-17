"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
function createLogger(verbose = false) {
    return {
        info: (...args) => console.log("[SeedSmith]", ...args),
        warn: (...args) => console.warn("[SeedSmith]", ...args),
        error: (...args) => console.error("[SeedSmith]", ...args),
        debug: (...args) => {
            if (verbose)
                console.debug("[SeedSmith:debug]", ...args);
        },
    };
}
