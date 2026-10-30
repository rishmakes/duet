// Where feedback from inside Duet lands: one row in a Google Sheet, pictures in a Drive folder.
// Paste into Extensions > Apps Script of the Sheet, then Deploy > New deployment > Web app,
// run as Me, access Anyone. The web app address goes into Duet. People need no Google account.
// The address can only add rows. Limits below keep a flood of junk out.

const FOLDER_NAME = "Duet feedback pictures";
const MAX_PICTURES = 6;
const MAX_PER_MINUTE = 30;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

/** The folder for pictures, made the first time it is needed. */
function pictureFolder() {
  const found = DriveApp.getFoldersByName(FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
}

const answer = (body) => ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);

/** Count messages in the current minute, for everyone together. False once there are too many. */
function roomThisMinute() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const key = "count-" + Math.floor(Date.now() / 60000);
    const count = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(count), 120);
    return count <= MAX_PER_MINUTE;
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  if (!e || !e.postData || e.postData.length > MAX_BYTES) return answer({ ok: false, why: "too big" });
  if (!roomThisMinute()) return answer({ ok: false, why: "busy" });
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return answer({ ok: false, why: "not readable" });
  }
  const when = new Date();
  const pictures = (Array.isArray(data.pictures) ? data.pictures : []).filter((p) => typeof p === "string" && p.length < MAX_PICTURE_BYTES * 1.4).slice(0, MAX_PICTURES);
  const folder = pictures.length ? pictureFolder() : null;
  const links = pictures.map((b64, i) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), "image/png", `${when.toISOString()}-${i + 1}.png`);
    return folder.createFile(blob).getUrl();
  });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["When", "What they said", "Email", "Duet version", "Computer", "Pictures"]);
  // a leading = or + would run as a formula in the Sheet, so it is kept as words
  const words = (v, n) => String(v || "").slice(0, n).replace(/^[=+\-@]/, "'$&");
  sheet.appendRow([when, words(data.text, 5000), words(data.email, 200), words(data.version, 40), words(data.system, 300), links.join("\n")]);
  return answer({ ok: true });
}

/** Run once from the editor to give the script its permissions and make the folder. */
function setUp() {
  pictureFolder();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["When", "What they said", "Email", "Duet version", "Computer", "Pictures"]);
}
