// macOS 14+ recording source: ScreenCaptureKit window exclusion + VideoToolbox H.264.
// Only compressed packets cross stdout; three credits bound memory under a slow consumer.
import Foundation
import ApplicationServices
import ScreenCaptureKit
import VideoToolbox

private let outputLock = NSLock()
private func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}

private final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "snapora.recording", qos: .userInitiated)
    private let lock = NSLock()
    private var stream: SCStream?
    private var configuration: SCStreamConfiguration?
    private var encoder: VTCompressionSession?
    private var latest: CVPixelBuffer?
    private var minimumFrameTime = Double.greatestFiniteMagnitude
    private var ticker: DispatchSourceTimer?
    private var displayID: UInt32 = 0
    private var width = 0, height = 0, fps = 30
    private var active = false
    private var origin = 0.0
    private var sequence = 0
    private var credits: Set<Int> = []

    private func respond(_ id: Int, _ value: [String: Any] = [:]) { emit(["id": id, "type": "result", "value": value]) }
    private func fail(_ id: Int, _ error: Error) { emit(["id": id, "type": "error", "message": String(describing: error)]) }
    private func problem(_ text: String) -> NSError { NSError(domain: "SnaporaRecording", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }

    private func filter(_ ids: [String]) async throws -> SCContentFilter {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw problem("Recording display unavailable.") }
        let wanted = Set(ids.compactMap(UInt32.init))
        guard wanted.count == Set(ids).count else { throw problem("Invalid exclusion IDs.") }
        let windows = content.windows.filter { wanted.contains($0.windowID) }
        // Never fall back to unfiltered desktop capture: a missing ID could expose controls.
        guard wanted.isSubset(of: Set(windows.map { $0.windowID })) else { throw problem("ScreenCaptureKit could not resolve every recording control window.") }
        let result = SCContentFilter(display: display, excludingWindows: windows)
        if #available(macOS 14.2, *) { result.includeMenuBar = true }
        return result
    }

    func command(_ request: [String: Any]) {
        guard let id = request["id"] as? Int, let command = request["command"] as? String else { return }
        if command == "ack", let seq = request["sequence"] as? Int { lock.lock(); credits.remove(seq); lock.unlock(); return }
        if command == "pause", let paused = request["paused"] as? Bool, let elapsed = request["elapsed"] as? Double, elapsed.isFinite, elapsed >= 0 {
            lock.lock(); active = !paused; origin = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) - elapsed; lock.unlock()
            respond(id); return
        }
        if command == "prepare" {
            guard configuration == nil, CGPreflightScreenCaptureAccess(),
                  let display = request["displayId"] as? String, let displayID = UInt32(display),
                  let w = request["width"] as? Int, let h = request["height"] as? Int,
                  w >= 2, h >= 2, w <= 1920, h <= 1920,
                  let rate = request["fps"] as? Int, [10,30].contains(rate),
                  let region = request["region"] as? [String: Double],
                  let x = region["x"], let y = region["y"], let rw = region["width"], let rh = region["height"],
                  [x,y,rw,rh].allSatisfy({ $0.isFinite }), x >= 0, y >= 0, rw > 0, rh > 0,
                  let ids = request["excludedWindowIds"] as? [String] else { fail(id, problem("Invalid preparation or Screen Recording access denied.")); return }
            self.displayID = displayID; width = w; height = h; fps = rate
            Task {
                do {
                    _ = try await self.filter(ids)
                    let config = SCStreamConfiguration()
                    config.sourceRect = CGRect(x: x, y: y, width: rw, height: rh)
                    config.width = w; config.height = h; config.queueDepth = 5
                    config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(rate))
                    config.pixelFormat = kCVPixelFormatType_32BGRA
                    config.showsCursor = true; config.capturesAudio = false
                    var compression: VTCompressionSession?
                    let status = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(w), height: Int32(h), codecType: kCMVideoCodecType_H264,
                        encoderSpecification: [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true] as CFDictionary,
                        imageBufferAttributes: nil, compressedDataAllocator: nil,
                        outputCallback: { ref, source, status, _, sample in
                            guard let ref = ref, let source = source else { return }
                            Unmanaged<Recorder>.fromOpaque(ref).takeUnretainedValue().encoded(status, sample, Int(bitPattern: source))
                        }, refcon: Unmanaged.passUnretained(self).toOpaque(), compressionSessionOut: &compression)
                    guard status == noErr, let compression = compression else { throw self.problem("VideoToolbox H.264 encoder unavailable.") }
                    self.encoder = compression
                    for (key, value) in [
                        (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue as CFTypeRef),
                        (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse as CFTypeRef),
                        (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Main_AutoLevel as CFTypeRef),
                        (kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: 4_000_000) as CFTypeRef),
                        (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: rate) as CFTypeRef),
                        (kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, NSNumber(value: 1) as CFTypeRef)
                    ] { guard VTSessionSetProperty(compression, key: key, value: value) == noErr else { throw self.problem("VideoToolbox configuration failed.") } }
                    guard VTCompressionSessionPrepareToEncodeFrames(compression) == noErr else { throw self.problem("VideoToolbox preparation failed.") }
                    self.configuration = config
                    self.respond(id, ["width": w, "height": h])
                } catch { self.fail(id, error) }
            }
        } else if command == "start", let ids = request["excludedWindowIds"] as? [String], let config = configuration, stream == nil {
            Task {
                do {
                    let filter = try await self.filter(ids)
                    // Construct the stream with exclusions before it captures its first surface.
                    let stream = SCStream(filter: filter, configuration: config, delegate: self)
                    self.stream = stream
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
                    self.queue.async {
                        let now = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))
                        self.latest = nil; self.minimumFrameTime = now
                        let ticker = DispatchSource.makeTimerSource(queue: self.queue)
                        ticker.schedule(deadline: .now(), repeating: .nanoseconds(1_000_000_000 / self.fps))
                        ticker.setEventHandler { self.encodeLatest() }
                        self.ticker = ticker; ticker.resume()
                    }
                    try await stream.startCapture()
                    self.queue.async {
                        // Start the timeline after stream initialization, close to AAC/output start.
                        self.lock.lock(); self.origin = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())); self.active = true; self.lock.unlock()
                        self.respond(id)
                    }
                } catch { self.fail(id, error) }
            }
        } else if command == "stop", let stream = stream {
            lock.lock(); active = false; lock.unlock()
            Task {
                do {
                    try await stream.stopCapture()
                    self.queue.async {
                        self.ticker?.cancel(); self.ticker = nil; self.latest = nil
                        if let encoder = self.encoder { VTCompressionSessionCompleteFrames(encoder, untilPresentationTimeStamp: .invalid); VTCompressionSessionInvalidate(encoder) }
                        self.encoder = nil; self.respond(id)
                    }
                } catch { self.fail(id, error) }
            }
        } else { fail(id, problem("Unknown recording command.")) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { emit(["type": "fatal", "message": error.localizedDescription]) }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sampleBuffer),
              CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) >= minimumFrameTime,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        latest = pixels
    }

    // SCK may send idle frames on a static desktop. Repeat the latest retained surface at a
    // bounded cadence rather than timing out or forcing raw-frame copies through Electron.
    private func encodeLatest() {
        guard let pixels = latest, let encoder = encoder else { return }
        lock.lock()
        let timestamp = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) - origin
        guard active, credits.count < 3, timestamp >= 0 else { lock.unlock(); return }
        sequence += 1; let seq = sequence; credits.insert(seq); lock.unlock()
        // Source-frame refcon carries the credit ID, avoiding a raw-frame copy or unbounded queue.
        let result = VTCompressionSessionEncodeFrame(encoder, imageBuffer: pixels, presentationTimeStamp: CMTime(seconds: timestamp, preferredTimescale: 1_000_000),
            duration: CMTime(value: 1, timescale: Int32(fps)), frameProperties: nil,
            sourceFrameRefcon: UnsafeMutableRawPointer(bitPattern: seq), infoFlagsOut: nil)
        if result != noErr { emit(["type":"fatal", "message":"VideoToolbox could not encode a screen frame."]) }
    }

    private func encoded(_ status: OSStatus, _ sample: CMSampleBuffer?, _ seq: Int) {
        if status == noErr && sample == nil { lock.lock(); credits.remove(seq); lock.unlock(); return }
        guard status == noErr, let sample = sample, let block = CMSampleBufferGetDataBuffer(sample),
              let format = CMSampleBufferGetFormatDescription(sample),
              let atoms = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) as? [String: Any],
              let avcc = atoms["avcC"] as? Data else { emit(["type":"fatal", "message":"Invalid H.264 sample."]); return }
        let count = CMBlockBufferGetDataLength(block)
        guard count > 0, count <= 4 * 1024 * 1024 else { emit(["type":"fatal", "message":"H.264 packet too large."]); return }
        var data = Data(count: count)
        let copied = data.withUnsafeMutableBytes { bytes in CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count, destination: bytes.baseAddress!) }
        guard copied == noErr else { emit(["type":"fatal", "message":"H.264 packet copy failed."]); return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[String: Any]]
        let key = !(attachments?.first?[kCMSampleAttachmentKey_NotSync as String] as? Bool ?? false)
        emit(["type":"packet", "sequence":seq, "timestamp":CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)),
            "duration":1.0 / Double(fps), "key":key, "config":avcc.base64EncodedString(), "data":data.base64EncodedString()])
    }
}

@main private struct SnaporaMacRecording {
    static func main() {
        let recorder = Recorder()
        emit(["type":"ready", "protocolVersion":1])
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                guard line.utf8.count < 65536, let data = line.data(using: .utf8),
                      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any] else { continue }
                recorder.command(object)
            }
            exit(0)
        }
        dispatchMain()
    }
}
