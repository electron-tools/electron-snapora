// macOS 14+ helper. AX and capture use separate processes; stdin contains only geometry and IDs.
import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

private func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

private func failure(_ id: Int, _ code: String, _ message: String) {
    emit(["id": id, "type": "error", "code": code, "message": message])
}

private func rectObject(_ rect: CGRect) -> [String: Any] {
    return ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
}

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

private func axRect(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute),
          let size = attribute(element, kAXSizeAttribute),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
          point.x.isFinite, point.y.isFinite, dimensions.width.isFinite, dimensions.height.isFinite,
          dimensions.width > 0, dimensions.height > 0 else { return nil }
    return CGRect(origin: point, size: dimensions)
}

// Fetch bounded slices, never an entire AXChildren array from a large browser document.
private func elements(_ element: AXUIElement, _ name: String, _ limit: Int, offset: Int = 0) -> [AXUIElement]? {
    var count: CFIndex = 0
    guard limit > 0 else { return [] }
    let status = AXUIElementGetAttributeValueCount(element, name as CFString, &count)
    if status == .attributeUnsupported { return nil }
    guard status == .success, count > offset else { return [] }
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(element, name as CFString, offset, min(count - offset, limit), &values) == .success else { return [] }
    return values as? [AXUIElement] ?? []
}

private struct AXTreeSource: MacSnapTreeSource {
    func frame(_ element: AXUIElement) -> CGRect? {
        AXUIElementSetMessagingTimeout(element, 0.05)
        return axRect(element)
    }
    func role(_ element: AXUIElement) -> String? { attribute(element, kAXRoleAttribute) as? String }
    func children(_ element: AXUIElement, visible: Bool, offset: Int, limit: Int) -> [AXUIElement]? {
        elements(element, visible ? kAXVisibleChildrenAttribute : kAXChildrenAttribute, limit, offset: offset)
    }
}

private extension MacSnapWindow {
    func candidate(_ bounds: CGRect, _ role: String? = nil) -> [String: Any] {
        var result = rectObject(bounds)
        result["windowId"] = String(id)
        result["sourceProcessId"] = Int(pid)
        result["windowZOrder"] = z
        result["kind"] = role == nil ? "window" : "container"
        if let role = role { result["controlType"] = role }
        return result
    }
}

private func visibleWindows(_ excluded: Set<UInt32>) -> [MacSnapWindow] {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.enumerated().compactMap { z, row -> MacSnapWindow? in
        guard let id = row[kCGWindowNumber as String] as? UInt32,
              let pid = row[kCGWindowOwnerPID as String] as? Int32,
              let layer = row[kCGWindowLayer as String] as? Int,
              let bounds = row[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              !excluded.contains(id), pid > 0, rect.width >= 16, rect.height >= 16,
              (row[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              layer >= 0 else { return nil }
        return MacSnapWindow(id: id, pid: pid, z: z, rect: rect,
            canOcclude: (row[kCGWindowAlpha as String] as? Double ?? 1) >= 1,
            layer: layer, isWindowServer: (row[kCGWindowOwnerName as String] as? String) == "Window Server")
    }.prefix(256).map { $0 }
}

private func probe(_ request: [String: Any], _ id: Int) {
    let excluded = Set((request["excludedWindowIds"] as? [String] ?? []).compactMap(UInt32.init))
    let visible = visibleWindows(excluded)
    // Capture exclusion below still uses the full visible list, including high-level overlays.
    let layers: Set<Int> = Set([CGWindowLevelKey.normalWindow, .floatingWindow, .modalPanelWindow, .utilityWindow]
        .map { Int(CGWindowLevelForKey($0)) })
    let windows = selectMacSnapWindows(visible, allowedLayers: layers)
    emit(["id": id, "type": "event", "regions": windows.map { $0.candidate($0.rect) }])
    let trusted = AXIsProcessTrusted()
    var diagnostics: [String: Any] = ["visibleWindows": visible.count, "filteredWindows": visible.count - windows.count,
        "axTargets": 0, "matchedWindows": 0, "rawContainers": 0]
    guard request["containers"] as? Bool == true, trusted else {
        emit(["id": id, "type": "result", "accessibility": trusted, "diagnostics": diagnostics]); return
    }
    // AX/CG bounds use top-left global points, already in Electron DIP (not Retina pixels).
    var cursor: CGPoint?
    if let point = request["cursor"] as? [String: Double], let x = point["x"], let y = point["y"], x.isFinite, y.isFinite {
        cursor = CGPoint(x: x, y: y)
    }
    let started = ProcessInfo.processInfo.systemUptime
    var applicationWindows: [pid_t: [AXUIElement]] = [:]
    let targets = prioritizeMacSnapWindows(windows, cursor: cursor)
    diagnostics["axTargets"] = targets.count
    var matchedWindows = 0
    var rawContainers = 0
    for window in targets {
        if ProcessInfo.processInfo.systemUptime - started > 1.8 { break }
        let windowStarted = ProcessInfo.processInfo.systemUptime
        if applicationWindows[window.pid] == nil {
            let app = AXUIElementCreateApplication(window.pid)
            AXUIElementSetMessagingTimeout(app, 0.05)
            applicationWindows[window.pid] = elements(app, kAXWindowsAttribute, 64) ?? []
        }
        var matches: [AXUIElement] = []
        for candidate in applicationWindows[window.pid] ?? [] {
            if ProcessInfo.processInfo.systemUptime - started > 1.8 ||
                ProcessInfo.processInfo.systemUptime - windowStarted > 0.65 { break }
            AXUIElementSetMessagingTimeout(candidate, 0.05)
            guard let bounds = axRect(candidate) else { continue }
            if abs(bounds.minX - window.rect.minX) <= 3 && abs(bounds.minY - window.rect.minY) <= 3 &&
                abs(bounds.width - window.rect.width) <= 3 && abs(bounds.height - window.rect.height) <= 3 {
                matches.append(candidate)
            }
        }
        // Public AX has no guaranteed CGWindowID attribute. Ambiguous bounds fall back to the window.
        guard matches.count == 1, let root = matches.first else { continue }
        matchedWindows += 1
        let batch = collectMacSnapContainers(AXTreeSource(), root: root, window: window.rect,
            deadline: min(started + 1.8, windowStarted + 0.65))
            .map { window.candidate($0.rect, $0.controlType) }
        rawContainers += batch.count
        if !batch.isEmpty { emit(["id": id, "type": "event", "regions": batch]) }
    }
    diagnostics["matchedWindows"] = matchedWindows
    diagnostics["rawContainers"] = rawContainers
    emit(["id": id, "type": "result", "accessibility": true, "diagnostics": diagnostics])
}

@available(macOS 14.0, *)
private func capture(_ request: [String: Any], _ id: Int) {
    guard CGPreflightScreenCaptureAccess() else {
        failure(id, "PERMISSION_DENIED", "Grant Screen Recording access using the demo permission button, then retry."); return
    }
    guard let displayText = request["displayId"] as? String, let displayID = UInt32(displayText),
          let excludedText = request["excludedWindowIds"] as? [String], !excludedText.isEmpty,
          let maxBytes = request["maxBytes"] as? Int, maxBytes > 0,
          let maxPixels = request["maxPixels"] as? Int, maxPixels > 0 else {
        failure(id, "CAPTURE_FAILED", "Invalid capture or missing overlay exclusion IDs."); return
    }
    let excluded = Set(excludedText.compactMap(UInt32.init))
    guard excluded.count == Set(excludedText).count else {
        failure(id, "CAPTURE_FAILED", "Invalid window exclusion IDs."); return
    }
    let done = DispatchSemaphore(value: 0)
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
        guard let content = content, error == nil else {
            failure(id, "CAPTURE_FAILED", "ScreenCaptureKit could not enumerate displays."); done.signal(); return
        }
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            failure(id, "DISPLAY_NOT_FOUND", "Selected display is unavailable."); done.signal(); return
        }
        let omitted = content.windows.filter { excluded.contains($0.windowID) }
        // A visible requested overlay must be known to SCK; never silently capture it on mismatch.
        let visibleIDs = Set(visibleWindows([]).map { $0.id }).intersection(excluded)
        guard visibleIDs.isSubset(of: Set(omitted.map { $0.windowID })) else {
            failure(id, "CAPTURE_FAILED", "ScreenCaptureKit could not exclude a visible overlay."); done.signal(); return
        }
        let filter = SCContentFilter(display: display, excludingWindows: omitted)
        if #available(macOS 14.2, *) { filter.includeMenuBar = true }
        let config = SCStreamConfiguration()
        config.width = Int((filter.contentRect.width * CGFloat(filter.pointPixelScale)).rounded())
        config.height = Int((filter.contentRect.height * CGFloat(filter.pointPixelScale)).rounded())
        guard config.width > 0, config.height > 0, config.width <= maxPixels / config.height else {
            failure(id, "CAPTURE_FAILED", "Display exceeds the capture pixel limit."); done.signal(); return
        }
        config.showsCursor = false
        config.capturesAudio = false
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
            defer { done.signal() }
            guard let image = image, error == nil else {
                failure(id, "CAPTURE_FAILED", "ScreenCaptureKit image capture failed."); return
            }
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
                failure(id, "CAPTURE_FAILED", "PNG encoder unavailable."); return
            }
            CGImageDestinationAddImage(destination, image, nil)
            guard CGImageDestinationFinalize(destination), ((data.length + 2) / 3) * 4 + 22 <= maxBytes else {
                failure(id, "CAPTURE_FAILED", "PNG exceeds the capture byte limit."); return
            }
            emit(["id": id, "type": "result", "dataUrl": "data:image/png;base64," + (data as Data).base64EncodedString()])
        }
    }
    // TS enforces a hard deadline and kills this process; main queue stays free for SCK callbacks.
    done.wait()
}

@main
private struct SnaporaMacHelper {
    static func main() {
        guard #available(macOS 14.0, *) else { exit(1) }
        emit(["type": "ready", "protocolVersion": 1])
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                autoreleasepool {
                    guard line.utf8.count < 65536, let data = line.data(using: .utf8),
                          let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                          let id = request["id"] as? Int else { return }
                    switch request["command"] as? String {
                    case "probe": probe(request, id)
                    case "capture": capture(request, id)
                    case "permissions":
                        if request["prompt"] as? Bool == true {
                            // Only an explicit user action requests permissions; prepare/probe never prompts.
                            let done = DispatchSemaphore(value: 0)
                            DispatchQueue.main.async {
                                _ = CGRequestScreenCaptureAccess()
                                _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
                                done.signal()
                            }
                            done.wait()
                        }
                        emit(["id": id, "type": "result", "screenRecording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()])
                    default: failure(id, "CAPTURE_FAILED", "Unknown native command.")
                    }
                }
            }
            exit(0)
        }
        dispatchMain()
    }
}
