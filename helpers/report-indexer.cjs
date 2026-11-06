"use strict";
// report-indexer reads what one shared Mocha run left in --in and writes a
// bounded failure message (or an empty passing result) for each selected test,
// at <out>/<file position>/<key position> in selection.json, whose entries are
// {file, keys, statics, only}: the selected keys, "*" for the tests the source
// does not name, every title the source names, and whether the file calls
// .only. Unless --only-allowed is false (forbidOnly), a .only in any file of a
// run lets the selected tests it leaves out pass, as Mocha does.
//
// --mode shared: the project's one run: report.json, stdout.log, stderr.log.
//   When Mocha stopped while loading the files (no report, an exit that is not
//   a timeout or a missing mocha), it also writes <out>/aborted, and the module
//   runs each file alone.
// --mode each: those, plus each/<position>.json, .log and .code, from running
//   each selected file alone after an aborted shared run.
//
// It runs in the module's own pinned image, with no dependency.

const fs = require("node:fs");
const path = require("node:path");

const diagnosticLimit = 32 << 10;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || i + 1 >= argv.length) {
      throw new Error("usage: report-indexer --name value ...");
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const name of ["mode", "in", "exit-code", "header", "prefix", "out", "only-allowed"]) {
    if (args[name] === undefined) throw new Error("missing --" + name);
  }
  return args;
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readReport(file) {
  const text = read(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The end of a diagnostic, so a result stays small whatever was logged.
function tail(text, limit = diagnosticLimit) {
  if (text.length <= limit) return text;
  return "[earlier output omitted; showing diagnostic tail]\n" + text.slice(text.length - limit);
}

function joinOutput(...parts) {
  return tail(
    parts
      .map((s) => (s || "").trim())
      .filter((s) => s !== "")
      .join("\n"),
  );
}

function describe(entry) {
  const err = entry.err || {};
  const detail = err.stack || err.message || JSON.stringify(err);
  return tail((entry.fullTitle || entry.title || "(untitled)") + ":\n" + String(detail).trim());
}

function describeAll(entries) {
  return tail(entries.map(describe).join("\n\n"), 2 * diagnosticLimit);
}

function bounded(failure) {
  if (failure.length > 3 * diagnosticLimit) {
    return failure.slice(0, 3 * diagnosticLimit) + "\n[remaining diagnostics omitted]\n";
  }
  return failure;
}

const unnamedKey = "*";

// A hook's own title, as Mocha reports it: "before all" hook, with " for
// <test>" or " in <suite>" after it.
const hookTitle = /^"(?:before|after) (?:all|each)" hook/;

// A run's tests and failures, grouped by project-relative file.
function group(report, prefix) {
  const relative = (file) => {
    if (typeof file !== "string" || file === "") return null;
    return file.startsWith(prefix) ? file.slice(prefix.length) : file;
  };
  const failures = new Map();
  const observed = new Map();
  const all = report.failures || [];
  for (const entry of all) {
    const file = relative(entry.file);
    if (!failures.has(file)) failures.set(file, []);
    failures.get(file).push(entry);
  }
  for (const list of [report.tests, report.passes, report.pending]) {
    for (const entry of list || []) {
      const file = relative(entry.file);
      if (!observed.has(file)) observed.set(file, new Set());
      observed.get(file).add(entry.fullTitle);
    }
  }
  return { failures, observed, failureCount: all.length };
}

// The full title of the suite a hook belongs to: its full title minus its
// own title.
function hookSuite(entry) {
  const full = entry.fullTitle || "";
  const own = entry.title || "";
  return full.endsWith(own) ? full.slice(0, full.length - own.length).trim() : "";
}

// The results of one file's selected keys, from a run that reported. roots
// are failures outside any suite of a test file, from a file run alone, which
// belong to every key of it.
function fileResults(sel, failures, observed, exitCode, output, roots, only) {
  const statics = new Set(sel.statics);
  const keys = sel.keys;
  const named = keys.filter((k) => k !== unnamedKey);
  const selected = new Set(named);
  const rest = keys.includes(unnamedKey);
  const blame = new Map(keys.map((k) => [k, []]));
  const add = (targets, entry) => targets.forEach((k) => blame.get(k).push(entry));
  let namedFailure = false;
  for (const entry of failures) {
    if (hookTitle.test(entry.title || "")) {
      // A hook fails the selected tests under its suite, and the unnamed
      // ones, which may be under it too. One under no selected test fails
      // them all.
      const suite = hookSuite(entry);
      const under = named.filter((k) => suite === "" || k.startsWith(suite + " "));
      const targets = rest ? [...under, unnamedKey] : under;
      add(targets.length > 0 ? targets : keys, entry);
    } else if (statics.has(entry.fullTitle)) {
      // A named test that is not selected only ran because one --grep
      // serves every file of the run; it is no check's.
      if (selected.has(entry.fullTitle)) {
        add([entry.fullTitle], entry);
        namedFailure = true;
      }
    } else {
      // A test the source does not name.
      add(rest ? [unnamedKey] : keys, entry);
    }
  }
  roots.forEach((entry) => add(keys, entry));
  return keys.map((key) => {
    const own = blame.get(key);
    if (own.length > 0) {
      const what = key === unnamedKey ? "unnamed tests of " + sel.file : key;
      return what + " failed\n" + describeAll(own);
    }
    if (key === unnamedKey || observed.has(key) || namedFailure || only) {
      // The unnamed key passes with no test observed: there may be none.
      // A test left without a result after a selected test of its file
      // failed (--bail) is not blamed, nor one a .only in the run left out,
      // which Mocha passes too.
      return "";
    }
    return (
      key +
      " did not run: Mocha ran " +
      sel.file +
      " without it (mocha exit " +
      exitCode +
      ")\n" +
      output
    );
  });
}

function shared(args, selections, exitCode) {
  const report = readReport(path.join(args.in, "report.json"));
  const output = joinOutput(read(path.join(args.in, "stdout.log")), read(path.join(args.in, "stderr.log")));
  const results = new Map();
  let global = "";
  let aborted = false;
  if (report === null) {
    // 124 is the timeout, 127 a missing mocha: running each file alone would
    // only repeat them. Any other exit without a report stopped the loading.
    aborted = exitCode !== 0 && exitCode !== 124 && exitCode !== 127;
    global = (exitCode === 0 ? "mocha exited 0 without writing its report" : args.header) + "\n" + output;
  } else {
    const run = group(report, args.prefix);
    const selected = new Set(selections.map((s) => s.file));
    const only = args["only-allowed"] === "true" && selections.some((s) => s.only);
    const outside = [...run.failures.keys()].filter((file) => !selected.has(file));
    if (outside.length > 0) {
      global =
        "failures in test files without selected test checks: " +
        outside.map((file) => file || "(no test file)").sort().join(", ") +
        "\n" +
        describeAll(outside.flatMap((file) => run.failures.get(file))) +
        "\n" +
        output;
    } else if (exitCode !== 0 && run.failureCount === 0) {
      // A timeout after the tests finished, or a crash after the report.
      global = args.header + "\n" + output;
    } else {
      selections.forEach((sel, i) => {
        const found = fileResults(
          sel,
          run.failures.get(sel.file) || [],
          run.observed.get(sel.file) || new Set(),
          exitCode,
          output,
          [],
          only,
        );
        found.forEach((failure, j) => results.set(i + "/" + j, failure));
      });
    }
  }
  if (global !== "") {
    selections.forEach((sel, i) => sel.keys.forEach((_, j) => results.set(i + "/" + j, global)));
  }
  return { results, aborted };
}

function each(args, selections, exitCode) {
  const sharedOutput = joinOutput(read(path.join(args.in, "stdout.log")), read(path.join(args.in, "stderr.log")));
  const results = new Map();
  const unloadable = [];
  selections.forEach((sel, i) => {
    const base = path.join(args.in, "each", String(i));
    const code = Number.parseInt((read(base + ".code") || "").trim(), 10);
    const output = tail((read(base + ".log") || "").trim());
    const report = readReport(base + ".json");
    const set = (failures) => failures.forEach((failure, j) => results.set(i + "/" + j, failure));
    if (report === null) {
      unloadable.push(sel.file);
      const failure = sel.file + " failed on its own, before running a test (mocha exit " + code + ")\n" + output;
      set(sel.keys.map(() => failure));
      return;
    }
    const run = group(report, args.prefix);
    // Alone, a failure outside the file (a root hook) is still this file's.
    const roots = [...run.failures.entries()].filter(([file]) => file !== sel.file).flatMap(([, list]) => list);
    if (roots.length === 0 && code !== 0 && run.failureCount === 0) {
      const failure = sel.file + ": mocha failed on its own (exit " + code + ")\n" + output;
      set(sel.keys.map(() => failure));
      return;
    }
    set(
      fileResults(
        sel,
        run.failures.get(sel.file) || [],
        run.observed.get(sel.file) || new Set(),
        code,
        output,
        roots,
        args["only-allowed"] === "true" && sel.only,
      ),
    );
  });
  // The shared run stopped for a file that also fails alone and that its
  // output names: that file owns the stop. Otherwise the cause is outside the
  // selected files, and every check sharing the run fails.
  const named = unloadable.some((file) => sharedOutput.includes(args.prefix + file));
  if (!named) {
    const global =
      args.header +
      ", loading test files before running any; " +
      (unloadable.length === 0 ? "each selected file loads on its own" : "the cause is not a selected file") +
      "\n" +
      sharedOutput;
    selections.forEach((sel, i) => sel.keys.forEach((_, j) => results.set(i + "/" + j, global)));
  }
  return { results, aborted: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const selections = JSON.parse(fs.readFileSync(path.join(args.in, "selection.json"), "utf8"));
  for (const s of selections) {
    if (typeof s.file !== "string" || s.file === "" || !Array.isArray(s.keys) || !Array.isArray(s.statics)) {
      throw new Error("invalid selection " + JSON.stringify(s));
    }
  }
  if (new Set(selections.map((s) => s.file)).size !== selections.length) {
    throw new Error("duplicate selected file");
  }
  const exitCode = Number.parseInt(args["exit-code"], 10);
  const { results, aborted } =
    args.mode === "each" ? each(args, selections, exitCode) : shared(args, selections, exitCode);
  for (const [key, failure] of results) {
    const file = path.join(args.out, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bounded(failure));
  }
  fs.mkdirSync(args.out, { recursive: true });
  if (aborted) fs.writeFileSync(path.join(args.out, "aborted"), "");
}

main();
