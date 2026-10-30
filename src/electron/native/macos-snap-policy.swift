// Geometry/traversal shared by the AX adapter and permission-free native regression tests.
import Foundation

struct MacSnapWindow {
    let id: UInt32
    let pid: Int32
    let z: Int
    let rect: CGRect
    var canOcclude = true
}

// Keep original z-order for hit testing; spend AX budgets on the visible pointer target first.
func prioritizeMacSnapWindows(_ windows: [MacSnapWindow], cursor: CGPoint?) -> [MacSnapWindow] {
    let targets = windows.filter { window in
        !windows.contains { front in front.canOcclude && front.z < window.z && front.rect.contains(window.rect) }
    }
    return targets.sorted { a, b in
        let underA = cursor.map { a.rect.contains($0) } ?? false
        let underB = cursor.map { b.rect.contains($0) } ?? false
        return underA == underB ? a.z < b.z : underA
    }
}

// nil children means unsupported attribute; an empty visible array means nothing is visible.
// Page reads must remain bounded, including when AXVisibleChildren is unavailable.
protocol MacSnapTreeSource {
    associatedtype Element
    func frame(_ element: Element) -> CGRect?
    func role(_ element: Element) -> String?
    func children(_ element: Element, visible: Bool, offset: Int, limit: Int) -> [Element]?
}

struct MacSnapContainer {
    let rect: CGRect
    let controlType: String
}

private let macSnapRoles: [String: String] = [
    "AXSplitGroup": "Pane", "AXScrollArea": "Pane", "AXGroup": "Group",
    "AXWebArea": "Document", "AXLayoutArea": "Pane", "AXList": "List",
    "AXOutline": "Tree", "AXTable": "Table", "AXTabGroup": "Tab",
    "AXRow": "ListItem", "AXCell": "Custom"
]

private enum MacSnapVisit<Element> {
    case node(Element, depth: Int, clip: CGRect)
    case page(Element, depth: Int, clip: CGRect, visible: Bool, offset: Int)
}

// Lazy pages avoid truncating every list at 256 items. Viewport clipping and per-window
// node/time budgets bound fallback traversal without confusing an empty viewport with unsupported AX.
func collectMacSnapContainers<Source: MacSnapTreeSource>(
    _ source: Source, root: Source.Element, window: CGRect, deadline: Double,
    maxNodes: Int = 1600, now: () -> Double = { ProcessInfo.processInfo.systemUptime }
) -> [MacSnapContainer] {
    var remaining = maxNodes
    var stack: [MacSnapVisit<Source.Element>] = [.node(root, depth: 0, clip: window)]
    var result: [MacSnapContainer] = []
    while !stack.isEmpty && remaining > 0 && now() < deadline {
        guard let task = stack.popLast() else { break }
        switch task {
        case let .node(element, depth, inheritedClip):
            remaining -= 1
            let frame = source.frame(element)
            // Structural elements without geometry can still own visible descendants.
            let clip = frame.map { $0.intersection(inheritedClip) } ?? inheritedClip
            if clip.isNull || clip.isEmpty { continue }
            if depth > 0, frame != nil, let role = source.role(element), let type = macSnapRoles[role],
               clip.width >= 64 && clip.height >= 40 {
                result.append(MacSnapContainer(rect: clip, controlType: type))
            }
            if depth < 24 {
                stack.append(.page(element, depth: depth + 1, clip: clip, visible: true, offset: 0))
            }
        case let .page(element, depth, clip, preferVisible, offset):
            let limit = min(256, remaining)
            var visible = preferVisible
            var page = source.children(element, visible: visible, offset: offset, limit: limit)
            if page == nil && visible && offset == 0 {
                visible = false
                page = source.children(element, visible: false, offset: 0, limit: limit)
            }
            guard let children = page, !children.isEmpty else { continue }
            if children.count == limit {
                stack.append(.page(element, depth: depth, clip: clip, visible: visible, offset: offset + children.count))
            }
            for child in children.reversed() {
                stack.append(.node(child, depth: depth, clip: clip))
            }
        }
    }
    return result
}
