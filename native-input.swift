import Foundation
import ApplicationServices
import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
guard CommandLine.arguments.count == 2,
      let data = CommandLine.arguments[1].data(using: .utf8),
      let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let action = input["action"] as? String else { fail("Invalid input") }
if action == "frontmost" {
    guard let app = NSWorkspace.shared.frontmostApplication else { fail("No focused app") }
    print("{\"pid\":\(app.processIdentifier)}"); exit(0)
}
if action == "preflight" {
    print("{\"accessibility\":\(AXIsProcessTrusted()),\"postEvent\":\(CGPreflightPostEventAccess())}"); exit(0)
}
guard AXIsProcessTrusted() else { fail("Accessibility permission is required for Agent Wardrobe's native input helper.") }
if let pid = input["targetPid"] as? Int32 {
    guard let app = NSRunningApplication(processIdentifier: pid), app.activate(options: []) else { fail("Observed app is no longer available") }
    usleep(150000)
}
// A HID-state source plus a short gap lets the window server deliver each event before this short-lived helper exits.
let source = CGEventSource(stateID: .hidSystemState)
func post(_ event: CGEvent?) { event?.post(tap: .cghidEventTap); usleep(20000) }
switch action {
case "click":
    guard let x = input["x"] as? Double, let y = input["y"] as? Double else { fail("Missing coordinates") }
    let point = CGPoint(x: x, y: y)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left))
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left))
case "type":
    guard let text = input["text"] as? String, text.utf16.count <= 2000 else { fail("Invalid text") }
    // CGEventKeyboardSetUnicodeString silently drops strings longer than 20 UTF-16 units,
    // so send whole characters in chunks that never split a surrogate pair or grapheme.
    var chunk: [UInt16] = []
    func flush() {
        guard !chunk.isEmpty else { return }
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
            event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            // virtualKey 0 is the A key: without clearing flags, a lingering ⌘ from a previous shortcut turns typing into ⌘A.
            event?.flags = []
            post(event)
        }
        chunk.removeAll()
    }
    for character in text {
        let units = Array(String(character).utf16)
        if chunk.count + units.count > 20 { flush() }
        chunk.append(contentsOf: units)
    }
    flush()
case "key":
    let keys: [String: CGKeyCode] = ["Enter":36,"Escape":53,"Tab":48,"Backspace":51,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"a":0,"c":8,"v":9,"l":37,"w":13,"q":12,"Space":49]
    guard let key = input["key"] as? String, let code = keys[key] else { fail("Unsupported key") }
    var flags = CGEventFlags()
    for modifier in input["modifiers"] as? [String] ?? [] {
        switch modifier {
        case "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "option": flags.insert(.maskAlternate)
        case "control": flags.insert(.maskControl)
        default: fail("Unsupported modifier")
        }
    }
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down); event?.flags = flags; post(event)
    }
case "fn":
    // Tap Fn (keycode 63): the default Typeless dictation shortcut, one tap to start and one to finish.
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: 63, keyDown: down)
        event?.type = .flagsChanged; event?.flags = down ? .maskSecondaryFn : []
        post(event); usleep(40000)
    }
case "scroll":
    let dx = max(-2000, min(2000, input["dx"] as? Int ?? 0))
    let dy = max(-2000, min(2000, input["dy"] as? Int ?? 0))
    post(CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0))
default: fail("Unsupported action")
}
print("{\"ok\":true}")
