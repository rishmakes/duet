// Records one window to a video, even while other windows cover it, until it is told to stop.
// Used to film Duet dev while Antigravity tests it (see the duet-dev skill, "Testing a change").
// The Mac's own window capture (ScreenCaptureKit); `screencapture -v -l` only records black.
//
//   record <out.mov> <process id>      stops on Ctrl+C, on a kill, or when <out.mov>.stop appears
import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// the window system has to be up before any window can be found
_ = NSApplication.shared

let args = CommandLine.arguments
guard args.count == 3, let pid = Int32(args[2]) else {
  FileHandle.standardError.write("usage: record <out.mov> <process id>\n".data(using: .utf8)!)
  exit(2)
}
let out = URL(fileURLWithPath: args[1])
let stopFile = out.path + ".stop"
try? FileManager.default.removeItem(at: out)
try? FileManager.default.removeItem(atPath: stopFile)

final class Recorder: NSObject, SCStreamOutput {
  var writer: AVAssetWriter!
  var input: AVAssetWriterInput!
  var started = false
  var stream: SCStream!

  func start(window: SCWindow) async throws {
    let scale = 2
    let width = Int(window.frame.width) * scale
    let height = Int(window.frame.height) * scale
    let config = SCStreamConfiguration()
    config.width = width
    config.height = height
    config.minimumFrameInterval = CMTime(value: 1, timescale: 15)
    config.showsCursor = true
    writer = try AVAssetWriter(outputURL: out, fileType: .mov)
    input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000],
    ])
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    writer.startWriting()
    stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: nil)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
    try await stream.startCapture()
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    // only frames that hold a picture: the window sends empty ones while nothing changes
    guard type == .screen, buffer.isValid,
      let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
      let raw = info[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete
    else { return }
    if !started {
      writer.startSession(atSourceTime: buffer.presentationTimeStamp)
      started = true
    }
    if input.isReadyForMoreMediaData { input.append(buffer) }
  }

  func stop() async {
    try? await stream.stopCapture()
    // the video lasts until now, so its seconds match the clock even where nothing moved
    if started { writer.endSession(atSourceTime: CMClockGetTime(CMClockGetHostTimeClock())) }
    input.markAsFinished()
    await writer.finishWriting()
  }
}

let recorder = Recorder()
let done = DispatchSemaphore(value: 0)

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    // the biggest window of that process: the app, not a menu or a tooltip
    guard let window = content.windows.filter({ $0.owningApplication?.processID == pid && $0.frame.height > 200 })
      .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    else {
      FileHandle.standardError.write("No window found for process \(pid).\n".data(using: .utf8)!)
      exit(1)
    }
    try await recorder.start(window: window)
    print("Recording \(window.title ?? "window") to \(out.path) from \(Date())")
    fflush(stdout)
  } catch {
    FileHandle.standardError.write("Could not record: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
  }
}

func finish() {
  Task {
    await recorder.stop()
    print("Saved \(out.path)")
    done.signal()
  }
}
var sources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
  signal(sig, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
  source.setEventHandler { finish() }
  source.resume()
  sources.append(source)
}
// a stop file works where a signal cannot be sent, such as from another tool
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { t in
  if FileManager.default.fileExists(atPath: stopFile) {
    t.invalidate()
    try? FileManager.default.removeItem(atPath: stopFile)
    finish()
  }
}
DispatchQueue.global().async {
  done.wait()
  exit(0)
}
RunLoop.main.run()
