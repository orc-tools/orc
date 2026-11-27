import AppKit
import AVFoundation
import CryptoKit
import Speech
import WebKit

@MainActor
protocol DesktopMicrophoneHandling: AnyObject {
    func receive(_ body: [String: Any])
    func cancel()
    func shutdown()
}

@available(macOS 26.0, *)
@MainActor
final class DesktopDictation: DesktopMicrophoneHandling {
    private final class Session {
        let id: String
        var engine: AVAudioEngine?
        var input: AsyncStream<AnalyzerInput>.Continuation?
        var analyzer: SpeechAnalyzer?
        var results: Task<Void, Error>?
        var task: Task<Void, Never>?
        var limit: Task<Void, Never>?
        var interruption: NSObjectProtocol?
        var finalized = ""
        var volatile = ""
        var stopping = false
        var cancelled = false

        init(id: String) { self.id = id }

        var text: String { (finalized + volatile).trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    private static let maximumRecording: Duration = .seconds(300)

    private var session: Session?
    private let onEvent: ([String: Any]) -> Void

    init(onEvent: @escaping ([String: Any]) -> Void) { self.onEvent = onEvent }

    func receive(_ body: [String: Any]) {
        guard let id = body["id"] as? String, UUID(uuidString: id) != nil else { return }
        switch body["action"] as? String {
        case "start": start(id: id, localeID: body["locale"] as? String ?? Locale.current.identifier)
        case "stop":
            guard let current = session, current.id == id, current.engine != nil else { return }
            finish(current)
        case "cancel":
            if session?.id == id { cancel() }
        default: break
        }
    }

    private func emit(_ current: Session, state: String, text: String? = nil, message: String? = nil) {
        guard session === current, !current.cancelled else { return }
        var payload: [String: Any] = ["id": current.id, "state": state]
        if let text { payload["text"] = text }
        if let message { payload["message"] = message }
        onEvent(payload)
    }

    private func start(id: String, localeID: String) {
        cancel()
        let current = Session(id: id)
        session = current
        emit(current, state: "preparing")
        current.task = Task {
            do {
                guard SpeechTranscriber.isAvailable else {
                    throw Failure("On-device dictation is unavailable on this Mac.")
                }
                guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeID)) else {
                    throw Failure("Dictation does not support your current language (\(localeID)).")
                }
                try Task.checkCancellation()
                guard await AVCaptureDevice.requestAccess(for: .audio) else {
                    throw Failure("Allow Orc to use the microphone in System Settings > Privacy & Security > Microphone.")
                }
                try Task.checkCancellation()
                // The progressive preset reports volatile guesses while the user speaks, so words reach the draft live.
                let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
                if let installation = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                    try Task.checkCancellation()
                    emit(current, state: "downloading")
                    do { try await installation.downloadAndInstall() }
                    catch { throw Failure("The speech model could not be downloaded. Check your connection and try again.") }
                }
                try Task.checkCancellation()
                guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
                    throw Failure("Dictation does not support your current language (\(localeID)).")
                }
                try Task.checkCancellation()
                let engine = AVAudioEngine()
                let microphoneFormat = engine.inputNode.outputFormat(forBus: 0)
                guard microphoneFormat.sampleRate > 0, microphoneFormat.channelCount > 0 else {
                    throw Failure("Could not record from the microphone. Check your input device and try again.")
                }
                let converter = microphoneFormat == analyzerFormat ? nil : AVAudioConverter(from: microphoneFormat, to: analyzerFormat)
                if microphoneFormat != analyzerFormat, converter == nil {
                    throw Failure("Could not record from the microphone. Check your input device and try again.")
                }
                let (audio, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
                let analyzer = SpeechAnalyzer(modules: [transcriber])
                current.engine = engine
                current.input = input
                current.analyzer = analyzer
                current.results = Task {
                    for try await result in transcriber.results {
                        let text = String(result.text.characters)
                        if result.isFinal {
                            current.finalized += text
                            current.volatile = ""
                        } else {
                            current.volatile = text
                        }
                        if !current.stopping { emit(current, state: "partial", text: current.text) }
                    }
                }
                try await analyzer.start(inputSequence: audio)
                try Task.checkCancellation()
                engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: microphoneFormat,
                                            block: Self.deliver(to: input, as: analyzerFormat, converting: converter))
                current.interruption = NotificationCenter.default.addObserver(
                    forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, let current = self.session, current.id == id else { return }
                        self.finish(current)
                    }
                }
                engine.prepare()
                do { try engine.start() }
                catch { throw Failure("Could not record from the microphone. Check your input device and try again.") }
                current.task = nil
                current.limit = Task { [weak self] in
                    try? await Task.sleep(for: Self.maximumRecording)
                    if !Task.isCancelled { self?.finish(current) }
                }
                emit(current, state: "recording")
            } catch {
                emit(current, state: "error", message: error.localizedDescription)
                if let analyzer = current.analyzer { await analyzer.cancelAndFinishNow() }
                cleanUp(current)
            }
        }
    }

    // The tap runs on the audio thread, so its block must not inherit main-actor isolation.
    private nonisolated static func deliver(
        to input: AsyncStream<AnalyzerInput>.Continuation, as format: AVAudioFormat, converting converter: AVAudioConverter?
    ) -> AVAudioNodeTapBlock {
        return { buffer, _ in
            guard let converter else {
                input.yield(AnalyzerInput(buffer: buffer))
                return
            }
            let ratio = format.sampleRate / buffer.format.sampleRate
            let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
            guard capacity > 0, let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
            nonisolated(unsafe) var pending: AVAudioPCMBuffer? = buffer
            let status = converter.convert(to: converted, error: nil) { _, inputStatus in
                guard let next = pending else {
                    // Not end of stream: the converter keeps resampler state for the next buffer.
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                pending = nil
                inputStatus.pointee = .haveData
                return next
            }
            if status != .error, converted.frameLength > 0 { input.yield(AnalyzerInput(buffer: converted)) }
        }
    }

    private func stopAudio(_ current: Session) {
        current.limit?.cancel()
        current.limit = nil
        if let interruption = current.interruption {
            NotificationCenter.default.removeObserver(interruption)
            current.interruption = nil
        }
        if let engine = current.engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        current.engine = nil
        current.input?.finish()
        current.input = nil
    }

    private func finish(_ current: Session) {
        guard session === current, !current.stopping, current.engine != nil, let analyzer = current.analyzer else { return }
        current.stopping = true
        stopAudio(current)
        emit(current, state: "transcribing")
        current.task = Task {
            defer { cleanUp(current) }
            do {
                try await analyzer.finalizeAndFinishThroughEndOfInput()
                try await current.results?.value
                try Task.checkCancellation()
                let text = current.text
                if text.isEmpty { throw Failure("No speech detected. Try again.") }
                emit(current, state: "complete", text: text)
            } catch let failure as Failure {
                emit(current, state: "error", message: failure.localizedDescription)
            } catch {
                await analyzer.cancelAndFinishNow()
                emit(current, state: "error", message: "Could not transcribe this recording. \(error.localizedDescription)")
            }
        }
    }

    func cancel() {
        guard let current = session else { return }
        emit(current, state: "cancelled")
        session = nil
        current.cancelled = true
        stopAudio(current)
        current.task?.cancel()
        current.results?.cancel()
        if let analyzer = current.analyzer {
            Task { await analyzer.cancelAndFinishNow() }
        }
        if current.task == nil { cleanUp(current) }
    }

    private func cleanUp(_ current: Session) {
        stopAudio(current)
        current.results?.cancel()
        current.results = nil
        current.task = nil
        current.analyzer = nil
        if session === current { session = nil }
    }

    func shutdown() {
        cancel()
    }
}

// MARK: - Config

let defaultPort = 4173
let port: Int = {
    if let s = ProcessInfo.processInfo.environment["ORC_UI_PORT"], let p = Int(s) {
        return p
    }
    return defaultPort
}()
let baseURLString = "http://127.0.0.1:\(port)/"
let baseURL = URL(string: baseURLString)!

func shouldOpenNewWindowURLExternally(_ url: URL, serverPort: Int) -> Bool {
    guard url.host == "127.0.0.1", url.port == serverPort else { return true }

    let components = url.pathComponents
    guard components.count >= 4, components[1] == "runs" else { return false }

    let runRelativePath = components.dropFirst(3).joined(separator: "/").lowercased()

    let registeredPaths: Set<String> = [
        "grilling.html", "clarification/clarification.html", "plan.html",
        "mvp/mvp.html",
        "review.html", "audit.html", "build-review.html", "qa-review.html",
        "recap/recap.html", "review/recap.html", "present/present.html", "ship/ship.html",
        "planning/planning.html",
        "pr-comments.html",
    ]
    return !registeredPaths.contains(runRelativePath)
}

// A URL router registered as the default http handler (Finicky, Velja, Choosy,
// Browserosaurus) rewrites Orc's own loopback URLs into orc:// deep links built
// from the fragment. A run's HTML output has no fragment, so that rewrite
// produces an empty deep link and the click dies silently. For our own loopback
// URLs, name a real browser instead of trusting the handler.
let browserRouterBundleIDs: Set<String> = [
    "se.johnste.finicky",
    "com.sindresorhus.Velja",
    "com.choosyosx.Choosy",
    "net.will.Browserosaurus",
]

let fallbackBrowserBundleIDs = [
    "com.brave.Browser",
    "com.google.Chrome",
    "company.thebrowser.Browser",
    "org.mozilla.firefox",
    "com.apple.Safari",
]

/// The browser to open a loopback Orc URL with, or nil to use the default
/// handler. Nil is the normal answer: it only names a browser when the handler
/// would swallow the URL.
///
/// A browser that is already open beats one that is merely installed: the fixed
/// candidate order is a tie-break, not a preference, and picking an installed
/// browser the user never opens sends the page somewhere they will not look.
func directBrowserBundleID(
    defaultBundleID: String?,
    ownBundleID: String?,
    candidates: [String] = fallbackBrowserBundleIDs,
    isInstalled: (String) -> Bool,
    isRunning: (String) -> Bool
) -> String? {
    let normalizedDefault = defaultBundleID?.lowercased()
    let routers = Set(browserRouterBundleIDs.map { $0.lowercased() })
    let hijacked = normalizedDefault == nil
        || routers.contains(normalizedDefault!)
        || normalizedDefault == ownBundleID?.lowercased()
    guard hijacked else { return nil }
    return candidates.first(where: { isInstalled($0) && isRunning($0) })
        ?? candidates.first(where: isInstalled)
}

func openExternalURL(_ url: URL, serverPort: Int) {
    let workspace = NSWorkspace.shared
    guard url.host == "127.0.0.1", url.port == serverPort else {
        workspace.open(url)
        return
    }
    let defaultBundleID = workspace.urlForApplication(toOpen: url)
        .flatMap { Bundle(url: $0)?.bundleIdentifier }
    let running = Set(
        NSWorkspace.shared.runningApplications
            .compactMap { $0.bundleIdentifier?.lowercased() }
    )
    let browser = directBrowserBundleID(
        defaultBundleID: defaultBundleID,
        ownBundleID: Bundle.main.bundleIdentifier,
        isInstalled: { workspace.urlForApplication(withBundleIdentifier: $0) != nil },
        isRunning: { running.contains($0.lowercased()) }
    ).flatMap { workspace.urlForApplication(withBundleIdentifier: $0) }
    guard let browser else {
        workspace.open(url)
        return
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    workspace.open([url], withApplicationAt: browser, configuration: configuration)
}

@discardableResult
func routeNewWindowNavigation(
    _ navigationAction: WKNavigationAction,
    in webView: WKWebView,
    serverPort: Int,
    openExternally: (URL) -> Void
) -> Bool {
    guard navigationAction.targetFrame == nil,
          let url = navigationAction.request.url else { return false }

    if shouldOpenNewWindowURLExternally(url, serverPort: serverPort) {
        openExternally(url)
    } else {
        webView.load(URLRequest(url: url))
    }
    return true
}

/// The box around an image's mostly opaque pixels, in Core Graphics
/// coordinates (origin bottom left). Faint shadows and glows fall outside it.
func solidBounds(_ image: CGImage) -> CGRect? {
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard drawn else { return nil }
    var minX = width, maxX = -1, minRow = height, maxRow = -1
    for row in 0..<height {
        for x in 0..<width where pixels[(row * width + x) * 4 + 3] >= 128 {
            minX = min(minX, x); maxX = max(maxX, x)
            minRow = min(minRow, row); maxRow = max(maxRow, row)
        }
    }
    guard maxX >= 0 else { return nil }
    // Bitmap memory starts at the top row; Core Graphics y starts at the bottom.
    return CGRect(x: minX, y: height - 1 - maxRow, width: maxX - minX + 1, height: maxRow - minRow + 1)
}

/// The Dock badge repeats the page's waiting count. Anything else the page
/// sends clears it, so the page cannot write its own text on the icon.
func dockBadgeLabel(_ value: Any?) -> String? {
    guard let text = value as? String,
          text.range(of: "^([1-9][0-9]?|99\\+)$", options: .regularExpression) != nil else { return nil }
    return text
}

/// Theme icons are drawn for the plugin hub and fill about 94% of their
/// canvas, while macOS app icons keep their body to an 824pt square centred
/// on a 1024pt canvas. Without this the Dock shows Orc about a sixth larger
/// than every app beside it.
func dockTileImage(_ image: CGImage) -> CGImage? {
    let canvas: CGFloat = 1024, body: CGFloat = 824
    guard let solid = solidBounds(image),
          let context = CGContext(
            data: nil, width: Int(canvas), height: Int(canvas), bitsPerComponent: 8,
            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    let scale = body / max(solid.width, solid.height)
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(
        x: (canvas - solid.width * scale) / 2 - solid.minX * scale,
        y: (canvas - solid.height * scale) / 2 - solid.minY * scale,
        width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale))
    return context.makeImage()
}

/// Layer colours do not follow the appearance on their own; resolve the
/// dynamic system colour against the view each time it changes.
func resolvedColor(_ color: NSColor, in view: NSView) -> CGColor {
    var resolved = color.cgColor
    view.effectiveAppearance.performAsCurrentDrawingAppearance { resolved = color.cgColor }
    return resolved
}

/// A saved window frame stays put while enough of it shows on a connected
/// display to grab its title bar. Otherwise, as after its monitor is
/// unplugged, it moves to the middle of the first display, shrunk to fit.
func windowFrameOnScreen(_ frame: CGRect, visibleFrames: [CGRect]) -> CGRect {
    let reachable = visibleFrames.contains { screen in
        let overlap = screen.intersection(frame)
        return !overlap.isNull && overlap.width >= 100 && overlap.height >= 40
    }
    guard !reachable, let screen = visibleFrames.first else { return frame }
    let size = CGSize(width: min(frame.width, screen.width), height: min(frame.height, screen.height))
    return CGRect(
        x: (screen.midX - size.width / 2).rounded(),
        y: (screen.midY - size.height / 2).rounded(),
        width: size.width,
        height: size.height
    )
}

/// Opens a window where it was last left, or centred when nothing is saved,
/// and keeps it saving its frame under `autosaveName` from then on.
/// `beforeSaving` places it first when it should not sit on the saved frame.
func restoreWindowFrame(_ window: NSWindow, autosaveName: String, beforeSaving: (() -> Void)? = nil) {
    window.center()
    if window.setFrameUsingName(autosaveName) {
        let screens = (NSScreen.main.map { [$0] } ?? []) + NSScreen.screens.filter { $0 != NSScreen.main }
        let frame = windowFrameOnScreen(window.frame, visibleFrames: screens.map(\.visibleFrame))
        if frame != window.frame { window.setFrame(frame, display: false) }
    }
    beforeSaving?()
    // Only one window at a time can hold a name; later ones open at the
    // saved frame without saving their own.
    window.setFrameAutosaveName(autosaveName)
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    private static let imageContextMessageName = "orcImageContext"
    // Main window -> app: the keyboard shortcuts set in Settings.
    private static let shortcutsMessageName = "orcShortcuts"
    // Main window -> app: how many assistant topics need you, for the Dock icon.
    private static let dockBadgeMessageName = "orcDockBadge"
    // The main window's frame in UserDefaults, kept across launches.
    static let mainWindowAutosaveName = "OrcMainWindow"

    private let existingInstance: NSRunningApplication?
    private var duplicateExitWorkItem: DispatchWorkItem?
    var window: NSWindow!
    var webView: WKWebView!
    private var themeColorObservation: NSKeyValueObservation?
    private var dictation: DesktopMicrophoneHandling?
    // Menu items whose keys follow Settings → Keyboard shortcuts, by the ids
    // ui/js/shortcuts.js sends, with the keys they were built with.
    private var shortcutMenuItems: [String: NSMenuItem] = [:]
    private var shortcutMenuDefaults: [String: (key: String, modifiers: NSEvent.ModifierFlags)] = [:]
    var loadRetryCount = 0
    let maxLoadRetries = 15
    // fragment to land on once the UI loads — kept across the retry loop so
    // an orc:// link that launches the app doesn't lose its run
    var pendingFragment: String?
    // webView.url reports the provisional URL as soon as a load starts, so on
    // a cold launch it already says 127.0.0.1 before any document exists.
    // Only a finished load may take the location.hash path in navigate().
    var uiLoaded = false
    // What `orc-ui start` printed when it failed (no Python 3.11, a viewer
    // that died on import), shown in place of an empty window until ⌘R.
    var daemonStartFailure: String?
    var sseClient: SSEClient!
    // Digest of the executable this process is actually running, taken at
    // launch. It cannot be re-read later: the bundle reaches us through
    // ~/Applications/Orc.app -> current -> releases/<id>, and a promotion
    // repoints `current`, so after an install that path resolves to the *new*
    // binary and would always compare equal to itself.
    private let launchBinaryDigest: Data? = AppDelegate.binaryDigest(Bundle.main.executableURL)
    private var updateAccessory: NSTitlebarAccessoryViewController?
    // One QA window per run id; see the QA window section.
    var qaWindows: [String: QAWindowController] = [:]

    init(existingInstance: NSRunningApplication? = nil) {
        self.existingInstance = existingInstance
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard existingInstance == nil else {
            activateExistingInstance()
            // URL-open events arrive just after launch completion. Keep this
            // windowless process alive briefly so it can forward an orc://
            // fragment before exiting.
            scheduleDuplicateExit(after: 2.0)
            return
        }

        startDockIconWatch()
        ensureDaemonRunning()
        buildMainMenu()
        buildWindow()

        sseClient = SSEClient(baseURL: baseURL, appDelegate: self)
        sseClient.start()
        startHiddenPoll()
    }

    // The page's run poll plays the ready and attention sounds. While the
    // window cannot be seen, WebKit may hold that poll's timer back, so a
    // native timer wakes it; the page rate-limits hidden polls itself.
    private var hiddenPollTimer: Timer?
    private func startHiddenPoll() {
        let timer = Timer(timeInterval: 15, target: self, selector: #selector(pollWhileHidden),
                          userInfo: nil, repeats: true)
        timer.tolerance = 5
        RunLoop.main.add(timer, forMode: .common)
        hiddenPollTimer = timer
    }

    @objc private func pollWhileHidden() {
        guard uiLoaded, let window, !window.occlusionState.contains(.visible) else { return }
        webView.evaluateJavaScript("window.orcBackgroundPoll && window.orcBackgroundPoll()", completionHandler: nil)
    }

    // System Settings is where the swipe setting changes, so coming back to
    // the app is when the page's copy of it can be stale.
    func applicationDidBecomeActive(_ notification: Notification) {
        webView?.evaluateJavaScript(Self.swipeFallbackScript, completionHandler: nil)
    }

    // WebKit's own back/forward swipe (allowsBackForwardNavigationGestures)
    // only runs when the Mac's "Swipe between pages" trackpad setting is on.
    // When it is off, ui/js/swipe-nav.js reads the swipe from wheel events.
    private static var swipeFallbackScript: String {
        "window.orcSwipeFallback = \(!NSEvent.isSwipeTrackingFromScrollEventsEnabled);"
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        dictation?.shutdown()
        closeQAWindowsForTermination()
    }

    private func sendDictationEvent(_ payload: [String: Any]) {
        sendPageEvent("orc-dictation", payload)
    }

    private func sendPageEvent(_ name: String, _ payload: [String: Any]) {
        guard let url = webView?.url, url.scheme == baseURL.scheme,
              url.host == baseURL.host, url.port == port,
              ["/", "/index.html"].contains(url.path),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)', {detail: \(json)}))", completionHandler: nil)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    // orc://<run-id>/<file> — same fragment form as the http deep links.
    // Parsed off absoluteString, not URL.host: host parsing lowercases and
    // run ids can carry uppercase ticket keys (ABC-123-...).
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let s = urls.first?.absoluteString, s.hasPrefix("orc://") else { return }
        let frag = String(s.dropFirst("orc://".count)).removingPercentEncoding
            ?? String(s.dropFirst("orc://".count))
        if existingInstance != nil {
            forwardToExistingInstance(fragment: frag)
            return
        }
        navigate(toFragment: frag)
    }

    private func activateExistingInstance() {
        existingInstance?.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    }

    private func scheduleDuplicateExit(after delay: TimeInterval) {
        duplicateExitWorkItem?.cancel()
        let workItem = DispatchWorkItem {
            NSApp.terminate(nil)
        }
        duplicateExitWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func forwardToExistingInstance(fragment: String) {
        activateExistingInstance()
        duplicateExitWorkItem?.cancel()

        var request = URLRequest(url: baseURL.appendingPathComponent("api/navigate"))
        request.httpMethod = "POST"
        request.timeoutInterval = 2.0
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // force: this is a user-initiated forward (deep link), so the
        // existing instance must route even though activating it
        // makes it frontmost — the active-app guard is only for daemon opens.
        let payload: [String: Any] = ["fragment": fragment, "foreground": true, "force": true]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: request) { _, _, _ in
            DispatchQueue.main.async {
                self.scheduleDuplicateExit(after: 0.1)
            }
        }.resume()
        scheduleDuplicateExit(after: 2.5)
    }

    // MARK: Daemon

    func ensureDaemonRunning() {
        daemonStartFailure = nil
        let path = "\(NSHomeDirectory())/.local/bin/orc-ui"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["start"]
        process.standardOutput = FileHandle.nullDevice
        // Collect stderr as it arrives: reading to the end could wait forever
        // on a background child that inherited the pipe.
        let errors = Pipe()
        let collected = DaemonOutput()
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil } else { collected.append(data) }
        }
        process.standardError = errors
        process.terminationHandler = { [weak self] finished in
            let status = finished.terminationStatus
            guard status != 0 else { return }
            // start also refuses when another viewer holds the port, and that
            // one still serves the UI; only an unreachable UI is a failure.
            guard let self else { return }
            var probe = URLRequest(url: baseURL)
            probe.timeoutInterval = 1.0
            URLSession.shared.dataTask(with: probe) { _, response, _ in
                guard response == nil else { return }
                DispatchQueue.main.async {
                    guard !self.uiLoaded else { return }
                    let text = collected.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.daemonStartFailure = text.isEmpty ? "orc-ui start exited with status \(status)." : text
                    self.showLoadError()
                }
            }.resume()
        }
        do {
            try process.run()
        } catch {
            daemonStartFailure = "Orc could not run \(path): \(error.localizedDescription)"
        }
    }

    // MARK: Dock icon

    private var dockIconWatch: DispatchSourceFileSystemObject?
    private var dockIconTheme: String?

    private func startDockIconWatch() {
        applyDockIconTheme()
        // serve.py replaces ui-theme.json with a rename, so a watch on the file
        // would keep following the old inode; the directory sees every rename.
        let fd = open("\(NSHomeDirectory())/.orc", O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: .main)
        source.setEventHandler { [weak self] in self?.applyDockIconTheme() }
        source.setCancelHandler { close(fd) }
        source.resume()
        dockIconWatch = source
    }

    private func applyDockIconTheme() {
        let url = URL(fileURLWithPath: "\(NSHomeDirectory())/.orc/ui-theme.json")
        var theme: String?
        if let data = try? Data(contentsOf: url),
           let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let funMode = saved["funMode"] as? String,
           funMode.range(of: "^[a-z][a-z0-9-]{0,31}$", options: .regularExpression) != nil {
            theme = funMode
        }
        let home = URL(fileURLWithPath: "\(NSHomeDirectory())/.orc")
        var icon: URL?
        if let data = try? Data(contentsOf: home.appendingPathComponent("app-plugins.json")),
           let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let installed = state["installed"] as? [String: [String: Any]] {
            for (id, record) in installed where record["enabled"] as? Bool == true {
                guard let digest = record["digest"] as? String else { continue }
                let bundled = home.appendingPathComponent("runtime/current/app-plugins/\(id)").resolvingSymlinksInPath()
                let bundledData = try? Data(contentsOf: bundled.appendingPathComponent("orc-plugin.json"))
                let bundledManifest = bundledData.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                guard let manifest = bundledManifest ?? record["manifest"] as? [String: Any],
                      let contributions = manifest["contributes"] as? [String: Any],
                      let appearance = contributions["theme"] as? [String: Any],
                      appearance["id"] as? String == theme,
                      let asset = appearance["icon"] as? String else { continue }
                let root = bundledManifest == nil ? home.appendingPathComponent("app-plugins/\(id)/\(digest)").standardizedFileURL : bundled
                let candidate = root.appendingPathComponent(asset).resolvingSymlinksInPath()
                if candidate.path.hasPrefix(root.path + "/") { icon = candidate }
            }
        }
        let identity = icon?.path
        guard identity != dockIconTheme else { return }
        dockIconTheme = identity
        // Asset-only themes may omit an icon; Cocoa restores the bundle icon.
        NSApp.applicationIconImage = icon.flatMap { NSImage(contentsOf: $0) }.map { image in
            guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                  let tile = dockTileImage(source) else { return image }
            return NSImage(cgImage: tile, size: NSSize(width: 1024, height: 1024))
        }
    }

    // MARK: Window / WebView

    func buildWindow() {
        let contentRect = NSRect(x: 0, y: 0, width: 1280, height: 860)
        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Orc"
        window.titlebarAppearsTransparent = true
        window.delegate = self
        // Opens where it was left, so a restart for an update keeps its place.
        restoreWindowFrame(window, autosaveName: Self.mainWindowAutosaveName)

        let config = WKWebViewConfiguration()
        // index.html reads this UA marker to skip the browser→app link handoff
        config.applicationNameForUserAgent = "OrcApp"
        config.userContentController.add(self, name: "orcDictation")
        config.userContentController.add(self, name: AppDelegate.shortcutsMessageName)
        config.userContentController.add(self, name: AppDelegate.dockBadgeMessageName)
        config.userContentController.add(self, name: qaMessageName)
        // Run transitions play tones without a click in the Orc home view.
        config.mediaTypesRequiringUserActionForPlayback = .video
        config.userContentController.add(
            self,
            name: AppDelegate.imageContextMessageName
        )
        config.userContentController.addUserScript(WKUserScript(
            source: Self.imageContextScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))
        config.userContentController.addUserScript(WKUserScript(
            source: Self.swipeFallbackScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        webView = PathDropWebView(frame: contentRect, configuration: config)
        webView.allowWebInspector()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        themeColorObservation = webView.observe(\.themeColor, options: [.initial, .new]) { [weak self] webView, _ in
            self?.tintTitlebar(webView.themeColor)
        }
        window.contentView = webView

        loadBaseURL()
        window.makeKeyAndOrderFront(nil)
    }

    func tintTitlebar(_ color: NSColor?) {
        window.backgroundColor = color ?? .windowBackgroundColor
        // Only the titlebar view takes the appearance: on the window it would
        // flip the page's prefers-color-scheme, which the System theme follows.
        let titlebar = window.standardWindowButton(.closeButton)?.superview
        guard let rgb = color?.usingColorSpace(.sRGB) else {
            titlebar?.appearance = nil
            return
        }
        let luminance = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
        titlebar?.appearance = NSAppearance(named: luminance < 0.5 ? .darkAqua : .aqua)
    }

    func loadBaseURL() {
        let urlString = pendingFragment.map { "\(baseURLString)#\($0)" } ?? baseURLString
        uiLoaded = false
        webView.load(URLRequest(url: URL(string: urlString) ?? baseURL))
    }

    @objc func showOrc(_ sender: Any?) {
        showWindow()
    }


    @objc func reloadUI(_ sender: Any?) {
        loadRetryCount = 0
        // ⌘R on a failed start tries the start again, so installing the
        // missing piece and pressing ⌘R is enough.
        if daemonStartFailure != nil {
            ensureDaemonRunning()
        }
        // Reload the current URL so the #hash (open run + tab) survives ⌘R;
        // loadBaseURL() drops the fragment and snaps back to the first run.
        // Fall back to base only from the error page, which has no live hash.
        if webView.url?.host == "127.0.0.1" {
            webView.reload()
        } else {
            loadBaseURL()
        }
    }

    // MARK: Install handoff

    // The daemon only goes away and come back when something reinstalled it,
    // so a returning stream means the served UI is new. Reload in place rather
    // than letting install.sh quit the app out from under the user: the window,
    // its size, and the open run and tab all survive.
    func daemonDidRestart() {
        DispatchQueue.main.async {
            self.reloadUI(nil)
            guard let launched = self.launchBinaryDigest,
                  let promoted = Self.binaryDigest(Self.promotedBinaryURL),
                  launched != promoted else { return }
            self.showUpdateAffordance()
        }
    }

    private static let promotedBinaryURL = URL(fileURLWithPath:
        "\(NSHomeDirectory())/.orc/runtime/current/Orc.app/Contents/MacOS/Orc")

    // Fail closed: an unreadable binary offers no restart rather than nagging
    // for an update that may not exist.
    private static func binaryDigest(_ url: URL?) -> Data? {
        guard let url, let bytes = try? Data(contentsOf: url) else { return nil }
        return Data(SHA256.hash(data: bytes))
    }

    // The installer replaces changed binaries after promotion. Keep a manual
    // restart available if its process handoff could not complete.
    private func showUpdateAffordance() {
        guard updateAccessory == nil, window != nil else { return }
        let button = NSButton(
            title: "Orc updated · Restart",
            target: self,
            action: #selector(restartForUpdate(_:))
        )
        button.bezelStyle = .rounded
        button.controlSize = .small
        // The button *is* the accessory view. Wrapping it in a plain container
        // collapses to a sliver at the window edge: the titlebar sizes an
        // accessory from its own frame, and an empty container's is zero.
        button.sizeToFit()
        button.setFrameSize(NSSize(
            width: button.frame.width + 10, height: button.frame.height))
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .right
        accessory.view = button
        window.addTitlebarAccessoryViewController(accessory)
        updateAccessory = accessory
    }

    // The single-instance guard at the entry point terminates any Orc that
    // starts while this one is alive, so the replacement has to wait for this
    // pid to go away before it opens.
    @objc func restartForUpdate(_ sender: Any?) {
        let pid = ProcessInfo.processInfo.processIdentifier
        let bundle = "\(NSHomeDirectory())/.orc/runtime/current/Orc.app"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c",
            "while kill -0 \(pid) 2>/dev/null; do sleep 0.1; done; exec open \"\(bundle)\""]
        try? process.run()
        NSApp.terminate(nil)
    }

    @objc func closeCurrentTab(_ sender: Any?) {
        guard let targetWindow = NSApp.keyWindow else { return }
        guard targetWindow === window else {
            targetWindow.performClose(sender)
            return
        }
        webView.evaluateJavaScript("window.orcCloseTerminalTab ? window.orcCloseTerminalTab() : false") { result, _ in
            if result as? Bool != true { targetWindow.performClose(sender) }
        }
    }

    @objc func findInArtifact(_ sender: Any?) {
        webView.evaluateJavaScript("window.orcOpenSettingsSearch?.() || window.orcOpenContentFind?.()", completionHandler: nil)
    }

    @objc func toggleFastMode(_ sender: Any?) {
        webView.evaluateJavaScript("window.orcRunFastModeShortcut?.()", completionHandler: nil)
    }

    // ⌘J shows or hides the terminal. In a run it reopens docked or maximised as
    // the user last left it; on home it is the project's root, maximised.
    @objc func toggleTerminal(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcToggleTerminal && window.orcToggleTerminal()", completionHandler: nil)
    }

    // The project switcher is a tier of the palette, which lives in the run page.
    @objc func switchProject(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcOpenSwitchProjectPalette && window.orcOpenSwitchProjectPalette()", completionHandler: nil)
    }

    // ⌘B toggles the side panel docked beside the run, from wherever focus is.
    @objc func toggleDiff(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcToggleDiff && window.orcToggleDiff()", completionHandler: nil)
    }

    @objc func toggleDictation(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcToggleDictation && window.orcToggleDictation()", completionHandler: nil)
    }

    // ⌘. stops the turn of the run in Chat. The menu claims the key, so it
    // reaches the page even where AppKit would read it as Cancel.
    @objc func stopAgent(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcStopChat && window.orcStopChat()", completionHandler: nil)
    }

    @objc func openCommandPalette(_ sender: Any?) {
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcOpenCommandPalette && window.orcOpenCommandPalette()", completionHandler: nil)
    }

    // ⌘N — open the new-conversation composer (#new) through the same entry
    // point as the browser shortcut, so it also dismisses whatever overlay is
    // on top and re-routes when #new is already the current hash. A plain
    // location.hash write does neither. navigate() still owns the case where
    // the webview holds the error page, via its pending-fragment retry.
    @objc func openNewConversation(_ sender: Any?) {
        guard webView.url?.host == "127.0.0.1" else {
            navigate(toFragment: "new")
            return
        }
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript(
            "window.orcOpenNewConversation ? window.orcOpenNewConversation() : (location.hash = '#new')",
            completionHandler: nil
        )
    }

    @objc func openModelPicker(_ sender: Any?) {
        guard webView.url?.host == "127.0.0.1" else {
            navigate(toFragment: "new")
            return
        }
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.orcOpenModelPicker && window.orcOpenModelPicker()", completionHandler: nil)
    }

    // ⌘, — toggle the Settings view through the same entry point as the
    // browser shortcut, so it also dismisses whatever overlay is on top and a
    // second press goes back to the view Settings was opened from. navigate()
    // still owns the case where the webview holds the error page.
    @objc func openSettings(_ sender: Any?) {
        guard webView.url?.host == "127.0.0.1" else {
            navigate(toFragment: "settings")
            return
        }
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript(
            "window.orcOpenSettings ? window.orcOpenSettings() : (location.hash = '#settings')",
            completionHandler: nil
        )
    }

    // ⇧⌘, — the Settings page of the project in view, through the page's own
    // opener; a page from before it existed falls back to plain Settings.
    @objc func openProjectSettings(_ sender: Any?) {
        guard webView.url?.host == "127.0.0.1" else {
            navigate(toFragment: "settings")
            return
        }
        showWindow()
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript(
            "window.orcOpenProjectSettings ? window.orcOpenProjectSettings() : window.orcOpenSettings ? window.orcOpenSettings() : (location.hash = '#settings')",
            completionHandler: nil
        )
    }

    func showLoadError() {
        let body: String
        if let failure = daemonStartFailure {
            body = """
            <h1>Orc couldn&rsquo;t start</h1>
            <pre>\(Self.escapeHTML(failure))</pre>
            <p>Fix that, then press &#8984;R to try again.</p>
            """
        } else {
            body = """
            <h1>orc-ui isn&rsquo;t reachable at \(Self.escapeHTML(baseURLString))</h1>
            <p>Start it with <code>orc-ui start</code>, then press &#8984;R to retry.</p>
            """
        }
        let html = """
        <html><head><meta name="color-scheme" content="light dark"><style>
        body { font: 15px -apple-system; color: #333; background: #f6f6f4; display: flex;
          align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        main { max-width: 640px; padding: 32px; }
        h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px; }
        pre { font: 12px ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere;
          background: rgba(127, 127, 127, 0.12); border-radius: 8px; padding: 12px 14px; }
        @media (prefers-color-scheme: dark) { body { color: #ddd; background: #1d1d1b; } }
        </style></head><body><main>\(body)</main></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    static func escapeHTML(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func navigate(
        toFragment fragment: String,
        foreground: Bool = true
    ) {
        DispatchQueue.main.async {
            if foreground {
                self.showWindow()
            }
            // Only touch location.hash when the UI is actually loaded — after
            // showLoadError() the webview holds the error page instead.
            let uiHost = self.webView.url?.host == "127.0.0.1"
            if self.uiLoaded && uiHost {
                let escaped = fragment.replacingOccurrences(of: "'", with: "\\'")
                self.webView.evaluateJavaScript("location.hash = '#\(escaped)'", completionHandler: nil)
            } else {
                self.pendingFragment = fragment.isEmpty ? nil : fragment
                // A load already in flight lands on the fragment in didFinish;
                // reissuing it would cancel that navigation and retry.
                guard !uiHost else { return }
                self.loadRetryCount = 0
                self.loadBaseURL()
            }
        }
    }

    // Signals to the Orc web UI that native desktop image actions (animated-GIF
    // pasteboard copy, NSSavePanel, and direct default-browser launch) are
    // available for the custom HTML image context menu.
    private static let imageContextScript = """
    (() => {
      if (location.origin !== 'http://127.0.0.1:\(port)') return;
      window.__orcNativeImageActions = true;
    })();
    """

    private func handleImageContextAction(_ action: String, url: URL, suggestedFilename: String) {
        let filename = sanitizedImageFilename(suggestedFilename, url: url)
        switch action {
        case "openOriginal":
            guard url.scheme == "http" || url.scheme == "https" else { return }
            openExternalURL(url, serverPort: port)
        case "copyImageAddress":
            guard url.scheme == "http" || url.scheme == "https" else { return }
            copyContextImageAddress(url: url)
        case "copyImage":
            guard url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == port else { return }
            copyContextImage(url: url, filename: filename)
        case "saveImage":
            guard url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == port else { return }
            saveContextImageAs(url: url, filename: filename)
        default:
            break
        }
    }

    private func sanitizedImageFilename(_ suggestedFilename: String, url: URL) -> String {
        let candidate = suggestedFilename.isEmpty ? url.lastPathComponent : suggestedFilename
        let filename = (candidate as NSString).lastPathComponent
        return filename.isEmpty ? "Image" : filename
    }

    private func copyContextImage(url: URL, filename: String) {
        loadImageData(from: url) { data in
            if !ImageClipboard.write(data, filename: filename, to: .general) {
                NSSound.beep()
            }
        }
    }

    private func copyContextImageAddress(url: URL) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.declareTypes([.URL, .string], owner: nil)
        pasteboard.setString(url.absoluteString, forType: .URL)
        pasteboard.setString(url.absoluteString, forType: .string)
    }

    private func saveContextImageAs(url: URL, filename: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let destination = panel.url else { return }
            self?.loadImageData(from: url) { data in
                do {
                    try data.write(to: destination, options: .atomic)
                } catch {
                    self?.showImageSaveError(error)
                }
            }
        }
    }

    private func loadImageData(from url: URL, completion: @escaping (Data) -> Void) {
        URLSession.shared.dataTask(with: url) { data, _, error in
            DispatchQueue.main.async {
                guard error == nil, let data = data, !data.isEmpty else {
                    NSSound.beep()
                    return
                }
                completion(data)
            }
        }.resume()
    }

    private func showImageSaveError(_ error: Error) {
        let alert = NSAlert(error: error)
        alert.beginSheetModal(for: window, completionHandler: nil)
    }

    // MARK: Menu

    func buildMainMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Orc", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Settings…", action: #selector(AppDelegate.openSettings(_:)), keyEquivalent: ",")
        let projectSettings = appMenu.addItem(withTitle: "Project Settings…", action: #selector(AppDelegate.openProjectSettings(_:)), keyEquivalent: ",")
        projectSettings.keyEquivalentModifierMask = [.command, .shift]
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Orc", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Orc", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // File menu
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "New Conversation", action: #selector(AppDelegate.openNewConversation(_:)), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Switch Project…", action: #selector(AppDelegate.switchProject(_:)), keyEquivalent: "p")
        fileMenu.addItem(withTitle: "Choose Model…", action: #selector(AppDelegate.openModelPicker(_:)), keyEquivalent: "m")
        let fastMode = fileMenu.addItem(withTitle: "Toggle Fast Mode", action: #selector(AppDelegate.toggleFastMode(_:)), keyEquivalent: "f")
        fastMode.keyEquivalentModifierMask = [.command, .shift]


        // Edit menu
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Command Palette…", action: #selector(AppDelegate.openCommandPalette(_:)), keyEquivalent: "k")
        editMenu.addItem(withTitle: "Find…", action: #selector(AppDelegate.findInArtifact(_:)), keyEquivalent: "f")

        // View menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Reload", action: #selector(AppDelegate.reloadKeyWindow(_:)), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Toggle Terminal", action: #selector(AppDelegate.toggleTerminal(_:)), keyEquivalent: "j")
        viewMenu.addItem(withTitle: "Toggle Side Panel", action: #selector(AppDelegate.toggleDiff(_:)), keyEquivalent: "b")
        viewMenu.addItem(withTitle: "Toggle Dictation", action: #selector(AppDelegate.toggleDictation(_:)), keyEquivalent: "d")
        viewMenu.addItem(withTitle: "Stop the Agent", action: #selector(AppDelegate.stopAgent(_:)), keyEquivalent: ".")

        // Window menu
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Close", action: #selector(AppDelegate.closeCurrentTab(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Show Orc", action: #selector(AppDelegate.showOrc(_:)), keyEquivalent: "0")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu

        shortcutMenuItems = [
            "settings": appMenu.item(withTitle: "Settings…"),
            "projectSettings": appMenu.item(withTitle: "Project Settings…"),
            "newConversation": fileMenu.item(withTitle: "New Conversation"),
            "switchProject": fileMenu.item(withTitle: "Switch Project…"),
            "modelPicker": fileMenu.item(withTitle: "Choose Model…"),
            "fastMode": fastMode,
            "commandPalette": editMenu.item(withTitle: "Command Palette…"),
            "contentFind": editMenu.item(withTitle: "Find…"),
            "terminal": viewMenu.item(withTitle: "Toggle Terminal"),
            "sidePanel": viewMenu.item(withTitle: "Toggle Side Panel"),
            "dictation": viewMenu.item(withTitle: "Toggle Dictation"),
            "stopAgent": viewMenu.item(withTitle: "Stop the Agent"),
        ].compactMapValues { $0 }
        shortcutMenuDefaults = shortcutMenuItems.mapValues { ($0.keyEquivalent, $0.keyEquivalentModifierMask) }
    }

    // The page sends every item: a key to use, or null for none. "suspend"
    // clears them all while Settings records a shortcut, so the keys reach it.
    func applyMenuShortcuts(_ body: [String: Any]) {
        let suspend = body["action"] as? String == "suspend"
        let items = body["items"] as? [String: Any] ?? [:]
        for (id, item) in shortcutMenuItems {
            if suspend {
                item.keyEquivalent = ""
                continue
            }
            guard let value = items[id] else {
                if let original = shortcutMenuDefaults[id] {
                    item.keyEquivalent = original.key
                    item.keyEquivalentModifierMask = original.modifiers
                }
                continue
            }
            guard let binding = value as? [String: Any], let key = binding["key"] as? String, key.count == 1 else {
                item.keyEquivalent = ""
                continue
            }
            var modifiers: NSEvent.ModifierFlags = []
            for name in binding["modifiers"] as? [String] ?? [] {
                switch name {
                case "command": modifiers.insert(.command)
                case "control": modifiers.insert(.control)
                case "option": modifiers.insert(.option)
                case "shift": modifiers.insert(.shift)
                default: break
                }
            }
            item.keyEquivalent = key
            item.keyEquivalentModifierMask = modifiers
        }
    }
}

// MARK: - WKScriptMessageHandler

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else { return }
        if message.name == "orcDictation" {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame, message.webView === webView,
                  origin.protocol == baseURL.scheme, origin.host == baseURL.host, origin.port == port,
                  let path = message.frameInfo.request.url?.path, ["/", "/index.html"].contains(path) else { return }
            if #available(macOS 26.0, *) {
                if body["action"] as? String == "start", !window.isVisible, let id = body["id"] as? String {
                    sendDictationEvent(["id": id, "state": "cancelled"])
                    return
                }
                if dictation == nil {
                    dictation = DesktopDictation { [weak self] payload in self?.sendDictationEvent(payload) }
                }
                dictation?.receive(body)
            } else if let id = body["id"] as? String {
                sendDictationEvent(["id": id, "state": "error", "message": "Dictation requires macOS 26 or later."])
            }
            return
        }
        if message.name == AppDelegate.shortcutsMessageName {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame, message.webView === webView,
                  origin.protocol == baseURL.scheme, origin.host == baseURL.host, origin.port == port else { return }
            applyMenuShortcuts(body)
            return
        }
        if message.name == AppDelegate.dockBadgeMessageName {
            let origin = message.frameInfo.securityOrigin
            guard message.frameInfo.isMainFrame, message.webView === webView,
                  origin.protocol == baseURL.scheme, origin.host == baseURL.host, origin.port == port else { return }
            NSApp.dockTile.badgeLabel = dockBadgeLabel(body["badge"])
            return
        }
        if message.name == qaMessageName {
            receiveQAMessage(message, body: body)
            return
        }
        guard message.name == AppDelegate.imageContextMessageName,
              message.webView === webView
        else { return }
        let origin = message.frameInfo.securityOrigin
        guard origin.protocol == baseURL.scheme,
              origin.host == baseURL.host,
              origin.port == port,
              let action = body["action"] as? String,
              let urlString = body["url"] as? String,
              let url = URL(string: urlString)
        else { return }

        let filename = body["filename"] as? String ?? ""
        handleImageContextAction(action, url: url, suggestedFilename: filename)
    }
}

// MARK: - NSWindowDelegate

extension AppDelegate: NSWindowDelegate {
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        dictation?.cancel()
        sender.orderOut(nil)
        return false
    }
}

// MARK: - WKNavigationDelegate

extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === self.webView {
            dictation?.cancel()
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === self.webView { webView.reload() }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // A target=_blank click inside the artifact iframe reaches navigation
        // policy first. Cancel after routing so the UI-delegate fallback cannot
        // turn one activation into a second open.
        if !navigationAction.shouldPerformDownload,
           routeNewWindowNavigation(
               navigationAction,
               in: webView,
               serverPort: port,
               openExternally: { openExternalURL($0, serverPort: port) }
           ) {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // A start that already failed will not come up by waiting.
        guard daemonStartFailure == nil, loadRetryCount < maxLoadRetries else { showLoadError(); return }
        loadRetryCount += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            self.loadBaseURL()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadRetryCount = 0
        uiLoaded = true
        if let fragment = pendingFragment {
            pendingFragment = nil
            let escaped = fragment.replacingOccurrences(of: "'", with: "\\'")
            webView.evaluateJavaScript("location.hash = '#\(escaped)'", completionHandler: nil)
        }
    }
}

// Stderr of `orc-ui start`, filled from the pipe's handler queue.
final class DaemonOutput {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock(); defer { lock.unlock() }
        // The tail is what explains a failure; a runaway writer cannot grow it.
        if data.count < 64 * 1024 { data.append(chunk) }
    }

    var text: String {
        lock.lock(); defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - WKDownloadDelegate

extension AppDelegate: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let filename = (suggestedFilename as NSString).lastPathComponent
        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename.isEmpty ? "Download" : filename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let destination = panel.url else {
                completionHandler(nil)
                return
            }
            if FileManager.default.fileExists(atPath: destination.path) {
                do {
                    try FileManager.default.removeItem(at: destination)
                } catch {
                    self?.showImageSaveError(error)
                    completionHandler(nil)
                    return
                }
            }
            completionHandler(destination)
        }
    }
}

// MARK: - WKUIDelegate

extension AppDelegate: WKUIDelegate {
    // Keep the native new-window callback as a fallback for WebKit navigation
    // that does not pass through the navigation-policy callback above.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        routeNewWindowNavigation(
            navigationAction,
            in: webView,
            serverPort: port,
            openExternally: { openExternalURL($0, serverPort: port) }
        )
        return nil
    }

    // Without these, WKWebView answers every confirm() with false and drops
    // every alert() — which reads in the UI as a button that silently does
    // nothing (the Tickets Delete button, for one).
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        presentPanel(on: webView, message: message, cancelButton: nil) { _ in
            completionHandler()
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        presentPanel(on: webView, message: message, cancelButton: "Cancel") { confirmed in
            completionHandler(confirmed)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        let finish = { (response: NSApplication.ModalResponse) in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
        guard let window = webView.window else { return finish(alert.runModal()) }
        if !window.isVisible { window.makeKeyAndOrderFront(nil) }
        alert.beginSheetModal(for: window, completionHandler: finish)
    }

    /// An <input type="file"> in a page asks for files here.
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        let finish = { (response: NSApplication.ModalResponse) in
            completionHandler(response == .OK ? panel.urls : nil)
        }
        guard let window = webView.window else { return finish(panel.runModal()) }
        if !window.isVisible { window.makeKeyAndOrderFront(nil) }
        panel.beginSheetModal(for: window, completionHandler: finish)
    }

    // The completion handler must run exactly once on every path, or the page's
    // JavaScript stays suspended forever.
    private func presentPanel(
        on webView: WKWebView,
        message: String,
        cancelButton: String?,
        finish: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        if let cancelButton { alert.addButton(withTitle: cancelButton) }
        guard let window = webView.window else {
            return finish(alert.runModal() == .alertFirstButtonReturn)
        }
        // ⌘W only orders the window out (see windowShouldClose), so the window
        // outlives it — a sheet attached to a hidden window would never end,
        // and the page's JavaScript would block behind a dialog nobody can see.
        if !window.isVisible { window.makeKeyAndOrderFront(nil) }
        alert.beginSheetModal(for: window) { response in
            finish(response == .alertFirstButtonReturn)
        }
    }
}

// MARK: - SSE Client

final class SSEClient: NSObject, URLSessionDataDelegate {
    let baseURL: URL
    weak var appDelegate: AppDelegate?
    var session: URLSession!
    var task: URLSessionDataTask?
    var buffer = Data()
    private var reconnecting = false

    init(baseURL: URL, appDelegate: AppDelegate) {
        self.baseURL = baseURL
        self.appDelegate = appDelegate
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = TimeInterval(Int.max)
        config.timeoutIntervalForResource = TimeInterval(Int.max)
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func start() {
        buffer.removeAll()
        let url = baseURL.appendingPathComponent("api/events")
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        task = session.dataTask(with: request)
        task?.resume()
    }

    func reconnect() {
        reconnecting = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.start()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // First bytes back after a drop prove the daemon is serving again — a
        // reload any earlier would just land on the unreachable error page.
        // The launch connection is not a reconnect and must not reload.
        if reconnecting {
            reconnecting = false
            appDelegate?.daemonDidRestart()
        }
        buffer.append(data)
        processBuffer()
    }

    func processBuffer() {
        // Split on newline bytes and decode per line — a malformed line can't
        // wedge the whole buffer, and a runaway line can't grow it unbounded.
        while let idx = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[buffer.startIndex..<idx]
            buffer.removeSubrange(buffer.startIndex...idx)
            if let line = String(data: lineData, encoding: .utf8) {
                handleLine(line)
            }
        }
        if buffer.count > 1_048_576 { buffer.removeAll() }
    }

    func handleLine(_ line: String) {
        if line.isEmpty { return }
        if line.hasPrefix(":") { return } // heartbeat
        guard line.hasPrefix("data: ") else { return }
        let jsonString = String(line.dropFirst("data: ".count))
        guard let jsonData = jsonString.data(using: .utf8) else { return }
        guard let payload = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return }
        guard let type = payload["type"] as? String else { return }

        switch type {
        case "navigate":
            let fragment = payload["fragment"] as? String ?? ""
            let auto = payload["auto"] as? Bool ?? false
            // Foregrounding is opt-in on daemon messages. Direct user paths
            // (orc:// links) call navigate() with its true default.
            let foreground = payload["foreground"] as? Bool ?? false
            // force: a duplicate forwarding a user-initiated orc:// link. It
            // just activated this instance, so bypass the active-app guard
            // below — otherwise the link focuses the app but never routes to
            // the run it was about.
            let force = payload["force"] as? Bool ?? false
            DispatchQueue.main.async {
                // The current page is sacred: auto (gate-driven) opens never
                // change it — foreground or background — so the app always
                // stays where the user left it (the run list surfaces new
                // gates instead). Explicit opens (browser handoff, CLI) still
                // navigate, but never while the user is actively in the app.
                // Forced forwards (orc:// links relayed from a duplicate)
                // always route.
                if !force && (auto || NSApp.isActive) { return }
                self.appDelegate?.navigate(toFragment: fragment, foreground: foreground)
            }
        default:
            break
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        reconnect()
    }
}

// MARK: - QA window

// A run's QA page (/qa/<runId>) gets a window of its own: the page draws the
// QA steps and reserves a rectangle for the selected browser tab. Each tab
// keeps its own WKWebView and history. The tabs use the default website data
// store so sign-ins persist. The page drives the pane through the
// orcQa message handler and hears back through orc-qa-browser events.

let qaMessageName = "orcQa"

/// Run ids become a URL path segment, so anything outside this set is ignored.
/// Checked per character: a regex `$` would also match before a final newline.
func isValidQARunID(_ value: String) -> Bool {
    let scalars = Array(value.unicodeScalars)
    guard let first = scalars.first, first.isASCII,
          CharacterSet.alphanumerics.contains(first) else { return false }
    return scalars.allSatisfy { scalar in
        scalar.isASCII && (CharacterSet.alphanumerics.contains(scalar) || "_.-".unicodeScalars.contains(scalar))
    }
}

func qaPageURL(runId: String, serverPort: Int) -> URL? {
    guard isValidQARunID(runId) else { return nil }
    return URL(string: "http://127.0.0.1:\(serverPort)/qa/\(runId)")
}

/// The pane only browses the web: http and https URLs with a host.
func qaPaneURL(_ value: String) -> URL? {
    guard let url = URL(string: value),
          let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let host = url.host, !host.isEmpty else { return nil }
    return url
}

/// Where the pane goes, from the rectangle the page reported in CSS px with
/// its origin top left. AppKit's origin is bottom left, so y flips. Nil hides
/// the pane: not visible, bad numbers, or less than 40 px either way once
/// clipped to the content view.
func qaPaneFrame(_ body: [String: Any], contentSize: CGSize) -> CGRect? {
    guard body["visible"] as? Bool == true,
          let x = body["x"] as? Double, let y = body["y"] as? Double,
          let width = body["width"] as? Double, let height = body["height"] as? Double,
          [x, y, width, height].allSatisfy({ $0.isFinite }) else { return nil }
    let minimum = 40.0
    let bounds = CGRect(origin: .zero, size: contentSize)
    let frame = CGRect(x: x, y: Double(contentSize.height) - y - height, width: width, height: height)
        .intersection(bounds)
    guard !frame.isNull, frame.width >= minimum, frame.height >= minimum else { return nil }
    return frame
}

/// A hole the page cuts in the pane, so its own controls floating over the
/// browser show and take the mouse there. One that does not `paint` stays
/// drawn by the pane and only lets the mouse through: Greg, whose face the
/// app draws on top (`QAGregOverlay`).
struct QACutout: Equatable {
    var rect: CGRect
    var radius: CGFloat
    var paint: Bool = true
}

let qaMaximumCutouts = 8

/// Cutouts from the page, in CSS px with the origin top left like the
/// viewport. Bad numbers and empty rects are skipped; a missing list clears.
func qaPaneCutouts(_ body: [String: Any]) -> [QACutout] {
    guard let rects = body["rects"] as? [Any] else { return [] }
    var cutouts: [QACutout] = []
    for case let item as [String: Any] in rects {
        guard cutouts.count < qaMaximumCutouts,
              let x = item["x"] as? Double, let y = item["y"] as? Double,
              let width = item["width"] as? Double, let height = item["height"] as? Double else { continue }
        let radius: Double
        if item["radius"] == nil {
            radius = 0
        } else if let value = item["radius"] as? Double {
            radius = value
        } else {
            continue
        }
        guard [x, y, width, height, radius].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { continue }
        cutouts.append(QACutout(
            rect: CGRect(x: x, y: y, width: width, height: height),
            radius: min(max(radius, 0), min(width, height) / 2),
            paint: item["paint"] as? Bool != false
        ))
    }
    return cutouts
}

/// Cutouts in the pane's own coordinates. The pane's frame is in AppKit
/// content coordinates (origin bottom left); a flipped pane counts y down
/// from its top. Cutouts that miss the pane are dropped; the rest keep their
/// full size so rounded corners stay round at the pane's edge.
func qaPaneLocalCutouts(_ cutouts: [QACutout], paneFrame: CGRect, contentHeight: CGFloat, flipped: Bool) -> [QACutout] {
    let bounds = CGRect(origin: .zero, size: paneFrame.size)
    return cutouts.compactMap { cutout in
        let rect = cutout.rect
        let y = flipped
            ? rect.minY - (contentHeight - paneFrame.maxY)
            : contentHeight - rect.maxY - paneFrame.minY
        let local = CGRect(x: rect.minX - paneFrame.minX, y: y, width: rect.width, height: rect.height)
        guard local.intersects(bounds) else { return nil }
        return QACutout(rect: local, radius: cutout.radius, paint: cutout.paint)
    }
}

func qaCutoutPath(_ cutout: QACutout) -> CGPath {
    CGPath(roundedRect: cutout.rect, cornerWidth: cutout.radius, cornerHeight: cutout.radius, transform: nil)
}

func qaCutoutsContain(_ cutouts: [QACutout], _ point: CGPoint) -> Bool {
    cutouts.contains { qaCutoutPath($0).contains(point) }
}

/// What the pane still paints: its bounds less every painting cutout, filled
/// with the even-odd rule. Subtracting first keeps two overlapping cutouts
/// both open, which even-odd alone would paint back in.
func qaPaneMaskPath(bounds: CGRect, cutouts: [QACutout]) -> CGPath {
    let holes = CGMutablePath()
    cutouts.filter(\.paint).forEach { holes.addPath(qaCutoutPath($0)) }
    if #available(macOS 13.0, *) {
        return CGPath(rect: bounds, transform: nil).subtracting(holes, using: .winding)
    }
    let path = CGMutablePath()
    path.addRect(bounds)
    path.addPath(holes)
    return path
}

/// The cutouts as the pane uses them. Greg's stops painting only while the
/// app draws his face over it; until his face has loaded, or when it never
/// does, he keeps a hole and the page's own Greg shows through it.
func qaPaneCutoutsDrawn(_ cutouts: [QACutout], faceShown: Bool) -> [QACutout] {
    faceShown ? cutouts : cutouts.map { QACutout(rect: $0.rect, radius: $0.radius) }
}

/// Greg as the app draws him over the pane: where he sits, in CSS px with
/// the origin top left, his face, and his working dot's colours as `#rrggbb`
/// while he works with his card closed.
struct QAGreg: Equatable {
    var rect: CGRect
    var face: URL
    var dot: String?
    var dotRing: String?
}

/// Greg from a `cutouts` message, or nil when there is none or it is not one.
/// His face only loads from the QA page's own server.
func qaGreg(_ body: [String: Any], pageURL: URL) -> QAGreg? {
    guard let item = body["greg"] as? [String: Any],
          let x = item["x"] as? Double, let y = item["y"] as? Double,
          let width = item["width"] as? Double, let height = item["height"] as? Double,
          [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0,
          let raw = item["face"] as? String, let face = qaPaneURL(raw),
          face.scheme == pageURL.scheme, face.host == pageURL.host, face.port == pageURL.port else { return nil }
    let dot = qaColor(item["dot"]) == nil ? nil : item["dot"] as? String
    return QAGreg(
        rect: CGRect(x: x, y: y, width: width, height: height),
        face: face,
        dot: dot,
        dotRing: dot == nil || qaColor(item["dotRing"]) == nil ? nil : item["dotRing"] as? String
    )
}

/// A `#rrggbb` colour, or nil.
func qaColor(_ value: Any?) -> CGColor? {
    guard let text = value as? String, text.count == 7, text.hasPrefix("#"),
          text.dropFirst().allSatisfy({ $0.isHexDigit }),
          let rgb = UInt32(text.dropFirst(), radix: 16) else { return nil }
    let part = { (shift: UInt32) in CGFloat((rgb >> shift) & 0xff) / 255 }
    return CGColor(srgbRed: part(16), green: part(8), blue: part(0), alpha: 1)
}

/// Where his working dot sits in a box `size` big counted from the bottom
/// left, as the QA page draws it: 14 px round, 4 px from his top and 12 px
/// in from his right.
func qaGregDotFrame(_ size: CGSize) -> CGRect {
    CGRect(x: size.width - 12 - 14, y: size.height - 4 - 14, width: 14, height: 14)
}

enum QALinkDestination: Equatable {
    case stay
    case external(URL)
    case mainHash(String)
    case mainLoad(URL)
    case qaWindow(String)
}

/// The QA page never navigates away from itself. Its links go where the main
/// window would send them: the default browser, or Orc's main window.
func qaLinkDestination(_ url: URL, runId: String, serverPort: Int) -> QALinkDestination {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == "about" { return .stay }
    guard scheme == "http" || scheme == "https" else { return .external(url) }
    if scheme == "http", url.host == "127.0.0.1", url.port == serverPort, url.path.hasPrefix("/qa/") {
        let other = String(url.path.dropFirst("/qa/".count))
        if other == runId { return .stay }
        if isValidQARunID(other) { return .qaWindow(other) }
    }
    if shouldOpenNewWindowURLExternally(url, serverPort: serverPort) { return .external(url) }
    if ["", "/", "/index.html"].contains(url.path) { return .mainHash(url.fragment ?? "") }
    return .mainLoad(url)
}

/// A fragment navigate(toFragment:) can carry: it splices the fragment into
/// a single-quoted script escaping only quotes, so anything that could end
/// that string or line is refused.
func isSafePendingFragment(_ fragment: String) -> Bool {
    !fragment.unicodeScalars.contains { scalar in
        scalar == "\\" || scalar == "'" || scalar.value < 0x20 || scalar.value == 0x7F
            || scalar == "\u{2028}" || scalar == "\u{2029}"
    }
}

/// Sets the main page's location.hash so the single-page app routes without a
/// reload. The hash travels as a JSON string, never spliced in raw.
func qaHashScript(_ hash: String) -> String? {
    let fragment = hash.hasPrefix("#") ? String(hash.dropFirst()) : hash
    guard let data = try? JSONSerialization.data(withJSONObject: "#" + fragment, options: .fragmentsAllowed),
          let literal = String(data: data, encoding: .utf8) else { return nil }
    return "location.hash = \(literal)"
}

func qaBrowserEventScript(_ detail: [String: Any]) -> String? {
    guard JSONSerialization.isValidJSONObject(detail),
          let data = try? JSONSerialization.data(withJSONObject: detail),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return "window.dispatchEvent(new CustomEvent('orc-qa-browser', { detail: \(json) }))"
}

/// The page scripts app plugins add to the pane (ui/js/qa-plugins.js), or nil
/// for a message that is not a list of at most 16 non-empty scripts under
/// 1 MB each. An empty list removes them all.
func qaPageScripts(_ body: [String: Any]) -> [String]? {
    guard let rows = body["scripts"] as? [[String: Any]], rows.count <= 16 else { return nil }
    let sources = rows.compactMap { $0["source"] as? String }
    guard sources.count == rows.count,
          sources.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1_048_576 }) else { return nil }
    return sources
}

/// A press on a plugin's toolbar button: which plugin, which button, and the
/// button's middle in px from the pane's left edge. Ids are plugin ids.
func qaPluginPress(_ body: [String: Any]) -> (plugin: String, button: String, center: Double)? {
    func isIdentifier(_ value: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard let first = scalars.first, scalars.count <= 64, ("a"..."z").contains(first) else { return false }
        return scalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
    }
    guard let plugin = body["plugin"] as? String, isIdentifier(plugin),
          let button = body["button"] as? String, isIdentifier(button),
          let center = body["center"] as? Double, center.isFinite else { return nil }
    return (plugin, button, center)
}

/// Snapshots are scaled so the longer side is at most `maximumSide` pixels.
func qaSnapshotPixelSize(width: Int, height: Int, maximumSide: Int = 2000) -> (width: Int, height: Int) {
    let longer = max(width, height)
    guard longer > maximumSide, longer > 0 else { return (width, height) }
    let scale = Double(maximumSide) / Double(longer)
    return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
}

extension AppDelegate {
    /// Every orcQa message: main frame on Orc's own origin, from the main web
    /// view or a QA window's page. The pane never registers the handler.
    func receiveQAMessage(_ message: WKScriptMessage, body: [String: Any]) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == baseURL.scheme, origin.host == baseURL.host, origin.port == port,
              let action = body["action"] as? String else { return }
        let qaWindow = qaWindows.values.first { $0.webView === message.webView }
        guard message.webView === webView || qaWindow != nil else { return }
        switch action {
        case "open":
            guard let runId = body["runId"] as? String else { return }
            openQAWindow(runId: runId)
        case "open-run":
            guard let hash = body["hash"] as? String else { return }
            openRunInMainWindow(hash: hash)
        case "open-external":
            guard let raw = body["url"] as? String, let url = qaPaneURL(raw) else { return }
            openExternalURL(url, serverPort: port)
        default:
            // The pane's actions come only from that QA window's own page.
            qaWindow?.receive(action: action, body: body)
        }
    }

    func openQAWindow(runId: String) {
        guard let pageURL = qaPageURL(runId: runId, serverPort: port) else { return }
        NSApp.activate(ignoringOtherApps: true)
        if let existing = qaWindows[runId] {
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let controller = QAWindowController(
            runId: runId,
            pageURL: pageURL,
            app: self,
            cascadeFrom: NSApp.keyWindow.flatMap { key in qaWindows.values.first { $0.window === key }?.window }
        ) { [weak self] closed in
            if self?.qaWindows[closed.runId] === closed { self?.qaWindows[closed.runId] = nil }
        }
        qaWindows[runId] = controller
        controller.window.makeKeyAndOrderFront(nil)
    }

    func openRunInMainWindow(hash: String) {
        showWindow()
        guard uiLoaded, webView.url?.host == "127.0.0.1", let script = qaHashScript(hash) else {
            // The error page or a load in flight: navigate() keeps the
            // fragment, but only one its script splicing cannot break out of.
            let fragment = hash.hasPrefix("#") ? String(hash.dropFirst()) : hash
            if isSafePendingFragment(fragment) { navigate(toFragment: fragment) }
            return
        }
        window.makeFirstResponder(webView)
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func openInMainWindow(_ url: URL) {
        showWindow()
        webView.load(URLRequest(url: url))
    }

    // ⌘R reloads the key QA window's pane, or its page when no pane shows;
    // anywhere else it is the main window's reload, unchanged.
    @objc func reloadKeyWindow(_ sender: Any?) {
        if let key = NSApp.keyWindow, let qaWindow = qaWindows.values.first(where: { $0.window === key }) {
            qaWindow.reloadFromMenu()
            return
        }
        reloadUI(sender)
    }

    func closeQAWindowsForTermination() {
        // The app exits right after this, so give the chat closes a moment
        // to leave; the server is local and answers fast.
        let closing = DispatchGroup()
        for qaWindow in qaWindows.values { qaWindow.tearDown(group: closing) }
        _ = closing.wait(timeout: .now() + 0.5)
        qaWindows.removeAll()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: qaMessageName)
    }
}

/// The pane neither paints nor takes the mouse inside the page's cutouts, so
/// AppKit hit-tests the page's web view beneath instead.
final class QAPaneWebView: WKWebView {
    var observations: [NSKeyValueObservation] = []
    // Pane-local, in this view's own (flipped or not) coordinates.
    var cutouts: [QACutout] = [] {
        didSet { if cutouts != oldValue { applyMask() } }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        // AppKit passes the point in the superview's coordinates.
        if !cutouts.isEmpty, let superview, qaCutoutsContain(cutouts, convert(point, from: superview)) {
            return nil
        }
        return super.hitTest(point)
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        if !cutouts.isEmpty { applyMask() }
    }

    private func applyMask() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard cutouts.contains(where: \.paint) else {
            layer?.mask = nil
            return
        }
        wantsLayer = true
        guard let layer else { return }
        let mask = layer.mask as? CAShapeLayer ?? CAShapeLayer()
        mask.frame = layer.bounds
        // The path is in view coordinates; a flipped view's layer counts y
        // from the top as well.
        mask.isGeometryFlipped = false
        mask.fillRule = .evenOdd
        mask.path = qaPaneMaskPath(bounds: bounds, cutouts: cutouts)
        layer.mask = mask
    }
}

/// Greg's face, drawn by the app over the pane so the tested page shows
/// around him, as it does in a browser. It covers the pane exactly and clips
/// him to it. It never takes the mouse: the pane lets presses on him through
/// to the QA page, whose own Greg handles clicks, drags and keys.
final class QAGregOverlay: NSView {
    private let faceLayer = CALayer()
    private let dotLayer = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        faceLayer.contentsGravity = .resizeAspect
        faceLayer.isHidden = true
        // The page's drop-shadow(0 6px 10px rgb(0 0 0 / .35)).
        faceLayer.shadowColor = CGColor(gray: 0, alpha: 1)
        faceLayer.shadowOpacity = 0.35
        faceLayer.shadowRadius = 5
        faceLayer.shadowOffset = CGSize(width: 0, height: -6)
        dotLayer.borderWidth = 2
        dotLayer.cornerRadius = 7
        dotLayer.isHidden = true
        faceLayer.addSublayer(dotLayer)
        layer?.addSublayer(faceLayer)
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// `rect` is in this view's coordinates; nil, or no face yet, hides him.
    func show(rect: CGRect?, face: NSImage?, dot: CGColor?, dotRing: CGColor?) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard let rect, let face else {
            faceLayer.isHidden = true
            return
        }
        faceLayer.isHidden = false
        faceLayer.frame = rect
        faceLayer.contentsScale = window?.backingScaleFactor ?? 2
        if faceLayer.contents as? NSImage !== face { faceLayer.contents = face }
        dotLayer.frame = qaGregDotFrame(rect.size)
        dotLayer.isHidden = dot == nil
        dotLayer.backgroundColor = dot
        dotLayer.borderColor = dotRing ?? dot
        // The page's dot pulses between 35% and full, once a second.
        if dot == nil || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            dotLayer.removeAnimation(forKey: "pulse")
        } else if dotLayer.animation(forKey: "pulse") == nil {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 0.35
            pulse.toValue = 1
            pulse.duration = 0.5
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            dotLayer.add(pulse, forKey: "pulse")
        }
    }
}

final class QAWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    static let autosaveName = "OrcQAWindow"
    private static let qaTabID = "qa"

    let runId: String
    let pageURL: URL
    let window: NSWindow
    let webView: WKWebView
    private var browserTabs: [String: QAPaneWebView] = [:]
    private var selectedBrowserTabID = QAWindowController.qaTabID
    private var pane: QAPaneWebView? { browserTabs[selectedBrowserTabID] }
    private var visiblePane: QAPaneWebView? {
        guard let pane, !pane.isHidden else { return nil }
        return pane
    }
    private unowned let app: AppDelegate
    private let onClose: (QAWindowController) -> Void
    // The last rectangle the page reserved, kept until the pane exists.
    private var paneFrame: CGRect?
    // The page's last cutouts, in its own coordinates, kept for a pane that
    // does not exist yet or moves later.
    private var cutouts: [QACutout] = []
    // Greg as the page last placed him, and his face once it has loaded.
    private var greg: QAGreg?
    private let gregOverlay = QAGregOverlay(frame: .zero)
    private var faceURL: URL?
    private var face: NSImage?
    private var titleObservation: NSKeyValueObservation?
    private var statePending = false
    private var closed = false
    // App plugins' page scripts run in a content world of their own: the
    // tested page's scripts can neither see nor call them.
    static let pluginWorld = WKContentWorld.world(name: "orc-qa-plugins")
    private var pageScripts: [String] = []

    init(
        runId: String,
        pageURL: URL,
        app: AppDelegate,
        cascadeFrom: NSWindow?,
        onClose: @escaping (QAWindowController) -> Void
    ) {
        self.runId = runId
        self.pageURL = pageURL
        self.app = app
        self.onClose = onClose
        let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, visible.width), height: min(900, visible.height))
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        // The controller owns the window; AppKit releasing it on close as well
        // would free it twice.
        window.isReleasedWhenClosed = false
        window.title = "QA"
        window.contentMinSize = NSSize(width: 900, height: 600)

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "OrcApp"
        config.userContentController.add(app, name: qaMessageName)
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        webView = WKWebView(frame: container.bounds, configuration: config)
        webView.allowWebInspector()
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        super.init()

        window.contentView = container
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        titleObservation = webView.observe(\.title, options: [.initial, .new]) { [weak self] webView, _ in
            let title = webView.title ?? ""
            MainActor.assumeIsolated { self?.window.title = title.isEmpty ? "QA" : title }
        }

        restoreWindowFrame(window, autosaveName: Self.autosaveName) {
            if let cascadeFrom {
                self.window.setFrameTopLeftPoint(NSPoint(x: cascadeFrom.frame.minX + 24, y: cascadeFrom.frame.maxY - 24))
            }
        }
        webView.load(URLRequest(url: pageURL))
    }

    func receive(action: String, body: [String: Any]) {
        guard !closed else { return }
        switch action {
        case "viewport":
            paneFrame = qaPaneFrame(body, contentSize: window.contentView?.bounds.size ?? .zero)
            placePane()
        case "cutouts":
            cutouts = qaPaneCutouts(body)
            greg = qaGreg(body, pageURL: pageURL)
            if let url = greg?.face { loadFace(url) }
            applyCutouts()
        case "select-browser-tab":
            guard let tabID = body["tabId"] as? String, !tabID.isEmpty else { return }
            selectBrowserTab(tabID)
        case "close-browser-tab":
            guard let tabID = body["tabId"] as? String else { return }
            closeBrowserTab(tabID)
        case "navigate":
            guard let raw = body["url"] as? String, let url = qaPaneURL(raw) else { return }
            let pane = ensurePane()
            if pane.url?.absoluteString == url.absoluteString, !pane.isLoading {
                // A reloaded page asks again; it still needs to hear the state.
                scheduleState()
                return
            }
            pane.load(URLRequest(url: url))
        case "back": pane?.goBack()
        case "forward": pane?.goForward()
        case "reload": pane?.reload()
        case "snapshot":
            guard let requestId = body["requestId"] as? String else { return }
            snapshot(requestId: requestId)
        case "copy-screenshot":
            copyScreenshot()
        case "page-scripts":
            guard let scripts = qaPageScripts(body), scripts != pageScripts else { return }
            pageScripts = scripts
            for pane in browserTabs.values {
                installPageScripts(pane.configuration.userContentController)
                // A page already loaded ran with the old scripts.
                if pane.url != nil { pane.reload() }
            }
        case "plugin-button":
            guard let press = qaPluginPress(body) else { return }
            pressPluginButton(press)
        default: break
        }
    }

    func reloadFromMenu() {
        if let pane = visiblePane {
            pane.reload()
        } else if webView.url?.path == pageURL.path {
            webView.reload()
        } else {
            webView.load(URLRequest(url: pageURL))
        }
    }

    // MARK: Pane

    private func selectBrowserTab(_ tabID: String) {
        if tabID != selectedBrowserTabID {
            if let pane { hidePane(pane) }
            selectedBrowserTabID = tabID
            placePane()
        }
        scheduleState()
    }

    private func closeBrowserTab(_ tabID: String) {
        guard tabID != Self.qaTabID else { return }
        if tabID == selectedBrowserTabID { selectBrowserTab(Self.qaTabID) }
        if let pane = browserTabs.removeValue(forKey: tabID) { removePane(pane) }
    }

    private func ensurePane() -> QAPaneWebView {
        if let pane { return pane }
        let config = WKWebViewConfiguration()
        // Cookies persist with the app, so a sign-in survives the window.
        // No OrcApp user agent and no Orc handlers: the page in here is just a
        // page, and must not reach the app.
        config.websiteDataStore = .default()
        installPageScripts(config.userContentController)
        let pane = QAPaneWebView(frame: .zero, configuration: config)
        pane.allowWebInspector()
        pane.allowsBackForwardNavigationGestures = true
        pane.navigationDelegate = self
        pane.uiDelegate = self
        pane.isHidden = true
        window.contentView?.addSubview(pane, positioned: .above, relativeTo: webView)
        let changed: (QAPaneWebView) -> Void = { [weak self] pane in
            MainActor.assumeIsolated {
                guard let self, pane === self.pane else { return }
                self.scheduleState()
            }
        }
        pane.observations = [
            pane.observe(\.url) { pane, _ in changed(pane) },
            pane.observe(\.title) { pane, _ in changed(pane) },
            pane.observe(\.isLoading) { pane, _ in changed(pane) },
            pane.observe(\.canGoBack) { pane, _ in changed(pane) },
            pane.observe(\.canGoForward) { pane, _ in changed(pane) },
        ]
        browserTabs[selectedBrowserTabID] = pane
        placePane()
        return pane
    }

    private func installPageScripts(_ controller: WKUserContentController) {
        controller.removeAllUserScripts()
        for source in pageScripts {
            controller.addUserScript(WKUserScript(
                source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: Self.pluginWorld))
        }
    }

    // Calls the handler the plugin's page script registered for the button,
    // and tells the page whether the plugin's panel is now open.
    private func pressPluginButton(_ press: (plugin: String, button: String, center: Double)) {
        let tabID = selectedBrowserTabID
        let answer = { [weak self] (open: Bool) -> Void in
            self?.send(["type": "plugin-button", "tabId": tabID,
                        "plugin": press.plugin, "button": press.button, "open": open])
        }
        guard let pane = visiblePane, pane.url != nil else {
            answer(false)
            return
        }
        pane.callAsyncJavaScript(
            "return window.__orcQa ? window.__orcQa.press(plugin, button, { center: center }) : null",
            arguments: ["plugin": press.plugin, "button": press.button, "center": press.center],
            in: nil,
            in: Self.pluginWorld
        ) { [weak self, weak pane] result in
            MainActor.assumeIsolated {
                guard let self, let pane, pane === self.visiblePane else { return }
                answer((try? result.get()) as? Bool ?? false)
            }
        }
    }

    private func placePane() {
        guard let pane else { return }
        guard let paneFrame else {
            hidePane(pane)
            return
        }
        pane.frame = paneFrame
        pane.isHidden = false
        if gregOverlay.superview == nil {
            window.contentView?.addSubview(gregOverlay, positioned: .above, relativeTo: pane)
        }
        gregOverlay.frame = paneFrame
        gregOverlay.isHidden = false
        applyCutouts()
    }

    private func hidePane(_ pane: QAPaneWebView) {
        if let responder = window.firstResponder as? NSView, responder.isDescendant(of: pane) {
            window.makeFirstResponder(webView)
        }
        pane.isHidden = true
        gregOverlay.isHidden = true
        gregOverlay.removeFromSuperview()
    }

    // Cutouts follow the page, so they move into pane coordinates each time
    // the pane moves. Greg moves with them: his face is drawn over the pane
    // where the page lets presses through to its own Greg.
    private func applyCutouts() {
        guard let pane else { return }
        let contentHeight = window.contentView?.bounds.height ?? 0
        let spot = greg.flatMap { greg in
            qaPaneLocalCutouts(
                [QACutout(rect: greg.rect, radius: 0)],
                paneFrame: gregOverlay.frame,
                contentHeight: contentHeight,
                flipped: gregOverlay.isFlipped
            ).first?.rect
        }
        let shownFace = greg?.face == faceURL ? face : nil
        pane.cutouts = qaPaneLocalCutouts(
            qaPaneCutoutsDrawn(cutouts, faceShown: spot != nil && shownFace != nil),
            paneFrame: pane.frame,
            contentHeight: contentHeight,
            flipped: pane.isFlipped
        )
        gregOverlay.show(
            rect: spot,
            face: shownFace,
            dot: qaColor(greg?.dot),
            dotRing: qaColor(greg?.dotRing)
        )
    }

    // The face changes with the theme, so it loads once per address; a
    // later address wins over one still loading. One that fails is not asked
    // for again until the page reloads, and Greg keeps his hole meanwhile.
    private func loadFace(_ url: URL) {
        guard url != faceURL else { return }
        faceURL = url
        face = nil
        URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            let image = ok ? data.flatMap { NSImage(data: $0) } : nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, !self.closed, self.faceURL == url else { return }
                    self.face = image
                    self.applyCutouts()
                }
            }
        }.resume()
    }

    // KVO fires several times per load step; the page hears once per turn.
    private func scheduleState() {
        guard !statePending, !closed else { return }
        statePending = true
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.statePending = false
                self.sendState()
            }
        }
    }

    private func sendState() {
        guard !closed else { return }
        send([
            "type": "state",
            "tabId": selectedBrowserTabID,
            "url": pane?.url?.absoluteString ?? "",
            "title": pane?.title ?? "",
            "canGoBack": pane?.canGoBack ?? false,
            "canGoForward": pane?.canGoForward ?? false,
            "loading": pane?.isLoading ?? false,
        ])
    }

    // The detail is JSON from JSONSerialization, and only the QA page itself
    // hears it.
    private func send(_ detail: [String: Any]) {
        guard !closed, webView.url?.path == pageURL.path, webView.url?.port == pageURL.port,
              let script = qaBrowserEventScript(detail) else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // Every request gets exactly one answer, an image or an error.
    private func snapshot(requestId: String) {
        capturePane { [weak self] image, error in
            guard let self else { return }
            guard let image, let png = Self.snapshotPNG(image) else {
                self.send(["type": "snapshot", "requestId": requestId,
                           "error": error ?? "The page could not be captured."])
                return
            }
            self.send([
                "type": "snapshot",
                "requestId": requestId,
                "dataUrl": "data:image/png;base64," + png.base64EncodedString(),
            ])
        }
    }

    private func copyScreenshot() {
        capturePane { [weak self] image, error in
            guard let self else { return }
            var detail: [String: Any] = ["type": "copy-screenshot"]
            if let image {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                if !pasteboard.writeObjects([image]) {
                    detail["error"] = "The screenshot could not be copied."
                }
            } else {
                detail["error"] = error ?? "The page could not be captured."
            }
            self.send(detail)
        }
    }

    private func capturePane(_ completion: @escaping (NSImage?, String?) -> Void) {
        guard let pane = visiblePane, pane.url != nil else {
            completion(nil, "No page is showing in the browser.")
            return
        }
        pane.takeSnapshot(with: nil) { [weak self, weak pane] image, error in
            guard let self, !self.closed else { return }
            guard let pane, pane === self.visiblePane else {
                completion(nil, "The browser tab changed before the page could be captured.")
                return
            }
            completion(image, error?.localizedDescription)
        }
    }

    private static func snapshotPNG(_ image: NSImage) -> Data? {
        guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let size = qaSnapshotPixelSize(width: source.width, height: source.height)
        var output = source
        if size.width != source.width || size.height != source.height {
            guard let context = CGContext(
                data: nil, width: size.width, height: size.height, bitsPerComponent: 8,
                bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
            context.interpolationQuality = .high
            context.draw(source, in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
            guard let scaled = context.makeImage() else { return nil }
            output = scaled
        }
        return NSBitmapImageRep(cgImage: output).representation(using: .png, properties: [:])
    }

    // MARK: Closing

    func windowWillClose(_ notification: Notification) {
        tearDown()
        onClose(self)
    }

    /// Drops observers, delegates and the message handler, and frees the panes.
    /// Safe to call twice: quitting tears down windows that may close later.
    /// Quitting passes a group so it can wait briefly for the chat to close.
    func tearDown(group: DispatchGroup? = nil) {
        guard !closed else { return }
        closed = true
        closeChat(group: group)
        titleObservation?.invalidate()
        titleObservation = nil
        browserTabs.values.forEach(removePane)
        browserTabs.removeAll()
        gregOverlay.removeFromSuperview()
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: qaMessageName)
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    private func removePane(_ pane: QAPaneWebView) {
        pane.observations.forEach { $0.invalidate() }
        pane.observations.removeAll()
        pane.navigationDelegate = nil
        pane.uiDelegate = nil
        pane.stopLoading()
        pane.removeFromSuperview()
    }

    // The window's chat with Greg is throwaway, so the server deletes it when
    // the window goes. An older server answers 404, which is fine.
    private func closeChat(group: DispatchGroup?) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/runs/\(runId)/qa/chat") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 2.0
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": "close"])
        group?.enter()
        URLSession.shared.dataTask(with: request) { _, _, _ in group?.leave() }.resume()
    }

    // MARK: Navigation

    private func follow(_ destination: QALinkDestination) {
        switch destination {
        case .stay: break
        case .external(let url): openExternalURL(url, serverPort: port)
        case .mainHash(let hash): app.openRunInMainWindow(hash: hash)
        case .mainLoad(let url): app.openInMainWindow(url)
        case .qaWindow(let runId): app.openQAWindow(runId: runId)
        }
    }

    /// A new-window request from the visible pane stays in that pane.
    private func loadInPane(_ url: URL?, from source: WKWebView) {
        guard source === visiblePane, let url, qaPaneURL(url.absoluteString) != nil else { return }
        source.load(URLRequest(url: url))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if webView is QAPaneWebView {
            guard navigationAction.targetFrame == nil else {
                decisionHandler(navigationAction.shouldPerformDownload ? .cancel : .allow)
                return
            }
            loadInPane(navigationAction.request.url, from: webView)
            decisionHandler(.cancel)
            return
        }
        // The QA page: subframes load as usual; the page itself never leaves.
        let opensWindow = navigationAction.targetFrame == nil
        guard opensWindow || navigationAction.targetFrame?.isMainFrame == true,
              let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let destination = qaLinkDestination(url, runId: runId, serverPort: port)
        if destination == .stay, !opensWindow, !navigationAction.shouldPerformDownload {
            decisionHandler(.allow)
            return
        }
        follow(destination)
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // Downloads are not handled here; a file the pane cannot show is dropped.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !closed else { return }
        webView.reload()
    }

    // A reloaded QA page has no Greg or card until it says where they are,
    // and asks for his face afresh.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === self.webView, !closed else { return }
        cutouts = []
        greg = nil
        faceURL = nil
        face = nil
        paneFrame = nil
        for id in Array(browserTabs.keys) where id != Self.qaTabID { closeBrowserTab(id) }
        selectBrowserTab(Self.qaTabID)
        placePane()
    }

    // MARK: Panels

    // Navigation policy above handles target=_blank links; window.open
    // reaches only this callback.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if webView is QAPaneWebView {
            loadInPane(navigationAction.request.url, from: webView)
        } else if let url = navigationAction.request.url {
            follow(qaLinkDestination(url, runId: runId, serverPort: port))
        }
        return nil
    }

    private func canPresentPanel(from source: WKWebView) -> Bool {
        !closed && (source === webView || source === visiblePane)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        guard canPresentPanel(from: webView) else { return completionHandler() }
        app.webView(webView, runJavaScriptAlertPanelWithMessage: message,
                    initiatedByFrame: frame, completionHandler: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard canPresentPanel(from: webView) else { return completionHandler(false) }
        app.webView(webView, runJavaScriptConfirmPanelWithMessage: message,
                    initiatedByFrame: frame, completionHandler: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        guard canPresentPanel(from: webView) else { return completionHandler(nil) }
        app.webView(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText,
                    initiatedByFrame: frame, completionHandler: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard canPresentPanel(from: webView) else { return completionHandler(nil) }
        app.webView(webView, runOpenPanelWith: parameters,
                    initiatedByFrame: frame, completionHandler: completionHandler)
    }
}

// MARK: - Dropped folders

/// A page sees a dropped folder only as a File with no path, so the app reads
/// the paths off the drag pasteboard and hands them to the page.
enum DroppedPaths {
    /// Every dragged path when at least one is a folder, else none: a drag of
    /// files alone stays with the page, which attaches images and videos.
    static func paths(on pasteboard: NSPasteboard) -> [String] {
        let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL] ?? []
        let hasFolder = urls.contains {
            (try? $0.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
        }
        return hasFolder ? urls.map(\.path) : []
    }
}

/// The run page's web view. A folder dropped on it types its path into the
/// composer or terminal under the pointer instead of reaching the page.
extension WKWebView {
    /// Puts Inspect Element on the right-click menu and lists the view under
    /// Safari's Develop menu. macOS 13.3 hides both unless the app opts in.
    func allowWebInspector() {
        if #available(macOS 13.3, *) { isInspectable = true }
    }
}

final class PathDropWebView: WKWebView {
    /// The drag being tracked and its paths, so moves within one drag do not
    /// stat the files again.
    private var dragPaths: (sequence: Int, paths: [String])?

    private func folderPaths(_ sender: NSDraggingInfo) -> [String] {
        if let cached = dragPaths, cached.sequence == sender.draggingSequenceNumber {
            return cached.paths
        }
        let paths = DroppedPaths.paths(on: sender.draggingPasteboard)
        dragPaths = (sender.draggingSequenceNumber, paths)
        return paths
    }

    // The page only accepts drags it can attach, so a folder needs the copy
    // cursor from here wherever it hovers.
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        let operation = super.draggingEntered(sender)
        return folderPaths(sender).isEmpty ? operation : .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        let operation = super.draggingUpdated(sender)
        return folderPaths(sender).isEmpty ? operation : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let paths = folderPaths(sender)
        dragPaths = nil
        guard !paths.isEmpty else { return super.performDragOperation(sender) }
        // Ends the page's side of the drag, which clears its drop outline.
        super.draggingExited(sender)
        let point = convert(sender.draggingLocation, from: nil)
        let top = isFlipped ? point.y : bounds.height - point.y
        callAsyncJavaScript(
            "window.orcDropPaths && window.orcDropPaths(paths, x, y)",
            arguments: ["paths": paths, "x": point.x / pageZoom, "y": top / pageZoom],
            in: nil,
            in: .page,
            completionHandler: nil
        )
        return true
    }
}

// MARK: - Image clipboard

/// Puts a copied image on the pasteboard as its downloaded bytes. An NSImage
/// is written as a TIFF, which keeps only the first frame of an animated GIF.
enum ImageClipboard {
    static let fileDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("orc-copied-image", isDirectory: true)

    static func write(
        _ data: Data,
        filename: String,
        to pasteboard: NSPasteboard,
        fileDirectory: URL = fileDirectory
    ) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let sourceType = CGImageSourceGetType(source) as String?,
              let tiff = NSImage(data: data)?.tiffRepresentation else { return false }

        let item = NSPasteboardItem()
        item.setData(data, forType: NSPasteboard.PasteboardType(sourceType))
        if sourceType != NSPasteboard.PasteboardType.tiff.rawValue {
            item.setData(tiff, forType: .tiff)
        }
        // Chromium pastes pasteboard image data as a flat PNG and only keeps an
        // animation when the pasteboard names a file holding the original bytes.
        if CGImageSourceGetCount(source) > 1,
           let file = writeFile(data, filename: filename, type: sourceType, in: fileDirectory) {
            item.setString(file.absoluteString, forType: .fileURL)
        }

        pasteboard.clearContents()
        return pasteboard.writeObjects([item])
    }

    private static func writeFile(_ data: Data, filename: String, type: String, in directory: URL) -> URL? {
        var name = (filename as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = "Image" }
        if (name as NSString).pathExtension.isEmpty,
           let ext = UTType(type)?.preferredFilenameExtension {
            name += ".\(ext)"
        }
        // The pasteboard holds one copied image, so the previous file can go.
        try? FileManager.default.removeItem(at: directory)
        let file = directory.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: file)
            return file
        } catch {
            return nil
        }
    }
}

// MARK: - Entry point

let existingInstance = NSRunningApplication.runningApplications(withBundleIdentifier: "com.orc.app")
    .first {
        $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !$0.isTerminated
    }
let app = NSApplication.shared
let delegate = AppDelegate(existingInstance: existingInstance)
app.delegate = delegate
// A duplicate launched only to forward a click to the running instance must
// never surface — .prohibited keeps it out of the Dock and app switcher for
// the ~2s it lives, so the user only ever sees the one real window.
app.setActivationPolicy(existingInstance == nil ? .regular : .prohibited)
app.run()
