import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOST_WAITING, REST_WARNING, aboutTime, afterLine, cancelRest, restingAt, setAfterLine, addJob, allJobs, askAgainIn, holdLine, jobsText, lineHeld, moveJob, pauseJob, resetJobs, setJobHooks, stopJob } from "./jobs";
import type { Job } from "./jobs";

const tick = () => new Promise((ok) => setTimeout(ok, 0));
const info = (what: string) => ({ what, project: "Demo", seconds: 10 });

describe("the job line", () => {
  let ended: Job[];
  let logged: string[];
  beforeEach(() => {
    resetJobs();
    ended = [];
    logged = [];
    setJobHooks({ free: () => true, ended: (j) => ended.push({ ...j }), log: (l) => logged.push(l) });
  });

  it("answers at once and runs videos one after another", async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const a = addJob(info("A"), async () => {
      order.push("A starts");
      await new Promise<void>((ok) => (finishFirst = ok));
      order.push("A ends");
      return "/x/a.mp4";
    });
    addJob(info("B"), async () => {
      order.push("B starts");
      return "/x/b.mp4";
    });
    expect("n" in a && a.state).toBe("running");
    await tick();
    expect(order).toEqual(["A starts"]);
    expect(allJobs().map((j) => j.state)).toEqual(["running", "waiting"]);
    finishFirst();
    await tick();
    await tick();
    expect(order).toEqual(["A starts", "A ends", "B starts"]);
    expect(ended.map((j) => [j.what, j.state, j.file])).toEqual([
      ["A", "done", "/x/a.mp4"],
      ["B", "done", "/x/b.mp4"],
    ]);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain("\tdone\t");
  });

  it("keeps a failed video, with why, in the log", async () => {
    addJob(info("C"), async () => {
      throw new Error("The disk is full.");
    });
    await tick();
    await tick();
    expect(ended[0].state).toBe("failed");
    expect(ended[0].error).toBe("The disk is full.");
    expect(logged[0]).toContain("The disk is full.");
    expect(jobsText()).toContain("not made. The disk is full.");
  });

  it("waits while another video is being made", async () => {
    let free = false;
    setJobHooks({ free: () => free, ended: () => {}, log: () => {} });
    let ran = false;
    addJob(info("D"), async () => {
      ran = true;
      return "/x/d.mp4";
    });
    await tick();
    expect(ran).toBe(false);
    free = true;
    await new Promise((ok) => setTimeout(ok, 2100));
    expect(ran).toBe(true);
  });

  it("refuses more than the most that may wait", () => {
    const never = () => new Promise<string | null>(() => {});
    for (let i = 0; i <= MOST_WAITING; i++) expect("n" in addJob(info(`J${i}`), never)).toBe(true);
    const over = addJob(info("too many"), never);
    expect("n" in over).toBe(false);
  });

  it("tells the AI when to ask again, not too often", () => {
    expect(askAgainIn(5)).toBe(10);
    expect(askAgainIn(90)).toBe(30);
    expect(askAgainIn(100000)).toBe(300);
    expect(aboutTime(40)).toBe("about 40 seconds");
    expect(aboutTime(600)).toBe("about 10 minutes");
    expect(aboutTime(7200)).toBe("about 2 hours");
  });
  it("holds a running video halfway and carries it on", async () => {
    const held: boolean[] = [];
    let finish!: (f: string | null) => void;
    const a = addJob(info("P"), () => new Promise((ok) => (finish = ok)), { pause: (on) => held.push(on), stop: () => finish(null) });
    await tick();
    const n = "n" in a ? a.n : 0;
    expect(pauseJob(n, true)).toBe(true);
    expect(allJobs()[0].paused).toBe(true);
    expect(jobsText()).toContain("paused");
    expect(pauseJob(n, false)).toBe(true);
    expect(held).toEqual([true, false]);
    finish("/x/p.mp4");
    await tick();
    expect(allJobs()[0].state).toBe("done");
    expect(pauseJob(n, true)).toBe(false);
  });

  it("stops a running video, and takes a waiting one out of the line", async () => {
    let finish!: (f: string | null) => void;
    const control = { pause: () => {}, stop: () => finish(null) };
    const a = addJob(info("S"), () => new Promise((ok) => (finish = ok)), control);
    const b = addJob(info("W"), async () => "/x/w.mp4", control);
    await tick();
    expect(stopJob("n" in b ? b.n : 0)).toBe(true);
    expect(allJobs().map((j) => j.what)).toEqual(["S"]);
    expect(stopJob("n" in a ? a.n : 0)).toBe(true);
    await tick();
    expect(ended.map((j) => [j.what, j.state])).toEqual([["S", "stopped"]]);
    expect(logged[0]).toContain("\tstopped\t");
  });

  it("moves a waiting video up the line", async () => {
    const order: string[] = [];
    let finish!: () => void;
    addJob(info("A"), () => new Promise((ok) => (finish = () => ok("/x/a.mp4"))));
    for (const w of ["B", "C", "D"]) addJob(info(w), async () => (order.push(w), `/x/${w}.mp4`));
    await tick();
    const d = allJobs().find((j) => j.what === "D")!;
    expect(moveJob(d.n, 0)).toBe(true);
    expect(allJobs().map((j) => j.what)).toEqual(["A", "D", "B", "C"]);
    expect(moveJob(allJobs()[0].n, 1)).toBe(false);
    finish();
    for (let i = 0; i < 8; i++) await tick();
    expect(order).toEqual(["D", "B", "C"]);
  });
  it("holds the whole line: the running one pauses and the next does not start", async () => {
    const held: boolean[] = [];
    let finish!: (f: string | null) => void;
    let nextRan = false;
    addJob(info("H"), () => new Promise((ok) => (finish = ok)), { pause: (on) => held.push(on), stop: () => finish(null) });
    addJob(info("N"), async () => ((nextRan = true), "/x/n.mp4"));
    await tick();
    holdLine(true);
    expect(lineHeld()).toBe(true);
    expect(allJobs()[0].paused).toBe(true);
    expect(jobsText()).toContain("paused the whole line");
    finish("/x/h.mp4");
    await new Promise((ok) => setTimeout(ok, 400));
    expect(nextRan).toBe(false);
    holdLine(false);
    await new Promise((ok) => setTimeout(ok, 400));
    expect(nextRan).toBe(true);
    expect(held).toEqual([true]);
  });
});

describe("after the line", () => {
  let rested: string[];
  let warned: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    resetJobs();
    rested = [];
    warned = [];
    setJobHooks({ free: () => true, ended: () => {}, log: () => {}, restSoon: (w) => warned.push(w), rest: (w) => rested.push(w) });
  });
  afterEach(() => vi.useRealTimers());

  const finish = async (what: string) => {
    addJob(info(what), async () => `/x/${what}.mp4`);
    await vi.advanceTimersByTimeAsync(0);
  };

  it("does nothing when the line ends, unless chosen", async () => {
    await finish("A");
    await vi.advanceTimersByTimeAsync(REST_WARNING * 2);
    expect(warned).toEqual([]);
    expect(rested).toEqual([]);
  });

  it("warns, waits a minute, then sleeps once and goes back to Do nothing", async () => {
    setAfterLine("sleep");
    await finish("A");
    expect(warned).toEqual(["sleep"]);
    expect(restingAt()?.what).toBe("sleep");
    await vi.advanceTimersByTimeAsync(REST_WARNING - 1000);
    expect(rested).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rested).toEqual(["sleep"]);
    expect(restingAt()).toBeNull();
    expect(afterLine()).toBe("nothing");
  });

  it("is cancelled within the minute and the computer stays awake", async () => {
    setAfterLine("shutdown");
    await finish("A");
    cancelRest();
    await vi.advanceTimersByTimeAsync(REST_WARNING * 2);
    expect(rested).toEqual([]);
    expect(afterLine()).toBe("nothing");
  });

  it("waits again when a new export joins during the minute", async () => {
    setAfterLine("shutdown");
    await finish("A");
    let done!: () => void;
    addJob(info("B"), () => new Promise((ok) => (done = () => ok("/x/b.mp4"))));
    await vi.advanceTimersByTimeAsync(REST_WARNING * 2);
    expect(rested).toEqual([]);
    done();
    await vi.advanceTimersByTimeAsync(REST_WARNING);
    expect(rested).toEqual(["shutdown"]);
  });
});
