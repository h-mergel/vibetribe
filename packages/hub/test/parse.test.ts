import { describe, expect, it } from "vitest";
import {
  filetimeToMs,
  linuxStartTime,
  parseSessionFile,
  pidFromFileName,
} from "../src/sessions/parse";

const desktopFile = {
  pid: 773707,
  sessionId: "57cb6ddb-b7f4-4c91-b5f8-feaf89bb5e45",
  cwd: "/tmp/vt-probe",
  startedAt: 1_791_647_000_000,
  procStart: "2713903",
  status: "waiting",
  waitingFor: "permission prompt",
  entrypoint: "claude-desktop",
  name: "Test session",
  hostSessionId: "local_7b1f1a36",
  version: "2.1.295",
  kind: "interactive",
};

const STAT_TAIL = "S 4252 773707 4252 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 12 0 2713903 1000 200";

describe("parseSessionFile", () => {
  it("maps the fields VibeTribe uses", () => {
    expect(parseSessionFile(JSON.stringify(desktopFile))).toEqual({
      info: {
        sessionId: "57cb6ddb-b7f4-4c91-b5f8-feaf89bb5e45",
        pid: 773707,
        cwd: "/tmp/vt-probe",
        entrypoint: "claude-desktop",
        name: "Test session",
        hostSessionId: "local_7b1f1a36",
        bridgeSessionId: null,
        status: "waiting",
        waitingFor: "permission prompt",
      },
      procStart: "2713903",
    });
  });

  it("maps bridgeSessionId, name, entrypoint and hostSessionId", () => {
    const f = parseSessionFile(JSON.stringify({ ...desktopFile, bridgeSessionId: "session_01X" }));
    expect(f?.info.bridgeSessionId).toBe("session_01X");
    expect(f?.info.name).toBe("Test session");
    expect(f?.info.entrypoint).toBe("claude-desktop");
    expect(f?.info.hostSessionId).toBe("local_7b1f1a36");
  });

  it("turns empty strings into null", () => {
    const f = parseSessionFile(
      JSON.stringify({
        ...desktopFile,
        bridgeSessionId: "",
        name: "",
        entrypoint: "",
        hostSessionId: "",
      }),
    );
    expect(f?.info.bridgeSessionId).toBeNull();
    expect(f?.info.name).toBeNull();
    expect(f?.info.entrypoint).toBeNull();
    expect(f?.info.hostSessionId).toBeNull();
  });

  it("maps a non-string cwd to an empty string", () => {
    expect(parseSessionFile(JSON.stringify({ ...desktopFile, cwd: 42 }))?.info.cwd).toBe("");
  });

  it("returns null for an empty sessionId", () => {
    expect(parseSessionFile(JSON.stringify({ ...desktopFile, sessionId: "" }))).toBeNull();
  });

  it("accepts numeric procStart and unknown status as null", () => {
    const f = parseSessionFile(JSON.stringify({ ...desktopFile, procStart: 42, status: "weird" }));
    expect(f?.procStart).toBe("42");
    expect(f?.info.status).toBeNull();
  });

  it.each([
    ["empty string", ""],
    ["boolean", true],
    ["object", {}],
    ["exponent form", 1e21],
    ["number above MAX_SAFE_INTEGER", 2 ** 53],
    ["non-digit string", "12ab"],
  ])("rejects procStart: %s", (_n, procStart) => {
    expect(parseSessionFile(JSON.stringify({ ...desktopFile, procStart }))?.procStart).toBeNull();
  });

  it("keeps a precise string FILETIME without loss", () => {
    const f = parseSessionFile(JSON.stringify({ ...desktopFile, procStart: "134360984898638759" }));
    expect(f?.procStart).toBe("134360984898638759");
  });

  it.each([
    ["float", 7.5],
    ["negative", -1],
    ["zero", 0],
    ["string", "7"],
    ["exponent form", 1e21],
    ["above MAX_PID", 2147483648],
  ])("returns null for pid %s", (_n, pid) => {
    expect(parseSessionFile(JSON.stringify({ ...desktopFile, pid }))).toBeNull();
  });

  it.each([
    ["half-written file", '{"pid": 7, "sessionId": "s'],
    ["no pid", JSON.stringify({ sessionId: "s" })],
    ["no session id", JSON.stringify({ pid: 7 })],
    ["array", "[]"],
    ["empty", ""],
  ])("returns null for %s", (_n, text) => {
    expect(parseSessionFile(text)).toBeNull();
  });
});

describe("pidFromFileName", () => {
  it("accepts only <pid>.json", () => {
    expect(pidFromFileName("773707.json")).toBe(773707);
    expect(pidFromFileName("773707.abc123.key")).toBeNull();
    expect(pidFromFileName("x.json")).toBeNull();
    expect(pidFromFileName("0.json")).toBeNull();
  });

  it.each(["007.json", "99999999999.json", "1.json.key", "a/1.json"])(
    "returns null for %s",
    (name) => {
      expect(pidFromFileName(name)).toBeNull();
    },
  );

  it("accepts the largest pid and rejects one above it", () => {
    expect(pidFromFileName("2147483647.json")).toBe(2147483647);
    expect(pidFromFileName("2147483648.json")).toBeNull();
  });
});

describe("start times", () => {
  it("reads field 22 from /proc/<pid>/stat, also with spaces in the command name", () => {
    const stat =
      "773707 (claude code) S 4252 773707 4252 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 12 0 2713903 1000 200";
    expect(linuxStartTime(stat)).toBe("2713903");
    expect(linuxStartTime("garbage")).toBeNull();
  });

  it("finds the closing paren when the command name itself contains one", () => {
    expect(linuxStartTime(`1 (a) b) ${STAT_TAIL}`)).toBe("2713903");
  });

  it("returns null for a stat line truncated before field 22", () => {
    expect(
      linuxStartTime(
        "773707 (claude code) S 4252 773707 4252 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 12 0",
      ),
    ).toBeNull();
  });

  it("returns the clean number when the line ends in a newline after field 22", () => {
    expect(linuxStartTime(`773707 (claude code) ${STAT_TAIL.replace(" 1000 200", "")}\n`)).toBe(
      "2713903",
    );
  });

  it("handles double spaces between fields", () => {
    expect(
      linuxStartTime(
        "773707 (claude code)  S  4252 773707 4252 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 12 0  2713903 1000 200",
      ),
    ).toBe("2713903");
  });

  it("returns null when field 22 is not numeric", () => {
    expect(
      linuxStartTime(
        "773707 (claude code) S 4252 773707 4252 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 12 0 abc 1000 200",
      ),
    ).toBeNull();
  });

  it("returns null for a command name with nothing after it", () => {
    expect(linuxStartTime("(x)")).toBeNull();
  });

  it("converts FILETIME (100 ns since 1601) to epoch ms", () => {
    expect(filetimeToMs("134360984898638759")).toBe(1_791_624_889_863);
    expect(filetimeToMs("nope")).toBeNull();
  });

  it.each([
    ["zero, which is before 1970", "0"],
    ["empty string", ""],
    ["leading space", " 1"],
    ["negative", "-5"],
    ["400 digits", "1".repeat(400)],
  ])("returns null for %s", (_n, input) => {
    expect(filetimeToMs(input)).toBeNull();
  });

  it("accepts leading zeros", () => {
    expect(filetimeToMs("0134360984898638759")).toBe(1_791_624_889_863);
  });
});
