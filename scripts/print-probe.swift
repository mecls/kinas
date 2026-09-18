// Prints one HTML file to a PDF through WebKit, with no panel on screen.
//
//   swift scripts/print-probe.swift <page.html> <out.pdf>
//
// Kinas' "Print as PDF" calls wry's `print()`, which runs `WKWebView.printOperation(with:)` as a sheet on the window
// (wry 0.55.1, wkwebview/mod.rs:858-898). An agent cannot click that sheet, so this runs the *same* operation on the
// *same* engine with the panel suppressed and the job saved to a file. It mirrors wry in the one way that matters for
// layout: all four print-info margins are 0, so any margin in the output came from the stylesheet's `@page`.
//
// Prints `pages=<n>` and writes the PDF's text to `<out.pdf>.txt`; `scripts/print-probe.ts` does the judging.
// Exit 0 = a PDF was produced, 2 = usage, 3 = timed out, 4 = the print operation reported failure or wrote nothing.

import AppKit
import PDFKit
import WebKit

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write("usage: swift print-probe.swift <page.html> <out.pdf>\n".data(using: .utf8)!)
  exit(2)
}
let pageURL = URL(fileURLWithPath: arguments[1])
let pdfURL = URL(fileURLWithPath: arguments[2])

final class Probe: NSObject, WKNavigationDelegate {
  let window: NSWindow
  let webView: WKWebView

  override init() {
    // The app's default window size, so screen-only layout (the 55 % panel, the 640 px narrow rule) is what it is there.
    let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
    webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
    window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.contentView = webView
    // Far off any screen: a print operation needs its view in a window, not a window anyone can see.
    window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
    window.orderBack(nil)
    webView.navigationDelegate = self
  }

  func start() {
    webView.loadFileURL(pageURL, allowingReadAccessTo: pageURL.deletingLastPathComponent())
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // One beat for layout and fonts to settle before the page is measured for paper.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.printPage() }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    print("load failed: \(error.localizedDescription)")
    exit(4)
  }

  func printPage() {
    let info = NSPrintInfo.shared.copy() as! NSPrintInfo
    info.topMargin = 0
    info.rightMargin = 0
    info.bottomMargin = 0
    info.leftMargin = 0
    info.jobDisposition = .save
    info.dictionary().setObject(pdfURL, forKey: NSPrintInfo.AttributeKey.jobSavingURL.rawValue as NSString)

    let operation = webView.printOperation(with: info)
    operation.showsPrintPanel = false
    operation.showsProgressPanel = false
    // Without a frame the operation's view is empty and the job never finishes.
    operation.view?.frame = NSRect(origin: .zero, size: info.paperSize)
    operation.runModal(for: window, delegate: self, didRun: #selector(didRun(_:success:contextInfo:)), contextInfo: nil)
  }

  @objc func didRun(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    guard success, let document = PDFDocument(url: pdfURL) else {
      print("print failed: success=\(success)")
      exit(4)
    }
    let text = document.string ?? ""
    try? text.write(to: URL(fileURLWithPath: pdfURL.path + ".txt"), atomically: true, encoding: .utf8)
    print("pages=\(document.pageCount)")
    exit(0)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe()
probe.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
  print("timed out after 60 s")
  exit(3)
}
app.run()
