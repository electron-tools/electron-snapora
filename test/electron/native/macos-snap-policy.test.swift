// Runs the production Swift traversal against synthetic AX trees; no desktop, TCC or screen pixels.
import Foundation

private struct TestNode {
    var frame: CGRect?
    var role: String = "AXGroup"
    var children: [Int] = []
    var visible: [Int]? = nil
}

private final class TestTree: MacSnapTreeSource {
    var nodes: [Int: TestNode] = [:]
    var visited: [Int] = []
    var pages: [(id: Int, visible: Bool, offset: Int, limit: Int)] = []
    func frame(_ element: Int) -> CGRect? { visited.append(element); return nodes[element]?.frame }
    func role(_ element: Int) -> String? { nodes[element]?.role }
    func children(_ element: Int, visible: Bool, offset: Int, limit: Int) -> [Int]? {
        pages.append((element, visible, offset, limit))
        guard let node = nodes[element], let children = visible ? node.visible : node.children else { return nil }
        return Array(children.dropFirst(offset).prefix(limit))
    }
}

// Unlike assert(), this remains active in the optimized test binary.
private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

private let window = CGRect(x: 0, y: 0, width: 800, height: 800)
private let viewport = CGRect(x: 100, y: 100, width: 400, height: 300)

@main
private struct MacSnapPolicyTests {
    static func main() {
        compositorWindows()
        pointerPriority()
        scrolledVisibleRows()
        emptyVisibleChildren()
        nestedClip()
        fallbackPagination()
        traversalLimits()
        print("7 macOS native snap policy regressions passed (no capture or permissions).")
    }

    static func compositorWindows() {
        let status = MacSnapWindow(id: 1, pid: 1, z: 0, rect: window, isWindowServer: true)
        let overlay = MacSnapWindow(id: 2, pid: 2, z: 1, rect: window, layer: 1000)
        let menu = MacSnapWindow(id: 3, pid: 3, z: 2, rect: window, layer: 24)
        let floating = MacSnapWindow(id: 4, pid: 4, z: 3, rect: viewport, layer: 3)
        let app = MacSnapWindow(id: 5, pid: 5, z: 4, rect: window)
        let modal = MacSnapWindow(id: 6, pid: 6, z: 5, rect: CGRect(x: -800, y: 0, width: 800, height: 800), layer: 8)
        let raw = [status, overlay, menu, floating, app, modal]
        let selected = selectMacSnapWindows(raw, allowedLayers: [0, 3, 8, 19])
        check(selected.map { $0.id } == [4, 5, 6], "System fullscreen surfaces must not become hover candidates; floating/modal/fullscreen apps stay")
        check(prioritizeMacSnapWindows(selected, cursor: nil).map { $0.id } == [4, 5, 6], "System surfaces must not prune all applications from AX traversal")
        check(selected[1].z == 4 && raw.count == 6, "Preserve original z-order and the complete list used for capture exclusion")
    }

    static func pointerPriority() {
        let front = MacSnapWindow(id: 1, pid: 10, z: 0, rect: window)
        let hidden = MacSnapWindow(id: 2, pid: 20, z: 1, rect: viewport)
        let secondary = MacSnapWindow(id: 3, pid: 30, z: 9, rect: CGRect(x: -1000, y: -200, width: 800, height: 800))
        let candidates = [front, hidden, secondary]
        let targets = prioritizeMacSnapWindows(candidates, cursor: CGPoint(x: -500, y: 100))
        check(targets.map { $0.id } == [3, 1], "Pointer target on secondary display must receive budget before complex primary windows")
        check(targets[0].z == 9, "AX scheduling must not change hit-test z-order")
        check(candidates.count == 3, "Occlusion pruning is only for AX; retain all window candidates")
        check(prioritizeMacSnapWindows(candidates, cursor: nil).map { $0.id } == [1, 3], "No pointer falls back to front-to-back")
        var translucent = front
        translucent.canOcclude = false
        check(prioritizeMacSnapWindows([translucent, hidden], cursor: nil).count == 2, "Known translucent windows must not prune targets behind them")
    }

    static func scrolledVisibleRows() {
        let tree = TestTree()
        tree.nodes[0] = TestNode(frame: window, children: [1])
        tree.nodes[1] = TestNode(frame: viewport, role: "AXScrollArea", children: Array(2...601), visible: [502, 503, 504])
        for id in 2...601 {
            let frame = CGRect(x: 110, y: CGFloat(id >= 502 && id <= 504 ? 120 + (id - 502) * 70 : 900), width: 180, height: 60)
            tree.nodes[id] = TestNode(frame: frame, role: "AXRow")
        }
        let result = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, now: { 0 })
        check(result.filter { $0.controlType == "ListItem" }.count == 3, "Rows scrolled past index 500 must still be discovered")
        check(tree.visited == [0, 1, 502, 503, 504], "Do not scan invisible prefix rows")
        check(!tree.pages.contains { $0.id == 1 && !$0.visible }, "Supported visible children must not fall back to all children")
    }

    static func emptyVisibleChildren() {
        let tree = TestTree()
        tree.nodes[0] = TestNode(frame: window, children: [1], visible: [])
        tree.nodes[1] = TestNode(frame: viewport, role: "AXRow")
        let result = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, now: { 0 })
        check(result.isEmpty && tree.visited == [0], "Empty visible children is not an unsupported attribute")
        check(!tree.pages.contains { !$0.visible }, "Do not expose hidden content via fallback")
    }

    static func nestedClip() {
        let tree = TestTree()
        tree.nodes[0] = TestNode(frame: window, children: [1])
        tree.nodes[1] = TestNode(frame: viewport, role: "AXScrollArea", children: [2, 3, 5])
        tree.nodes[2] = TestNode(frame: CGRect(x: 80, y: 340, width: 500, height: 120), role: "AXRow")
        tree.nodes[3] = TestNode(frame: CGRect(x: 110, y: 500, width: 200, height: 60), role: "AXRow", children: [4])
        tree.nodes[4] = TestNode(frame: viewport, role: "AXRow")
        tree.nodes[5] = TestNode(frame: nil, children: [6])
        tree.nodes[6] = TestNode(frame: CGRect(x: 120, y: 120, width: 200, height: 60), role: "AXRow")
        let result = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, now: { 0 })
        let rows = result.filter { $0.controlType == "ListItem" }
        check(rows.count == 2 && rows[0].rect == CGRect(x: 100, y: 340, width: 400, height: 60), "Rows must be clipped to their scroll viewport, not only the window")
        check(!tree.visited.contains(4) && tree.visited.contains(6), "Prune offscreen branches while retaining geometry-less structural nodes")
    }

    static func fallbackPagination() {
        let tree = TestTree()
        tree.nodes[0] = TestNode(frame: window, children: Array(1...600))
        for id in 1...600 {
            tree.nodes[id] = TestNode(frame: id == 500 ? viewport : CGRect(x: -300, y: 0, width: 100, height: 60), role: "AXRow")
        }
        let result = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, now: { 0 })
        check(result.count == 1 && result[0].rect == viewport, "Unsupported visible children must page beyond index 256 within budget")
        check(tree.pages.contains { $0.id == 0 && !$0.visible && $0.offset == 256 }, "Continuation page must be requested")
        check(tree.pages.allSatisfy { $0.limit <= 256 }, "Individual AX reads stay bounded")
    }

    static func traversalLimits() {
        let tree = TestTree()
        for id in 0...40 { tree.nodes[id] = TestNode(frame: window, children: [id + 1]) }
        _ = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, now: { 0 })
        check(tree.visited.count == 25, "Depth limit must stop at 24")
        tree.visited = []
        _ = collectMacSnapContainers(tree, root: 0, window: window, deadline: 1, maxNodes: 5, now: { 0 })
        check(tree.visited.count == 5, "Node limit must bound fallback traversal")
        tree.visited = []
        _ = collectMacSnapContainers(tree, root: 0, window: window, deadline: 0, now: { 0 })
        check(tree.visited.isEmpty, "Expired window budget must not invoke AX")
    }
}
