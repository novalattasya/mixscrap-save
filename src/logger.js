import fs from "fs";
import path from "path";
import { createLogger, format, transports } from "winston";
import chalk from "chalk";

const { combine, timestamp, printf, splat } = format;

// ensure logs dir
const LOG_DIR = path.resolve("./logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// custom log symbols for better UX
const SYMBOLS = {
  info: "ℹ",
  warn: "⚠",
  error: "✖",
  debug: "◆",
  success: "✔",
  progress: "▶",
  separator: "━",
};

// colorize levels using chalk (compatible with chalk@5+)
function colorizeLevel(level, msg) {
  switch (level) {
    case "error":
      return chalk.bold.red(msg);
    case "warn":
      return chalk.yellowBright(msg);
    case "info":
      return chalk.blue(msg);
    case "success":
      return chalk.bold.green(msg);
    case "progress":
      return chalk.cyan(msg);
    case "debug":
      return chalk.magenta(msg);
    default:
      return msg;
  }
}

// pretty print format for console - user-friendly version
const prettyConsole = printf(({ level, message, timestamp, context, ...meta }) => {
  // Skip database operational logs in console (show only in file)
  if (context === "db-internal") {
    return null; // Return null to skip this log in console
  }

  const time = chalk.dim(new Date(timestamp).toLocaleTimeString());
  const symbol = SYMBOLS[level] || "•";
  const coloredSymbol = colorizeLevel(level, symbol);

  // message formatting
  let msgStr;
  if (typeof message === "object" && message !== null) {
    if (message.stack) {
      msgStr = message.message;
    } else {
      msgStr = JSON.stringify(message, null, 2);
    }
  } else {
    msgStr = String(message);
  }

  // Color the message based on level
  if (level === "success") {
    msgStr = chalk.green(msgStr);
  } else if (level === "progress") {
    msgStr = chalk.cyan(msgStr);
  } else if (level === "error") {
    msgStr = chalk.red(msgStr);
  } else if (level === "warn") {
    msgStr = chalk.yellow(msgStr);
  }

  // Handle meta/extra context
  const metaKeys = Object.keys(meta || {}).filter(
    (k) => k !== "stack" && k !== "message" && k !== "level" && k !== "timestamp" && k !== "context"
  );
  let metaStr = "";
  if (metaKeys.length > 0) {
    const cleanMeta = {};
    metaKeys.forEach(k => cleanMeta[k] = meta[k]);
    metaStr = chalk.dim(` ${JSON.stringify(cleanMeta)}`);
  }

  // Stack trace if available
  const stack = (message && message.stack) ? `\n${chalk.gray(message.stack)}` : "";

  return `${time} ${coloredSymbol} ${msgStr}${metaStr}${stack}`;
});

// Filter for console to skip db-internal logs
const consoleFilter = format((info) => {
  if (info.context === "db-internal") {
    return false; // Skip this log
  }
  return info;
});

// plain JSON format for file logs (structured)
const jsonFile = combine(timestamp(), splat(), format.json());

// create logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    // Console transport: pretty and filtered (no db-internal)
    new transports.Console({
      format: combine(
        timestamp(),
        splat(),
        consoleFilter(),
        prettyConsole
      ),
      handleExceptions: true,
    }),
    // File transport: all logs including db-internal (structured json)
    new transports.File({
      filename: path.join(LOG_DIR, "scraper.log"),
      format: jsonFile,
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
      tailable: true,
      handleExceptions: true,
    }),
  ],
  exitOnError: false,
});

// convenience wrappers with context support
export const info = (msg, context = null) => logger.info(formatMessage(msg), { context });
export const warn = (msg, context = null) => logger.warn(formatMessage(msg), { context });
export const error = (msg, context = null) => logger.error(formatMessage(msg), { context });
export const debug = (msg, context = null) => logger.debug(formatMessage(msg), { context });
export const success = (msg, context = null) => logger.log("info", formatMessage(msg), { context });
export const progress = (msg, context = null) => logger.log("info", formatMessage(msg), { context });

// Log internal database operations (hidden from console, shown in file only)
export const dbInternal = (msg) => logger.info(formatMessage(msg), { context: "db-internal" });

// helper to format messages
function formatMessage(msg) {
  if (!msg) return "";
  if (msg instanceof Error) {
    return { message: msg.message, stack: msg.stack };
  }
  if (typeof msg === "object") {
    return JSON.stringify(msg);
  }
  return String(msg);
}

export default logger;

