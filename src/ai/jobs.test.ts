import { beforeEach, describe, expect, it } from "vitest";
import { MOST_WAITING, aboutTime, addJob, allJobs, askAgainIn, jobsText, resetJobs, setJobHooks } from "./jobs";
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
});
